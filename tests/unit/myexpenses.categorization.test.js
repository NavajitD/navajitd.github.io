// Categorization, language detection, tokenization and parsing helpers.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, plain } from './_expenses-harness.js';

let app;
beforeEach(() => { app = createApp(); });

// ── getTheme ──────────────────────────────────────────────────────────────
test('getTheme maps categories to their default theme', () => {
  const { getTheme } = app.ctx;
  assert.equal(getTheme('Groceries'), 'Cost of living');
  assert.equal(getTheme('Eating out'), 'Going out');
  assert.equal(getTheme('Education'), 'Incidentals');
});

test('getTheme returns "Other" only for genuinely unknown categories', () => {
  assert.equal(app.ctx.getTheme('Totally Unknown'), 'Other');
});

test('getTheme places the Miscellaneous catch-all under Incidentals', () => {
  assert.equal(app.ctx.getTheme('Miscellaneous'), 'Incidentals');
});

test('getTheme honours a custom profile theme map', () => {
  app.t.setProfileThemes({ Fun: ['Eating out', 'Cinema'] });
  const { getTheme } = app.ctx;
  assert.equal(getTheme('Eating out'), 'Fun');
  assert.equal(getTheme('Groceries'), 'Other'); // not in the custom map anymore
});

// ── getBillingCycle (25th-to-25th cycle) ────────────────────────────────────
test('getBillingCycle: day < 16 falls in the previous cycle', () => {
  assert.equal(app.ctx.getBillingCycle(new Date(2026, 2, 10)), 'Feb 25 - Mar 25');
});

test('getBillingCycle: day >= 16 falls in the current cycle', () => {
  assert.equal(app.ctx.getBillingCycle(new Date(2026, 2, 20)), 'Mar 25 - Apr 25');
});

test('getBillingCycle wraps across the year boundary', () => {
  assert.equal(app.ctx.getBillingCycle(new Date(2026, 0, 5)), 'Dec 25 - Jan 25');
  assert.equal(app.ctx.getBillingCycle(new Date(2026, 11, 20)), 'Dec 25 - Jan 25');
});

// ── autoCategory (keyword match) ────────────────────────────────────────────
test('autoCategory matches built-in keywords', () => {
  app.t.rebuildKeywords();
  const { autoCategory } = app.ctx;
  assert.equal(autoCategory('Zomato dinner'), 'Eating out');
  assert.equal(autoCategory('Netflix subscription'), 'Entertainment');
  assert.equal(autoCategory('BMTC bus pass'), 'Public transport');
});

test('autoCategory returns first-match by keyword order (Uber before airport)', () => {
  app.t.rebuildKeywords();
  // "airport" → Flights, "uber" → Auto/Cab; Auto/Cab is earlier in the map.
  assert.equal(app.ctx.autoCategory('Uber to airport'), 'Auto/Cab');
});

test('autoCategory returns null when nothing matches and RAG index is empty', () => {
  app.t.rebuildKeywords();
  assert.equal(app.ctx.autoCategory('qwxyz zzz'), null);
});

test('autoCategory does not fire short keywords inside longer words', () => {
  app.t.rebuildKeywords();
  const { autoCategory } = app.ctx;
  assert.equal(autoCategory('barber appointment'), null); // not Liquor via "bar"
  assert.equal(autoCategory('business meeting'), null);    // not Public transport via "bus"
  assert.equal(autoCategory('vegas holiday'), null);       // not Gas via "gas"
});

test('autoCategory still matches a keyword as a whole word', () => {
  app.t.rebuildKeywords();
  assert.equal(app.ctx.autoCategory('bought from more'), 'Groceries'); // "more" whole word
});

test('autoCategory uses learned keywords once they cross the threshold', () => {
  app.t.setUserProfile({ learnedKeywords: { mensa: { 'Eating out': 2 } } });
  app.t.rebuildKeywords();
  assert.equal(app.ctx.autoCategory('mensa'), 'Eating out');
});

