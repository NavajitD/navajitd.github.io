// ArchiHelp — engineering drawing set for one plan (port of the notebook's make_drawing_set):
//   A-101 dimensioned floor plan · A-102 Vaastu 32-sector plan · S-101 column & beam layout · A-601 schedules
// Four A3 sheets at true scale 1:75 (print at 100 %). Every sheet carries "PRELIMINARY - NOT FOR CONSTRUCTION".
import { Sheet } from './sheet.js';
import { fi, pyFixed, pyG, pyRound, rw, rh, rarea, rcx, rcy, sharedEdge, linspace, arange, rectUnionLoops, clipSegmentToBox } from './geom.js';
import { PADAS, PADA_SPAN, DOOR_TYPES, ROOM_COLORS } from './config.js';
import { padaRange, sectorFrame } from './sectors.js';
import { designStair, stairRiseFt } from './stair.js';

const INK = '#111111', MID = '#555555', LIGHT = '#9a9a9a';
const ORD = { 0: 'GROUND', 1: 'FIRST', 2: 'SECOND', 3: 'THIRD' };
export const ordinal = (n) => ORD[n] || `LEVEL ${n}`;

// ---------------------------------------------------------------- sheet frame + title block
function sheetFrame(title, number, plan, project, extra = null) {
  const sh = new Sheet({ name: number }), fr = sh.view({});
  fr.rect(10, 10, 400, 277, { fill: false, lw: 1.2, ec: INK });
  const x0 = 235, y0 = 10, w = 175, h = 52;
  fr.rect(x0, y0, w, h, { fill: false, lw: 1.0, ec: INK });
  for (const yy of [y0 + 40, y0 + 30, y0 + 20, y0 + 10]) fr.plot([x0, x0 + w], [yy, yy], { lw: 0.5, c: INK });
  fr.plot([x0 + 110, x0 + 110], [y0, y0 + 30], { lw: 0.5, c: INK });
  fr.text(x0 + 3, y0 + 46, project.name || 'Residence', { fontsize: 9.5, weight: 'bold', va: 'center' });
  fr.text(x0 + 3, y0 + 42.5, project.site || '', { fontsize: 6.3, va: 'center', color: MID });
  fr.text(x0 + 3, y0 + 35, title, { fontsize: 10.5, weight: 'bold', va: 'center' });
  fr.text(x0 + 3, y0 + 25, `Plan: ${project.plan_label || ''}`, { fontsize: 6.6, va: 'center' });
  fr.text(x0 + 3, y0 + 15, `Vaastu (32-sector, ${plan.cfg.sector_mapping}): ${pyFixed(plan.vaastu_score, 0)}/100   |   hard rules failed: ${plan.failed.length}`, { fontsize: 6.6, va: 'center' });
  fr.text(x0 + 3, y0 + 5, 'PRELIMINARY - NOT FOR CONSTRUCTION', { fontsize: 7.5, weight: 'bold', color: '#b00020', va: 'center' });
  fr.text(x0 + 113, y0 + 25, `Drg. No.  ${number}`, { fontsize: 8.5, weight: 'bold', va: 'center' });
  fr.text(x0 + 113, y0 + 15, 'Scale  1:75 @ A3   |   Units: ft-in', { fontsize: 6.4, va: 'center' });
  fr.text(x0 + 113, y0 + 5, `Date  ${project.date}   |   Rev  ${project.rev || 'P1'}`, { fontsize: 6.4, va: 'center' });
  if (extra) fr.text(x0 + 3, y0 + h + 2, extra, { fontsize: 6.3, color: '#b00020', va: 'bottom' });
  return [sh, fr];
}

/** Plan view in FEET at true scale (1 ft = 304.8/scale mm). pad = (west, east, south, north) margins in ft. */
export function planAxes(sh, cfg, { scale = 75, left = 22, top = 283, pad = [10.5, 13.0, 10.5, 9.0] } = {}) {
  const ftmm = 304.8 / scale, W = cfg.ew_ft, H = cfg.ns_ft;
  const xl = -pad[0], yb = -pad[2], yt = H + pad[3], hmm = (yt - yb) * ftmm;
  const ax = sh.view({ s: ftmm, x0: xl, y0: yb, ox: left, oy: top - hmm });
  ax.xlim = [xl, W + pad[1]]; ax.ylim = [yb, yt];
  return ax;
}

// ---------------------------------------------------------------- plan geometry
export function wallsLoops(plan, ops) {
  const cfg = plan.cfg, R = plan.region, geo = [];
  for (const r of plan.rooms) {
    const t = r.tile;
    for (const [a0, b0, a1, b1] of [[t.x0, t.y0, t.x1, t.y0], [t.x0, t.y1, t.x1, t.y1], [t.x0, t.y0, t.x0, t.y1], [t.x1, t.y0, t.x1, t.y1]]) {
      const horiz = Math.abs(b0 - b1) < 1e-9, c = horiz ? b0 : a0;
      const ext = horiz ? (Math.abs(c - R.y0) < 1e-6 || Math.abs(c - R.y1) < 1e-6) : (Math.abs(c - R.x0) < 1e-6 || Math.abs(c - R.x1) < 1e-6);
      const th = ext ? cfg.t_ext : cfg.t_int;
      geo.push({ x0: a0 - th / 2, y0: b0 - th / 2, x1: a1 + th / 2, y1: b1 + th / 2 });
    }
  }
  const cuts = [], rm = new Map(plan.rooms.map((r) => [r.uid, r]));
  const pairs = plan.links.filter((l) => l.kind === 'nowall').map((l) => [rm.get(l.a), rm.get(l.b)]);
  for (const r of plan.rooms) if (r.rtype === 'suite' && r.group !== null && r.group !== undefined) {
    const g = typeof r.group === 'number' ? rm.get(r.group) : plan.rooms.find((q) => q.name === r.group);
    if (g) pairs.push([r, g]);
  }
  for (const [a, b] of pairs) {
    if (!a || !b) continue;
    const [L, sg] = sharedEdge(a.tile, b.tile);
    if (L <= 0) continue;
    const [[x0, y0], [x1, y1]] = sg, e = cfg.t_ext / 2 + 0.02, hz = Math.abs(y0 - y1) < 1e-6;
    cuts.push(hz ? { x0: Math.min(x0, x1) + cfg.t_int / 2, y0: y0 - e, x1: Math.max(x0, x1) - cfg.t_int / 2, y1: y0 + e }
      : { x0: x0 - e, y0: Math.min(y0, y1) + cfg.t_int / 2, x1: x0 + e, y1: Math.max(y0, y1) - cfg.t_int / 2 });
  }
  for (const o of ops) if (o.kind === 'window' || o.kind === 'door' || o.kind === 'open') {
    const e = o.t / 2 + 0.02;
    cuts.push(o.horiz ? { x0: o.x - o.w / 2, y0: o.y - e, x1: o.x + o.w / 2, y1: o.y + e } : { x0: o.x - e, y0: o.y - o.w / 2, x1: o.x + e, y1: o.y + o.w / 2 });
  }
  return rectUnionLoops(geo, cuts);
}

