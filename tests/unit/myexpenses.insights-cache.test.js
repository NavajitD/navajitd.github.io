// Insight cache + pinned-suggestion persistence (localStorage-backed).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, plain } from './_expenses-harness.js';

let app;
beforeEach(() => { app = createApp(); });

// ── getAutoInsightCache ─────────────────────────────────────────────────────
test('getAutoInsightCache returns null when nothing is stored', () => {
  assert.equal(app.ctx.getAutoInsightCache(), null);
});

test('getAutoInsightCache round-trips a stored object', () => {
  const entry = { key: 'all-all|3|600|English', text: 'hi', suggestions: ['a'], ts: 123 };
  app.localStorage.setItem('autoInsightCache', JSON.stringify(entry));
  assert.deepEqual(app.ctx.getAutoInsightCache(), entry);
});

test('getAutoInsightCache survives corrupt JSON', () => {
  app.localStorage.setItem('autoInsightCache', '{not valid json');
  assert.equal(app.ctx.getAutoInsightCache(), null);
});

// ── isSameCalendarDay ───────────────────────────────────────────────────────
test('isSameCalendarDay is true only for today', () => {
  const { isSameCalendarDay } = app.ctx;
  assert.equal(isSameCalendarDay(Date.now()), true);
  assert.equal(isSameCalendarDay(Date.now() - 2 * 86400000), false); // 2 days ago
  assert.equal(isSameCalendarDay(null), false);
  assert.equal(isSameCalendarDay(0), false); // falsy timestamp guard
});

// ── pinned suggestions ──────────────────────────────────────────────────────
test('getPinnedSuggestions starts empty', () => {
  assert.deepEqual(app.ctx.getPinnedSuggestions(), []);
});

test('pinSuggestion stores newest-first and de-duplicates', () => {
  app.ctx.pinSuggestion('Keep Eating out under ₹4,000');
  app.ctx.pinSuggestion('Cut Liquor by ₹1,000');
  assert.deepEqual(app.ctx.getPinnedSuggestions(), [
    'Cut Liquor by ₹1,000',
    'Keep Eating out under ₹4,000',
  ]);
  // duplicate is ignored
  app.ctx.pinSuggestion('Cut Liquor by ₹1,000');
  assert.equal(app.ctx.getPinnedSuggestions().length, 2);
});

test('removeSuggestion deletes by index', () => {
  app.ctx.pinSuggestion('A');
  app.ctx.pinSuggestion('B'); // ['B','A']
  app.ctx.removeSuggestion(0);
  assert.deepEqual(app.ctx.getPinnedSuggestions(), ['A']);
});

test('getPinnedSuggestions survives corrupt storage', () => {
  app.localStorage.setItem('pinnedSuggestions', 'oops not json');
  assert.deepEqual(plain(app.ctx.getPinnedSuggestions()), []);
});
