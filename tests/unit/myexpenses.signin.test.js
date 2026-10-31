// Google sign-in strategy. Popup everywhere a popup can open (browser tabs
// AND home-screen apps); redirect only for in-app browsers or when the popup
// is blocked. Redirect sign-in fails on Safari 16.1+, Firefox 109+ and
// Chrome 115+ because authDomain (firebaseapp.com) ≠ the app's domain.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './_expenses-harness.js';

const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0';
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

function app({ standalone = false, iosStandalone = false, ua = 'node-test' } = {}) {
  const a = createApp();
  a.ctx.matchMedia = q => ({ matches: standalone && /display-mode:\s*standalone/.test(q), addEventListener() {}, removeEventListener() {} });
  a.ctx.navigator.userAgent = ua;
  if (iosStandalone) a.ctx.navigator.standalone = true;
  const auth = a.ctx.firebase.auth();
  a.calls = [];
  a.popupResult = () => new Promise(() => {});
  auth.signInWithPopup = () => { a.calls.push('popup'); return a.popupResult(); };
  auth.signInWithRedirect = () => { a.calls.push('redirect'); return new Promise(() => {}); };
  return a;
}
const flush = () => new Promise(r => setImmediate(r));

describe('shouldUseRedirect', () => {
  test('home-screen apps do NOT use redirect (Android/desktop display-mode, iOS navigator.standalone)', () => {
    assert.equal(app({ standalone: true, ua: ANDROID_CHROME }).ctx.shouldUseRedirect(), false);
    assert.equal(app({ iosStandalone: true, ua: IOS_SAFARI }).ctx.shouldUseRedirect(), false);
  });

  test('ordinary browser tabs do not use redirect', () => {
    for (const ua of [IOS_SAFARI, ANDROID_CHROME, 'node-test']) assert.equal(app({ ua }).ctx.shouldUseRedirect(), false, ua);
  });

  test('in-app browsers still use redirect', () => {
    for (const ua of [IG_UA, 'Mozilla/5.0 ... [FBAN/FBIOS;FBAV/450.0]', 'Mozilla/5.0 ... MicroMessenger/8.0', 'Mozilla/5.0 ... Line/13.0', 'Mozilla/5.0 ... Twitter for iPhone'])
      assert.equal(app({ ua }).ctx.shouldUseRedirect(), true, ua);
    // …even when also standalone
    assert.equal(app({ ua: IG_UA, standalone: true }).ctx.shouldUseRedirect(), true);
  });
});

describe('signInWithGoogle', () => {
  test('home-screen app opens the popup directly from the tap', () => {
    for (const opts of [{ standalone: true, ua: ANDROID_CHROME }, { iosStandalone: true, ua: IOS_SAFARI }]) {
      const a = app(opts);
      a.ctx.signInWithGoogle();
      assert.deepEqual(a.calls, ['popup'], JSON.stringify(opts));
    }
  });

  test('popup blocked / unsupported / internal error → redirect fallback with the spinner', async () => {
    for (const code of ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/internal-error']) {
      const a = app({ standalone: true });
      a.popupResult = () => Promise.reject(Object.assign(new Error(code), { code }));
      a.ctx.signInWithGoogle();
      await flush();
      assert.deepEqual(a.calls, ['popup', 'redirect'], code);
      assert.equal(a.getById('authLoading').style.display, 'flex');
      assert.equal(a.getById('loginScreen').style.display, 'none');
    }
  });

  test('user closes the popup → button re-enabled, no redirect, no error toast', async () => {
    for (const code of ['auth/popup-closed-by-user', 'auth/popup-closed-by-browser', 'auth/cancelled-popup-request']) {
      const a = app({ standalone: true });
      const btn = a.getById('qs:.login-btn');
      a.ctx.document.querySelector = sel => (sel === '.login-btn' ? btn : null);
      a.popupResult = () => Promise.reject(Object.assign(new Error(code), { code }));
      a.ctx.signInWithGoogle();
      assert.equal(btn.disabled, true, 'disabled while the popup is open');
      await flush();
      assert.deepEqual(a.calls, ['popup'], code);
      assert.equal(btn.disabled, false, code);
      assert.doesNotMatch(a.getById('toast').textContent, /Sign-in failed/, code);
    }
  });

  test('network error → toast, no redirect', async () => {
    const a = app({ standalone: true });
    a.popupResult = () => Promise.reject(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }));
    a.ctx.signInWithGoogle();
    await flush();
    assert.deepEqual(a.calls, ['popup']);
    assert.match(a.getById('toast').textContent, /Network error/);
  });

  test('in-app browser goes straight to redirect', () => {
    const a = app({ ua: IG_UA });
    a.ctx.signInWithGoogle();
    assert.deepEqual(a.calls, ['redirect']);
  });
});

describe('auth fallback timer', () => {
  test('if auth never resolves, the 5 s fallback shows the login screen without throwing', () => {
    const a = createApp({ captureTimers: true });
    assert.equal(a.loadError, null);
    const fallback = a.timers.find(t => t.ms === 5000);
    assert.ok(fallback, 'fallback timer registered');
    assert.doesNotThrow(() => fallback.fn());
    assert.equal(a.getById('loginScreen').style.display, 'flex');
    assert.equal(a.getById('authLoading').style.display, 'none');
  });
});
