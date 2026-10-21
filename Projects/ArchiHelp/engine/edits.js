// Vaastu Planner design engine — edit operations on plan documents (pure: each returns a NEW document).
// These are the moves made by hand in the sketch revisions: walls to exact dimensions, area targets, split / merge /
// swap / retype spaces, hand-specified doors / openings / "no wall", windows, furniture (auto preferences or manual
// layouts), keep-outs and drawing notes. Problems raise EditError with a message for the user.
import { rw, rh, rarea, sharedEdge, EPS, fi } from './geom.js';
import { prepareConfig } from './index.js';
import { region, netRect, validateTiles, nextUid } from './plan.js';
import { span as wallSpan, sideOf } from './furniture.js';

export class EditError extends Error {}
export const cloneDoc = (d) => (typeof structuredClone === 'function' ? structuredClone(d) : JSON.parse(JSON.stringify(d)));
const SIDES = ['S', 'N', 'W', 'E'];

// ------------------------------------------------------------------------------------------------ walls
/** Every interior wall line that can move without breaking the tiling: {axis, at, lo, hi, rooms:[[uid, edge]]}. */
export function wallComponents(doc, cfgIn) {
  const cfg = prepareConfig(cfgIn), R = region(cfg), rooms = doc.rooms, out = [];
  for (const axis of ['x', 'y']) {
    const lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1', plo = axis === 'x' ? 'y0' : 'x0', phi = axis === 'x' ? 'y1' : 'x1';
    const lines = [...new Set(rooms.map((r) => r.tile[hi]).filter((v) => v < (axis === 'x' ? R.x1 : R.y1) - EPS).map((v) => +v.toFixed(9)))];
    for (const at of lines) {
      const items = rooms.filter((r) => Math.abs(r.tile[hi] - at) < 1e-6).map((r) => ({ r, side: hi }))
        .concat(rooms.filter((r) => Math.abs(r.tile[lo] - at) < 1e-6).map((r) => ({ r, side: lo })));
      const used = new Set();
      for (let k = 0; k < items.length; k++) {
        if (used.has(k)) continue;
        const group = [k]; used.add(k);
        for (let g = 0; g < group.length; g++) for (let m = 0; m < items.length; m++) {
          if (used.has(m)) continue;
          const a = items[group[g]].r.tile, b = items[m].r.tile;
          if (Math.min(a[phi], b[phi]) - Math.max(a[plo], b[plo]) > 1e-6) { used.add(m); group.push(m); }
        }
        const G = group.map((q) => items[q]), L = G.filter((q) => q.side === hi), Rr = G.filter((q) => q.side === lo);
        if (!L.length || !Rr.length) continue;
        const ext = (arr) => [Math.min(...arr.map((q) => q.r.tile[plo])), Math.max(...arr.map((q) => q.r.tile[phi]))];
        const [a0, a1] = ext(L), [b0, b1] = ext(Rr);
        const closed = Math.abs(a0 - b0) < 1e-6 && Math.abs(a1 - b1) < 1e-6;
        out.push({ axis, at, lo: Math.min(a0, b0), hi: Math.max(a1, b1), closed, rooms: G.map((q) => [q.r.uid, q.side]) });
      }
    }
  }
  return out;
}

