// ArchiHelp wind — weather (Open-Meteo, public, no key), typical days, seasons and solar geometry.
// Port of floor_wind_thermal.ipynb cell 5, extended with humidity, cloud cover and rain (for comfort, sky radiation and
// window behaviour), season sets and one climate download per location that every season / future date is built from.
//
// Weather series (all arrays per hour, local time from a local midnight):
//   { t0Utc (s, first hour), n, offsetS, T, rh, td, ws, wd, ghi, dni, dhi, cc, pr, source, label, elevation }
export const OM_HOURLY = ['temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m', 'wind_direction_10m',
  'shortwave_radiation', 'direct_normal_irradiance', 'diffuse_radiation', 'cloud_cover', 'precipitation'];
const KEY = { temperature_2m: 'T', relative_humidity_2m: 'rh', dew_point_2m: 'td', wind_speed_10m: 'ws', wind_direction_10m: 'wd',
  shortwave_radiation: 'ghi', direct_normal_irradiance: 'dni', diffuse_radiation: 'dhi', cloud_cover: 'cc', precipitation: 'pr' };
export const VARS = Object.values(KEY);
export const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
export const FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
export const mod = (a, m) => ((a % m) + m) % m;            // Python / numpy floor modulo
const DAY = 86400;

// ------------------------------------------------------------------------------------------------ solar geometry
/** NOAA-style approximation (~0.1 deg), as the notebook. tUtc in unix seconds. -> [altitude, azimuth from N clockwise] deg. */
export function solarPosition(tUtc, lat, lon) {
  const jd = tUtc / DAY + 2440587.5, n = jd - 2451545.0;
  const L = rad(mod(280.460 + 0.9856474 * n, 360)), g = rad(mod(357.528 + 0.9856003 * n, 360));
  const lam = L + rad(1.915) * Math.sin(g) + rad(0.020) * Math.sin(2 * g);
  const eps = rad(23.439 - 0.0000004 * n);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = mod(18.697374558 + 24.06570982441908 * n, 24);
  const H = rad(gmst * 15 + lon) - ra, phi = rad(lat);
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return [deg(alt), mod(deg(A) + 180, 360)];
}

/** Irradiance (W/m2) on a vertical facade with outward-normal azimuth az (isotropic sky), as the notebook. */
export function facadeIrradiance(azTrue, alt, sunAz, dni, dhi, ghi, albedo = 0.2) {
  const cosInc = Math.cos(rad(alt)) * Math.cos(rad(sunAz - azTrue));
  return dni * Math.max(cosInc, 0) * (alt > 0 ? 1 : 0) + 0.5 * dhi + 0.5 * albedo * ghi;
}

// ------------------------------------------------------------------------------------------------ helpers
/** numpy.interp: x sorted ascending, clamps outside. */
export function interp(x, xp, fp) {
  const n = xp.length;
  if (x <= xp[0]) return fp[0];
  if (x >= xp[n - 1]) return fp[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xp[m] <= x) lo = m; else hi = m; }
  const t = (x - xp[lo]) / (xp[hi] - xp[lo]);
  return fp[lo] + t * (fp[hi] - fp[lo]);
}
function fillGaps(a) {
  const n = a.length; let last = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(a[i])) {
      if (last < 0) for (let k = 0; k < i; k++) a[k] = a[i];
      else for (let k = last + 1; k < i; k++) a[k] = a[last] + (a[i] - a[last]) * (k - last) / (i - last);
      last = i;
    }
  }
  if (last < 0) a.fill(0); else for (let k = last + 1; k < n; k++) a[k] = a[last];
  return a;
}
const median = (arr) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return NaN; const m = a.length >> 1; return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]); };
/** Vector-mean wind direction (deg, FROM) and its consistency (0 = random, 1 = constant), as the notebook. */
export function vectorMeanDir(ws, wd) {
  let u = 0, v = 0, s = 0, n = 0;
  for (let i = 0; i < ws.length; i++) {
    if (!Number.isFinite(ws[i]) || !Number.isFinite(wd[i])) continue;
    u += -ws[i] * Math.sin(rad(wd[i])); v += -ws[i] * Math.cos(rad(wd[i])); s += ws[i]; n++;
  }
  if (!n) return [0, 0];
  u /= n; v /= n; s /= n;
  return [mod(deg(Math.atan2(-u, -v)), 360), Math.hypot(u, v) / Math.max(s, 1e-6)];
}
export const ymd = (d) => d.toISOString().slice(0, 10);
/** Local calendar parts of a unix time, with a fixed UTC offset. */
export function localParts(tUtc, offsetS) {
  const d = new Date((tUtc + offsetS) * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), doy: Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) };
}