export function drawOpenings(ax, plan, ops, fs, tags = true) {
  const rm = new Map(plan.rooms.map((r) => [r.uid, r]));
  for (const o of ops) {
    const { x, y, w, t } = o, hz = o.horiz;
    if (o.kind === 'window') {
      if (hz) {
        for (const dy of [-t / 2, t / 2]) ax.plot([x - w / 2, x + w / 2], [y + dy, y + dy], { c: INK, lw: 0.6, z: 6 });
        for (const dy of [-0.07, 0.07]) ax.plot([x - w / 2, x + w / 2], [y + dy, y + dy], { c: INK, lw: 0.4, z: 6 });
        for (const xx of [x - w / 2, x + w / 2]) ax.plot([xx, xx], [y - t / 2, y + t / 2], { c: INK, lw: 0.6, z: 6 });
      } else {
        for (const dx of [-t / 2, t / 2]) ax.plot([x + dx, x + dx], [y - w / 2, y + w / 2], { c: INK, lw: 0.6, z: 6 });
        for (const dx of [-0.07, 0.07]) ax.plot([x + dx, x + dx], [y - w / 2, y + w / 2], { c: INK, lw: 0.4, z: 6 });
        for (const yy of [y - w / 2, y + w / 2]) ax.plot([x - t / 2, x + t / 2], [yy, yy], { c: INK, lw: 0.6, z: 6 });
      }
      if (tags) {
        const room = rm.get(o.into), Rt = room.tile;
        const fit = (plan.furniture[o.into] || []).map((it) => ({ x0: it.rect.x0, y0: it.rect.y0, x1: it.rect.x1 + (it.kind === 'basin' && it.label && it.side === 'W' ? 1.6 : 0), y1: it.rect.y1 }));
        const clash = (px, py) => fit.some((f) => f.x0 - 0.3 <= px && px <= f.x1 + 0.3 && f.y0 - 0.3 <= py && py <= f.y1 + 0.3);
        if (hz) {
          const ty = y + (y > rcy(Rt) ? -1.05 : 1.05);
          const d = [0, -w / 2 + 0.5, w / 2 - 0.5, -w / 2 - 0.8, w / 2 + 0.8].find((dd) => !clash(x + dd, ty));
          ax.text(d === undefined ? x : x + d, ty, o.type, { fontsize: fs - 2.4, ha: 'center', va: 'center', color: MID });
        } else {
          const tx = x + (x > rcx(Rt) ? -1.1 : 1.1);
          const d = [0, -w / 2 + 0.5, w / 2 - 0.5].find((dd) => !clash(tx, y + dd));
          ax.text(tx, d === undefined ? y : y + d, o.type, { fontsize: fs - 2.4, ha: 'center', va: 'center', color: MID, rotation: 90 });
        }
      }
      continue;
    }
    if (o.kind === 'open') { if (tags) ax.text(x, y, 'OP', { fontsize: fs - 3, ha: 'center', va: 'center', color: LIGHT, z: 7 }); continue; }
    const into = rm.get(o.into).net, hi = o.hinge === 'hi';
    if (hz) {
      const d = rcy(into) > y ? 1 : -1, hx = hi ? x + w / 2 : x - w / 2, hy = y + d * t / 2;
      const s0 = d > 0 ? 90 : 270, s1 = hi ? 180 : 0;
      let [a0, a1] = !(d < 0 && !hi) ? [Math.min(s0, s1), Math.max(s0, s1)] : [270, 360];
      if (d < 0 && hi) [a0, a1] = [180, 270];
      ax.arc(hx, hy, 2 * w, 2 * w, a0, a1, { lw: 0.4, color: INK, z: 6 });
      ax.plot([hx, hx], [hy, hy + d * w], { c: INK, lw: 0.8, z: 6 });
      if (tags) ax.text(x, hy + d * w * 0.42, o.type, { fontsize: fs - 2.5, ha: 'center', va: 'center', color: MID, z: 7 });
    } else {
      const d = rcx(into) > x ? 1 : -1, hx = x + d * t / 2, hy = hi ? y + w / 2 : y - w / 2;
      const s0 = d > 0 ? 0 : 180, s1 = hi ? 270 : 90;
      let [a0, a1] = [Math.min(s0, s1), Math.max(s0, s1)];
      if (d > 0 && hi) [a0, a1] = [270, 360];
      ax.arc(hx, hy, 2 * w, 2 * w, a0, a1, { lw: 0.4, color: INK, z: 6 });
      ax.plot([hx, hx + d * w], [hy, hy], { c: INK, lw: 0.8, z: 6 });
      if (tags) ax.text(hx + d * w * 0.42, y, o.type, { fontsize: fs - 2.5, ha: 'center', va: 'center', color: MID, z: 7 });
    }
  }
}

export function drawStair(ax, plan, fs) {
  const g = plan.stair_geo;
  if (!g) return;
  const S = designStair(plan.cfg), blk = g.block;
  ax.rect(blk.x0, blk.y0, rw(blk), rh(blk), { fill: false, ec: INK, lw: 0.6, z: 4 });
  g.flights.forEach(([f, d], k) => {
    const nr = k === 0 ? S.r1 : S.r2;
    ax.rect(f.x0, f.y0, rw(f), rh(f), { fill: false, ec: INK, lw: 0.5, z: 4 });
    const nt = Math.max(1, nr - 1);
    for (let i = 1; i < nt; i++) {
      if (d[0] === 0) { const yy = f.y0 + rh(f) * i / nt; ax.plot([f.x0, f.x1], [yy, yy], { c: INK, lw: 0.35, z: 4 }); }
      else { const xx = f.x0 + rw(f) * i / nt; ax.plot([xx, xx], [f.y0, f.y1], { c: INK, lw: 0.35, z: 4 }); }
    }
  });
  for (const [f, d] of g.flights) {
    const s = [rcx(f) - d[0] * rw(f) * 0.42, rcy(f) - d[1] * rh(f) * 0.42], e = [rcx(f) + d[0] * rw(f) * 0.42, rcy(f) + d[1] * rh(f) * 0.42];
    ax.arrow(s[0], s[1], e[0], e[1], { lw: 0.6, color: INK, z: 5, headLength: 2.4, headWidth: 1.2 });
  }
  const [f1, d1] = g.flights[0];
  ax.text(rcx(f1) - d1[0] * rw(f1) * 0.42, rcy(f1) - d1[1] * rh(f1) * 0.42, 'UP', { fontsize: fs - 2, ha: 'center', va: 'center', z: 6, bbox: { fc: 'white', pad: 0.4 } });
}

