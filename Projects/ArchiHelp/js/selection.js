// ArchiHelp — several things selected at once on the plan (Shift-click, or Ctrl-click / ⌘-click on a Mac) and the
// edits that act on all of them: move together (drag or arrow keys), delete, rotate. No DOM here, so the unit tests
// run it on the example plan.
//
// A selection is one of
//   {t:'room', uid} {t:'wall', ref:[uid, edge]} {t:'link', a, b} | {t:'link', entrance:true} {t:'window', room, side}
//   {t:'item', uid, i} {t:'keepout', i}
import * as E from '../engine/edits.js';
import { analysePlan } from '../engine/index.js';
import { rw, rh } from '../engine/geom.js';
import { snapToWalls, AUTO_TYPES } from './palette.js';

export const roomOf = (plan, uid) => plan.rooms.find((r) => r.uid === uid) || null;
/** Which wall of room r a window opening o sits on. */
export function windowSide(o, r) {
  return o.horiz ? (Math.abs(o.y - r.tile.y0) < Math.abs(o.y - r.tile.y1) ? 'S' : 'N') : (Math.abs(o.x - r.tile.x0) < Math.abs(o.x - r.tile.x1) ? 'W' : 'E');
}
export const windowsOn = (plan, room, side) => { const r = roomOf(plan, room); return r ? plan.openings.filter((o) => o.kind === 'window' && o.into === room && windowSide(o, r) === side) : []; };
export const linkIndex = (plan, sl) => plan.links_all.findIndex((l) => (sl.entrance ? !!l.entrance : !l.entrance && ((l.a === sl.a && l.b === sl.b) || (l.a === sl.b && l.b === sl.a))));
export const wallOf = (doc, cfg, sl, comps = null) => (comps || E.wallComponents(doc, cfg)).find((c) => c.closed && c.rooms.some(([u, e]) => u === sl.ref[0] && e === sl.ref[1])) || null;

/** Same thing selected twice? Doors match either way round; a wall matches through any room edge along it (comps). */
export function sameSel(a, b, comps = null) {
  if (!a || !b || a.t !== b.t) return false;
  switch (a.t) {
    case 'room': return a.uid === b.uid;
    case 'item': return a.uid === b.uid && a.i === b.i;
    case 'keepout': return a.i === b.i;
    case 'window': return a.room === b.room && a.side === b.side;
    case 'link': return !!a.entrance === !!b.entrance && (!!a.entrance || (a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a));
    case 'wall': {
      if (a.ref[0] === b.ref[0] && a.ref[1] === b.ref[1]) return true;
      const w = comps && comps.find((c) => c.rooms.some(([u, e]) => u === a.ref[0] && e === a.ref[1]));
      return !!w && w.rooms.some(([u, e]) => u === b.ref[0] && e === b.ref[1]);
    }
    default: return JSON.stringify(a) === JSON.stringify(b);          // tool hovers ('pair', 'outer')
  }
}
/** Add x to the selection, or take it out if it is already there. Order = the order things were picked. */
export function toggleSel(list, x, comps = null) {
  const i = list.findIndex((s) => sameSel(s, x, comps));
  return i >= 0 ? list.filter((_, j) => j !== i) : [...list, x];
}
export function validSel(doc, plan, cfg, sl, comps = null) {
  switch (sl && sl.t) {
    case 'room': return !!roomOf(plan, sl.uid);
    case 'wall': return !!wallOf(doc, cfg, sl, comps);
    case 'link': return linkIndex(plan, sl) >= 0;
    case 'window': return !!roomOf(plan, sl.room);
    case 'item': return !!(plan.furniture[sl.uid] && plan.furniture[sl.uid][sl.i]);
    case 'keepout': return !!(doc.keepouts || [])[sl.i];
    default: return false;
  }
}

const NAMES = { room: ['room', 'rooms'], wall: ['wall', 'walls'], link: ['door or opening', 'doors and openings'], window: ['window', 'windows'],
  item: ['piece of furniture', 'pieces of furniture'], keepout: ['keep-out zone', 'keep-out zones'] };