/** The movable wall nearest to (x, y) within tol ft, or null. */
export function wallAt(doc, cfg, x, y, tol = 0.6) {
  let best = null, bd = tol;
  for (const w of wallComponents(doc, cfg)) {
    if (!w.closed) continue;
    const [u, v] = w.axis === 'x' ? [x, y] : [y, x];
    if (v < w.lo - 1e-6 || v > w.hi + 1e-6) continue;
    const d = Math.abs(u - w.at);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

/** Wall component that contains a given room edge ('W','E','S','N'). */
export function wallOfRoom(doc, cfg, uid, side) {
  const r = doc.rooms.find((q) => q.uid === uid);
  if (!r) throw new EditError('That space no longer exists.');
  const axis = side === 'W' || side === 'E' ? 'x' : 'y', edge = { W: 'x0', E: 'x1', S: 'y0', N: 'y1' }[side];
  const at = r.tile[edge];
  const w = wallComponents(doc, cfg).find((c) => c.axis === axis && Math.abs(c.at - at) < 1e-6 && c.rooms.some(([u, e]) => u === uid && e === edge));
  if (!w) throw new EditError(`The ${{ W: 'west', E: 'east', S: 'south', N: 'north' }[side]} wall of ${r.name} is the outer wall (set by the plot size).`);
  if (!w.closed) throw new EditError(`The ${{ W: 'west', E: 'east', S: 'south', N: 'north' }[side]} wall of ${r.name} cannot move on its own: the spaces on the two sides do not end at the same points. Split or merge spaces first.`);
  return w;
}

/** Move a wall component to `newAt` (centre-line). Manual furniture against the wall moves with it. */
export function moveWall(doc, cfgIn, wall, newAt) {
  const cfg = prepareConfig(cfgIn), nd = cloneDoc(doc), d = newAt - wall.at;
  if (Math.abs(d) < 1e-9) return nd;
  const by = new Map(nd.rooms.map((r) => [r.uid, r]));
  const R = region(cfg);
  for (const [uid, side] of wall.rooms) {
    const r = by.get(uid), before = netRect(r.tile, R, cfg);
    r.tile[side] += d;
    const t = r.tile;
    if (t.x1 - t.x0 < cfg.t_int + 1.0 || t.y1 - t.y0 < cfg.t_int + 1.0) throw new EditError(`${r.name} would become too small.`);
    // manual furniture touching the moved wall slides with it
    const fs = nd.furniture && nd.furniture[uid];
    if (fs && fs.items) {
      const after = netRect(r.tile, R, cfg), axis = wall.axis, lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1';
      const wallNetEdge = side === lo ? before[lo] : before[hi], shift = side === lo ? after[lo] - before[lo] : after[hi] - before[hi];
      for (const it of fs.items) {
        const touches = side === lo ? Math.abs(it.rect[lo] - wallNetEdge) < 0.05 : Math.abs(it.rect[hi] - wallNetEdge) < 0.05;
        if (touches) { it.rect[lo] += shift; it.rect[hi] += shift; }
      }
    }
  }
  const errs = validateTiles(cfg, nd.rooms);
  if (errs.length) throw new EditError(errs[0]);
  return nd;
}

const netOf = (doc, cfg, uid) => { const c = prepareConfig(cfg), r = doc.rooms.find((q) => q.uid === uid); return netRect(r.tile, region(c), c); };

/** Clear (wall-face to wall-face) size: dim 'w' (east-west) or 'h' (north-south), moving the wall on `move` side. */
export function setClearSize(doc, cfg, uid, dim, value, move) {
  if (!(value > 0)) throw new EditError('Enter a size greater than zero.');
  const n = netOf(doc, cfg, uid), cur = dim === 'w' ? rw(n) : rh(n), delta = value - cur;
  if (Math.abs(delta) < 1e-9) return cloneDoc(doc);
  const side = move || (dim === 'w' ? 'E' : 'N');
  if ((dim === 'w') !== (side === 'W' || side === 'E')) throw new EditError('Pick a wall across that dimension.');
  const w = wallOfRoom(doc, cfg, uid, side);
  return moveWall(doc, cfg, w, w.at + (side === 'E' || side === 'N' ? delta : -delta));
}

/** Reach a target clear floor area by moving one wall. */
export function setArea(doc, cfg, uid, area, move) {
  const n = netOf(doc, cfg, uid), side = move || 'E', horiz = side === 'W' || side === 'E';
  const other = horiz ? rh(n) : rw(n);
  return setClearSize(doc, cfg, uid, horiz ? 'w' : 'h', area / other, side);
}

// ------------------------------------------------------------------------------------------------ spaces
export function setRoom(doc, uid, patch) {
  const nd = cloneDoc(doc), r = nd.rooms.find((q) => q.uid === uid);
  if (!r) throw new EditError('That space no longer exists.');
  if (patch.name !== undefined) {
    const nm = String(patch.name).trim();
    if (!nm) throw new EditError('A space needs a name.');
    if (nd.rooms.some((q) => q.uid !== uid && q.name === nm)) throw new EditError(`Another space is already called "${nm}".`);
    r.name = nm;
  }
  if (patch.rtype !== undefined) { r.rtype = patch.rtype; if (patch.rtype !== 'suite') r.group = null; }
  if (patch.group !== undefined) r.group = patch.group;
  return nd;
}

/** Split a space with a new wall at `at` (axis 'x' = a north-south wall at x = at). The new space takes the `newSide` part. */
export function splitRoom(doc, cfgIn, uid, axis, at, { rtype = 'lobby', name = null, newSide = null } = {}) {
  const cfg = prepareConfig(cfgIn), nd = cloneDoc(doc), r = nd.rooms.find((q) => q.uid === uid);
  if (!r) throw new EditError('That space no longer exists.');
  const t = r.tile, lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1';
  if (!(at > t[lo] + cfg.t_int + 1.0 && at < t[hi] - cfg.t_int - 1.0)) throw new EditError('Put the new wall at least 1 ft inside the space.');
  const side = newSide || (axis === 'x' ? 'E' : 'N');
  const uidNew = nextUid(nd.rooms), a = { ...t }, b = { ...t };
  a[hi] = at; b[lo] = at;
  const newIsHigh = side === 'E' || side === 'N';
  r.tile = newIsHigh ? a : b;
  const tile = newIsHigh ? b : a;
  const label = (cfg.room_specs[rtype] || {}).label || rtype;
  let nm = name || label, k = 2;
  while (nd.rooms.some((q) => q.name === nm)) nm = `${name || label} ${k++}`;
  nd.rooms.push({ uid: uidNew, rtype, name: nm, tile, group: rtype === 'suite' ? uid : null });
  // manual furniture whose centre falls in the new part goes with it
  const fs = nd.furniture && nd.furniture[uid];
  if (fs && fs.items) {
    const mine = [], theirs = [];
    for (const it of fs.items) { const c = axis === 'x' ? (it.rect.x0 + it.rect.x1) / 2 : (it.rect.y0 + it.rect.y1) / 2; ((newIsHigh ? c > at : c < at) ? theirs : mine).push(it); }
    fs.items = mine;
    if (theirs.length) nd.furniture[uidNew] = { mode: 'manual', items: theirs };
  }
  const errs = validateTiles(cfg, nd.rooms);
  if (errs.length) throw new EditError(errs[0]);
  return nd;
}

/** Merge two spaces whose union is a rectangle; the first keeps its name and type. */
export function mergeRooms(doc, cfgIn, uidA, uidB) {
  const nd = cloneDoc(doc), a = nd.rooms.find((q) => q.uid === uidA), b = nd.rooms.find((q) => q.uid === uidB);
  if (!a || !b) throw new EditError('Pick two spaces.');
  const A = a.tile, B = b.tile;
  const sameY = Math.abs(A.y0 - B.y0) < 1e-6 && Math.abs(A.y1 - B.y1) < 1e-6 && (Math.abs(A.x1 - B.x0) < 1e-6 || Math.abs(B.x1 - A.x0) < 1e-6);
  const sameX = Math.abs(A.x0 - B.x0) < 1e-6 && Math.abs(A.x1 - B.x1) < 1e-6 && (Math.abs(A.y1 - B.y0) < 1e-6 || Math.abs(B.y1 - A.y0) < 1e-6);
  if (!sameY && !sameX) throw new EditError(`${a.name} and ${b.name} do not form a rectangle together.`);
  a.tile = { x0: Math.min(A.x0, B.x0), y0: Math.min(A.y0, B.y0), x1: Math.max(A.x1, B.x1), y1: Math.max(A.y1, B.y1) };
  nd.rooms = nd.rooms.filter((q) => q.uid !== uidB);
  for (const q of nd.rooms) if (q.group === uidB) q.group = uidA;
  if (nd.links) nd.links = nd.links.filter((l) => !((l.a === uidA && l.b === uidB) || (l.a === uidB && l.b === uidA)))
    .map((l) => ({ ...l, a: l.a === uidB ? uidA : l.a, b: l.b === uidB ? uidA : l.b, into: l.into === uidB ? uidA : l.into }));
  if (nd.windows) nd.windows = nd.windows.filter((w) => w.room !== uidB);
  if (nd.keepouts) nd.keepouts = nd.keepouts.map((k) => (k.room === uidB ? { ...k, room: uidA } : k));
  if (nd.furniture && nd.furniture[uidB]) {
    const fb = nd.furniture[uidB]; delete nd.furniture[uidB];
    if (fb.items && fb.items.length) { const fa = nd.furniture[uidA] || (nd.furniture[uidA] = {}); fa.items = (fa.items || []).concat(fb.items); }
  }
  return nd;
}

/** Exchange the functions (type, name, furniture preferences) of two spaces; walls and windows stay. */
export function swapRooms(doc, uidA, uidB) {
  const nd = cloneDoc(doc), a = nd.rooms.find((q) => q.uid === uidA), b = nd.rooms.find((q) => q.uid === uidB);
  if (!a || !b) throw new EditError('Pick two spaces.');
  [a.rtype, b.rtype] = [b.rtype, a.rtype];
  [a.name, b.name] = [b.name, a.name];
  const fa = nd.furniture ? nd.furniture[uidA] : undefined, fb = nd.furniture ? nd.furniture[uidB] : undefined;
  if (nd.furniture) {
    const strip = (f) => (f ? { bedHead: f.bedHead, wardrobeSide: f.wardrobeSide, sofaSide: f.sofaSide } : undefined);
    if (fb) nd.furniture[uidA] = strip(fb); else delete nd.furniture[uidA];
    if (fa) nd.furniture[uidB] = strip(fa); else delete nd.furniture[uidB];
  }
  return nd;
}

export function removeRoomIntoNeighbour(doc, cfg, uid, neighbour) { return mergeRooms(doc, cfg, neighbour, uid); }

// ------------------------------------------------------------------------------------------------ doors / openings
/** Freeze the automatically chosen connections into an editable list (doors stay where the planner put them). */
export function linksToManual(doc, plan) {
  const nd = cloneDoc(doc);
  if (nd.links) return nd;
  nd.links = plan.links.map((l) => ({ a: l.a, b: l.b, kind: l.kind, into: l.into }));
  return nd;
}

/** Pin a door / opening at its current position (hint.at from the low corner, hinge side). */
export function pinLink(doc, plan, k) {
  const l = plan.links_all[k], dp = plan.door_plan.get(k);
  if (!l || !dp || l.entrance) throw new EditError('Nothing to pin.');
  if (!doc.links) throw new EditError('Convert the doors to a hand-specified list first.');
  return placeLink(doc, plan, k, { clamp: false });
}

const segRange = (seg) => {
  const [[x0, y0], [x1, y1]] = seg, hz = Math.abs(y0 - y1) < 1e-6;
  return { horiz: hz, lo: hz ? Math.min(x0, x1) : Math.min(y0, y1), hi: hz ? Math.max(x0, x1) : Math.max(y0, y1), at: hz ? y0 : x0 };
};
/** Planner rule for a door's default width (entrance / kitchen opening 3'-6", bath & puja 2'-6", others 3'-0"). */
export function defaultLinkWidth(plan, l) {
  const rooms = new Map(plan.rooms.map((r) => [r.uid, r]));
  if (l.entrance || (l.kind === 'open' && rooms.get(l.into).rtype === 'kitchen')) return 3.5;
  const ts = [rooms.get(l.b).rtype, l.a !== null ? rooms.get(l.a).rtype : ''];
  return ts.includes('bath') || ts.includes('puja') ? 2.5 : 3.0;
}
/** Where along the wall a door / opening of link k can go: the shared wall between both rooms' wall faces. */
export function linkInterval(plan, k) {
  const l = plan.links_all[k], rooms = new Map(plan.rooms.map((r) => [r.uid, r])), s = segRange(l.seg);
  let { lo, hi } = s;
  for (const u of [l.a, l.b]) { if (u === null || u === undefined) continue; const r = rooms.get(u), [a, b] = wallSpan(r.net, sideOf(r, l.seg)); lo = Math.max(lo, a); hi = Math.min(hi, b); }
  return { lo, hi, horiz: s.horiz, at: s.at };
}
const findDocLink = (links, l) => links.findIndex((q) => q.kind === l.kind && ((q.a === l.a && q.b === l.b) || (q.a === l.b && q.b === l.a)));

/**
 * Place door / opening k: centre p along the wall (ft, plan coordinates), width w, hinge 'lo'|'hi' (the end nearer
 * west / south is 'lo'). Unspecified values keep the current ones. The entrance door is pinned through doc.meta.
 */
export function placeLink(doc, plan, k, { p = null, w = null, hinge = null, clamp = true } = {}) {
  const l = plan.links_all[k], dp = plan.door_plan.get(k);
  if (!l) throw new EditError('That connection no longer exists.');
  if (l.kind === 'nowall') throw new EditError('A "no wall" join takes the whole shared wall; there is nothing to place.');
  const rooms = new Map(plan.rooms.map((r) => [r.uid, r])), iv = linkInterval(plan, k), s = segRange(l.seg);
  const width = w ?? (dp ? dp[3] : defaultLinkWidth(plan, l));
  if (clamp && width > iv.hi - iv.lo + 1e-9) throw new EditError(`Only ${fi(Math.max(0, iv.hi - iv.lo))} of clear wall is available here.`);
  let pos = p ?? (dp && dp[0] !== null ? dp[0] : (iv.lo + iv.hi) / 2);
  if (clamp) pos = Math.min(iv.hi - width / 2, Math.max(iv.lo + width / 2, pos));
  const hg = hinge ?? (dp ? dp[1] : 'lo');
  const plannedOpen = l.kind === 'open' && rooms.get(l.into).rtype === 'kitchen';
  let nd;
  if (l.kind === 'door' || plannedOpen) {
    const r = rooms.get(l.into), lo = Math.max(s.lo, wallSpan(r.net, sideOf(r, l.seg))[0]);
    const hint = { at: pos - width / 2 - lo, hinge: hg };
    if (!plannedOpen && Math.abs(width - defaultLinkWidth(plan, l)) > 1e-9) hint.w = width;
    if (l.entrance) { nd = cloneDoc(doc); nd.meta = { ...(nd.meta || {}), entranceHint: hint }; return nd; }
    nd = doc.links ? cloneDoc(doc) : linksToManual(doc, plan);
    const i = findDocLink(nd.links, l);
    if (i < 0) throw new EditError('That connection no longer exists.');
    nd.links[i].hint = hint;
  } else {
    nd = doc.links ? cloneDoc(doc) : linksToManual(doc, plan);
    const i = findDocLink(nd.links, l);
    if (i < 0) throw new EditError('That connection no longer exists.');
    nd.links[i].hint = { at: pos - width / 2 - iv.lo, w: width };
  }
  return nd;
}

/** Let the planner position door / opening k again (drops the pinned position and width). */
export function unpinLink(doc, plan, k) {
  const l = plan.links_all[k];
  if (!l) throw new EditError('That connection no longer exists.');
  const nd = cloneDoc(doc);
  if (l.entrance) { if (nd.meta) delete nd.meta.entranceHint; return nd; }
  if (!nd.links) return nd;
  const i = findDocLink(nd.links, l);
  if (i >= 0) delete nd.links[i].hint;
  return nd;
}

/** Change what kind of connection link k is ('door' | 'open' | 'nowall') or which room the door swings into. */
export function setLinkKind(doc, plan, k, { kind = null, into = null } = {}) {
  const l = plan.links_all[k];
  if (!l || l.entrance) throw new EditError('The entrance is always a door (switch it off in Plan settings).');
  const nd = doc.links ? cloneDoc(doc) : linksToManual(doc, plan), i = findDocLink(nd.links, l);
  if (i < 0) throw new EditError('That connection no longer exists.');
  const q = nd.links[i];
  if (kind && kind !== q.kind) { q.kind = kind; delete q.hint; if (kind === 'nowall') q.into = q.a; }
  if (into !== null && into !== undefined) { if (into !== q.a && into !== q.b) throw new EditError('A door swings into one of the two rooms it joins.'); q.into = into; delete q.hint; }
  return nd;
}

export function removeLinkAt(doc, plan, k) {
  const l = plan.links_all[k];
  if (!l) throw new EditError('That connection no longer exists.');
  if (l.entrance) return setDocField(doc, 'roadDoor', false);
  const nd = doc.links ? cloneDoc(doc) : linksToManual(doc, plan), i = findDocLink(nd.links, l);
  if (i < 0) throw new EditError('That connection no longer exists.');
  nd.links.splice(i, 1);
  return nd;
}

export function addLink(doc, plan, a, b, kind = 'door', into = null) {
  let nd = doc.links ? cloneDoc(doc) : linksToManual(doc, plan);
  const ra = nd.rooms.find((q) => q.uid === a), rb = nd.rooms.find((q) => q.uid === b);
  if (!ra || !rb) throw new EditError('Pick two spaces.');
  if (!(sharedEdge(ra.tile, rb.tile)[0] > 0)) throw new EditError(`${ra.name} and ${rb.name} do not share a wall.`);
  if (nd.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) throw new EditError(`${ra.name} and ${rb.name} are already connected — edit that connection instead.`);
  nd.links.push({ a, b, kind, into: into ?? b });
  return nd;
}

export function updateLink(doc, idx, patch) {
  const nd = cloneDoc(doc);
  if (!nd.links || !nd.links[idx]) throw new EditError('That connection no longer exists.');
  const l = nd.links[idx];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'hint') { if (v === null) delete l.hint; else l.hint = { ...(l.hint || {}), ...v }; }
    else l[k] = v;
  }
  if (l.kind === 'nowall') delete l.hint;
  return nd;
}

