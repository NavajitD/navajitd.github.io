// ArchiHelp design engine — 32-sector (pada) Vaastu geometry.
// Exact split of a rectangle across the padas (convex clipping, as shapely does in the notebook) and a fast
// 1-inch raster with integral images for the generator (share in allowed padas + score for any rectangle in O(1)).
import { PADAS, PADA_SPAN } from './config.js';
import { clipConvex, polyArea, pyFixed, sortedBy, pyRound } from './geom.js';

export function padaRange(p) {
  const s = (315.0 + PADA_SPAN * PADAS.indexOf(p)) % 360.0;
  return [s, s + PADA_SPAN];
}

export function expandTier(spec) {
  if (spec.includes('-')) {
    const [a, b] = spec.split('-'); const out = [];
    for (let i = parseInt(a.slice(1), 10); i <= parseInt(b.slice(1), 10); i++) out.push(a[0] + i);
    return out;
  }
  return [spec];
}

export const sectorRule = (cfg, rtype) => {
  const r = (cfg.sector_rules || {})[rtype];
  return r === undefined ? null : r;
};

/** {pada: preference weight}, first tier = 1.0, last = floor, linear in between. */
export function padaWeights(rule, floor = 0.5) {
  const tiers = rule.tiers.map(expandTier), n = tiers.length, w = {};
  tiers.forEach((ps, k) => {
    for (const p of ps) if (!(p in w)) w[p] = 1.0 - (1.0 - floor) * (n > 1 ? k / (n - 1) : 0.0);
  });
  return w;
}

export function sectorFrame(cfg) {
  const W = cfg.ew_ft, H = cfg.ns_ft;
  const [cx, cy] = cfg.sector_centre || [W / 2, H / 2];
  const [sx, sy] = cfg.sector_mapping === 'proportional' ? [W / 2, H / 2] : [1.0, 1.0];
  return { cx, cy, sx, sy, rot: cfg.plan_north_bearing_deg || 0, mode: cfg.sector_mapping };
}

const _wedgeCache = new Map();
function wedges(frame) {
  const key = String(frame.rot);
  if (_wedgeCache.has(key)) return _wedgeCache.get(key);
  const out = {};
  for (const p of PADAS) {
    let [a0, a1] = padaRange(p); a0 -= frame.rot; a1 -= frame.rot;
    const pts = [[0, 0]];
    for (const a of [a0, (a0 + a1) / 2, a1]) { const r = a * Math.PI / 180; pts.push([1e4 * Math.sin(r), 1e4 * Math.cos(r)]); }
    out[p] = pts;
  }
  _wedgeCache.set(key, out);
  return out;
}

const _splitCache = new Map();
/** {pada: share of rect's area} — exact polygon clipping. */
export function sectorSplit(cfg, r) {
  const fr = sectorFrame(cfg);
  const key = `${fr.cx},${fr.cy},${fr.sx},${fr.sy},${fr.rot}|${pyRound(r.x0, 4)},${pyRound(r.y0, 4)},${pyRound(r.x1, 4)},${pyRound(r.y1, 4)}`;
  const hit = _splitCache.get(key);
  if (hit) return hit;
  const bx0 = (r.x0 - fr.cx) / fr.sx, by0 = (r.y0 - fr.cy) / fr.sy, bx1 = (r.x1 - fr.cx) / fr.sx, by1 = (r.y1 - fr.cy) / fr.sy;
  const box = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]];
  const A = Math.abs(polyArea(box)), wd = wedges(fr), out = {};
  if (A > 0) for (const p of PADAS) {
    const f = Math.abs(polyArea(clipConvex(box, wd[p]))) / A;
    if (f > 1e-9) out[p] = f;
  }
  if (_splitCache.size > 20000) _splitCache.clear();
  _splitCache.set(key, out);
  return out;
}