export function drawColumns(ax, plan, fs, labels = true, fill = INK) {
  const cfg = plan.cfg;
  for (const c of plan.struct.columns) {
    const [bmm, dmm] = c.size_mm, [dx, dy] = cfg.col_long_axis === 'x' ? [dmm / 304.8, bmm / 304.8] : [bmm / 304.8, dmm / 304.8];
    ax.rect(c.x - dx / 2, c.y - dy / 2, dx, dy, { fc: fill, ec: INK, lw: 0.5, z: 8 });
    if (labels) ax.text(c.x + dx / 2 + 0.25, c.y + dy / 2 + 0.25, c.id, { fontsize: fs - 3, color: MID, z: 9 });
  }
}

export function drawGrid(ax, plan, fs, ext = 7.0) {
  const st = plan.struct, W = plan.cfg.ew_ft, H = plan.cfg.ns_ft, L = 'ABCDEFGHIJKLMNOP';
  const ls = [0, [8, 2, 1, 2]];
  st.xs.forEach((x, i) => {
    ax.plot([x, x], [-ext + 1.2, H + ext - 1.6], { lw: 0.3, ls, c: LIGHT, z: 0.5 });
    ax.circle(x, H + ext - 0.6, 0.95, { fc: 'white', ec: INK, lw: 0.5, z: 7 });
    ax.text(x, H + ext - 0.6, L[i], { fontsize: fs - 1, ha: 'center', va: 'center', z: 8 });
  });
  st.ys.forEach((y, j) => {
    ax.plot([-ext + 1.6, W + 1.2], [y, y], { lw: 0.3, ls, c: LIGHT, z: 0.5 });
    ax.circle(-ext + 0.6, y, 0.95, { fc: 'white', ec: INK, lw: 0.5, z: 7 });
    ax.text(-ext + 0.6, y, String(j + 1), { fontsize: fs - 1, ha: 'center', va: 'center', z: 8 });
  });
}

export function dimChain(ax, ptsIn, at, horiz, fs, labelMin = 1.6, color = INK) {
  const pts = [...new Set(ptsIn.map((p) => pyRound(p, 4)))].sort((a, b) => a - b);
  if (pts.length < 2) return;
  if (horiz) {
    ax.plot([pts[0], pts[pts.length - 1]], [at, at], { c: color, lw: 0.4, z: 3 });
    for (const p of pts) { ax.plot([p - 0.22, p + 0.22], [at - 0.22, at + 0.22], { c: color, lw: 0.7, z: 3 }); ax.plot([p, p], [at - 0.4, at + 0.4], { c: color, lw: 0.3, z: 3 }); }
    for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; if (b - a >= labelMin) ax.text((a + b) / 2, at + 0.25, fi(b - a), { fontsize: fs - 2.2, ha: 'center', va: 'bottom', color }); }
  } else {
    ax.plot([at, at], [pts[0], pts[pts.length - 1]], { c: color, lw: 0.4, z: 3 });
    for (const p of pts) { ax.plot([at - 0.22, at + 0.22], [p - 0.22, p + 0.22], { c: color, lw: 0.7, z: 3 }); ax.plot([at - 0.4, at + 0.4], [p, p], { c: color, lw: 0.3, z: 3 }); }
    for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; if (b - a >= labelMin) ax.text(at - 0.25, (a + b) / 2, fi(b - a), { fontsize: fs - 2.2, ha: 'right', va: 'center', rotation: 90, color }); }
  }
}

export function drawDimensions(ax, plan, fs, ops) {
  const cfg = plan.cfg, R = plan.region, W = cfg.ew_ft, H = cfg.ns_ft, st = plan.struct;
  const sideRooms = (side) => {
    const by = (f, k) => plan.rooms.filter(f).map((r, i) => [r, i]).sort((a, b) => k(a[0]) - k(b[0]) || a[1] - b[1]).map((x) => x[0]);
    if (side === 'S') return by((r) => Math.abs(r.tile.y0 - R.y0) < 1e-6, (r) => r.tile.x0);
    if (side === 'N') return by((r) => Math.abs(r.tile.y1 - R.y1) < 1e-6, (r) => r.tile.x0);
    if (side === 'W') return by((r) => Math.abs(r.tile.x0 - R.x0) < 1e-6, (r) => r.tile.y0);
    return by((r) => Math.abs(r.tile.x1 - R.x1) < 1e-6, (r) => r.tile.y0);
  };
  for (const [side, at0] of [['S', -1.6], ['N', H + 1.6]]) {
    const sg = side === 'S' ? -1 : 1;
    dimChain(ax, [0, W, ...sideRooms(side).flatMap((r) => [r.net.x0, r.net.x1])], at0, true, fs);
    if (side === 'S') { dimChain(ax, [0, ...st.xs, W], at0 + sg * 2.2, true, fs); dimChain(ax, [0, W], at0 + sg * 4.4, true, fs + 0.5); }
  }
  for (const [side, at0] of [['W', -1.6], ['E', W + 1.6]]) {
    dimChain(ax, [0, H, ...sideRooms(side).flatMap((r) => [r.net.y0, r.net.y1])], at0, false, fs);
    if (side === 'W') { dimChain(ax, [0, ...st.ys, H], at0 - 2.2, false, fs); dimChain(ax, [0, H], at0 - 4.4, false, fs + 0.5); }
  }
  const pas = plan.rooms.filter((r) => r.rtype === 'passage');
  if (pas.length) {
    let p = pas[0]; for (const q of pas) if (rarea(q.net) > rarea(p.net)) p = q;
    const opsH = ops.filter((o) => o.horiz && (o.kind === 'door' || o.kind === 'open'));
    let xs = arange(p.net.x0 + 1.0, p.net.x1 - 1.0, 0.25);
    const blk = plan.stair_geo ? plan.stair_geo.block : null;
    const f = xs.filter((xx) => !blk || !(blk.x0 - 0.5 <= xx && xx <= blk.x1 + 0.5));
    if (f.length) xs = f;
    let x = rcx(p.net);
    if (xs.length) {
      let best = -Infinity;
      for (const xx of xs) { const k = Math.min(...opsH.map((o) => Math.abs(xx - o.x) - o.w / 2), 99); if (k > best) { best = k; x = xx; } }
    }
    const stack = plan.rooms.filter((r) => r.net.x0 - 1e-6 <= x && x <= r.net.x1 + 1e-6).map((r, i) => [r, i]).sort((a, b) => a[0].net.y0 - b[0].net.y0 || a[1] - b[1]).map((t) => t[0]);
    dimChain(ax, stack.flatMap((r) => [r.net.y0, r.net.y1]), x, false, fs - 0.4, 1.6, MID);
  }
}