export function removeLink(doc, idx) {
  const nd = cloneDoc(doc);
  if (!nd.links || !nd.links[idx]) throw new EditError('That connection no longer exists.');
  nd.links.splice(idx, 1);
  return nd;
}

export const linkIndex = (doc, l) => (doc.links || []).findIndex((q) => q.a === l.a && q.b === l.b && q.kind === l.kind);

// ------------------------------------------------------------------------------------------------ windows
/** spec: null (automatic) | {none:true} | {fit:'max', sill, desc, keepout} | {w, c|null, sill, desc, tag, keepout} */
export function setWindow(doc, room, side, spec) {
  if (!SIDES.includes(side)) throw new EditError('Pick a side.');
  const nd = cloneDoc(doc);
  nd.windows = (nd.windows || []).filter((w) => !(w.room === room && w.side === side));
  if (spec) nd.windows.push({ room, side, ...spec });
  return nd;
}
export const windowSpec = (doc, room, side) => (doc.windows || []).find((w) => w.room === room && w.side === side) || null;

// ------------------------------------------------------------------------------------------------ furniture
export function setFurniture(doc, uid, patch) {
  const nd = cloneDoc(doc);
  nd.furniture = nd.furniture || {};
  const f = nd.furniture[uid] = { ...(nd.furniture[uid] || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === '') delete f[k]; else f[k] = v; }
  return nd;
}