// ------------------------------------------------------------------------------------------------ Open-Meteo
async function omGet(base, params, fetchFn) {
  const url = `${base}?${new URLSearchParams(params)}`;
  const r = await fetchFn(url);
  if (!r.ok) { let t = ''; try { t = await r.text(); } catch { /* ignore */ } throw new Error(`Open-Meteo ${r.status}${t ? `: ${t.slice(0, 160)}` : ''}`); }
  const j = await r.json();
  if (!j.hourly || !j.hourly.time) throw new Error('Open-Meteo returned no hourly data');
  const n = j.hourly.time.length, out = { t: Float64Array.from(j.hourly.time), offsetS: j.utc_offset_seconds || 0, elevation: j.elevation ?? null, timezone: j.timezone || '' };
  for (const [om, k] of Object.entries(KEY)) {
    const src = j.hourly[om] || [];
    out[k] = fillGaps(Float64Array.from({ length: n }, (_, i) => (src[i] === null || src[i] === undefined ? NaN : src[i])));
  }
  return out;
}

/** Hourly weather for [start, end] (YYYY-MM-DD, local), archive (ERA5) for old dates, forecast API for recent ones. */
export async function fetchRange(lat, lon, start, end, { fetchFn = fetch, today = new Date() } = {}) {
  const p = { latitude: lat.toFixed(4), longitude: lon.toFixed(4), start_date: start, end_date: end, hourly: OM_HOURLY.join(','), wind_speed_unit: 'ms', timezone: 'auto', timeformat: 'unixtime' };
  const old = Date.parse(end) <= today.getTime() - 7 * DAY * 1000;
  const urls = old ? [ARCHIVE, FORECAST] : [FORECAST, ARCHIVE];
  let last = null;
  for (const u of urls) { try { return { ...(await omGet(u, p, fetchFn)), api: u === ARCHIVE ? 'archive' : 'forecast' }; } catch (e) { last = e; } }
  throw new Error(`Open-Meteo fetch failed: ${last && last.message}`);
}

/** Ten (or `years`) complete past years of hourly weather in a few requests: the source of every season and typical day. */
export async function fetchClimate(lat, lon, { years = 10, fetchFn = fetch, today = new Date(), onProgress } = {}) {
  const y1 = today.getUTCFullYear() - 1, y0 = y1 - years + 1, chunks = [];
  for (let a = y0; a <= y1; a += 5) chunks.push([a, Math.min(y1, a + 4)]);
  let done = 0;
  const parts = await Promise.all(chunks.map(async ([a, b]) => {
    const r = await omGet(ARCHIVE, { latitude: lat.toFixed(4), longitude: lon.toFixed(4), start_date: `${a}-01-01`, end_date: `${b}-12-31`, hourly: OM_HOURLY.join(','), wind_speed_unit: 'ms', timezone: 'auto', timeformat: 'unixtime' }, fetchFn);
    done++; if (onProgress) onProgress(done / chunks.length);
    return r;
  }));
  const out = { offsetS: parts[0].offsetS, elevation: parts[0].elevation, timezone: parts[0].timezone, years: [y0, y1] };
  out.t = Float64Array.from(parts.flatMap((p) => Array.from(p.t)));
  for (const k of VARS) out[k] = Float64Array.from(parts.flatMap((p) => Array.from(p[k])));
  return out;
}

