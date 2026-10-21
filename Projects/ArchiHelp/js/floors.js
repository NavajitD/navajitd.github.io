// ArchiHelp — multi-floor projects.
//
// A project is a house. Building-wide settings (plot, heights, walls, structure, Vaastu rules, location) live in p.cfg and
// apply to every floor. Each floor has its own level, programme and plans. The ACTIVE floor's data sits at the top level
// of the project (p.plans, p.candidates, p.lastRun, p.revisions, p.activePlan, p.kind, p.trace and the floor keys of
// p.cfg), so every Floor Plan screen keeps working on "the project"; the other floors are stashed in p.floors[k].
// The staircase is shared: a floor designed after another one keeps the stair tile of the nearest designed floor.
import { newId } from './store.js';

export const FLOOR_CFG_KEYS = ['floor_level', 'floors_above', 'program', 'min_courtyards', 'max_courtyards'];
const DATA_DEFAULTS = () => ({ kind: 'design', plans: [], activePlan: 0, revisions: {}, candidates: [], lastRun: null, trace: null });
const DATA_KEYS = Object.keys(DATA_DEFAULTS());
const NAMES = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];

export const levelName = (l) => (NAMES[l] ? `${NAMES[l]} floor` : `Level ${l}`);
export const levelShort = (l) => NAMES[l] || `L${l}`;
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Upgrade a single-floor (version 1) project in place. Idempotent. */
export function ensureFloors(p) {
  if (!p) return p;
  if (!Array.isArray(p.floors) || !p.floors.length) {
    p.floors = [{ id: newId(), level: p.cfg.floor_level ?? 0 }];
    p.activeFloor = 0;
  }
  if (!(p.activeFloor >= 0 && p.activeFloor < p.floors.length)) p.activeFloor = 0;
  if (!p.kind) p.kind = 'design';
  if (p.trace === undefined) p.trace = null;
  p.version = Math.max(2, p.version || 1);
  return p;
}

/** Copy the active floor's data from the top level into its floor record (references, not copies). */
function stash(p) {
  const f = p.floors[p.activeFloor];
  for (const k of DATA_KEYS) f[k] = p[k];
  f.cfg = {};
  for (const k of FLOOR_CFG_KEYS) if (p.cfg[k] !== undefined) f.cfg[k] = p.cfg[k];
  f.level = p.cfg.floor_level ?? f.level ?? 0;
}

/** Make floor `idx` the active one (its data moves to the top level). */
export function activateFloor(p, idx) {
  ensureFloors(p);
  if (idx === p.activeFloor || !p.floors[idx]) return false;
  stash(p);
  const f = p.floors[idx], d = DATA_DEFAULTS();
  for (const k of DATA_KEYS) { p[k] = f[k] !== undefined ? f[k] : d[k]; delete f[k]; }
  for (const k of FLOOR_CFG_KEYS) if (f.cfg && f.cfg[k] !== undefined) p.cfg[k] = clone(f.cfg[k]);
  p.cfg.floor_level = f.level;
  delete f.cfg;
  // the previous active floor keeps its data in its record; the new one keeps none (it lives at the top level)
  p.activeFloor = idx;
  return true;
}

/** Every floor with its full config and data, sorted by level. Active floor data is read from the top level. */
export function floorsOf(p) {
  ensureFloors(p);
  const out = p.floors.map((f, index) => {
    const active = index === p.activeFloor;
    const data = active ? Object.fromEntries(DATA_KEYS.map((k) => [k, p[k]])) : { ...DATA_DEFAULTS(), ...Object.fromEntries(DATA_KEYS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]])) };
    const cfg = active ? p.cfg : { ...p.cfg, ...(f.cfg || {}), floor_level: f.level };
    const level = active ? (p.cfg.floor_level ?? f.level) : f.level;
    const doc = data.kind === 'trace' ? (data.trace && data.trace.doc) || null : (data.plans[data.activePlan || 0] || null);
    return { index, id: f.id, level, name: levelName(level), short: levelShort(level), active, cfg, ...data, doc };
  });
  return out.sort((a, b) => a.level - b.level);
}

