// End-to-end: ArchiHelp's three tabs — Projects, Floor plan (now multi-floor), Wind circulation — plus tracing a drawing.
// Open-Meteo is mocked with deterministic synthetic weather, so the tests need no network.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PAGE = '/Projects/ArchiHelp/planner.html';
const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PNG = join(HERE, '..', 'fixtures', 'archihelp', 'trace-sample.png');

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|analytics|favicon/i.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && new URL(r.url()).host === '127.0.0.1:8765') errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return errors;
}

/** Synthetic hourly weather for an Open-Meteo request (IST, warm-humid, sea breeze from the south-west). */
function fakeHourly(url) {
  const u = new URL(url), start = u.searchParams.get('start_date'), end = u.searchParams.get('end_date'), off = 19800;
  const t0 = Date.parse(`${start}T00:00:00Z`) / 1000 - off, n = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 3.6e6) + 24;
  const H = { time: [], temperature_2m: [], relative_humidity_2m: [], dew_point_2m: [], wind_speed_10m: [], wind_direction_10m: [], shortwave_radiation: [], direct_normal_irradiance: [], diffuse_radiation: [], cloud_cover: [], precipitation: [] };
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 3600, d = new Date((t + off) * 1000), hr = d.getUTCHours(), doy = Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5);
    const season = Math.sin(2 * Math.PI * (doy - 105) / 365), day = Math.sin(2 * Math.PI * (hr - 9) / 24), sun = Math.max(0, Math.sin(Math.PI * (hr - 6) / 12));
    const T = 25 + 5 * season + 5 * day;
    H.time.push(t); H.temperature_2m.push(+T.toFixed(1)); H.relative_humidity_2m.push(+(70 - 15 * day).toFixed(0)); H.dew_point_2m.push(+(T - 8 + 3 * day).toFixed(1));
    H.wind_speed_10m.push(+(2.5 + 1.5 * day).toFixed(1)); H.wind_direction_10m.push(225 + Math.round(30 * Math.sin(2 * Math.PI * hr / 24)));
    H.shortwave_radiation.push(Math.round(850 * sun)); H.direct_normal_irradiance.push(Math.round(650 * sun)); H.diffuse_radiation.push(Math.round(160 * sun));
    H.cloud_cover.push(40); H.precipitation.push(0);
  }
  return { latitude: Number(u.searchParams.get('latitude')), longitude: Number(u.searchParams.get('longitude')), utc_offset_seconds: off, timezone: 'Asia/Kolkata', elevation: 20, hourly: H };
}
async function mockWeather(page) {
  const calls = [];
  for (const host of ['https://archive-api.open-meteo.com/**', 'https://api.open-meteo.com/**']) {
    await page.route(host, (route) => { calls.push(route.request().url()); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeHourly(route.request().url())) }); });
  }
  await page.route('https://geocoding-api.open-meteo.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: 'Pune', admin1: 'Maharashtra', country: 'India', latitude: 18.5196, longitude: 73.8554, elevation: 560, timezone: 'Asia/Kolkata' }] }) }));
  return calls;
}

async function openExample(page) {
  await page.goto(`${PAGE}#/`);
  await page.getByRole('button', { name: /Open the example/ }).click();
  await expect(page.locator('.ed-status')).toContainText('Vaastu 62.4');
}
const box = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });

