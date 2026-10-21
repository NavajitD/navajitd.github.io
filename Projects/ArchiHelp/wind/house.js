// ArchiHelp wind — the 3D house: every floor at its own height, coupled through the stair well and the slabs.
//
// What the notebook treated as one middle floor with adiabatic floor and ceiling, this model builds per floor level:
//  * height above ground of every opening drives its wind speed (terrain profile) and its stack pressure;
//  * the ground floor sits on earth, an upper floor on the floor below (shared slab nodes), or on open stilts;
//    the top floor has the roof above (sun, sky radiation at night, roof build-up), others the floor above;
//  * the stair well joins the floors (net flow + buoyant exchange); a stair-top vent can make it a chimney;
//  * neighbours have heights: they shade a window only if they are taller than it, and shelter only openings below them;
//  * ceiling fans (1-3 per room, placed in plan) add occupied-zone air speed (comfort) and their motor heat;
//  * "feels like" is SET from air and radiant temperature, humidity and air speed (wind + fans).
// All lengths in metres, plan x east / y north, z up from ground level.
import { deriveWalls, wallAssembly, OPENING_TYPES, INTERNAL_GAINS_W, OCCUPANCY, assemblyProps, windFactor } from './model.js';
import { Net, makeStepper, step, RHO_CP_AIR, AIR_CAP_MULT, H_SLAB, R_SI, R_SO, CONC_RHO_CP } from './thermal.js';
import { solarPosition, interp, mod } from './weather.js';
import { makeNetwork, solve, epsteinExchange, cpSwamiChandra, incidence, shelterFactor, sunBlocked, rhoAt } from './airflow.js';
import { fanStats, fanWatts, FAN_TYPES } from './fans.js';
import { setTmp, cloFromT6, rhFromDew, adaptiveBand, airSpeedAllowance } from './comfort.js';

