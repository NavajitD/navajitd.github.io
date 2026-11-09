import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as B from '../../blog-core.js';
import { buildBlog, fetchDocs, postPage, assignSlugs, llmsWith, sitemapWith, postFonts, listFonts, onlyFonts } from '../../scripts/build-blog.mjs';

// The blog: Tech, Poetry, Makha-bhat and Recipe. The writing lives only in
// Firestore; the site's deploy reads it and builds static pages into the
// deployed site, never into the repository. Fixtures here are made up or
// public domain.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const blog = read('blog.html');
const post = read('blog-post.html');
const admin = read('admin.html');
const adminBlog = read('admin-blog.js');

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const typed = (v) => {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(typed) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (/^\d{4}-\d\d-\d\dT/.test(v)) return { timestampValue: v };
  return { stringValue: v };
};
const restDoc = (id, fields, updateTime = '2026-11-09T10:00:00Z') => ({
  name: `projects/recipes-7dc22/databases/(default)/documents/posts/${id}`,
  updateTime,
  fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typed(v)])),
});
const DOCS = [
  restDoc('Xy12RandomOldId', {
    title: 'Evals first: a made-up essay', date: '2026-06-02T00:00:00Z', excerpt: 'Why the test set came first.', readTime: '9 min read',
    html: '<p>Costs $5 &amp; $& more.</p><img data-media="0" alt="A chart" width="1400" height="700" loading="lazy"><script>alert(1)</script><p onclick="x()">End.</p>',
    media: [PIXEL],
  }, '2026-06-03T09:00:00Z'),
  restDoc('without-fear', {
    type: 'poetry', title: 'Without Fear', date: '2026-11-07T00:00:00Z', readTime: '2 lines',
    poem: 'Where the mind is without fear\nand the head is held high;', note: 'After Tagore.',
  }),
  restDoc('musur-dal', {
    type: 'recipe', title: 'Musur dal', date: '2026-11-09T00:00:00Z', description: 'Red lentils with a tadka.',
    prepTime: '10 min', cookTime: '25 min', servings: '4', ingredients: ['1 cup red lentils'], steps: ['Boil until soft.'],
    hasHero: true, galleryCount: 1, heroImage: PIXEL, images: [PIXEL],
  }),
];

/** A copy of the pages the build reads, as Jekyll would leave them in _site. */
function siteCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'blog-site-'));
  for (const f of ['blog.html', 'blog-post.html', 'sitemap.xml', 'llms.txt']) copyFileSync(new URL(f, ROOT), join(dir, f));
  return dir;
}

test('the blog page shows All and the four sections as filters, each section with its description on top', () => {
  assert.deepEqual(B.TYPES.map((t) => t.name), ['Tech', 'Poetry', 'Makha-bhat', 'Recipe']);
  const nav = blog.match(/<nav class="filters" aria-label="Blog sections">[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/<a href="([^"]+)" data-filter="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2], m[3]]),
    [['/blog.html', 'all', 'All'], ...B.TYPES.map((t) => [`#${t.id}`, t.id, t.name])]);
  const descriptions = [...blog.matchAll(/<p class="filter-description" data-for="([^"]+)">([^<]+)<\/p>/g)];
  assert.deepEqual(descriptions.map((m) => m[1]), B.TYPES.map((t) => t.id), 'one description per section, none for All');
  for (const m of descriptions) assert.ok(m[2].trim().length > 20, `${m[1]} needs a description`);
  assert.match(descriptions[2][2], /bhog/);
  assert.match(descriptions[2][2], /movie reviews, short stories and smaller observations on life/);
  // The description sits between the filters and the posts.
  const order = ['class="filters"', 'class="filter-description"', 'class="post-list"', 'class="list-empty"'].map((s) => blog.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(blog, /class="page-description"|class="blog-section"/, 'no page-level summary, no stacked sections');
  assert.match(blog, /<div class="post-list" id="posts"><!-- @blog:cards --><\/div>/);
});