// ------------------------------------------------------------------------------------------------ seasons + typical days
/** Season tabs for a location: Indian (IMD) seasons in South Asia, else the four meteorological seasons by hemisphere. */
export function seasonSet(lat, lon) {
  if (lat >= 5 && lat <= 37.5 && lon >= 60.5 && lon <= 97.5) {
    return { system: 'IMD', seasons: [
      { key: 'winter', name: 'Winter', months: [1, 2], center: [1, 30] },
      { key: 'summer', name: 'Summer', months: [3, 4, 5], center: [4, 15] },
      { key: 'monsoon', name: 'Monsoon', months: [6, 7, 8, 9], center: [7, 31] },
      { key: 'postmonsoon', name: 'Post-monsoon', months: [10, 11, 12], center: [11, 15] }] };
  }
  const nh = lat >= 0;
  const S = [[[12, 1, 2], [1, 15]], [[3, 4, 5], [4, 15]], [[6, 7, 8], [7, 15]], [[9, 10, 11], [10, 15]]];
  const names = nh ? ['Winter', 'Spring', 'Summer', 'Autumn'] : ['Summer', 'Autumn', 'Winter', 'Spring'];
  const seasons = S.map(([months, center], i) => ({ key: names[i].toLowerCase(), name: names[i], months, center }));
  return { system: nh ? 'meteorological (north)' : 'meteorological (south)', seasons: nh ? seasons : [seasons[2], seasons[3], seasons[0], seasons[1]] };
}

/**
 * Median day of the climate over the selected days (all years). select(parts) -> bool. Returns 24 hourly values per
 * variable + wind-direction consistency, the mean outdoor temperature of the selection (prevailing mean, for comfort)
 * and the number of days used.
 */
export function typicalDay(clim, select) {
  const by = Array.from({ length: 24 }, () => ({ idx: [] }));
  let sumT = 0, nT = 0; const days = new Set();
  for (let i = 0; i < clim.t.length; i++) {
    const p = localParts(clim.t[i], clim.offsetS);
    if (!select(p)) continue;
    by[p.h].idx.push(i); days.add(`${p.y}-${p.doy}`);
    if (Number.isFinite(clim.T[i])) { sumT += clim.T[i]; nT++; }
  }
  if (!days.size) throw new Error('No climate data for that period.');
  const prof = { hours: 24 }; let cons = 0;
  for (const k of VARS) prof[k] = new Float64Array(24);
  for (let h = 0; h < 24; h++) {
    const I = by[h].idx;
    for (const k of ['T', 'rh', 'td', 'ws', 'ghi', 'dni', 'dhi', 'cc']) prof[k][h] = median(I.map((i) => clim[k][i]));
    prof.pr[h] = I.length ? I.reduce((a, i) => a + (clim.pr[i] || 0), 0) / I.length : 0;
    const [wd, c] = vectorMeanDir(I.map((i) => clim.ws[i]), I.map((i) => clim.wd[i]));
    prof.wd[h] = wd; cons += c / 24;
  }
  return { prof, consistency: cons, meanT: sumT / Math.max(nT, 1), days: days.size };
}

/** Typical-day profile for a season of seasonSet(). */
export const seasonDay = (clim, season) => typicalDay(clim, (p) => season.months.includes(p.m));

/** Typical-day profile around a calendar date (+-window days, every year), as the notebook's MODE = 'typical'. */
export function dateTypicalDay(clim, month, day, window = 7) {
  const c = Math.floor((Date.UTC(2001, month - 1, Math.min(day, 28 + (month !== 2 ? 3 : 0))) - Date.UTC(2001, 0, 1)) / 864e5);
  return typicalDay(clim, (p) => { const d = Math.abs(p.doy - c); return Math.min(d, 365 - d) <= window; });
}

