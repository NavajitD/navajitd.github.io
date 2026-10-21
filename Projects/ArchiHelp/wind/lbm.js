// ArchiHelp wind — plan-view wind: grid, solid mask and a D2Q9 lattice-Boltzmann solver.
// Port of floor_wind_thermal.ipynb cell 6 (same grid rules, same BGK + Smagorinsky-type eddy viscosity, same bounce-back
// and free-stream far field), written for typed arrays so it runs in Web Workers and Node.
//
// The flow is solved for a UNIT free stream and rescaled by the wind speed at the floor's height (Reynolds-number
// independence, as the notebook). Treat it as qualitative: 2D, low Reynolds number, uncalibrated eddy viscosity.
export const E = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
export const WQ = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
const EX = E.map((e) => e[0]), EY = E.map((e) => e[1]);

/** Python's round() (half to even). */
export function pyRound(x) { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; }
const fl = (x) => Math.floor(x + 1e-6);

/**
 * Grid for one floor. geo = { xmin, xmax, ymin, ymax, walls:[{orient, coord, s0, s1, thick}], openings, columns, neighbours,
 * storey } in metres. Index of cell (i, j) = i * ny + j (numpy (NX, NY) order).
 */
export function makeGrid(geo, { dx = 0.2, pad = 40 } = {}) {
  const g = { ...geo, dx, pad };
  g.ix = (x) => pad + fl((x - geo.xmin) / dx);
  g.iy = (y) => pad + fl((y - geo.ymin) / dx);
  g.nx = fl((geo.xmax - geo.xmin) / dx) + 1 + 2 * pad;
  g.ny = fl((geo.ymax - geo.ymin) / dx) + 1 + 2 * pad;
  g.x = (i) => geo.xmin + (i - pad + 0.5) * dx;          // cell centre
  g.y = (j) => geo.ymin + (j - pad + 0.5) * dx;
  return g;
}

/** Cells of a wall: [[i0, i1], [j0, j1], nt] (half-open ranges). */
export function wallCells(g, w) {
  const nt = Math.max(1, pyRound(w.thick / g.dx));
  if (w.orient === 'V') {
    const a = g.pad + fl((w.coord - g.xmin) / g.dx - nt / 2 + 0.5);
    return [[a, a + nt], [g.iy(w.s0), g.iy(w.s1) + 1], nt];
  }
  const b = g.pad + fl((w.coord - g.ymin) / g.dx - nt / 2 + 0.5);
  return [[g.ix(w.s0), g.ix(w.s1) + 1], [b, b + nt], nt];
}

/**
 * Cells carved for an open opening. The plan model is depth-averaged over the storey, so an opening is carved with an
 * EQUIVALENT width = width * (free height / storey height) (2D flux per unit height stays mass-conserving).
 * o = { wall (wall object), at, width, effHeight }.
 */
export function openingCells(g, o) {
  const w = o.wallObj, [[i0, i1], [j0, j1]] = wallCells(g, w);
  const weff = o.width * o.effHeight / g.storey;
  const lo = o.at - weff / 2, hi = o.at + weff / 2, off = w.orient === 'H' ? g.xmin : g.ymin;
  let k0 = Math.ceil((lo - off) / g.dx - 0.5 - 1e-6) + g.pad, k1 = Math.floor((hi - off) / g.dx - 0.5 + 1e-6) + g.pad;
  if (k1 < k0) { k0 = k1 = g.pad + fl((o.at - off) / g.dx); }
  return w.orient === 'V' ? [[i0, i1], [k0, k1 + 1]] : [[k0, k1 + 1], [j0, j1]];
}

function fillRect(s, g, [i0, i1], [j0, j1], v) {
  // numpy slice semantics: bounds clamp to the array, an empty range does nothing
  const a0 = Math.max(0, Math.min(g.nx, i0)), a1 = Math.max(0, Math.min(g.nx, i1));
  const b0 = Math.max(0, Math.min(g.ny, j0)), b1 = Math.max(0, Math.min(g.ny, j1));
  for (let i = a0; i < a1; i++) s.fill(v, i * g.ny + b0, i * g.ny + Math.max(b0, b1));
}

