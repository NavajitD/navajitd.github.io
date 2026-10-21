// ArchiHelp wind — building geometry and the material / opening / gains library.
// Port of floor_wind_thermal.ipynb cells 2-4 (materials, assemblies, rooms -> walls), in metres, x east, y north.
export const MATERIALS = {                       // k W/mK, rho kg/m3, cp J/kgK (typical handbook values)
  plaster: [0.70, 1600, 840], brick: [0.72, 1800, 840], concrete: [1.70, 2400, 880], aac: [0.16, 600, 1000],
  eps: [0.035, 20, 1400], gypsum: [0.25, 900, 1000], wood: [0.15, 700, 1600], limeconcrete: [0.73, 1650, 880],
  xps: [0.034, 35, 1450], stone: [1.30, 2200, 840],
};
// layers OUTSIDE -> INSIDE as [material, thickness m]
export const WALL_TYPES = {
  brick_230: { layers: [['plaster', 0.012], ['brick', 0.230], ['plaster', 0.012]], absorptance: 0.6 },
  brick_115: { layers: [['plaster', 0.012], ['brick', 0.115], ['plaster', 0.012]], absorptance: 0.6 },
  aac_200: { layers: [['plaster', 0.012], ['aac', 0.200], ['plaster', 0.012]], absorptance: 0.6 },
  rcc_200: { layers: [['plaster', 0.012], ['concrete', 0.200], ['plaster', 0.012]], absorptance: 0.65 },
  cavity_insulated: { layers: [['plaster', 0.012], ['brick', 0.115], ['eps', 0.050], ['brick', 0.115], ['plaster', 0.012]], absorptance: 0.6 },
  gypsum_partition: { layers: [['gypsum', 0.0125], ['gypsum', 0.0125]], absorptance: 0.5 },
};
// U W/m2K (whole unit), shgc, free_frac = share of the nominal area that opens
export const OPENING_TYPES = {
  window_single: { kind: 'window', U: 5.8, shgc: 0.80, free_frac: 0.5 },
  window_double_lowE: { kind: 'window', U: 1.8, shgc: 0.40, free_frac: 0.5 },
  window_single_casement: { kind: 'window', U: 5.8, shgc: 0.80, free_frac: 0.9 },
  window_double_casement: { kind: 'window', U: 2.8, shgc: 0.60, free_frac: 0.9 },
  ventilator: { kind: 'window', U: 5.8, shgc: 0.45, free_frac: 0.8 },
  door_wood: { kind: 'door', U: 2.5, shgc: 0.0, free_frac: 1.0 },
  arch: { kind: 'arch', U: 0.0, shgc: 0.0, free_frac: 1.0 },
};

const prof = (spans, base = 0) => { const a = new Float64Array(24).fill(base); for (const [s, e, w] of spans) for (let h = s; h < e; h++) a[h] = w; return a; };
// internal gains (W) by hour of day (notebook profiles)
export const INTERNAL_GAINS_W = {
  none: new Float64Array(24),
  living: prof([[8, 18, 80], [18, 23, 250]], 40),
  kitchen: prof([[7, 9, 600], [12, 14, 400], [19, 21, 800]], 60),
  bedroom: prof([[0, 7, 120], [22, 24, 120]], 20),
};
// who is in a room when (for fans and comfort): hour -> 0/1
export const OCCUPANCY = {
  none: prof([], 0), living: prof([[7, 10, 1], [17, 23, 1]], 0), kitchen: prof([[6, 9, 1], [12, 14, 1], [18, 21, 1]], 0),
  bedroom: prof([[0, 7, 1], [22, 24, 1]], 0), study: prof([[9, 13, 1], [15, 19, 1]], 0),
};

/** Thermal resistance (m2K/W) and areal heat capacity (J/m2K) of an assembly. */
export function assemblyProps(layers) {
  let R = 0, C = 0;
  for (const [m, t] of layers) { const [k, rho, cp] = MATERIALS[m]; R += t / k; C += rho * cp * t; }
  return [R, C];
}
export const wallProps = (type, types = WALL_TYPES) => assemblyProps(types[type].layers);

/** Wall assembly of a given total thickness (m): plaster both faces + core. */
export function wallAssembly(core, thick, absorptance = 0.6) {
  const c = Math.max(0.05, thick - 0.024);
  return { layers: [['plaster', 0.012], [core, c], ['plaster', 0.012]], absorptance };
}

const TOL = 1e-6;
const ov = (a0, a1, b0, b1) => { const lo = Math.max(a0, b0), hi = Math.min(a1, b1); return hi - lo > 1e-6 ? [lo, hi] : null; };

