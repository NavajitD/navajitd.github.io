// Analytics helpers: active-day counting, filtering, insight signature,
// summary building and language selection.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './_expenses-harness.js';

let app;
beforeEach(() => { app = createApp(); });

const exp = (y, m, d, amount, category = 'Groceries') => ({
  id: `${y}-${m}-${d}-${amount}`,
  expenseName: `${category} buy`,
  category,
  amount,
  paymentMethod: 'Cash',
  date: new Date(y, m, d),
});

// ── countActiveDays (skips gaps of 3+ blank days) ───────────────────────────
test('countActiveDays returns 1 for empty or single-day data', () => {
  const { countActiveDays } = app.ctx;
  assert.equal(countActiveDays([]), 1);
  assert.equal(countActiveDays([exp(2026, 0, 1, 100)]), 1);
});

test('countActiveDays counts spans up to a 3-day gap, then skips larger gaps', () => {
  const { countActiveDays } = app.ctx;
  assert.equal(countActiveDays([exp(2026, 0, 1, 1), exp(2026, 0, 2, 1)]), 2); // diff 1
  assert.equal(countActiveDays([exp(2026, 0, 1, 1), exp(2026, 0, 4, 1)]), 4); // diff 3 (counted)
  assert.equal(countActiveDays([exp(2026, 0, 1, 1), exp(2026, 0, 6, 1)]), 2); // diff 5 (skipped)
});

test('countActiveDays collapses duplicate calendar days', () => {
  const a = exp(2026, 0, 1, 100);
  const b = exp(2026, 0, 1, 200);
  assert.equal(app.ctx.countActiveDays([a, b]), 1);
});

test('countActiveDays mixes counted and skipped gaps', () => {
  // Jan 1, Jan 3 (+2), Jan 11 (gap 8 → +1) = 4
  const data = [exp(2026, 0, 1, 1), exp(2026, 0, 3, 1), exp(2026, 0, 11, 1)];
  assert.equal(app.ctx.countActiveDays(data), 4);
});

// ── getFilteredData ─────────────────────────────────────────────────────────
test('getFilteredData filters by the month/year select values', () => {
  app.t.setExpenses([
    exp(2026, 0, 5, 100),  // Jan
    exp(2026, 0, 9, 200),  // Jan
    exp(2026, 1, 3, 300),  // Feb
  ]);
  app.getById('filterMonth').value = 'all';
  app.getById('filterYear').value = 'all';
  assert.equal(app.ctx.getFilteredData().length, 3);

  app.getById('filterMonth').value = '0'; // January
  assert.equal(app.ctx.getFilteredData().length, 2);

  app.getById('filterMonth').value = '1'; // February
  assert.equal(app.ctx.getFilteredData().length, 1);
});

// ── autoInsightSignature ────────────────────────────────────────────────────
test('autoInsightSignature encodes period | count | rounded-total', () => {
  app.t.setExpenses([exp(2026, 0, 1, 100), exp(2026, 0, 2, 200), exp(2026, 0, 3, 300)]);
  app.getById('filterMonth').value = 'all';
  app.getById('filterYear').value = 'all';
  assert.equal(app.ctx.autoInsightSignature(), 'all-all|3|600');
});

test('autoInsightSignature changes when the filtered set changes', () => {
  app.t.setExpenses([exp(2026, 0, 1, 100), exp(2026, 1, 2, 200)]);
  app.getById('filterYear').value = 'all';
  app.getById('filterMonth').value = 'all';
  const all = app.ctx.autoInsightSignature();
  app.getById('filterMonth').value = '0';
  const jan = app.ctx.autoInsightSignature();
  assert.notEqual(all, jan);
  assert.equal(jan, '0-all|1|100');
});

// ── buildExpenseSummary ─────────────────────────────────────────────────────
test('buildExpenseSummary reports no data when empty', () => {
  app.t.setExpenses([]);
  assert.equal(app.ctx.buildExpenseSummary('overview'), 'No expense data available.');
});

test('buildExpenseSummary includes period, total and per-category lines', () => {
  app.t.setExpenses([
    exp(2026, 0, 1, 100, 'Bike'),
    exp(2026, 0, 2, 200, 'Eating out'),
    exp(2026, 0, 3, 300, 'Groceries'),
  ]);
  app.getById('filterMonth').value = 'all';
  app.getById('filterYear').value = 'all';
  const s = app.ctx.buildExpenseSummary('overview');
  assert.match(s, /Period: All Time/);
  assert.match(s, /Total: ₹600/);
  assert.match(s, /Groceries: ₹300 total/);
  assert.match(s, /Eating out: ₹200 total/);
});

// ── insightLangName ─────────────────────────────────────────────────────────
test('insightLangName follows the voice-language index', () => {
  const { insightLangName } = app.ctx;
  app.t.setVoiceLangIdx(0); assert.equal(insightLangName(), 'English');
  app.t.setVoiceLangIdx(1); assert.equal(insightLangName(), 'Hindi');
  app.t.setVoiceLangIdx(2); assert.equal(insightLangName(), 'Bengali');
});

test('insightLangName defaults to English for an out-of-range index', () => {
  app.t.setVoiceLangIdx(99);
  assert.equal(app.ctx.insightLangName(), 'English');
});
