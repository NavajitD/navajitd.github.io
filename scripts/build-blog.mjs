// Builds the blog into the site that GitHub Pages deploys, from Firestore.
//
// The writing lives only in Firestore (project recipes-7dc22, collection
// `posts`), never in this repository: the owner keeps it out of the public
// repo. The deploy workflow (.github/workflows/deploy.yml) builds the
// repository with Jekyll into _site, as GitHub Pages always did, then runs
// this script, which writes inside that directory only:
//   blog.html              every post as a card (the page filters them by section)
//   blog/<slug>.html       a static page per post, with its own title, description and share tags
//   blog/media/<slug>/…    the post's images, as files
//   blog-post.html         which ids have a static page (old ?id= links go there)
//   sitemap.xml, llms.txt  the posts added
// The workflow deploys _site without committing it, then deletes the upload.
//
//   node scripts/build-blog.mjs --site _site
//   node scripts/build-blog.mjs --site <dir> --docs <file>   posts from a saved Firestore REST list (tests)
//
// Listing posts needs credentials (firestore.rules lets only the owner list
// them). FIRESTORE_TOKEN is an OAuth access token: the workflow gets one for
// a read-only service account through Workload Identity Federation. Locally,
// as the project's owner:
//   FIRESTORE_TOKEN=$(gcloud auth print-access-token) FIRESTORE_QUOTA_PROJECT=recipes-7dc22 \
//     node scripts/build-blog.mjs --site <a copy of the site>
// Logs give counts only, never titles: the workflow's logs are public.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  API_KEY, DOCS, SITE, TYPES, SLUG_RE, typeName, normalize, newestFirst, fromRest, postSlug, postUrl,
  cardHtml, articleHtml, postHeadHtml, mediaSources, ldJson, fmtDate,
} from '../blog-core.js';

// ─── Reading Firestore ──────────────────────────────────────────────────────
/** Every document in `posts`, page by page, as Firestore REST returns them. */
export async function fetchDocs({
  token = process.env.FIRESTORE_TOKEN,
  quotaProject = process.env.FIRESTORE_QUOTA_PROJECT,
  fetchFn = fetch,
} = {}) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${DOCS}/posts?pageSize=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}${token ? '' : `&key=${API_KEY}`}`;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (quotaProject) headers['x-goog-user-project'] = quotaProject;
    const r = await fetchFn(url, { headers });
    if (!r.ok) {
      const why = r.status === 401 || r.status === 403 ? ': not allowed to list posts. Is FIRESTORE_TOKEN set, and does its account have Firestore read access?' : '';
      throw new Error(`Firestore answered ${r.status} when listing posts${why}`);
    }
    const page = await r.json();
    docs.push(...(page.documents || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return docs;
}

// ─── Pieces ─────────────────────────────────────────────────────────────────
/**
 * Every post gets a page address. A post whose id is a slug keeps it; an
 * older post with a random id takes the slug of its title, and gives way
 * (with -2, -3…) if a newer post already has that address.
 */
export function assignSlugs(posts) {
  const owns = (p) => SLUG_RE.test(p.id) && postSlug(p) === p.id;
  const taken = new Set();
  for (const p of [...posts].sort((a, b) => Number(owns(b)) - Number(owns(a)))) {
    const base = postSlug(p);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    p.slug = slug;
  }
  return posts;
}

const IMAGE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/avif': 'avif' };

/** Write a post's images (stored as data URLs) to files; returns slot → address. */
export async function writeMedia(site, p) {
  const src = {};
  for (const [key, value] of Object.entries(mediaSources(p))) {
    const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value));
    if (!m) {
      if (/^https:\/\//.test(value)) src[key] = value;
      continue;
    }
    const ext = IMAGE_TYPES[m[1]];
    if (!ext) continue;
    const bytes = Buffer.from(m[2], 'base64');
    const name = `${key}-${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.${ext}`;
    const dir = join(site, 'blog', 'media', p.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
    src[key] = `/blog/media/${p.slug}/${name}`;
  }
  return src;
}

/** The share image: a recipe's photo, else an essay's first picture, else the site's card. */
export const shareImage = (src) => {
  const path = src.hero || src['0'] || src.g0;
  return path ? (path.startsWith('/') ? `${SITE}${path}` : path) : undefined;
};

// ─── Fonts ──────────────────────────────────────────────────────────────────
// The pages' Google Fonts link names every family any post might need (seven
// on blog-post.html). A static page asks only for the ones it shows, which
// made an essay readable about 40 ms sooner at Slow 4G.

/** Font families a post's page shows. */
export function postFonts(p) {
  const need = new Set(['Inconsolata']); // top bar, dates, footer
  if (p.type === 'poetry') {
    need.add('EB Garamond');
    if (p.lang === 'bn') need.add('Tiro Bangla');
    if (p.lang === 'hi') need.add('Tiro Devanagari Hindi');
  } else {
    need.add('Source Serif 4');
    if (p.lang === 'bn') need.add('Noto Serif Bengali');
    if (p.lang === 'hi') need.add('Noto Serif Devanagari');
  }
  return need;
}

/** Font families the list of posts shows: Anek for Bengali and Hindi titles, the poem serifs for poems' opening lines. */
export function listFonts(posts) {
  const need = new Set(['Inconsolata']);
  for (const p of posts) {
    if (p.lang === 'bn') need.add('Anek Bangla');
    if (p.lang === 'hi') need.add('Anek Devanagari');
    if (p.type === 'poetry') need.add({ bn: 'Tiro Bangla', hi: 'Tiro Devanagari Hindi' }[p.lang] || 'EB Garamond');
  }
  return need;
}

/** Keep only `families` in every Google Fonts link of a page (each family keeps its styles). */
export function onlyFonts(html, families) {
  return html.replace(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/g, (url) => {
    const parts = url.slice(url.indexOf('?') + 1).split('&amp;');
    const keep = parts.filter((part) => !part.startsWith('family=') || families.has(part.slice(7).split(':')[0].replace(/\+/g, ' ')));
    return `https://fonts.googleapis.com/css2?${keep.join('&amp;')}`;
  });
}