/**
 * Walls from room rectangles: interior walls on shared edges, exterior walls on the rest (notebook derive_walls, same ids:
 * interior "RoomA|RoomB", exterior "Room:S/N/E/W", repeats get "#k").
 * opts: { typeExt, typeInt, override: {id: type}, rotation (deg), types (wall type table) }
 */
export function deriveWalls(rooms, { typeExt = 'brick_230', typeInt = 'brick_115', override = {}, rotation = 0, types = WALL_TYPES } = {}) {
  const walls = [], used = new Map();
  const add = (base, w) => { const k = used.get(base) || 0; used.set(base, k + 1); walls.push({ id: k === 0 ? base : `${base}#${k}`, ...w }); };
  rooms.forEach((a, i) => {
    for (const b of rooms.slice(i + 1)) {
      const base = `${a.name}|${b.name}`; let o;
      if (Math.abs(a.x1 - b.x0) < TOL && (o = ov(a.y0, a.y1, b.y0, b.y1))) add(base, { orient: 'V', coord: a.x1, s0: o[0], s1: o[1], A: a.name, B: b.name, n: [1, 0] });
      if (Math.abs(b.x1 - a.x0) < TOL && (o = ov(a.y0, a.y1, b.y0, b.y1))) add(base, { orient: 'V', coord: a.x0, s0: o[0], s1: o[1], A: a.name, B: b.name, n: [-1, 0] });
      if (Math.abs(a.y1 - b.y0) < TOL && (o = ov(a.x0, a.x1, b.x0, b.x1))) add(base, { orient: 'H', coord: a.y1, s0: o[0], s1: o[1], A: a.name, B: b.name, n: [0, 1] });
      if (Math.abs(b.y1 - a.y0) < TOL && (o = ov(a.x0, a.x1, b.x0, b.x1))) add(base, { orient: 'H', coord: a.y0, s0: o[0], s1: o[1], A: a.name, B: b.name, n: [0, -1] });
    }
  });
  const interior = walls.slice();
  for (const r of rooms) {
    for (const [side, orient, coord, lo, hi, n] of [['S', 'H', r.y0, r.x0, r.x1, [0, -1]], ['N', 'H', r.y1, r.x0, r.x1, [0, 1]], ['W', 'V', r.x0, r.y0, r.y1, [-1, 0]], ['E', 'V', r.x1, r.y0, r.y1, [1, 0]]]) {
      let segs = [[lo, hi]];
      for (const w of interior) {
        if (w.orient !== orient || Math.abs(w.coord - coord) >= TOL || !(w.A === r.name || w.B === r.name)) continue;
        const nw = [];
        for (const [s0, s1] of segs) {
          if (w.s1 <= s0 + TOL || w.s0 >= s1 - TOL) { nw.push([s0, s1]); continue; }
          if (w.s0 > s0 + TOL) nw.push([s0, w.s0]);
          if (w.s1 < s1 - TOL) nw.push([w.s1, s1]);
        }
        segs = nw;
      }
      for (const [s0, s1] of segs) if (s1 - s0 > 1e-6) add(`${r.name}:${side}`, { orient, coord, s0, s1, A: r.name, B: 'OUT', n });
    }
  }
  for (const w of walls) {
    w.ext = w.B === 'OUT';
    w.type = override[w.id] || (w.ext ? typeExt : typeInt);
    w.length = w.s1 - w.s0;
    w.thick = types[w.type].layers.reduce((a, [, t]) => a + t, 0);
    w.plan_bearing = ((Math.atan2(w.n[0], w.n[1]) * 180 / Math.PI) % 360 + 360) % 360;
    w.true_az = (w.plan_bearing + rotation) % 360;
  }
  return walls;
}

/** Notebook validation: unique names, no overlaps, openings inside their walls. Throws with a readable message. */
export function validate(rooms, walls, openings, types = OPENING_TYPES) {
  const names = rooms.map((r) => r.name);
  if (new Set(names).size !== names.length) throw new Error('duplicate room names');
  rooms.forEach((a, i) => {
    if (!(a.x1 > a.x0 && a.y1 > a.y0)) throw new Error(`${a.name}: degenerate`);
    for (const b of rooms.slice(i + 1)) if (ov(a.x0, a.x1, b.x0, b.x1) && ov(a.y0, a.y1, b.y0, b.y1)) throw new Error(`rooms ${a.name} and ${b.name} overlap`);
  });
  const wid = new Map(walls.map((w) => [w.id, w]));
  for (const o of openings) {
    const w = wid.get(o.wall);
    if (!w) throw new Error(`opening wall '${o.wall}' not found`);
    if (o.at - o.width / 2 < w.s0 - TOL || o.at + o.width / 2 > w.s1 + TOL) throw new Error(`opening on ${o.wall} at ${o.at} (width ${o.width}) exceeds wall span ${w.s0}..${w.s1}`);
    if (!types[o.type]) throw new Error(`unknown opening type ${o.type}`);
  }
}

