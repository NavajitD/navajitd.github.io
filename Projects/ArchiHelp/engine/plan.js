// Vaastu Planner design engine — plan model.
// A plan document (JSON, what gets saved/edited) is turned into a runtime plan (net rects, structure, rules).
//
// PlanDoc = {
//   id, source, label,
//   rooms:   [{ uid, rtype, name, tile:{x0,y0,x1,y1}, group: parentUid|null }]   tiles meet on wall centre-lines
//   links:   null (auto, derived by the checker) | [{ a, b, kind:'door'|'open'|'nowall', into, hint?:{at, hinge, w, end} }]
//   roadDoor: bool,                          entrance door on the road wall
//   windows: [{ room, side, w|0, c|null, sill, desc, tag, fit:'max'|null, keepout }]   listed sides are fully specified
//   keepouts: [{ room, rect }]               extra zones where no tall furniture may stand
//   furniture: { [uid]: { mode:'auto'|'manual', bedHead, wardrobeSide, sofaSide, items:[{kind, rect, label, tall, side, meta}] } }
//   notes: [string]                          extra drawing notes
// }
import { rect, rw, rh, rarea, EPS } from './geom.js';
import { resolveConfig } from './config.js';
import { buildStructure } from './structure.js';

export function region(cfg) { const e = cfg.t_ext / 2; return rect(e, e, cfg.ew_ft - e, cfg.ns_ft - e); }

/** Floor inside the walls: tiles meet on wall centre-lines. */
export function netRect(tile, R, cfg) {
  const te = cfg.t_ext / 2, ti = cfg.t_int / 2;
  const l = tile.x0 <= R.x0 + EPS ? te : ti, r = tile.x1 >= R.x1 - EPS ? te : ti;
  const b = tile.y0 <= R.y0 + EPS ? te : ti, t = tile.y1 >= R.y1 - EPS ? te : ti;
  return rect(tile.x0 + l, tile.y0 + b, tile.x1 - r, tile.y1 - t);
}

export function touchesRoad(tile, R, side) {
  return { E: tile.x1 >= R.x1 - EPS, W: tile.x0 <= R.x0 + EPS, N: tile.y1 >= R.y1 - EPS, S: tile.y0 <= R.y0 + EPS }[side];
}

export function makeRoom(uid, rtype, name, tile, R, cfg, group = null) {
  const net = netRect(tile, R, cfg);
  return { uid, rtype, name, tile: { ...tile }, net, group, area: rarea(net) };
}

/** Runtime plan from a document. cfg may be raw (it is resolved here). */
export function buildPlan(cfgIn, doc) {
  const cfg = cfgIn.__resolved ? cfgIn : Object.assign(resolveConfig(cfgIn), { __resolved: true });
  const R = region(cfg);
  const rooms = doc.rooms.map((r) => makeRoom(r.uid, r.rtype, r.name, r.tile, R, cfg, r.group ?? null));
  return {
    cfg, region: R, rooms, struct: doc.struct || buildStructure(cfg),
    id: doc.id ?? 0, source: doc.source || '', label: doc.label || '',
    link_spec: doc.links ? doc.links.map((l) => ({ ...l, hint: l.hint ? { ...l.hint } : undefined })) : null,
    road_door: doc.roadDoor !== undefined ? doc.roadDoor : true,
    windows: doc.windows || [], keepouts: doc.keepouts || [], furnitureSpec: doc.furniture || {}, notes: doc.notes || [],
    meta: doc.meta || {},
    checks: [], failed: [], links: [], stair_geo: null, attach: {}, sector_rows: [], vaastu_score: 0,
  };
}

export function planToDoc(plan, extra = {}) {
  return {
    id: plan.id, source: plan.source, label: plan.label,
    rooms: plan.rooms.map((r) => ({ uid: r.uid, rtype: r.rtype, name: r.name, tile: { ...r.tile }, group: r.group ?? null })),
    links: plan.link_spec ? plan.link_spec.map((l) => ({ ...l, hint: l.hint ? { ...l.hint } : undefined })) : null,
    roadDoor: plan.road_door, windows: plan.windows, keepouts: plan.keepouts, furniture: plan.furnitureSpec, notes: plan.notes,
    meta: plan.meta, ...extra,
  };
}

/** Structural validity of a set of tiles: inside the envelope, positive size, exact tiling without overlap. */
export function validateTiles(cfgIn, rooms) {
  const cfg = cfgIn.__resolved ? cfgIn : resolveConfig(cfgIn);
  const R = region(cfg), errs = [];
  let tot = 0;
  for (const r of rooms) {
    const t = r.tile;
    if (!(rw(t) > 0.05 && rh(t) > 0.05)) errs.push(`${r.name} has no size`);
    if (t.x0 < R.x0 - 1e-6 || t.y0 < R.y0 - 1e-6 || t.x1 > R.x1 + 1e-6 || t.y1 > R.y1 + 1e-6) errs.push(`${r.name} leaves the envelope`);
    tot += rarea(t);
  }
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i].tile, b = rooms[j].tile;
    const ov = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    if (ov > 1e-4) errs.push(`${rooms[i].name} overlaps ${rooms[j].name}`);
  }
  if (Math.abs(tot - rarea(R)) > 0.05) errs.push(`spaces cover ${tot.toFixed(1)} of ${rarea(R).toFixed(1)} sq ft`);
  return errs;
}

export const nextUid = (rooms) => rooms.reduce((m, r) => Math.max(m, r.uid), -1) + 1;