/** Start a hand layout from what the planner placed (the rooms the sketches re-arranged by hand). */
export function furnitureToManual(doc, plan, uid) {
  const items = (plan.furniture[uid] || []).map((i) => ({ kind: i.kind, rect: { ...i.rect }, label: i.label || '', tall: !!i.tall, side: i.side || '', meta: { ...(i.meta || {}) } }));
  return setFurniture(doc, uid, { mode: 'manual', items });
}

export function addItem(doc, uid, item) {
  const nd = cloneDoc(doc); nd.furniture = nd.furniture || {};
  const f = nd.furniture[uid] = nd.furniture[uid] || {};
  f.items = (f.items || []).concat([item]);
  return nd;
}
export function updateItem(doc, uid, idx, patch) {
  const nd = cloneDoc(doc), f = nd.furniture && nd.furniture[uid];
  if (!f || !f.items || !f.items[idx]) throw new EditError('That item no longer exists.');
  f.items[idx] = { ...f.items[idx], ...patch, rect: { ...(patch.rect || f.items[idx].rect) }, meta: { ...f.items[idx].meta, ...(patch.meta || {}) } };
  return nd;
}
export function removeItem(doc, uid, idx) {
  const nd = cloneDoc(doc), f = nd.furniture && nd.furniture[uid];
  if (!f || !f.items) throw new EditError('That item no longer exists.');
  f.items.splice(idx, 1);
  return nd;
}
/** Rotate an item 90 degrees about its centre (wall side turns with it). */
export function rotateItem(doc, uid, idx) {
  const f = doc.furniture && doc.furniture[uid], it = f && f.items && f.items[idx];
  if (!it) throw new EditError('That item no longer exists.');
  const r = it.rect, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, hw = (r.y1 - r.y0) / 2, hh = (r.x1 - r.x0) / 2;
  const turn = { S: 'W', W: 'N', N: 'E', E: 'S' };
  const meta = { ...(it.meta || {}) };
  if (meta.head) meta.head = turn[meta.head];
  return updateItem(doc, uid, idx, { rect: { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }, side: it.side ? turn[it.side] : '', meta });
}