export const ROOFS = {
  rcc: { label: 'RCC slab, plain', layers: [['concrete', 0.125], ['plaster', 0.012]], absorptance: 0.70 },
  rcc_coba: { label: 'RCC + brick-bat coba (lime concrete)', layers: [['limeconcrete', 0.100], ['concrete', 0.125], ['plaster', 0.012]], absorptance: 0.70 },
  rcc_white: { label: 'RCC + white reflective coat', layers: [['concrete', 0.125], ['plaster', 0.012]], absorptance: 0.30 },
  rcc_insulated: { label: 'RCC + 50 mm XPS + screed', layers: [['plaster', 0.025], ['xps', 0.050], ['concrete', 0.125], ['plaster', 0.012]], absorptance: 0.70 },
};
export const WALL_CORES = { brick: ['brick', 0.6, 'Brick'], aac: ['aac', 0.6, 'AAC block'], rcc: ['concrete', 0.65, 'RCC'], stone: ['stone', 0.6, 'Stone'] };
const GLAZING = { single: { sliding: 'window_single', casement: 'window_single_casement' }, double: { sliding: 'window_double_lowE', casement: 'window_double_casement' } };
const PROFILE = { master: 'bedroom', bedroom: 'bedroom', hall: 'living', dining: 'living', kitchen: 'kitchen', study: 'living' };
const MET = { bedroom: 0.9, living: 1.1, kitchen: 1.6, none: 1.2 };
const ELA = 2.0e-4;                     // effective leakage area per m2 of exterior wall (moderately leaky masonry)
const OUT = -1;
const ovl = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Derive walls, zones, openings, stair links and the thermal + airflow networks for a house. */
export function prepareHouse(house) {
  const C = house.construction || {};
  const core = WALL_CORES[C.walls || 'brick'] || WALL_CORES.brick;
  const types = { ext: wallAssembly(core[0], C.tExt ?? 0.178, core[1]), int: wallAssembly(core[0], C.tInt ?? 0.178, core[1]) };
  const glaze = (GLAZING[C.glazing || 'single'] || GLAZING.single)[C.windowKind || 'sliding'] || 'window_single';
  const floors = house.floors.slice().sort((a, b) => a.level - b.level);
  const zones = [], warnings = [];
  floors.forEach((f, fi) => {
    f.index = fi;
    const walls = deriveWalls(f.rooms.map((r) => ({ name: r.id, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 })), { typeExt: 'ext', typeInt: 'int', rotation: house.rotation || 0, types });
    const court = new Set(f.rooms.filter((r) => r.court).map((r) => r.id)), byId = new Map(f.rooms.map((r) => [r.id, r]));
    const keep = [];
    for (const w of walls) {
      const aC = court.has(w.A), bC = court.has(w.B);
      if (aC && (bC || w.B === 'OUT')) continue;                       // court edge to the outside or another court: open
      if (aC || bC) {
        const courtId = aC ? w.A : w.B, roomId = aC ? w.B : w.A;
        if (aC) w.n = [-w.n[0], -w.n[1]];
        w.A = roomId; w.court = courtId; w.B = 'OUT'; w.ext = true; w.type = 'ext';
        w.thick = types.ext.layers.reduce((s, [, t]) => s + t, 0);
        w.plan_bearing = mod(Math.atan2(w.n[0], w.n[1]) * 180 / Math.PI, 360); w.true_az = mod(w.plan_bearing + (house.rotation || 0), 360);
      }
      keep.push(w);
    }
    f.walls = keep;
    for (const r of f.rooms) {
      if (r.court) continue;
      r.zone = zones.length;
      const area = (r.nx1 - r.nx0) * (r.ny1 - r.ny0);
      zones.push({ id: r.id, name: r.name, type: r.type, floor: fi, level: f.level, zref: f.ffl, area, volume: area * f.ceil, room: r,
        profile: r.profile || PROFILE[r.type] || 'none', veranda: !!r.veranda });
    }
    // openings onto walls
    const opens = [];
    const findWall = (o) => {
      const at = o.horiz ? o.x : o.y, line = o.horiz ? o.y : o.x, orient = o.horiz ? 'H' : 'V';
      const cand = f.walls.filter((w) => w.orient === orient && Math.abs(w.coord - line) < 0.25 && at >= w.s0 - 0.15 && at <= w.s1 + 0.15 &&
        (o.b ? ((w.A === o.a && w.B === o.b) || (w.A === o.b && w.B === o.a)) : (w.A === o.a && w.ext && (!o.toCourt || w.court === o.toCourt))));
      cand.sort((p, q) => Math.abs(p.coord - line) - Math.abs(q.coord - line));
      return cand[0] || null;
    };
    for (const o0 of f.openings || []) {
      let o = o0;
      if (o.b && court.has(o.b)) o = { ...o, b: null, toCourt: o.b };              // into a courtyard = to the open air
      else if (o.a && court.has(o.a)) o = { ...o, a: o.b, b: null, toCourt: o.a };
      if (!o.a || court.has(o.a)) continue;
      if (o.kind === 'nowall' && !o.b) continue;
      if (o.kind === 'nowall') {
        for (const w of f.walls) if (!w.ext && ((w.A === o.a && w.B === o.b) || (w.A === o.b && w.B === o.a))) {
          w.open = true;
          opens.push({ id: `${o.id}:${w.id}`, kind: 'nowall', a: o.a, b: o.b, wallObj: w, wall: w.id, at: (w.s0 + w.s1) / 2, width: w.length, sill: 0, head: f.ceil, type: 'arch', schedule: 'always', cd: 0.8 });
        }
        continue;
      }
      const w = findWall(o);
      if (!w) { warnings.push(`${f.name}: ${o.kind} ${o.label || ''} is not on a wall of ${byId.get(o.a) ? byId.get(o.a).name : o.a}`); continue; }
      const at = Math.min(Math.max(o.horiz ? o.x : o.y, w.s0 + o.width / 2), w.s1 - o.width / 2);
      const type = o.kind === 'window' ? (o.vent ? 'ventilator' : glaze) : (o.kind === 'door' || o.kind === 'entrance' ? 'door_wood' : 'arch');
      opens.push({ ...o, wallObj: w, wall: w.id, at, width: Math.min(o.width, w.length), type, cd: o.kind === 'open' ? 0.65 : 0.6, court: w.court || null });
    }
    // veranda railings: the outer walls of a veranda are a parapet with open air above
    for (const r of f.rooms) {
      if (!r.veranda) continue;
      for (const w of f.walls) if (w.A === r.id && w.ext && !w.court) {
        w.railing = true;
        opens.push({ id: `rail:${w.id}`, kind: 'railing', a: r.id, b: null, wallObj: w, wall: w.id, at: (w.s0 + w.s1) / 2, width: Math.max(0.3, w.length - 0.3), sill: 0.9, head: Math.max(1.5, f.ceil - 0.3), type: 'arch', schedule: 'always', cd: 0.8 });
      }
    }
    f.opens = opens;
    for (const o of opens) {
      o.zb = f.ffl + o.sill; o.zt = f.ffl + Math.min(o.head, f.ceil); o.floor = fi;
      o.effHeight = Math.max(0.05, Math.min(o.head - o.sill, f.ceil)) * (OPENING_TYPES[o.type].free_frac);
      o.ext = !o.b;
      const w = o.wallObj, mid = w.orient === 'H' ? [o.at, w.coord] : [w.coord, o.at];
      o.mid = mid; o.az = w.true_az; o.planAz = w.plan_bearing;
    }
  });
  // stair wells between consecutive floors; stair-top vent
  const stairs = [];
  for (let k = 0; k + 1 < floors.length; k++) {
    const lo = floors[k], up = floors[k + 1];
    if (up.level !== lo.level + 1) continue;
    for (const a of lo.rooms.filter((r) => r.type === 'stair')) for (const b of up.rooms.filter((r) => r.type === 'stair')) {
      const A = ovl(a.nx0, a.nx1, b.nx0, b.nx1) * ovl(a.ny0, a.ny1, b.ny0, b.ny1);
      if (A > 1) stairs.push({ lower: a.zone, upper: b.zone, area: 0.6 * A, z: up.ffl, rect: { x0: Math.max(a.nx0, b.nx0), y0: Math.max(a.ny0, b.ny0), x1: Math.min(a.nx1, b.nx1), y1: Math.min(a.ny1, b.ny1) } });
    }
  }
  const top = floors[floors.length - 1], topStair = (house.above || 'roof') === 'roof' ? top.rooms.find((r) => r.type === 'stair') : null;
  const mumty = topStair ? { zone: topStair.zone, zb: top.ffl + top.storey + 1.2, zt: top.ffl + top.storey + 1.8, width: 0.9, x: (topStair.nx0 + topStair.nx1) / 2, y: (topStair.ny0 + topStair.ny1) / 2 } : null;
  const model = { house, floors, zones, stairs, mumty, types, warnings, rotation: house.rotation || 0 };
  model.thermal = thermalNetwork(model);
  model.air = airNetwork(model);
  return model;
}

