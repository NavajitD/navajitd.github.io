// ArchiHelp wind circulation engine — parity with floor_wind_thermal.ipynb and pythermalcomfort, plus the 3D house
// model (floors at their heights, stair well, fans) and the multi-floor project helpers.
// Fixtures: wind_nb_ref.json = the notebook run offline (synthetic weather, coarse 0.5 m grid, 200 LBM steps) with its
// solar angles, walls, masks, one LBM field, opening fluxes, thermal network and temperatures dumped; wind_set_ref.json =
// pythermalcomfort set_tmp() on 18 cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { solarPosition, seasonSet, typicalDay, profileSeries, syntheticSeries, vectorMeanDir, dewPoint } from '../../Projects/ArchiHelp/wind/weather.js';
import { deriveWalls, notebookSample, windFactor } from '../../Projects/ArchiHelp/wind/model.js';
import { makeGrid, buildMask, lbmSolve, openingFlux, balanceFluxes } from '../../Projects/ArchiHelp/wind/lbm.js';
import { runNotebook, effHeight, siteWind } from '../../Projects/ArchiHelp/wind/thermal.js';
import { setTmp, adaptiveBand, cloFromT6 } from '../../Projects/ArchiHelp/wind/comfort.js';
import { fanStats, fanField, defaultFanPositions } from '../../Projects/ArchiHelp/wind/fans.js';
import { solve, cpSwamiChandra, orifice, epsteinExchange } from '../../Projects/ArchiHelp/wind/airflow.js';
import { prepareHouse, simulateHouse } from '../../Projects/ArchiHelp/wind/house.js';
import { houseFromFloors, floorHeights } from '../../Projects/ArchiHelp/wind/fromplan.js';
import { buildModel, dayList, runDay, dayOptions, lbmGeometry, gridFromGeometry, floorState, binOf } from '../../Projects/ArchiHelp/wind/sim.js';
import { ensureFloors, addFloor, activateFloor, floorsOf, fixedStairFor, removeFloor, levelHeights } from '../../Projects/ArchiHelp/js/floors.js';
import { traceToFeet } from '../../Projects/ArchiHelp/js/trace.js';
import { generate } from '../../Projects/ArchiHelp/engine/generator.js';

const HERE = dirname(fileURLToPath(import.meta.url)), FIX = join(HERE, '..', 'fixtures', 'archihelp');
const ref = JSON.parse(readFileSync(join(FIX, 'wind_nb_ref.json'), 'utf8'));
const setRef = JSON.parse(readFileSync(join(FIX, 'wind_set_ref.json'), 'utf8'));
const example = JSON.parse(readFileSync(join(HERE, '..', '..', 'Projects', 'ArchiHelp', 'examples', 'residence-rev9.json'), 'utf8'));
const maxd = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const utc = (s) => Date.parse(s.replace(' ', 'T') + 'Z') / 1000;

// ------------------------------------------------------------------------------------------------ notebook parity
const spec = notebookSample();
const walls = deriveWalls(spec.rooms, { typeExt: spec.wallTypeExt, typeInt: spec.wallTypeInt, override: spec.override, rotation: 0 });
const wallBy = new Map(walls.map((w) => [w.id, w]));
const grid = () => {
  const xs = spec.rooms.flatMap((r) => [r.x0, r.x1]), ys = spec.rooms.flatMap((r) => [r.y0, r.y1]);
  return makeGrid({ xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys), walls, columns: spec.columns, neighbours: spec.neighbours, storey: 3.0,
    openings: spec.openings.map((o) => ({ ...o, wallObj: wallBy.get(o.wall), effHeight: effHeight(o, 3.0) })) }, { dx: ref.dx, pad: ref.pad });
};

test('solar position matches the notebook', () => {
  const sol = ref.solar.t.map((t) => solarPosition(utc(t) - 6 * 3600, ref.lat, ref.lon));
  assert.ok(maxd(sol.map((x) => x[0]), ref.solar.alt) < 1e-9);
  assert.ok(maxd(sol.map((x) => x[1]), ref.solar.az) < 1e-9);
});

test('walls derived from rooms match the notebook (ids, spans, thickness, orientation)', () => {
  assert.equal(walls.length, ref.walls.length);
  walls.forEach((w, i) => {
    const r = ref.walls[i];
    assert.equal(w.id, r.id);
    assert.ok(Math.abs(w.s0 - r.s0) < 1e-12 && Math.abs(w.s1 - r.s1) < 1e-12 && Math.abs(w.thick - r.thick) < 1e-12 && Math.abs(w.true_az - r.true_az) < 1e-9, w.id);
  });
});

