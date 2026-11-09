// The blog, end to end. The deploy build (scripts/build-blog.mjs) runs here
// on made-up and public-domain posts, and its output is served in place of
// the repository's blog.html, blog-post.html and blog/. Firestore's REST API
// (read by blog-post.html for posts published since the last deploy, and by
// the admin) and GitHub's API (the admin's deploy) are answered from
// fixtures, so nothing leaves the machine; the admin's Firebase SDK is the
// recording stub.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const STUB = readFileSync(new URL('tests/fixtures/firebase-admin-stub.js', ROOT), 'utf8');
const NOT_FOUND = readFileSync(new URL('404.html', ROOT), 'utf8');
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TOKEN = 'github_pat_TEST0000000000000000000000'; // made up

const typed = (v) => {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(typed) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (/^\d{4}-\d\d-\d\dT/.test(v)) return { timestampValue: v };
  return { stringValue: v };
};
const POSTS = {
  'evals-first': {
    title: 'Evals first', date: '2026-06-02T00:00:00Z', excerpt: 'Why the test set came before the roadmap.', readTime: '9 min read',
    html: '<p>The opening paragraph.</p><img data-media="0" alt="A chart" width="1400" height="700"><p>The closing paragraph.</p>',
    media: [PIXEL],
  },
  'chitta-jetha': {
    type: 'poetry', lang: 'bn', title: 'চিত্ত যেথা ভয়শূন্য', date: '2026-11-08T00:00:00Z', readTime: '4 lines',
    excerpt: 'চিত্ত যেথা ভয়শূন্য, উচ্চ যেথা শির,\nজ্ঞান যেথা মুক্ত',
    poem: 'চিত্ত যেথা ভয়শূন্য, উচ্চ যেথা শির,\nজ্ঞান যেথা মুক্ত, যেথা গৃহের প্রাচীর\n\nআপন প্রাঙ্গণতলে দিবসশর্বরী\n    বসুধারে রাখে নাই খণ্ড ক্ষুদ্র করি,',
  },
  'without-fear': {
    type: 'poetry', title: 'Without Fear', date: '2026-11-07T00:00:00Z', readTime: '2 lines',
    excerpt: 'Where the mind is without fear\nand the head is held high;', poem: 'Where the mind is without fear\nand the head is held high;', note: 'After Tagore.',
    createdAt: '2026-11-07T08:30:00Z',
  },
  'musur-dal': {
    type: 'recipe', title: 'Musur dal', date: '2026-11-09T00:00:00Z', excerpt: 'Red lentils with a tadka.', description: 'Red lentils with a tadka.',
    cuisine: 'Bengali', difficulty: 'Easy', prepTime: '10 min', cookTime: '25 min', servings: '4', tags: ['quick'],
    ingredients: ['1 cup red lentils', 'For the tadka:', '1 tsp panch phoron'], steps: ['Boil until soft.', 'Pour the tadka over.'],
    hasHero: true, galleryCount: 1, heroImage: PIXEL, images: [PIXEL],
  },
  // From before posts had slugs for ids: its page takes the slug of its title.
  Q9legacyId0: { title: 'An older essay', date: '2025-03-01T00:00:00Z', excerpt: 'From the first version of the blog.', html: '<p>Old words.</p>', readTime: '1 min read' },
};
// Published since the last deploy: in Firestore, with no static page yet.
const FRESH = { 'brand-new': { type: 'makha-bhat', title: 'Brand new', date: '2026-11-09T00:00:00Z', html: '<p>Just out.</p>', readTime: '1 min read' } };

const restDoc = (id, fields, keep) => ({
  name: `projects/recipes-7dc22/databases/(default)/documents/posts/${id}`,
  updateTime: '2026-11-09T10:00:00Z',
  fields: Object.fromEntries(Object.entries(fields).filter(([k]) => !keep || keep.includes(k)).map(([k, v]) => [k, typed(v)])),
});