function labelSpot(room, items, ops) {
  const n = room.net; let best = [rcx(n), rcy(n)], bd = -1;
  for (const fx of linspace(0.2, 0.8, 7)) for (const fy of linspace(0.25, 0.75, 6)) {
    const x = n.x0 + rw(n) * fx, y = n.y0 + rh(n) * fy;
    if (items.some((it) => it.rect.x0 - 0.3 <= x && x <= it.rect.x1 + 0.3 && it.rect.y0 - 0.3 <= y && y <= it.rect.y1 + 0.3)) continue;
    if (ops.some((o) => o.horiz && Math.abs(x - o.x) < o.w / 2 + 1.2 && Math.abs(y - o.y) < 2.2) ||
        ops.some((o) => !o.horiz && Math.abs(y - o.y) < o.w / 2 + 1.0 && Math.abs(x - o.x) < 2.4)) continue;
    const d = Math.min(...items.map((it) => Math.min(Math.abs(x - rcx(it.rect)), 99) + Math.min(Math.abs(y - rcy(it.rect)), 99)), 99);
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best;
}

export function drawRoomLabels(ax, plan, fs, { detail = true, sector = false, furnished = false, ops = [] } = {}) {
  const rows = new Map((plan.sector_rows || []).map((r) => [r.uid, r]));
  for (const r of plan.rooms) {
    const n = r.net;
    if (r.rtype === 'stair') {
      const g = plan.stair_geo, lob = g ? g.lobby : null, big = lob && rarea(lob) > 6;
      const [cx, cy] = big ? [rcx(lob), rcy(lob)] : [rcx(n), rcy(n)];
      const rot = big && rw(lob) < 5.5 && rh(lob) > rw(lob) ? 90 : 0;
      ax.text(cx, cy, `STAIRCASE\n${fi(rw(n))} x ${fi(rh(n))}`, { fontsize: fs - 2.2, ha: 'center', va: 'center', z: 9, rotation: rot, bbox: { fc: 'white', pad: 0.3, alpha: 0.85 } });
      continue;
    }
    const small = rarea(n) < 50 || Math.min(rw(n), rh(n)) < 5;
    if (r.rtype === 'passage') {
      const px = sector && rw(n) > rh(n) ? n.x0 + rw(n) * 0.22 : rcx(n);
      ax.text(px, rcy(n), rw(n) > rh(n) ? `PASSAGE  ${fi(rw(n))} x ${fi(rh(n))}` : `PASSAGE\n${fi(rw(n))} x ${fi(rh(n))}`,
        { fontsize: fs - 2, ha: 'center', va: 'center', color: MID, z: 9, rotation: rw(n) >= rh(n) ? 0 : 90 });
      continue;
    }
    let txt = r.name.toUpperCase().replace(' (', '\n(') + (r.rtype === 'court' ? '\n(OPEN TO SKY)' : '');
    txt += `\n${fi(rw(n))} x ${fi(rh(n))}`;
    if (detail && !small) txt += `\n${pyFixed(rarea(n), 0)} sq ft`;
    const row = rows.get(r.uid);
    if (sector && row && row.score !== null) txt += `\n${pyFixed(row.frac * 100, 0)}% allowed | ${pyFixed(row.score, 0)}/100`;
    const rot = small && rh(n) > rw(n) * 1.3 ? 90 : 0;
    let [lx, ly] = [rcx(n), rcy(n)];
    const items = furnished ? (plan.furniture[r.uid] || []) : [];
    if (items.length) [lx, ly] = labelSpot(r, items, ops);
    let fsz = small ? fs - 2.6 : fs - 1.2;
    const maxLen = Math.max(...txt.split('\n').map((l) => l.length));
    if (rot === 0) fsz = Math.min(fsz, Math.max(4.2, (rw(n) - 0.5) / (maxLen * 0.062)));
    if (rot === 0) { const half = maxLen * 0.0477 * fsz / 2 + 0.25; if (rw(n) > 2 * half) lx = Math.min(Math.max(lx, n.x0 + half), n.x1 - half); }
    ax.text(lx, ly, txt, { fontsize: fsz, ha: 'center', va: 'center', z: 9, linespacing: 1.15, rotation: rot, bbox: items.length ? { fc: 'white', pad: 0.4, alpha: 0.75 } : null });
  }
}

export function drawRoadNorth(ax, plan, fs) {
  const cfg = plan.cfg, W = cfg.ew_ft, H = cfg.ns_ft, side = cfg.road_side;
  const name = { E: 'EAST', W: 'WEST', N: 'NORTH', S: 'SOUTH' }[side];
  if (side === 'E') {
    ax.rect(W + 5.6, -6, 6.0, H + 12, { fc: '#e6e6e6', ec: 'none', z: 0 });
    ax.text(W + 8.6, H / 2, 'ROAD (EAST)', { rotation: 90, ha: 'center', va: 'center', fontsize: fs, color: MID });
  } else if (side === 'W') {
    ax.rect(-10.2, -6, 1.6, H + 12, { fc: '#e6e6e6', ec: 'none', z: 0 });
    ax.text(-9.4, H / 2, `ROAD (${name})`, { rotation: 90, ha: 'center', va: 'center', fontsize: fs - 1.5, color: MID });
  } else if (side === 'S') {
    ax.rect(-6, ax.ylim[0] + 0.3, W + 12, 1.8, { fc: '#e6e6e6', ec: 'none', z: 0 });
    ax.text(W / 2, ax.ylim[0] + 1.2, `ROAD (${name})`, { ha: 'center', va: 'center', fontsize: fs - 1.5, color: MID });
  } else if (side === 'N') {
    ax.rect(-6, ax.ylim[1] - 1.6, W + 4, 1.4, { fc: '#e6e6e6', ec: 'none', z: 0 });
    ax.text(W / 2 - 1, ax.ylim[1] - 0.9, `ROAD (${name})`, { ha: 'center', va: 'center', fontsize: fs - 1.5, color: MID });
  }
  const nx = W + 8.6, ny = Math.min(H + 3.2, ax.ylim[1] - 3.4);
  ax.arrow(nx, ny - 1.6, nx, ny + 1.6, { lw: 1.0, color: INK, headLength: 4, headWidth: 2 });
  ax.text(nx, ny + 1.9, 'N', { ha: 'center', va: 'bottom', fontsize: fs + 2, weight: 'bold' });
  const rot = cfg.plan_north_bearing_deg || 0;
  if (rot) ax.text(nx, ny - 2.0, `plan N = ${rot >= 0 ? '+' : ''}${pyFixed(rot, 1)} deg\nfrom compass N`, { ha: 'center', va: 'top', fontsize: fs - 3 });
}

export function drawBasePlan(ax, plan, fs, ops, { tags = true, wallColor = '#2b2b2b' } = {}) {
  ax.poly(wallsLoops(plan, ops), { fc: wallColor, ec: INK, lw: 0.3, z: 5 });
  drawOpenings(ax, plan, ops, fs, tags);
  drawStair(ax, plan, fs);
  for (const r of plan.rooms) if (r.rtype === 'court') {
    const n = r.net;
    ax.rect(n.x0, n.y0, rw(n), rh(n), { fill: false, ec: '#6a994e', lw: 0, hatch: '..', z: 2 });
    ax.plot([n.x0, n.x1], [n.y0, n.y1], { c: '#6a994e', lw: 0.4, z: 2 }); ax.plot([n.x0, n.x1], [n.y1, n.y0], { c: '#6a994e', lw: 0.4, z: 2 });
  }
}

export function drawFurniture(ax, plan, fs, color = '#555555') {
  const lw = 0.5, z = 4;
  const R_ = (r, k = {}) => ax.rect(r.x0, r.y0, rw(r), rh(r), { fill: false, ec: color, lw: k.lw ?? lw, z, hatch: k.hatch });
  const T_ = (x, y, s, rot = 0, ha = 'center') => ax.text(x, y, s, { fontsize: fs - 3.4, ha, va: 'center', color, z: z + 0.1, rotation: rot });
  const X_ = (r, lw2 = 0.3) => { ax.plot([r.x0, r.x1], [r.y0, r.y1], { c: color, lw: lw2, z }); ax.plot([r.x0, r.x1], [r.y1, r.y0], { c: color, lw: lw2, z }); };
  for (const items of Object.values(plan.furniture || {})) for (const it of items) {
    const r = it.rect, vert = rh(r) > rw(r), cx = rcx(r), cy = rcy(r), W = rw(r), H = rh(r);
    switch (it.kind) {
      case 'bed': {
        R_(r); const h = (it.meta && it.meta.head) || it.side || 'S', p = 0.9;
        if (h === 'S' || h === 'N') {
          const y0 = h === 'S' ? r.y0 + 0.15 : r.y1 - 0.15 - p, n = W >= 4 ? 2 : 1;
          for (let k = 0; k < n; k++) ax.rect(r.x0 + 0.2 + k * (W - 0.4) / n, y0, (W - 0.4) / n - 0.15, p, { fill: false, ec: color, lw: 0.35, z });
          const yf = h === 'S' ? r.y0 + H * 0.45 : r.y1 - H * 0.45; ax.plot([r.x0, r.x1], [yf, yf], { c: color, lw: 0.35, z });
        } else {
          const x0 = h === 'W' ? r.x0 + 0.15 : r.x1 - 0.15 - p, n = H >= 4 ? 2 : 1;
          for (let k = 0; k < n; k++) ax.rect(x0, r.y0 + 0.2 + k * (H - 0.4) / n, p, (H - 0.4) / n - 0.15, { fill: false, ec: color, lw: 0.35, z });
          const xf = h === 'W' ? r.x0 + W * 0.45 : r.x1 - W * 0.45; ax.plot([xf, xf], [r.y0, r.y1], { c: color, lw: 0.35, z });
        }
        T_(cx, cy, 'BED', vert ? 90 : 0); break;
      }
      case 'wardrobe': R_(r); X_(r); T_(cx, cy, 'WARD.', vert ? 90 : 0); break;
      case 'side_table': case 'coffee': R_(r); break;
      case 'planter': ax.circle(cx, cy, W / 2 - 0.1, { fill: false, ec: '#6a994e', lw, z }); break;
      case 'study': R_(r); T_(cx, cy, 'STUDY', vert ? 90 : 0); break;
      case 'shower': R_(r); X_(r); ax.circle(cx, cy, 0.15, { fc: color, ec: 'none', z }); T_(cx, vert ? cy : cy - 0.6, 'SHOWER', vert ? 90 : 0); break;
      case 'wc': {
        const s = it.side || 'S', tank = 0.6; let t, bowl, bw, bh;
        if (s === 'S' || s === 'N') {
          t = s === 'S' ? { x0: r.x0 + 0.1, y0: r.y0, x1: r.x1 - 0.1, y1: r.y0 + tank } : { x0: r.x0 + 0.1, y0: r.y1 - tank, x1: r.x1 - 0.1, y1: r.y1 };
          bowl = [cx, s === 'S' ? (t.y1 + r.y1) / 2 : (r.y0 + t.y0) / 2]; bw = W * 0.75; bh = H - tank - 0.15;
        } else {
          t = s === 'W' ? { x0: r.x0, y0: r.y0 + 0.1, x1: r.x0 + tank, y1: r.y1 - 0.1 } : { x0: r.x1 - tank, y0: r.y0 + 0.1, x1: r.x1, y1: r.y1 - 0.1 };
          bowl = [s === 'W' ? (t.x1 + r.x1) / 2 : (r.x0 + t.x0) / 2, cy]; bw = W - tank - 0.15; bh = H * 0.75;
        }
        R_(t); ax.ellipse(bowl[0], bowl[1], bw, bh, { fill: false, ec: color, lw, z }); T_(cx, cy, 'WC'); break;
      }
      case 'washer': R_(r); ax.circle(cx, cy, Math.min(W, H) * 0.36, { fill: false, ec: color, lw, z }); T_(cx, cy, 'WM'); break;
      case 'wash_area':
        ax.rect(r.x0, r.y0, W, H, { fill: false, ec: color, lw: 0.5, ls: [0, [3, 2]], z });
        T_(cx, r.y0 - 0.55, it.label || 'WASH AREA\n(WM + utility sink, floor trap)'); break;
      case 'basin':
        if (it.label) {
          if (it.side === 'W' || it.side === 'E') T_(it.side === 'W' ? r.x1 + 0.3 : r.x0 - 0.3, cy, it.label.replace(/ /g, '\n'), 0, it.side === 'W' ? 'left' : 'right');
          else T_(cx, it.side === 'N' ? r.y0 - 0.5 : r.y1 + 0.5, it.label.replace(/ /g, '\n'));
        }
        R_(r); ax.ellipse(cx, cy, W * 0.6, H * 0.6, { fill: false, ec: color, lw: 0.35, z }); break;
      case 'counter': {
        R_(r, { hatch: '////', lw: 0.4 }); const m = it.meta || {};
        if (m.hob) {
          for (const f of (m.hob_end === 'lo' ? [0.14, 0.36] : [0.35, 0.65])) {
            const [hx, hy] = vert ? [cx, r.y0 + H * f] : [r.x0 + W * f, cy];
            ax.circle(hx, hy, 0.42, { fc: 'white', ec: color, lw, z: z + 0.05 });
          }
          T_(vert ? cx : (m.hob_end === 'lo' ? r.x0 + W * 0.25 : cx), vert && m.hob_end === 'lo' ? r.y0 + H * 0.25 : cy, 'HOB', vert ? 90 : 0);
        }
        if (m.sink) {
          const [sw, shh] = vert ? [1.4, 1.8] : [1.8, 1.4];
          let [sx, sy] = vert ? [cx, r.y0 + H * 0.5] : [r.x0 + W * 0.5, cy];
          if (m.sink_end === 'lo') [sx, sy] = vert ? [cx, r.y0 + shh / 2 + 0.25] : [r.x0 + sw / 2 + 0.25, cy];
          if (m.hob) [sx, sy] = vert ? [cx, r.y0 + H * 0.88] : [r.x1 - 2.0 - sw / 2 - 0.2, cy];
          ax.rect(sx - sw / 2, sy - shh / 2, sw, shh, { fc: 'white', ec: color, lw, z: z + 0.05 }); T_(sx, sy, 'SINK');
        }
        break;
      }
      case 'fridge': R_(r); T_(cx, cy, 'FRIDGE', vert ? 90 : 0); break;
      case 'altar': R_(r, { hatch: 'xx', lw: 0.4 }); T_(cx, cy, 'ALTAR', vert ? 90 : 0); break;
      case 'dining_table': {
        R_(r); const seats = (it.meta && it.meta.seats) || 4, c = plan.cfg.furn.chair * 0.8, longX = W >= H, per = seats >= 4 ? Math.max(1, Math.floor(seats / 2)) : 1;
        for (let k = 0; k < per; k++) {
          if (longX) { const ccx = r.x0 + W * (k + 0.5) / per; for (const ccy of [r.y0 - c / 2 - 0.1, r.y1 + c / 2 + 0.1]) ax.rect(ccx - c / 2, ccy - c / 2, c, c, { fill: false, ec: color, lw: 0.4, z }); }
          else { const ccy = r.y0 + H * (k + 0.5) / per; for (const ccx of [r.x0 - c / 2 - 0.1, r.x1 + c / 2 + 0.1]) ax.rect(ccx - c / 2, ccy - c / 2, c, c, { fill: false, ec: color, lw: 0.4, z }); }
        }
        T_(cx, cy, it.label || `${seats}-SEATER`); break;
      }
      case 'sofa': {
        R_(r); const b = 0.6, s = it.side || 'S';
        const back = { S: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y0 + b }, N: { x0: r.x0, y0: r.y1 - b, x1: r.x1, y1: r.y1 }, W: { x0: r.x0, y0: r.y0, x1: r.x0 + b, y1: r.y1 }, E: { x0: r.x1 - b, y0: r.y0, x1: r.x1, y1: r.y1 } }[s];
        R_(back); T_(cx, cy, 'SOFA', vert ? 90 : 0); break;
      }
      case 'tv': R_(r); T_(cx, cy, 'TV', vert ? 90 : 0); break;
      default: R_(r); if (it.label) T_(cx, cy, it.label, vert && W < 2 ? 90 : 0);
    }
  }
}

