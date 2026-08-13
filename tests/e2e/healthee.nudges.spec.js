// In-app nudges: dismissible reminders shown on open (sleep, water, log meals,
// supplements). Rules live in the NUDGES array; evalNudges() is the pure decision
// and renderNudgeBar() paints #nudgeBar. Times are mocked via getISTHourFloat.

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/HealThee/health.html';
const MON = '2026-08-03';

async function boot(page) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.evalNudges === 'function', { timeout: 8000 });
  await page.evaluate(() => {
    document.querySelectorAll('.screen, #loginScreen, #authScreen').forEach(d => { d.style.display = 'none'; });
    const app = document.getElementById('mainApp'); if (app) app.style.display = 'block';
    localStorage.removeItem('HT_nudge_dismiss');
    window.__htSetState({ freshDay: true, profile: null, weekCache: null });
  });
}

test.describe('in-app nudges', () => {
  test('rules fire on the right conditions', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      window.__htSetState({ date: todayStr(), tab: 'fuel', freshDay: true, profile: null });
      const orig = window.getISTHourFloat;
      const at = (h) => { window.getISTHourFloat = () => h; return evalNudges().map(n => n.id); };
      const out = { night: at(23.5), afternoonEmpty: at(15), morning: at(9) };
      window.getISTHourFloat = orig;
      return out;
    });
    expect(r.night, 'late-night → sleep').toContain('sleep');
    expect(r.afternoonEmpty, 'dry afternoon → water').toContain('water');
    expect(r.afternoonEmpty, 'empty afternoon → log meals').toContain('logmeals');
    expect(r.afternoonEmpty, 'due-but-unticked supplements').toContain('supps');
    expect(r.morning, 'no meal nag in the morning').not.toContain('logmeals');
    expect(r.morning, 'no sleep nudge in the morning').not.toContain('sleep');
  });

  test('a nudge renders in the bar and dismiss keeps it gone for the day', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => {
      window.getISTHourFloat = () => 23.5;
      window.__htSetState({ date: todayStr(), tab: 'fuel', freshDay: true, profile: null });
      return {
        count: document.querySelectorAll('#nudgeBar .nudge').length,
        hasSleep: [...document.querySelectorAll('#nudgeBar .nudge-close')].some(b => (b.getAttribute('onclick') || '').includes("'sleep'")),
      };
    });
    expect(before.count).toBeGreaterThan(0);
    expect(before.hasSleep).toBe(true);

    await page.evaluate(() => dismissNudge('sleep'));
    const after = await page.evaluate(() => {
      render(); // re-render; dismissal must survive
      return {
        domHasSleep: [...document.querySelectorAll('#nudgeBar .nudge-close')].some(b => (b.getAttribute('onclick') || '').includes("'sleep'")),
        evalIds: evalNudges().map(n => n.id),
      };
    });
    expect(after.domHasSleep, 'sleep nudge removed from the bar').toBe(false);
    expect(after.evalIds, 'sleep stays dismissed on re-eval').not.toContain('sleep');
  });

  test('no nudges on a non-today date', async ({ page }) => {
    await boot(page);
    const ids = await page.evaluate((mon) => {
      window.getISTHourFloat = () => 23.5;
      window.__htSetState({ date: mon, tab: 'fuel', freshDay: true, profile: null });
      return evalNudges().map(n => n.id);
    }, MON);
    expect(ids).toEqual([]);
  });
});
