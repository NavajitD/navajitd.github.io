import { test } from 'node:test';
import assert from 'node:assert/strict';

// index.js touches `window` for `window.HTGam`. Stub before import.
globalThis.window = { toast: () => {} };
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, addEventListener: () => {} }), head: { appendChild: () => {} }, body: { appendChild: () => {} } };

const mod = await import('../../Projects/HealThee/gamification/index.js');
const HTGam = mod.default;
const { applyDaySave, deriveDayActivity, computeDaySignature, diffSignatures } = mod;
const { DEFAULT_STATE } = await import('../../Projects/HealThee/gamification/store.js');

function freshState() { return JSON.parse(JSON.stringify(DEFAULT_STATE)); }

// ── deriveDayActivity ───────────────────────────────────────────────────────
test('deriveDayActivity flags eat when foods present', () => {
  const a = deriveDayActivity({ foods: [{ name: 'x' }] });
  assert.equal(a.eat, true);
  assert.equal(a.move, false);
});

test('deriveDayActivity ignores deletedAt items', () => {
  const a = deriveDayActivity({ foods: [{ name: 'x', deletedAt: 123 }] });
  assert.equal(a.eat, false);
});

test('deriveDayActivity flags move on step or custom exercise', () => {
  assert.equal(deriveDayActivity({ stepLogs: [{ steps: 1000 }] }).move, true);
  assert.equal(deriveDayActivity({ customExercises: [{ name: 'push' }] }).move, true);
});

test('deriveDayActivity reads LWW maps for supplement/exercise checks', () => {
  const day = {
    exerciseChecks: { a: { v: true, ts: 1 }, b: { v: false, ts: 2 } },
    supplementChecks: { x: { v: true, ts: 1 } },
  };
  const a = deriveDayActivity(day);
  assert.equal(a.move, true);
  assert.equal(a.eat, true);
});

test('deriveDayActivity flags sleep when any sleep field set', () => {
  assert.equal(deriveDayActivity({ sleep: { hours: 8 } }).sleep, true);
  assert.equal(deriveDayActivity({ sleep: { bedtime: '23:00' } }).sleep, true);
  assert.equal(deriveDayActivity({ sleep: {} }).sleep, false);
});

test('deriveDayActivity flags care on journal/skincare/haircare', () => {
  assert.equal(deriveDayActivity({ chatHistory: [{ role: 'user', text: 'hi' }] }).care, true);
  assert.equal(deriveDayActivity({ skincareChecks: { a: { v: true, ts: 1 } } }).care, true);
});

// ── signatures + xp diff ────────────────────────────────────────────────────
test('computeDaySignature counts meals and flags allThreeMeals', () => {
  const sig = computeDaySignature({ foods: [{}, {}, {}] });
  assert.equal(sig.meals, 3);
  assert.equal(sig.allThreeMeals, true);
});

test('diffSignatures awards XP only for new actions', () => {
  const sigA = { meals: 1 };
  const sigB = { meals: 3, allThreeMeals: true };
  const { xp } = diffSignatures(sigA, sigB);
  // +2 meals × 5 + first allThreeMeals × 10 = 20
  assert.equal(xp, 20);
});

test('diffSignatures returns 0 when nothing changed', () => {
  const sig = { meals: 2, sleepLogged: true };
  assert.equal(diffSignatures(sig, sig).xp, 0);
});

// ── applyDaySave end-to-end ─────────────────────────────────────────────────
test('applyDaySave awards meal XP and First Step badge', () => {
  const day = { foods: [{ name: 'breakfast' }], sleep: { hours: 8 }, stepLogs: [{ steps: 5000 }], chatHistory: [{ role: 'user', text: 'hi' }] };
  const { state, events } = applyDaySave(freshState(), day, '2026-05-20', {});
  assert.ok(state.xp > 0);
  assert.ok(state.badges.includes('first_step'));
  assert.equal(state.streak.current, 1);
  assert.ok(events.some(e => e.type === 'xp'));
  assert.ok(events.some(e => e.type === 'badge' && e.id === 'first_step'));
  assert.ok(events.some(e => e.type === 'streakUp'));
});