/** Replace one marked part of a page; a missing marker is an error (the template changed). */
function swap(html, find, to, what, file) {
  const found = typeof find === 'string' ? html.includes(find) : html.search(find) !== -1;
  if (!found) throw new Error(`${file}: ${what} not found. Did the page's markup change?`);
  // A replacer function: a post's text may contain "$&" or "$1", which a replacement string would expand.
  return typeof find === 'string' ? html.split(find).join(to) : html.replace(find, () => to);
}

const LIVE = /[ \t]*<!-- @live -->[\s\S]*?<!-- \/@live -->\n?/g;
const META = /[ \t]*<!-- @meta[\s\S]*?-->[\s\S]*?<!-- \/@meta -->\n/;

/** A post's static page, from blog-post.html. */
export function postPage(template, post, { src = {}, image } = {}) {
  const p = normalize(post);
  const f = 'blog-post.html';
  let html = template;
  html = swap(html, LIVE, '', 'the <!-- @live --> parts', f);
  html = swap(html, META, postHeadHtml(p, { image }), 'the <!-- @meta --> block', f);
  html = swap(html, '<article class="article-container" id="article" hidden></article>',
    `<article class="article-container is-${p.type}" id="article">${articleHtml(p, { src })}</article>`, 'the empty <article>', f);
  html = swap(html, '<footer class="post-footer" id="postFooter" hidden>', '<footer class="post-footer" id="postFooter">', 'the hidden footer', f);
  html = swap(html, '<a href="/blog.html" class="topbar-back" id="backLink">', `<a href="/blog.html#${p.type}" class="topbar-back" id="backLink">`, 'the back link', f);
  html = swap(html, '<span id="backLabel">Blog</span>', `<span id="backLabel">${typeName(p.type)}</span>`, 'the back label', f);
  return onlyFonts(html, postFonts(p));
}

/** Structured data for blog.html: the blog and its posts. */
export const blogLd = (posts) => ({
  '@context': 'https://schema.org',
  '@type': 'Blog',
  name: 'Blog - Navajit D',
  url: `${SITE}/blog.html`,
  author: { '@type': 'Person', name: 'Navajit D', url: `${SITE}/` },
  blogPost: posts.map((p) => ({
    '@type': 'BlogPosting',
    headline: p.title,
    url: postUrl(p),
    datePublished: p.date || undefined,
    articleSection: typeName(p.type),
    inLanguage: p.lang,
  })),
});