/** Opening schedule: 'always' | 'never' | [[start_h, end_h], ...] (local hours). */
export function isOpen(o, hour) {
  const h = ((hour % 24) + 24) % 24;
  if (o.open_hours === 'always') return true;
  if (o.open_hours === 'never' || !o.open_hours) return false;
  return o.open_hours.some(([s, e]) => s <= h && h < e);
}

export const Window = (wall, at, width, { type = 'window_double_lowE', height = 1.2, sill = 0.9, open_hours = 'never', shade = 1.0 } = {}) => ({ wall, at, width, type, height, sill, open_hours, shade });
export const Door = (wall, at, width = 0.9, { type = 'door_wood', height = 2.1, open_hours = 'never' } = {}) => ({ wall, at, width, type, height, sill: 0, open_hours, shade: 1 });
export const Arch = (wall, at, width, height = 2.4) => ({ wall, at, width, type: 'arch', height, sill: 0, open_hours: 'always', shade: 1 });

/** The notebook's 12 m x 9 m sample flat (cell 4), used by the parity tests. */
export function notebookSample() {
  const R = (name, x0, y0, x1, y1, profile = 'none') => ({ name, x0, y0, x1, y1, profile });
  const DAYTIME = [[8, 20]], NIGHT = [[20, 24], [0, 7]];
  return {
    rooms: [R('Living', 0, 0, 6, 5, 'living'), R('Kitchen', 6, 0, 9, 5, 'kitchen'), R('Bed2', 9, 0, 12, 5, 'bedroom'), R('Corridor', 0, 5, 12, 6, 'none'),
      R('Bed1', 0, 6, 5, 9, 'bedroom'), R('Bath', 5, 6, 7, 9, 'none'), R('Study', 7, 6, 12, 9, 'living')],
    columns: [{ x: 3.0, y: 2.5, size: 0.3 }, { x: 9.5, y: 7.5, size: 0.3 }],
    neighbours: [[-14, -3, -6, 12]],
    wallTypeExt: 'brick_230', wallTypeInt: 'brick_115', override: { 'Bed2:E': 'cavity_insulated', 'Kitchen|Bed2': 'gypsum_partition' },
    openings: [
      Window('Living:S', 3.0, 2.4, { open_hours: DAYTIME }), Window('Living:W', 2.5, 1.5, { open_hours: DAYTIME }), Window('Kitchen:S', 7.5, 1.2, { open_hours: DAYTIME }),
      Window('Bed2:S', 10.5, 1.5, { open_hours: NIGHT }), Window('Bed2:E', 2.5, 1.2, { open_hours: NIGHT }), Window('Bed1:N', 2.5, 1.5, { open_hours: NIGHT }),
      Window('Bed1:W', 7.5, 1.2, { open_hours: NIGHT }), Window('Bath:N', 6.0, 0.6, { height: 0.6, sill: 1.6, open_hours: 'always' }),
      Window('Study:N', 9.5, 1.8, { open_hours: DAYTIME }), Window('Study:E', 7.5, 1.2, { open_hours: DAYTIME }),
      Door('Corridor:W', 5.5, 1.0, { open_hours: 'never' }),
      Arch('Living|Kitchen', 2.5, 2.0), Door('Living|Corridor', 5.0, 0.9, { open_hours: 'always' }), Door('Kitchen|Corridor', 7.5, 0.9, { open_hours: 'always' }),
      Door('Bed2|Corridor', 10.5, 0.9, { open_hours: 'always' }), Door('Corridor|Bed1', 2.5, 0.9, { open_hours: 'always' }), Door('Corridor|Bath', 6.0, 0.9, { open_hours: 'never' }),
      Door('Corridor|Study', 9.5, 0.9, { open_hours: 'always' })],
  };
}

/** Terrain boundary-layer factor (ASHRAE): wind at height z (m) over terrain vs the 10 m open-country reading. */
export const TERRAIN = { open: [0.14, 270], suburban: [0.22, 370], urban: [0.33, 460] };
export function windFactor(z, terrain = 'urban') {
  const [a, d] = TERRAIN[terrain] || TERRAIN.urban;
  return (270 / 10) ** 0.14 * (Math.max(z, 0.5) / d) ** a;
}
