// Builds posts.json — a tiny, static, CDN-cacheable index of the blog post list —
// and sitemap.xml, so both stay current as posts are published.
//
// The blog list page (blog.html) reads posts.json directly instead of loading the
// ~370 KB Firebase SDK on every visit. Regenerate after publishing a post:
//   npm run build:blog
// A GitHub Action (.github/workflows/blog-index.yml) also runs this on a schedule
// and on manual dispatch, committing posts.json / sitemap.xml when they change.
//
// Reads the public `posts` collection from Firestore over REST (public read), so
// no service-account key is needed.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT = 'recipes-7dc22';
const API_KEY = 'AIzaSyCM8XiZ9tLn7jtVNcx0D6iZwYOGXBOLdjU';
const COLLECTION = 'posts';
const SITE = 'https://navajitd.github.io';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'posts.json');
const SITEMAP_OUT = join(ROOT, 'sitemap.xml');

// Unwrap a Firestore REST typed value into a plain JS value.
function val(f) {
  if (f == null) return '';
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.timestampValue !== undefined) return f.timestampValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.doubleValue !== undefined) return f.doubleValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.nullValue !== undefined) return null;
  return '';
}

async function fetchAll() {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${COLLECTION}`
    );
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore REST ${res.status}: ${await res.text()}`);
    const data = await res.json();
    (data.documents || []).forEach((d) => docs.push(d));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function toPost(doc) {
  const f = doc.fields || {};
  const id = doc.name.split('/').pop();
  const rawDate = val(f.date);
  const date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();
  return {
    id,
    title: val(f.title) || 'Untitled',
    date,
    excerpt: val(f.excerpt) || '',
    readTime: val(f.readTime) || '',
  };
}

// ─── sitemap.xml ────────────────────────────────────────────────────────────
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildSitemap(posts) {
  const today = ymd(new Date());
  const blogMod = posts[0] ? ymd(posts[0].date) : today;
  const pages = [
    { loc: `${SITE}/`, lastmod: today, priority: '1.0' },
    { loc: `${SITE}/projects.html`, lastmod: today, priority: '0.8' },
    { loc: `${SITE}/blog.html`, lastmod: blogMod, priority: '0.8' },
    { loc: `${SITE}/recipes.html`, lastmod: today, priority: '0.6' },
    ...posts.map((p) => ({
      loc: `${SITE}/blog-post.html?id=${p.id}`,
      lastmod: ymd(p.date),
      priority: '0.7',
    })),
  ];
  const body = pages
    .map(
      (u) =>
        `  <url>\n    <loc>${xmlEsc(u.loc)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

const docs = await fetchAll();
const posts = docs
  .map(toPost)
  .sort((a, b) => new Date(b.date) - new Date(a.date));

await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), posts }, null, 0) + '\n');
console.log(`✓ Wrote ${posts.length} posts to posts.json`);

await writeFile(SITEMAP_OUT, buildSitemap(posts));
console.log(`✓ Wrote sitemap.xml (${posts.length + 4} urls)`);