function table(fr, x, y, cols, rows, widths, { fs = 6.0, title = null, rowH = 3.6 } = {}) {
  if (title) fr.text(x, y + 2.2, title, { fontsize: fs + 1.6, weight: 'bold', va: 'bottom' });
  const W = widths.reduce((a, b) => a + b, 0); let yy = y, cx = x;
  fr.rect(x, yy - rowH, W, rowH, { fc: '#ececec', ec: INK, lw: 0.5 });
  cols.forEach((c, i) => { fr.text(cx + 1, yy - rowH / 2, c, { fontsize: fs, weight: 'bold', va: 'center' }); cx += widths[i]; });
  yy -= rowH;
  for (const r of rows) {
    fr.rect(x, yy - rowH, W, rowH, { fc: 'white', ec: INK, lw: 0.3 }); cx = x;
    r.forEach((v, i) => { fr.text(cx + 1, yy - rowH / 2, String(v), { fontsize: fs, va: 'center', color: typeof v === 'string' && v.startsWith('FAIL') ? '#b00020' : INK }); cx += widths[i]; });
    yy -= rowH;
  }
  cx = x;
  for (const w of widths.slice(0, -1)) { cx += w; fr.plot([cx, cx], [y, yy], { lw: 0.3, c: INK }); }
  return yy;
}