/** "2 rooms · 1 window" */
export function countText(list) {
  const n = {};
  for (const s of list) n[s.t] = (n[s.t] || 0) + 1;
  return Object.keys(NAMES).filter((t) => n[t]).map((t) => `${n[t]} ${NAMES[t][n[t] === 1 ? 0 : 1]}`).join(' · ');
}
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ------------------------------------------------------------------------------------------------ hand layouts
/** Furniture of a room the planner arranges: changing one piece turns the room into a hand layout first. */
export function needsHandLayout(doc, plan, uid) {
  const r = roomOf(plan, uid), fs = (doc.furniture || {})[uid];
  return !!r && AUTO_TYPES.has(r.rtype) && (!fs || fs.mode !== 'manual');
}
/** Hand layout from the planner's: items copied, and the doors into the room pinned where they are. */
export function toHandLayout(doc, plan, uid) {
  let d = E.furnitureToManual(doc, plan, uid);
  plan.links_all.forEach((l, k) => {
    if (l.into !== uid || !plan.door_plan.has(k) || l.kind === 'nowall') return;
    if (l.kind === 'open' && roomOf(plan, l.into).rtype !== 'kitchen') return;
    const pinned = l.entrance ? !!(doc.meta && doc.meta.entranceHint) : !!(l.hint && l.hint.at !== undefined);
    if (!pinned) d = E.placeLink(d, plan, k, { clamp: false });
  });
  return d;
}
function handLayouts(doc0, plan, list) {
  let doc = doc0;
  for (const uid of new Set(list.filter((s) => s.t === 'item').map((s) => s.uid))) if (needsHandLayout(doc0, plan, uid)) doc = toHandLayout(doc, plan, uid);
  return doc;
}

// ------------------------------------------------------------------------------------------------ moving together
const shift = (r, dx, dy) => ({ x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy });
const span = (lo, hi) => [Math.min(0, lo), Math.max(0, hi)];          // standing still is always allowed

/**
 * How each selected thing moves when the selection moves by (dx, dy) ft: furniture and keep-out zones stay inside
 * their room, doors and windows slide along their wall, walls move across their own line; rooms stay put.
 * Returns the doc to move from (rooms whose planner furniture is selected become hand layouts) and one mover per thing
 * with its allowed range rx / ry (only on the axes it uses).
 */
