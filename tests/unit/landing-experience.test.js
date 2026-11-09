import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as X from '../../scripts/experience.js';

// The Experience section: content/experience.json is the source, the admin
// console edits it, and scripts/build-experience.mjs (run by the "Build
// experience" GitHub Action) writes it into index.html between markers.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const html = read('index.html');
const raw = read('content/experience.json');
const data = JSON.parse(raw);
const I18N = JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)[1]);
const clone = (x) => JSON.parse(JSON.stringify(x));
const region = (d) => X.renderExperience(d, { hash: 'test' });
const strings = (out) => JSON.parse(out.match(/<script type="application\/json" id="i18n-xp">([\s\S]*?)<\/script>/)[1]);

test('content/experience.json is valid and index.html is built from it', () => {
  assert.deepEqual(X.validateExperience(data), []);
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12);
  assert.equal(X.applyExperience(html, data, hash), html, 'index.html is stale: run node scripts/build-experience.mjs');
  assert.match(html, new RegExp(`<!-- @experience:start hash=${hash} `));
});

test('archived roles and cards stay in the file but leave the page', () => {
  const d = clone(data);
  const zoca = d.roles.find((r) => r.id === 'zoca');
  zoca.cards.find((c) => c.id === 'handoffs').archived = true;
  d.roles.find((r) => r.id === 'pine-labs-apm').archived = true;
  const out = region(d);
  assert.doesNotMatch(out, /x\.zoca\.handoffs\./);
  assert.doesNotMatch(out, /id="pine-labs-apm"/);
  assert.match(out, /id="pine-labs-ai-pm"/);
  assert.equal((out.match(/class="xp-card"/g) || []).length, zoca.cards.length - 1);
  assert.match(out, new RegExp(`Result 1 of ${zoca.cards.length - 1}<`));
  assert.ok(!('x.zoca.handoffs.metric' in strings(out).bn));
  // A role whose cards are all archived keeps its header and description, without a carousel.
  zoca.cards.forEach((c) => { c.archived = true; });
  const bare = region(d);
  assert.match(bare, /id="zoca"/);
  assert.doesNotMatch(bare, /xp-carousel/);
  assert.match(bare, /<p data-i18n="x\.zoca\.description">/);
});

