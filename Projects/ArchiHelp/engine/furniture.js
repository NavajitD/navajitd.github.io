// Vaastu Planner design engine — doors + furniture planned together, room by room (port of the notebook's section 6b).
// For every door that swings INTO a room the planner tries the legal positions on the shared wall (near either corner or
// centred) and both hinge sides, lays out the room's furniture for each, and keeps the best combination. Doors swinging out of
// a room, openings and stair arrivals are fixed obstacles with a clear zone in front. Windows are placed afterwards.
//
// Per-room overrides (plan.furnitureSpec[uid]):
//   bedHead 'S'|'N'|'E'|'W'      force the bed-head wall          wardrobeSide          force the wardrobe wall
//   sofaSide                      force the sofa wall (hall)       mode 'auto'|'manual'  manual = use `items` exactly
//   items [{kind, rect, ...}]     in auto mode: fixed extras (e.g. a wash basin) kept clear, the planner fills the rest
import { rect, rw, rh, rarea, rcx, rcy, sharedEdge, arange, product, EPS } from './geom.js';
import { CIRC, BED_HEAD_PREF, SIDES, REQUIRED_FURNITURE } from './config.js';
import { touchesRoad } from './plan.js';
import { resolveWindows } from './windows.js';

export function wallRect(n, side, a, b, d) {
  if (side === 'S') return rect(a, n.y0, b, n.y0 + d);
  if (side === 'N') return rect(a, n.y1 - d, b, n.y1);
  if (side === 'W') return rect(n.x0, a, n.x0 + d, b);
  return rect(n.x1 - d, a, n.x1, b);
}
export const span = (n, side) => (side === 'S' || side === 'N' ? [n.x0, n.x1] : [n.y0, n.y1]);
export const depth = (n, side) => (side === 'S' || side === 'N' ? rh(n) : rw(n));
export const opp = (s) => ({ S: 'N', N: 'S', W: 'E', E: 'W' })[s];
export function hit(r, obst, tol = 0.02) {
  for (const o of obst) if (Math.min(r.x1, o.x1) - Math.max(r.x0, o.x0) > tol && Math.min(r.y1, o.y1) - Math.max(r.y0, o.y0) > tol) return true;
  return false;
}
export const inside = (r, n, tol = 1e-6) => r.x0 >= n.x0 - tol && r.y0 >= n.y0 - tol && r.x1 <= n.x1 + tol && r.y1 <= n.y1 + tol;
export function sideOf(room, seg) {
  const [[x0, y0], [x1, y1]] = seg, t = room.tile;
  if (Math.abs(y0 - y1) < 1e-6) return Math.abs(y0 - t.y0) < 1e-3 ? 'S' : 'N';
  return Math.abs(x0 - t.x0) < 1e-3 ? 'W' : 'E';
}
export const zone = (n, side, lo, hi, d) => wallRect(n, side, lo, hi, Math.min(d, depth(n, side)));
export const mkItem = (kind, r, label = '', tall = false, side = '', meta = {}) => ({ kind, rect: r, label, tall, side, meta });
const BED_OFFSETS = [0.0]; for (let k = 1; k < 20; k++) BED_OFFSETS.push(k * 0.5, -k * 0.5);

/** Door centre positions on the shared wall (near either corner / centred) with the hinge at the nearer corner. */
export function doorCandidates(room, other, seg, w, cols) {
  const side = sideOf(room, seg), [[x0, y0], [x1, y1]] = seg, horiz = side === 'S' || side === 'N';
  let lo = horiz ? Math.min(x0, x1) : Math.min(y0, y1), hi = horiz ? Math.max(x0, x1) : Math.max(y0, y1);
  for (const r of [room, other]) if (r) { const [a, b] = span(r.net, side); lo = Math.max(lo, a); hi = Math.min(hi, b); }
  lo += 0.15; hi -= 0.15;
  const blk = [], cAt = horiz ? y0 : x0;
  for (const c of cols) if (Math.abs((horiz ? c.y : c.x) - cAt) < 1.0) {
    const half = Math.max(...c.size_mm) / 304.8 / 2, cc = horiz ? c.x : c.y;
    blk.push([cc - half - 0.15, cc + half + 0.15]);
  }
  const out = [];
  if (hi - lo < w - 1e-6) return out;
  for (const [p, hinge] of [[lo + w / 2, 'lo'], [hi - w / 2, 'hi'], [(lo + hi) / 2, 'lo'], [(lo + hi) / 2, 'hi']]) {
    if (blk.some(([a, b]) => p + w / 2 > a && p - w / 2 < b)) continue;
    if (out.every(([q, h]) => Math.abs(p - q) > 0.05 || h !== hinge)) out.push([p, hinge, side]);
  }
  return out;
}