test('autoCategory ignores learned keywords below the threshold', () => {
  app.t.setUserProfile({ learnedKeywords: { mensa: { 'Eating out': 1 } } });
  app.t.rebuildKeywords();
  assert.equal(app.ctx.autoCategory('mensa'), null);
});

// ── extractKeywords ─────────────────────────────────────────────────────────
test('extractKeywords drops stop-words, short tokens and pure numbers', () => {
  const { extractKeywords } = app.ctx;
  assert.deepEqual(plain(extractKeywords('Dinner at the Cafe')), ['dinner', 'cafe']);
  assert.deepEqual(plain(extractKeywords('Bought 2 milk')), ['bought', 'milk']);
  assert.deepEqual(plain(extractKeywords('100 200')), []);
});

// ── ragTokenize ─────────────────────────────────────────────────────────────
test('ragTokenize yields words (>=2 chars) plus char trigrams', () => {
  const { ragTokenize } = app.ctx;
  assert.deepEqual(plain(ragTokenize('cab')), ['cab', '#cab']);
  assert.deepEqual(plain(ragTokenize('taxi')), ['taxi', '#tax', '#axi']);
  assert.deepEqual(plain(ragTokenize('')), []);
  assert.deepEqual(plain(ragTokenize('a')), []); // single char dropped
});

// ── detectLanguageWithConfidence ────────────────────────────────────────────
test('detectLanguageWithConfidence flags English vs Indic by char ratio', () => {
  const { detectLanguageWithConfidence: d } = app.ctx;
  assert.equal(d('Lunch 250').lang, 'english');
  assert.equal(d('চা ৫০').lang, 'indic');   // Bengali
  assert.equal(d('चाय २०').lang, 'indic');   // Hindi/Devanagari
});

test('detectLanguageWithConfidence: empty text defaults to English at 0.5', () => {
  const r = app.ctx.detectLanguageWithConfidence('');
  assert.equal(r.lang, 'english');
  assert.equal(r.confidence, 0.5);
});

test('detectLanguageWithConfidence: 0.3 Indic ratio is the Indic threshold', () => {
  // 7 latin + 3 Devanagari = ratio 0.3 → indic
  assert.equal(app.ctx.detectLanguageWithConfidence('abcdefg आआआ').lang, 'indic');
  // 6 latin + 1 Devanagari = ratio ~0.14 → english
  assert.equal(app.ctx.detectLanguageWithConfidence('coffee आ').lang, 'english');
});

// ── countAmountMentions ─────────────────────────────────────────────────────
test('countAmountMentions counts numeric mentions >= 5', () => {
  const { countAmountMentions: c } = app.ctx;
  assert.equal(c('paid 250 and 4 rupees plus 1000'), 2); // 250, 1000 (4 is < 5)
  assert.equal(c('bought 3 items for 500'), 1);
  assert.equal(c('no numbers here'), 0);
  assert.equal(c(''), 0);
});

test('countAmountMentions also counts Devanagari and Bengali digit amounts', () => {
  const { countAmountMentions: c } = app.ctx;
  assert.equal(c('৫০০ আর ৬০০'), 2); // Bengali 500, 600
  assert.equal(c('५०० और ६००'), 2); // Devanagari 500, 600
  assert.equal(c('৪ টাকা'), 0);     // Bengali 4 is < 5
});

// ── tryParseJson ────────────────────────────────────────────────────────────
test('tryParseJson handles raw JSON, objects, fenced blocks and embedded JSON', () => {
  const { tryParseJson: p } = app.ctx;
  assert.equal(p(null), undefined);
  assert.deepEqual(p({ a: 1 }), { a: 1 });              // object passthrough
  assert.deepEqual(p('{"x":1}'), { x: 1 });             // raw
  assert.deepEqual(p('```json\n{"x":2}\n```'), { x: 2 }); // fenced
  assert.deepEqual(p('result: [1,2,3] ok'), [1, 2, 3]); // embedded array
  assert.equal(p('not json at all'), undefined);
});