// Build the deployed site from POSTS, as the deploy workflow does (the CLI, from a saved Firestore list).
const SITE = mkdtempSync(join(tmpdir(), 'blog-e2e-'));
for (const f of ['blog.html', 'blog-post.html', 'sitemap.xml', 'llms.txt']) copyFileSync(new URL(f, ROOT), join(SITE, f));
writeFileSync(join(SITE, 'docs.json'), JSON.stringify({ documents: Object.entries(POSTS).map(([id, f]) => restDoc(id, f)) }));
const BUILD_LOG = execFileSync(process.execPath, [new URL('scripts/build-blog.mjs', ROOT).pathname, '--site', SITE, '--docs', join(SITE, 'docs.json')], { encoding: 'utf8' });

/** Serve the built blog where GitHub Pages would; a missing page gets 404.html, as on Pages. */
async function site(page) {
  await page.route(/^http:\/\/127\.0\.0\.1:8765\/(blog\.html|blog-post\.html|blog\/[^?#]*)([?#].*)?$/, (route) => {
    const file = join(SITE, decodeURIComponent(new URL(route.request().url()).pathname));
    if (existsSync(file) && statSync(file).isFile()) return route.fulfill({ path: file });
    return route.fulfill({ status: 404, contentType: 'text/html', body: NOT_FOUND });
  });
}

/** Answer Firestore REST like the real thing; `down` makes every read fail. */
async function firestore(page, { down = false, posts = { ...POSTS, ...FRESH } } = {}) {
  const asked = [];
  await page.route('https://firestore.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') return route.fulfill({ json: {} }); // analytics events
    asked.push({ url, auth: req.headers().authorization || '' });
    if (down) return route.abort();
    const keep = url.searchParams.getAll('mask.fieldPaths');
    const m = url.pathname.match(/\/documents\/posts(?:\/([^/]+))?$/);
    if (!m) return route.fulfill({ status: 404, json: {} });
    if (!m[1]) return route.fulfill({ json: { documents: Object.entries(posts).map(([id, f]) => restDoc(id, f, keep.length ? keep : null)) } });
    const id = decodeURIComponent(m[1]);
    if (!posts[id]) return route.fulfill({ status: 404, json: { error: { code: 404 } } });
    return route.fulfill({ json: restDoc(id, posts[id], keep.length ? keep : null) });
  });
  await page.route(/get\.geojs\.io|ipwho\.is|ipapi\.co/, (r) => r.abort());
  return asked;
}
const postReads = (asked) => asked.filter((a) => a.url.pathname.includes('/documents/posts'));
const watchErrors = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

test('the build reports counts only, never titles (its log is public)', () => {
  expect(BUILD_LOG.trim()).toBe('Blog: 5 posts (Tech 2, Poetry 2, Recipe 1), 3 images.');
});