// ---------------- room planners: return [score, items] or null ----------------
function planBedroom(room, obst, ext, master, o) {
  const n = room.net, F = o.F, C = o.C; let best = null;
  const beds = master ? [F.queen, F.double] : [F.double, F.single];
  beds.forEach(([bw, bl], bi) => {
    for (const head of (o.head ? [o.head] : SIDES)) {
      const D = depth(n, head), [a, b] = span(n, head);
      if (bl + C.bed_foot > D + 1e-6) continue;
      const mid = (a + b) / 2;
      for (const off of BED_OFFSETS) {
        const c0 = mid + off - bw / 2, c1 = c0 + bw;
        if (c0 < a - 1e-6 || c1 > b + 1e-6) continue;
        const bed = wallRect(n, head, c0, c1, bl);
        if (hit(bed, obst)) continue;
        const gl = c0 - a, gr = b - c1;
        if (Math.max(gl, gr) < C.bed_side - 1e-6) continue;
        const items = [mkItem('bed', bed, 'BED', false, head, { head })];
        for (const [lo, hi] of [[c0 - 1.5, c0], [c1, c1 + 1.5]]) {
          const st = wallRect(n, head, lo, hi, 1.5);
          if (lo >= a - 1e-6 && hi <= b + 1e-6 && !hit(st, obst)) items.push(mkItem('side_table', st));
        }
        const taken = obst.concat(items.map((i) => i.rect), [wallRect(n, head, c0 - (gl >= C.bed_side ? C.bed_side : 0), c1 + (gr >= C.bed_side ? C.bed_side : 0), bl + C.bed_foot)]);
        let ward = null;
        const itemsObst = items.map((i) => i.rect).concat(obst), takenKeep = taken.concat(o.keep);
        outer: for (const L of F.wardrobe_lengths) {
          for (const side of (o.ward ? [o.ward] : SIDES)) {
            const [sa, sb] = span(n, side);
            if (ext.has(side) && L > 3.0 && (sb - sa) - L < 4.0) continue;      // leave >= 4 ft of a window wall free
            for (const p of arange(sa, sb - L + 1e-6, 0.25)) {
              const wr = wallRect(n, side, p, p + L, F.wardrobe_depth), front = wallRect(n, side, p, p + L, F.wardrobe_depth + C.wardrobe_front);
              if (inside(wr, n) && !hit(wr, takenKeep) && !hit(front, itemsObst)) { ward = mkItem('wardrobe', wr, 'WARDROBE', true, side); break outer; }
            }
          }
        }
        if (ward) items.push(ward);
        let score = BED_HEAD_PREF[head] * 2 + (ward ? 6 : 0) + (ward && rarea(ward.rect) >= 9.9 ? 2 : 0) + (ward ? Math.max(rw(ward.rect), rh(ward.rect)) : 0) + (gl >= 2 && gr >= 2 ? 1 : 0)
          - 0.05 * Math.abs(off) - 3 * bi + 0.5 * items.filter((i) => i.kind === 'side_table').length - (ext.has(head) ? 1 : 0);
        if (master && ward) {
          const ws = ward.side, [wlo, whi] = (ws === 'S' || ws === 'N') ? [ward.rect.x0, ward.rect.x1] : [ward.rect.y0, ward.rect.y1];
          const taken2 = taken.concat([ward.rect, wallRect(n, ws, wlo, whi, F.wardrobe_depth + C.wardrobe_front)]);
          study: for (const side of SIDES) {
            const [sa, sb] = span(n, side);
            for (const p of arange(sa, sb - F.study[0] + 1e-6, 0.25)) {
              const sd = wallRect(n, side, p, p + F.study[0], F.study[1]), fr = wallRect(n, side, p, p + F.study[0], F.study[1] + 2.0);
              if (!hit(sd, taken2) && !hit(fr, taken2)) { items.push(mkItem('study', sd, 'STUDY')); score += 1; break study; }
            }
          }
        }
        if (best === null || score > best[0]) best = [score, items];
        break;                                          // first legal offset (closest to centre) per head wall
      }
    }
  });
  return best;
}