export function planNotes(plan) {
  const cfg = plan.cfg, S = designStair(cfg), h = stairRiseFt(cfg);
  return ['All dimensions in feet-inches. Room sizes are CLEAR (wall face to wall face).',
    `External walls ${pyFixed(cfg.t_ext * 12, 0)}" , internal walls ${pyFixed(cfg.t_int * 12, 0)}" unless noted.` + (plan.rooms.some((r) => r.rtype === 'court') ? ' Courtyards are open to sky (parapet on the outer edge).' : ''),
    `Floor-to-floor ${pyG(h)}'-0"; stair ${S.risers} risers @ ${pyFixed(S.riser_in, 2)}" / ${pyG(cfg.tread_in)}" tread, dog-leg, turns clockwise going up.`,
    `Columns shown black; sizes and reinforcement per structural drawings (S-101). Seismic Zone ${cfg.seismic_zone || 'V'}.`,
    'Door / window tags refer to the schedule on A-601. OP = opening without shutter.',
    'Verify site north with a compass before finalising Vaastu sectors (A-102).', ...(plan.notes || [])];
}

/** Window types with the "see note N" reference resolved for full-height glazing. */
export function windowTypes(plan) {
  const wt = {}, notes = planNotes(plan), base = 6;
  for (const [k, v] of Object.entries(plan.windowsResolved.winTypes)) {
    let sill = v[2];
    if (sill === 'see note *') {
      const i = (plan.notes || []).findIndex((n) => n.includes(`(${k})`) || n.includes(` ${k} `) || n.includes(`${k}:`));
      sill = i >= 0 ? `see note ${base + i + 1}` : 'full-height glazing';
    }
    wt[k] = [v[0], v[1], sill];
  }
  void notes;
  return wt;
}

// ---------------------------------------------------------------- sheets
function sheetFloorPlan(plan, project, ops, fs = 8) {
  const [sh, fr] = sheetFrame(`${ordinal(plan.cfg.floor_level)} FLOOR PLAN`, 'A-101', plan, project);
  const ax = planAxes(sh, plan.cfg);
  drawGrid(ax, plan, fs); drawBasePlan(ax, plan, fs, ops); drawColumns(ax, plan, fs, false);
  drawFurniture(ax, plan, fs);
  drawDimensions(ax, plan, fs, ops); drawRoomLabels(ax, plan, fs, { furnished: true, ops }); drawRoadNorth(ax, plan, fs);
  fr.text(22, 92, 'NOTES', { fontsize: 8, weight: 'bold' });
  planNotes(plan).forEach((n, k) => fr.text(22, 87 - k * 4.4, `${k + 1}. ${n}`, { fontsize: 6.4, va: 'top' }));
  return sh;
}

