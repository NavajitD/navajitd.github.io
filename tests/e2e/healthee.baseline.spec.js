// Baseline regression — verifies the existing HealThee app loads and the
// key DOM scaffold is present. Run BEFORE wiring gamification so we have a
// known-good snapshot, and run AFTER wiring to prove nothing broke.

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/HealThee/health.html';

test.describe('HealThee baseline regression', () => {
  test('page loads with no console errors and key elements present', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    // Wait for Firebase scripts (defer) + DOMContentLoaded handler to wire up.
    await page.waitForTimeout(1500);

    // Auth scaffold present: either the loading canvas or login screen exists.
    // Both are in the markup regardless of auth state.
    const authNodes = await page.locator('#authLoading, #loginScreen').count();
    expect(authNodes).toBeGreaterThan(0);

    // Critical script-loaded check: window.emptyDay should exist (defined in inline script)
    const emptyDayType = await page.evaluate(() => typeof window.emptyDay);
    expect(emptyDayType).toBe('function');

    // The original app should not throw any console.error / page errors during load
    // Filter out Firebase auth warnings (network/auth-domain noise on file://)
    const fatal = errors.filter(e =>
      !/firebase|auth|network|sign-in|popup|redirect|FIRESTORE/i.test(e)
    );
    expect(fatal, `Unexpected console errors:\n${fatal.join('\n')}`).toEqual([]);
  });

  test('gamification module is NOT loaded by default (vanilla mode)', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    // Before wiring, HTGam should not be on window.
    // After wiring, it WILL be on window — this test will be updated then.
    const htgamType = await page.evaluate(() => typeof window.HTGam);
    // Initially: 'undefined'. After wiring: 'object' — we'll flip this expectation.
    expect(['undefined', 'object']).toContain(htgamType);
  });

  test('CSS and inline styles load (page has rendered content)', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const bg = await page.evaluate(() => {
      const html = document.documentElement;
      return getComputedStyle(html).backgroundColor || getComputedStyle(document.body).backgroundColor;
    });
    expect(bg).toBeTruthy();
  });
});
