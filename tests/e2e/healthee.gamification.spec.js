// Post-wiring e2e: HTGam loads on the page, exposes the public API,
// and applyDaySave end-to-end works with a mock dayData in the browser.

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/HealThee/health.html';

test('HTGam module loads and exposes public API', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  // Module is loaded via <script type="module"> — wait for it to settle.
  await page.waitForFunction(() => !!window.HTGam, { timeout: 5000 });
  const api = await page.evaluate(() => ({
    onDaySaved: typeof window.HTGam.onDaySaved,
    init: typeof window.HTGam.init,
    setEnabled: typeof window.HTGam.setEnabled,
    getState: typeof window.HTGam.getState,
    isEnabled: typeof window.HTGam.isEnabled,
    renderHud: typeof window.HTGam.renderHud,
    renderTrophyWall: typeof window.HTGam.renderTrophyWall,
    todaysDailyChallenges: typeof window.HTGam.todaysDailyChallenges,
  }));
  expect(api).toEqual({
    onDaySaved: 'function',
    init: 'function',
    setEnabled: 'function',
    getState: 'function',
    isEnabled: 'function',
    renderHud: 'function',
    renderTrophyWall: 'function',
    todaysDailyChallenges: 'function',
  });
});

test('HTGam stays disabled by default — no-op when called without init', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.HTGam, { timeout: 5000 });
  const enabled = await page.evaluate(() => window.HTGam.isEnabled());
  expect(enabled).toBe(false);

  // Calling onDaySaved while disabled returns null and doesn't throw.
  const result = await page.evaluate(async () => {
    return await window.HTGam.onDaySaved({ foods: [{ name: 'x' }] }, '2026-05-20');
  });
  expect(result).toBeNull();
});

test('HTGam end-to-end with localStorage adapter (no Firebase)', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.HTGam, { timeout: 5000 });

  // Drive HTGam directly with localStorage only (no Firebase needed).
  const summary = await page.evaluate(async () => {
    await window.HTGam.init({ uid: 'e2e_user', enabled: true });
    const before = window.HTGam.getState();
    // Simulate a fully-qualified day
    await window.HTGam.onDaySaved({
      foods: [{ name: 'breakfast' }, { name: 'lunch' }, { name: 'dinner' }],
      stepLogs: [{ steps: 5000 }],
      sleep: { hours: 8, bedtime: '23:00' },
      chatHistory: [{ role: 'user', text: 'a reflection' }],
    }, '2026-05-20');
    const after = window.HTGam.getState();
    return { beforeXp: before.xp, afterXp: after.xp, badges: after.badges, streak: after.streak.current };
  });

  expect(summary.afterXp).toBeGreaterThan(summary.beforeXp);
  expect(summary.badges).toContain('first_step');
  expect(summary.streak).toBe(1);
});

test('Trophy Wall renders into a target element', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.HTGam, { timeout: 5000 });
  const html = await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'test-wall';
    document.body.appendChild(el);
    window.HTGam.renderTrophyWall(el);
    return el.innerHTML;
  });
  expect(html).toContain('htgam-trophy-wall');
  expect(html).toContain('First Step');
});
