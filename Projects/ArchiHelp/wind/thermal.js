// ArchiHelp wind — RC thermal network (backward Euler) and the notebook's single-floor model.
// Port of floor_wind_thermal.ipynb cell 7. The solver is generic: air nodes plus "mass" nodes (walls, slabs, roofs) that
// only touch air nodes and fixed-temperature boundaries, so each time step eliminates the mass nodes exactly (Schur
// complement) and solves a small dense system for the air nodes only — fast enough for multi-floor houses in a browser.
import { WALL_TYPES, OPENING_TYPES, INTERNAL_GAINS_W, wallProps, isOpen, windFactor } from './model.js';
import { solarPosition, facadeIrradiance, interp, mod } from './weather.js';

export const RHO_CP_AIR = 1.2 * 1005.0;
export const AIR_CAP_MULT = 5.0;                   // furniture / contents lumped with the air
export const SLAB_C_PER_M2 = 2 * 0.08 * 2.16e6;    // two faces x ~8 cm thermally active concrete (notebook)
export const H_SLAB = 3.5;                         // slab <-> air, W/m2K
export const R_SI = 0.13, R_SO = 0.04;
export const CD = 0.6, G_ACC = 9.81;
export const INFIL_M3S_PER_M2_EXT = 0.0004;
export const CONC_RHO_CP = 2.16e6;

/** Generic network: nodes (air first), conduction links, conductances to outdoor air and to boundary temperatures. */
export class Net {
  constructor() { this.names = []; this.C = []; this.air = []; this.links = []; this.gOut = []; this.bnd = []; }
  node(name, C, air = false) { this.names.push(name); this.C.push(C); this.air.push(air); this.gOut.push(0); return this.names.length - 1; }
  link(i, j, G) { if (G > 0) this.links.push([i, j, G]); }
  boundary(i, G, key) { if (G > 0) this.bnd.push([i, G, key]); }
  get N() { return this.names.length; }
}

/** Precompute the Schur-reduced air system for a fixed time step. Air nodes must be 0..nAir-1. */
export function makeStepper(net, dt) {
  const N = net.N, nA = net.air.filter(Boolean).length;
  for (let i = 0; i < nA; i++) if (!net.air[i]) throw new Error('air nodes must come first');
  const Cdt = net.C.map((c) => c / dt);
  const D = new Float64Array(N), massAir = Array.from({ length: N }, () => []), bndOf = Array.from({ length: N }, () => []);
  const A0 = Array.from({ length: nA }, () => new Float64Array(nA));
  for (let i = 0; i < N; i++) D[i] = Cdt[i] + net.gOut[i];
  for (const [i, G, key] of net.bnd) { D[i] += G; bndOf[i].push([G, key]); }
  for (const [i, j, G] of net.links) {
    D[i] += G; D[j] += G;
    const ai = i < nA, aj = j < nA;
    if (ai && aj) { A0[i][j] -= G; A0[j][i] -= G; }
    else if (ai && !aj) massAir[j].push([i, G]);
    else if (!ai && aj) massAir[i].push([j, G]);
    else throw new Error(`mass-mass link ${net.names[i]} - ${net.names[j]} is not supported`);
  }
  for (let a = 0; a < nA; a++) A0[a][a] += D[a];
  for (let m = nA; m < N; m++) for (const [a, Ga] of massAir[m]) for (const [b, Gb] of massAir[m]) A0[a][b] -= Ga * Gb / D[m];
  return { N, nA, Cdt, D, massAir, bndOf, A0 };
}

/**
 * One backward-Euler step. T: node temperatures (updated in place). env = { Tout, bndT: key -> value, S: Float64Array(N)
 * heat input W, flows: [[src, dst, G]] upwind advection (src/dst = node or -1 outdoor (Tout) or {T} object), exch:
 * [[a, b, G]] symmetric exchange (b = -1 -> outdoor) }.
 */
export function step(st, T, env) {
  const { N, nA, Cdt, D, massAir, bndOf } = st, A = st.A0.map((r) => Float64Array.from(r));
  const r = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let v = Cdt[i] * T[i] + env.gOut[i] * env.Tout + (env.S ? env.S[i] : 0);
    for (const [G, key] of bndOf[i]) v += G * env.bndT[key];
    r[i] = v;
  }
  for (const [src, dst, G] of env.flows || []) {
    if (dst < 0 || dst >= nA) continue;
    A[dst][dst] += G;
    if (typeof src === 'number' && src >= 0) A[dst][src] -= G; else r[dst] += G * (typeof src === 'number' ? env.Tout : src.T);
  }
  for (const [a, b, G] of env.exch || []) {
    A[a][a] += G;
    if (b >= 0) { A[b][b] += G; A[a][b] -= G; A[b][a] -= G; } else r[a] += G * env.Tout;
  }
  const rhs = r.slice(0, nA);
  for (let m = nA; m < N; m++) for (const [a, G] of massAir[m]) rhs[a] += G * r[m] / D[m];
  const x = gauss(A, rhs);
  for (let a = 0; a < nA; a++) T[a] = x[a];
  for (let m = nA; m < N; m++) { let v = r[m]; for (const [a, G] of massAir[m]) v += G * x[a]; T[m] = v / D[m]; }
  return T;
}