test('roles render in file order, with the company link, dates and Bengali digits', () => {
  const out = region(data);
  const ids = [...out.matchAll(/<div class="experience-item" id="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(ids, data.roles.filter((r) => !r.archived).map((r) => r.id));
  assert.match(out, /<a href="https:\/\/app\.zoca\.com\/" target="_blank" rel="noopener noreferrer" class="merchant-link">Zoca<\/a>, Bengaluru · Aug 2026 - Present/);
  assert.match(out, /Pine Labs, Bengaluru · May 2025 - Jul 2026/);
  const s = strings(out);
  assert.equal(s.bn['x.pine-labs-product-owner.meta'], 'পাইন ল্যাবস, বেঙ্গালুরু · সেপ্টেম্বর ২০২৪ থেকে মে ২০২৫');
  assert.equal(s.hi['x.pine-labs-product-owner.meta'], 'पाइन लैब्स, बेंगलुरु · सितंबर 2024 से मई 2025');
  assert.equal(s.bn['x.zoca.trust.delta'], '−৮৬%');
  assert.equal(s.hi['x.zoca.trust.delta'], '−86%');
  assert.match(s.bn['x.zoca.bookings.values'], /<span class="xp-before">২৬%<\/span> → ৫৩%/);
  assert.equal(s.bn['x.zoca.region'], 'Zoca-তে ফলাফল');
});

test('text is escaped, and only http(s) and on-site links become links', () => {
  assert.equal(X.inline('a < b & "c"'), 'a &lt; b &amp; &quot;c&quot;');
  assert.equal(X.inline('[Zoca](https://zoca.com)'), '<a href="https://zoca.com" target="_blank" rel="noopener noreferrer" class="merchant-link">Zoca</a>');
  assert.equal(X.inline('[Projects](/projects.html)'), '<a href="/projects.html" class="merchant-link">Projects</a>');
  assert.equal(X.inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(X.inline('[x](//evil.example)'), '[x](//evil.example)');
  assert.equal(X.inline('[<b>](https://a.example)'), '<a href="https://a.example" target="_blank" rel="noopener noreferrer" class="merchant-link">&lt;b&gt;</a>');
  const d = clone(data);
  d.roles[0].title.en = 'Lead <script>alert(1)</script>';
  assert.doesNotMatch(region(d), /<script>alert/);
});

test('empty Bengali or Hindi falls back to English, so every key exists', () => {
  const d = clone(data);
  const card = d.roles[0].cards[0];
  card.metric.bn = '';
  card.bullets[0].hi = '  ';
  const out = region(d);
  const s = strings(out);
  assert.equal(s.bn[`x.zoca.${card.id}.metric`], card.metric.en);
  assert.equal(s.hi[`x.zoca.${card.id}.p1`], card.bullets[0].en);
  const keys = [...out.matchAll(/data-i18n(?:-aria)?="(x\.[^"]+)"/g)].map((m) => m[1]);
  for (const l of ['bn', 'hi']) for (const k of keys) assert.ok(k in s[l], `${l} is missing ${k}`);
});

test('the grid comes from before and after, only when asked and within 0-100', () => {
  const d = clone(data);
  const out = region(d);
  assert.match(out, /<div class="xp-waffle" data-before="26" data-after="53" aria-hidden="true">/);
  assert.match(out, /<div class="xp-waffle" data-before="9" data-after="1" aria-hidden="true">/); // 8.9 -> 1.3 per 100
  d.roles[0].cards[0].grid = false;
  assert.doesNotMatch(region(d), /data-before="26"/);
  const money = clone(data);
  Object.assign(money.roles[0].cards[0], { before: '₹40 Cr', after: '₹160 Cr', grid: true });
  assert.match(X.validateExperience(money).join(' '), /grid needs before and after between 0 and 100/);
});

test('the suggested change is a ratio from 2× up, otherwise a signed percentage', () => {
  assert.equal(X.suggestDelta('26%', '53%'), '2×');
  assert.equal(X.suggestDelta('18%', '53%'), '2.9×');
  assert.equal(X.suggestDelta('27%', '44%'), '+63%');
  assert.equal(X.suggestDelta('8.9', '1.3'), '−85%');
  assert.equal(X.suggestDelta('58%', '39%'), '−33%');
  assert.equal(X.suggestDelta('', '5'), '');
  assert.equal(X.suggestDelta('0', '5'), '');
});

test('validation names what is missing, including in archived items', () => {
  const d = clone(data);
  d.roles.push({ ...X.blankRole('zoca'), archived: true });
  d.roles[0].cards.push(X.blankCard('new'));
  d.roles[1].end = '2020-01';
  const errors = X.validateExperience(d).join('\n');
  assert.match(errors, /id "zoca" is used twice/);
  assert.match(errors, /add a title/);
  assert.match(errors, /start month must look like 2026-08/);
  assert.match(errors, /card 6: add the metric/);
  assert.match(errors, /add at least one bullet/);
  assert.match(errors, /ends before it starts/);
  assert.deepEqual(X.validateExperience({}), ['The file needs a "roles" list.']);
});

test('translation notes flag Bengali or Hindi whose numbers lag the English', () => {
  assert.deepEqual(X.translationNotes({ en: 'Cut errors 3.5% to 1.3%', bn: 'ত্রুটি ৩.৫% থেকে ১.৩%', hi: 'गड़बड़ियाँ 3.5% से 2%' }), { hi: 'Numbers differ from the English.' });
  assert.deepEqual(X.translationNotes({ en: 'No numbers', bn: '', hi: '' }), {});
});

test('new ids are slugs and never collide', () => {
  assert.equal(X.uniqueId('Pine Labs', ['zoca']), 'pine-labs');
  assert.equal(X.uniqueId('Pine Labs', ['pine-labs', 'pine-labs-2']), 'pine-labs-3');
  assert.equal(X.uniqueId('ব্যবসা', []), 'item');
});

test('every carousel has floating arrows and a hidden status instead of a counter', () => {
  const out = region(data);
  const carousels = out.match(/<div class="xp-carousel"[\s\S]*?<p class="sr-only xp-status"[^>]*>[^<]*<\/p>/g) || [];
  assert.equal(carousels.length, data.roles.filter((r) => !r.archived && (r.cards || []).some((c) => !c.archived)).length);
  for (const c of carousels) {
    assert.match(c, /<button type="button" class="xp-btn xp-prev"[^>]*hidden><\/button>/);
    assert.match(c, /<button type="button" class="xp-btn xp-next"[^>]*hidden><\/button>/);
    assert.doesNotMatch(c, /\d+ \/ \d+/);
  }
  assert.doesNotMatch(html, /xp-count|xp-controls|xp-basis/);
  assert.match(html, /\.xp-btn:disabled \{ opacity: 0; visibility: hidden; \}/);
  assert.match(html, /\.xp-carousel \{\s*position: relative;/);
});

test('carousel status and slide labels are templates in every language', () => {
  for (const l of ['en', 'bn', 'hi']) {
    for (const k of ['xpStatus', 'xpSlide']) {
      assert.match(I18N[l][k], /\{n\}/, `${l}.${k}`);
      assert.match(I18N[l][k], /\{total\}/, `${l}.${k}`);
    }
  }
  for (const l of ['bn', 'hi']) for (const k of ['xpPrev', 'xpNext']) assert.ok(I18N[l][k], `${l} is missing ${k}`);
});

test('the role line, search and share descriptions name Zoca as the current role', () => {
  for (const name of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
    const meta = html.match(new RegExp(`<meta ${name} content="([^"]+)">`));
    assert.ok(meta, name);
    assert.match(meta[1], /AI Product Manager at Zoca/, name);
  }
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const person = ld['@graph'].find((n) => n['@type'] === 'Person');
  assert.equal(person.worksFor.name, 'Zoca');
});

test('the GitHub Action rebuilds index.html whenever the JSON changes', () => {
  const wf = read('.github/workflows/experience.yml');
  assert.match(wf, /paths:[\s\S]*'content\/experience\.json'/);
  assert.match(wf, /run: node scripts\/build-experience\.mjs/);
  assert.match(wf, /git add index\.html/);
  assert.match(wf, /permissions:\s*\n\s*contents: write/);
  execFileSync(process.execPath, [new URL('scripts/build-experience.mjs', ROOT).pathname, '--check'], { stdio: 'pipe' });
});

test('the admin console loads its scripts with current content stamps', () => {
  execFileSync(process.execPath, [new URL('scripts/stamp-scripts.mjs', ROOT).pathname, '--check'], { stdio: 'pipe' });
  const admin = read('admin.html');
  assert.match(admin, /<button class="tab" data-tab="experience">Experience<\/button>/);
  assert.match(admin, /<script type="module" src="\/admin-experience\.js\?v=[0-9a-f]{8}"><\/script>/);
});