function planBath(room, obst, ext, o) {
  const n = room.net, F = o.F, C = o.C, longX = rw(n) >= rh(n), Wd = Math.min(rw(n), rh(n));
  const walls = longX ? ['S', 'N'] : ['W', 'E'], ends = longX ? ['W', 'E'] : ['S', 'N'];
  const [lo, hi] = longX ? [n.x0, n.x1] : [n.y0, n.y1];
  let best = null;
  for (const se of ends) {
    const sh = F.bath_shower, [sa, sb] = longX ? [n.y0, n.y1] : [n.x0, n.x1];
    const shower = wallRect(n, se, sa, sb, sh);
    if (hit(shower, obst)) continue;
    const hiEnd = se === 'E' || se === 'N';
    const [rlo, rhi] = hiEnd ? [lo, hi - sh] : [lo + sh, hi];
    for (const wcWall of walls) {
      const [wcw, wcd] = F.bath_wc;
      if (wcd + C.wc_front > Wd + 0.3) continue;
      const wcp = hiEnd ? rhi - wcw : rlo;
      const wc = wallRect(n, wcWall, wcp, wcp + wcw, wcd);
      if (hit(wc, obst)) continue;
      for (const bsWall of walls) {
        const [bw, bd] = F.bath_basin;
        for (const bp of (hiEnd ? [rlo, rhi - bw] : [rhi - bw, rlo])) {
          const basin = wallRect(n, bsWall, bp, bp + bw, bd);
          if (hit(basin, obst.concat([wc])) || !inside(basin, n)) continue;
          const score = 2 + (bsWall !== wcWall ? 1 : 0);
          const items = [mkItem('shower', shower, 'SHOWER'), mkItem('wc', wc, 'WC', false, wcWall), mkItem('basin', basin, '', false, bsWall)];
          if (best === null || score > best[0]) best = [score, items];
        }
      }
    }
  }
  return best;
}

function planKitchen(room, obst, ext, o) {
  const n = room.net, F = o.F, C = o.C, d = F.counter_depth; let best = null;
  for (const main of ['E', 'S', 'N', 'W']) {                 // cooking counter on the east wall preferred (cook faces east)
    const [a, b] = span(n, main);
    for (const legside of [null, ...SIDES.filter((s) => s !== main && s !== opp(main))]) {
      const runs = []; let p = a;
      for (const q of arange(a, b + 1e-6, 0.25)) if (hit(wallRect(n, main, q, Math.min(q + 0.25, b), d), obst)) { runs.push([p, q]); p = q + 0.25; }
      runs.push([p, b]);
      let r0 = runs[0][0], r1 = runs[0][1];
      for (const [x, y] of runs) if (y - x > r1 - r0) { r0 = x; r1 = y; }
      if (r1 - r0 < 4.0) continue;
      const items = [mkItem('counter', wallRect(n, main, r0, r1, d), '', false, main, { hob: true, hob_end: (main === 'E' || main === 'W') ? 'lo' : null })];
      if (legside) {
        const [la, lb] = span(n, legside), ll = Math.min((lb - la) - d - C.aisle + 0.6, (lb - la) * 0.6);
        if (ll < 2.5) continue;
        const [l0, l1] = (main === 'E' || main === 'N') ? [lb - d - ll, lb - d] : [la + d, la + d + ll];
        const leg = wallRect(n, legside, l0, l1, d);
        if (hit(leg, obst) || !inside(leg, n)) continue;
        items.push(mkItem('counter', leg, '', false, legside, { sink: true }));
      }
      if (!(depth(n, main) >= d + C.aisle - 0.6)) continue;
      const taken = obst.concat(items.map((i) => i.rect), o.keep);
      let fr = null;
      fridge: for (const side of ['W', 'S', 'N', 'E']) {     // Vaastu: fridge in the west / south-west of the kitchen
        const [sa, sb] = span(n, side), fw = F.fridge[0];
        for (const q of [sa, sb - fw, ...arange(sa + 0.25, sb - fw, 0.25)]) {
          const f = wallRect(n, side, q, q + fw, F.fridge[1]);
          if (inside(f, n) && !hit(f, taken)) { fr = mkItem('fridge', f, 'F', true, side); break fridge; }
        }
      }
      if (fr) items.push(fr);
      if (!legside) items[0].meta.sink = true;
      const score = (main === 'E' ? 4 : 0) + (legside ? 2 : 0) + (fr ? 2 : 0) + (r1 - r0) * 0.1;
      if (best === null || score > best[0]) best = [score, items];
    }
  }
  return best;
}

