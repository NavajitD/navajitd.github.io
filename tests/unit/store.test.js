import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATE, cloneState, migrateState,
  makeMemoryAdapter, makeLocalStorageAdapter, makeCompositeAdapter,
} from '../../Projects/HealThee/gamification/store.js';

test('cloneState produces a deep copy', () => {
  const a = cloneState(DEFAULT_STATE);
  a.xp = 999;
  a.streak.current = 5;
  assert.equal(DEFAULT_STATE.xp, 0);
  assert.equal(DEFAULT_STATE.streak.current, 0);
});

test('migrateState handles null/undefined', () => {
  const m = migrateState(null);
  assert.equal(m.xp, 0);
  assert.equal(m.streak.current, 0);
});

test('migrateState preserves saved fields', () => {
  const saved = { xp: 250, badges: ['first_step'], streak: { current: 3 } };
  const m = migrateState(saved);
  assert.equal(m.xp, 250);
  assert.deepEqual(m.badges, ['first_step']);
  assert.equal(m.streak.current, 3);
  // Defaults preserved for missing fields
  assert.equal(m.streak.longest, 0);
  assert.equal(m.gems, 0);
});

test('migrateState ignores malformed badges array', () => {
  const m = migrateState({ badges: 'oops' });
  assert.deepEqual(m.badges, []);
});

test('memory adapter round-trips state', async () => {
  const a = makeMemoryAdapter();
  await a.set('uid1', { xp: 42, badges: ['first_step'] });
  const loaded = await a.get('uid1');
  assert.equal(loaded.xp, 42);
  assert.deepEqual(loaded.badges, ['first_step']);
  assert.equal(await a.get('uid_missing'), null);
});

test('localStorage adapter works with in-memory polyfill', async () => {
  const store = new Map();
  const storage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  };
  const a = makeLocalStorageAdapter(storage);
  await a.set('uid1', { xp: 10 });
  assert.equal((await a.get('uid1')).xp, 10);
});

test('localStorage adapter survives JSON parse errors', async () => {
  const store = new Map([['HT_gam_v1_bad', '{not json']]);
  const storage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: () => {},
  };
  const a = makeLocalStorageAdapter(storage);
  assert.equal(await a.get('bad'), null);
});

test('composite adapter prefers Firestore, falls back to local', async () => {
  const remote = makeMemoryAdapter();
  const local = makeMemoryAdapter();
  await local.set('uid1', { xp: 5 });
  // Remote has nothing — should fall back to local
  let composite = makeCompositeAdapter(remote, local);
  assert.equal((await composite.get('uid1')).xp, 5);

  // Remote takes precedence when both present
  await remote.set('uid1', { xp: 100 });
  composite = makeCompositeAdapter(remote, local);
  assert.equal((await composite.get('uid1')).xp, 100);
});

test('composite adapter writes to local synchronously and remote async', async () => {
  const remote = makeMemoryAdapter();
  const local = makeMemoryAdapter();
  const composite = makeCompositeAdapter(remote, local);
  await composite.set('uid1', { xp: 7 });
  assert.equal((await local.get('uid1')).xp, 7);
  // Give remote a tick to settle
  await new Promise(r => setTimeout(r, 0));
  assert.equal((await remote.get('uid1')).xp, 7);
});

test('composite adapter handles missing Firestore adapter', async () => {
  const local = makeMemoryAdapter();
  const composite = makeCompositeAdapter(null, local);
  await composite.set('uid1', { xp: 3 });
  assert.equal((await composite.get('uid1')).xp, 3);
});