function sheetVaastu(plan, project, ops, fs = 8) {
  const [sh, fr] = sheetFrame('VAASTU 32-SECTOR PLAN', 'A-102', plan, project);
  const ax = planAxes(sh, plan.cfg, { pad: [10.5, 13.0, 4.0, 4.0], top: 280 });
  const cfg = plan.cfg, W = cfg.ew_ft, H = cfg.ns_ft, rows = new Map(plan.sector_rows.map((r) => [r.uid, r]));
  for (const r of plan.rooms) {
    const rr = rows.get(r.uid), n = r.net;
    const fc = r.rtype === 'court' ? '#e7f3df' : (!rr || rr.score === null) ? '#f2f2f2' : (rr.hard && !rr.ok) ? '#f6c9cf' : rr.hard ? '#cfe8d2' : '#e3edf7';
    ax.rect(n.x0, n.y0, rw(n), rh(n), { fc, ec: 'none', z: 1 });
  }
  drawBasePlan(ax, plan, fs, ops, { tags: false, wallColor: '#6b6b6b' });
  const fr0 = sectorFrame(cfg);
  drawSectorLines(ax, plan, fs);
  drawRoomLabels(ax, plan, fs, { detail: false, sector: true }); drawRoadNorth(ax, plan, fs);
  const tbl = plan.sector_rows.map((r) => [r.room, r.rtype, r.score !== null ? (r.hard ? 'hard' : 'soft') : '-', r.score !== null ? `${pyFixed(r.frac * 100, 0)}%` : '-',
    r.hard ? (r.ok ? 'PASS' : 'FAIL') : '-', r.score !== null ? pyFixed(r.score, 0) : '-', r.padas.slice(0, 58)]);
  table(fr, 22, 100, ['Room', 'Type', 'Rule', 'In allowed', `${pyFixed(cfg.sector_min_frac * 100, 0)}% rule`, 'Score', 'Padas (share of floor area)'], tbl, [33, 17, 11, 17, 15, 12, 105],
    { fs: 5.9, title: `SECTOR COMPLIANCE  -  plan score ${pyFixed(plan.vaastu_score, 1)}/100  (mean of per-room scores; mapping = ${fr0.mode}; centre = ${cfg.sector_centre ? 'set point' : 'building centre'})` });
  fr.text(22, 14, `Score per room = share of floor area in each allowed pada x preference weight (1st listed = 1.0, last = ${pyG(cfg.sector_pref_floor)}); 0 outside allowed padas.  ` +
    `Green = passes, red = fails the ${pyFixed(cfg.sector_min_frac * 100, 0)}% rule, blue = soft rule, grey = unrestricted.`, { fontsize: 5.6, color: MID });
  return sh;
}

export function drawSectorLines(ax, plan, fs) {
  const cfg = plan.cfg, W = cfg.ew_ft, H = cfg.ns_ft, fr0 = sectorFrame(cfg), env = { x0: 0, y0: 0, x1: W, y1: H };
  for (const p of PADAS) {
    const [a0] = padaRange(p), a = (a0 - fr0.rot) * Math.PI / 180;
    const seg = clipSegmentToBox([fr0.cx, fr0.cy], [fr0.cx + fr0.sx * 1e3 * Math.sin(a), fr0.cy + fr0.sy * 1e3 * Math.cos(a)], env);
    if (!seg) continue;
    const major = p.endsWith('1');
    ax.plot([seg[0][0], seg[1][0]], [seg[0][1], seg[1][1]], { c: major ? '#7a1fa2' : '#b98ad0', lw: major ? 0.9 : 0.45, z: 7 });
    const am = (a0 + PADA_SPAN / 2 - fr0.rot) * Math.PI / 180;
    const s2 = clipSegmentToBox([fr0.cx, fr0.cy], [fr0.cx + fr0.sx * 1e3 * Math.sin(am), fr0.cy + fr0.sy * 1e3 * Math.cos(am)], env);
    if (s2) {
      const [ex, ey] = s2[1];
      const dx = Math.abs(ex - W) < 1e-6 ? 1.3 : (Math.abs(ex) < 1e-6 ? -1.3 : 0), dy = Math.abs(ey - H) < 1e-6 ? 1.1 : (Math.abs(ey) < 1e-6 ? -1.1 : 0);
      ax.text(ex + dx, ey + dy, p, { fontsize: fs - 2.6, ha: 'center', va: 'center', color: '#7a1fa2' });
    }
  }
  ax.circle(fr0.cx, fr0.cy, 0.45, { fc: '#7a1fa2', ec: 'none', z: 9 });
}

function sheetStructure(plan, project, fs = 8) {
  const [sh, fr] = sheetFrame('COLUMN & BEAM LAYOUT', 'S-101', plan, project);
  const ax = planAxes(sh, plan.cfg, { pad: [10.5, 13.0, 7.0, 9.0] });
  ax.poly(wallsLoops(plan, []), { fc: '#d9d9d9', ec: '#b0b0b0', lw: 0.2, z: 2 });
  drawGrid(ax, plan, fs);
  const st = plan.struct, H2 = plan.cfg.ns_ft / 2;
  for (const b of st.beams) {
    if (b.skipped) continue;
    ax.plot([b.x0, b.x1], [b.y0, b.y1], { c: '#1f4e9c', lw: 1.0, ls: [0, [6, 2]], z: 6 });
    const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2, lab = `B${b.line}/${b.frm}-${b.to}  ${b.width_mm}x${b.depth_mm}`;
    if (b.dir === 'E-W') ax.text(mx, my + (my < H2 ? 0.6 : -0.6), lab, { fontsize: fs - 3, ha: 'center', va: my < H2 ? 'bottom' : 'top', color: '#1f4e9c' });
    else ax.text(mx + 0.6, my, lab, { fontsize: fs - 3, ha: 'left', va: 'center', rotation: 90, color: '#1f4e9c' });
  }
  drawColumns(ax, plan, fs, true);
  dimChain(ax, [0, ...st.xs, plan.cfg.ew_ft], -2.0, true, fs); dimChain(ax, [0, ...st.ys, plan.cfg.ns_ft], -9.0, false, fs);
  drawRoadNorth(ax, plan, fs);
  const cols = st.columns.map((c) => [c.id, c.kind, pyFixed(c.x, 2), pyFixed(c.y, 2), pyFixed(c.trib_m2, 1), pyFixed(c.Pu_kN, 0), `${c.size_mm[0]} x ${c.size_mm[1]}`]);
  table(fr, 22, 112, ['Col', 'Type', 'x (ft)', 'y (ft)', 'Trib m2', 'Pu kN', 'Size mm'], cols.slice(0, 14), [12, 16, 14, 14, 15, 14, 22], { fs: 5.6, title: 'COLUMN SCHEDULE (preliminary)' });
  const bms = st.beams.map((b) => [`${b.dir} ${b.line}`, `${b.frm}-${b.to}`, pyFixed(b.span_ft, 1), b.skipped ? '-' : `${b.width_mm} x ${b.depth_mm}`, b.long_span && !b.skipped ? 'LONG SPAN' : '']);
  table(fr, 140, 112, ['Line', 'Span', 'ft', 'Size mm', 'Flag'], bms.slice(0, 18), [16, 18, 10, 22, 20], { fs: 5.6, title: 'BEAM SCHEDULE (preliminary)' });
  fr.text(22, 14, `M${pyG(plan.cfg.fck)} / Fe${pyG(plan.cfg.fy)}; sizes from tributary area with ${plan.cfg.floors_above + 2} slabs, +25% moment allowance - ` +
    `RULE-OF-THUMB ONLY. Seismic Zone ${plan.cfg.seismic_zone || 'V'}: design and ductile detailing (IS 1893, IS 13920) by a licensed structural engineer; soil investigation required.`, { fontsize: 5.6, color: '#b00020' });
  return sh;
}