/** Solid mask (Uint8Array) for an open/closed state (array of booleans, one per opening). */
export function buildMask(g, state) {
  const s = new Uint8Array(g.nx * g.ny);
  for (const [x0, y0, x1, y1] of g.neighbours || []) fillRect(s, g, [Math.max(g.ix(x0), 0), Math.max(g.ix(x1), 0)], [Math.max(g.iy(y0), 0), Math.max(g.iy(y1), 0)], 1);
  for (const w of g.walls) { if (w.open) continue; const [ri, rj] = wallCells(g, w); fillRect(s, g, ri, rj, 1); }
  for (const c of g.columns || []) {
    const n = Math.max(1, pyRound(c.size / g.dx)), a = g.ix(c.x - c.size / 2), b = g.iy(c.y - c.size / 2);
    fillRect(s, g, [a, a + n], [b, b + n], 1);
  }
  g.openings.forEach((o, k) => { if (state[k]) { const [ri, rj] = openingCells(g, o); fillRect(s, g, ri, rj, 0); } });
  return s;
}

/**
 * Mean (ux, uy) normalised by the free-stream speed. phi = bearing the wind comes FROM, in plan coordinates.
 * Float32 storage like the notebook's numpy arrays.
 */
export function lbmSolve(solid, nx, ny, phiPlanDeg, { steps = 2500, avg = 700, u0 = 0.05, tau0 = 0.53, Cs = 0.15, onProgress = null } = {}) {
  const N = nx * ny;
  const ux0 = -u0 * Math.sin(phiPlanDeg * Math.PI / 180), uy0 = -u0 * Math.cos(phiPlanDeg * Math.PI / 180);
  const feq = (q, rho, ux, uy) => { const cu = 3 * (EX[q] * ux + EY[q] * uy); return WQ[q] * rho * (1 + cu + 0.5 * cu * cu - 1.5 * (ux * ux + uy * uy)); };
  const finf = new Float32Array(9); for (let q = 0; q < 9; q++) finf[q] = feq(q, 1, ux0, uy0);
  let f = Array.from({ length: 9 }, (_, q) => new Float32Array(N).fill(finf[q]));
  let fn = Array.from({ length: 9 }, () => new Float32Array(N));
  const sx = new Float64Array(N), sy = new Float64Array(N);
  const k2 = 18 * 1.4142 * Cs * Cs, post = new Float64Array(9), fv = new Float64Array(9);
  // destination index per direction with periodic wrap (np.roll)
  const rowDest = E.map(([ex]) => Int32Array.from({ length: nx }, (_, i) => ((i + ex + nx) % nx) * ny));
  const colDest = E.map(([, ey]) => Int32Array.from({ length: ny }, (_, j) => (j + ey + ny) % ny));
  for (let it = 0; it < steps; it++) {
    const acc = it >= steps - avg;
    for (let i = 0; i < nx; i++) {
      const base = i * ny;
      for (let j = 0; j < ny; j++) {
        const c = base + j;
        const f0 = f[0][c], f1 = f[1][c], f2 = f[2][c], f3 = f[3][c], f4 = f[4][c], f5 = f[5][c], f6 = f[6][c], f7 = f[7][c], f8 = f[8][c];
        const rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
        const ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho, uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho;
        if (acc) { sx[c] += Math.fround(ux); sy[c] += Math.fround(uy); }
        const usq = 1.5 * (ux * ux + uy * uy);
        let pxx = 0, pyy = 0, pxy = 0;
        fv[0] = f0; fv[1] = f1; fv[2] = f2; fv[3] = f3; fv[4] = f4; fv[5] = f5; fv[6] = f6; fv[7] = f7; fv[8] = f8;
        for (let q = 0; q < 9; q++) {
          const cu = 3 * (EX[q] * ux + EY[q] * uy), eq = WQ[q] * rho * (1 + cu + 0.5 * cu * cu - usq);
          const d = fv[q] - eq;
          post[q] = d;
          pxx += EX[q] * EX[q] * d; pyy += EY[q] * EY[q] * d; pxy += EX[q] * EY[q] * d;
        }
        const pm = Math.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy);
        const tau = 0.5 * (tau0 + Math.sqrt(tau0 * tau0 + k2 * pm / rho));
        for (let q = 0; q < 9; q++) post[q] = fv[q] - post[q] / tau;
        const sol = solid[c] === 1;
        for (let q = 0; q < 9; q++) {
          const v = sol ? post[OPP[q]] : post[q];
          fn[q][rowDest[q][i] + colDest[q][j]] = v;
        }
      }
    }
    const t = f; f = fn; fn = t;
    // far field = free stream (two cells on every side)
    for (let q = 0; q < 9; q++) {
      const a = f[q], v = finf[q];
      for (const i of [0, 1, nx - 2, nx - 1]) a.fill(v, i * ny, i * ny + ny);
      for (let i = 0; i < nx; i++) { const b = i * ny; a[b] = v; a[b + 1] = v; a[b + ny - 2] = v; a[b + ny - 1] = v; }
    }
    if (onProgress && (it % 100 === 99)) onProgress((it + 1) / steps);
  }
  const ux = new Float32Array(N), uy = new Float32Array(N);
  for (let c = 0; c < N; c++) if (!solid[c]) { ux[c] = sx[c] / avg / u0; uy[c] = sy[c] / avg / u0; }
  return { ux, uy };
}

