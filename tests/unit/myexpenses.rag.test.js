// RAG pipeline: index build, local category vote, and payment-method
// suggestion derived from the user's own history.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, plain } from './_expenses-harness.js';

let app;
beforeEach(() => { app = createApp(); });

const now = () => new Date();
const e = (id, name, category, paymentMethod) => ({
  id, expenseName: name, category, paymentMethod, date: now(),
});

// ── ragCategoryVote ─────────────────────────────────────────────────────────
test('ragCategoryVote classifies from confidently similar history', () => {
  app.t.setExpenses([
    e('1', 'Morning coffee', 'Eating out', 'GPay UPI'),
    e('2', 'Evening coffee', 'Eating out', 'GPay UPI'),
    e('3', 'Coffee beans', 'Eating out', 'Cash'),
    e('4', 'Metro ticket', 'Public transport', 'Cash'),
  ]);
  app.t.rebuildRag();
  assert.equal(app.ctx.ragCategoryVote('coffee'), 'Eating out');
});

test('ragCategoryVote returns null when the vote is split below the margin', () => {
  app.t.setExpenses([
    e('1', 'coffee one', 'Eating out', 'Cash'),
    e('2', 'coffee two', 'Cinema', 'Cash'),
  ]);
  app.t.rebuildRag();
  // 50/50 split is below the 0.55 confident margin.
  assert.equal(app.ctx.ragCategoryVote('coffee'), null);
});

test('ragCategoryVote returns null with no matching history', () => {
  app.t.setExpenses([e('1', 'Metro ticket', 'Public transport', 'Cash')]);
  app.t.rebuildRag();
  assert.equal(app.ctx.ragCategoryVote('helicopter charter'), null);
});

test('ragCategoryVote returns null on an empty index', () => {
  app.t.setExpenses([]);
  app.t.rebuildRag();
  assert.equal(app.ctx.ragCategoryVote('anything'), null);
});

test('ragCategoryVote rejects a winner outside the user\'s category list', () => {
  app.t.setExpenses([
    e('1', 'Morning coffee', 'Eating out', 'Cash'),
    e('2', 'Evening coffee', 'Eating out', 'Cash'),
  ]);
  app.t.setUserProfile({ categories: ['Groceries', 'Bike'] }); // Eating out not allowed
  app.t.rebuildRag();
  assert.equal(app.ctx.ragCategoryVote('coffee'), null);
});

// ── suggestPaymentForCategory ───────────────────────────────────────────────
test('suggestPaymentForCategory returns the most-used method for a category', () => {
  app.t.setExpenses([
    e('1', 'Morning coffee', 'Eating out', 'GPay UPI'),
    e('2', 'Evening coffee', 'Eating out', 'GPay UPI'),
    e('3', 'Coffee beans', 'Eating out', 'Cash'),
  ]);
  app.t.rebuildRag();
  assert.deepEqual(plain(app.ctx.suggestPaymentForCategory('Eating out')), { method: 'GPay UPI', card: null });
});

test('suggestPaymentForCategory parses "CC - <card>" into a credit-card suggestion', () => {
  app.t.setExpenses([e('1', 'Flight to Goa', 'Travel', 'CC - HDFC Regalia')]);
  app.t.rebuildRag();
  assert.deepEqual(plain(app.ctx.suggestPaymentForCategory('Travel')), { method: 'Credit card', card: 'HDFC Regalia' });
});

test('suggestPaymentForCategory returns null for unknown/empty input', () => {
  app.t.setExpenses([e('1', 'Morning coffee', 'Eating out', 'Cash')]);
  app.t.rebuildRag();
  assert.equal(app.ctx.suggestPaymentForCategory('Travel'), null); // no history
  assert.equal(app.ctx.suggestPaymentForCategory(''), null);
  assert.equal(app.ctx.suggestPaymentForCategory(null), null);
});

test('suggestPaymentForCategory is null before the index is built', () => {
  // Fresh app, no rebuildRag() call ⇒ _categoryPaymentStats is null.
  assert.equal(app.ctx.suggestPaymentForCategory('Eating out'), null);
});
