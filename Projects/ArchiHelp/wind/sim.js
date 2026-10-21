// ArchiHelp wind — orchestration: model, days (season tabs / chosen dates), weather per day, LBM jobs per floor.
import { prepareHouse, simulateHouse } from './house.js';
import { houseFromFloors } from './fromplan.js';
import { seasonSet, seasonDay, dateTypicalDay, profileSeries, rangeSeries, fetchRange, syntheticSeries, annualMean, mod, ymd } from './weather.js';
import { buildMask, makeGrid } from './lbm.js';

export const BIN_DEG = 22.5;
export const SPINUP_DAYS = 3;
const DAY = 86400;

/** House model, fans mapped to zones, and anything that could not be modelled. */
export function buildModel(floors, cfg, settings) {
  const { house, fans, skipped } = houseFromFloors(floors, cfg, settings);
  if (!house.floors.length) throw new Error('No floor has a plan yet: design or trace a floor first.');
  const model = prepareHouse(house);
  const zoneOf = new Map(model.zones.map((z, i) => [z.id, i]));
  const zfans = fans.filter((f) => zoneOf.has(f.roomId)).map((f) => ({ ...f, zone: zoneOf.get(f.roomId) }));
  return { house, model, fans: zfans, skipped, warnings: model.warnings };
}

/** Day tabs: one per selected season (typical day), then the chosen dates. */
export function dayList(settings, lat, lon) {
  const S = seasonSet(lat, lon), sel = settings.days && settings.days.seasons;
  const out = S.seasons.filter((s) => !sel || sel.includes(s.key)).map((s) => ({ key: `season:${s.key}`, kind: 'season', label: s.name, season: s, system: S.system }));
  for (const d of (settings.days && settings.days.dates) || []) out.push({ key: `date:${d}`, kind: 'date', label: new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), date: d });
  return out;
}

/** Representative calendar date of a season (for the sun path), in the latest climate year. */
export function seasonDate(season, climate) {
  const y = climate ? climate.years[1] : new Date().getUTCFullYear() - 1;
  return `${y}-${String(season.center[0]).padStart(2, '0')}-${String(season.center[1]).padStart(2, '0')}`;
}

/**
 * Weather series for a day tab. Seasons: median day of the climate over the season. Dates: the real day (archive or
 * forecast) when available, else the typical day around that date. -> { wx, source, label, date, meanOutdoor }
 */
export async function weatherFor(day, { climate, lat, lon, fetchFn = fetch, today = new Date(), offline = false }) {
  if (offline || (!climate && day.kind === 'season')) {
    const date = day.kind === 'season' ? seasonDate(day.season, null) : day.date;
    return { wx: syntheticSeries(date, lat, lon, SPINUP_DAYS), source: 'synthetic', label: 'SYNTHETIC weather (not real data)', date, meanOutdoor: 24 };
  }
  if (day.kind === 'season') {
    const td = seasonDay(climate, day.season), date = seasonDate(day.season, climate);
    return { wx: profileSeries(td.prof, date, climate.offsetS, SPINUP_DAYS), source: 'typical', date, meanOutdoor: td.meanT,
      label: `typical ${day.label.toLowerCase()} day: median of ${climate.years[0]}–${climate.years[1]} (${td.days} days), wind-direction consistency ${td.consistency.toFixed(2)}` };
  }
  const d = new Date(`${day.date}T00:00:00Z`), ahead = (d - today) / (DAY * 1000);
  if (ahead <= 15) {
    try {
      const start = ymd(new Date(d.getTime() - SPINUP_DAYS * DAY * 1000)), end = day.date;
      const r = await fetchRange(lat, lon, start, ymd(new Date(d.getTime() + DAY * 1000)), { fetchFn, today });
      const wx = rangeSeries(r);
      if (wx.n >= (SPINUP_DAYS + 1) * 24 + 1) {
        for (const k of Object.keys(wx)) if (wx[k] && wx[k].length > (SPINUP_DAYS + 1) * 24 + 1 && typeof wx[k] !== 'number') wx[k] = wx[k].slice(0, (SPINUP_DAYS + 1) * 24 + 1);
        wx.n = (SPINUP_DAYS + 1) * 24 + 1;
        const meanOutdoor = climate ? dateTypicalDay(climate, d.getUTCMonth() + 1, d.getUTCDate(), 15).meanT : Array.from(wx.T).reduce((a, v) => a + v, 0) / wx.n;
        return { wx, source: r.api, date: end, meanOutdoor, label: `${day.label} (Open-Meteo ${r.api === 'archive' ? 'ERA5 archive' : 'forecast'})` };
      }
    } catch (e) { if (!climate) throw e; }
  }
  if (!climate) throw new Error('No weather for that date and no climate data to build a typical day.');
  const td = dateTypicalDay(climate, d.getUTCMonth() + 1, d.getUTCDate(), 7);
  return { wx: profileSeries(td.prof, day.date, climate.offsetS, SPINUP_DAYS), source: 'typical', date: day.date, meanOutdoor: td.meanT,
    label: `${day.label}: beyond the forecast, typical day for the date (median of ${climate.years[0]}–${climate.years[1]}, ±7 days)` };
}