test('LBM grid and solid masks match the notebook cell for cell', () => {
  const g = grid();
  assert.deepEqual([g.nx, g.ny], [ref.nx, ref.ny]);
  assert.equal([...buildMask(g, ref.states.day)].join(''), ref.mask_day);
  assert.equal([...buildMask(g, ref.states.night)].join(''), ref.mask_night);
});

test('lattice-Boltzmann flow matches the notebook (float32 accumulation)', () => {
  const g = grid(), { ux, uy } = lbmSolve(buildMask(g, ref.lbm.state), g.nx, g.ny, ref.lbm.bin, { steps: ref.steps, avg: ref.avg });
  assert.ok(maxd(ux, ref.lbm.ux) < 1e-4 && maxd(uy, ref.lbm.uy) < 1e-4, `ux ${maxd(ux, ref.lbm.ux)} uy ${maxd(uy, ref.lbm.uy)}`);
});

test('opening fluxes and the per-room mass balance match the notebook', () => {
  const g = grid();
  assert.ok(maxd(openingFlux(g, Float32Array.from(ref.lbm.ux), Float32Array.from(ref.lbm.uy)), ref.qraw) < 1e-6);
  const idx = new Map(spec.rooms.map((r, i) => [r.name, i]));
  const zA = spec.openings.map((o) => idx.get(wallBy.get(o.wall).A)), zB = spec.openings.map((o) => (idx.has(wallBy.get(o.wall).B) ? idx.get(wallBy.get(o.wall).B) : -1));
  assert.ok(maxd(balanceFluxes(ref.qraw, ref.lbm.state, zA, zB, spec.rooms.length), ref.lbm.q) < 1e-12);
});

test('RC thermal network and temperatures match the notebook', () => {
  const wx = { t0Utc: utc(ref.wx.index[0]) - ref.utc_off, n: ref.wx.index.length, offsetS: ref.utc_off };
  for (const k of ['T', 'ws', 'wd', 'ghi', 'dni', 'dhi']) wx[k] = Float64Array.from(ref.wx[k]);
  const sw = siteWind(wx, { height: 12.0, terrain: 'urban', rotation: 0 });
  assert.ok(Math.abs(sw.scale - ref.res.scale) < 1e-12 && maxd(sw.U, ref.res.U_site) < 1e-12);
  const res = runNotebook(spec, walls, wx, ref.res.Qh, { lat: ref.lat, lon: ref.lon, storey: 3.0 });
  assert.equal(res.net.N, ref.net.N);
  assert.ok(maxd(res.net.C, ref.net.C) < 1e-6 && maxd(res.net.gOut, ref.net.g_out) < 1e-9);
  let m = 0; for (let r = 0; r < ref.res.T.length; r++) m = Math.max(m, maxd(res.T[r * 12], ref.res.T[r]));
  assert.ok(m < 1e-8, `max temperature difference ${m}`);
});

test('SET ("feels like") matches pythermalcomfort', () => {
  for (const r of setRef) assert.ok(Math.abs(setTmp(r.tdb, r.tr, r.v, r.rh, r.met, r.clo, { position: r.position }) - r.set) < 1e-9, JSON.stringify(r));
  assert.ok(setTmp(30, 32, 0.1, 70, 1.1, 0.5) - setTmp(30, 32, 0.8, 70, 1.1, 0.5) > 2, 'moving air feels cooler');
});

// ------------------------------------------------------------------------------------------------ weather + comfort
test('seasons follow the location: IMD in South Asia, meteorological elsewhere', () => {
  assert.deepEqual(seasonSet(23.83, 91.29).seasons.map((s) => s.name), ['Winter', 'Summer', 'Monsoon', 'Post-monsoon']);
  assert.deepEqual(seasonSet(51.5, -0.1).seasons.map((s) => s.name), ['Winter', 'Spring', 'Summer', 'Autumn']);
  const south = seasonSet(-33.9, 151.2).seasons;
  assert.equal(south.find((s) => s.name === 'Summer').months.join(), '12,1,2');
});

