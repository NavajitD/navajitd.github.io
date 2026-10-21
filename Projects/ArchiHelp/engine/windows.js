// ArchiHelp design engine — window specification: explicit, "as wide as the piers allow", or suppressed.
//
// plan.windows = [{ room: uid, side: 'S'|'N'|'E'|'W',
//                   fit: 'max' | undefined,     max = widest multiple of 3" keeping `pier` ft of solid wall from column faces
//                   w, c,                        explicit width and centre (c null = placed clear of doors / columns)
//                   none: true | w: 0,           no window on this side
//                   sill (ft, null = full-height glazing), desc, tag (fixed type tag, e.g. 'V1'), keepout: bool }]
// A side listed here is fully specified; unlisted exterior sides get the default window for the room type.
import { BASE_WIN_TYPES } from './config.js';
import { fmt } from './geom.js';

export const PIER = 1.5;   // 450 mm solid masonry between a window and a column / cross-wall face (IS 4326, Zone V)

/** Widest window (multiple of `step`) on `side` of `room`, keeping `pier` from the column faces and cross-wall faces. */
export function maxWindow(plan, room, side, pier = PIER, step = 0.25) {
  const n = room.net, t = room.tile, horiz = side === 'S' || side === 'N';
  let lo = horiz ? n.x0 : n.y0, hi = horiz ? n.x1 : n.y1;
  const wall = { S: t.y0, N: t.y1, W: t.x0, E: t.x1 }[side];
  for (const c of plan.struct.columns) {
    if (Math.abs((horiz ? c.y : c.x) - wall) > 1.0) continue;
    const a = horiz ? c.x : c.y, half = (horiz ? c.size_mm[0] : c.size_mm[1]) / 304.8 / 2;
    if (a <= lo + 0.5) lo = Math.max(lo, a + half);
    else if (a >= hi - 0.5) hi = Math.min(hi, a - half);
  }
  const w = Math.floor((hi - lo - 2 * pier) / step + 1e-9) * step;
  return w >= 2.0 ? [w, (lo + hi) / 2] : [0, null];
}

const sillText = (s) => (s === null || s === undefined ? null : `sill ${fmt(s)}`);

/** -> { hints: {uid: [{side, w, tag, c}]}, keepouts: {uid: [rect]}, winTypes: {tag: [desc, size, sill]}, noteRefs: [tag] } */
export function resolveWindows(plan) {
  const winTypes = {};
  for (const [k, v] of Object.entries(BASE_WIN_TYPES)) winTypes[k] = v.slice();
  for (const [k, v] of Object.entries(plan.meta && plan.meta.winTypes || {})) winTypes[k] = v.slice();
  const hints = {}, keepouts = {}, tagOf = new Map(), noteRefs = [];
  let next = 1 + Math.max(0, ...Object.keys(winTypes).filter((k) => /^W\d+$/.test(k)).map((k) => parseInt(k.slice(1), 10)));
  const rooms = new Map(plan.rooms.map((r) => [r.uid, r]));
  for (const spec of plan.windows || []) {
    const r = rooms.get(spec.room);
    if (!r) continue;
    const list = hints[r.uid] || (hints[r.uid] = []);
    if (spec.none || spec.w === 0) { list.push({ side: spec.side, w: 0, tag: null, c: null }); continue; }
    let w, c;
    if (spec.fit === 'max') {
      [w, c] = maxWindow(plan, r, spec.side, spec.pier ?? PIER);
      if (!w) { list.push({ side: spec.side, w: 0, tag: null, c: null }); continue; }
    } else { w = spec.w; c = spec.c ?? null; }
    let tag = spec.tag;
    if (!tag || !winTypes[tag]) {
      const sill = spec.sill === undefined ? 3.0 : spec.sill, desc = spec.desc || 'Window';
      const key = `${w}|${sill}|${desc}`;
      if (tag && !winTypes[tag]) {             // a named custom type
        winTypes[tag] = [desc, sill === null ? `${fmt(w)} x full height` : `${fmt(w)} x ${fmt(7.0 - sill)}`, sillText(sill) || 'see note *'];
      } else if (tagOf.has(key)) tag = tagOf.get(key);
      else {
        tag = `W${next++}`; tagOf.set(key, tag);
        winTypes[tag] = [desc, sill === null ? `${fmt(w)} x full height` : `${fmt(w)} x ${fmt(7.0 - sill)}`, sillText(sill) || 'see note *'];
      }
      if (sill === null && !noteRefs.includes(tag)) noteRefs.push(tag);
    }
    list.push({ side: spec.side, w, tag, c });
    if (spec.keepout && c !== null) {
      const n = r.net, d = 2.0, h = w / 2, s = spec.side;
      const kr = s === 'S' ? { x0: c - h, y0: n.y0, x1: c + h, y1: n.y0 + d } : s === 'N' ? { x0: c - h, y0: n.y1 - d, x1: c + h, y1: n.y1 }
        : s === 'W' ? { x0: n.x0, y0: c - h, x1: n.x0 + d, y1: c + h } : { x0: n.x1 - d, y0: c - h, x1: n.x1, y1: c + h };
      (keepouts[r.uid] || (keepouts[r.uid] = [])).push(kr);
    }
  }
  return { hints, keepouts, winTypes, noteRefs };
}