export function dominantPadas(split) {
  // shares that tie (to 1e-9, i.e. symmetric layouts) are listed in pada order, so the text is deterministic
  const rows = Object.entries(split).map(([p, f]) => [p, f, Math.round(f * 1e9)]);
  rows.sort((a, b) => b[2] - a[2] || PADAS.indexOf(a[0]) - PADAS.indexOf(b[0]));
  return rows.filter(([, f]) => f >= 0.05).map(([p, f]) => `${p} ${pyFixed(f * 100, 0)}%`).join(', ');
}

/** Per-room Vaastu result: share in allowed padas, preference score 0-100, dominant padas. */
export function roomSector(cfg, room) {
  const rule = sectorRule(cfg, room.rtype), split = sectorSplit(cfg, room.net), dom = dominantPadas(split);
  if (!rule) return { room: room.name, uid: room.uid, rtype: room.rtype, hard: false, frac: 1.0, score: null, ok: true, padas: dom };
  const w = padaWeights(rule, cfg.sector_pref_floor);
  let fa = 0, sc = 0;
  for (const [p, f] of Object.entries(split)) { if (p in w) fa += f; sc += f * (w[p] || 0); }
  sc *= 100;
  return { room: room.name, uid: room.uid, rtype: room.rtype, hard: !!rule.hard, frac: fa, score: sc,
           ok: (fa >= cfg.sector_min_frac - 1e-9) || !rule.hard, padas: dom };
}

/** 1-inch raster + integral images: share in allowed padas and score for ANY rectangle in O(1). */
export class FastSectors {
  constructor(cfg, res = 1 / 12) {
    const W = cfg.ew_ft, H = cfg.ns_ft, nx = Math.round(W / res), ny = Math.round(H / res);
    this.res = res; this.nx = nx; this.ny = ny;
    const fr = sectorFrame(cfg);
    const idx = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const Y = (j + 0.5) * res;
      for (let i = 0; i < nx; i++) {
        const X = (i + 0.5) * res;
        let deg = Math.atan2((X - fr.cx) / fr.sx, (Y - fr.cy) / fr.sy) * 180 / Math.PI;
        let b = ((deg + fr.rot) % 360 + 360) % 360;
        b = ((b - 315) % 360 + 360) % 360;
        idx[j * nx + i] = Math.min(31, Math.floor(b / PADA_SPAN));
      }
    }
    this.I = {};
    for (const t of Object.keys(cfg.sector_rules)) {
      const rule = cfg.sector_rules[t];
      if (!rule) continue;
      const w = padaWeights(rule, cfg.sector_pref_floor), al = new Float64Array(32), wl = new Float64Array(32);
      for (const [p, v] of Object.entries(w)) { const k = PADAS.indexOf(p); al[k] = 1; wl[k] = v; }
      this.I[t] = [this._integral(idx, al), this._integral(idx, wl)];
    }
  }
  _integral(idx, lut) {
    const nx = this.nx, ny = this.ny, I = new Float64Array((nx + 1) * (ny + 1));
    for (let j = 0; j < ny; j++) {
      let row = 0;
      for (let i = 0; i < nx; i++) {
        row += lut[idx[j * nx + i]];
        I[(j + 1) * (nx + 1) + (i + 1)] = I[j * (nx + 1) + (i + 1)] + row;
      }
    }
    return I;
  }
  /** [share in allowed padas, score 0-100] for rect r (null score = no rule). */
  fracScore(t, r) {
    const I = this.I[t];
    if (!I) return [1.0, null];
    const q = this.res, nx1 = this.nx + 1;
    const cl = (v, m) => Math.max(0, Math.min(m, v));
    const i0 = cl(pyRound(r.x0 / q), this.nx), i1 = cl(pyRound(r.x1 / q), this.nx), j0 = cl(pyRound(r.y0 / q), this.ny), j1 = cl(pyRound(r.y1 / q), this.ny);
    const area = Math.max((r.x1 - r.x0) * (r.y1 - r.y0), 1e-9);
    const g = (A) => (A[j1 * nx1 + i1] - A[j0 * nx1 + i1] - A[j1 * nx1 + i0] + A[j0 * nx1 + i0]) * q * q / area;
    return [g(I[0]), 100 * g(I[1])];
  }
}