export const usedLevels = (p) => floorsOf(p).map((f) => f.level);

/** Add a floor (not activated). kind: 'design' | 'trace'. Returns its index in p.floors. */
export function addFloor(p, { level, kind = 'design' } = {}) {
  ensureFloors(p);
  const fl = floorsOf(p), used = new Set(fl.map((f) => f.level));
  if (level === undefined) level = fl.length ? Math.max(...used) + 1 : 0;
  if (used.has(level)) throw new Error(`There is already a ${levelName(level).toLowerCase()}.`);
  // nearest floor: copy its programme (a reasonable start) and its column-load setting, adjusted for the new level
  const near = fl.slice().sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level))[0];
  const cfg = {};
  for (const k of FLOOR_CFG_KEYS) if (near && near.cfg[k] !== undefined) cfg[k] = clone(near.cfg[k]);
  cfg.floor_level = level;
  if (near) cfg.floors_above = Math.max(0, (near.cfg.floors_above ?? 0) + (near.level - level));
  if (cfg.program && fl.some((f) => hasStair(f))) cfg.program.stair = Math.max(1, cfg.program.stair || 0);
  const d = DATA_DEFAULTS();
  d.kind = kind;
  p.floors.push({ id: newId(), level, cfg, ...d });
  return p.floors.length - 1;
}

/** Remove a floor (never the last one). */
export function removeFloor(p, idx) {
  ensureFloors(p);
  if (p.floors.length <= 1) throw new Error('A project needs at least one floor.');
  if (idx === p.activeFloor) {
    const other = floorsOf(p).filter((f) => f.index !== idx).sort((a, b) => a.level - b.level)[0];
    activateFloor(p, other.index);
  }
  const active = p.floors[p.activeFloor];
  p.floors.splice(idx, 1);
  p.activeFloor = p.floors.indexOf(active);
}

/** Change the level of the active floor (must stay unique). */
export function setActiveLevel(p, level) {
  ensureFloors(p);
  if (floorsOf(p).some((f) => !f.active && f.level === level)) throw new Error(`There is already a ${levelName(level).toLowerCase()}.`);
  p.cfg.floor_level = level;
  p.floors[p.activeFloor].level = level;
}

const stairTile = (f) => {
  const d = f.doc;
  if (!d || !Array.isArray(d.rooms)) return null;
  const s = d.rooms.find((r) => r.rtype === 'stair');
  return s ? { ...s.tile } : null;
};
export const hasStair = (f) => !!stairTile(f);

/** Stair tile the active floor must keep (from the nearest other floor that has one), or null. */
export function fixedStairFor(p) {
  const fl = floorsOf(p), me = fl.find((f) => f.active);
  const others = fl.filter((f) => !f.active && stairTile(f)).sort((a, b) => Math.abs(a.level - me.level) - Math.abs(b.level - me.level));
  if (!others.length) return null;
  return { tile: stairTile(others[0]), from: others[0].name };
}

export const sameTile = (a, b, tol = 1e-3) => !!a && !!b && Math.abs(a.x0 - b.x0) < tol && Math.abs(a.y0 - b.y0) < tol && Math.abs(a.x1 - b.x1) < tol && Math.abs(a.y1 - b.y1) < tol;

/** Heights in feet for a floor level: finished floor level above ground, storey (floor-to-floor) height. */
export function levelHeights(cfg, level, plinthFt = 1.5) {
  const g = cfg.ground_floor_height_ft, t = cfg.typical_floor_height_ft;
  const ffl = plinthFt + (level >= 1 ? g : 0) + Math.max(0, level - 1) * t;
  return { ffl, storey: level === 0 ? g : t };
}
