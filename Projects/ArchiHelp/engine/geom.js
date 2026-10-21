// ArchiHelp design engine — geometry primitives and Python-parity number helpers.
// Pure ES module, no DOM: runs in the browser, in Web Workers and in Node (tests).
// Coordinates are feet. x grows to the east, y grows to the north, origin at the SW outer corner.

export const EPS = 1e-6;

export const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
export const rw = (r) => r.x1 - r.x0;
export const rh = (r) => r.y1 - r.y0;
export const rarea = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
export const rcx = (r) => (r.x0 + r.x1) / 2;
export const rcy = (r) => (r.y0 + r.y1) / 2;
export const rcopy = (r) => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });

export function overlapArea(a, b) {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

/** Length and segment of the wall shared by two tiles -> [len, seg|null], seg = [[x0,y0],[x1,y1]]. */
export function sharedEdge(a, b, eps = 1e-3) {
  if (Math.abs(a.x1 - b.x0) < eps || Math.abs(a.x0 - b.x1) < eps) {
    const x = Math.abs(a.x1 - b.x0) < eps ? a.x1 : a.x0;
    const lo = Math.max(a.y0, b.y0), hi = Math.min(a.y1, b.y1);
    if (hi - lo > eps) return [hi - lo, [[x, lo], [x, hi]]];
  }
  if (Math.abs(a.y1 - b.y0) < eps || Math.abs(a.y0 - b.y1) < eps) {
    const y = Math.abs(a.y1 - b.y0) < eps ? a.y1 : a.y0;
    const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
    if (hi - lo > eps) return [hi - lo, [[lo, y], [hi, y]]];
  }
  return [0, null];
}

// ---------------------------------------------------------------- Python parity
/** Python's round(): round half to even on the exact binary value. */
export function pyRound(x, nd = 0) {
  if (nd) {
    const m = 10 ** nd, y = x * m, f = Math.floor(y), d = y - f;
    if (d === 0.5) return (f % 2 === 0 ? f : f + 1) / m;
    return Math.round(y) / m;
  }
  const f = Math.floor(x), d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/** Python f"{x:.{d}f}" formatting (half-even on exact ties). */
export function pyFixed(x, d = 0) {
  if (!Number.isFinite(x)) return String(x);
  // toFixed rounds the exact binary value correctly except on exact ties (half-up); Python uses half-even there.
  const m = 10 ** d, y = x * m, f = Math.floor(y);
  if (y - f === 0.5 && y / m === x) {
    const n = f % 2 === 0 ? f : f + 1;
    const s = (n / m).toFixed(d);
    return (x < 0 && !s.startsWith('-')) ? '-' + s : s;
  }
  return x.toFixed(d);
}

/** Python "{:g}" for the simple values used in labels (no exponent forms needed). */
export function pyG(x) {
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(6)));
}

/** numpy.arange(start, stop, step) values. */
export function arange(start, stop, step) {
  const n = Math.max(0, Math.ceil((stop - start) / step));
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = start + i * step;
  return out;
}

export function linspace(a, b, n) {
  if (n === 1) return [a];
  const out = new Array(n), st = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + i * st;
  out[n - 1] = b;
  return out;
}