test('the blog page shows All, then one section at a time with its description on top', async ({ page }) => {
  const errors = watchErrors(page);
  const asked = await firestore(page);
  await site(page);
  await page.goto('/blog.html');
  const filters = page.locator('.filters a');
  await expect(filters).toHaveText(['All', 'Tech', 'Poetry', 'Makha-bhat', 'Recipe']);
  await expect(page.locator('.filters a[aria-current="true"]')).toHaveText('All');
  await expect(page.locator('.blog-card:visible .blog-card-title')).toHaveText(['Musur dal', 'চিত্ত যেথা ভয়শূন্য', 'Without Fear', 'Evals first', 'An older essay']);
  await expect(page.locator('.blog-card').first().locator('.blog-card-date')).toHaveText('9 November 2026 · Recipe');
  await expect(page.locator('.filter-description:visible')).toHaveCount(0);

  // The chosen filter looks exactly like the current page in the top nav.
  const look = (loc) => loc.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).fontWeight]);
  const navCurrent = await look(page.locator('header nav a.current'));
  expect(await look(page.locator('.filters a[data-filter="all"]'))).toEqual(navCurrent);
  expect(await look(page.locator('.filters a[data-filter="tech"]'))).toEqual(await look(page.locator('header nav a:not(.current)').first()));

  // Measure in Inconsolata, once its stylesheet (loaded without blocking) has arrived.
  await page.waitForFunction(() => [...document.fonts].some((f) => f.family.includes('Inconsolata') && f.status === 'loaded'));
  await page.evaluate(() => document.fonts.ready);
  const widths = await filters.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  await page.locator('.filters a', { hasText: 'Poetry' }).click();
  await expect(page).toHaveURL(/\/blog\.html#poetry$/);
  await expect(page.locator('.filters a[aria-current="true"]')).toHaveText('Poetry');
  await expect.poll(() => look(page.locator('.filters a[data-filter="poetry"]'))).toEqual(navCurrent); // links fade their colour in
  expect(await filters.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))).toEqual(widths); // nothing shifts
  await expect(page.locator('.filter-description:visible')).toHaveText('Poems, in whichever language they arrive in.');
  await expect(page.locator('.blog-card:visible .blog-card-title')).toHaveText(['চিত্ত যেথা ভয়শূন্য', 'Without Fear']);
  await expect(page.locator('.blog-card:visible .blog-card-date')).toHaveText(['8 November 2026', '7 November 2026'], { useInnerText: true }); // no section name inside a section
  const top = async (sel) => (await page.locator(sel).first().boundingBox()).y;
  expect(await top('.filter-description:visible')).toBeLessThan(await top('.blog-card:visible'));
  const fonts = await page.locator('.blog-card:visible .poem-lines').evaluateAll((els) => els.map((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/"/g, '')));
  expect(fonts).toEqual(['Tiro Bangla', 'EB Garamond']);

  await page.locator('.filters a', { hasText: 'Makha-bhat' }).click();
  await expect(page.locator('.filter-description:visible')).toContainText('leftovers from a bhog');
  await expect(page.locator('.list-empty')).toBeVisible();
  await expect(page.locator('.blog-card:visible')).toHaveCount(0);

  await page.locator('.filters a', { hasText: 'All' }).click();
  await expect(page).toHaveURL(/\/blog\.html$/);
  await expect(page.locator('.blog-card:visible')).toHaveCount(5);
  await expect(page.locator('.list-empty')).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(0);

  // A link to a section opens it, from the first paint.
  await page.goto('/blog.html#recipe');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-filter'))).toBe('recipe');
  await expect(page.locator('.blog-card:visible .blog-card-title')).toHaveText(['Musur dal']);
  expect(postReads(asked)).toEqual([]); // the list is plain HTML
  expect(errors).toEqual([]);
});

test('a post is a static page: its text, title and share tags are in the HTML, nothing is fetched', async ({ page }) => {
  const errors = watchErrors(page);
  const asked = await firestore(page);
  await site(page);
  const html = readFileSync(join(SITE, 'blog/evals-first.html'), 'utf8'); // what Pages serves
  expect(html).toContain('<title>Evals first - Navajit D</title>');
  expect(html).toContain('<meta property="og:title" content="Evals first">');
  expect(html).toContain('<p>The opening paragraph.</p>');

  await page.goto('/blog/evals-first.html');
  await expect(page.locator('.article-title')).toHaveText('Evals first');
  await expect(page.locator('.article-meta')).toContainText('9 min read');
  await expect(page).toHaveTitle('Evals first - Navajit D');
  await expect(page.locator('#backLabel')).toHaveText('Tech');
  await expect(page.locator('#backLink')).toHaveAttribute('href', '/blog.html#tech');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://navajitd.github.io/blog/evals-first.html');
  const img = page.locator('.article-body img');
  await expect(img).toHaveAttribute('src', /^\/blog\/media\/evals-first\/0-[0-9a-f]{8}\.png$/);
  expect(await img.evaluate((i) => i.complete && i.naturalWidth)).toBe(1);
  const ld = JSON.parse(await page.locator('#postLd').textContent());
  expect(ld).toMatchObject({ '@type': 'BlogPosting', headline: 'Evals first', articleSection: 'Tech', url: 'https://navajitd.github.io/blog/evals-first.html' });
  expect(await page.evaluate(() => window.__nvPostReadyId)).toBe('evals-first');
  await expect(page.locator('#loadingState')).toHaveCount(0);
  expect(await page.locator('script[type="module"]').count()).toBe(0);

  await page.locator('#backLink').click();
  await expect(page).toHaveURL(/\/blog\.html#tech$/);
  await expect(page.locator('.filters a[aria-current="true"]')).toHaveText('Tech');
  expect(postReads(asked)).toEqual([]);
  expect(errors).toEqual([]);
});

test('static poems keep their stanzas and are set in the poem serif for their language', async ({ page }) => {
  await firestore(page);
  await site(page);
  await page.goto('/blog/chitta-jetha.html');
  await expect(page.locator('.poem .stanza')).toHaveCount(2);
  await expect(page.locator('.poem .ln')).toHaveCount(4);
  await expect(page.locator('.poem .ln').last()).toHaveAttribute('style', '--indent:4');
  expect(await page.locator('.poem').evaluate((e) => getComputedStyle(e).fontFamily.split(',')[0])).toBe('"Tiro Bangla"');
  expect(await page.locator('.article-title').evaluate((e) => [getComputedStyle(e).fontFamily.split(',')[0], getComputedStyle(e).fontWeight])).toEqual(['"Tiro Bangla"', '400']);
  await expect(page.locator('#backLabel')).toHaveText('Poetry');
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'bn_IN');

  await page.goto('/blog/without-fear.html');
  expect(await page.locator('.poem').evaluate((e) => getComputedStyle(e).fontFamily.split(',')[0])).toBe('"EB Garamond"');
  await expect(page.locator('.poem-note')).toHaveText('After Tagore.');
});

test('a static recipe shows its facts, grouped ingredients, method and photos, and shares its photo', async ({ page }) => {
  await firestore(page);
  await site(page);
  await page.goto('/blog/musur-dal.html');
  await expect(page.locator('.recipe-facts dt')).toHaveText(['Prep', 'Cook', 'Serves', 'Level']);
  await expect(page.locator('.article-body h3')).toHaveText('For the tadka');
  await expect(page.locator('.ingredients li')).toHaveCount(2);
  await expect(page.locator('.steps li')).toHaveText(['Boil until soft.', 'Pour the tadka over.']);
  for (const sel of ['.recipe-hero img', '.recipe-gallery img']) {
    expect(await page.locator(sel).evaluate((i) => i.complete && i.naturalWidth)).toBe(1);
  }
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/navajitd\.github\.io\/blog\/media\/musur-dal\/hero-[0-9a-f]{8}\.png$/);
  const ld = JSON.parse(await page.locator('#postLd').textContent());
  expect(ld).toMatchObject({ '@type': 'Recipe', name: 'Musur dal', prepTime: 'PT10M', recipeIngredient: ['1 cup red lentils', '1 tsp panch phoron'] });
});

