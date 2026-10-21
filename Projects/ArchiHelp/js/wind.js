// ArchiHelp — Wind circulation tab.
//   Setup:   site (place, lat/long, plan north, terrain, neighbours) · floors & heights · construction · operation ·
//            fans (1-3 per room, dragged into place on each floor's plan) · days (season tabs + hand-picked dates).
//   Results: day tabs x floor tabs; animated plan views (airflow + temperature) or the cut-away section of the whole
//            house; temperature-through-the-day and wind charts; room table.
// Weather: Open-Meteo (10 years of hourly ERA5 for typical season days; archive / forecast for chosen dates).
import { h, clear, toast, select, seg, field, num, ftIn, modal, s as svgEl, download } from './dom.js';
import { floorsOf } from './floors.js';
import { defaultWindSettings, floorHeights, FT } from '../wind/fromplan.js';
import { buildModel, dayList, weatherFor, dayOptions, lbmGeometry, floorState, binOf, lbmKey } from '../wind/sim.js';
import { fetchClimate, geocode, seasonSet, VARS } from '../wind/weather.js';
import { FAN_TYPES } from '../wind/fans.js';
import { ROOFS, WALL_CORES } from '../wind/house.js';
import { windFactor } from '../wind/model.js';
import { mountPlanViews } from './windview.js';
import { mountSection, defaultCut, cutRange } from './windsection.js';
import { tempChart, windChart, legend, PALETTE, hh } from './windcharts.js';
import { cacheGet, cachePut, hashStr } from './windcache.js';

const LBM = { dx: 0.25, pad: 40, steps: 2200, avg: 600 };
const RESULT_VERSION = 5;
const fmtM = (m) => `${m.toFixed(2)} m`;
const fmtFt = (ft) => { const i = Math.round(ft * 12); return `${Math.floor(i / 12)}'-${i % 12}"`; };

// ------------------------------------------------------------------------------------------------ worker pool
class WindPool {
  constructor() { this.n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)); this.ws = []; this.idle = []; this.queue = []; this.seq = 0; this.jobs = new Map(); }
  spawn(i) {
    const w = new Worker(new URL('../wind/worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const d = e.data, job = this.jobs.get(d.id); if (!job) return;
      if (d.type === 'progress') { if (job.onProgress) job.onProgress(d.f); return; }
      this.jobs.delete(d.id); this.idle.push(i); this.pump();
      if (d.type === 'error') job.reject(new Error(d.message)); else job.resolve(d.res || d.field);
    };
    w.onerror = (e) => {
      for (const [id, job] of this.jobs) if (job.w === i) { this.jobs.delete(id); job.reject(new Error(e.message || 'worker failed')); }
      this.ws[i] = null; this.idle.push(i); this.pump();
    };
    this.ws[i] = w;
    return w;
  }
  run(msg, { onProgress, priority = 0, tag = '' } = {}) {
    return new Promise((resolve, reject) => {
      const job = { msg: { ...msg, id: ++this.seq }, resolve, reject, onProgress, priority, tag };
      this.queue.push(job); this.queue.sort((a, b) => b.priority - a.priority);
      if (this.ws.length < this.n && !this.idle.length) { const i = this.ws.length; this.ws.push(null); this.idle.push(i); }
      this.pump();
    });
  }
  pump() {
    while (this.idle.length && this.queue.length) {
      const i = this.idle.shift(), job = this.queue.shift(), w = this.ws[i] || this.spawn(i);
      job.w = i; this.jobs.set(job.msg.id, job); w.postMessage(job.msg);
    }
  }
  /** Drop queued (not started) jobs with a tag. */
  drop(tag) { const keep = []; for (const j of this.queue) { if (j.tag === tag) j.reject(new Error('dropped')); else keep.push(j); } this.queue = keep; }
}
const pool = new WindPool();
if (typeof window !== 'undefined') window.__ahWindPool = pool;   // e2e tests and debugging

// session state (survives tab switches; results and wind pictures are also cached in IndexedDB)
const S = { results: new Map(), fields: new Map(), pending: new Set(), climate: new Map() };

// ------------------------------------------------------------------------------------------------ settings
export function settingsOf(p) {
  const d = defaultWindSettings(p.cfg), w = p.wind || {};
  p.wind = { ...d, ...w, fanDefaults: { ...d.fanDefaults, ...(w.fanDefaults || {}) }, days: { ...d.days, ...(w.days || {}) }, fans: w.fans || {}, neighbours: w.neighbours || [] };
  return p.wind;
}
function signature(built, st) {
  const loc = st.location && Number.isFinite(st.location.lat) && Number.isFinite(st.location.lon) ? [st.location.lat.toFixed(4), st.location.lon.toFixed(4)] : null;
  return hashStr(JSON.stringify({ v: RESULT_VERSION, house: built.house, fans: built.fans.map((f) => [f.roomId, +f.x.toFixed(3), +f.y.toFixed(3), f.type, f.speed, f.mode]), loc,
    o: [st.terrain, st.windows, st.interiorDoors, st.bathDoors, st.mumty] }));
}