test('typical day = hour-by-hour median; vector-mean wind direction', () => {
  const n = 24 * 400, clim = { t: new Float64Array(n), offsetS: 19800 };
  for (const k of ['T', 'rh', 'td', 'ws', 'wd', 'ghi', 'dni', 'dhi', 'cc', 'pr']) clim[k] = new Float64Array(n);
  const t0 = Date.UTC(2020, 0, 1) / 1000 - 19800;
  for (let i = 0; i < n; i++) { clim.t[i] = t0 + i * 3600; clim.T[i] = (i % 24) + (Math.floor(i / 24) % 3) - 1; clim.ws[i] = 2; clim.wd[i] = (Math.floor(i / 24) % 2) ? 350 : 10; }
  const td = typicalDay(clim, (p) => p.m === 3);
  for (let hr = 0; hr < 24; hr++) assert.ok(Math.abs(td.prof.T[hr] - hr) < 1e-9);
  assert.ok(Math.abs(((td.prof.wd[5] + 180) % 360) - 180) < 1, 'winds from 350 and 10 average to about north, not south');
  const [dir, c] = vectorMeanDir([1, 1], [90, 270]);
  assert.ok(c < 1e-9); void dir;
  assert.ok(Math.abs(dewPoint(25, 100) - 25) < 1e-9);
  const s = profileSeries(td.prof, '2024-03-15', 19800, 3);
  assert.equal(s.n, 4 * 24 + 1);
  assert.equal(s.t0Utc, Date.parse('2024-03-12T00:00:00Z') / 1000 - 19800);
});

test('adaptive comfort band and clothing', () => {
  const imac = adaptiveBand(28, { india: true }), ash = adaptiveBand(28, { india: false });
  assert.ok(Math.abs(imac.neutral - (0.54 * 28 + 12.83)) < 1e-12 && Math.abs(imac.hi - imac.lo - 4.76) < 1e-12);
  assert.ok(Math.abs(ash.neutral - (0.31 * 28 + 17.8)) < 1e-12);
  assert.equal(cloFromT6(30), 0.46); assert.equal(cloFromT6(-10), 1.0);
});

test('fans: room air speeds in the published range and positions inside the room', () => {
  const s = fanStats({ d: 1.2, q: 2.4, speed: 'high', ceiling: 3.0, blade: 2.65, area: 16 });
  assert.ok(s.avg > 0.6 && s.avg < 1.6 && s.high > s.avg && s.low < s.avg, JSON.stringify(s));
  assert.ok(fanStats({ area: 16, speed: 'low' }).avg < s.avg);
  const room = { x0: 0, y0: 0, x1: 6, y1: 4 }, pos = defaultFanPositions(room, 3);
  assert.equal(pos.length, 3); for (const [x, y] of pos) assert.ok(x > 0 && x < 6 && y > 0 && y < 4);
  const ff = fanField(room, pos.map(([x, y]) => ({ x, y, d: 1.2, q: 2.4, speed: 'high', blade: 2.65 })), { ceiling: 3 });
  assert.ok(ff.sample(pos[0][0], pos[0][1]).s > ff.sample(0.2, 0.2).s);
});

// ------------------------------------------------------------------------------------------------ airflow network
test('airflow network conserves mass and shows the stack effect', () => {
  // two rooms stacked (ground, first) joined by a stair well; one window each on the same facade; no wind
  const net = { nZ: 2, zones: [{ zref: 0.5 }, { zref: 3.5 }], links: [
    { kind: 'v', a: 0, b: -1, zb: 1.4, zt: 2.6, width: 1.0, cd: 0.6, strips: [1.55, 1.85, 2.15, 2.45], dz: 0.3, az: 0, side: 1 },
    { kind: 'v', a: 1, b: -1, zb: 4.4, zt: 5.6, width: 1.0, cd: 0.6, strips: [4.55, 4.85, 5.15, 5.45], dz: 0.3, az: 0, side: 1 },
    { kind: 'h', a: 0, b: 1, z: 3.5, area: 2.0, cd: 0.6 }] };
  const sol = solve(net, { T: [28, 28], Tout: 18, open: Float64Array.from([1, 1, 1]), wind: () => 0 });
  let in0 = -sol.m[0] - sol.m[2], in1 = -sol.m[1] + sol.m[2];
  assert.ok(Math.abs(in0) < 1e-6 && Math.abs(in1) < 1e-6, `mass balance ${in0} ${in1}`);
  assert.ok(sol.q[2][0] > 0.05 && sol.q[2][1] === 0, 'warm house in cool air: air rises through the stair');
  assert.ok(sol.m[1] > 0 && sol.m[0] < 0, 'in at the bottom, out at the top');
  assert.ok(cpSwamiChandra(0) > 0.5 && cpSwamiChandra(180) < 0, 'windward pressure, leeward suction');
  const [m] = orifice(0.6, 4, 1.2); assert.ok(Math.abs(m - 0.6 * Math.sqrt(2 * 1.2 * 4)) < 1e-12);
  assert.equal(epsteinExchange(2, 20, 25), 0); assert.ok(epsteinExchange(2, 25, 20) > 0);
});

