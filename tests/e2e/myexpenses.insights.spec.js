// Functional test for the MyExpenses proactive Insights feature.
// Runs at the login screen (no Google auth required) — verifies the new
// Insights card scaffold, its hidden-by-default guard, the generateAutoInsight
// wiring, and the refreshed Expense Advisor quick-prompts.
//
// The expense app is gated behind Firebase auth + a live LLM, so the full
// auto-insight round-trip can't run headless. These checks cover everything
// that is observable pre-auth: the markup, the guard logic, and the function
// being defined without throwing.

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/MyExpenses/expenses.html';

// Firebase/Firestore/auth noise is expected on a static file server with no
// real credentials — none of it comes from the insights change.
const NOISE = /firebase|firestore|auth|network|sign-in|popup|redirect|persistence|quota|offline|installations|400|403|net::/i;

test.describe('MyExpenses — proactive Insights', () => {
  test('page loads with auth scaffold and no insights-related errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });

    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500); // let Firebase SDK + inline script wire up

    const authNodes = await page.locator('#authLoading, #loginScreen').count();
    expect(authNodes).toBeGreaterThan(0);

    // Nothing from the insights feature should error.
    const insightErrors = errors.filter(e => /insight|autoInsight|advisor/i.test(e));
    expect(insightErrors, `Insights errors:\n${insightErrors.join('\n')}`).toEqual([]);

    // And no unexpected fatal errors beyond known Firebase/auth noise.
    const fatal = errors.filter(e => !NOISE.test(e));
    expect(fatal, `Unexpected console errors:\n${fatal.join('\n')}`).toEqual([]);
  });

  test('Insights card scaffold exists and is hidden by default', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const card = page.locator('#autoInsightCard');
    await expect(card).toHaveCount(1);
    await expect(card).toBeHidden(); // inside hidden Analytics section + display:none
    await expect(page.locator('#autoInsightBody')).toHaveCount(1);
    await expect(page.locator('#insightRefresh')).toHaveCount(1);
  });

  test('generateAutoInsight is wired and the no-data guard keeps the card hidden', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    const fnType = await page.evaluate(() => typeof window.generateAutoInsight);
    expect(fnType).toBe('function');

    // With zero expenses (login state) the guard must hide the card and not throw.
    const result = await page.evaluate(() => {
      try {
        window.generateAutoInsight();
        return { ok: true, display: document.getElementById('autoInsightCard').style.display };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    });
    expect(result.ok, result.error).toBe(true);
    expect(result.display).toBe('none');
  });

  test('Advisor quick-prompts show the refreshed labels', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const joined = (await page.locator('.chat-quick-btn').allInnerTexts()).join(' | ');
    expect(joined).toContain('What stands out?');
    expect(joined).toContain('Biggest savings');
    expect(joined).toContain('This month vs last');
    expect(joined).toContain('Unusual spends?');
  });
});