// ------------------------------------------------------------------------------------------------ screen
export function renderWind(root, app) {
  const p = app.project, st = settingsOf(p);
  app.crumbs([]);
  document.title = `Wind circulation — ${p.name} — ArchiHelp`;
  let built = null, err = null;
  try { built = buildModel(floorsOf(p), p.cfg, st); } catch (e) { err = e; }
  const wrap = h('div', { class: 'wind' });
  root.append(wrap);
  if (!built) {
    wrap.append(h('div', { class: 'empty-state' },
      h('h1', {}, 'Wind circulation'),
      h('p', {}, err ? err.message : 'No floor plan yet.'),
      h('p', { class: 'muted' }, 'The simulation runs on the floors of this project: design a floor in the Floor plan tab, or trace an existing drawing (photo, scan or PDF).'),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/p/${p.id}` }, 'Go to the floor plan'), h('a', { class: 'btn', href: `#/p/${p.id}/trace` }, 'Trace a drawing'))));
    app.actions([]);
    return;
  }
  const ui = { mode: 'setup', dayKey: null, floorIndex: 0, view: 'plan', colorBy: 'air', t: 12, playing: true, speed: 1, cut: null, highlight: null, fanFloor: 0 };
  const sigOf = () => signature(built, st);
  let sig = sigOf();
  const head = h('div', { class: 'wind-head' }), body = h('div', { class: 'wind-body' });
  wrap.append(head, body);
  let stopAnim = null;
  app.cleanup = () => { if (stopAnim) stopAnim(); pool.drop('lbm'); };

  const geoCache = new Map();
  const rebuild = () => { built = buildModel(floorsOf(p), p.cfg, st); sig = sigOf(); geoCache.clear(); };
  const save = () => { app.save(); };
  const locOk = () => !!(st.location && Number.isFinite(st.location.lat) && Number.isFinite(st.location.lon));
  const haveResults = () => locOk() && dayList(st, st.location.lat, st.location.lon).some((d) => S.results.has(`${sig}|${d.key}`));

  function drawHead() {
    clear(head);
    const loc = st.location;
    head.append(
      h('div', {}, h('h1', {}, 'Wind circulation'),
        h('p', { class: 'muted small' }, locOk() ? `${loc.name || 'Site'}${loc.admin ? `, ${loc.admin}` : ''}${loc.country ? `, ${loc.country}` : ''} · ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}` : 'Set the location to start',
          ` · ${built.model.floors.map((f) => f.name).join(' + ')}${built.skipped.length ? ` (no plan yet: ${built.skipped.join(', ')})` : ''}`)),
      seg([['setup', 'Setup'], ['results', 'Results']], ui.mode, (v) => {
        if (v === 'results' && !haveResults()) { toast('Run the simulation first.'); drawHead(); return; }
        ui.mode = v; draw();
      }, { 'aria-label': 'Wind view', class: 'seg wmode' }));
  }
  function draw() { if (stopAnim) { stopAnim(); stopAnim = null; } drawHead(); clear(body); if (ui.mode === 'setup') drawSetup(); else drawResults(); }

  // ============================================================================================== SETUP
  function drawSetup() {
    const grid = h('div', { class: 'wsetup' });
    body.append(grid);
    grid.append(cardSite(), cardFloors(), cardBuild(), cardOps(), cardFans(), cardDays());
    const status = h('div', { class: 'small muted wstatus', id: 'windStatus', 'aria-live': 'polite' });
    const runBtn = h('button', { class: 'btn primary', type: 'button', id: 'windRun', onclick: () => run(status, runBtn) }, 'Run simulation');
    body.append(h('div', { class: 'wrun' }, runBtn, status,
      h('span', { class: 'small muted wrun-note' }, 'Runs in this browser. Weather from Open-Meteo (open data, no key); nothing about the house leaves the device.')));
  }
  const card = (title, sub, ...kids) => h('section', { class: 'wcard' }, h('h3', {}, title), sub ? h('p', { class: 'small muted' }, sub) : null, ...kids);

  function cardSite() {
    const loc = st.location || {};
    const q = h('input', { type: 'search', placeholder: 'Town or city, e.g. Agartala', value: loc.name || '', 'aria-label': 'Search a place' });
    const results = h('div', { class: 'geo-res' });
    const setLoc = (l) => {
      st.location = l;
      if (locOk() && st.days && st.days.seasons) {
        const keys = seasonSet(l.lat, l.lon).seasons.map((x) => x.key);
        st.days.seasons = st.days.seasons.filter((k) => keys.includes(k)); if (!st.days.seasons.length) st.days.seasons = null;
      }
      save(); rebuild(); draw();
    };
    const lat = num({ value: Number.isFinite(loc.lat) ? loc.lat : '', min: -90, max: 90, step: 0.0001, onChange: (v) => setLoc({ ...(st.location || { name: 'Custom location' }), lat: v }) });
    const lon = num({ value: Number.isFinite(loc.lon) ? loc.lon : '', min: -180, max: 180, step: 0.0001, onChange: (v) => setLoc({ ...(st.location || { name: 'Custom location' }), lon: v }) });
    lat.placeholder = 'e.g. 23.8315'; lon.placeholder = 'e.g. 91.2868';
    const search = async () => {
      const term = q.value.trim(); if (term.length < 2) return;
      clear(results).append(h('span', { class: 'small muted' }, 'Searching…'));
      try {
        const list = await geocode(term);
        clear(results);
        if (!list.length) results.append(h('span', { class: 'small muted' }, 'No match. Enter latitude and longitude instead.'));
        for (const r of list) results.append(h('button', { type: 'button', class: 'geo-opt', onclick: () => setLoc({ name: r.name, admin: r.admin, country: r.country, lat: r.lat, lon: r.lon, elevation: r.elevation }) },
          h('b', {}, r.name), ` ${[r.admin, r.country].filter(Boolean).join(', ')} · ${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}`));
      } catch (e) { clear(results).append(h('span', { class: 'small bad' }, `Place search failed: ${e.message}. Enter latitude and longitude instead.`)); }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    const nbRows = h('div', { class: 'nb-list' });
    const drawNb = () => {
      clear(nbRows);
      if (!st.neighbours.length) nbRows.append(h('p', { class: 'small muted' }, 'No neighbouring buildings: the house stands in the open.'));
      st.neighbours.forEach((n, i) => {
        const upd = (k, v) => { n[k] = v; save(); rebuild(); };
        nbRows.append(h('div', { class: 'nb-row' },
          field('Side', select([['N', 'North'], ['E', 'East'], ['S', 'South'], ['W', 'West']], n.side, (v) => upd('side', v))),
          field('Gap', ftIn({ value: n.gapFt ?? 10, min: 0, max: 200, onChange: (v) => upd('gapFt', v) })),
          field('Height', ftIn({ value: n.heightFt ?? 20, min: 3, max: 400, onChange: (v) => upd('heightFt', v) })),
          field('Length', ftIn({ value: n.lengthFt ?? ((n.side === 'N' || n.side === 'S') ? p.cfg.ew_ft : p.cfg.ns_ft), min: 3, max: 400, onChange: (v) => upd('lengthFt', v) })),
          field('Depth', ftIn({ value: n.depthFt ?? 30, min: 3, max: 400, onChange: (v) => upd('depthFt', v) })),
          h('button', { type: 'button', class: 'btn sm ghost', 'aria-label': 'Remove neighbour', onclick: () => { st.neighbours.splice(i, 1); save(); rebuild(); drawNb(); } }, '×')));
      });
    };
    drawNb();
    return card('Site', 'The location sets the sun path, the climate and the seasons. Neighbours shade and shelter the floors that are lower than them.',
      h('div', { class: 'row geo-q' }, q, h('button', { type: 'button', class: 'btn', onclick: search }, 'Find')), results,
      h('div', { class: 'grid2' }, field('Latitude (°N)', lat), field('Longitude (°E)', lon)),
      h('div', { class: 'grid2' },
        field('Plan north (°)', num({ value: st.rotation ?? 0, min: -360, max: 360, step: 1, onChange: (v) => { st.rotation = v; save(); rebuild(); } }), 'Compass bearing of the top of the plan; 0 = it faces true north'),
        field('Terrain', select([['open', 'Open country'], ['suburban', 'Suburban / town'], ['urban', 'Dense city']], st.terrain, (v) => { st.terrain = v; save(); rebuild(); }), 'How fast the wind grows with height')),
      h('h4', {}, 'Neighbouring buildings'), nbRows,
      h('button', { type: 'button', class: 'btn sm', onclick: () => { st.neighbours.push({ side: 'W', gapFt: 10, heightFt: 20, depthFt: 30 }); save(); rebuild(); drawNb(); } }, '+ Add neighbour'));
  }

  function cardFloors() {
    const all = floorsOf(p);
    const rows = all.map((f) => {
      const H = floorHeights(p.cfg, f.level, st), m = built.model.floors.find((x) => x.id === f.id);
      return h('tr', {}, h('td', {}, f.name), h('td', {}, m ? (f.kind === 'trace' ? 'traced drawing' : `option ${(f.activePlan || 0) + 1}`) : h('span', { class: 'muted' }, 'no plan yet: skipped')),
        h('td', { class: 'num' }, `+${fmtM(H.ffl)}`), h('td', { class: 'num' }, fmtM(H.storey)), h('td', { class: 'num' }, fmtM(H.ceil)));
    });
    const setCfg = (k, v) => { p.cfg[k] = v; save(); rebuild(); draw(); };
    return card('Floors and heights', 'Each floor sits at its own height: wind grows with height, warm air rises through the stair, the top floor gets the roof.',
      elevationSvg(all),
      h('div', { class: 'wtable-wrap' }, h('table', { class: 'wtable' }, h('thead', {}, h('tr', {}, h('th', {}, 'Floor'), h('th', {}, 'Plan'), h('th', {}, 'Floor level above ground'), h('th', {}, 'Storey'), h('th', {}, 'Clear ceiling'))), h('tbody', {}, rows))),
      h('div', { class: 'grid2' },
        field('Plinth (ground to ground-floor level)', ftIn({ value: st.plinthFt ?? 1.5, min: 0, max: 6, onChange: (v) => { st.plinthFt = v; save(); rebuild(); draw(); } })),
        field('Slab thickness', ftIn({ value: st.slabFt ?? 5 / 12, min: 3 / 12, max: 1, onChange: (v) => { st.slabFt = v; save(); rebuild(); draw(); } })),
        field('Ground floor height (floor to floor)', ftIn({ value: p.cfg.ground_floor_height_ft, min: 8, max: 20, onChange: (v) => setCfg('ground_floor_height_ft', v) }), 'Shared with the floor plan (stair design)'),
        field('Upper floor height (floor to floor)', ftIn({ value: p.cfg.typical_floor_height_ft, min: 8, max: 20, onChange: (v) => setCfg('typical_floor_height_ft', v) }), 'Shared with the floor plan'),
        field('Under the lowest floor', select([['auto', 'Auto: earth under a ground floor, rooms under an upper floor'], ['ground', 'Earth (slab on grade)'], ['indoor', 'Rooms (not modelled)'], ['open', 'Open stilts / parking']], st.below, (v) => { st.below = v; save(); rebuild(); draw(); })),
        field('Over the top floor', select([['roof', 'Roof (sun and night sky)'], ['indoor', 'Another floor (not modelled)']], st.above, (v) => { st.above = v; save(); rebuild(); draw(); }))));
  }

  function elevationSvg(all) {
    const maxL = Math.max(...all.map((f) => f.level)), top = floorHeights(p.cfg, maxL, st), zTop = top.ffl + top.storey + 1.4;
    const W = 560, Hh = 200, k = (Hh - 30) / zTop, x0 = 170, x1 = 420, Y = (z) => Hh - 18 - z * k;
    const g = svgEl('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'elev', role: 'img', 'aria-label': 'Floors and heights' });
    g.append(svgEl('rect', { x: 0, y: Y(0), width: W, height: 18, fill: '#e7e5e4' }), svgEl('line', { x1: 0, x2: W, y1: Y(0), y2: Y(0), stroke: '#57534e' }));
    const byLevel = new Map(all.map((f) => [f.level, f]));
    const names = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth'];
    for (let l = 0; l <= maxL; l++) {
      const f = byLevel.get(l), H = floorHeights(p.cfg, l, st), have = !!f && built.model.floors.some((m) => m.id === f.id);
      g.append(svgEl('rect', { x: x0, y: Y(H.ffl + H.ceil), width: x1 - x0, height: H.ceil * k, fill: have ? 'rgba(37,99,235,0.14)' : 'rgba(148,163,184,0.18)', stroke: have ? '#2563eb' : '#94a3b8', 'stroke-dasharray': have ? null : '4 3' }));
      g.append(svgEl('rect', { x: x0, y: Y(H.ffl + H.storey), width: x1 - x0, height: (H.storey - H.ceil) * k, fill: '#9ca3af' }));
      g.append(svgEl('text', { x: x0 + 8, y: Y(H.ffl + H.ceil / 2) + 4, class: 'el-t' }, f ? f.name + (have ? '' : ' (no plan)') : `${names[l] || `Level ${l}`} floor (not in this project)`));
      g.append(svgEl('text', { x: x0 - 8, y: Y(H.ffl) + 4, class: 'el-n', 'text-anchor': 'end' }, `+${H.ffl.toFixed(2)} m`));
    }
    const plinth = floorHeights(p.cfg, 0, st).ffl;
    g.append(svgEl('rect', { x: x0, y: Y(plinth), width: x1 - x0, height: plinth * k, fill: '#a8a29e' }));
    const roofZ = top.ffl + top.storey;
    if (st.above !== 'indoor') g.append(svgEl('rect', { x: x0, y: Y(roofZ + 1), width: 4, height: k, fill: '#374151' }), svgEl('rect', { x: x1 - 4, y: Y(roofZ + 1), width: 4, height: k, fill: '#374151' }));
    g.append(svgEl('text', { x: x1 + 8, y: Y(roofZ) + 4, class: 'el-n' }, `${st.above !== 'indoor' ? 'roof' : 'top'} +${roofZ.toFixed(2)} m`), svgEl('text', { x: x1 + 8, y: Y(0) - 3, class: 'el-n' }, 'ground ±0.00'));
    const nbs = built.house.neighbours || [];
    nbs.forEach((n, i) => {
      const left = n.x1 <= 0 || n.y1 <= 0, nx = left ? 18 + (i % 2) * 48 : W - 58 - (i % 2) * 48;
      g.append(svgEl('rect', { x: nx, y: Y(n.height), width: 40, height: n.height * k, fill: 'rgba(71,85,105,0.45)' }), svgEl('text', { x: nx + 20, y: Y(n.height) - 4, class: 'el-n', 'text-anchor': 'middle' }, `${n.height.toFixed(1)} m`));
    });
    return h('div', { class: 'elev-wrap' }, g);
  }

  function cardBuild() {
    return card('Construction', 'Walls and roof store and pass heat; the roof matters most for the top floor.',
      h('div', { class: 'grid2' },
        field('Walls', select(Object.entries(WALL_CORES).map(([k, v]) => [k, v[2]]), st.walls, (v) => { st.walls = v; save(); rebuild(); }), `Outer ${fmtFt(p.cfg.t_ext)}, inner ${fmtFt(p.cfg.t_int)} thick (from the floor plan)`),
        field('Roof', select(Object.entries(ROOFS).map(([k, v]) => [k, v.label]), st.roof, (v) => { st.roof = v; save(); rebuild(); })),
        field('Glazing', seg([['single', 'Single'], ['double', 'Double']], st.glazing, (v) => { st.glazing = v; save(); rebuild(); })),
        field('Window shutters', seg([['sliding', 'Sliding'], ['casement', 'Casement']], st.windowKind, (v) => { st.windowKind = v; save(); rebuild(); }), 'Sliding opens half the window, casement nearly all of it'),
        field('Sunshade (chajja) over windows', ftIn({ value: st.overhangFt ?? 1.5, min: 0, max: 6, onChange: (v) => { st.overhangFt = v; save(); rebuild(); } }))));
  }

  function cardOps() {
    return card('How the house is used', 'Windows, doors and the stair-top vent decide where the air can go.',
      h('div', { class: 'grid2' },
        field('Windows', select([['auto', 'Opened when it is cooler outside (not in rain)'], ['day', 'Open 7 am – 8 pm'], ['night', 'Open 8 pm – 7 am'], ['always', 'Always open'], ['never', 'Always closed']], st.windows, (v) => { st.windows = v; save(); rebuild(); })),
        field('Room doors', select([['open', 'Open'], ['night', 'Closed at night (10 pm – 6 am)'], ['closed', 'Closed']], st.interiorDoors, (v) => { st.interiorDoors = v; save(); rebuild(); })),
        field('Bathroom doors', select([['closed', 'Closed'], ['open', 'Open']], st.bathDoors, (v) => { st.bathDoors = v; save(); rebuild(); })),
        field('Stair-top vent (mumty door / window)', select([['never', 'Closed'], ['always', 'Open'], ['auto', 'Open with the windows']], st.mumty, (v) => { st.mumty = v; save(); rebuild(); }), built.model.mumty ? 'A warm stair well works as a chimney when it is open' : 'Needs a stair on the top floor with the roof over it')));
  }

  // ------------------------------------------------------------------------ fans
  function cardFans() {
    const fl = built.model.floors, box = h('div');
    const drawFans = () => {
      clear(box);
      const fi = Math.min(ui.fanFloor, fl.length - 1), f = fl[fi], fid = f.id;
      if (fl.length > 1) box.append(h('div', { class: 'floortabs inner' }, fl.map((x, i) => h('button', { type: 'button', class: `ftab${i === fi ? ' on' : ''}`, onclick: () => { ui.fanFloor = i; drawFans(); } }, x.name))));
      const conf = (st.fans[fid] = st.fans[fid] || {});
      const fansHere = built.fans.filter((x) => x.floorId === fid);
      const plan = fanPlan(f, fansHere, (fan, xFt, yFt) => {
        const mine = fansHere.filter((q) => q.uid === fan.uid);
        conf[fan.uid] = { n: mine.length, type: fan.type, speed: fan.speed, mode: fan.mode, ...(conf[fan.uid] || {}), pos: mine.map((q) => (q === fan ? [xFt, yFt] : [Math.round(q.x / FT * 4) / 4, Math.round(q.y / FT * 4) / 4])) };
        save(); rebuild(); drawFans();
      });
      const rows = f.rooms.filter((r) => !r.court).map((r) => {
        const mine = fansHere.filter((q) => q.uid === r.uid), n = mine.length, m0 = mine[0];
        const set = (patch) => {
          const base = { n, type: m0 ? m0.type : st.fanDefaults.type, speed: m0 ? m0.speed : st.fanDefaults.speed, mode: m0 ? m0.mode : st.fanDefaults.mode, ...(conf[r.uid] || {}) };
          conf[r.uid] = { ...base, ...patch };
          if ('n' in patch) delete conf[r.uid].pos;
          save(); rebuild(); drawFans();
        };
        return h('tr', { 'data-room': r.name }, h('td', {}, r.name),
          h('td', {}, seg([[0, '0'], [1, '1'], [2, '2'], [3, '3']], n, (v) => set({ n: Number(v) }), { 'aria-label': `Fans in ${r.name}` })),
          h('td', {}, n ? select(Object.entries(FAN_TYPES).map(([k, v]) => [k, v.label]), m0.type, (v) => set({ type: v }), { 'aria-label': 'Fan type' }) : null),
          h('td', {}, n ? select([['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], m0.speed, (v) => set({ speed: v }), { 'aria-label': 'Fan speed' }) : null),
          h('td', {}, n ? select([['auto', 'Occupied and warm (> 26 °C)'], ['occupied', 'Whenever occupied'], ['always', 'All day'], ['off', 'Off']], m0.mode, (v) => set({ mode: v }), { 'aria-label': 'When the fan runs' }) : null));
      });
      box.append(h('div', { class: 'fanwrap' }, plan,
        h('div', { class: 'fan-side' },
          h('p', { class: 'small muted' }, 'Drag a fan (or focus it and use the arrow keys) to move it. Bedrooms, the hall, dining and study get one by default; a big hall gets two.'),
          h('div', { class: 'wtable-wrap' }, h('table', { class: 'wtable fans' }, h('thead', {}, h('tr', {}, h('th', {}, 'Room'), h('th', {}, 'Fans'), h('th', {}, 'Type'), h('th', {}, 'Speed'), h('th', {}, 'Runs'))), h('tbody', {}, rows))))));
    };
    drawFans();
    return card('Ceiling fans', 'Fans do not cool the air (their motors add a little heat), but moving air makes a room feel cooler: that shows in "feels like".', box);
  }

  /** SVG plan of a floor with draggable fans. onMove(fan, xFt, yFt). */
  function fanPlan(f, fans, onMove) {
    const xs = f.rooms.flatMap((r) => [r.x0, r.x1]), ys = f.rooms.flatMap((r) => [r.y0, r.y1]);
    const X0 = Math.min(...xs) - 0.6, X1 = Math.max(...xs) + 0.6, Y0 = Math.min(...ys) - 0.6, Y1 = Math.max(...ys) + 0.6;
    const svg = svgEl('svg', { viewBox: `${X0} ${-Y1} ${X1 - X0} ${Y1 - Y0}`, class: 'fanplan', role: 'img', 'aria-label': `${f.name}: fan positions` });
    for (const r of f.rooms) {
      svg.append(svgEl('rect', { x: r.nx0, y: -r.ny1, width: r.nx1 - r.nx0, height: r.ny1 - r.ny0, class: r.court ? 'fp-court' : 'fp-room' }));
      const fs = Math.max(0.22, Math.min(0.42, (r.nx1 - r.nx0) / 7));
      svg.append(svgEl('text', { x: (r.nx0 + r.nx1) / 2, y: -(r.ny0 + r.ny1) / 2 + fs * 0.35, 'font-size': fs, class: 'fp-t' }, r.name.replace('Master Bedroom', 'Master').replace('Bedroom ', 'Bed ')));
    }
    for (const o of f.opens) {
      if (o.kind !== 'window') continue;
      const w = o.wallObj, a = o.at - o.width / 2;
      svg.append(w.orient === 'V' ? svgEl('rect', { x: w.coord - 0.08, y: -(a + o.width), width: 0.16, height: o.width, class: 'fp-win' }) : svgEl('rect', { x: a, y: -(w.coord + 0.08), width: o.width, height: 0.16, class: 'fp-win' }));
    }
    for (const fan of fans) {
      const room = f.rooms.find((r) => r.id === fan.roomId), D = (FAN_TYPES[fan.type] || FAN_TYPES.standard).d;
      const g = svgEl('g', { class: 'fp-fan', tabindex: '0', role: 'button', 'aria-label': `Fan in ${room.name}: drag or use arrow keys to move` });
      const place = (x, y) => {
        clear(g);
        g.append(svgEl('circle', { cx: x, cy: -y, r: D / 2, class: 'fp-sweep' }), svgEl('circle', { cx: x, cy: -y, r: 0.12, class: 'fp-hub' }));
        for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.5; g.append(svgEl('line', { x1: x, y1: -y, x2: x + Math.cos(a) * D * 0.45, y2: -y - Math.sin(a) * D * 0.45, class: 'fp-blade' })); }
      };
      place(fan.x, fan.y);
      const m = 0.45, clampX = (x) => Math.min(room.nx1 - m, Math.max(room.nx0 + m, x)), clampY = (y) => Math.min(room.ny1 - m, Math.max(room.ny0 + m, y));
      let drag = false;
      g.addEventListener('pointerdown', (e) => { drag = true; g.setPointerCapture(e.pointerId); e.preventDefault(); });
      g.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const q = pt.matrixTransform(svg.getScreenCTM().inverse());
        fan.x = clampX(q.x); fan.y = clampY(-q.y); place(fan.x, fan.y);
      });
      const end = () => { if (!drag) return; drag = false; onMove(fan, Math.round(fan.x / FT * 4) / 4, Math.round(fan.y / FT * 4) / 4); };
      g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
      g.addEventListener('keydown', (e) => {
        const s = 0.25 * FT, d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key];
        if (!d) return;
        e.preventDefault();
        onMove(fan, Math.round(clampX(fan.x + d[0]) / FT * 4) / 4, Math.round(clampY(fan.y + d[1]) / FT * 4) / 4);
      });
      svg.append(g);
    }
    return h('div', { class: 'fanplan-wrap' }, svg);
  }

  function cardDays() {
    const box = h('div');
    const drawDays = () => {
      clear(box);
      if (!locOk()) { box.append(h('p', { class: 'small muted' }, 'Set the location first: the seasons depend on it.')); return; }
      const SS = seasonSet(st.location.lat, st.location.lon), sel = st.days.seasons || SS.seasons.map((x) => x.key);
      box.append(h('p', { class: 'small muted' }, SS.system === 'IMD' ? 'Indian seasons (IMD). Each is a typical day: the hour-by-hour median of that season over the last 10 years.' : `Seasons (${SS.system}). Each is a typical day: the hour-by-hour median over the last 10 years.`),
        h('div', { class: 'chips' }, SS.seasons.map((x) => {
          const on = sel.includes(x.key);
          return h('label', { class: `check chip${on ? ' on' : ''}`, 'data-season': x.key }, h('input', { type: 'checkbox', checked: on, onchange: (e) => {
            const next = new Set(sel); if (e.target.checked) next.add(x.key); else next.delete(x.key);
            st.days.seasons = SS.seasons.map((q) => q.key).filter((k2) => next.has(k2)); if (st.days.seasons.length === SS.seasons.length) st.days.seasons = null;
            save(); drawDays();
          } }), h('span', {}, `${x.name} `, h('small', { class: 'muted' }, monthsTxt(x.months))));
        })));
      const di = h('input', { type: 'date', 'aria-label': 'Add a date' });
      box.append(h('h4', {}, 'Particular dates'),
        h('p', { class: 'small muted' }, "Past dates use that day's recorded weather; the next two weeks use the forecast; further ahead, the typical day for that date."),
        h('div', { class: 'row' }, di, h('button', { type: 'button', class: 'btn sm', onclick: () => {
          if (!di.value) return;
          const d = st.days.dates || (st.days.dates = []);
          if (!d.includes(di.value)) { if (d.length >= 6) { toast('Up to six dates.'); return; } d.push(di.value); d.sort(); save(); }
          drawDays();
        } }, 'Add date')),
        h('div', { class: 'chips' }, (st.days.dates || []).map((d) => h('span', { class: 'chip on' }, d, h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${d}`, onclick: () => { st.days.dates = st.days.dates.filter((q2) => q2 !== d); save(); drawDays(); } }, '×')))));
    };
    drawDays();
    return card('Days to simulate', 'Each becomes a tab in the results.', box);
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthsTxt = (ms) => (ms.length > 1 ? `${MON[ms[0] - 1]}–${MON[ms[ms.length - 1] - 1]}` : MON[ms[0] - 1]);

  // ============================================================================================== RUN
  async function getClimate(lat, lon, onProgress) {
    const key = `climate:v1:${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (S.climate.has(key)) return S.climate.get(key);
    let c = await cacheGet(key);
    if (!c) {
      const f = await fetchClimate(lat, lon, { years: 10, onProgress });
      c = { offsetS: f.offsetS, elevation: f.elevation, timezone: f.timezone, years: f.years, t: f.t };
      for (const k of VARS) c[k] = Float32Array.from(f[k]);
      await cachePut(key, c);
    }
    S.climate.set(key, c);
    return c;
  }

  async function run(status, btn) {
    if (!locOk()) { toast('Set the location first.', 'bad'); return; }
    const loc = st.location;
    rebuild();
    btn.disabled = true;
    const say = (t) => { status.textContent = t; };
    try {
      let climate = null, offline = false;
      try {
        say(`Downloading 10 years of hourly weather for ${loc.name || 'the site'} (once per place)…`);
        climate = await getClimate(loc.lat, loc.lon, (f) => say(`Downloading 10 years of hourly weather… ${Math.round(f * 100)} %`));
      } catch (e) {
        const ok = await modal({ title: 'Weather download failed', body: h('div', {}, h('p', {}, e.message), h('p', { class: 'muted' }, "Run with the notebook's synthetic weather instead? The results are then labelled SYNTHETIC: fine for comparing layouts, not for real conditions.")),
          actions: [['Cancel', null], ['Use synthetic weather', true, 'primary']] });
        if (!ok) { say(''); return; }
        offline = true;
      }
      const days = dayList(st, loc.lat, loc.lon);
      if (!days.length) { toast('Pick at least one season or date.', 'bad'); say(''); return; }
      let done = 0;
      say(`Simulating ${days.length} day${days.length > 1 ? 's' : ''} on up to ${pool.n} cores…`);
      const t0 = performance.now(), mySig = sig, myBuilt = built;
      await Promise.all(days.map(async (day) => {
        const info = await weatherFor(day, { climate, lat: loc.lat, lon: loc.lon, offline });
        const opts = dayOptions(st, myBuilt, info, { lat: loc.lat, lon: loc.lon, climate });
        const res = await pool.run({ cmd: 'day', house: myBuilt.house, fans: myBuilt.fans, wx: info.wx, opts }, { priority: 5, tag: 'day' });
        const meta = { label: info.label, source: info.source, date: info.date, meanOutdoor: info.meanOutdoor };
        const entry = { res, info: meta, day };
        S.results.set(`${mySig}|${day.key}`, entry);
        if (info.source !== 'forecast') cachePut(`res:${mySig}|${day.key}`, entry);
        done++; say(`Simulated ${done} of ${days.length}…`);
      }));
      say(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
      ui.mode = 'results'; ui.dayKey = days[0].key; draw();
    } catch (e) {
      console.error(e); say(''); toast(`Simulation failed: ${e.message}`, 'bad', 7000);
    } finally { btn.disabled = false; }
  }

  // ============================================================================================== RESULTS
  function drawResults() {
    const loc = st.location, days = dayList(st, loc.lat, loc.lon).filter((d) => S.results.has(`${sig}|${d.key}`));
    if (!days.length) { ui.mode = 'setup'; draw(); return; }
    if (!days.some((d) => d.key === ui.dayKey)) ui.dayKey = days[0].key;
    const fl = built.model.floors;
    ui.floorIndex = Math.min(ui.floorIndex, fl.length - 1);
    // one temperature scale across days and floors, so seasons and floors compare by colour
    let lo = Infinity, hi = -Infinity;
    for (const d of days) { const { res } = S.results.get(`${sig}|${d.key}`); for (const arr of [...res.Tair, ...res.SET, res.Tout]) for (const v of arr) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    const tRange = [Math.floor(lo) - 0.5, Math.ceil(hi) + 0.5];
    const cur = S.results.get(`${sig}|${ui.dayKey}`), R = cur.res, model = built.model, f = fl[ui.floorIndex];
    const uMid = (fr) => fr.ffl + 1.5;

    const dayTabs = h('div', { class: 'daytabs', role: 'tablist', 'aria-label': 'Day' }, days.map((d) => {
      const r = S.results.get(`${sig}|${d.key}`).res;
      return h('button', { type: 'button', role: 'tab', class: `dtab${d.key === ui.dayKey ? ' on' : ''}`, 'aria-selected': String(d.key === ui.dayKey), 'data-day': d.key, onclick: () => { ui.dayKey = d.key; draw(); } },
        h('b', {}, d.label), h('small', {}, `${Math.min(...r.Tout).toFixed(0)}–${Math.max(...r.Tout).toFixed(0)} °C outside`));
    }));
    const floorTabs = fl.length > 1 ? h('div', { class: 'floortabs inner', role: 'tablist', 'aria-label': 'Floor' }, fl.map((x, i) => h('button', { type: 'button', role: 'tab', class: `ftab${i === ui.floorIndex ? ' on' : ''}`, 'aria-selected': String(i === ui.floorIndex), 'data-floor': String(x.level), onclick: () => { ui.floorIndex = i; draw(); } }, x.name))) : null;
    const info = h('p', { class: `small wind-info${cur.info.source === 'synthetic' ? ' warn' : ' muted'}` },
      `${cur.info.label} · outdoor ${Math.min(...R.Tout).toFixed(1)}–${Math.max(...R.Tout).toFixed(1)} °C · ${f.name}: floor at +${f.ffl.toFixed(2)} m, wind there ${windFactor(uMid(f), st.terrain).toFixed(2)} × the 10 m reading · comfort band ${R.band.lo.toFixed(1)}–${R.band.hi.toFixed(1)} °C (${R.band.model})`);

    const timeLbl = h('output', { class: 'num tlabel' }, hh(ui.t));
    const slider = h('input', { type: 'range', min: '0', max: '24', step: '0.25', value: String(ui.t), 'aria-label': 'Time of day', class: 'tslider' });
    const playBtn = h('button', { type: 'button', class: 'btn sm wplay', 'aria-label': ui.playing ? 'Pause' : 'Play' }, ui.playing ? 'Pause' : 'Play');
    const setPlay = (on) => { ui.playing = on; playBtn.textContent = on ? 'Pause' : 'Play'; playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play'); };
    playBtn.addEventListener('click', () => setPlay(!ui.playing));
    slider.addEventListener('input', () => { ui.t = Number(slider.value); setPlay(false); });
    const controls = h('div', { class: 'wctl' }, playBtn, slider, timeLbl,
      seg([[0.5, '½×'], [1, '1×'], [3, '3×']], ui.speed, (v) => { ui.speed = Number(v); }, { 'aria-label': 'Playback speed' }),
      seg([['air', 'Air temp'], ['set', 'Feels like']], ui.colorBy, (v) => { ui.colorBy = v; draw(); }, { 'aria-label': 'Colour rooms by' }),
      seg([['plan', 'Plan'], ['section', 'Section']], ui.view, (v) => { ui.view = v; draw(); }, { 'aria-label': 'View' }),
      h('button', { type: 'button', class: 'btn sm ghost', onclick: () => exportCsv(cur, days) }, 'Download CSV'));

    const viewBox = h('div', { class: 'wviews' });
    let view = null;
    const vmax = Math.max(1, ...R.hours.map((x) => x.U10 * windFactor(uMid(f), st.terrain))) * 1.25;
    if (ui.view === 'plan') {
      view = mountPlanViews(viewBox, { model, floorIndex: ui.floorIndex, result: R, fans: built.fans, fieldFor: (k) => fieldAt(cur, ui.floorIndex, k), colorBy: ui.colorBy, tRange, terrain: st.terrain, vmax });
    } else {
      if (!ui.cut) ui.cut = defaultCut(model);
      const [c0, c1] = cutRange(model, ui.cut.axis);
      const cutSlider = h('input', { type: 'range', min: String(c0 + 0.05), max: String(c1 - 0.05), step: '0.05', value: String(Math.min(c1 - 0.05, Math.max(c0 + 0.05, ui.cut.at))), 'aria-label': 'Where the section cuts' });
      const key = keyPlan(f, ui.cut);
      cutSlider.addEventListener('input', () => { ui.cut.at = Number(cutSlider.value); view.refresh({ cut: ui.cut }); keyLine(key, f, ui.cut); });
      viewBox.append(h('div', { class: 'cutbar' },
        seg([['EW', 'Cut west–east'], ['NS', 'Cut south–north']], ui.cut.axis, (v) => { const d = defaultCut(model); ui.cut = v === d.axis ? d : { axis: v, at: (cutRange(model, v)[0] + cutRange(model, v)[1]) / 2 }; draw(); }, { 'aria-label': 'Section direction' }),
        h('label', { class: 'row small cutpos' }, 'Position', cutSlider), key,
        h('span', { class: 'small muted' }, 'Openings in the walls the cut crosses are drawn in the cut. Arrows: blue = outdoor air in, red = out, grey = room to room; in the stair, orange = up, blue = down.')));
      const sec = h('div', { class: 'wsection' });
      viewBox.append(sec);
      view = mountSection(sec, { model, result: R, floorIndex: ui.floorIndex, cut: ui.cut, colorBy: ui.colorBy, tRange, terrain: st.terrain, fans: built.fans });
    }

    const zonesHere = model.zones.map((z, i) => ({ z, i })).filter((x) => x.z.floor === ui.floorIndex);
    const series = zonesHere.map((x, k) => ({ name: x.z.name, zone: x.i, color: PALETTE[k % PALETTE.length], values: Array.from(ui.colorBy === 'set' ? R.SET[x.i] : R.Tair[x.i]) }));
    const pick = (n) => { ui.highlight = ui.highlight === n ? null : n; tc.highlight(ui.highlight); };
    const tc = tempChart({ series, outdoor: Array.from(R.Tout), band: R.band, frameMin: R.frameMin, range: tRange, title: 'Room temperatures through the day', onPick: pick });
    if (ui.highlight) tc.highlight(ui.highlight);
    const fanZones = [...new Set(built.fans.filter((x) => model.zones[x.zone].floor === ui.floorIndex).map((x) => x.zone))];
    const wc = windChart({ hours: R.hours, uFloor: R.hours.map((x) => x.U10 * windFactor(uMid(f), st.terrain)), floorIndex: ui.floorIndex, fanZones, rotation: model.rotation });
    const charts = h('div', { class: 'wcharts' },
      h('div', {}, h('h3', {}, ui.colorBy === 'set' ? 'Feels like (SET) through the day' : 'Air temperature through the day', h('small', { class: 'muted' }, ` — ${f.name}`)), tc.el, legend(series, pick)),
      h('div', {}, h('h3', {}, 'Wind, windows and fans', h('small', { class: 'muted' }, ` — ${f.name}`)), wc.el));

    const rows = zonesHere.map((x) => {
      const s = R.summary[x.i], fanN = built.fans.filter((q) => q.zone === x.i).length;
      return h('tr', {}, h('td', {}, x.z.name), h('td', { class: 'num' }, `${s.min.toFixed(1)}–${s.max.toFixed(1)}`), h('td', { class: 'num' }, `${s.setMin.toFixed(1)}–${s.setMax.toFixed(1)}`),
        h('td', { class: 'num' }, s.achMean >= 100 ? '100+' : s.achMean.toFixed(1)), h('td', { class: 'num' }, `${s.comfortHours.toFixed(1)} h`), h('td', { class: 'num' }, fanN ? `${fanN} · ${Math.max(...R.vFan[x.i]).toFixed(1)} m/s` : '—'));
    });
    const table = h('div', { class: 'wtable-wrap' }, h('h3', {}, `Rooms over the day — ${f.name}`),
      h('table', { class: 'wtable' }, h('thead', {}, h('tr', {}, h('th', {}, 'Room'), h('th', {}, 'Air °C'), h('th', {}, 'Feels like °C'), h('th', {}, 'Air changes / h'), h('th', {}, 'Comfortable'), h('th', {}, 'Fans · air speed'))), h('tbody', {}, rows)),
      h('p', { class: 'small muted' }, 'Comfortable: operative temperature inside the adaptive band, widened for moving air above 25 °C (ASHRAE 55). Feels like: Standard Effective Temperature (Gagge two-node model) from air and surface temperatures, humidity, air speed (wind and fans), activity and the day\'s clothing.'));
    const notes = h('details', { class: 'wnotes' }, h('summary', {}, 'How this is modelled (and what it leaves out)'),
      h('ul', {},
        h('li', {}, "Airflow between rooms and outdoors: a pressure network over all floors (as CONTAM / EnergyPlus AirflowNetwork). Wind pressure on each opening uses the wind at that opening's own height (terrain profile) with low-rise pressure coefficients; the stack effect uses each room's air density, so one opening can breathe in at the bottom and out at the top. Floors are joined through the stair well (net flow plus buoyant exchange)."),
        h('li', {}, "Wind pictures in plan: 2D lattice-Boltzmann flow at the floor (the notebook's solver), scaled to the wind at that floor's height; neighbours block it only if they are taller than the floor. Read them as patterns, not measurements."),
        h('li', {}, "Heat: walls, slabs, roof and ground as thermal masses; sun through windows (with sunshades and neighbours' shadows), sun and night sky on the roof, people and cooking, fan motors. Typical days are hour-by-hour medians of 10 years of ERA5 data, so heat waves and storms are smoothed out."),
        h('li', {}, 'Not modelled: air-conditioning, curtains, furniture in the way of the air, rain on walls, the exact stair geometry, and changes of wind direction within an hour.')));

    body.append(h('div', { class: 'wres' }, dayTabs, floorTabs, info, controls, viewBox, charts, table, notes));
    if (ui.view === 'plan') prefetch(cur, ui.floorIndex, ui.t);

    let raf = 0, last = performance.now(), lastHour = Math.floor(ui.t);
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (ui.playing) { ui.t += dt * ui.speed; if (ui.t >= 24) ui.t -= 24; slider.value = String(Math.round(ui.t * 4) / 4); }
      timeLbl.textContent = hh(Math.floor(ui.t * 4) / 4);
      view.draw(ui.t); tc.setCursor(ui.t); wc.setCursor(ui.t);
      const hr = Math.floor(ui.t);
      if (hr !== lastHour && ui.view === 'plan') { lastHour = hr; prefetch(cur, ui.floorIndex, ui.t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    stopAnim = () => { cancelAnimationFrame(raf); view.destroy(); };
    window.__ahWind = { ui, R, model, built, sig, fields: S.fields, results: S.results, pending: S.pending };
  }

  function keyPlan(f, cut) {
    const xs = f.rooms.flatMap((r) => [r.x0, r.x1]), ys = f.rooms.flatMap((r) => [r.y0, r.y1]);
    const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
    const svg = svgEl('svg', { viewBox: `${X0 - 0.6} ${-Y1 - 0.6} ${X1 - X0 + 1.2} ${Y1 - Y0 + 1.2}`, class: 'keyplan', role: 'img', 'aria-label': 'Where the section cuts the plan' });
    for (const r of f.rooms) svg.append(svgEl('rect', { x: r.x0, y: -r.y1, width: r.x1 - r.x0, height: r.y1 - r.y0, class: r.type === 'stair' ? 'kp-stair' : 'kp-room' }));
    svg.append(svgEl('line', { class: 'kp-cut' }));
    keyLine(svg, f, cut);
    return svg;
  }
  function keyLine(svg, f, cut) {
    const xs = f.rooms.flatMap((r) => [r.x0, r.x1]), ys = f.rooms.flatMap((r) => [r.y0, r.y1]), l = svg.querySelector('.kp-cut');
    if (cut.axis === 'EW') { l.setAttribute('x1', Math.min(...xs) - 0.6); l.setAttribute('x2', Math.max(...xs) + 0.6); l.setAttribute('y1', -cut.at); l.setAttribute('y2', -cut.at); }
    else { l.setAttribute('y1', -Math.min(...ys) + 0.6); l.setAttribute('y2', -Math.max(...ys) - 0.6); l.setAttribute('x1', cut.at); l.setAttribute('x2', cut.at); }
  }

  // ------------------------------------------------------------------------ wind pictures (LBM fields)
  function geoOf(fi) {
    if (!geoCache.has(fi)) { const geo = lbmGeometry(built.model, fi); geoCache.set(fi, { geo, gs: hashStr(JSON.stringify(geo) + JSON.stringify(LBM)) }); }
    return geoCache.get(fi);
  }
  const keyMemo = new WeakMap();
  function keyFor(cur, fi, k) {
    let memo = keyMemo.get(cur.res); if (!memo) { memo = new Map(); keyMemo.set(cur.res, memo); }
    const mk = `${fi}|${k}`;
    if (memo.has(mk)) return memo.get(mk);
    const hr = cur.res.hours[k];
    let q = null;
    if (hr) { const { geo, gs } = geoOf(fi), bits = floorState(geo, hr), bin = binOf(hr.wd, built.model.rotation); q = { key: lbmKey(fi, bin, bits, gs), geo, bits, bin }; }
    memo.set(mk, q);
    return q;
  }
  function fieldAt(cur, fi, k) {
    const q = keyFor(cur, fi, k); if (!q) return null;
    const f = S.fields.get(q.key); if (f) return f;
    request(q, 10);
    return null;
  }
  async function request(q, priority) {
    if (S.pending.has(q.key) || S.fields.has(q.key)) return;
    S.pending.add(q.key);
    try {
      let f = await cacheGet(`lbm:${q.key}`);
      if (!f) { f = await pool.run({ cmd: 'lbm', geo: q.geo, state: q.bits, bin: q.bin, ...LBM }, { priority, tag: 'lbm' }); cachePut(`lbm:${q.key}`, f); }
      S.fields.set(q.key, f);
    } catch { /* dropped or failed: asked for again when needed */ } finally { S.pending.delete(q.key); }
  }
  function prefetch(cur, fi, t) {
    pool.drop('lbm');
    const order = Array.from({ length: 25 }, (_, k) => k).sort((a, b) => Math.abs(a - t) - Math.abs(b - t));
    order.forEach((k, n) => { const q = keyFor(cur, fi, k); if (q) request(q, 9 - Math.min(8, n / 3)); });
  }

  function exportCsv(cur, days) {
    const R = cur.res, z = built.model.zones, fn = (q) => built.model.floors[q.floor].name;
    const headRow = ['time', 'outdoor_C', ...z.flatMap((q) => [`${q.name} [${fn(q)}] air_C`, `${q.name} [${fn(q)}] feels_like_C`])];
    const lines = [headRow.map((x) => `"${x}"`).join(',')];
    for (let f = 0; f < R.Tout.length; f++) lines.push([hh(f * R.frameMin / 60), R.Tout[f].toFixed(2), ...z.flatMap((_, i) => [R.Tair[i][f].toFixed(2), R.SET[i][f].toFixed(2)])].join(','));
    const d = days.find((x) => x.key === ui.dayKey), slug = (s2) => s2.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    download(`${slug(p.name)}-${slug(d ? d.label : 'day')}.csv`, lines.join('\n'), 'text/csv');
  }

  // restore cached results, then draw
  app.actions([]);
  (async () => {
    if (locOk()) {
      for (const d of dayList(st, st.location.lat, st.location.lon)) {
        const k = `${sig}|${d.key}`;
        if (!S.results.has(k)) { const c = await cacheGet(`res:${k}`); if (c) S.results.set(k, c); }
      }
      if (haveResults()) ui.mode = 'results';
    }
    draw();
  })();
}