/** Thermal network: air per zone, floor / ceiling / roof / slab nodes, wall nodes; windows; leakage background. */
function thermalNetwork(model) {
  const { floors, zones, types, stairs, house } = model, net = new Net();
  const C = house.construction || {};
  for (const z of zones) net.node(`air:${z.id}`, RHO_CP_AIR * z.volume * AIR_CAP_MULT, true);
  const roof = ROOFS[C.roof || 'rcc'] || ROOFS.rcc, [Rroof, Croof] = assemblyProps(roof.layers);
  const slabT = house.slab ?? 0.125, Rslab = slabT / 1.70, Cslab = slabT * CONC_RHO_CP;
  const meta = { floorNode: new Int32Array(zones.length).fill(-1), ceilNodes: zones.map(() => []), sa: [], roofs: [], windows: [], walls: [], ground: [] };
  const below = house.below || 'auto', above = house.above || 'roof';
  floors.forEach((f, fi) => {
    const isLow = fi === 0, isTop = fi === floors.length - 1;
    for (const r of f.rooms) {
      if (r.court) continue;
      const z = zones[r.zone], A = z.area;
      // floor side
      const lowMode = isLow ? (below === 'auto' ? (f.level === 0 ? 'ground' : 'indoor') : below) : 'slab';
      if (lowMode === 'ground') {
        const n = net.node(`floor:${z.id}`, A * 0.10 * CONC_RHO_CP); net.link(r.zone, n, H_SLAB * A);
        net.boundary(n, A / (0.10 / 1.7 + 1.0), 'ground'); meta.floorNode[r.zone] = n; meta.ground.push(n);
      } else if (lowMode === 'open') {
        const n = net.node(`floor:${z.id}`, A * Cslab); net.link(r.zone, n, A / (1 / H_SLAB + Rslab / 2)); net.gOut[n] += A / (Rslab / 2 + 1 / 10); meta.floorNode[r.zone] = n;
      } else if (lowMode === 'indoor') {
        const n = net.node(`floor:${z.id}`, A * 0.08 * CONC_RHO_CP); net.link(r.zone, n, H_SLAB * A); meta.floorNode[r.zone] = n;
      }
      // ceiling side (top floor: roof or an unmodelled floor; between modelled floors: shared slabs, below)
      if (isTop) {
        if (above === 'roof') {
          const n = net.node(`roof:${z.id}`, A * Croof); net.link(r.zone, n, A / (1 / H_SLAB + Rroof / 2));
          net.boundary(n, A / (Rroof / 2 + 1 / 20), `roof:${r.zone}`); meta.ceilNodes[r.zone].push(n);
          meta.roofs.push({ node: n, zone: r.zone, x: (r.nx0 + r.nx1) / 2, y: (r.ny0 + r.ny1) / 2, z: f.ffl + f.storey, absorptance: roof.absorptance, area: A });
        } else { const n = net.node(`ceil:${z.id}`, A * 0.08 * CONC_RHO_CP); net.link(r.zone, n, H_SLAB * A); meta.ceilNodes[r.zone].push(n); }
      }
    }
    // shared slabs with the floor above (an unmodelled floor in between: both sides adiabatic)
    if (!isTop && floors[fi + 1].level - f.level !== 1) {
      for (const a of f.rooms) if (!a.court) { const A = zones[a.zone].area, n = net.node(`ceil:${zones[a.zone].id}`, A * 0.08 * CONC_RHO_CP); net.link(a.zone, n, H_SLAB * A); meta.ceilNodes[a.zone].push(n); }
      for (const b of floors[fi + 1].rooms) if (!b.court && meta.floorNode[b.zone] < 0) { const A = zones[b.zone].area, n = net.node(`floor:${zones[b.zone].id}`, A * 0.08 * CONC_RHO_CP); net.link(b.zone, n, H_SLAB * A); meta.floorNode[b.zone] = n; }
    } else if (!isTop) {
      const up = floors[fi + 1];
      for (const a of f.rooms) {
        if (a.court) continue;
        let covered = 0;
        for (const b of up.rooms) {
          if (b.court) continue;
          let A = ovl(a.nx0, a.nx1, b.nx0, b.nx1) * ovl(a.ny0, a.ny1, b.ny0, b.ny1);
          const st = stairs.find((s) => s.lower === a.zone && s.upper === b.zone); if (st) A -= st.area;
          if (A < 0.05) continue;
          covered += A;
          const n = net.node(`slab:${zones[a.zone].id}/${zones[b.zone].id}`, A * Cslab), g = A / (1 / H_SLAB + Rslab / 2);
          net.link(a.zone, n, g); net.link(b.zone, n, g);
          meta.ceilNodes[a.zone].push(n); if (meta.floorNode[b.zone] < 0) meta.floorNode[b.zone] = n;
        }
        const rest = zones[a.zone].area - covered;            // part of the room with no floor above (terrace / setback): roof
        if (rest > 0.5) {
          const n = net.node(`roof:${zones[a.zone].id}`, rest * Croof); net.link(a.zone, n, rest / (1 / H_SLAB + Rroof / 2));
          net.boundary(n, rest / (Rroof / 2 + 1 / 20), `roof:${a.zone}`); meta.ceilNodes[a.zone].push(n);
          meta.roofs.push({ node: n, zone: a.zone, x: (a.nx0 + a.nx1) / 2, y: (a.ny0 + a.ny1) / 2, z: f.ffl + f.storey, absorptance: roof.absorptance, area: rest });
        }
      }
      for (const b of up.rooms) if (!b.court && meta.floorNode[b.zone] < 0) {      // upper rooms over nothing: exposed floor
        const A = zones[b.zone].area, n = net.node(`floor:${zones[b.zone].id}`, A * Cslab);
        net.link(b.zone, n, A / (1 / H_SLAB + Rslab / 2)); net.gOut[n] += A / (Rslab / 2 + 1 / 10); meta.floorNode[b.zone] = n;
      }
    }
    // walls
    const byId = new Map(f.rooms.map((r) => [r.id, r]));
    const opsOn = new Map(); for (const o of f.opens) { if (!opsOn.has(o.wall)) opsOn.set(o.wall, []); opsOn.get(o.wall).push(o); }
    for (const w of f.walls) {
      if (w.open) continue;
      const ra = byId.get(w.A), ia = ra.zone, ib = w.ext ? -1 : byId.get(w.B).zone;
      const ops = opsOn.get(w.id) || [];
      const h = w.railing ? 0.9 : f.ceil, area = w.length * h;
      const openArea = w.railing ? 0 : ops.reduce((s, o) => s + o.width * Math.max(0, Math.min(o.head, f.ceil) - o.sill), 0);
      const aOp = Math.max(area - openArea, 0), [Rl, Ca] = assemblyProps(types[w.type].layers);
      if (aOp > 0.01) {
        const n = net.node(`wall:${f.index}:${w.id}`, aOp * Ca);
        net.link(ia, n, aOp / (R_SI + Rl / 2));
        if (w.ext) {
          net.boundary(n, aOp / (R_SO + Rl / 2), `sa:${n}`);
          const mid = w.orient === 'H' ? [(w.s0 + w.s1) / 2, w.coord] : [w.coord, (w.s0 + w.s1) / 2];
          meta.sa.push({ node: n, az: w.true_az, a: types.ext.absorptance, x: mid[0], y: mid[1], z: f.ffl + h / 2, court: !!w.court });
        } else net.link(ib, n, aOp / (R_SI + Rl / 2));
        meta.walls.push({ node: n, zones: [ia, ib], area: aOp, R: Rl });
      }
      for (const o of ops) {
        if (o.kind === 'railing' || o.kind === 'nowall') continue;
        const ot = OPENING_TYPES[o.type], a = o.width * Math.max(0, Math.min(o.head, f.ceil) - o.sill);
        if (ot.U > 0) { if (w.ext) net.gOut[ia] += ot.U * a; else net.link(ia, ib, ot.U * a); }
        if (w.ext && ot.shgc > 0) meta.windows.push({ zone: ia, az: w.true_az, gain: ot.shgc * a * 0.85, U: ot.U, area: a, x: o.mid[0], y: o.mid[1], z: (o.zb + o.zt) / 2, h: Math.max(0.1, o.zt - o.zb), overhang: o.kind === 'window' ? (house.construction?.overhang ?? 0.45) : 0, court: !!o.court });
      }
      if (w.ext) net.gOut[ia] += RHO_CP_AIR * 0.0001 * area;      // turbulent background exchange (the network adds leakage)
    }
  });
  return { net, meta };
}

