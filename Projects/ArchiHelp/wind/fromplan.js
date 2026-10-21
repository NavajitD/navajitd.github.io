// ArchiHelp wind — the bridge from ArchiHelp floors (designed or traced) to the simulation's house model (metres).
import { analysePlan } from '../engine/index.js';
import { defaultFanPositions, FAN_TYPES } from './fans.js';

export const FT = 0.3048;
const DOOR_HEAD_FT = 7.0;
const FAN_ROOMS = { master: 1, bedroom: 1, hall: 1, dining: 1, study: 1 };

/** Default wind settings of a project (stored in p.wind). */
export function defaultWindSettings(cfg = {}) {
  return {
    location: null, terrain: 'urban', plinthFt: 1.5, slabFt: 5 / 12, below: 'auto', above: 'roof',
    roof: 'rcc', walls: 'brick', glazing: 'single', windowKind: 'sliding', overhangFt: 1.5,
    windows: 'auto', interiorDoors: 'open', bathDoors: 'closed', mumty: 'never',
    fanDefaults: { type: 'standard', speed: 'high', mode: 'auto' }, fans: {}, neighbours: [],
    days: { seasons: null, dates: [] },
    rotation: cfg.plan_north_bearing_deg || 0,
  };
}

/** Parse 3'-6" style lengths (ft). */
export function parseFtIn(s) {
  const m = /(\d+)'\s*-?\s*(\d+(?:\.\d+)?)?"?/.exec(String(s || ''));
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0) : null;
}
/** [sill, head, ventilator?] in ft from an A-601 window type row [desc, size, sill]. */
export function windowHeights(row, tag) {
  if (!row) return [3.0, DOOR_HEAD_FT, false];
  const [desc, size, sillTxt] = row;
  const vent = /ventilator/i.test(desc || '') || /^V\d/.test(tag || '');
  const sill = /sill/.test(sillTxt || '') ? parseFtIn(String(sillTxt).replace('sill', '')) : 0;
  const parts = String(size || '').split('x');
  const h = /full/.test(parts[1] || '') ? DOOR_HEAD_FT - (sill || 0) : parseFtIn(parts[1]) ?? (DOOR_HEAD_FT - (sill ?? 3));
  return [sill ?? 3.0, (sill ?? 3.0) + h, vent];
}

/** Floor heights (m): finished floor level above ground, storey and clear ceiling height. */
export function floorHeights(cfg, level, settings = {}) {
  const plinth = (settings.plinthFt ?? 1.5) * FT, slab = (settings.slabFt ?? 5 / 12) * FT;
  const g = cfg.ground_floor_height_ft * FT, t = cfg.typical_floor_height_ft * FT;
  const ffl = plinth + (level >= 1 ? g : 0) + Math.max(0, level - 1) * t, storey = level === 0 ? g : t;
  return { ffl, storey, ceil: storey - slab, slab };
}

/** Neighbouring buildings (settings, in feet around the envelope) -> plan boxes in metres with heights. */
export function neighbourBoxes(list, cfg) {
  const EW = cfg.ew_ft, NS = cfg.ns_ft;
  return (list || []).map((n) => {
    const gap = n.gapFt ?? 10, len = n.lengthFt ?? (n.side === 'N' || n.side === 'S' ? EW : NS), dep = n.depthFt ?? 30, H = (n.heightFt ?? 20) * FT;
    const along = n.offsetFt ?? ((n.side === 'N' || n.side === 'S' ? EW : NS) - len) / 2;
    let b;
    if (n.side === 'W') b = { x0: -gap - dep, x1: -gap, y0: along, y1: along + len };
    else if (n.side === 'E') b = { x0: EW + gap, x1: EW + gap + dep, y0: along, y1: along + len };
    else if (n.side === 'S') b = { x0: along, x1: along + len, y0: -gap - dep, y1: -gap };
    else b = { x0: along, x1: along + len, y0: NS + gap, y1: NS + gap + dep };
    return { x0: b.x0 * FT, x1: b.x1 * FT, y0: b.y0 * FT, y1: b.y1 * FT, height: H, label: n.label || '' };
  });
}

/** One floor of the house from an analysed ArchiHelp plan. */
function designedFloor(f, cfg, settings) {
  const plan = analysePlan(f.cfg, f.doc, { furniture: true });
  const H = floorHeights(cfg, f.level, settings), rid = (uid) => `${f.id}:${uid}`;
  const fl = { id: f.id, level: f.level, name: f.name, ...H, rooms: [], openings: [], columns: [], source: 'design' };
  for (const r of plan.rooms) {
    fl.rooms.push({ id: rid(r.uid), uid: r.uid, name: r.name, type: r.rtype, x0: r.tile.x0 * FT, y0: r.tile.y0 * FT, x1: r.tile.x1 * FT, y1: r.tile.y1 * FT,
      nx0: r.net.x0 * FT, ny0: r.net.y0 * FT, nx1: r.net.x1 * FT, ny1: r.net.y1 * FT, court: r.rtype === 'court', veranda: r.rtype === 'veranda' });
  }
  plan.links_all.forEach((l, k) => { if (l.kind === 'nowall' && l.a !== null) fl.openings.push({ id: `nw${k}`, kind: 'nowall', a: rid(l.a), b: rid(l.b) }); });
  const wt = (plan.windowsResolved && plan.windowsResolved.winTypes) || {};
  plan.openings.forEach((o, k) => {
    if (o.kind === 'window') {
      const [sill, head, vent] = windowHeights(wt[o.type], o.type);
      fl.openings.push({ id: `w${k}`, kind: 'window', label: o.type, vent, a: rid(o.into), b: null, x: o.x * FT, y: o.y * FT, horiz: o.horiz, width: o.w * FT, sill: sill * FT, head: head * FT });
      return;
    }
    const l = plan.links_all[o.link];
    if (!l) return;
    const ent = l.a === null || l.entrance;
    fl.openings.push({ id: `d${k}`, kind: ent ? 'entrance' : (l.kind === 'open' ? 'open' : 'door'), label: o.type, a: rid(l.b), b: ent ? null : rid(l.a),
      x: o.x * FT, y: o.y * FT, horiz: o.horiz, width: o.w * FT, sill: 0, head: DOOR_HEAD_FT * FT });
  });
  for (const c of plan.struct.columns) fl.columns.push({ x: c.x * FT, y: c.y * FT, size: Math.max(...c.size_mm) / 1000 });
  return fl;
}