export const groundTemp = (climate) => (climate ? annualMean(climate) + 1 : null);

/** Simulation options for one day. */
export function dayOptions(settings, built, wxInfo, { lat, lon, climate }) {
  return { lat, lon, dt: 300, spinupDays: SPINUP_DAYS, terrain: settings.terrain || 'urban', windows: settings.windows || 'auto', interiorDoors: settings.interiorDoors || 'open',
    bathDoors: settings.bathDoors || 'closed', mumty: settings.mumty || 'never', fans: built.fans, india: seasonSet(lat, lon).system === 'IMD',
    meanOutdoor: wxInfo.meanOutdoor, tGround: groundTemp(climate) ?? undefined, frameMin: 15 };
}

/** Run one day (main thread or worker). house is the plain house model (prepareHouse is repeated in the worker). */
export function runDay(house, fans, wx, opts) {
  const model = prepareHouse(house);
  const res = simulateHouse(model, wx, { ...opts, fans });
  delete res.lastFlows;
  return res;
}

// ------------------------------------------------------------------------------------------------ LBM jobs (2D wind pictures)
/** Plain geometry of floor fi for the LBM grid; neighbours count only where they are taller than the floor's mid-height. */
export function lbmGeometry(model, fi) {
  const f = model.floors[fi], rooms = f.rooms;
  const xs = rooms.flatMap((r) => [r.x0, r.x1]), ys = rooms.flatMap((r) => [r.y0, r.y1]);
  const walls = f.walls.map((w) => ({ id: w.id, orient: w.orient, coord: w.coord, s0: w.s0, s1: w.s1, thick: w.thick, n: w.n, open: !!w.open }));
  const wi = new Map(walls.map((w, i) => [w.id, i]));
  const openings = f.opens.map((o) => ({ id: o.id, kind: o.kind, wallIndex: wi.get(o.wall), at: o.at, width: o.width, effHeight: o.effHeight, link: o.link }));
  const zMid = f.ffl + 1.2;
  return { floor: fi, xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys), walls, openings, storey: f.ceil,
    columns: f.columns, neighbours: (model.house.neighbours || []).filter((n) => n.height > zMid).map((n) => [n.x0, n.y0, n.x1, n.y1]) };
}
/** Rebuild the grid (worker side). */
export function gridFromGeometry(geo, { dx = 0.25, pad = 40 } = {}) {
  const walls = geo.walls.map((w) => ({ ...w }));
  const g = makeGrid({ ...geo, walls, openings: geo.openings.map((o) => ({ ...o, wallObj: walls[o.wallIndex] })) }, { dx, pad });
  return g;
}
/** Open/closed bits of a floor's openings at an hour of a result. */
export const floorState = (geo, hour) => geo.openings.map((o) => (o.link !== undefined && hour.open[o.link] > 0 ? 1 : 0));
export const binOf = (wdTrue, rotation) => mod(Math.round(mod(wdTrue - rotation, 360) / BIN_DEG) * BIN_DEG, 360);
export const lbmKey = (fi, bin, bits, sig = '') => `${sig}|f${fi}|b${bin}|${bits.join('')}`;
export { buildMask };