// ------------------------------------------------------------------------------------------------ keep-outs, notes, misc
export function addKeepout(doc, room, rect) { const nd = cloneDoc(doc); nd.keepouts = (nd.keepouts || []).concat([{ room, rect }]); return nd; }
export function removeKeepout(doc, idx) { const nd = cloneDoc(doc); nd.keepouts.splice(idx, 1); return nd; }
export function setNotes(doc, notes) { const nd = cloneDoc(doc); nd.notes = notes.map((s) => String(s)).filter((s) => s.trim()); return nd; }
export function setDocField(doc, key, value) { const nd = cloneDoc(doc); nd[key] = value; return nd; }

/** Snap a length to the nearest step (ft): 1/24 = half inch, 1/12 = inch, 0.25 = 3", 0.5 = 6". */
export const nextUidOf = (doc) => nextUid(doc.rooms);

/** Replace keep-out i with a new rectangle. */
export function setKeepout(doc, i, rect) { const nd = cloneDoc(doc); if (!nd.keepouts || !nd.keepouts[i]) throw new EditError('That keep-out no longer exists.'); nd.keepouts[i] = { ...nd.keepouts[i], rect: { ...rect } }; return nd; }

/** Can two spaces merge into one rectangle? */
export function canMerge(doc, uidA, uidB) {
  const a = doc.rooms.find((q) => q.uid === uidA), b = doc.rooms.find((q) => q.uid === uidB);
  if (!a || !b || a === b) return false;
  const A = a.tile, B = b.tile, e = 1e-6;
  return (Math.abs(A.y0 - B.y0) < e && Math.abs(A.y1 - B.y1) < e && (Math.abs(A.x1 - B.x0) < e || Math.abs(B.x1 - A.x0) < e))
    || (Math.abs(A.x0 - B.x0) < e && Math.abs(A.x1 - B.x1) < e && (Math.abs(A.y1 - B.y0) < e || Math.abs(B.y1 - A.y0) < e));
}

/** Neighbours sharing at least `min` ft of wall with a space. */
export function neighbours(doc, uid, min = 2.0) {
  const a = doc.rooms.find((q) => q.uid === uid);
  return a ? doc.rooms.filter((q) => q.uid !== uid && sharedEdge(a.tile, q.tile)[0] >= min) : [];
}

export const snap = (v, step) => (step ? Math.round(v / step) * step : v);
export { rarea };