/** First element with the maximum key (Python max(..., key=)). */
export function argmax(arr, key) {
  let best = undefined, bk = -Infinity, first = true;
  for (const v of arr) {
    const k = key(v);
    if (first || cmpKey(k, bk) > 0) { best = v; bk = k; first = false; }
  }
  return best;
}
export function argmin(arr, key) {
  let best = undefined, bk = Infinity, first = true;
  for (const v of arr) {
    const k = key(v);
    if (first || cmpKey(k, bk) < 0) { best = v; bk = k; first = false; }
  }
  return best;
}
/** Lexicographic comparison for tuple keys (arrays) or numbers/booleans. */
export function cmpKey(a, b) {
  if (Array.isArray(a)) {
    for (let i = 0; i < a.length; i++) { const c = cmpKey(a[i], b[i]); if (c) return c; }
    return 0;
  }
  const x = typeof a === 'boolean' ? +a : a, y = typeof b === 'boolean' ? +b : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Stable sort by key (Python sorted(key=)). */
export function sortedBy(arr, key) {
  return arr.map((v, i) => [key(v), i, v]).sort((p, q) => cmpKey(p[0], q[0]) || p[1] - q[1]).map((t) => t[2]);
}

/** itertools.product(*lists) */
export function product(lists) {
  let out = [[]];
  for (const L of lists) {
    const nxt = [];
    for (const pre of out) for (const v of L) nxt.push(pre.concat([v]));
    out = nxt;
  }
  return out;
}

// ---------------------------------------------------------------- feet-inch formatting
/** 4'-9" (inches rounded half-even, as the notebook's fmt()). */
export function fmt(v) {
  let ft = Math.trunc(v + 1e-9), inch = Math.trunc(pyRound((v - ft) * 12));
  if (inch === 12) { ft += 1; inch = 0; }
  return `${ft}'-${inch}"`;
}

/** 4'-9 1/2" (half inches, as the notebook's _fi()). */
export function fi(v) {
  const neg = v < 0; v = Math.abs(v);
  let ft = Math.trunc(v + 1e-9); const inch = (v - ft) * 12;
  let half = pyRound(inch * 2) / 2;
  if (half >= 12) { ft += 1; half = 0; }
  const s = `${ft}'-${Math.trunc(half)}` + (half % 1 ? ' 1/2"' : '"');
  return (neg ? '-' : '') + s;
}

/** Parse "8'-11", 8'11", 8.5, 8 ft 11 in, 107" ... into feet. Returns NaN on failure. */
export function parseFtIn(s) {
  if (typeof s === 'number') return s;
  s = String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return NaN;
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const neg = s.startsWith('-') && /'|ft/.test(s) ? -1 : 1;
  s = s.replace(/^-/, '');
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?\s*(?:"|in|inch|inches)?$/);
  if (m) {
    const ft = parseFloat(m[1]), inch = m[2] ? parseFloat(m[2]) : 0, frac = m[3] ? parseFloat(m[3]) / parseFloat(m[4]) : 0;
    return neg * (ft + (inch + frac) / 12);
  }
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:(\d+)\s*\/\s*(\d+))?\s*(?:"|in|inch|inches)$/);
  if (m) return (parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / parseFloat(m[3]) : 0)) / 12;
  return NaN;
}

// ---------------------------------------------------------------- polygons (convex clipping for pada splits)
export function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Sutherland-Hodgman: clip polygon `subj` by convex polygon `clip` (any orientation). */
export function clipConvex(subj, clip) {
  const ccw = polyArea(clip) > 0;
  let out = subj;
  for (let i = 0, n = clip.length; i < n && out.length; i++) {
    const A = clip[i], B = clip[(i + 1) % n];
    const inside = (p) => {
      const c = (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
      return ccw ? c >= -1e-12 : c <= 1e-12;
    };
    const inter = (p, q) => {
      const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1], x3 = A[0], y3 = A[1], x4 = B[0], y4 = B[1];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(den) < 1e-300) return [x2, y2];
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const inp = out; out = [];
    for (let j = 0, m = inp.length; j < m; j++) {
      const P = inp[j], Q = inp[(j + 1) % m];
      const pin = inside(P), qin = inside(Q);
      if (qin) { if (!pin) out.push(inter(P, Q)); out.push(Q); }
      else if (pin) out.push(inter(P, Q));
    }
  }
  return out;
}

/** Clip segment p0->p1 to an axis-aligned box; returns [q0, q1] or null (Liang-Barsky). */
export function clipSegmentToBox(p0, p1, box) {
  let t0 = 0, t1 = 1; const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const tests = [[-dx, p0[0] - box.x0], [dx, box.x1 - p0[0]], [-dy, p0[1] - box.y0], [dy, box.y1 - p0[1]]];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[p0[0] + t0 * dx, p0[1] + t0 * dy], [p0[0] + t1 * dx, p0[1] + t1 * dy]];
}

// ---------------------------------------------------------------- rectilinear union (walls)
/**
 * Union of axis-aligned rectangles minus axis-aligned cut rectangles, computed on the coordinate grid.
 * Returns { cells: [rect...] (merged fill rectangles), edges: [[x0,y0,x1,y1]...] (boundary segments, merged) }.
 */
