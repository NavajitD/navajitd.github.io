// Builds posts.json — a tiny, static, CDN-cacheable index of the blog post list.
//
// The blog list page (blog.html) reads this file directly instead of loading the
// ~370 KB Firebase SDK on every visit. Regenerate after publishing a post:
//   npm run build:blog
// A GitHub Action (.github/workflows/blog-index.yml) also runs this on a schedule
// and on manual dispatch, committing posts.json when it changes.
//
// Reads the public `posts` collection from Firestore over REST (public read), so
// no service-account key is needed.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT = 'numo-3984a';
const API_KEY = 'AIzaSyCuJBqQWKpbhj3FEYpg_p_nhbjTEFg8Lt4';
const COLLECTION = 'posts';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'posts.json');

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

const docs = await fetchAll();
const posts = docs
  .map(toPost)
  .sort((a, b) => new Date(b.date) - new Date(a.date));

await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), posts }, null, 0) + '\n');
console.log(`✓ Wrote ${posts.length} posts to posts.json`);