function planPuja(room, obst, ext, o) {
  const n = room.net; let best = null;
  for (const [side, pref] of [['E', 3], ['W', 1], ['N', 1], ['S', 0]]) {
    const [a, b] = span(n, side), w = Math.min(b - a - 0.3, 4.0);
    if (w < 2.0) continue;
    for (const p of [(a + b) / 2 - w / 2, a + 0.15, b - 0.15 - w]) {
      const al = wallRect(n, side, p, p + w, o.F.altar_depth);
      if (hit(al, obst) || !inside(al, n)) continue;
      if (best === null || pref > best[0]) best = [pref, [mkItem('altar', al, 'ALTAR', false, side)]];
      break;
    }
  }
  return best;
}

function planDining(room, obst, ext, o) {
  const n = room.net, ch = o.F.chair; let best = null;
  const ncx = rcx(n), ncy = rcy(n);
  for (const [tw, td, seats] of o.F.dining) {
    for (const rot of [0, 1]) {
      const [w, h] = rot === 0 ? [tw, td] : [td, tw];
      const [zw, zh] = w >= h ? [w + 0.5, h + 2 * ch + 0.2] : [w + 2 * ch + 0.2, h + 0.5];
      if (zw > rw(n) + 1e-6 || zh > rh(n) + 1e-6) continue;
      const pys = arange(n.y0, n.y1 - zh + 1e-6, 0.25);
      for (const px of arange(n.x0, n.x1 - zw + 1e-6, 0.25)) for (const py of pys) {
        const z = rect(px, py, px + zw, py + zh);
        if (hit(z, obst)) continue;
        const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
        const score = seats * 10 - Math.abs(cx - ncx) - Math.abs(cy - ncy);
        if (best === null || score > best[0]) best = [score, [mkItem('dining_table', rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), `${seats}-SEATER`, false, '', { seats, rot })]];
      }
    }
    if (best) break;
  }
  return best;
}

function cropFromWall(r, n, side, d0) {
  if (side === 'S') return rect(r.x0, n.y0 + d0, r.x1, r.y1);
  if (side === 'N') return rect(r.x0, r.y0, r.x1, n.y1 - d0);
  if (side === 'W') return rect(n.x0 + d0, r.y0, r.x1, r.y1);
  return rect(r.x0, r.y0, n.x1 - d0, r.y1);
}

function planHall(room, obst, ext, o) {
  const n = room.net, F = o.F; let best = null;
  for (const [sw, sd] of F.sofa) {
    for (const side of (o.sofaSide ? [o.sofaSide] : SIDES)) {
      const [a, b] = span(n, side), D = depth(n, side), need = sd + 1.5 + F.coffee[1] + 1.5;
      if (D < need || b - a < sw) continue;
      for (const p of arange(a, b - sw + 1e-6, 0.25)) {
        const sofa = wallRect(n, side, p, p + sw, sd);
        if (hit(sofa, obst)) continue;
        const cfp = p + (sw - F.coffee[0]) / 2;
        const ct = cropFromWall(wallRect(n, side, cfp, cfp + F.coffee[0], sd + 1.5 + F.coffee[1]), n, side, sd + 1.5);
        if (hit(ct, obst)) continue;
        const items = [mkItem('sofa', sofa, 'SOFA', false, side), mkItem('coffee', ct, '')];
        let score = sw * 2 - Math.abs((p + sw / 2) - (a + b) / 2) * 0.1 - (ext.has(side) ? 1 : 0);
        const tvside = opp(side), [ta, tb] = span(n, tvside), tw = F.tv_unit[0], c0 = p + (sw - tw) / 2;
        if (D >= sd + 1.5 + F.coffee[1] + 1.0 + F.tv_unit[1]) {
          const offs = arange(-sw, sw + 0.01, 0.25).map((v, i) => [v, i]).sort((x, y) => Math.abs(x[0]) - Math.abs(y[0]) || x[1] - y[1]).map((t) => t[0]);
          const ok = obst.concat(o.keep);
          for (const off of offs) {
            const tp = c0 + off;
            if (tp < ta || tp + tw > tb) continue;
            const tv = wallRect(n, tvside, tp, tp + tw, F.tv_unit[1]);
            if (!hit(tv, ok)) { items.push(mkItem('tv', tv, 'TV UNIT', true, tvside)); score += 3 - 0.2 * Math.abs(off); break; }
          }
        }
        if (best === null || score > best[0]) best = [score, items];
      }
    }
    if (best) break;
  }
  return best;
}