test('old links land: ?id= goes to the static page, a post newer than the deploy reads from Firestore', async ({ page }) => {
  const asked = await firestore(page);
  await site(page);
  await page.goto('/blog-post.html?id=Q9legacyId0');
  await expect(page).toHaveURL(/\/blog\/an-older-essay\.html$/);
  await expect(page.locator('.article-title')).toHaveText('An older essay');
  await page.goto('/blog-post.html?id=evals-first');
  await expect(page).toHaveURL(/\/blog\/evals-first\.html$/);
  expect(postReads(asked)).toEqual([]);

  // Published a minute ago: no page yet, so 404.html opens it from Firestore.
  await page.goto('/blog/brand-new.html');
  await expect(page).toHaveURL(/\/blog-post\.html\?id=brand-new&live$/);
  await expect(page.locator('.article-title')).toHaveText('Brand new');
  await expect(page.locator('#backLabel')).toHaveText('Makha-bhat');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://navajitd.github.io/blog/brand-new.html');
  expect(postReads(asked).map((a) => a.url.pathname.split('/').pop())).toEqual(['brand-new', 'brand-new']); // text, then images

  await page.goto('/blog/nothing-here.html');
  await expect(page.locator('#loadingState')).toContainText('This post isn’t here.');
  await page.goto('/blog/');
  await expect(page).toHaveURL(/\/blog\.html$/);
  await page.goto('/recipes.html');
  await expect(page).toHaveURL(/\/blog\.html#recipe$/);
  await expect(page.locator('.filters a[aria-current="true"]')).toHaveText('Recipe');
  await expect(page.locator('.blog-card:visible')).toHaveCount(1);
});

test('blog-post.html reads a post from Firestore, text first, then its images', async ({ page }) => {
  const errors = watchErrors(page);
  const asked = await firestore(page);
  await site(page);
  await page.goto('/blog-post.html?id=evals-first&live');
  await expect(page.locator('.article-title')).toHaveText('Evals first');
  await expect(page.locator('.article-body img[data-media="0"]')).toHaveAttribute('src', PIXEL);
  const docs = postReads(asked).filter((a) => a.url.pathname.endsWith('/posts/evals-first'));
  expect(docs.map((a) => a.url.searchParams.getAll('mask.fieldPaths').includes('media'))).toEqual([false, true]);
  await page.unroute('https://firestore.googleapis.com/**');
  await firestore(page, { down: true });
  await page.goto('/blog-post.html?id=evals-first&live');
  await expect(page.locator('#loadingState')).toContainText('The post didn’t load.');
  await expect(page.locator('#loadingState a')).toHaveAttribute('href', '/blog.html');
  expect(errors).toEqual([]);
});

// ─── Admin ───────────────────────────────────────────────────────────────────
/** GitHub's API: dispatches succeed; the deploy they start finishes after `polls` checks. */
async function github(page, { polls = 1, conclusion = 'success' } = {}) {
  const calls = [];
  let checks = 0;
  const run = (status) => ({ id: 7, status, conclusion: status === 'completed' ? conclusion : null, created_at: new Date().toISOString(), html_url: 'https://github.com/NavajitD/navajitd.github.io/actions/runs/7' });
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push({ method: req.method(), path: url.pathname, body: req.postData(), auth: req.headers().authorization || '' });
    if (req.method() === 'POST' && url.pathname.endsWith('/dispatches')) return route.fulfill({ status: 204, body: '' });
    if (url.pathname.endsWith('/actions/workflows/deploy.yml/runs')) return route.fulfill({ json: { workflow_runs: [run('queued')] } });
    if (url.pathname.endsWith('/actions/runs/7')) return route.fulfill({ json: run(++checks >= polls ? 'completed' : 'in_progress') });
    return route.fulfill({ status: 404, json: {} });
  });
  return calls;
}