/** Volumetric flow (m3/s) per 1 m/s free stream through every opening (A -> B positive), as the notebook. */
export function openingFlux(g, ux, uy) {
  return g.openings.map((o) => {
    const w = o.wallObj, [[i0, i1], [j0, j1]] = openingCells(g, o), [nxv, nyv] = w.n;
    let sum = 0;
    if (w.orient === 'V') { const i = i0 + Math.floor((i1 - i0) / 2); for (let j = j0; j < j1; j++) if (i >= 0 && i < g.nx && j >= 0 && j < g.ny) { const c = i * g.ny + j; sum += ux[c] * nxv + uy[c] * nyv; } }
    else { const j = j0 + Math.floor((j1 - j0) / 2); for (let i = i0; i < i1; i++) if (i >= 0 && i < g.nx && j >= 0 && j < g.ny) { const c = i * g.ny + j; sum += ux[c] * nxv + uy[c] * nyv; } }
    return sum * g.dx * g.storey;
  });
}

/** Least-squares solve (A^T A) x = A^T b style helper: solve the symmetric system M x = r (Gaussian elimination, pivoting). */
export function solveDense(M, r) {
  const n = r.length, A = M.map((row) => Float64Array.from(row)), b = Float64Array.from(r);
  for (let k = 0; k < n; k++) {
    let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
    if (Math.abs(A[p][k]) < 1e-14) continue;                    // singular direction: leave it (minimum-norm-like)
    if (p !== k) { [A[p], A[k]] = [A[k], A[p]]; [b[p], b[k]] = [b[k], b[p]]; }
    for (let i = k + 1; i < n; i++) { const m = A[i][k] / A[k][k]; if (!m) continue; for (let j = k; j < n; j++) A[i][j] -= m * A[k][j]; b[i] -= m * b[k]; }
  }
  const x = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) { if (Math.abs(A[k][k]) < 1e-14) { x[k] = 0; continue; } let s = b[k]; for (let j = k + 1; j < n; j++) s -= A[k][j] * x[j]; x[k] = s / A[k][k]; }
  return x;
}

/** Remove the residual net air gain/loss per room (minimum-norm correction) so every room conserves mass (notebook). */
export function balanceFluxes(q, state, zoneA, zoneB, nz) {
  const B = Array.from({ length: nz }, () => new Float64Array(q.length));
  q.forEach((_, k) => { if (!state[k]) return; B[zoneA[k]][k] += 1; if (zoneB[k] >= 0) B[zoneB[k]][k] -= 1; });
  const BBt = B.map((ri) => B.map((rj) => ri.reduce((a, v, k) => a + v * rj[k], 0)));
  const Bq = B.map((ri) => ri.reduce((a, v, k) => a + v * q[k], 0));
  const lam = lstsqSym(BBt, Bq);
  return q.map((v, k) => v - B.reduce((a, row, i) => a + row[k] * lam[i], 0));
}

/** Minimum-norm least squares for a symmetric positive semi-definite system (numpy.linalg.lstsq on B B^T). */
function lstsqSym(M, r) {
  // eigen-decomposition by Jacobi rotations; pseudo-inverse with numpy's default cutoff (eps * max(M, N) * s_max)
  const n = r.length, A = M.map((row) => Float64Array.from(row)), V = Array.from({ length: n }, (_, i) => { const v = new Float64Array(n); v[i] = 1; return v; });
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const ev = A.map((row, i) => row[i]), smax = Math.max(...ev.map(Math.abs)), cut = 2.220446049250313e-16 * n * smax;
  const x = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (Math.abs(ev[k]) <= cut) continue;
    let d = 0; for (let i = 0; i < n; i++) d += V[i][k] * r[i];
    for (let i = 0; i < n; i++) x[i] += V[i][k] * d / ev[k];
  }
  return x;
}

/** Bilinear sample of a cell-centred field at plan point (x, y) (metres). */
export function sampleField(g, a, x, y) {
  const fx = (x - g.xmin) / g.dx + g.pad - 0.5, fy = (y - g.ymin) / g.dx + g.pad - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return 0;
  const tx = fx - i, ty = fy - j, c = i * g.ny + j;
  return (1 - tx) * ((1 - ty) * a[c] + ty * a[c + 1]) + tx * ((1 - ty) * a[c + g.ny] + ty * a[c + g.ny + 1]);
}