function planCourt(room, obst, ext, o) {
  const n = room.net, s = o.F.planter, items = [];
  for (const [cx, cy] of [[n.x0, n.y0], [n.x1 - s, n.y0], [n.x0, n.y1 - s], [n.x1 - s, n.y1 - s]]) {
    const r = rect(cx, cy, cx + s, cy + s);
    if (!hit(r, obst)) items.push(mkItem('planter', r, ''));
  }
  return [items.length, items];
}

/** Manual layout: the user's items, exactly. Score 10, minus 5 per item that hits a door swing / clear zone. */
const SOFT_KINDS = new Set(['wash_area', 'zone', 'rug']);
function planManual(room, obst, ext, o) {
  const items = o.items.map(cloneItem);
  const bad = items.filter((i) => !SOFT_KINDS.has(i.kind) && hit(i.rect, obst)).length;
  return [10 - 5 * bad, items];
}

export function cloneItem(i) { return { kind: i.kind, rect: { ...i.rect }, label: i.label || '', tall: !!i.tall, side: i.side || '', meta: { ...(i.meta || {}) } }; }
export const TALL_KINDS = new Set(['wardrobe', 'fridge', 'tv', 'bookshelf', 'cabinet']);

const PLANNERS = {
  bath: planBath, puja: planPuja, kitchen: planKitchen,
  master: (r, ob, e, o) => planBedroom(r, ob, e, true, o), bedroom: (r, ob, e, o) => planBedroom(r, ob, e, false, o),
  dining: planDining, hall: planHall, court: planCourt,
};
const ORDER = ['bath', 'puja', 'kitchen', 'master', 'bedroom', 'dining', 'hall', 'court', 'lobby'];

/** Front clearance of fixed (auto-mode extra) items: kept clear by the planner. */
function fixedObstacles(n, items) {
  const out = [];
  for (const it of items) {
    out.push(it.rect);
    const s = it.side;
    if (s && !SOFT_KINDS.has(it.kind)) {
      const [lo, hi] = (s === 'S' || s === 'N') ? [it.rect.x0, it.rect.x1] : [it.rect.y0, it.rect.y1];
      const d = (s === 'S' || s === 'N') ? rh(it.rect) : rw(it.rect);
      out.push(wallRect(n, s, lo, hi, d + (it.meta && it.meta.clear !== undefined ? it.meta.clear : 2.0)));
    }
  }
  return out;
}