test('applyDaySave is idempotent on same dayData (signature cache prevents double XP)', () => {
  const day = { foods: [{ name: 'x' }, { name: 'y' }] };
  const cache = {};
  const r1 = applyDaySave(freshState(), day, '2026-05-20', cache);
  const r2 = applyDaySave(r1.state, day, '2026-05-20', cache);
  assert.equal(r1.state.xp, 10); // 2 meals × 5
  assert.equal(r2.state.xp, 10); // no double-credit
});

test('applyDaySave adds incremental XP on new meal added', () => {
  const dayA = { foods: [{ name: 'x' }] };
  const dayB = { foods: [{ name: 'x' }, { name: 'y' }] };
  const cache = {};
  const r1 = applyDaySave(freshState(), dayA, '2026-05-20', cache);
  const r2 = applyDaySave(r1.state, dayB, '2026-05-20', cache);
  assert.equal(r1.state.xp, 5);
  assert.equal(r2.state.xp, 10);
});

test('applyDaySave streak only increments once per qualified day', () => {
  const day = {
    foods: [{ name: 'x' }],
    stepLogs: [{ steps: 100 }],
    sleep: { hours: 8 },
    chatHistory: [{ role: 'user', text: 'note' }],
  };
  const cache = {};
  const r1 = applyDaySave(freshState(), day, '2026-05-20', cache);
  const r2 = applyDaySave(r1.state, day, '2026-05-20', cache); // resave same
  assert.equal(r1.state.streak.current, 1);
  assert.equal(r2.state.streak.current, 1);
});

test('applyDaySave fires level-up when crossing threshold', () => {
  let state = freshState();
  state.xp = 145;
  const day = { foods: [{ name: 'x' }] };
  const { events } = applyDaySave(state, day, '2026-05-20', {});
  // 145 + 5 = 150 → Sprout
  const lvlEvt = events.find(e => e.type === 'levelUp');
  assert.ok(lvlEvt);
  assert.equal(lvlEvt.toLevel.title, 'Sprout');
});

test('applyDaySave does not award XP / streak when gamification disabled — handled by HTGam.onDaySaved', async () => {
  HTGam._reset();
  HTGam._enabled = false;
  HTGam._ready = true;
  const before = HTGam.getState().xp;
  await HTGam.onDaySaved({ foods: [{ name: 'x' }] }, '2026-05-20');
  assert.equal(HTGam.getState().xp, before);
});

test('HTGam.onDaySaved awards XP when enabled', async () => {
  HTGam._reset();
  HTGam._enabled = true;
  HTGam._ready = true;
  await HTGam.onDaySaved({ foods: [{ name: 'x' }] }, '2026-05-20');
  assert.equal(HTGam.getState().xp, 5);
});

test('HTGam.onDaySaved persists via configured adapter', async () => {
  const { makeMemoryAdapter, makeCompositeAdapter } = await import('../../Projects/HealThee/gamification/store.js');
  const adapter = makeCompositeAdapter(null, makeMemoryAdapter());
  HTGam._reset();
  HTGam._enabled = true;
  HTGam._ready = true;
  HTGam._adapter = adapter;
  HTGam._uid = 'test_uid';
  await HTGam.onDaySaved({ foods: [{ name: 'a' }, { name: 'b' }] }, '2026-05-20');
  // Allow microtask queue (persist runs through promise chain)
  await new Promise(r => setTimeout(r, 5));
  const loaded = await adapter.get('test_uid');
  assert.equal(loaded.xp, 10);
});

test('HTGam.completeDailyChallenge awards 25 XP and Bonus Burst after 3', async () => {
  HTGam._reset();
  HTGam._enabled = true;
  HTGam._ready = true;
  await HTGam.completeDailyChallenge('n1', '2026-05-20');
  await HTGam.completeDailyChallenge('m1', '2026-05-20');
  await HTGam.completeDailyChallenge('s1', '2026-05-20');
  // 25 × 3 + 50 bonus burst = 125
  assert.equal(HTGam.getState().xp, 125);
  assert.equal(HTGam.getState().gems, 1);
});

test('HTGam.todaysDailyChallenges returns 3 deterministic picks', () => {
  const picks = HTGam.todaysDailyChallenges('2026-05-20');
  assert.equal(picks.length, 3);
});