async function openAdmin(page, { token = '' } = {}) {
  const errors = watchErrors(page);
  const asked = await firestore(page, { posts: POSTS });
  const gh = await github(page);
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await page.addInitScript(STUB);
  await page.addInitScript((t) => {
    if (sessionStorage.getItem('blog-test-init')) return;
    sessionStorage.setItem('blog-test-init', '1');
    localStorage.removeItem('blog.draft.v1');
    if (t) localStorage.setItem('xp.githubToken', t); else localStorage.removeItem('xp.githubToken');
  }, token);
  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  await page.locator('.tab[data-tab="blog"]').click();
  await expect(page.locator('#blogAdmin .post-item')).toHaveCount(5);
  return { errors, asked, gh };
}
const writes = (page) => page.evaluate(() => window.__fsWrites);

test('admin: every post in one list, read with the owner’s sign-in, filtered by type', async ({ page }) => {
  const { errors, asked } = await openAdmin(page);
  const list = asked.find((a) => a.url.pathname.endsWith('/documents/posts'));
  expect(list.auth).toBe('Bearer test-id-token');
  await expect(page.locator('.bl-chip')).toHaveText(['All5', 'Tech2', 'Poetry2', 'Makha-bhat0', 'Recipe1']);
  await page.locator('.bl-chip', { hasText: 'Poetry' }).click();
  await expect(page.locator('#blogAdmin .post-item-title')).toHaveText(['চিত্ত যেথা ভয়শূন্য', 'Without Fear']);
  await expect(page.locator('#blogAdmin .post-item').first().getByRole('link', { name: 'View' })).toHaveAttribute('href', '/blog/chitta-jetha.html');
  await page.locator('.bl-chip', { hasText: 'Makha-bhat' }).click();
  await expect(page.locator('#blogAdmin')).toContainText('No Makha-bhat posts yet.');
  await expect(page.locator('#blogAdmin')).not.toContainText('null');
  expect(errors).toEqual([]);
});