const day = (p) => (p.updatedAt || p.updateTime || p.date || '').slice(0, 10);

export function sitemapWith(xml, posts) {
  const urls = posts.map((p) => `  <url>\n    <loc>${postUrl(p)}</loc>\n${day(p) ? `    <lastmod>${day(p)}</lastmod>\n` : ''}  </url>\n`).join('');
  return swap(xml, '</urlset>', `${urls}</urlset>`, '</urlset>', 'sitemap.xml');
}

export function llmsWith(text, posts) {
  if (!posts.length) return text;
  const md = (s) => String(s).replace(/([\\[\]])/g, '\\$1');
  const section = `## Writing\n${posts.map((p) => `- [${md(p.title)}](${postUrl(p)}): ${typeName(p.type)}, ${fmtDate(p.date)}`).join('\n')}\n\n`;
  return text.includes('\n## Contact') ? text.replace('\n## Contact', () => `\n${section}## Contact`) : `${text.replace(/\n*$/, '\n\n')}${section}`;
}

// ─── The build ──────────────────────────────────────────────────────────────
/** Build the blog into `site` (a Jekyll output directory) from Firestore REST documents. */
export async function buildBlog({ site, docs }) {
  site = resolve(site);
  if (existsSync(join(site, '.git'))) {
    throw new Error(`${site} is a git checkout. Build into the deploy output (_site), never into the repository.`);
  }
  const read = (f) => readFile(join(site, f), 'utf8');
  const write = (f, text) => writeFile(join(site, f), text);
  const posts = assignSlugs(newestFirst(docs.map(fromRest)));

  await rm(join(site, 'blog'), { recursive: true, force: true });
  await mkdir(join(site, 'blog'), { recursive: true });
  const template = await read('blog-post.html');
  let images = 0;
  for (const p of posts) {
    const src = await writeMedia(site, p);
    images += Object.keys(src).length;
    await write(`blog/${p.slug}.html`, postPage(template, p, { src, image: shareImage(src) }));
  }

  const slugs = Object.fromEntries(posts.map((p) => [p.id, p.slug]));
  await write('blog-post.html', swap(template, '<script type="application/json" id="blogSlugs">{}</script>',
    `<script type="application/json" id="blogSlugs">${ldJson(slugs)}</script>`, 'the id → slug list', 'blog-post.html'));

  let list = await read('blog.html');
  list = swap(list, '<!-- @blog:cards -->', posts.map(cardHtml).join(''), 'the <!-- @blog:cards --> marker', 'blog.html');
  list = swap(list, '<!-- @blog:ld -->', `<script type="application/ld+json">${ldJson(blogLd(posts))}</script>`, 'the <!-- @blog:ld --> marker', 'blog.html');
  await write('blog.html', onlyFonts(list, listFonts(posts)));

  await write('sitemap.xml', sitemapWith(await read('sitemap.xml'), posts));
  await write('llms.txt', llmsWith(await read('llms.txt'), posts));

  const sections = Object.fromEntries(TYPES.map((t) => [t.name, posts.filter((p) => p.type === t.id).length]));
  return { posts: posts.length, images, sections };
}

// ─── Command line ───────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const site = opt('--site');
  if (!site) {
    console.error('Usage: node scripts/build-blog.mjs --site <Jekyll output dir> [--docs <Firestore REST list as JSON>]');
    process.exit(2);
  }
  try {
    const file = opt('--docs');
    const docs = file ? JSON.parse(await readFile(file, 'utf8')).documents || [] : await fetchDocs();
    const s = await buildBlog({ site, docs });
    const parts = Object.entries(s.sections).filter(([, n]) => n).map(([name, n]) => `${name} ${n}`).join(', ');
    console.log(`Blog: ${s.posts} post${s.posts === 1 ? '' : 's'}${parts ? ` (${parts})` : ''}, ${s.images} image${s.images === 1 ? '' : 's'}.`);
  } catch (e) {
    console.error(`Blog build failed: ${e.message}`);
    process.exit(1);
  }
}