test('the chosen filter is marked like the current page in the top nav, from the first paint', () => {
  const css = blog.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /nav a\.current\{color:var\(--accent-color\);font-weight:600\}/);
  const marked = css.match(/((?:html[^{]*\.filters a\[data-filter="[^"]+"\],?\s*)+)\{([^}]*)\}/);
  assert.equal(marked[2], 'color:var(--accent-color);font-weight:600', 'the same rule as nav a.current');
  for (const f of ['all', ...B.TYPES.map((t) => t.id)]) assert.ok(marked[1].includes(`[data-filter="${f}"]`), f);
  for (const t of B.TYPES) {
    assert.ok(css.includes(`html[data-filter="${t.id}"] .filter-description[data-for="${t.id}"]`), `${t.id} shows its description`);
    assert.ok(css.includes(`html[data-filter="${t.id}"] .blog-card:not([data-type="${t.id}"])`), `${t.id} hides the other posts`);
    assert.ok(css.includes(`html[data-filter="${t.id}"] .post-list:not(:has(.blog-card[data-type="${t.id}"])) + .list-empty`), `${t.id} says when it is empty`);
  }
  // The address picks the section before anything paints: the first script in <head>.
  const head = blog.slice(0, blog.indexOf('</head>'));
  const first = head.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(first.index < head.indexOf('<style>') && first.index < head.indexOf('fonts.googleapis.com'));
  assert.match(first[1], /\/\^\(tech\|poetry\|makha-bhat\|recipe\)\$\/\.test\(t\)\) document\.documentElement\.setAttribute\('data-filter', t\)/);
  assert.match(blog, /history\.replaceState\(null, '', f === 'all' \? location\.pathname \+ location\.search : '#' \+ f\)/);
  assert.match(blog, /a\.setAttribute\('aria-current', 'true'\)/);
});

test('no blog content is kept in the repository', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT.pathname, encoding: 'utf8' }).split('\n');
  assert.ok(!tracked.some((f) => f.startsWith('blog/') || f.startsWith('_site/')), 'no built posts are tracked');
  for (const gone of ['posts.json', 'scripts/build-blog-index.mjs', '.github/workflows/blog-index.yml']) {
    assert.ok(!existsSync(new URL(gone, ROOT)), `${gone} should not exist`);
  }
  assert.match(read('.gitignore'), /^_site\/$/m);
  // A workflow that reads posts may deploy them, never commit them.
  for (const wf of tracked.filter((f) => f.startsWith('.github/workflows/'))) {
    const text = read(wf);
    if (/build-blog|documents\/posts/.test(text)) {
      assert.doesNotMatch(text, /git (add|commit|push)|contents: write/, `${wf} must not commit posts`);
    }
  }
  const sitemap = read('sitemap.xml');
  assert.doesNotMatch(sitemap, /\/blog\/|blog-post\.html|recipes\.html/, 'post addresses are added at deploy time only');
  assert.match(sitemap, /<loc>https:\/\/navajitd\.github\.io\/blog\.html<\/loc>/);
  const llms = read('llms.txt');
  assert.doesNotMatch(llms, /blog-post\.html|navajitd\.github\.io\/blog\/|## Writing/);
  assert.match(llms, /\[Blog\]\(https:\/\/navajitd\.github\.io\/blog\.html\): Writing in four sections: Tech/);
  for (const page of [blog, post, admin]) assert.doesNotMatch(page, /posts\.json/);
  assert.doesNotMatch(blog, /class="blog-card"/, 'the repository copy of blog.html lists no posts');
});

test('recipes are a section of the blog: no page links to the old recipes page, which redirects', () => {
  for (const page of ['index.html', 'projects.html', 'blog.html', 'blog-post.html', '404.html']) {
    assert.doesNotMatch(read(page), /href="\/?recipes\.html"/, page);
  }
  const old = read('recipes.html');
  assert.match(old, /<meta http-equiv="refresh" content="0; url=\/blog\.html#recipe">/);
  assert.match(old, /location\.replace\('\/blog\.html#recipe'\)/);
  assert.match(old, /<meta name="robots" content="noindex">/);
  assert.ok(old.length < 1200, 'just a redirect');
});