// ------------------------------------------------------------------------------------------------ the 3D house
const stacked = () => {
  // the example plan on two floors (identical, so the stair lines up)
  const f1 = { id: 'F1', level: 1, name: 'First floor', kind: 'design', cfg: example.cfg, doc: example.plans[0] };
  const f0 = { id: 'F0', level: 0, name: 'Ground floor', kind: 'design', cfg: { ...example.cfg, floor_level: 0 }, doc: example.plans[0] };
  return [f1, f0];
};

test('floors sit at their heights above ground', () => {
  const c = example.cfg, FT = 0.3048;
  const g = floorHeights(c, 0, { plinthFt: 1.5 }), f = floorHeights(c, 1, { plinthFt: 1.5 }), s = floorHeights(c, 2, { plinthFt: 1.5 });
  assert.ok(Math.abs(g.ffl - 1.5 * FT) < 1e-12 && Math.abs(f.ffl - (1.5 + c.ground_floor_height_ft) * FT) < 1e-12);
  assert.ok(Math.abs(s.ffl - (1.5 + c.ground_floor_height_ft + c.typical_floor_height_ft) * FT) < 1e-12);
  assert.ok(windFactor(s.ffl + 1.5) > windFactor(g.ffl + 1.5), 'more wind higher up');
  assert.deepEqual(levelHeights(c, 1), { ffl: 1.5 + c.ground_floor_height_ft, storey: c.typical_floor_height_ft });
});

test('two-floor house: stair well joins the floors, slabs are shared, the day simulates cleanly', () => {
  const st = { neighbours: [{ side: 'W', gapFt: 8, heightFt: 22, depthFt: 30 }], days: { seasons: null, dates: [] } };
  const built = buildModel(stacked(), example.cfg, st);
  const m = built.model;
  assert.deepEqual(m.floors.map((f) => f.level), [0, 1]);
  assert.equal(m.stairs.length, 1, 'one stair well between the floors');
  assert.ok(m.mumty, 'stair-top room over the top floor');
  assert.ok(m.thermal.net.names.some((n) => n.startsWith('slab:')), 'shared slabs');
  assert.ok(built.fans.length >= 8);
  const wx = syntheticSeries('2024-05-15', 23.83, 91.29, 3);
  const res = runDay(built.house, built.fans, wx, { ...dayOptions(st, built, { meanOutdoor: 28 }, { lat: 23.83, lon: 91.29, climate: null }), tGround: 26 });
  assert.equal(res.hours.length, 25);
  for (const arr of [...res.Tair, ...res.SET]) for (const v of arr) assert.ok(Number.isFinite(v));
  for (const s of res.summary) assert.ok(s.min > 10 && s.max < 50, JSON.stringify(s));
  const mean = (fl) => { const z = m.zones.map((q, i) => [q, i]).filter(([q]) => q.floor === fl); return z.reduce((a, [, i]) => a + res.summary[i].max, 0) / z.length; };
  assert.ok(mean(1) > mean(0), 'the top floor (under the roof) runs warmer than the ground floor');
  assert.ok(res.hours.some((h) => h.stairs[0].up + h.stairs[0].down + h.stairs[0].exch > 0.01), 'air moves through the stair well');
  assert.ok(res.hours.some((h) => h.fanOn.some(Boolean)), 'fans run when occupied and warm');
});

test('wind picture geometry: taller neighbours only, opening state per hour', () => {
  const built = buildModel(stacked(), example.cfg, { neighbours: [{ side: 'W', gapFt: 8, heightFt: 15, depthFt: 30 }] });
  const g0 = lbmGeometry(built.model, 0), g1 = lbmGeometry(built.model, 1);
  assert.equal(g0.neighbours.length, 1, 'a 15 ft neighbour shelters the ground floor');
  assert.equal(g1.neighbours.length, 0, 'but not the first floor');
  const g = gridFromGeometry(g1, { dx: 0.5, pad: 10 });
  const hour = { open: new Array(built.model.air.links.length).fill(1), wd: 225 };
  const bits = floorState(g1, hour);
  assert.equal(bits.length, g1.openings.length);
  assert.ok(buildMask(g, bits).some((v) => v === 1));
  assert.equal(binOf(225, 0), 225); assert.equal(binOf(10, 0), 0); assert.equal(binOf(350, 0), 0);
});