function sheetSchedules(plan, project, ops, fs = 8) {
  const [sh, fr] = sheetFrame('SCHEDULES', 'A-601', plan, project);
  const srow = new Map(plan.sector_rows.map((r) => [r.uid, r]));
  const rows = plan.rooms.map((r) => {
    const n = r.net, s = srow.get(r.uid);
    return [r.name, r.rtype, `${fi(rw(n))} x ${fi(rh(n))}`, pyFixed(rarea(n), 0), s && s.score !== null ? `${pyFixed(s.frac * 100, 0)}% / ${pyFixed(s.score, 0)}` : '-', s ? s.padas.slice(0, 46) : ''];
  });
  const tot = plan.rooms.reduce((a, r) => a + rarea(r.net), 0);
  rows.push(['TOTAL (carpet)', '', '', pyFixed(tot, 0), '', `built-up ${pyFixed(plan.cfg.ew_ft * plan.cfg.ns_ft, 0)} sq ft`]);
  table(fr, 22, 280, ['Room', 'Type', 'Clear size', 'Area sq ft', 'Vaastu % / score', 'Main padas'], rows, [34, 18, 30, 18, 26, 74], { fs: 6.2, title: 'ROOM SCHEDULE' });
  const count = (f) => { const m = new Map(); for (const o of ops.filter(f)) m.set(o.type, (m.get(o.type) || 0) + 1); return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); };
  const WT = windowTypes(plan);
  const drows = count((o) => o.kind === 'door' || o.kind === 'open').map(([k, v]) => [k, ...(DOOR_TYPES[k] || [k, '', '']), v]);
  const wrows = count((o) => o.kind === 'window').map(([k, v]) => [k, ...(WT[k] || [k, '', '']), v]);
  let y = table(fr, 230, 280, ['Tag', 'Type', 'Size (W x H)', 'Material / note', 'Nos'], drows, [12, 38, 30, 52, 10], { fs: 6.2, title: 'DOOR SCHEDULE' });
  y = table(fr, 230, y - 12, ['Tag', 'Type', 'Size (W x H)', 'Sill / note', 'Nos'], wrows, [12, 38, 30, 52, 10], { fs: 6.2, title: 'WINDOW SCHEDULE' });
  const S = designStair(plan.cfg);
  const srows = [['Floor-to-floor', `${pyFixed(S.height_in / 12, 2)} ft`], ['Risers', `${S.risers} @ ${pyFixed(S.riser_in, 2)}"`], ['Tread', `${pyG(S.tread_in)}"`],
    ['Flights', `${S.r1} + ${S.r2} risers (dog-leg)`], ['Flight width', fi(S.flight_w)], ['Block', `${fi(S.block_w)} x ${fi(S.block_l)}`], ['Direction', 'clockwise going up']];
  table(fr, 230, y - 12, ['Staircase', ''], srows, [40, 102], { fs: 6.2, title: 'STAIRCASE DATA' });
  return sh;
}

export function projectInfo(plan, project = {}) {
  const today = new Date(), pad = (v) => String(v).padStart(2, '0');
  return { name: 'Residence', site: plan.cfg.location, plan_label: `${plan.source || 'generated'} #${plan.id}`,
    date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`, rev: 'P1', ...project };
}

/** The four A3 sheets for `plan` (an analysed plan from analysePlan). */
export function drawingSet(plan, project = {}) {
  const pj = projectInfo(plan, project), ops = plan.openings;
  return [sheetFloorPlan(plan, pj, ops), sheetVaastu(plan, pj, ops), sheetStructure(plan, pj), sheetSchedules(plan, pj, ops)];
}

/** Plan-only view (for the editor, thumbnails and the catalogue): no frame, true proportions, optional colours. */
export function planSheet(plan, { fs = 8, scale = 75, furniture = true, dims = true, tint = false, labels = true, tags = true, grid = true, north = true, columns = true, sectors = false, pad = [10.5, 13.0, 10.5, 9.0] } = {}) {
  const ftmm = 304.8 / scale, W = plan.cfg.ew_ft, H = plan.cfg.ns_ft;
  const wmm = (W + pad[0] + pad[1]) * ftmm, hmm = (H + pad[2] + pad[3]) * ftmm;
  const sh = new Sheet({ w: wmm, h: hmm, name: 'plan' });
  const ax = sh.view({ s: ftmm, x0: -pad[0], y0: -pad[2], ox: 0, oy: 0 });
  ax.xlim = [-pad[0], W + pad[1]]; ax.ylim = [-pad[2], H + pad[3]];
  if (tint) for (const r of plan.rooms) { const n = r.net; ax.rect(n.x0, n.y0, rw(n), rh(n), { fc: ROOM_COLORS[r.rtype] || '#eeeeee', ec: 'none', z: 0.8 }); }
  if (grid) drawGrid(ax, plan, fs);
  drawBasePlan(ax, plan, fs, plan.openings, { tags });
  if (columns) drawColumns(ax, plan, fs, false);
  if (furniture) drawFurniture(ax, plan, fs);
  if (sectors) drawSectorLines(ax, plan, fs);
  if (dims) drawDimensions(ax, plan, fs, plan.openings);
  if (labels) drawRoomLabels(ax, plan, fs, { furnished: furniture, ops: plan.openings, sector: sectors, detail: !sectors });
  if (north) drawRoadNorth(ax, plan, fs);
  return { sheet: sh, map: { s: ftmm, x0: -pad[0], y0: -pad[2] }, size: [wmm, hmm] };
}
