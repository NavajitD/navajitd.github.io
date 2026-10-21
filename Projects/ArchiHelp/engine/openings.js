// Vaastu Planner design engine — doors / openings / windows: the single source of truth for the drawings and the schedules.
// Door positions and hinge sides come from the furniture planner; windows avoid doors, columns and tall furniture.
import { sharedEdge, arange } from './geom.js';
import { DEFAULT_WIN } from './config.js';
import { planDoorsAndFurniture } from './furniture.js';

/** Centre of a w-wide opening on wall segment seg, nearest the middle, clear of columns and of `avoid` intervals. */
export function placeOnWall(seg, w, cols, avoid = [], step = 0.125, margin = 0.3) {
  const [[x0, y0], [x1, y1]] = seg, horiz = Math.abs(y0 - y1) < 1e-6;
  const lo = horiz ? Math.min(x0, x1) : Math.min(y0, y1), hi = horiz ? Math.max(x0, x1) : Math.max(y0, y1), cAt = horiz ? y0 : x0;
  const blk = [];
  for (const c of cols) if (Math.abs((horiz ? c.y : c.x) - cAt) < 1.0) {
    const half = Math.max(...c.size_mm) / 304.8 / 2, cc = horiz ? c.x : c.y;
    blk.push([cc - half - 0.2, cc + half + 0.2]);
  }
  blk.push(...avoid);
  const mid = (lo + hi) / 2; let best = null;
  for (const p of arange(lo + w / 2 + margin, hi - w / 2 - margin + 1e-9, step)) {
    if (blk.some(([a, b]) => p + w / 2 > a && p - w / 2 < b)) continue;
    if (best === null || Math.abs(p - mid) < Math.abs(best - mid)) best = p;
  }
  if (best === null) return [null, horiz];
  return [horiz ? [best, y0] : [x0, best], horiz];
}

