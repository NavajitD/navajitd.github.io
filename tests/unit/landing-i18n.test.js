import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Landing page: typed greeting (Bengali, English, Hindi) + "Read on in …" page translations.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const json = html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/);
const I18N = JSON.parse(json[1]);
const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]);
const LANGS = ['bn', 'en', 'hi'];

test('every language has a greeting and a read-on label in its own script', () => {
  const script = { bn: /[\u0980-\u09FF]/, hi: /[\u0900-\u097F]/, en: /^[\x20-\x7E\u2019\u2192]+$/ };
  for (const l of LANGS) {
    assert.ok(I18N[l].greeting, l);
    assert.ok(I18N[l].readOn, l);
    assert.match(I18N[l].greeting, script[l], l);
    assert.match(I18N[l].readOn, script[l], l);
  }
});

test('the invisible sizing copies match the typed greetings', () => {
  for (const l of LANGS) {
    const ghost = html.match(new RegExp(`<span class="greet-ghost" lang="${l}">([^<]+)</span>`));
    assert.ok(ghost, l);
    assert.equal(ghost[1], I18N[l].greeting, l);
  }
});

test('Bengali and Hindi translate every marked element on the page', () => {
  assert.ok(keys.length >= 15, `only ${keys.length} data-i18n elements`);
  for (const l of ['bn', 'hi']) {
    for (const k of keys) assert.ok(I18N[l][k], `${l} is missing ${k}`);
  }
});

test('translations keep the Zoca link and use plain hyphens', () => {
  for (const l of ['bn', 'hi']) {
    assert.match(I18N[l].zocaMeta, /<a href="https:\/\/app\.zoca\.com\/"[^>]*class="merchant-link">Zoca<\/a>/);
    assert.match(I18N[l].zocaLead, /<a href="https:\/\/zoca\.com\/front-desk-agent"[^>]*class="merchant-link">AI [^<]+<\/a>/);
    for (const [k, v] of Object.entries(I18N[l])) assert.doesNotMatch(v, /[\u2013\u2014]/, `${l}.${k}`);
  }
});

test('typing steps by grapheme, so no step starts with a vowel sign or virama', () => {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const l of LANGS) {
    for (const { segment } of seg.segment(I18N[l].greeting)) {
      assert.doesNotMatch(segment, /^\p{M}/u, `${l}: ${segment}`);
    }
  }
});

test('Anek Bangla and Anek Devanagari load with the page and are scoped by lang', () => {
  assert.match(html, /family=Anek\+Bangla:wdth,wght@75\.\.125,400\.\.700/);
  assert.match(html, /family=Anek\+Devanagari:wdth,wght@75\.\.125,400\.\.700/);
  assert.match(html, /:lang\(bn\) \{ font-family: "Anek Bangla", var\(--font-sans\); \}/);
  assert.match(html, /:lang\(hi\) \{ font-family: "Anek Devanagari", var\(--font-sans\); \}/);
});