export function rectUnion(rects, cuts = []) {
  const xs = uniq([].concat(...rects.map((r) => [r.x0, r.x1]), ...cuts.map((r) => [r.x0, r.x1])));
  const ys = uniq([].concat(...rects.map((r) => [r.y0, r.y1]), ...cuts.map((r) => [r.y0, r.y1])));
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return { cells: [], edges: [] };
  const idx = (arr, v) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v - 1e-9) lo = m + 1; else hi = m; } return lo; };
  const grid = new Uint8Array(nx * ny);
  const paint = (r, val) => {
    const i0 = idx(xs, r.x0), i1 = idx(xs, r.x1), j0 = idx(ys, r.y0), j1 = idx(ys, r.y1);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) grid[j * nx + i] = val;
  };
  for (const r of rects) paint(r, 1);
  for (const c of cuts) paint(c, 0);
  const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && grid[j * nx + i] === 1;
  // merged fill rectangles: per row, horizontal runs; then merge vertically identical runs
  const cells = []; let prevRuns = [];
  for (let j = 0; j < ny; j++) {
    const runs = [];
    for (let i = 0; i < nx;) {
      if (!on(i, j)) { i++; continue; }
      let k = i; while (k < nx && on(k, j)) k++;
      runs.push([i, k]); i = k;
    }
    const nextPrev = [];
    for (const [a, b] of runs) {
      const pr = prevRuns.find((p) => p.a === a && p.b === b);
      if (pr) { pr.r.y1 = ys[j + 1]; nextPrev.push(pr); }
      else { const r = { x0: xs[a], y0: ys[j], x1: xs[b], y1: ys[j + 1] }; cells.push(r); nextPrev.push({ a, b, r }); }
    }
    prevRuns = nextPrev;
  }
  // boundary edges
  const edges = [];
  for (let j = 0; j <= ny; j++) {           // horizontal edges at ys[j]
    let start = -1;
    for (let i = 0; i <= nx; i++) {
      const b = i < nx && (on(i, j - 1) !== on(i, j));
      if (b && start < 0) start = i;
      if (!b && start >= 0) { edges.push([xs[start], ys[j], xs[i], ys[j]]); start = -1; }
    }
  }
  for (let i = 0; i <= nx; i++) {           // vertical edges at xs[i]
    let start = -1;
    for (let j = 0; j <= ny; j++) {
      const b = j < ny && (on(i - 1, j) !== on(i, j));
      if (b && start < 0) start = j;
      if (!b && start >= 0) { edges.push([xs[i], ys[start], xs[i], ys[j]]); start = -1; }
    }
  }
  return { cells, edges };
}

function uniq(arr) {
  const s = arr.slice().sort((a, b) => a - b), out = [];
  for (const v of s) if (!out.length || Math.abs(v - out[out.length - 1]) > 1e-9) out.push(v);
  return out;
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Union of rectangles minus cut rectangles as closed loops (outer boundaries counter-clockwise, holes clockwise),
 * collinear points removed. Fill with even-odd or non-zero; stroke the loops for the outline.
 */
export function rectUnionLoops(rects, cuts = []) {
  const xs = uniq([].concat(...rects.map((r) => [r.x0, r.x1]), ...cuts.map((r) => [r.x0, r.x1])));
  const ys = uniq([].concat(...rects.map((r) => [r.y0, r.y1]), ...cuts.map((r) => [r.y0, r.y1])));
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return [];
  const idx = (arr, v) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v - 1e-9) lo = m + 1; else hi = m; } return lo; };
  const grid = new Uint8Array(nx * ny);
  const paint = (r, val) => {
    const i0 = idx(xs, r.x0), i1 = idx(xs, r.x1), j0 = idx(ys, r.y0), j1 = idx(ys, r.y1);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) grid[j * nx + i] = val;
  };
  for (const r of rects) paint(r, 1);
  for (const c of cuts) paint(c, 0);
  const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && grid[j * nx + i] === 1;
  const W1 = nx + 1, key = (i, j) => j * W1 + i;
  const out = new Map();                    // start vertex -> [end vertex, ...]   (interior on the left)
  const addE = (a, b) => { if (!out.has(a)) out.set(a, []); out.get(a).push(b); };
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
    const below = on(i, j - 1), above = on(i, j);
    if (below && !above) addE(key(i + 1, j), key(i, j));
    else if (above && !below) addE(key(i, j), key(i + 1, j));
  }
  for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) {
    const left = on(i - 1, j), right = on(i, j);
    if (left && !right) addE(key(i, j), key(i, j + 1));
    else if (right && !left) addE(key(i, j + 1), key(i, j));
  }
  const loops = [];
  for (const [start] of out) {
    while (out.get(start) && out.get(start).length) {
      const loop = [start]; let cur = start;
      for (let guard = 0; guard < 1e6; guard++) {
        const nxt = out.get(cur).pop(); cur = nxt;
        if (cur === start) break;
        loop.push(cur);
      }
      const pts = loop.map((k) => [xs[k % W1], ys[Math.floor(k / W1)]]);
      const simp = pts.filter((p, i) => {
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
        return !((Math.abs(a[0] - p[0]) < 1e-12 && Math.abs(b[0] - p[0]) < 1e-12) || (Math.abs(a[1] - p[1]) < 1e-12 && Math.abs(b[1] - p[1]) < 1e-12));
      });
      if (simp.length >= 3) loops.push(simp);
    }
  }
  return loops;
}