test('fans per room from the setup: count, position (ft) and type', () => {
  const st = { fans: { F1: {} } };
  const plan = example.plans[0], master = plan.rooms.find((r) => r.rtype === 'master');
  st.fans.F1[master.uid] = { n: 2, type: 'bldc', speed: 'medium', mode: 'always', pos: [[master.tile.x0 + 4, master.tile.y0 + 4], [master.tile.x0 + 8, master.tile.y0 + 6]] };
  const { fans } = houseFromFloors([stacked()[0]], example.cfg, st);
  const mine = fans.filter((f) => f.uid === master.uid);
  assert.equal(mine.length, 2);
  assert.ok(Math.abs(mine[0].x - (master.tile.x0 + 4) * 0.3048) < 1e-9 && mine[1].type === 'bldc' && mine[1].speed === 'medium');
});

test('days: season tabs then chosen dates', () => {
  const d = dayList({ days: { seasons: ['summer', 'monsoon'], dates: ['2025-05-01'] } }, 23.83, 91.29);
  assert.deepEqual(d.map((x) => x.key), ['season:summer', 'season:monsoon', 'date:2025-05-01']);
});

// ------------------------------------------------------------------------------------------------ multi-floor projects
test('floors: add, switch and remove keep each floor\'s data; the stair is fixed from the nearest floor', () => {
  const p = ensureFloors(JSON.parse(JSON.stringify({ ...example, revisions: {}, candidates: [] })));
  p.activePlan = 0;
  assert.equal(p.floors.length, 1);
  const idx = addFloor(p, { level: 0 });
  activateFloor(p, idx);
  assert.equal(p.cfg.floor_level, 0); assert.equal(p.plans.length, 0);
  const fx = fixedStairFor(p);
  assert.equal(fx.from, 'First floor');
  assert.deepEqual(fx.tile, example.plans[0].rooms.find((r) => r.rtype === 'stair').tile);
  activateFloor(p, 0);
  assert.equal(p.cfg.floor_level, 1); assert.equal(p.plans.length, 1);
  assert.deepEqual(floorsOf(p).map((f) => f.level), [0, 1]);
  assert.throws(() => addFloor(p, { level: 1 }));
  removeFloor(p, 1);
  assert.equal(p.floors.length, 1); assert.equal(p.plans.length, 1);
});

test('generator keeps a fixed staircase (multi-floor projects)', () => {
  const stair = example.plans[0].rooms.find((r) => r.rtype === 'stair').tile;
  const r = generate({ ...example.cfg, floor_level: 0, __fixedStair: stair }, { budget: { beam: 300, perSig: 6, ms: 1500 }, perSkeleton: 3, maxCandidates: 6, polish: false, deadlineMs: 30000 });
  assert.ok(r.candidates.length > 0, 'found layouts around the fixed stair');
  for (const c of r.candidates) {
    const s = c.doc.rooms.find((x) => x.rtype === 'stair').tile;
    for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(s[k] - stair[k]) < 1e-3, `${k} ${s[k]} vs ${stair[k]}`);
    assert.equal(c.quality.hard, 0);
  }
});

test('traced drawings convert from pixels to feet (scale from one dimension, y up, origin at the corner)', () => {
  const tr = { image: { w: 1000, h: 800 }, scale: { ftPerPx: 0.04, lengthFt: 36 }, px: {
    rooms: [{ uid: 'a', name: 'Hall', rtype: 'hall', x0: 100, y0: 100, x1: 450, y1: 700 }, { uid: 'b', name: 'Kitchen', rtype: 'kitchen', x0: 450, y0: 400, x1: 1000, y1: 700 }],
    openings: [{ id: 'w', kind: 'window', a: 'a', b: null, horiz: true, line: 700, t: 275, w: 4, sill: 3, head: 7 }, { id: 'n', kind: 'nowall', a: 'a', b: 'b' }] } };
  const d = traceToFeet(tr);
  assert.deepEqual(d.rooms[0].tile, { x0: 0, y0: 0, x1: 14, y1: 24 });
  assert.deepEqual(d.rooms[1].tile, { x0: 14, y0: 0, x1: 36, y1: 12 });
  assert.deepEqual([d.openings[0].x, d.openings[0].y, d.openings[0].horiz], [7, 0, true]);
  assert.equal(d.openings[1].kind, 'nowall');
  // and the wind model accepts it
  const built = buildModel([{ id: 'T', level: 0, name: 'Ground floor', kind: 'trace', cfg: example.cfg, doc: d }], example.cfg, {});
  assert.equal(built.model.zones.length, 2);
  assert.ok(built.model.floors[0].walls.some((w) => w.open), 'the missing wall is open');
  void prepareHouse; void simulateHouse;
});