export function groupMovers(cfg, doc0, plan, list) {
  const doc = handLayouts(doc0, plan, list), comps = E.wallComponents(doc0, cfg), movers = [];
  const seen = new Set(), once = (key) => (seen.has(key) ? false : (seen.add(key), true));
  for (const s of list) {
    if (s.t === 'item') {
      const it = (((doc.furniture || {})[s.uid] || {}).items || [])[s.i], r = roomOf(plan, s.uid);
      if (!it || !r || !once(`i${s.uid}:${s.i}`)) continue;
      const r0 = { ...it.rect }, n = r.net;
      movers.push({ s, kind: 'item', net: n, rect0: r0, rx: span(n.x0 - r0.x0, n.x1 - r0.x1), ry: span(n.y0 - r0.y0, n.y1 - r0.y1),
        apply: (d, dx, dy) => E.updateItem(d, s.uid, s.i, { rect: shift(r0, dx, dy) }) });
    } else if (s.t === 'keepout') {
      const k = (doc.keepouts || [])[s.i], r = k && roomOf(plan, k.room);
      if (!r || !once(`k${s.i}`)) continue;
      const r0 = { ...k.rect }, n = r.net;
      movers.push({ s, kind: 'keepout', rx: span(n.x0 - r0.x0, n.x1 - r0.x1), ry: span(n.y0 - r0.y0, n.y1 - r0.y1),
        apply: (d, dx, dy) => E.setKeepout(d, s.i, shift(r0, dx, dy)) });
    } else if (s.t === 'link') {
      const k = linkIndex(plan, s), l = plan.links_all[k], dp = k >= 0 ? plan.door_plan.get(k) : null;
      if (!l || l.kind === 'nowall' || !dp || !once(`l${k}`)) continue;
      const iv = E.linkInterval(plan, k), w = dp[3], c0 = dp[0];
      movers.push({ s, kind: 'link', [iv.horiz ? 'rx' : 'ry']: span(iv.lo + w / 2 - c0, iv.hi - w / 2 - c0),
        apply: (d, dx, dy) => E.placeLink(d, plan, k, { p: c0 + (iv.horiz ? dx : dy) }) });
    } else if (s.t === 'window') {
      const r = roomOf(plan, s.room), o = windowsOn(plan, s.room, s.side)[0];
      if (!r || !o || !once(`w${s.room}:${s.side}`)) continue;
      const sp = E.windowSpec(doc0, s.room, s.side);
      const spec = sp && !sp.fit ? { ...sp } : { w: o.w, tag: sp ? sp.tag : o.type, sill: sp ? sp.sill : undefined, desc: sp ? sp.desc : undefined, keepout: sp ? !!sp.keepout : false };
      delete spec.fit;
      const hz = s.side === 'S' || s.side === 'N', n = r.net, lo = hz ? n.x0 : n.y0, hi = hz ? n.x1 : n.y1, c0 = hz ? o.x : o.y;
      movers.push({ s, kind: 'window', [hz ? 'rx' : 'ry']: span(lo + o.w / 2 - c0, hi - o.w / 2 - c0),
        apply: (d, dx, dy) => E.setWindow(d, s.room, s.side, { ...spec, c: c0 + (hz ? dx : dy) }) });
    } else if (s.t === 'wall') {
      const w = wallOf(doc0, cfg, s, comps);
      if (!w || !once(`W${w.axis}:${w.at}:${w.lo}`)) continue;
      movers.push({ s, kind: 'wall', w, axis: w.axis, [w.axis === 'x' ? 'rx' : 'ry']: [-Infinity, Infinity] });
    }
  }
  return { doc, movers };
}
/** The moves every selected thing allows at once (the selection moves as one piece). */
export function groupRange(movers) {
  const rx = [-Infinity, Infinity], ry = [-Infinity, Infinity];
  for (const m of movers) {
    if (m.rx) { rx[0] = Math.max(rx[0], m.rx[0]); rx[1] = Math.min(rx[1], m.rx[1]); }
    if (m.ry) { ry[0] = Math.max(ry[0], m.ry[0]); ry[1] = Math.min(ry[1], m.ry[1]); }
  }
  return { rx, ry };
}
export const movesAlong = (movers, axis) => movers.some((m) => (axis === 'x' ? m.rx : m.ry));
/** Clamp a requested move to what all of them allow; the piece being dragged (lead) snaps flush to its walls. */
export function groupDelta(movers, dx, dy, { lead = null, snapTol = 0 } = {}) {
  const { rx, ry } = groupRange(movers), cl = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
  let x = cl(dx, rx), y = cl(dy, ry);
  const m = lead && snapTol > 0 ? movers.find((q) => q.kind === 'item' && sameSel(q.s, lead)) : null;
  if (m) { const r = snapToWalls(shift(m.rect0, x, y), m.net, snapTol); x = cl(r.x0 - m.rect0.x0, rx); y = cl(r.y0 - m.rect0.y0, ry); }
  return [movesAlong(movers, 'x') ? x : 0, movesAlong(movers, 'y') ? y : 0];
}
/** Move everything by (dx, dy). Walls go last, the leading one first, so no room shrinks on the way. */
export function applyMovers(cfg, doc, movers, dx, dy) {
  let d = doc;
  for (const m of movers) {
    if (m.kind === 'wall') continue;
    const ux = m.rx ? dx : 0, uy = m.ry ? dy : 0;
    if (Math.abs(ux) > 1e-9 || Math.abs(uy) > 1e-9) d = m.apply(d, ux, uy);
  }
  for (const axis of ['x', 'y']) {
    const dd = axis === 'x' ? dx : dy;
    if (Math.abs(dd) < 1e-9) continue;
    const ws = movers.filter((m) => m.kind === 'wall' && m.axis === axis).sort((a, b) => (dd > 0 ? b.w.at - a.w.at : a.w.at - b.w.at));
    for (const m of ws) d = E.moveWall(d, cfg, m.w, m.w.at + dd);
  }
  return d;
}
/** One call: move the selection by (dx, dy), clamped. Returns {doc, dx, dy} (doc unchanged when nothing can move). */
export function moveSelection(cfg, doc, plan, list, dx, dy) {
  const g = groupMovers(cfg, doc, plan, list);
  const [x, y] = groupDelta(g.movers, dx, dy);
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return { doc, dx: 0, dy: 0, movers: g.movers.length };
  return { doc: applyMovers(cfg, g.doc, g.movers, x, y), dx: x, dy: y, movers: g.movers.length };
}

