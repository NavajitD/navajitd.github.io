// Sign-in method by environment. The home-screen app (display-mode:
// standalone) must use the popup flow: signInWithRedirect needs third-party
// storage on <project>.firebaseapp.com, which Safari 16.1+, Firefox 109+ and
// Chrome 115+ block, so a redirect sign-in returns to the login screen.
// (Firebase: /docs/auth/web/redirect-best-practices)

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/MyExpenses/expenses.html';

async function loginScreen(page, { standalone = false, iosStandalone = false, userAgent } = {}) {
  await page.route(/firestore\.googleapis\.com|identitytoolkit|securetoken/, r => r.abort());
  await page.addInitScript(({ standalone, iosStandalone }) => {
    if (standalone) {
      const real = window.matchMedia.bind(window);
      window.matchMedia = q => /display-mode:\s*standalone/.test(q)
        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
        : real(q);
    }
    if (iosStandalone) Object.defineProperty(navigator, 'standalone', { get: () => true });
  }, { standalone, iosStandalone });
  if (userAgent) await page.setExtraHTTPHeaders({ 'user-agent': userAgent });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginScreen')).toBeVisible({ timeout: 8000 });
}

// Replace both Firebase sign-in calls with recorders. `popupError` makes the
// popup reject with that Firebase error code.
async function recordSignIn(page, { popupError } = {}) {
  await page.evaluate(({ popupError }) => {
    window.__signIn = [];
    auth.signInWithPopup = () => {
      window.__signIn.push('popup');
      return popupError ? Promise.reject(Object.assign(new Error(popupError), { code: popupError })) : new Promise(() => {});
    };
    auth.signInWithRedirect = () => { window.__signIn.push('redirect'); return new Promise(() => {}); };
  }, { popupError });
}

const calls = page => page.evaluate(() => window.__signIn);

test.describe('MyExpenses — Google sign-in method', () => {
  test('browser tab: popup', async ({ page }) => {
    await loginScreen(page);
    await recordSignIn(page);
    await page.locator('#loginScreen .login-btn').click();
    expect(await calls(page)).toEqual(['popup']);
  });

  test('home-screen app (display-mode: standalone): popup, not redirect', async ({ page }) => {
    await loginScreen(page, { standalone: true });
    await recordSignIn(page);
    await page.locator('#loginScreen .login-btn').click();
    expect(await calls(page)).toEqual(['popup']);
  });

  test('iOS home-screen app (navigator.standalone): popup, not redirect', async ({ page }) => {
    await loginScreen(page, { iosStandalone: true });
    await recordSignIn(page);
    await page.locator('#loginScreen .login-btn').click();
    expect(await calls(page)).toEqual(['popup']);
  });

  test('popup blocked → falls back to redirect', async ({ page }) => {
    await loginScreen(page, { standalone: true });
    await recordSignIn(page, { popupError: 'auth/popup-blocked' });
    await page.locator('#loginScreen .login-btn').click();
    await expect.poll(() => calls(page)).toEqual(['popup', 'redirect']);
    await expect(page.locator('#authLoading')).toBeVisible();
  });

  test('popup closed by the user → back to the button, no redirect', async ({ page }) => {
    await loginScreen(page, { standalone: true });
    await recordSignIn(page, { popupError: 'auth/popup-closed-by-user' });
    await page.locator('#loginScreen .login-btn').click();
    await expect(page.locator('#loginScreen .login-btn')).toBeEnabled();
    expect(await calls(page)).toEqual(['popup']);
    await expect(page.locator('#loginScreen')).toBeVisible();
  });

  test('in-app browsers (Instagram, Facebook…) still go straight to redirect', async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0' });
    const page = await ctx.newPage();
    await loginScreen(page);
    await recordSignIn(page);
    await page.locator('#loginScreen .login-btn').click();
    expect(await calls(page)).toEqual(['redirect']);
    await ctx.close();
  });
});