test('admin: a new poem is previewed on the real post page, published, then put on the site', async ({ page }) => {
  const { errors, gh } = await openAdmin(page, { token: TOKEN });
  await page.getByRole('button', { name: '+ New post' }).click();
  await page.getByText('Poetry', { exact: true }).click();
  await expect(page.locator('.bl-panel[data-for="poetry"]')).toBeVisible();
  await expect(page.locator('.bl-panel[data-for="recipe"]')).toBeHidden();
  await page.getByLabel('Title').fill('Rain on Tin');
  await page.getByLabel('Poem').fill('First line of rain\nsecond line of tin\n\n    an indented third');
  await expect(page.getByLabel('Shown on the blog page')).toHaveValue('First line of rain\nsecond line of tin');
  await expect(page.locator('.bl-panel[data-for="poetry"]')).toContainText('3 lines');

  await page.locator('.btn-row').getByRole('button', { name: 'Preview' }).click();
  const frame = page.frameLocator('.xp-frame');
  await expect(frame.locator('.poem .ln')).toHaveCount(3);
  await expect(frame.locator('.article-title')).toHaveText('Rain on Tin');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.locator('.btn-row').getByRole('button', { name: 'Publish' }).click();
  const notice = page.locator('.bl-notice');
  await expect(notice).toContainText('Published “Rain on Tin”. Putting it on the site');
  await expect(notice.getByRole('link', { name: 'Read it now' })).toHaveAttribute('href', '/blog-post.html?id=rain-on-tin&live');
  const [w] = await writes(page);
  expect(w.op).toBe('set');
  expect(w.path).toBe('posts/rain-on-tin');
  expect(w.data).toMatchObject({
    type: 'poetry', title: 'Rain on Tin', lang: 'en', author: 'Navajit D', readTime: '3 lines', note: '',
    poem: 'First line of rain\nsecond line of tin\n\n    an indented third', excerpt: 'First line of rain\nsecond line of tin',
    updatedAt: { __serverTimestamp: true }, createdAt: { __serverTimestamp: true },
  });
  expect(w.data.date.__ts).toMatch(/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/);
  expect(Object.keys(w.data)).not.toContain('html');
  expect(Object.keys(w.data)).not.toContain('slug');
  expect(await page.evaluate(() => localStorage.getItem('blog.draft.v1'))).toBeNull();

  // The deploy: one dispatch with the saved token, naming no post; then the run is followed until it is live.
  const dispatch = gh.filter((c) => c.method === 'POST');
  expect(dispatch).toEqual([{ method: 'POST', path: '/repos/NavajitD/navajitd.github.io/dispatches', body: '{"event_type":"blog-publish"}', auth: `Bearer ${TOKEN}` }]);
  await expect(notice).toContainText('It’s on the site: Rain on Tin.', { timeout: 20_000 });
  await expect(notice.getByRole('link', { name: 'Rain on Tin' })).toHaveAttribute('href', '/blog/rain-on-tin.html');
  expect(errors).toEqual([]);
});

test('admin: without the GitHub connection, a post waits for the next scheduled deploy', async ({ page }) => {
  const { gh } = await openAdmin(page);
  await page.getByRole('button', { name: '+ New post' }).click();
  await page.getByText('Makha-bhat', { exact: true }).click();
  await page.getByLabel('Title').fill('A short story');
  await page.getByRole('textbox', { name: 'Text of the post' }).fill('Once there was a lentil.');
  await page.locator('.btn-row').getByRole('button', { name: 'Publish' }).click();
  const notice = page.locator('.bl-notice');
  await expect(notice).toContainText('Published “A short story”. It goes on the site with the next update, within 6 hours.');
  await expect(notice.getByRole('button', { name: 'Connect GitHub' })).toBeVisible();
  expect(gh).toEqual([]);
  await notice.getByRole('button', { name: 'Connect GitHub' }).click();
  await expect(page.locator('dialog.xp-dialog')).toContainText('Connect GitHub once, and every post you publish goes on the site within a minute.');
});