// ------------------------------------------------------------------------------------------------ delete, rotate
/** What Delete takes away (rooms and walls stay: merging two rooms is how a wall goes). */
export const deletable = (list) => list.filter((s) => s.t === 'item' || s.t === 'keepout' || s.t === 'window' || s.t === 'link');
export function deleteText(list) {
  const n = {};
  for (const s of deletable(list)) n[s.t] = (n[s.t] || 0) + 1;
  const parts = Object.keys(NAMES).filter((t) => n[t]).map((t) => `${n[t]} ${NAMES[t][n[t] === 1 ? 0 : 1]}`);
  return parts.length ? `Removed ${andList(parts)}.` : '';
}
/** Remove the furniture, keep-out zones, windows (none on that wall) and doors / openings in the selection. */
export function deleteSelection(cfg, doc0, plan0, list) {
  let doc = handLayouts(doc0, plan0, list);
  const byRoom = new Map();
  for (const s of list) if (s.t === 'item') byRoom.set(s.uid, (byRoom.get(s.uid) || new Set()).add(s.i));
  for (const [uid, idx] of byRoom) for (const i of [...idx].sort((a, b) => b - a)) doc = E.removeItem(doc, uid, i);
  for (const i of [...new Set(list.filter((s) => s.t === 'keepout').map((s) => s.i))].sort((a, b) => b - a)) doc = E.removeKeepout(doc, i);
  for (const s of list) if (s.t === 'window') doc = E.setWindow(doc, s.room, s.side, { none: true });
  // doors: each removal renumbers the connections, so look each one up again in the plan of the current doc
  for (const s of list.filter((q) => q.t === 'link')) {
    const plan = doc === doc0 ? plan0 : analysePlan(cfg, doc), k = linkIndex(plan, s);
    if (k >= 0) doc = E.removeLinkAt(doc, plan, k);
  }
  return doc;
}
/** Turn each selected piece of furniture 90° about its centre, kept inside its room. Pieces that cannot turn stay. */
export function rotateSelection(cfg, doc0, plan, list) {
  let doc = handLayouts(doc0, plan, list), done = 0, stuck = 0;
  for (const s of list) {
    if (s.t !== 'item') continue;
    const r = roomOf(plan, s.uid);
    try {
      const nd = E.rotateItem(doc, s.uid, s.i), it = nd.furniture[s.uid].items[s.i], n = r.net, W = rw(it.rect), H = rh(it.rect);
      if (W > rw(n) + 1e-9 || H > rh(n) + 1e-9) { stuck++; continue; }
      const x0 = Math.min(n.x1 - W, Math.max(n.x0, it.rect.x0)), y0 = Math.min(n.y1 - H, Math.max(n.y0, it.rect.y0));
      it.rect = snapToWalls({ x0, y0, x1: x0 + W, y1: y0 + H }, n, 0.3);
      doc = nd; done++;
    } catch (e) { if (!(e instanceof E.EditError)) throw e; stuck++; }
  }
  return { doc: done ? doc : doc0, done, stuck };
}