/** Annual mean air temperature of the climate (deep-ground temperature for slabs on grade). */
export function annualMean(clim) { let s = 0, n = 0; for (const v of clim.T) if (Number.isFinite(v)) { s += v; n++; } return s / Math.max(n, 1); }

/** Repeat a 24-h profile into a series of (spin-up days + 1) days + the closing midnight, starting at a local midnight. */
export function profileSeries(prof, dateYmd, offsetS, spinupDays = 3) {
  const days = spinupDays + 1, n = days * 24 + 1;
  const t0 = Date.parse(`${dateYmd}T00:00:00Z`) / 1000 - offsetS - spinupDays * DAY;
  const out = { t0Utc: t0, n, offsetS };
  for (const k of VARS) { out[k] = new Float64Array(n); for (let i = 0; i < n; i++) out[k][i] = prof[k][i % 24]; }
  return out;
}

/** Series from a fetched range (must start at local midnight of the first day). */
export function rangeSeries(r) {
  const n = r.t.length, out = { t0Utc: r.t[0], n, offsetS: r.offsetS, elevation: r.elevation };
  for (const k of VARS) out[k] = Float64Array.from(r[k]);
  return out;
}

/** The notebook's synthetic weather (pipeline testing / offline only; always labelled as such). */
export function syntheticSeries(dateYmd, lat, lon, spinupDays = 3) {
  const offsetS = Math.round(lon / 15) * 3600, days = spinupDays + 1, n = days * 24 + 1;
  const t0 = Date.parse(`${dateYmd}T00:00:00Z`) / 1000 - offsetS - spinupDays * DAY;
  const out = { t0Utc: t0, n, offsetS, synthetic: true };
  for (const k of VARS) out[k] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hh = i % 24;
    out.T[i] = 24 + 6 * Math.sin(2 * Math.PI * (hh - 9) / 24);
    out.ws[i] = 2.5 + 1.5 * Math.sin(2 * Math.PI * (hh - 9) / 24);
    out.wd[i] = mod(225 + 40 * Math.sin(2 * Math.PI * hh / 24), 360);
    const [alt] = solarPosition(t0 + i * 3600 - 1800, lat, lon);            // radiation = mean of the preceding hour
    const s = Math.max(Math.sin(rad(alt)), 0), am = 1 / Math.max(s, 0.05);
    out.dni[i] = s > 0 ? 1353 * 0.7 ** (am ** 0.678) : 0;
    out.dhi[i] = 0.1 * out.dni[i] * s + 20 * s;
    out.ghi[i] = out.dni[i] * s + out.dhi[i];
    out.rh[i] = 65 - 15 * Math.sin(2 * Math.PI * (hh - 9) / 24);
    out.td[i] = dewPoint(out.T[i], out.rh[i]);
    out.cc[i] = 30; out.pr[i] = 0;
  }
  return out;
}

/** Magnus dew point (deg C). */
export function dewPoint(T, rh) { const a = 17.625, b = 243.04, g = Math.log(Math.max(rh, 1) / 100) + a * T / (b + T); return b * g / (a - g); }

/** Place search (Open-Meteo geocoding). -> [{ name, admin, country, lat, lon, elevation, timezone }] */
export async function geocode(q, { fetchFn = fetch, count = 6 } = {}) {
  const r = await fetchFn(`${GEOCODE}?${new URLSearchParams({ name: q, count: String(count), language: 'en', format: 'json' })}`);
  if (!r.ok) throw new Error(`Place search failed (${r.status})`);
  const j = await r.json();
  return (j.results || []).map((x) => ({ name: x.name, admin: x.admin1 || '', country: x.country || '', lat: x.latitude, lon: x.longitude, elevation: x.elevation, timezone: x.timezone }));
}
