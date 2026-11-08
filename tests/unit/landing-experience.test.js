import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Experience cards on the landing page: one result per card, a 10 x 10 grid
// drawn from data-before/data-after, and Bengali and Hindi copies of each card.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const I18N = JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)[1]);
const cards = html.match(/<li class="xp-card"[\s\S]*?<\/ul>\s*<\/li>/g) || [];
const carousel = html.match(/<div class="xp-carousel"[\s\S]*?<p class="sr-only xp-status"[^>]*>[^<]*<\/p>/)[0];

const strip = (s) => s.replace(/<[^>]+>/g, ' ');
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const latinDigits = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
const numbers = (s) => (latinDigits(strip(s)).match(/\d+(?:\.\d+)?/g) || []).map(Number).sort((a, b) => a - b);

function parseCard(card) {
  const metric = card.match(/<h4 class="xp-metric" data-i18n="(zc\d+Metric)">([^<]+)<\/h4>/);
  const delta = card.match(/<p class="xp-delta" data-i18n="(zc\d+Delta)">([^<]+)<\/p>/);
  const values = card.match(/<p class="xp-values" data-i18n="(zc\d+Values)"><span class="xp-before">([^<]+)<\/span> → ([^<]+?) <span class="xp-unit">([^<]+)<\/span><\/p>/);
  const grid = card.match(/<div class="xp-waffle" data-before="(\d+)" data-after="(\d+)" aria-hidden="true"><\/div>/);
  const bullets = [...card.matchAll(/<li data-i18n="(zc\d+P\d+)">([\s\S]*?)<\/li>/g)];
  return { metric, delta, values, grid, bullets };
}

test('every card has a metric, a change, before and after values, a grid and 2-3 bullets', () => {
  assert.ok(cards.length >= 1, 'no cards found');
  for (const [i, card] of cards.entries()) {
    const c = parseCard(card);
    for (const part of ['metric', 'delta', 'values', 'grid']) assert.ok(c[part], `card ${i + 1} is missing its ${part}`);
    assert.ok(c.bullets.length >= 2 && c.bullets.length <= 3, `card ${i + 1} has ${c.bullets.length} bullets`);
  }
});

test('each grid matches the numbers printed on its card', () => {
  for (const [i, card] of cards.entries()) {
    const { values, grid } = parseCard(card);
    const before = Math.round(parseFloat(values[2])), after = Math.round(parseFloat(values[3]));
    assert.equal(Number(grid[1]), before, `card ${i + 1}: data-before should be ${before}`);
    assert.equal(Number(grid[2]), after, `card ${i + 1}: data-after should be ${after}`);
    for (const v of [before, after]) assert.ok(v >= 0 && v <= 100, `card ${i + 1}: ${v} is not a share of 100`);
  }
});

test('each headline change agrees with the before and after values', () => {
  for (const [i, card] of cards.entries()) {
    const { delta, values } = parseCard(card);
    const before = parseFloat(values[2]), after = parseFloat(values[3]);
    const d = delta[2].replace('\u2212', '-');
    if (d.endsWith('×')) {
      assert.ok(Math.abs(after / before - parseFloat(d)) <= 0.15, `card ${i + 1}: ${d} vs ${(after / before).toFixed(2)}×`);
    } else {
      const pct = ((after - before) / before) * 100;
      assert.ok(Math.abs(pct - parseFloat(d)) <= 1.5, `card ${i + 1}: ${d} vs ${pct.toFixed(1)}%`);
    }
  }
});

test('Bengali and Hindi cards carry the same numbers as the English ones', () => {
  const english = Object.fromEntries([...html.matchAll(/data-i18n="(zc\d+(?:Metric|Delta|Values|P\d+))">([\s\S]*?)<\/(?:h4|p|li)>/g)].map(m => [m[1], m[2]]));
  assert.ok(Object.keys(english).length >= cards.length * 5);
  for (const l of ['bn', 'hi']) {
    for (const [k, en] of Object.entries(english)) {
      assert.ok(I18N[l][k], `${l} is missing ${k}`);
      assert.deepEqual(numbers(I18N[l][k]), numbers(en), `${l}.${k} numbers differ from English`);
    }
  }
});

test('carousel labels are translated, with {n} and {total} in the templates', () => {
  const ariaKeys = [...html.matchAll(/data-i18n-aria="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ariaKeys.sort(), ['xpNext', 'xpPrev', 'xpRegion', 'xpTrack']);
  for (const l of ['bn', 'hi']) for (const k of ariaKeys) assert.ok(I18N[l][k], `${l} is missing ${k}`);
  for (const l of ['en', 'bn', 'hi']) {
    for (const k of ['xpStatus', 'xpSlide']) {
      assert.match(I18N[l][k], /\{n\}/, `${l}.${k}`);
      assert.match(I18N[l][k], /\{total\}/, `${l}.${k}`);
    }
  }
});

test('arrows float on the cards instead of a "1 / 5" counter, and wait for JavaScript', () => {
  assert.match(carousel, /<button type="button" class="xp-btn xp-prev"[^>]*hidden><\/button>/);
  assert.match(carousel, /<button type="button" class="xp-btn xp-next"[^>]*hidden><\/button>/);
  assert.doesNotMatch(carousel, /\d+ \/ \d+/);
  assert.doesNotMatch(html, /xp-count|xp-controls|xp-basis/);
  assert.match(html, /\.xp-btn:disabled \{ opacity: 0; visibility: hidden; \}/);
  assert.match(html, /\.xp-carousel \{\s*position: relative;/);
});

test('the role line, search and share descriptions name Zoca as the current role', () => {
  assert.match(html, /Zoca<\/a>, Bengaluru · Aug 2026 - Present/);
  assert.match(html, /Pine Labs, Bengaluru · May 2025 - Jul 2026/);
  for (const name of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
    const meta = html.match(new RegExp(`<meta ${name} content="([^"]+)">`));
    assert.ok(meta, name);
    assert.match(meta[1], /AI Product Manager at Zoca/, name);
  }
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const person = ld['@graph'].find(n => n['@type'] === 'Person');
  assert.equal(person.worksFor.name, 'Zoca');
  assert.match(person.description, /Zoca/);
});
