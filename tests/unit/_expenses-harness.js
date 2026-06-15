// Test harness for Projects/MyExpenses/expenses.html.
//
// MyExpenses ships as one monolithic HTML file with all logic in a single
// classic <script>. There is no ES module to import (unlike HealThee), so to
// unit-test the REAL shipped code we:
//   1. read expenses.html and extract the inline script body,
//   2. append a tiny test-seam epilogue that — being in the same script scope —
//      can read/write the top-level `let` state (allExpenses, userProfile, …)
//      that closures capture but that is otherwise unreachable from outside,
//   3. run it in a node:vm context with stubbed browser globals.
//
// The functions under test are the genuine ones from the file (no copies), so
// these tests fail if the shipped logic changes — which is the point.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HTML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'Projects', 'MyExpenses', 'expenses.html'
);

// Values created by literals inside the vm belong to the sandbox realm, so
// their prototypes differ from the host's and node:assert/strict deepEqual
// rejects them. Round-trip through JSON to re-home plain data in this realm.
export const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

function extractInlineScript(html) {
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, best = '';
  while ((m = re.exec(html))) if (m[1].length > best.length) best = m[1];
  return best;
}

// Appended to the extracted script. Same lexical scope ⇒ these closures can
// reach the module-level bindings. Wrapped in try/catch so a failure here never
// masks the rest of the load.
const EPILOGUE = `
;try { window.__test = {
  setExpenses(a){ allExpenses = Array.isArray(a) ? a : []; },
  getExpenses(){ return allExpenses; },
  setUserProfile(p){ userProfile = p; },
  setCurrentUser(u){ currentUser = u; },
  setVoiceLangIdx(i){ currentVoiceLangIdx = i; },
  getVoiceLangIdx(){ return currentVoiceLangIdx; },
  rebuildKeywords(){ rebuildEffectiveKeywords(); },
  getEffectiveKeywords(){ return effectiveCategoryKeywords; },
  rebuildRag(){ buildRagIndex(); },
  getRagIndex(){ return _ragIndex; },
  getCategoryPaymentStats(){ return _categoryPaymentStats; },
  setAutoInsightInFlight(v){ autoInsightInFlight = v; },
  setProfileThemes(t){ window._profileThemes = t; }
}; } catch (e) { window.__testError = String(e && e.stack || e); }
`;

function makeEl(id) {
  const el = {
    id, style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    checked: false, disabled: false, className: '', options: [], children: [],
    onclick: null, parentElement: null,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this.dataset[k] = v; }, removeAttribute(k) { delete this.dataset[k]; },
    getAttribute() { return null; },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, click() {}, getContext() { return {}; },
    remove() {},
  };
  el.parentElement = el;
  return el;
}

/**
 * Build a fresh, isolated sandbox with the real expenses.html script loaded.
 * Returns { ctx, t, localStorage, getById, loadError } where:
 *   - ctx     : the vm global; every top-level function is a property here
 *   - t       : the __test seam for reading/writing module state
 *   - getById : grab a stub DOM element by id (same instance the code sees)
 */
export function createApp() {
  const html = readFileSync(HTML_PATH, 'utf8');
  const scriptBody = extractInlineScript(html) + EPILOGUE;

  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: i => [...store.keys()][i] ?? null,
  };

  const elements = new Map();
  const getById = id => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };

  const document = {
    getElementById: getById,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeEl('_created'),
    addEventListener: () => {},
    body: makeEl('body'),
    head: makeEl('head'),
    documentElement: makeEl('html'),
  };

  const authStub = {
    onAuthStateChanged: () => {},
    signInWithRedirect: () => Promise.resolve(),
    signInWithPopup: () => Promise.resolve({ user: null }),
    getRedirectResult: () => Promise.resolve({ user: null }),
    signOut: () => Promise.resolve(),
    currentUser: null,
  };
  const docRef = {
    set: () => Promise.resolve(), update: () => Promise.resolve(),
    get: () => Promise.resolve({ exists: false, data: () => ({}) }),
    delete: () => Promise.resolve(), onSnapshot: () => () => {},
  };
  const colRef = {
    doc: () => docRef, add: () => Promise.resolve(docRef),
    where() { return colRef; }, orderBy() { return colRef; },
    get: () => Promise.resolve({ docs: [], forEach() {} }), onSnapshot: () => () => {},
  };
  const dbStub = {
    enablePersistence: () => ({ catch: () => {} }),
    collection: () => colRef,
    waitForPendingWrites: () => Promise.resolve(),
  };
  function GoogleAuthProvider() {}
  GoogleAuthProvider.prototype.addScope = function () {};
  const firebase = {
    initializeApp: () => ({}),
    auth: Object.assign(() => authStub, { GoogleAuthProvider }),
    firestore: Object.assign(() => dbStub, {
      FieldValue: { serverTimestamp: () => ({}), delete: () => ({}), arrayUnion: (...a) => a, increment: n => n },
      Timestamp: { fromDate: d => ({ toDate: () => d }), now: () => ({ toDate: () => new Date() }) },
    }),
  };

  const sandbox = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    scrollTo() {}, alert() {}, confirm() { return true; }, prompt() { return null; },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    queueMicrotask: cb => Promise.resolve().then(cb),
    localStorage, document, firebase,
    navigator: { onLine: true, language: 'en-US', userAgent: 'node-test' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: '{}' }), text: () => Promise.resolve('') }),
    location: { href: 'http://localhost/Projects/MyExpenses/expenses.html', pathname: '/Projects/MyExpenses/expenses.html', search: '', hash: '', origin: 'http://localhost', reload() {}, replace() {}, assign() {} },
    history: { replaceState() {}, pushState() {} },
    URL, URLSearchParams, TextEncoder, TextDecoder,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    FileReader: class { readAsDataURL() {} },
    Image: class {},
    Chart: function () { return { destroy() {}, update() {} }; },
    JSON, Math, Date, parseInt, parseFloat, isNaN, isFinite,
    Object, Array, String, Number, Boolean, RegExp, Promise, Set, Map, WeakMap, WeakSet, Symbol, Error, TypeError, Intl,
    encodeURIComponent, decodeURIComponent,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  let loadError = null;
  try {
    vm.runInContext(scriptBody, sandbox, { filename: 'expenses-inline.js' });
  } catch (e) {
    loadError = e;
  }

  return { ctx: sandbox, t: sandbox.__test, localStorage, getById, loadError, testError: sandbox.__testError };
}