test('blog-post.html reads one post from Firestore, exactly the fields blog-core.js reads', () => {
  const inline = post.match(/<script>\s*\(function \(\) \{\s*var q = new URLSearchParams[\s\S]*?<\/script>/)[0];
  const lists = [...inline.matchAll(/get\(\[([^\]]+)\]/g)].map((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
  assert.deepEqual(lists, [B.TEXT_FIELDS, B.MEDIA_FIELDS]);
  const base = inline.match(/var base = '([^']+)' \+ encodeURIComponent\(s\.id\) \+ '([^']+)'/);
  assert.equal(`${base[1]}x${base[2]}`, B.docUrl('x'));
  // Old ?id= links go to the static page; &live (from 404.html and the admin) reads Firestore instead.
  assert.match(post, /<script type="application\/json" id="blogSlugs">\{\}<\/script>/);
  assert.match(inline, /if \(!q\.has\('live'\)\)/);
  assert.match(inline, /location\.replace\('\/blog\/' \+ slug \+ '\.html' \+ location\.hash\)/);
  assert.doesNotMatch(post, /localStorage/, 'no copies of posts kept in the browser');
  assert.doesNotMatch(post, /firebasejs|firebase-app/, 'no Firebase SDK on the post page');
  const head = post.slice(0, post.indexOf('</head>'));
  assert.ok(head.indexOf('firestore.googleapis.com/v1/projects') < head.indexOf('fonts.googleapis.com/css2'), 'the post request starts before the fonts');
});

test('pages start fast: nothing blocks the first paint, and the list prerenders the post a visitor points at', () => {
  for (const page of [blog, post]) {
    const head = page.slice(0, page.indexOf('</head>'));
    assert.doesNotMatch(head.replace(/<noscript>[\s\S]*?<\/noscript>/g, ''), /<link[^>]+rel="stylesheet"/, 'no stylesheet blocks the first paint');
    assert.match(page, /rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+" onload="this\.onload=null;this\.rel='stylesheet'"/);
  }
  assert.doesNotMatch(blog, /firestore\.googleapis\.com|type="module"|blog-core\.js/, 'the list is plain HTML');
  const rules = JSON.parse(blog.match(/<script type="speculationrules">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(rules.prerender[0].where, { selector_matches: 'a.blog-card' });
  assert.match(post, /<!-- @live --><link rel="modulepreload" href="\/blog-core\.js\?v=[0-9a-f]{8}"><!-- \/@live -->/);
});

test('poems are set in EB Garamond, Bengali and Hindi poems in Tiro', () => {
  const fonts = decodeURIComponent(post.match(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/)[1]).replace(/&amp;/g, '&');
  for (const family of ['EB+Garamond', 'Tiro+Bangla', 'Tiro+Devanagari+Hindi', 'Source+Serif+4', 'Noto+Serif+Bengali', 'Noto+Serif+Devanagari', 'Inconsolata']) {
    assert.ok(fonts.includes(`family=${family}`), family);
  }
  assert.match(post, /--font-poem: "EB Garamond", Georgia, "Times New Roman", serif;/);
  assert.match(post, /\.poem\{font-family:var\(--font-poem\);[^}]*font-synthesis:none/);
  assert.match(post, /\.article-body\.poem:lang\(bn\)\{font-family:"Tiro Bangla"/);
  assert.match(post, /\.article-body\.poem:lang\(hi\)\{font-family:"Tiro Devanagari Hindi"/);
  assert.match(post, /\.poem \.ln\{display:block;padding-left:calc\(1\.5em \+ var\(--indent, 0\) \* \.5ch\);text-indent:-1\.5em\}/);
  assert.match(blog, /\.blog-card-excerpt\.poem-lines\{font-family:var\(--font-poem\)/);
  assert.match(blog, /family=EB\+Garamond/);
});

test('Firestore REST documents unwrap to plain posts', () => {
  const doc = {
    name: 'projects/p/databases/(default)/documents/posts/my-poem',
    updateTime: '2026-11-09T10:00:00Z',
    fields: {
      title: { stringValue: 'A < B' }, date: { timestampValue: '2026-11-08T00:00:00Z' }, n: { integerValue: '3' },
      d: { doubleValue: 1.5 }, ok: { booleanValue: true }, none: { nullValue: null },
      tags: { arrayValue: { values: [{ stringValue: 'x' }, { stringValue: 'y' }] } }, empty: { arrayValue: {} },
      m: { mapValue: { fields: { k: { stringValue: 'v' } } } },
    },
  };
  assert.deepEqual(B.fromRest(doc), {
    title: 'A < B', date: '2026-11-08T00:00:00Z', n: 3, d: 1.5, ok: true, none: '', tags: ['x', 'y'], empty: [], m: { k: 'v' },
    id: 'my-poem', updateTime: '2026-11-09T10:00:00Z',
  });
  assert.deepEqual(B.fromList({}), []);
  assert.match(B.listUrl(), /\/documents\/posts\?key=[^&]+&pageSize=300(&mask\.fieldPaths=\w+)+$/);
  assert.match(B.listUrl({ fields: null, pageSize: 50, pageToken: 'a/b=' }), /&pageSize=50&pageToken=a%2Fb%3D$/);
  assert.ok(!B.LIST_FIELDS.includes('html') && !B.LIST_FIELDS.includes('poem'), 'the list never downloads bodies');
  assert.ok(!B.TEXT_FIELDS.some((f) => B.MEDIA_FIELDS.includes(f)), 'text and images come in separate requests');
  assert.match(B.docUrl('a b'), /\/posts\/a%20b\?key=/);
});

test('posts without a type are Tech; dates show the chosen day everywhere', () => {
  assert.equal(B.typeOf({}), 'tech');
  assert.equal(B.typeOf({ type: 'novel' }), 'tech');
  assert.equal(B.typeOf({ type: 'makha-bhat' }), 'makha-bhat');
  assert.equal(B.normalize({ id: 'x', title: '' }).title, 'Untitled');
  assert.equal(B.normalize({ id: 'x', lang: 'fr' }).lang, 'en');
  assert.equal(B.fmtDate('2026-06-02T00:00:00Z'), '2 June 2026');
  assert.equal(B.fmtDate('2026-06-02T23:30:00Z'), '2 June 2026');
  assert.equal(B.fmtDate('not a date'), '');
});

test('each post has an address: its id when that is a slug, else the slug of its title, which old links used', () => {
  assert.equal(B.slugify('Don’t Panic: A Guide to the Galaxy’s "Edge"'), 'dont-panic-a-guide-to-the-galaxys-edge');
  const long = B.slugify('One two three four five six seven eight nine ten eleven twelve thirteen fourteen');
  assert.ok(long.length <= 70 && !long.endsWith('-'));
  assert.equal(long, 'one-two-three-four-five-six-seven-eight-nine-ten-eleven-twelve');
  assert.equal(B.slugify('চিত্ত যেথা'), '');
  assert.equal(B.postPath({ id: 'without-fear', title: 'Renamed later' }), '/blog/without-fear.html');
  assert.equal(B.postPath({ id: 'Xy12RandomOldId', title: 'Evals first: an essay' }), '/blog/evals-first-an-essay.html');
  assert.equal(B.postPath({ id: 'Xy12RandomOldId', title: 'A new title', slug: 'evals-first-an-essay' }), '/blog/evals-first-an-essay.html', 'a frozen slug wins');
  assert.equal(B.postPath({ id: 'poetry-2026-11-09', title: 'চিত্ত' }), '/blog/poetry-2026-11-09.html');
  assert.equal(B.livePath({ id: 'a b' }), '/blog-post.html?id=a%20b');
  const taken = assignSlugs([{ id: 'Xy12RandomOldId', title: 'Musur dal' }, { id: 'musur-dal', title: 'Musur dal' }]);
  assert.deepEqual(taken.map((p) => p.slug), ['musur-dal-2', 'musur-dal'], 'a post whose id is the slug keeps it');
  const nf = read('404.html');
  const script = nf.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(nf.indexOf('<script>') < nf.indexOf('<body>'), 'decides before anything paints');
  assert.match(script, /\/\^\\\/blog\\\/\(\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\)\(\?:\\\.html\)\?\\\/\?\$\/i/);
  assert.match(script, /location\.replace\('\/blog-post\.html\?id=' \+ encodeURIComponent\(m\[1\]\.toLowerCase\(\)\) \+ '&live' \+ location\.hash\)/);
  assert.match(script, /location\.replace\('\/blog\.html'\)/);
  assert.doesNotMatch(nf, /blog-core\.js|documents\/posts/, 'the 404 page lists nothing');
  assert.match(nf, /<meta name="robots" content="noindex">/);
});

test('a poem keeps its lines, stanzas and indents, and escapes its text', () => {
  const poem = 'Where the mind is without fear\r\nand the head is held high;   \n\n\n    Where knowledge is free; <b>&\n\tby tab';
  assert.deepEqual(B.stanzas(poem), [['Where the mind is without fear', 'and the head is held high;'], ['    Where knowledge is free; <b>&', '\tby tab']]);
  assert.equal(B.poemExcerpt(poem), 'Where the mind is without fear\nand the head is held high;');
  assert.equal(B.lineCount(poem), '4 lines');
  assert.equal(B.lineCount('one'), '1 line');
  const html = B.articleHtml({ id: 'p', type: 'poetry', lang: 'bn', title: 'চিত্ত', date: '2026-11-08T00:00:00Z', poem, note: 'For R.\n\nWritten on a train.' });
  assert.match(html, /<header class="article-header" lang="bn"><h1 class="article-title">চিত্ত<\/h1>/);
  assert.match(html, /<div class="article-body poem" lang="bn"><p class="stanza"><span class="ln">Where the mind is without fear<\/span><span class="ln">and the head is held high;<\/span><\/p>/);
  assert.match(html, /<span class="ln" style="--indent:4">Where knowledge is free; &lt;b&gt;&amp;<\/span><span class="ln" style="--indent:4">by tab<\/span>/);
  assert.match(html, /<div class="poem-note"><p>For R\.<\/p><p>Written on a train\.<\/p><\/div>/);
  assert.match(html, /<span>4 lines<\/span>/);
  assert.doesNotMatch(html, /<b>/);
});

test('a recipe has its facts, grouped ingredients, numbered method and photo slots', () => {
  const r = {
    id: 'dal', type: 'recipe', title: 'Dal & rice', date: '2026-11-08T00:00:00Z', description: 'Weeknight food.',
    cuisine: 'Bengali', difficulty: 'Easy', prepTime: '10 min', cookTime: '1 h 30 min', servings: '4', tags: ['quick'],
    ingredients: ['1 cup lentils', 'For the tadka:', '1 tsp panch phoron', '2 chillies'], steps: ['Boil.', 'Temper <hot>.'],
    notes: 'Lime helps.', hasHero: true, galleryCount: 2,
  };
  const html = B.articleHtml(r);
  assert.match(html, /<dl class="recipe-facts" lang="en"><div><dt>Prep<\/dt><dd>10 min<\/dd><\/div><div><dt>Cook<\/dt><dd>1 h 30 min<\/dd><\/div><div><dt>Serves<\/dt><dd>4<\/dd><\/div><div><dt>Level<\/dt><dd>Easy<\/dd><\/div><\/dl>/);
  assert.match(html, /<figure class="recipe-hero"><img data-media="hero" alt="Dal &amp; rice"/);
  assert.match(html, /<h2>Ingredients<\/h2><ul class="ingredients"><li>1 cup lentils<\/li><\/ul><h3>For the tadka<\/h3><ul class="ingredients"><li>1 tsp panch phoron<\/li><li>2 chillies<\/li><\/ul>/);
  assert.match(html, /<h2>Method<\/h2><ol class="steps"><li>Boil\.<\/li><li>Temper &lt;hot&gt;\.<\/li><\/ol>/);
  assert.equal((html.match(/data-media="g\d"/g) || []).length, 2);
  assert.match(html, /<p class="recipe-tags">Bengali · quick<\/p>/);
  assert.doesNotMatch(B.articleHtml({ ...r, hasHero: false }), /recipe-hero/);
  assert.equal(B.recipeLine(r), 'Prep 10 min · Cook 1 h 30 min · Serves 4');
  const ld = B.jsonLd(r, { image: 'https://navajitd.github.io/blog/media/dal/hero-1.webp' });
  assert.equal(ld['@type'], 'Recipe');
  assert.equal(ld.prepTime, 'PT10M');
  assert.equal(ld.cookTime, 'PT1H30M');
  assert.equal(ld.image, 'https://navajitd.github.io/blog/media/dal/hero-1.webp');
  assert.deepEqual(ld.recipeIngredient, ['1 cup lentils', '1 tsp panch phoron', '2 chillies']);
  assert.deepEqual(ld.recipeInstructions.map((s) => s.text), ['Boil.', 'Temper <hot>.']);
  assert.deepEqual(B.ingredientGroups(['For the paste:']), [{ title: 'For the paste', items: [] }]);
});

test('cards share one anatomy, name their section for All, and link to the static page', () => {
  const poemCard = B.cardHtml({ id: 'p 1', type: 'poetry', lang: 'hi', title: 'साखी', date: '2026-11-08T00:00:00Z', excerpt: 'line one\nline <two>', readTime: '4 lines' });
  assert.equal(poemCard, '<a class="blog-card" href="/blog/p-1.html" data-type="poetry" lang="hi"><div class="blog-card-date" lang="en">8 November 2026<span class="blog-card-section"> · Poetry</span></div><div class="blog-card-title">साखी</div><div class="blog-card-excerpt poem-lines">line one<br>line &lt;two&gt;</div><div class="blog-card-reading" lang="en">4 lines</div></a>');
  const recipeCard = B.cardHtml({ id: 'r', type: 'recipe', title: 'Dal', date: '2026-11-08T00:00:00Z', description: 'Soft lentils.', prepTime: '10 min', cookTime: '25 min', servings: '4' });
  assert.match(recipeCard, /<div class="blog-card-excerpt">Soft lentils\.<\/div><div class="blog-card-reading" lang="en">Prep 10 min · Cook 25 min · Serves 4<\/div>/);
  const techCard = B.cardHtml({ id: 't', title: 'An essay', date: '2026-06-02T00:00:00Z', excerpt: 'A blurb.', readTime: '9 min read' });
  assert.match(techCard, /data-type="tech"/);
  assert.match(techCard, /<div class="blog-card-reading" lang="en">9 min read<\/div><\/a>$/);
  const list = B.listHtml([
    { id: 'a', title: 'Old', date: '2025-01-01T00:00:00Z' },
    { id: 'b', title: 'New', date: '2026-01-01T00:00:00Z' },
    { id: 'c', type: 'recipe', title: 'Dal', date: '2026-02-01T00:00:00Z' },
  ]);
  assert.deepEqual([...list.matchAll(/href="\/blog\/(\w)\.html"/g)].map((m) => m[1]), ['c', 'b', 'a'], 'newest first');
});

test('essays render their HTML without anything active in it; images fill their slots', () => {
  const html = B.articleHtml({ id: 'e', type: 'makha-bhat', title: 'Notes', date: '2026-10-01T00:00:00Z', html: '<p>Hi</p><img data-media="0" alt="">', readTime: '1 min read' });
  assert.match(html, /<div class="article-body"><p>Hi<\/p><img data-media="0" alt=""><\/div>$/);
  assert.equal(B.fillSlots('<img alt="" data-media="0" width="2"><img data-media="9" alt="">', { 0: '/m/0.webp' }), '<img alt="" src="/m/0.webp" width="2"><img data-media="9" alt="">');
  assert.equal(
    B.stripActive('<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)><iframe src="y"></iframe><a href="https://ok">ok</a>'),
    '<p>a</p><a>x</a><img src=x><a href="https://ok">ok</a>');
  assert.deepEqual(B.mediaSources({ media: ['data:a', ''], heroImage: 'data:h', images: ['data:g0', 'data:g1'] }), { 0: 'data:a', hero: 'data:h', g0: 'data:g0', g1: 'data:g1' });
  const ld = B.jsonLd({ id: 'e', type: 'poetry', title: 'T', date: '2026-10-01T00:00:00Z' });
  assert.equal(ld['@type'], 'BlogPosting');
  assert.equal(ld.articleSection, 'Poetry');
  assert.equal(ld.genre, 'Poetry');
  assert.equal(ld.url, 'https://navajitd.github.io/blog/e.html');
  assert.equal(B.ldJson({ a: '</script><!--' }), '{"a":"\\u003c/script>\\u003c!--"}');
  assert.equal(B.readTime('word '.repeat(450)), '2 min read');
});

test('the deploy build writes a static page per post, the list, the share tags, images, sitemap and llms.txt', async () => {
  const site = siteCopy();
  const s = await buildBlog({ site, docs: DOCS });
  assert.deepEqual(s, { posts: 3, images: 3, sections: { Tech: 1, Poetry: 1, 'Makha-bhat': 0, Recipe: 1 } });
  const out = (f) => readFileSync(join(site, f), 'utf8');
  assert.deepEqual(readdirSync(join(site, 'blog')).sort(), ['evals-first-a-made-up-essay.html', 'media', 'musur-dal.html', 'without-fear.html']);

  // An essay: its own head, the article in the HTML, nothing that reads Firestore.
  const essay = out('blog/evals-first-a-made-up-essay.html');
  assert.match(essay, /<title>Evals first: a made-up essay - Navajit D<\/title>/);
  assert.match(essay, /<meta name="description" content="Why the test set came first\.">/);
  assert.match(essay, /<link rel="canonical" href="https:\/\/navajitd\.github\.io\/blog\/evals-first-a-made-up-essay\.html">/);
  assert.match(essay, /<meta property="og:title" content="Evals first: a made-up essay">/);
  assert.match(essay, /<meta property="article:section" content="Tech">/);
  assert.match(essay, /<meta property="article:modified_time" content="2026-06-03T09:00:00\.000Z">/);
  assert.match(essay, /<script>window\.__nvPostReadyId = "Xy12RandomOldId";<\/script>/);
  assert.equal(essay.match(/<title>/g).length, 1);
  assert.doesNotMatch(essay, /firestore\.googleapis\.com|type="module"|loadingState|blogSlugs|@live|@meta|Blog - Navajit D/);
  assert.match(essay, /<article class="article-container is-tech" id="article"><header class="article-header"><h1 class="article-title">Evals first: a made-up essay<\/h1>/);
  assert.match(essay, /<p>Costs \$5 &amp; \$& more\.<\/p>/, 'dollar signs in a post survive');
  assert.doesNotMatch(essay, /alert\(1\)|onclick/);
  assert.match(essay, /<img src="\/blog\/media\/evals-first-a-made-up-essay\/0-[0-9a-f]{8}\.png" alt="A chart" width="1400" height="700" loading="lazy">/);
  assert.match(essay, /<a href="\/blog\.html#tech" class="topbar-back" id="backLink">/);
  assert.match(essay, /<span id="backLabel">Tech<\/span>/);
  assert.match(essay, /<footer class="post-footer" id="postFooter">/);
  assert.match(essay, /<meta property="og:image" content="https:\/\/navajitd\.github\.io\/blog\/media\/evals-first-a-made-up-essay\/0-[0-9a-f]{8}\.png">/);
  const ld = JSON.parse(essay.match(/<script type="application\/ld\+json" id="postLd">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.headline, 'Evals first: a made-up essay');

  // A recipe shares its photo; a poem without one shares the site's card.
  const recipe = out('blog/musur-dal.html');
  assert.match(recipe, /<meta property="og:image" content="https:\/\/navajitd\.github\.io\/blog\/media\/musur-dal\/hero-[0-9a-f]{8}\.png">/);
  assert.match(recipe, /<figure class="recipe-hero"><img src="\/blog\/media\/musur-dal\/hero-[0-9a-f]{8}\.png" alt="Musur dal" width="1280" height="800" decoding="async" fetchpriority="high"><\/figure>/);
  assert.match(recipe, /<div class="recipe-gallery"><img src="\/blog\/media\/musur-dal\/g0-[0-9a-f]{8}\.png" alt=""/);
  const poem = out('blog/without-fear.html');
  assert.match(poem, /<meta property="og:image" content="https:\/\/navajitd\.github\.io\/og-image\.png">/);
  assert.match(poem, /<article class="article-container is-poetry" id="article">/);
  assert.match(poem, /<span id="backLabel">Poetry<\/span>/);
  assert.equal(readdirSync(join(site, 'blog', 'media', 'musur-dal')).length, 2);

  // The list: every post as a card, newest first, plus the blog's structured data.
  const list = out('blog.html');
  assert.deepEqual([...list.matchAll(/<a class="blog-card" href="([^"]+)" data-type="([^"]+)"/g)].map((m) => [m[1], m[2]]),
    [['/blog/musur-dal.html', 'recipe'], ['/blog/without-fear.html', 'poetry'], ['/blog/evals-first-a-made-up-essay.html', 'tech']]);
  const blogLd = JSON.parse(list.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(blogLd['@type'], 'Blog');
  assert.deepEqual(blogLd.blogPost.map((p) => p.url.replace('https://navajitd.github.io', '')), ['/blog/musur-dal.html', '/blog/without-fear.html', '/blog/evals-first-a-made-up-essay.html']);
  assert.doesNotMatch(list, /@blog:/);

  // Old ?id= links know where each post went.
  assert.match(out('blog-post.html'), /<script type="application\/json" id="blogSlugs">\{"musur-dal":"musur-dal","without-fear":"without-fear","Xy12RandomOldId":"evals-first-a-made-up-essay"\}<\/script>/);
  const sitemap = out('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/navajitd\.github\.io\/blog\/evals-first-a-made-up-essay\.html<\/loc>\n    <lastmod>2026-06-03<\/lastmod>/);
  assert.equal((sitemap.match(/<url>/g) || []).length, 4 + 3);
  const llms = out('llms.txt');
  assert.match(llms, /## Writing\n- \[Musur dal\]\(https:\/\/navajitd\.github\.io\/blog\/musur-dal\.html\): Recipe, 9 November 2026\n/);
  assert.ok(llms.indexOf('## Writing') < llms.indexOf('## Contact'));
});

test('each static page asks Google Fonts only for the families it shows', async () => {
  const families = (html) => [...new Set([...html.matchAll(/fonts\.googleapis\.com\/css2\?[^"]+/g)]
    .flatMap((m) => [...m[0].matchAll(/family=([^:&]+)/g)].map((f) => f[1].replace(/\+/g, ' '))))].sort();
  assert.deepEqual([...postFonts({ type: 'tech', lang: 'en' })].sort(), ['Inconsolata', 'Source Serif 4']);
  assert.deepEqual([...postFonts({ type: 'recipe', lang: 'bn' })].sort(), ['Inconsolata', 'Noto Serif Bengali', 'Source Serif 4']);
  assert.deepEqual([...postFonts({ type: 'poetry', lang: 'hi' })].sort(), ['EB Garamond', 'Inconsolata', 'Tiro Devanagari Hindi']);
  assert.deepEqual([...listFonts([{ type: 'poetry', lang: 'bn' }, { type: 'tech', lang: 'en' }])].sort(), ['Anek Bangla', 'Inconsolata', 'Tiro Bangla']);
  const link = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;1,400&amp;family=Inconsolata:wght@400;600&amp;display=swap';
  assert.equal(onlyFonts(`<link href="${link}">`, new Set(['Inconsolata'])), '<link href="https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;600&amp;display=swap">');

  const site = siteCopy();
  await buildBlog({ site, docs: DOCS });
  const out = (f) => readFileSync(join(site, f), 'utf8');
  assert.deepEqual(families(out('blog/evals-first-a-made-up-essay.html')), ['Inconsolata', 'Source Serif 4']);
  assert.deepEqual(families(out('blog/without-fear.html')), ['EB Garamond', 'Inconsolata']);
  assert.deepEqual(families(out('blog.html')), ['EB Garamond', 'Inconsolata']);
  assert.match(out('blog/without-fear.html'), /family=EB\+Garamond:ital,wght@0,400;0,500;1,400&amp;family=Inconsolata:wght@400;500;600;700&amp;display=swap/, 'styles and display=swap kept');
  // blog-post.html itself (for posts newer than the deploy) still loads every family.
  assert.equal(families(out('blog-post.html')).length, 7);
});

test('the deploy build refuses to write into a git checkout, and stops when a page lost its markers', async () => {
  const site = siteCopy();
  mkdirSync(join(site, '.git'));
  await assert.rejects(buildBlog({ site, docs: DOCS }), /is a git checkout/);
  await assert.rejects(buildBlog({ site: ROOT.pathname, docs: DOCS }), /is a git checkout/, 'never into this repository');
  const broken = siteCopy();
  writeFileSync(join(broken, 'blog.html'), read('blog.html').replace('<!-- @blog:cards -->', ''));
  await assert.rejects(buildBlog({ site: broken, docs: DOCS }), /blog\.html: the <!-- @blog:cards --> marker not found/);
  assert.throws(() => postPage('<html></html>', { id: 'x', title: 'X' }), /blog-post\.html: the <!-- @live --> parts not found/);
  assert.equal(llmsWith('# Site\n', []), '# Site\n');
  assert.match(sitemapWith('<urlset>\n</urlset>\n', [{ id: 'a-b', title: 'A', slug: 'a-b', date: '2026-01-02T00:00:00Z' }]), /<loc>https:\/\/navajitd\.github\.io\/blog\/a-b\.html<\/loc>\n    <lastmod>2026-01-02<\/lastmod>/);
});

test('the deploy build lists every post page by page, signed in as the read-only account', async () => {
  const asked = [];
  const pages = [{ documents: [DOCS[0]], nextPageToken: 'p2' }, { documents: [DOCS[1], DOCS[2]] }];
  const fetchFn = async (url, init) => { asked.push([url, init.headers]); return { ok: true, json: async () => pages[asked.length - 1] }; };
  const docs = await fetchDocs({ token: 'tok', fetchFn });
  assert.equal(docs.length, 3);
  assert.equal(asked.length, 2);
  assert.match(asked[0][0], /\/documents\/posts\?pageSize=50$/, 'no API key when signed in, and no field mask: the build needs everything');
  assert.match(asked[1][0], /&pageToken=p2$/);
  assert.deepEqual(asked[0][1], { Authorization: 'Bearer tok' });
  const refused = async () => ({ ok: false, status: 403 });
  await assert.rejects(fetchDocs({ token: '', fetchFn: refused }), /Firestore answered 403 when listing posts: not allowed/);
});

test('Firestore: anyone may open a post by its id; only the owner may list posts or write them', () => {
  const rules = read('firestore.rules');
  const posts = rules.match(/match \/posts\/\{postId\} \{([\s\S]*?)\}/)[1];
  assert.deepEqual(posts.trim().split('\n').map((l) => l.trim()), ['allow get: if true;', 'allow list: if isAdmin();', 'allow write: if isAdmin();']);
  assert.doesNotMatch(rules, /match \/recipes\//, 'recipes are posts now; the old collection is closed');
  assert.match(rules, /request\.auth\.token\.email == 'navjitdebnath5@gmail\.com'/);
});

test('the site deploys from a workflow: Jekyll as before, the blog from Firestore, nothing committed, the upload deleted', () => {
  const wf = read('.github/workflows/deploy.yml');
  assert.match(wf, /on:\n  push:\n    branches: \[main\]\n  repository_dispatch:\n    types: \[blog-publish, site-deploy\]\n  workflow_dispatch:\n  schedule:\n    - cron: '23 \*\/6 \* \* \*'/);
  // The same step and settings GitHub's own Pages build used.
  assert.match(wf, /uses: actions\/jekyll-build-pages@v1\n        with:\n          source: \.\n          destination: \.\/_site\n          future: false\n          build_revision: \$\{\{ github\.sha \}\}\n          verbose: true\n          token: \$\{\{ github\.token \}\}/);
  assert.match(wf, /uses: google-github-actions\/auth@v3/);
  assert.match(wf, /workload_identity_provider: projects\/631868594925\/locations\/global\/workloadIdentityPools\/github\/providers\/navajitd-site/);
  assert.match(wf, /service_account: blog-build@recipes-7dc22\.iam\.gserviceaccount\.com/);
  assert.match(wf, /create_credentials_file: false/, 'no key file lands in the workspace');
  assert.match(wf, /run: node scripts\/build-blog\.mjs --site _site\n        env:\n          FIRESTORE_TOKEN: \$\{\{ steps\.gcp\.outputs\.access_token \}\}/);
  assert.match(wf, /uses: actions\/upload-pages-artifact@v3\n        with:\n          path: _site\n          retention-days: 1/);
  assert.match(wf, /uses: actions\/deploy-pages@v5/);
  assert.match(wf, /- name: Delete the upload[\s\S]*?if: always\(\)[\s\S]*?gh api -X DELETE "repos\/\$\{\{ github\.repository \}\}\/actions\/artifacts\/\$id"/);
  assert.match(wf, /actions: write # to delete the upload afterwards/);
  assert.match(wf, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(wf, /git (add|commit|push)|contents: write/);
  assert.match(wf, /concurrency:\n  group: pages\n  cancel-in-progress: false/);
  const xp = read('.github/workflows/experience.yml');
  assert.match(xp, /git push -q origin HEAD:main; then\n\s+gh api "repos\/\$\{\{ github\.repository \}\}\/dispatches" -f event_type=site-deploy/);
});

test('analytics skips admin previews and counts a prerendered post only once it is opened', () => {
  const a = read('analytics.js');
  assert.match(a, /if \(\/\[\?&\]preview\(\?:\[=&\]\|\$\)\/\.test\(location\.search\)\) return;/);
  assert.match(a, /if \(document\.prerendering\) document\.addEventListener\('prerenderingchange', fn, \{ once: true \}\);/);
  assert.match(a, /whenShown\(deferred\)/);
  assert.match(a, /\(p\.indexOf\('\/blog\/'\) === 0 && p\.endsWith\('\.html'\)\) \? 'blog_post'/, 'static post pages count as posts');
});

test('the admin console writes every kind of post from one Blog posts tab, then deploys the site', () => {
  const tabs = [...admin.matchAll(/<button class="tab[^"]*" data-tab="([^"]+)">([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs, [['metrics', 'Metrics'], ['experience', 'Experience'], ['blog', 'Blog posts']]);
  assert.match(admin, /<div class="tab-panel" id="tabBlog"><div id="blogAdmin"><\/div><\/div>/);
  assert.match(admin, /<script type="module" src="\/admin-blog\.js\?v=[0-9a-f]{8}"><\/script>/);
  assert.doesNotMatch(admin, /Upload Recipe|All Recipes|Upload Post|collection\('recipes'\)/);
  assert.match(adminBlog, /^\s*TYPES, LANGS,/m);
  assert.match(adminBlog, /const posts = \(\) => firebase\.firestore\(\)\.collection\('posts'\);/);
  assert.doesNotMatch(adminBlog, /collection\('recipes'\)/);
  assert.match(adminBlog, /field\('Poem', poem, 'A blank line starts a new stanza\. Spaces at the start of a line indent it\.'\)/);
  assert.match(admin, /\.bl-poem\{font-family:"EB Garamond"/);
  assert.match(admin, /family=EB\+Garamond/);
  // Listing needs the owner's sign-in; publishing asks GitHub to deploy, naming no post.
  assert.match(adminBlog, /const token = await firebase\.auth\(\)\.currentUser\?\.getIdToken\(\);/);
  assert.match(admin, /const idToken = await auth\.currentUser\.getIdToken\(\);/);
  assert.match(adminBlog, /fetch\(`\$\{GH\}\/dispatches`/);
  assert.match(adminBlog, /body: JSON\.stringify\(\{ event_type: 'blog-publish' \}\)/);
  assert.match(adminBlog, /localStorage\.getItem\('xp\.githubToken'\)/);
  assert.match(read('admin-experience.js'), /window\.xpConnect = \(reason\) => openConnect\(reason\);/);
});