test.describe('ArchiHelp: tabs, floors, wind circulation, tracing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { indexedDB.deleteDatabase('archihelp'); indexedDB.deleteDatabase('archihelp-cache'); localStorage.clear(); } catch { /* ignore */ } });
  });

  test('three tabs: Projects, Floor plan, Wind circulation', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`${PAGE}#/`);
    const tabs = page.locator('#tabs a');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveAttribute('aria-label', 'Projects');
    await expect(page.locator('#tabs a.on')).toHaveAttribute('data-tab', 'projects');
    await openExample(page);
    await expect(page.locator('#tabs a.on')).toHaveAttribute('data-tab', 'plan');
    await expect(page.locator('#subbar')).toBeVisible();
    await expect(page.locator('#subbar .sb-name')).toContainText('Example house');
    await expect(page.locator('.ftab.on')).toHaveText('First floor');
    await page.locator('#tabs a[data-tab=wind]').click();
    await expect(page.locator('.wind-head h1')).toHaveText('Wind circulation');
    await expect(page.locator('#tabs a.on')).toHaveAttribute('data-tab', 'wind');
    await expect(page.locator('.wcard h3')).toHaveText(['Site', 'Floors and heights', 'Construction', 'How the house is used', 'Ceiling fans', 'Days to simulate']);
    await page.locator('#tabs a[data-tab=projects]').click();
    await expect(page.locator('.pcard h3')).toContainText(['Example house']);
    expect(errors).toEqual([]);
  });

  test('options header: one row, sort is a menu, the controls line up', async ({ page }) => {
    test.setTimeout(120000);
    const errors = trackErrors(page);
    await openExample(page);
    const id = await page.evaluate(() => window.__ah.project.id);
    await page.goto(`${PAGE}#/p/${id}/options`);
    await page.getByRole('radio', { name: 'Quick' }).click();
    await page.locator('.cat-head .btn.primary').click();
    await expect(page.locator('.ccard[data-option]').first()).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.cat-head .spin')).toHaveCount(0, { timeout: 90000 });
    // segmented control, Relaxed and "Generate again" share one top and bottom edge
    const seg = await box(page.locator('.cat-run .seg')), on = await box(page.locator('.cat-run .seg button.on')), rx = await box(page.locator('.cat-run .check.chip')), cta = await box(page.locator('.cat-run .btn.primary'));
    for (const b of [on, rx, cta]) { expect(Math.abs(b.top - seg.top)).toBeLessThanOrEqual(1); expect(Math.abs(b.bottom - seg.bottom)).toBeLessThanOrEqual(1); }
    // the sort menu
    await page.locator('.cat-bar .btn.dd').click();
    const opts = page.locator('.dd-menu [role=option]');
    await expect(opts).toHaveCount(4);
    await expect(opts.nth(0)).toHaveAttribute('aria-selected', 'true');
    await opts.nth(1).click();
    await expect(page.locator('.cat-bar .btn.dd .dd-val')).toHaveText('Vaastu score');
    const scores = await page.locator('.ccard[data-option] .hd .score').evaluateAll((els) => els.map((e) => parseFloat(e.textContent)).filter(Number.isFinite));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] + 1e-9);
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test('a second floor keeps the staircase in line; floor tabs switch plans', async ({ page }) => {
    test.setTimeout(180000);
    const errors = trackErrors(page);
    await openExample(page);
    await page.getByRole('button', { name: '+ Floor' }).click();
    await page.locator('.modal select').selectOption('0');
    await page.getByRole('button', { name: 'Add floor' }).click();
    await expect(page.locator('.wz-main h2')).toHaveText('Rooms');
    await expect(page.locator('.wz-main .note')).toContainText('staircase stays where it is on the first floor');
    await page.locator('.wz-steps li button').nth(5).click();
    await page.getByRole('radio', { name: 'Quick' }).click();
    await page.getByRole('button', { name: /Generate options/ }).click();
    await expect(page.locator('.ccard[data-option]').first()).toBeVisible({ timeout: 150000 });
    await expect(page.locator('.cat-head')).toContainText('stair kept from the first floor');
    const kept = await page.evaluate(() => {
      const p = window.__ah.project, fx = window.__ah.fixedStair.tile, same = (a, b) => ['x0', 'y0', 'x1', 'y1'].every((k) => Math.abs(a[k] - b[k]) < 1e-3);
      return p.candidates.every((c) => same(c.doc.rooms.find((r) => r.rtype === 'stair').tile, fx));
    });
    expect(kept).toBe(true);
    await page.locator('.ccard[data-option="1"]').getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('.ed-status')).toContainText('Hard rules pass');
    await expect(page.locator('.ftab')).toContainText(['Ground floor', 'First floor']);
    await page.locator('.ftab', { hasText: 'First floor' }).click();
    await expect(page.locator('.ed-status')).toContainText('Vaastu 62.4');
    await page.locator('.ftab', { hasText: 'Ground floor' }).click();
    await expect(page.locator('.ed-status')).toContainText('Hard rules pass');
    expect(await page.evaluate(() => window.__ah.project.cfg.floor_level)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('wind: fans set up per room, a run over the seasons, plan and section views', async ({ page }) => {
    test.setTimeout(180000);
    const errors = trackErrors(page);
    const calls = await mockWeather(page);
    await openExample(page);
    await page.locator('#tabs a[data-tab=wind]').click();
    await expect(page.locator('.wind-head')).toContainText('Agartala');
    await expect(page.locator('.wcard').nth(1)).toContainText('+3.51 m');               // the first floor sits 3.51 m up
    // three fans in the hall, then drag one
    const hall = page.locator('.wtable.fans tr[data-room="Hall"]');
    await hall.getByRole('radio', { name: '3' }).click();
    await expect(page.locator('.fp-fan[aria-label^="Fan in Hall"]')).toHaveCount(3);
    const fid = await page.evaluate(() => window.__ah.project.floors[window.__ah.project.activeFloor].id);
    const before = await page.evaluate((f) => { const c = window.__ah.project.wind.fans[f]; const k = Object.keys(c).find((u) => c[u].n === 3); return { k, n: c[k].n }; }, fid);
    expect(before.n).toBe(3);
    // the hall fans are the three whose label says Hall
    await page.locator('.fanplan').scrollIntoViewIfNeeded();
    const hallFan = await page.locator('.fp-fan[aria-label^="Fan in Hall"]').first().locator('.fp-hub').evaluate((e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.move(hallFan[0], hallFan[1]); await page.mouse.down(); await page.mouse.move(hallFan[0] + 25, hallFan[1] + 12, { steps: 6 }); await page.mouse.up();
    await expect.poll(() => page.evaluate(({ f, k }) => (window.__ah.project.wind.fans[f][k].pos || []).length, { f: fid, k: before.k })).toBe(3);
    // a past date as well as the four seasons
    await page.locator('.wcard').nth(5).locator('input[type=date]').fill('2025-04-20');
    await page.getByRole('button', { name: 'Add date' }).click();
    await page.locator('#windRun').click();
    await expect(page.locator('.wres')).toBeVisible({ timeout: 60000 });
    expect(calls.some((u) => u.includes('archive-api') && u.includes('start_date='))).toBe(true);
    await expect(page.locator('.dtab b')).toHaveText(['Winter', 'Summer', 'Monsoon', 'Post-monsoon', /2025/]);
    await expect(page.locator('.wind-info')).toContainText('typical winter day');
    // charts + table
    await expect(page.locator('.wcharts svg.chart')).toHaveCount(2);
    await expect(page.locator('.wres .wtable tbody tr')).toHaveCount(14);
    // section view of the whole house, then another day
    await page.getByRole('radio', { name: 'Section' }).click();
    await expect(page.locator('.wsection canvas')).toBeVisible();
    await page.locator('.dtab', { hasText: 'Summer' }).click();
    await expect(page.locator('.dtab.on b')).toHaveText('Summer');
    await expect(page.locator('.wsection canvas')).toBeVisible();
    // the date tab uses that day's recorded weather
    await page.locator('.dtab', { hasText: '2025' }).click();
    await expect(page.locator('.wind-info')).toContainText('Open-Meteo');
    // plan view: wind pictures arrive from the workers
    await page.getByRole('radio', { name: 'Plan' }).click();
    await expect.poll(() => page.evaluate(() => window.__ahWind.fields.size), { timeout: 60000 }).toBeGreaterThan(0);
    const stats = await page.evaluate(() => { const R = window.__ahWind.R; return { hours: R.hours.length, finite: R.Tair.every((a) => a.every(Number.isFinite)) }; });
    expect(stats).toEqual({ hours: 25, finite: true });
    expect(errors).toEqual([]);
  });

  test('trace a scanned plan: scale from one dimension, rooms, openings, then simulate', async ({ page }) => {
    test.setTimeout(180000);
    const errors = trackErrors(page);
    await mockWeather(page);
    await page.goto(`${PAGE}#/`);
    await page.getByRole('button', { name: /Start from a drawing/ }).click();
    await expect(page.locator('.tr-svg')).toBeVisible();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Load drawing' }).click()]);
    await chooser.setFiles(SAMPLE_PNG);
    await expect(page.locator('.tr-svg image')).toHaveCount(1);
    const px = (x, y) => page.evaluate(([a, b]) => { const s = document.querySelector('.tr-svg'), pt = s.createSVGPoint(); pt.x = a; pt.y = b; const q = pt.matrixTransform(s.getScreenCTM()); return [q.x, q.y]; }, [x, y]);
    const X = (ft) => 80 + 25 * ft, Y = (ft) => 80 + (24 - ft) * 25;            // the sample is drawn at 25 px per foot
    // scale: the 36'-0" dimension line under the plan
    for (const [x, y] of [[80, 725], [980, 725]]) { const [cx, cy] = await px(x, y); await page.mouse.click(cx, cy); }
    await page.locator('.modal input').fill(`36'-0"`);
    await page.getByRole('button', { name: 'Set scale' }).click();
    await expect.poll(() => page.evaluate(() => window.__ahTrace.tr.scale && window.__ahTrace.tr.scale.lengthFt)).toBe(36);
    // rooms
    for (const [type, x0, y0, x1, y1] of [['hall', 0, 0, 14, 24], ['kitchen', 14, 0, 36, 12], ['bedroom', 14, 12, 26, 24], ['bath', 26, 12, 36, 24]]) {
      const [ax, ay] = await px(X(x0), Y(y1)), [bx, by] = await px(X(x1), Y(y0));
      await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 6 }); await page.mouse.up();
      await page.locator('.modal select').selectOption(type);
      await page.getByRole('button', { name: 'Add room' }).click();
    }
    const tiles = await page.evaluate(() => window.__ahTrace.tr.doc.rooms.map((r) => [r.rtype, r.tile.x0, r.tile.y0, r.tile.x1, r.tile.y1]));
    expect(tiles).toEqual([['hall', 0, 0, 14, 24], ['kitchen', 14, 0, 36, 12], ['bedroom', 14, 12, 26, 24], ['bath', 26, 12, 36, 24]]);
    // openings
    const place = async (tool, x, y) => { await page.locator('.tr-tools').getByRole('radio', { name: tool, exact: true }).click(); const [cx, cy] = await px(X(x), Y(y)); await page.mouse.click(cx, cy); };
    for (const [x, y] of [[7, 0], [25, 0], [20, 24], [36, 18]]) await place('Window', x, y);
    for (const [x, y] of [[14, 6], [14, 18], [20, 12], [26, 18], [0, 12]]) await place('Door', x, y);
    const kinds = await page.evaluate(() => window.__ahTrace.tr.doc.openings.map((o) => o.kind).sort().join(','));
    expect(kinds).toBe('door,door,door,door,entrance,window,window,window,window');
    // on to the wind tab
    await page.locator('.tr-bar a.btn.primary').click();
    await expect(page.locator('.wcard').nth(1)).toContainText('traced drawing');
    await page.getByRole('searchbox', { name: 'Search a place' }).fill('Pune');
    await page.getByRole('button', { name: 'Find' }).click();
    await page.locator('.geo-opt').first().click();
    await expect(page.locator('.wind-head')).toContainText('Pune');
    await page.locator('#windRun').click();
    await expect(page.locator('.wres')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.wres .wtable tbody tr')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('phone width: wind setup and results fit without horizontal scrolling', async ({ page }) => {
    test.setTimeout(120000);
    await mockWeather(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openExample(page);
    await page.locator('#tabs a[data-tab=wind]').click();
    await expect(page.locator('.wcard').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('#windRun').click();
    await expect(page.locator('.wres')).toBeVisible({ timeout: 60000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});