export function computeOpenings(plan) {
  if (!plan.door_plan) planDoorsAndFurniture(plan);
  const cfg = plan.cfg, R = plan.region, cols = plan.struct.columns, rm = new Map(plan.rooms.map((r) => [r.uid, r]));
  const out = [];
  const wallT = (horiz, c) => {
    const ext = horiz ? (Math.abs(c - R.y0) < 1e-6 || Math.abs(c - R.y1) < 1e-6) : (Math.abs(c - R.x0) < 1e-6 || Math.abs(c - R.x1) < 1e-6);
    return ext ? cfg.t_ext : cfg.t_int;
  };
  plan.links_all.forEach((l, k) => {
    if (!plan.door_plan.has(k) || l.kind === 'nowall') return;
    const [p, hinge, , w] = plan.door_plan.get(k);
    const [[x0, y0], [, y1]] = l.seg, horiz = Math.abs(y0 - y1) < 1e-6;
    const px = horiz ? p : x0, py = horiz ? y0 : p;
    const a = l.a !== null ? rm.get(l.a) : null, b = rm.get(l.b);
    let typ;
    if (l.entrance) typ = 'D1';
    else if (l.kind === 'open') typ = 'OP';
    else typ = [b.rtype, a ? a.rtype : ''].some((t) => t === 'bath' || t === 'puja') ? 'D3' : 'D2';
    out.push({ kind: l.kind, type: typ, w, x: px, y: py, horiz, t: wallT(horiz, horiz ? py : px), hinge, into: l.into, rooms: [a ? a.name : 'outside', b.name], link: k });
  });
  const win = plan.windowsResolved;
  const courts = plan.rooms.filter((r) => r.rtype === 'court');
  for (const r of plan.rooms) {
    if (r.rtype === 'passage' || r.rtype === 'court' || r.rtype === 'suite') continue;
    const t = r.tile; let segs = [];
    for (const c of courts) { const [L, sg] = sharedEdge(t, c.tile); if (L >= 2.5) segs.push(sg); }
    if (Math.abs(t.x0 - R.x0) < 1e-6) segs.push([[t.x0, t.y0], [t.x0, t.y1]]);
    if (Math.abs(t.x1 - R.x1) < 1e-6) segs.push([[t.x1, t.y0], [t.x1, t.y1]]);
    if (Math.abs(t.y0 - R.y0) < 1e-6) segs.push([[t.x0, t.y0], [t.x1, t.y0]]);
    if (Math.abs(t.y1 - R.y1) < 1e-6) segs.push([[t.x0, t.y1], [t.x1, t.y1]]);
    const hints = win.hints[r.uid] || [], hinted = new Set(hints.map((h) => h.side));
    const segSide = (s) => {
      const [[a0, b0], [, b1]] = s;
      if (Math.abs(b0 - b1) < 1e-6) return Math.abs(b0 - t.y0) < 1e-6 ? 'S' : 'N';
      return Math.abs(a0 - t.x0) < 1e-6 ? 'W' : 'E';
    };
    const avoidOn = (hz, at) => out.filter((d) => d.horiz === hz && Math.abs((hz ? d.y : d.x) - at) < 0.1)
      .map((d) => [(hz ? d.x : d.y) - d.w / 2 - 0.5, (hz ? d.x : d.y) + d.w / 2 + 0.5]);
    for (const h of hints) {
      if (!h.w) continue;                                  // side suppressed (no window)
      for (const s of segs) {
        if (segSide(s) !== h.side) continue;
        const [[sx, sy], [, ey]] = s, hz = Math.abs(sy - ey) < 1e-6;
        if (h.c !== null && h.c !== undefined) {
          out.push({ kind: 'window', type: h.tag, w: h.w, x: hz ? h.c : sx, y: hz ? sy : h.c, horiz: hz, t: cfg.t_ext, into: r.uid, rooms: [r.name, 'outside'] });
          continue;
        }
        const [pos] = placeOnWall(s, h.w, cols, avoidOn(hz, hz ? sy : sx));
        if (pos) out.push({ kind: 'window', type: h.tag, w: h.w, x: pos[0], y: pos[1], horiz: hz, t: cfg.t_ext, into: r.uid, rooms: [r.name, 'outside'] });
      }
    }
    segs = segs.filter((s) => !hinted.has(segSide(s)));
    const segLen = (s) => Math.abs(s[1][0] - s[0][0]) + Math.abs(s[1][1] - s[0][1]);
    segs = segs.map((s, i) => [s, i]).sort((a, b) => segLen(b[0]) - segLen(a[0]) || a[1] - b[1]).map((x) => x[0]);
    let planSegs;
    if (r.rtype in DEFAULT_WIN) planSegs = segs.slice(0, 1);
    else { const long = segs.filter((s) => segLen(s) >= 6.0).slice(0, 2); planSegs = long.length ? long : segs.slice(0, 1); }
    const tall = (plan.furniture[r.uid] || []).filter((it) => it.tall).map((it) => it.rect);
    for (const seg of planSegs) {
      const L = segLen(seg);
      const [typ, w] = DEFAULT_WIN[r.rtype] || (L >= 9 ? ['W1', 4.0] : ['W2', 3.0]);
      const nW = r.rtype === 'hall' && L >= 16 ? 2 : 1;
      const [[sx, sy], [ex, ey]] = seg, horiz = Math.abs(sy - ey) < 1e-6, cAt = horiz ? sy : sx;
      for (let k = 0; k < nW; k++) {
        const f0 = k / nW, f1 = (k + 1) / nW;
        const sub = [[sx + (ex - sx) * f0, sy + (ey - sy) * f0], [sx + (ex - sx) * f1, sy + (ey - sy) * f1]];
        const avoid = avoidOn(horiz, cAt);
        for (const tr of tall) {                         // tall furniture against this wall
          let near;
          if (horiz) {
            const onLo = Math.abs(tr.y0 - r.net.y0) < 0.05;
            near = (onLo || Math.abs(tr.y1 - r.net.y1) < 0.05) && Math.abs(cAt - (onLo ? r.tile.y0 : r.tile.y1)) < 0.05;
          } else {
            const onLo = Math.abs(tr.x0 - r.net.x0) < 0.05;
            near = (onLo || Math.abs(tr.x1 - r.net.x1) < 0.05) && Math.abs(cAt - (onLo ? r.tile.x0 : r.tile.x1)) < 0.05;
          }
          if (near) avoid.push(horiz ? [tr.x0, tr.x1] : [tr.y0, tr.y1]);
        }
        let pos = null, ww = w;
        for (ww of [w, ...(w > 3.0 ? [3.0, 2.0] : w > 2.0 ? [2.0] : [])]) {
          [pos] = placeOnWall(sub, ww, cols, avoid);
          if (pos) break;
        }
        if (!pos) continue;
        const tp = typ === 'V1' ? typ : (ww === w ? typ : ({ 3: 'W2', 2: 'W3' }[ww] || typ));
        out.push({ kind: 'window', type: tp, w: ww, x: pos[0], y: pos[1], horiz, t: cfg.t_ext, into: r.uid, rooms: [r.name, 'outside'] });
      }
    }
  }
  return out;
}
