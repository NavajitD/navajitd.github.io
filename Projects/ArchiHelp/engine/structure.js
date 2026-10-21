// ArchiHelp design engine — structural grid, preliminary column sizing and beams (rule-of-thumb only).
import { rect } from './geom.js';

export function coreRect(cfg) { return rect(cfg.ew_ft / 3, cfg.ns_ft / 3, 2 * cfg.ew_ft / 3, 2 * cfg.ns_ft / 3); }

export function structuralGrid(cfg) {
  const e = cfg.t_ext / 2;
  const lines = (total, n) => {
    const span = total - 2 * e; n = n || Math.max(1, Math.ceil(span / cfg.max_bay_ft - 1e-9));
    const out = []; for (let i = 0; i <= n; i++) out.push(e + span * i / n);
    return out;
  };
  return [lines(cfg.ew_ft, cfg.ew_bays), lines(cfg.ns_ft, cfg.ns_bays)];
}

const LETTERS = 'ABCDEFGHIJKLMNOP';

export function buildStructure(cfg) {
  const [xs, ys] = structuralGrid(cfg), W = cfg.ew_ft, L = cfg.ns_ft, core = coreRect(cfg), cols = [];
  ys.forEach((y, j) => xs.forEach((x, i) => {
    if (cfg.avoid_core_columns && core.x0 < x && x < core.x1 && core.y0 < y && y < core.y1) return;
    const endsI = i === 0 || i === xs.length - 1, endsJ = j === 0 || j === ys.length - 1;
    cols.push({ id: `${LETTERS[i]}${j + 1}`, i, j, x, y, kind: endsI && endsJ ? 'corner' : (endsI || endsJ ? 'edge' : 'interior') });
  }));
  const yb = [0, ...ys.slice(0, -1).map((y, k) => (y + ys[k + 1]) / 2), L], nSlabs = cfg.floors_above + 2;
  ys.forEach((y, j) => {
    const row = cols.filter((c) => c.j === j).sort((a, b) => a.x - b.x);
    const xb = [0, ...row.slice(0, -1).map((c, k) => (c.x + row[k + 1].x) / 2), W];
    row.forEach((c, k) => { c.trib_ft2 = (yb[j + 1] - yb[j]) * (xb[k + 1] - xb[k]); });
  });
  const sizes = [];
  for (const b of [230, 300]) for (let d = 300; d < 901; d += 75) sizes.push([b, d]);
  const sorted = sizes.map((s, i) => [s, i]).sort((p, q) => p[0][0] * p[0][1] - q[0][0] * q[0][1] || p[1] - q[1]).map((t) => t[0]);
  const fc = 0.4 * cfg.fck + 0.67 * cfg.fy * 0.015;
  for (const c of cols) {
    const A = c.trib_ft2 * 0.0929, Pu = 1.5 * A * (cfg.floor_load_kn_m2 * (nSlabs - 1) + cfg.roof_load_kn_m2) * 1.25;
    const pick = sorted.find((s) => s[0] * s[1] >= Pu * 1000 / fc && Math.min(...s) >= cfg.min_column_mm[0] && Math.max(...s) >= cfg.min_column_mm[1]) || sorted[sorted.length - 1];
    Object.assign(c, { trib_m2: A, Pu_kN: Pu, size_mm: pick.slice() });
  }
  const beams = [];
  ys.forEach((y, j) => {
    const row = cols.filter((c) => c.j === j).sort((a, b) => a.x - b.x);
    for (let k = 0; k + 1 < row.length; k++) { const a = row[k], b = row[k + 1]; beams.push({ dir: 'E-W', line: `${j + 1}`, frm: a.id, to: b.id, x0: a.x, y0: y, x1: b.x, y1: y, span_ft: b.x - a.x }); }
  });
  xs.forEach((x, i) => {
    const col = cols.filter((c) => c.i === i).sort((a, b) => a.y - b.y);
    for (let k = 0; k + 1 < col.length; k++) { const a = col[k], b = col[k + 1]; beams.push({ dir: 'N-S', line: LETTERS[i], frm: a.id, to: b.id, x0: x, y0: a.y, x1: x, y1: b.y, span_ft: b.y - a.y }); }
  });
  for (const bm of beams) {
    const sp = bm.span_ft * 0.3048; bm.skipped = bm.span_ft > 2 * cfg.max_bay_ft;
    bm.depth_mm = Math.max(400, Math.ceil(sp * 1000 / 12 / 50) * 50); bm.width_mm = sp <= 4.5 ? 230 : 300; bm.long_span = sp > 6.0;
  }
  return { xs, ys, columns: cols, beams, core };
}