/** Airflow network links (zone indices; -1 = outdoor). */
function airNetwork(model) {
  const { floors, zones, stairs, mumty } = model, links = [], opIndex = [];
  const fp = floors.map((f) => {
    const xs = f.rooms.flatMap((r) => [r.x0, r.x1]), ys = f.rooms.flatMap((r) => [r.y0, r.y1]);
    return { ew: Math.max(...xs) - Math.min(...xs), ns: Math.max(...ys) - Math.min(...ys) };
  });
  floors.forEach((f, fi) => {
    const byId = new Map(f.rooms.map((r) => [r.id, r]));
    for (const o of f.opens) {
      const a = byId.get(o.a).zone, b = o.b ? byId.get(o.b).zone : OUT;
      const free = OPENING_TYPES[o.type].free_frac;
      const L = { kind: 'v', a, b, zb: o.zb, zt: o.zt, width: o.width * free, cd: o.cd || 0.6, op: o, floor: fi };
      if (b === OUT) {
        const horizNormal = Math.abs(Math.sin(o.planAz * Math.PI / 180)) < 0.5;          // normal north/south
        L.side = horizNormal ? fp[fi].ew / Math.max(fp[fi].ns, 0.1) : fp[fi].ns / Math.max(fp[fi].ew, 0.1);
        L.az = o.az; L.court = !!o.court; L.x = o.mid[0]; L.y = o.mid[1];
      }
      o.link = links.length; opIndex.push(links.length); links.push(L);
      // a closed door still leaks under the leaf
      if (o.kind === 'door' || o.kind === 'entrance') links.push({ kind: 'v', a, b, zb: o.zb, zt: o.zb + 0.012, width: o.width, cd: 0.6, leak: true, of: o.link, floor: fi, side: L.side, az: L.az, court: L.court, x: L.x, y: L.y });
    }
    // wall leakage: two orifices per exterior wall segment (bottom and top quarter)
    for (const w of f.walls) {
      if (!w.ext || w.open || w.railing) continue;
      const a = byId.get(w.A).zone, area = w.length * f.ceil, mid = w.orient === 'H' ? [(w.s0 + w.s1) / 2, w.coord] : [w.coord, (w.s0 + w.s1) / 2];
      const horizNormal = Math.abs(Math.sin(w.plan_bearing * Math.PI / 180)) < 0.5;
      const side = horizNormal ? fp[fi].ew / Math.max(fp[fi].ns, 0.1) : fp[fi].ns / Math.max(fp[fi].ew, 0.1);
      for (const fr of [0.25, 0.75]) {
        const z = f.ffl + fr * f.ceil;
        links.push({ kind: 'v', a, b: OUT, zb: z - 0.05, zt: z + 0.05, width: ELA * area / 2 / 0.1 / 0.6, cd: 0.6, leak: true, always: true, floor: fi, side, az: w.true_az, court: !!w.court, x: mid[0], y: mid[1] });
      }
    }
  });
  for (const s of stairs) { s.link = links.length; links.push({ kind: 'h', a: s.lower, b: s.upper, z: s.z, area: s.area, cd: 0.6, always: true, stair: s }); }
  if (mumty) { mumty.link = links.length; links.push({ kind: 'v', a: mumty.zone, b: OUT, zb: mumty.zb, zt: mumty.zt, width: mumty.width, cd: 0.6, mumty: true, cpFixed: -0.5, x: mumty.x, y: mumty.y }); }
  return makeNetwork(zones.map((z) => ({ zref: z.zref })), links);
}