/** Fills plan.door_plan {link index: [pos, hinge, side-of-into-room, width]}, plan.furniture {uid: [item]}, plan.links_all. */
export function planDoorsAndFurniture(plan) {
  const rooms = new Map(plan.rooms.map((r) => [r.uid, r])), cols = plan.struct.columns, cfg = plan.cfg, R = plan.region, F = cfg.furn, C = cfg.clear;
  const courts = plan.rooms.filter((r) => r.rtype === 'court');
  const extSides = (r) => {
    const t = r.tile, s = new Set();
    if (Math.abs(t.y0 - R.y0) < EPS) s.add('S');
    if (Math.abs(t.y1 - R.y1) < EPS) s.add('N');
    if (Math.abs(t.x0 - R.x0) < EPS) s.add('W');
    if (Math.abs(t.x1 - R.x1) < EPS) s.add('E');
    for (const c of courts) { const [L, sg] = sharedEdge(t, c.tile); if (L >= 2.5) s.add(sideOf(r, sg)); }
    return s;
  };
  const links = plan.links.slice();
  const road = plan.rooms.filter((r) => touchesRoad(r.tile, R, cfg.road_side) && (CIRC.has(r.rtype) || r.rtype === 'hall'))
    .map((r, i) => [r, i]).sort((x, y) => (x[0].rtype !== 'hall') - (y[0].rtype !== 'hall') || x[1] - y[1]).map((t) => t[0]);
  if (road.length && plan.road_door) {
    const r = road[0], t = r.tile, s = cfg.road_side;
    const seg = s === 'E' ? [[t.x1, t.y0], [t.x1, t.y1]] : s === 'W' ? [[t.x0, t.y0], [t.x0, t.y1]] : s === 'N' ? [[t.x0, t.y1], [t.x1, t.y1]] : [[t.x0, t.y0], [t.x1, t.y0]];
    links.push({ a: null, b: r.uid, kind: 'door', into: r.uid, seg, entrance: true, hint: plan.meta && plan.meta.entranceHint ? { ...plan.meta.entranceHint } : undefined });
  }
  plan.links_all = links;
  const plannedOpen = (l) => l.kind === 'open' && rooms.get(l.into).rtype === 'kitchen';
  const width = (l) => {
    if (l.hint && l.hint.w && l.kind === 'door') return l.hint.w;
    if (l.entrance || plannedOpen(l)) return 3.5;
    const ts = [rooms.get(l.b).rtype, l.a !== null ? rooms.get(l.a).rtype : ''];
    return ts.includes('bath') || ts.includes('puja') ? 2.5 : 3.0;
  };
  const fixed = new Map(plan.rooms.map((r) => [r.uid, []]));
  const doorPlan = new Map(), furniture = {};
  // openings (no shutter), "no wall" joins and stair arrivals: centred, clear zone on both sides
  links.forEach((l, k) => {
    if (!(l.kind === 'open' || l.kind === 'nowall') || plannedOpen(l)) return;
    const [[x0, y0], [x1, y1]] = l.seg, L = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    let w = l.kind === 'nowall' ? L : Math.max(2.5, Math.min(4.5, L - 0.8));
    const horiz = Math.abs(y0 - y1) < 1e-6; let p = horiz ? (x0 + x1) / 2 : (y0 + y1) / 2;
    if (l.hint) {
      const h = l.hint; w = h.w ?? w;
      let lo = horiz ? Math.min(x0, x1) : Math.min(y0, y1), hi = horiz ? Math.max(x0, x1) : Math.max(y0, y1);
      for (const u of [l.a, l.b]) { const ru = rooms.get(u), [a, b] = span(ru.net, sideOf(ru, l.seg)); lo = Math.max(lo, a); hi = Math.min(hi, b); }
      p = h.end === 'hi' ? hi - w / 2 : lo + (h.at ?? 0.0) + w / 2;
    }
    doorPlan.set(k, [p, 'lo', null, w]);
    for (const u of [l.a, l.b]) { const r = rooms.get(u), sd = sideOf(r, l.seg); fixed.get(u).push(zone(r.net, sd, p - w / 2, p + w / 2, C.opening)); }
  });
  const hintPos = (r, l) => {
    const sd = sideOf(r, l.seg), [[x0, y0], [x1, y1]] = l.seg, hz = sd === 'S' || sd === 'N';
    const lo = Math.max(hz ? Math.min(x0, x1) : Math.min(y0, y1), span(r.net, sd)[0]);
    return [lo + l.hint.at + width(l) / 2, l.hint.hinge || 'lo', sd];
  };
  links.forEach((l, k) => {
    if (l.kind === 'door' && l.hint && l.hint.at !== undefined && l.a !== null) {
      const r = rooms.get(l.into), o = l.a !== r.uid ? rooms.get(l.a) : rooms.get(l.b), w = width(l);
      const [p] = hintPos(r, l);
      fixed.get(o.uid).push(zone(o.net, sideOf(o, l.seg), p - w / 2, p + w / 2, C.door_access));
    }
  });
  const win = plan.windowsResolved || resolveWindows(plan);
  plan.windowsResolved = win;
  const spec = plan.furnitureSpec || {};
  for (const typ of ORDER) {
    for (const r of plan.rooms.filter((x) => x.rtype === typ)) {
      const fs = spec[r.uid] || {};
      const keep = (win.keepouts[r.uid] || []).concat((plan.keepouts || []).filter((k) => k.room === r.uid).map((k) => k.rect));
      const opt = { F, C, keep, head: fs.bedHead || null, ward: fs.wardrobeSide || null, sofaSide: fs.sofaSide || null, items: fs.items || [] };
      const manual = fs.mode === 'manual';
      const extras = !manual && opt.items.length ? opt.items.map(cloneItem) : [];
      const mine = [];
      links.forEach((l, k) => { if ((l.kind === 'door' || plannedOpen(l)) && l.into === r.uid && !doorPlan.has(k)) mine.push([k, l]); });
      const cands = mine.map(([k, l]) => {
        const other = l.a !== null && l.a !== r.uid ? rooms.get(l.a) : (l.b !== r.uid ? rooms.get(l.b) : null);
        let cs = doorCandidates(r, other, l.seg, width(l), cols);
        if (!cs.length) { const c2 = doorCandidates(r, null, l.seg, width(l), []); cs = [c2.length ? c2[0] : [null, 'lo', sideOf(r, l.seg)]]; }
        if (l.hint && l.hint.at !== undefined) cs = [hintPos(r, l)];
        return cs.map((c) => [k, c]);
      });
      let best = null;
      const fn = manual ? planManual : PLANNERS[typ];
      for (const combo of (cands.length ? product(cands) : [[]])) {
        const obst = fixed.get(r.uid).slice(); let bad = false;
        for (const [k, [p, , side]] of combo) {
          if (p === null) { bad = true; break; }
          const w = width(links[k]);
          obst.push(zone(r.net, side, p - w / 2, p + w / 2, links[k].kind === 'open' ? C.door_access : w));
        }
        if (bad) continue;
        let res;
        if (!fn) res = [0, []];
        else if (extras.length) {
          if (extras.some((it) => !SOFT_KINDS.has(it.kind) && hit(it.rect, obst))) res = null;
          else { const r2 = fn(r, obst.concat(fixedObstacles(r.net, extras)), extSides(r), opt); res = r2 ? [r2[0], r2[1].concat(extras)] : null; }
        } else res = fn(r, obst, extSides(r), opt);
        const sc = res ? res[0] : -100;
        if (best === null || sc > best[0]) best = [sc, combo, res ? res[1] : []];
      }
      if (best === null) continue;
      furniture[r.uid] = best[2];
      for (const [k, [p, hinge, side]] of best[1]) {
        const w = width(links[k]), l = links[k]; doorPlan.set(k, [p, hinge, side, w]);
        if (l.a !== null) {
          const o = l.a !== r.uid ? rooms.get(l.a) : rooms.get(l.b);
          fixed.get(o.uid).push(zone(o.net, sideOf(o, l.seg), p - w / 2, p + w / 2, C.door_access));
        }
      }
    }
  }
  // doors into rooms without a planner (stair, passage, veranda, suite): centred
  links.forEach((l, k) => {
    if (doorPlan.has(k) || l.kind !== 'door') return;
    const r = rooms.get(l.into);
    let cs = doorCandidates(r, null, l.seg, width(l), cols);
    if (l.hint && l.hint.at !== undefined) cs = [hintPos(r, l)];
    if (cs.length) { const [p, h, s] = cs.length > 2 ? cs[2] : cs[0]; doorPlan.set(k, [p, h, s, width(l)]); }
  });
  // rooms that are not in ORDER but have manual items (e.g. a veranda planter) keep them
  for (const r of plan.rooms) if (!(r.uid in furniture) && spec[r.uid] && (spec[r.uid].items || []).length) furniture[r.uid] = spec[r.uid].items.map(cloneItem);
  plan.door_plan = doorPlan; plan.furniture = furniture;
  return plan;
}