test('admin: deleting a post takes it off the site too', async ({ page }) => {
  const { gh } = await openAdmin(page, { token: TOKEN });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete “An older essay”' }).click();
  const notice = page.locator('.bl-notice');
  await expect(notice).toContainText('Deleted “An older essay”. Taking it off the site');
  expect(await writes(page)).toEqual([{ op: 'delete', path: 'posts/Q9legacyId0' }]);
  expect(gh.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual(['{"event_type":"blog-publish"}']);
  await expect(notice).toContainText('It’s off the site.', { timeout: 20_000 });
});

test('admin: a recipe needs its ingredients and method, and saves its photos', async ({ page }) => {
  await openAdmin(page, { token: TOKEN });
  await page.getByRole('button', { name: '+ New post' }).click();
  await page.getByText('Recipe', { exact: true }).click();
  await page.getByLabel('Title').fill('Aloo posto');
  await page.locator('.btn-row').getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('.xp-errors')).toContainText('List the ingredients, one per line.');
  await expect(page.locator('.xp-errors')).toContainText('Write the method, one step per line.');
  await page.getByLabel('Description').fill('Potatoes in poppy seed paste.');
  await page.getByLabel('Ingredients').fill('3 potatoes\nFor the paste:\n3 tbsp poppy seeds');
  await page.getByLabel('Method').fill('Soak the seeds.\nGrind and cook.');
  await page.locator('.bl-panel[data-for="recipe"] input[type=file]:not([multiple])').setInputFiles({
    name: 'hero.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL.split(',')[1], 'base64'),
  });
  await expect(page.locator('.img-thumb.hero')).toHaveCount(1);
  await page.locator('.btn-row').getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('.bl-notice')).toContainText('Published “Aloo posto”.');
  const [w] = await writes(page);
  expect(w.path).toBe('posts/aloo-posto');
  expect(w.data).toMatchObject({
    type: 'recipe', excerpt: 'Potatoes in poppy seed paste.', ingredients: ['3 potatoes', 'For the paste:', '3 tbsp poppy seeds'],
    steps: ['Soak the seeds.', 'Grind and cook.'], hasHero: true, galleryCount: 0, images: [],
  });
  expect(w.data.heroImage).toMatch(/^data:image\/(webp|jpeg);base64,/);
});

test('admin: editing keeps the id, creation date and address; a slug already taken gets a number', async ({ page }) => {
  await openAdmin(page, { token: TOKEN });
  await page.getByRole('button', { name: 'Edit “Without Fear”' }).click();
  await expect(page.getByLabel('Poem')).toHaveValue('Where the mind is without fear\nand the head is held high;');
  await expect(page.locator('input[name="blType"][value="poetry"]')).toBeChecked();
  await page.getByLabel('Note (optional)').fill('After Tagore, Gitanjali 35.');
  await page.locator('.btn-row').getByRole('button', { name: 'Update post' }).click();
  await expect(page.locator('.bl-notice')).toContainText('Updated “Without Fear”.');
  let [w] = await writes(page);
  expect(w.path).toBe('posts/without-fear');
  expect(w.data.note).toBe('After Tagore, Gitanjali 35.');
  expect(w.data.createdAt).toEqual({ __ts: '2026-11-07T08:30:00.000Z' });
  expect(w.data.date).toEqual({ __ts: '2026-11-07T00:00:00.000Z' });

  // An older post with a random id keeps the address of its first title.
  await page.evaluate(() => { window.__fsWrites.length = 0; });
  await page.getByRole('button', { name: 'Edit “An older essay”' }).click();
  await page.getByLabel('Title').fill('An older essay, revised');
  await page.locator('.btn-row').getByRole('button', { name: 'Update post' }).click();
  await expect(page.locator('.bl-notice')).toContainText('Updated “An older essay, revised”.');
  [w] = await writes(page);
  expect(w.path).toBe('posts/Q9legacyId0');
  expect(w.data.slug).toBe('an-older-essay');

  await page.evaluate(() => { window.__fsWrites.length = 0; window.__fsExisting = ['posts/musur-dal']; });
  await page.getByRole('button', { name: '+ New post' }).click();
  await page.getByText('Makha-bhat', { exact: true }).click();
  await page.getByLabel('Title').fill('Musur dal');
  await page.getByRole('textbox', { name: 'Text of the post' }).fill('A story about lentils.');
  await page.locator('.btn-row').getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('.bl-notice')).toContainText('Published “Musur dal”.');
  [w] = await writes(page);
  expect(w.path).toBe('posts/musur-dal-2');
  expect(w.data).toMatchObject({ type: 'makha-bhat', html: 'A story about lentils.', readTime: '1 min read', excerpt: 'A story about lentils.' });
});