// ------------------------------------------------------------------------------------------------ simulation
const hourly = (arr, t) => interp(t, arr.__hk || (arr.__hk = Array.from({ length: arr.length }, (_, k) => k)), arr);
const hourlyS = (arr, t) => interp(t, arr.__hkS || (arr.__hkS = Array.from({ length: arr.length }, (_, k) => k - 0.5)), arr);
function skyTemp(T, td, cc) {
  const e = (0.711 + 0.56 * (td / 100) + 0.73 * (td / 100) ** 2) * (1 + 0.0224 * (cc / 10) - 0.0035 * (cc / 10) ** 2 + 0.00028 * (cc / 10) ** 3);
  return Math.min(1, Math.max(0.5, e)) ** 0.25 * (T + 273.15) - 273.15;
}
const schedOpen = (s, hour) => (s === 'always' ? true : s === 'never' ? false : s === 'day' ? hour >= 7 && hour < 20 : s === 'night' ? hour >= 20 || hour < 7 : null);

/**
 * Simulate a day (after spin-up days) for a prepared house. wx: weather series (weather.js) from local midnight,
 * spin-up days first. opts: { lat, lon, dt, spinupDays, tGround, meanOutdoor, india, windows, interiorDoors, bathDoors,
 * mumty, fans: [{ zone, x, y, type, speed, mode, d, q, blade }], terrain, frameMin }.
 */