/** Dense Gaussian elimination with partial pivoting (A and b are overwritten). */
export function gauss(A, b) {
  const n = b.length;
  for (let k = 0; k < n; k++) {
    let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
    if (p !== k) { const t = A[p]; A[p] = A[k]; A[k] = t; const u = b[p]; b[p] = b[k]; b[k] = u; }
    const piv = A[k][k];
    for (let i = k + 1; i < n; i++) {
      const m = A[i][k] / piv; if (m === 0) continue;
      const Ai = A[i], Ak = A[k];
      for (let j = k; j < n; j++) Ai[j] -= m * Ak[j];
      b[i] -= m * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) { let s = b[k]; const Ak = A[k]; for (let j = k + 1; j < n; j++) s -= Ak[j] * x[j]; x[k] = s / Ak[k]; }
  return x;
}

// ------------------------------------------------------------------------------------------------ notebook model
export const effHeight = (o, storey, types = OPENING_TYPES) => Math.min(o.height, storey) * types[o.type].free_frac;

/** The notebook's Network: air + slab per room, one node per opaque wall segment, windows, leakage. */
export function notebookNetwork(spec, walls, { storey = 3.0, wallTypes = WALL_TYPES, openingTypes = OPENING_TYPES } = {}) {
  const rooms = spec.rooms, nz = rooms.length, idx = new Map(rooms.map((r, i) => [r.name, i]));
  const net = new Net(), wallBy = new Map(walls.map((w) => [w.id, w]));
  const zoneOf = (x, y) => rooms.find((r) => r.x0 <= x && x <= r.x1 && r.y0 <= y && y <= r.y1);
  for (const r of rooms) net.node(`air:${r.name}`, RHO_CP_AIR * (r.x1 - r.x0) * (r.y1 - r.y0) * storey * AIR_CAP_MULT, true);
  const Cs = rooms.map((r) => (r.x1 - r.x0) * (r.y1 - r.y0) * SLAB_C_PER_M2);
  for (const c of spec.columns || []) { const z = zoneOf(c.x, c.y); if (z) Cs[idx.get(z.name)] += c.size ** 2 * storey * CONC_RHO_CP * 0.3; }
  rooms.forEach((r, i) => net.node(`slab:${r.name}`, Cs[i]));
  rooms.forEach((r, i) => net.link(i, nz + i, H_SLAB * 2 * (r.x1 - r.x0) * (r.y1 - r.y0)));
  const opsOn = new Map(); for (const o of spec.openings) { if (!opsOn.has(o.wall)) opsOn.set(o.wall, []); opsOn.get(o.wall).push(o); }
  const winGain = [], sa = [];
  for (const w of walls) {
    const area = w.length * storey, ops = opsOn.get(w.id) || [];
    const openArea = ops.reduce((a, o) => a + o.width * Math.min(o.height, storey), 0), aOp = Math.max(area - openArea, 0);
    const ia = idx.get(w.A), ib = idx.has(w.B) ? idx.get(w.B) : -1;
    const [Rl, Ca] = wallProps(w.type, wallTypes);
    if (aOp > 0.01) {
      const n = net.node(`wall:${w.id}`, aOp * Ca);
      if (w.ext) { net.link(ia, n, aOp / (R_SI + Rl / 2)); net.boundary(n, aOp / (R_SO + Rl / 2), `sa:${w.id}`); sa.push([w.id, wallTypes[w.type].absorptance, w.true_az]); }
      else { net.link(ia, n, aOp / (R_SI + Rl / 2)); net.link(ib, n, aOp / (R_SI + Rl / 2)); }
    }
    for (const o of ops) {
      const ot = openingTypes[o.type], a = o.width * Math.min(o.height, storey), g = ot.U * a;
      if (g > 0) { if (w.ext) net.gOut[ia] += g; else net.link(ia, ib, g); }
      if (w.ext && ot.shgc > 0) winGain.push([ia, w.true_az, ot.shgc * a * 0.85 * o.shade]);
    }
    if (w.ext) net.gOut[ia] += RHO_CP_AIR * INFIL_M3S_PER_M2_EXT * area;
  }
  const opA = spec.openings.map((o) => idx.get(wallBy.get(o.wall).A));
  const opB = spec.openings.map((o) => { const B = wallBy.get(o.wall).B; return idx.has(B) ? idx.get(B) : -1; });
  return { net, nz, winGain, sa, opA, opB, wallBy };
}

/**
 * The notebook's run_thermal with hourly opening fluxes given (Qh[k][opening], m3/s at hour node k) — the LBM part is
 * separate (lbm.js), so this function is deterministic and testable against the Python output.
 * wx: weather series (weather.js) from a local midnight; returns { tH, Tout, T (rows per step), Q }.
 */
export function runNotebook(spec, walls, wx, Qh, { lat, lon, storey = 3.0, dt = 300, wallTypes = WALL_TYPES, openingTypes = OPENING_TYPES } = {}) {
  const { net, nz, winGain, sa, opA, opB } = notebookNetwork(spec, walls, { storey, wallTypes, openingTypes });
  const nHr = wx.n - 1, nSteps = Math.round(nHr * 3600 / dt) + 1;
  const tH = Float64Array.from({ length: nSteps }, (_, k) => k * dt / 3600);
  const hk = Array.from({ length: wx.n }, (_, k) => k), hkS = hk.map((k) => k - 0.5);
  const at = (arr, shift) => Float64Array.from(tH, (t) => interp(t, shift ? hkS : hk, arr));
  const Tout = at(wx.T, false), ghi = at(wx.ghi, true), dni = at(wx.dni, true), dhi = at(wx.dhi, true);
  const sun = Array.from(tH, (t) => solarPosition(wx.t0Utc + t * 3600, lat, lon));
  const facCache = new Map();
  const fac = (az) => {
    const key = Math.round(az * 1000) / 1000;
    if (!facCache.has(key)) facCache.set(key, Float64Array.from(tH, (_, n) => facadeIrradiance(az, sun[n][0], sun[n][1], dni[n], dhi[n], ghi[n])));
    return facCache.get(key);
  };
  const Q = spec.openings.map((_, j) => Float64Array.from(tH, (t) => interp(t, hk, Qh.map((r) => r[j]))));
  const ig = spec.rooms.map((r) => INTERNAL_GAINS_W[r.profile || 'none']);
  const stp = makeStepper(net, dt), N = net.N;
  const nDay = Math.floor(24 / (dt / 3600));
  let m0 = 0; for (let n = 0; n < nDay; n++) m0 += Tout[n]; m0 /= nDay;
  const T = new Float64Array(N).fill(m0), out = [Float64Array.from(T)];
  let Tz = T.slice(0, nz);
  for (let n = 1; n < nSteps; n++) {
    const hour = Math.floor(n * dt / 3600) % 24;
    const bndT = {};
    for (const [wid, a, az] of sa) bndT[`sa:${wid}`] = Tout[n] + a * fac(az)[n] / 17.0;
    const S = new Float64Array(N);
    for (const [z, az, ga] of winGain) { const qs = ga * fac(az)[n]; S[z] += 0.5 * qs; S[nz + z] += 0.5 * qs; }
    for (let z = 0; z < nz; z++) S[z] += ig[z][hour];
    const flows = [], exch = [];
    spec.openings.forEach((o, k) => {
      if (!isOpen(o, hour)) return;
      const a = opA[k], b = opB[k], q = Q[k][n];
      const [src, dst] = q > 0 ? [a, b] : [b, a];
      flows.push([src, dst, RHO_CP_AIR * Math.abs(q)]);
      const Ta = Tz[a], Tb = b >= 0 ? Tz[b] : Tout[n], dT = Math.abs(Ta - Tb), Tm = 273.15 + 0.5 * (Ta + Tb);
      const qb = CD / 3.0 * o.width * effHeight(o, storey, openingTypes) * Math.sqrt(G_ACC * Math.min(o.height, storey) * dT / Tm);
      exch.push([a, b, RHO_CP_AIR * qb]);
    });
    step(stp, T, { Tout: Tout[n], gOut: net.gOut, bndT, S, flows, exch });
    Tz = T.slice(0, nz);
    out.push(Float64Array.from(T));
  }
  return { tH, Tout, T: out, Q, net };
}

/** Site wind at a height (notebook: ASHRAE boundary layer from the 10 m reading) and plan bearings. */
export function siteWind(wx, { height, terrain = 'urban', rotation = 0 }) {
  const scale = windFactor(height, terrain);
  return { scale, U: Float64Array.from(wx.ws, (v) => v * scale), phiPlan: Float64Array.from(wx.wd, (v) => mod(v - rotation, 360)) };
}