/** Rooms whose required furniture could not be placed (with doors and clearances respected). */
export function furnitureGaps(plan) {
  const gaps = [];
  for (const r of plan.rooms) {
    const need = REQUIRED_FURNITURE[r.rtype] || [], have = new Set((plan.furniture[r.uid] || []).map((i) => i.kind));
    const miss = need.filter((k) => !have.has(k));
    if (miss.length) gaps.push(`${r.name}: no ${miss.join(', ')}`);
  }
  return gaps;
}

/** Furniture that collides with a door swing / clear zone or leaves its room (for manual layouts). */
export function furnitureClashes(plan) {
  const out = [];
  for (const r of plan.rooms) {
    const items = plan.furniture[r.uid] || [];
    for (const it of items) {
      if (SOFT_KINDS.has(it.kind)) continue;
      if (!inside(it.rect, r.net, 0.02)) out.push(`${r.name}: ${it.kind.replace('_', ' ')} leaves the room`);
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (SOFT_KINDS.has(a.kind) || SOFT_KINDS.has(b.kind)) continue;
      if (a.kind === 'coffee' || b.kind === 'coffee') continue;
      if (hit(a.rect, [b.rect], 0.05)) out.push(`${r.name}: ${a.kind.replace('_', ' ')} overlaps ${b.kind.replace('_', ' ')}`);
    }
  }
  return out;
}