export function simulateHouse(model, wx, opts) {
  const { lat, lon, dt = 300, spinupDays = 3, terrain = 'urban', frameMin = 15 } = opts;
  const { net, meta } = model.thermal, air = model.air, zones = model.zones, nZ = zones.length, floors = model.floors;
  const stp = makeStepper(net, dt), N = net.N;
  const nSteps = Math.round((wx.n - 1) * 3600 / dt), stepsPerFrame = Math.round(frameMin * 60 / dt), stepsPerHour = Math.round(3600 / dt);
  const dayStart = spinupDays * 24 * 3600 / dt;
  const rot = model.rotation, nb = (model.house.neighbours || []);
  const tGround = opts.tGround ?? (wx.T.reduce((a, v) => a + v, 0) / wx.T.length + 1);
  // fans per zone
  const fansBy = zones.map(() => []);
  for (const f of opts.fans || []) if (fansBy[f.zone]) fansBy[f.zone].push({ ...f, d: f.d ?? (FAN_TYPES[f.type] || FAN_TYPES.standard).d, q: f.q ?? (FAN_TYPES[f.type] || FAN_TYPES.standard).q });
  const fanAvg = zones.map((z, i) => {
    const F = fansBy[i]; if (!F.length) return { seated: 0, lying: 0 };
    const ceil = floors[z.floor].ceil, per = z.area / F.length, f0 = F[0], blade = Math.max(2.3, ceil - 0.35);
    const s = (seated) => fanStats({ d: f0.d, q: f0.q, speed: f0.speed || 'high', blade, ceiling: ceil, area: per, seated }).avg;
    return { seated: s(true), lying: s(false) * 0.9 };
  });
  const T = new Float64Array(N);
  let m0 = 0; for (let k = 0; k < 24; k++) m0 += wx.T[k]; m0 /= 24; T.fill(m0);
  const P = new Float64Array(nZ);
  const open = new Float64Array(air.links.length);
  // per-opening sun / shelter precomputation helpers
  const winOpenFloor = floors.map(() => false), fanOn = zones.map(() => false);
  const occ = (z, hour) => (OCCUPANCY[z.profile] || OCCUPANCY.none)[hour] > 0;
  const india = opts.india ?? true, band = adaptiveBand(opts.meanOutdoor ?? m0, { india });
  // outputs
  const nFrames = Math.round(24 * 60 / frameMin) + 1;
  const out = {
    frameMin, nFrames, band, tGround,
    Tair: zones.map(() => new Float64Array(nFrames)), Tmrt: zones.map(() => new Float64Array(nFrames)), RH: zones.map(() => new Float64Array(nFrames)),
    vWind: zones.map(() => new Float64Array(nFrames)), vFan: zones.map(() => new Float64Array(nFrames)), SET: zones.map(() => new Float64Array(nFrames)),
    Tout: new Float64Array(nFrames), roofT: new Float64Array(nFrames), roofSlab: new Float64Array(nFrames),
    hours: [],
  };
  let lastFlows = null;
  const decide = (hourIdx, hour) => {
    const pr = wx.pr[Math.min(hourIdx, wx.n - 1)] || 0, U10 = wx.ws[Math.min(hourIdx, wx.n - 1)], To = wx.T[Math.min(hourIdx, wx.n - 1)];
    floors.forEach((f, fi) => {
      const zs = zones.filter((z) => z.floor === fi && !z.veranda);
      const Tin = zs.reduce((a, z) => a + T[zones.indexOf(z)] * z.area, 0) / Math.max(1e-6, zs.reduce((a, z) => a + z.area, 0));
      const s = schedOpen(opts.windows || 'auto', hour);
      // auto: open when it is warm inside and cooler outside; keep open while the outdoor air is still comfortable and
      // the rooms are not getting cold (hysteresis, so windows do not flap open / shut every hour)
      const fair = pr < 1.0 && U10 < 12;
      const openNow = fair && Tin >= band.neutral && To <= Tin - 1.0 && To < band.hi;
      const keepOpen = fair && winOpenFloor[fi] && To < band.hi && To < Tin + 1.5 && Tin >= band.lo + 0.5;
      winOpenFloor[fi] = s !== null ? s : (openNow || keepOpen);
    });
    air.links.forEach((L, k) => {
      if (L.always) { open[k] = 1; return; }
      if (L.mumty) { const s = schedOpen(opts.mumty || 'never', hour); open[k] = (s !== null ? s : winOpenFloor[floors.length - 1]) ? 1 : 0; return; }
      if (L.leak) { open[k] = open[L.of] ? 0 : 1; return; }       // door undercut only while the door is shut
      const o = L.op;
      let on;
      if (o.kind === 'window') on = o.vent ? true : winOpenFloor[L.floor];
      else if (o.kind === 'entrance') on = false;
      else if (o.kind === 'door') {
        const bath = zones[L.a].type === 'bath' || (L.b >= 0 && zones[L.b].type === 'bath');
        const mode = bath ? (opts.bathDoors || 'closed') : (opts.interiorDoors || 'open');
        on = mode === 'open' ? true : mode === 'closed' ? false : !(hour >= 22 || hour < 6);
        if (L.b === OUT) on = false;
      } else on = true;                                             // openings, arches, missing walls, railings
      if (o.schedule && o.schedule !== 'auto' && o.kind !== 'nowall' && o.kind !== 'railing') { const s = schedOpen(o.schedule, hour); if (s !== null) on = s; }
      open[k] = on ? 1 : 0;
    });
    // fans
    zones.forEach((z, i) => {
      if (!fansBy[i].length) { fanOn[i] = false; return; }
      const mode = fansBy[i][0].mode || 'auto', top = 0.5 * (T[i] + (meta.floorNode[i] >= 0 ? T[meta.floorNode[i]] : T[i]));
      fanOn[i] = mode === 'always' ? true : mode === 'off' ? false : mode === 'occupied' ? occ(z, hour) : (occ(z, hour) && top > 26);
    });
  };
  for (let n = 1; n <= nSteps; n++) {
    const tS = n * dt, tH = tS / 3600, hourIdx = Math.floor((n - 1) * dt / 3600), hour = hourIdx % 24;
    if ((n - 1) * dt % 3600 === 0) decide(hourIdx, hour);
    const Tout = hourly(wx.T, tH), U10 = hourly(wx.ws, tH), wd = wx.wd[Math.min(Math.round(tH), wx.n - 1)];
    const ghi = hourlyS(wx.ghi, tH), dni = hourlyS(wx.dni, tH), dhi = hourlyS(wx.dhi, tH), td = hourly(wx.td, tH), cc = hourly(wx.cc, tH);
    const [alt, saz] = solarPosition(wx.t0Utc + tS, lat, lon), sazPlan = mod(saz - rot, 360), wdPlan = mod(wd - rot, 360);
    // airflow
    const wind = (z, L) => {
      const u = U10 * windFactor(z, terrain);
      return L.x !== undefined ? u * shelterFactor(L.x, L.y, z, wdPlan, nb) : u;
    };
    air.links.forEach((L) => { if (L.kind === 'v' && L.b === OUT) L.cp = L.cpFixed ?? (L.court ? -0.35 : cpSwamiChandra(incidence(wd, L.az), L.side)); });
    const sol = solve(air, { T: Array.from({ length: nZ }, (_, i) => T[i]), Tout, open, wind, P });
    const flows = [], exch = [];
    air.links.forEach((L, k) => {
      if (!(open[k] > 0)) return;
      const [qab, qba] = sol.q[k];
      if (qab > 0) flows.push([L.a, L.b, RHO_CP_AIR * qab]);
      if (qba > 0) flows.push([L.b, L.a, RHO_CP_AIR * qba]);
      if (L.kind === 'h' && L.b >= 0) { const qe = epsteinExchange(L.area, T[L.a], T[L.b]); if (qe > 0) exch.push([L.a, L.b, RHO_CP_AIR * qe]); }
    });
    lastFlows = sol;
    if (n - 1 >= dayStart && (n - 1 - dayStart) % stepsPerHour === 0) {
      out.hours.push({ hour: (n - 1 - dayStart) * dt / 3600, Tout, U10, wd, alt, az: saz, windowsOpen: winOpenFloor.slice(), fanOn: fanOn.slice(),
        open: Array.from(open), q: sol.q.map((v) => [v[0], v[1]]), it: sol.it, Usite: floors.map((f) => U10 * windFactor(f.ffl + 1.5, terrain)),
        stairs: model.stairs.map((s2) => { const v = sol.q[s2.link]; return { up: v[0], down: v[1], exch: epsteinExchange(s2.area, T[s2.lower], T[s2.upper]) }; }) });
    }
    // boundaries
    const bndT = { ground: tGround };
    const fac = (az, x, y, z, court) => {
      const cosInc = Math.cos(alt * Math.PI / 180) * Math.cos((saz - az) * Math.PI / 180);
      let direct = alt > 0 && cosInc > 0 ? dni * cosInc : 0;
      if (direct > 0 && sunBlocked(x, y, z, alt, sazPlan, nb)) direct = 0;
      return (court ? 0.6 : 1) * direct + 0.5 * dhi * (court ? 0.6 : 1) + 0.5 * 0.2 * ghi;
    };
    for (const s of meta.sa) bndT[`sa:${s.node}`] = Tout + s.a * fac(s.az, s.x, s.y, s.z, s.court) / 17.0;
    const Tsky = skyTemp(Tout, td, cc), hr = 5.5, hc = 20 - hr;
    let roofSum = 0;
    for (const r of meta.roofs) {
      const Ih = sunBlocked(r.x, r.y, r.z, alt, sazPlan, nb) ? dhi : ghi;
      bndT[`roof:${r.zone}`] = (hc * Tout + hr * Tsky + r.absorptance * Ih) / (hc + hr);
      roofSum += bndT[`roof:${r.zone}`];
    }
    const S = new Float64Array(N);
    for (const w of meta.windows) {
      const cosInc = Math.cos(alt * Math.PI / 180) * Math.cos((saz - w.az) * Math.PI / 180);
      let direct = alt > 0 && cosInc > 0 ? dni * cosInc : 0;
      if (direct > 0 && w.overhang > 0) { const tanO = Math.tan(alt * Math.PI / 180) / Math.max(cosInc / Math.cos(alt * Math.PI / 180), 1e-3); direct *= 1 - Math.min(1, w.overhang * tanO / w.h); }
      if (direct > 0 && sunBlocked(w.x, w.y, w.z, alt, sazPlan, nb)) direct = 0;
      const diff = 0.5 * dhi * (1 - 0.25 * Math.min(1, w.overhang / w.h)) + 0.5 * 0.2 * ghi;
      const qs = w.gain * ((w.court ? 0.6 : 1) * direct + diff), fn = meta.floorNode[w.zone];
      S[w.zone] += fn >= 0 ? 0.5 * qs : qs; if (fn >= 0) S[fn] += 0.5 * qs;
    }
    zones.forEach((z, i) => { S[i] += INTERNAL_GAINS_W[z.profile] ? INTERNAL_GAINS_W[z.profile][hour] : 0; if (fanOn[i]) S[i] += fansBy[i].reduce((a, f) => a + fanWatts(f.type, f.speed), 0); });
    step(stp, T, { Tout, gOut: net.gOut, bndT, S, flows, exch });
    // frames
    if (n >= dayStart && (n - dayStart) % stepsPerFrame === 0) {
      const f = (n - dayStart) / stepsPerFrame, hourF = Math.floor(((n - dayStart) * dt) / 3600) % 24;
      out.Tout[f] = Tout; out.roofT[f] = meta.roofs.length ? roofSum / meta.roofs.length : NaN;
      out.roofSlab[f] = meta.roofs.length ? meta.roofs.reduce((a, r) => a + T[r.node], 0) / meta.roofs.length : NaN;
      const t6 = hourly(wx.T, (spinupDays * 24) + 6), clo = cloFromT6(t6);
      zones.forEach((z, i) => {
        const fl = floors[z.floor];
        out.Tair[i][f] = T[i];
        // mean radiant: surfaces weighted by area (walls, floor, ceiling, windows)
        let sw = 0, st = 0;
        for (const w of meta.walls) { const k = w.zones.indexOf(i); if (k < 0) continue; const ts = T[i] + (T[w.node] - T[i]) * R_SI / (R_SI + w.R / 2); sw += w.area; st += w.area * ts; }
        const fn = meta.floorNode[i]; if (fn >= 0) { const ts = T[i] + (T[fn] - T[i]) * 0.5; sw += z.area; st += z.area * ts; }
        for (const cn of meta.ceilNodes[i]) { const ts = T[i] + (T[cn] - T[i]) * 0.6; sw += z.area / meta.ceilNodes[i].length; st += z.area / meta.ceilNodes[i].length * ts; }
        for (const w of meta.windows) if (w.zone === i) { const ts = T[i] - w.U / 7.7 * (T[i] - Tout); sw += w.area; st += w.area * ts; }
        const mrt = sw > 0 ? st / sw : T[i];
        out.Tmrt[i][f] = mrt;
        const rh = rhFromDew(T[i], td); out.RH[i][f] = rh;
        let qin = 0; air.links.forEach((L, k) => { if (!(open[k] > 0)) return; const [qab, qba] = sol.q[k]; if (L.b === i) qin += qab; if (L.a === i) qin += qba; });
        const vW = Math.min(1.5, Math.max(0.05, qin / (Math.sqrt(z.area) * fl.ceil)));
        const lying = z.profile === 'bedroom' && (hourF >= 22 || hourF < 7);
        const vF = fanOn[i] ? (lying ? fanAvg[i].lying : fanAvg[i].seated) : 0;
        out.vWind[i][f] = vW; out.vFan[i][f] = vF;
        const v = Math.sqrt(vW * vW + vF * vF), met = lying ? 0.9 : (MET[z.profile] || 1.1);
        let s = NaN; try { s = setTmp(T[i], mrt, Math.min(v, 2.5), rh, met, clo + (lying ? 0.15 : 0), { position: lying ? 'sitting' : 'standing' }); } catch { /* out of range */ }
        out.SET[i][f] = s;
      });
    }
  }
  if (out.hours.length) out.hours.push({ ...out.hours[out.hours.length - 1], hour: out.hours.length });   // 24:00 = the last hour's state
  // summary per zone
  out.summary = zones.map((z, i) => {
    const a = out.Tair[i], s = out.SET[i];
    const top = Array.from(a, (v, f) => 0.5 * (v + out.Tmrt[i][f]));
    let ok = 0; top.forEach((v, f) => { if (f === top.length - 1) return; const hi = band.hi + (v > 25 ? airSpeedAllowance(Math.hypot(out.vWind[i][f], out.vFan[i][f])) : 0); if (v >= band.lo && v <= hi) ok++; });
    const ach = out.hours.map((h) => { let q = 0; air.links.forEach((L, k) => { if (!(h.open[k] > 0)) return; if (L.b === i) q += h.q[k][0]; if (L.a === i) q += h.q[k][1]; }); return q * 3600 / z.volume; });
    return { min: Math.min(...a), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length, setMin: Math.min(...s.filter(Number.isFinite)), setMax: Math.max(...s.filter(Number.isFinite)),
      comfortHours: ok * frameMin / 60, achMean: ach.reduce((x, y) => x + y, 0) / Math.max(ach.length, 1), achMax: Math.max(0, ...ach) };
  });
  out.lastFlows = lastFlows;
  return out;
}
