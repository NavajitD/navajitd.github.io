// Sanity checks for the MyExpenses sandbox harness itself. If the inline
// script stops loading cleanly under stubs (or the test seam breaks), every
// other MyExpenses test would fail opaquely — these make the cause obvious.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './_expenses-harness.js';

test('inline script loads with no error and the test seam is present', () => {
  const app = createApp();
  assert.equal(app.loadError, null, app.loadError && app.loadError.stack);
  assert.equal(app.testError, undefined);
  assert.ok(app.t, 'test seam __test should be defined (top-level ran to completion)');
});

test('core functions are exposed on the sandbox global', () => {
  const { ctx } = createApp();
  const expected = [
    'getTheme', 'getBillingCycle', 'autoCategory', 'extractKeywords', 'ragTokenize',
    'detectLanguageWithConfidence', 'countAmountMentions', 'tryParseJson', 'countActiveDays',
    'getFilteredData', 'buildExpenseSummary', 'autoInsightSignature', 'insightLangName',
    'getAutoInsightCache', 'isSameCalendarDay', 'pinSuggestion', 'getPinnedSuggestions',
    'buildRagIndex', 'ragCategoryVote', 'suggestPaymentForCategory',
  ];
  for (const fn of expected) assert.equal(typeof ctx[fn], 'function', `${fn} should be a function`);
});

test('each createApp() is isolated (no shared state)', () => {
  const a = createApp();
  const b = createApp();
  a.localStorage.setItem('pinnedSuggestions', JSON.stringify(['x']));
  assert.deepEqual(a.ctx.getPinnedSuggestions(), ['x']);
  assert.deepEqual(b.ctx.getPinnedSuggestions(), [], 'second app must not see first app state');
});