/** One floor from a traced drawing (trace.doc in feet: rooms with tiles, openings with positions). */
function tracedFloor(f, cfg, settings) {
  const d = f.doc, H = floorHeights(cfg, f.level, settings), rid = (uid) => `${f.id}:${uid}`;
  const te = cfg.t_ext / 2, ti = cfg.t_int / 2;
  const fl = { id: f.id, level: f.level, name: f.name, ...H, rooms: [], openings: [], columns: [], source: 'trace' };
  const xs = d.rooms.flatMap((r) => [r.tile.x0, r.tile.x1]), ys = d.rooms.flatMap((r) => [r.tile.y0, r.tile.y1]);
  const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
  for (const r of d.rooms) {
    const t = r.tile, inset = (v, edge) => (Math.abs(v - edge) < 1e-6 ? te : ti);
    fl.rooms.push({ id: rid(r.uid), uid: r.uid, name: r.name, type: r.rtype, x0: t.x0 * FT, y0: t.y0 * FT, x1: t.x1 * FT, y1: t.y1 * FT,
      nx0: (t.x0 + inset(t.x0, X0)) * FT, ny0: (t.y0 + inset(t.y0, Y0)) * FT, nx1: (t.x1 - inset(t.x1, X1)) * FT, ny1: (t.y1 - inset(t.y1, Y1)) * FT,
      court: r.rtype === 'court', veranda: r.rtype === 'veranda' });
  }
  for (const o of d.openings || []) {
    if (o.kind === 'nowall') { fl.openings.push({ id: o.id, kind: 'nowall', a: rid(o.a), b: rid(o.b) }); continue; }
    fl.openings.push({ id: o.id, kind: o.kind, label: o.label || '', vent: !!o.vent, a: rid(o.a), b: o.b === null || o.b === undefined ? null : rid(o.b),
      x: o.x * FT, y: o.y * FT, horiz: o.horiz, width: o.w * FT, sill: (o.sill ?? (o.kind === 'window' ? 3 : 0)) * FT, head: (o.head ?? DOOR_HEAD_FT) * FT });
  }
  for (const c of d.columns || []) fl.columns.push({ x: c.x * FT, y: c.y * FT, size: (c.size ?? 0.75) * FT });
  return fl;
}

/**
 * House model + fan list from the project's floors. floors: [{ id, level, name, kind, cfg, doc }] (doc = active plan or
 * trace doc). Returns { house, fans: [{ roomId, x, y, type, speed, mode }], skipped: [floor names without a plan] }.
 */
export function houseFromFloors(floors, cfg, settings = defaultWindSettings(cfg)) {
  const s = { ...defaultWindSettings(cfg), ...settings };
  const house = {
    rotation: s.rotation ?? cfg.plan_north_bearing_deg ?? 0, floors: [], neighbours: neighbourBoxes(s.neighbours, cfg),
    construction: { walls: s.walls, tExt: cfg.t_ext * FT, tInt: cfg.t_int * FT, roof: s.roof, glazing: s.glazing, windowKind: s.windowKind, overhang: (s.overhangFt ?? 1.5) * FT },
    below: s.below, above: s.above, slab: (s.slabFt ?? 5 / 12) * FT,
  };
  const skipped = [], fans = [];
  for (const f of floors.slice().sort((a, b) => a.level - b.level)) {
    if (!f.doc || !Array.isArray(f.doc.rooms) || !f.doc.rooms.length) { skipped.push(f.name); continue; }
    const fl = f.kind === 'trace' ? tracedFloor(f, cfg, s) : designedFloor(f, cfg, s);
    house.floors.push(fl);
    const conf = (s.fans || {})[f.id] || {};
    for (const r of fl.rooms) {
      if (r.court) continue;
      const c = conf[r.uid];
      const n = c ? c.n : (FAN_ROOMS[r.type] ? ((r.nx1 - r.nx0) * (r.ny1 - r.ny0) > 18 && r.type === 'hall' ? 2 : 1) : 0);
      if (!n) continue;
      const net = { x0: r.nx0, y0: r.ny0, x1: r.nx1, y1: r.ny1 };
      const pos = c && Array.isArray(c.pos) && c.pos.length === n ? c.pos.map(([x, y]) => [x * FT, y * FT]) : defaultFanPositions(net, n);
      const type = (c && c.type) || s.fanDefaults.type, speed = (c && c.speed) || s.fanDefaults.speed, mode = (c && c.mode) || s.fanDefaults.mode;
      for (const [x, y] of pos) fans.push({ roomId: r.id, floorId: f.id, uid: r.uid, x, y, type, speed, mode, d: (FAN_TYPES[type] || FAN_TYPES.standard).d });
    }
  }
  return { house, fans, skipped };
}
