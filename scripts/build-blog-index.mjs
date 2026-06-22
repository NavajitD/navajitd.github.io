// Static site build for navajitd.github.io. Reads the public Firestore `posts`
// and `recipes` collections over REST (public read — no service-account key) and
// generates everything crawlers need to see content without running JS:
//
//   • posts.json            — blog list index read by blog.html (now incl. slug)
//   • blog/<slug>.html      — a real static page per post (title, meta, canonical,
//                             OpenGraph article tags, BlogPosting JSON-LD, body)
//   • recipes.html          — recipe cards + Recipe JSON-LD injected between
//                             <!-- @prerender:* --> markers (no-op while empty)
//   • sitemap.xml           — home, projects, blog, recipes + every post URL
//
// Regenerate after publishing:  npm run build:blog
// A GitHub Action (.github/workflows/blog-index.yml) also runs this on a schedule
// and on manual dispatch, committing whatever changed.

import { writeFile, readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT = 'recipes-7dc22';
const API_KEY = 'AIzaSyCM8XiZ9tLn7jtVNcx0D6iZwYOGXBOLdjU';
const SITE = 'https://navajitd.github.io';
const OG_IMAGE = `${SITE}/og-image.png`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_JSON = join(ROOT, 'posts.json');
const SITEMAP = join(ROOT, 'sitemap.xml');
const BLOG_DIR = join(ROOT, 'blog');
const BLOG_POST_TEMPLATE = join(ROOT, 'blog-post.html'); // styling single-source
const RECIPES_FILE = join(ROOT, 'recipes.html');

// ─── Firestore REST helpers ─────────────────────────────────────────────────
function val(f) {
  if (f == null) return '';
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.timestampValue !== undefined) return f.timestampValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.doubleValue !== undefined) return f.doubleValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.arrayValue !== undefined) return (f.arrayValue.values || []).map(val);
  if (f.nullValue !== undefined) return '';
  return '';
}
const arr = (f) => {
  const v = val(f);
  return Array.isArray(v) ? v.filter((x) => x != null && String(x).trim() !== '') : v ? [v] : [];
};

async function fetchCollection(name) {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${name}`
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

// ─── Text helpers ───────────────────────────────────────────────────────────
const attr = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Embed JSON-LD safely inside <script> (prevent </script> / HTML-comment breakout).
const jsonLd = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

function slugify(s, max = 70) {
  let base = String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length > max) {
    base = base.slice(0, max);
    const cut = base.lastIndexOf('-');
    if (cut > 0) base = base.slice(0, cut); // drop the partial trailing word
    base = base.replace(/-+$/, '');
  }
  return base;
}

// Stable, collision-free slugs across all posts.
function assignSlugs(posts) {
  const seen = new Map();
  for (const p of posts) {
    let base = slugify(p.title) || p.id.toLowerCase();
    let slug = base;
    if (seen.has(slug)) slug = `${base}-${p.id.slice(0, 6).toLowerCase()}`;
    seen.set(slug, true);
    p.slug = slug;
  }
  return posts;
}

// ─── Map Firestore docs → plain objects ─────────────────────────────────────
function toPost(doc) {
  const f = doc.fields || {};
  const id = doc.name.split('/').pop();
  const rawDate = val(f.date);
  return {
    id,
    title: val(f.title) || 'Untitled',
    date: rawDate ? new Date(rawDate).toISOString() : new Date().toISOString(),
    updated: val(f.updatedAt) ? new Date(val(f.updatedAt)).toISOString() : '',
    excerpt: val(f.excerpt) || '',
    readTime: val(f.readTime) || '',
    author: val(f.author) || 'Navajit D',
    html: val(f.html) || '',
  };
}

function toRecipe(doc) {
  const f = doc.fields || {};
  const id = doc.name.split('/').pop();
  const rawDate = val(f.date) || val(f.createdAt);
  return {
    id,
    title: val(f.title) || 'Untitled',
    description: val(f.description) || '',
    author: val(f.author) || 'Navajit D',
    date: rawDate ? new Date(rawDate).toISOString() : new Date().toISOString(),
    cuisine: val(f.cuisine) || '',
    difficulty: val(f.difficulty) || '',
    prepTime: val(f.prepTime) || '',
    cookTime: val(f.cookTime) || '',
    servings: val(f.servings) || '',
    tags: arr(f.tags),
    ingredients: arr(f.ingredients),
    steps: arr(f.steps),
    heroImage: val(f.heroImage) || '',
    images: arr(f.images),
  };
}

// ─── Blog post static pages ─────────────────────────────────────────────────
async function extractPostStyle() {
  const html = await readFile(BLOG_POST_TEMPLATE, 'utf8');
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : '';
}

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%232563eb;stop-opacity:1' /%3E%3Cstop offset='50%25' style='stop-color:%2316a34a;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%23ea580c;stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='6' fill='url(%23grad)'/%3E%3Ctext x='16' y='22' font-family='system-ui,-apple-system,sans-serif' font-size='16' font-weight='500' text-anchor='middle' fill='white'%3EN%3C/text%3E%3C/svg%3E";

function buildPostPage(post, style) {
  const url = `${SITE}/blog/${post.slug}.html`;
  const title = `${post.title} — Navajit D`;
  const desc = post.excerpt || `An essay by ${post.author}.`;
  const modified = post.updated || post.date;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt || undefined,
    datePublished: post.date,
    dateModified: modified,
    author: { '@type': 'Person', name: post.author, url: `${SITE}/` },
    publisher: { '@type': 'Person', name: 'Navajit D', url: `${SITE}/` },
    image: OG_IMAGE,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,300..900;1,8..60,300..900&display=swap" rel="stylesheet">
    <link rel="icon" type="image/svg+xml" href="${FAVICON}">
    <title>${text(title)}</title>

    <!-- SEO -->
    <meta name="description" content="${attr(desc)}">
    <meta name="author" content="${attr(post.author)}">
    <meta name="theme-color" content="#2563eb">
    <link rel="canonical" href="${url}">

    <!-- Open Graph -->
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Navajit D">
    <meta property="og:title" content="${attr(post.title)}">
    <meta property="og:description" content="${attr(desc)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${OG_IMAGE}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Navajit D — AI Product Manager">
    <meta property="article:published_time" content="${post.date}">
    <meta property="article:modified_time" content="${modified}">
    <meta property="article:author" content="${attr(post.author)}">

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:site" content="@solitary_nav">
    <meta name="twitter:creator" content="@solitary_nav">
    <meta name="twitter:title" content="${attr(post.title)}">
    <meta name="twitter:description" content="${attr(desc)}">
    <meta name="twitter:image" content="${OG_IMAGE}">

    <script type="application/ld+json">
${jsonLd(ld)}
    </script>
    <script defer src="/analytics.js"></script>
    <style>${style}</style>
</head>
<body>
    <div class="topbar" id="topbar">
        <div class="topbar-inner">
            <a href="/blog.html" class="topbar-back">
                <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> All posts
            </a>
            <a href="/" class="topbar-home">Home</a>
        </div>
    </div>

    <article class="article-container">
        <header class="article-header">
            <h1 class="article-title">${text(post.title)}</h1>
            <div class="article-meta">
                <span class="article-author">${text(post.author)}</span>
                <span class="article-meta-divider"></span>
                <span>${text(fmtDate(post.date))}</span>
                ${post.readTime ? `<span class="article-meta-divider"></span>\n                <span>${text(post.readTime)}</span>` : ''}
            </div>
        </header>
        <div class="article-body">${post.html}</div>
    </article>
    <!-- read-till-end sentinel (observed by analytics.js) -->
    <div id="articleEnd" style="height:1px"></div>

    <footer class="post-footer" style="display:flex">
        <div class="footer-links">
            <a href="https://github.com/navajitd">GitHub</a>
            <a href="https://linkedin.com/in/navjit-debnath-34b1b5191">LinkedIn</a>
            <a href="https://instagram.com/nav.jit">Instagram</a>
            <a href="https://twitter.com/solitary_nav">Twitter</a>
            <a href="mailto:navjitdebnath5@gmail.com">Email</a>
        </div>
        <div>© 2025 Navajit D</div>
    </footer>

    <script>
      window.__nvPostReadyId = ${JSON.stringify(post.id)};
      (function () {
        var t = document.getElementById('topbar');
        addEventListener('scroll', function () { t.classList.toggle('scrolled', scrollY > 8); }, { passive: true });
      })();
    </script>
</body>
</html>
`;
}

async function writePostPages(posts, style) {
  await mkdir(BLOG_DIR, { recursive: true });
  // Remove stale generated pages so deletes/renames don't leave orphans.
  for (const f of await readdir(BLOG_DIR)) {
    if (f.endsWith('.html')) await unlink(join(BLOG_DIR, f));
  }
  for (const p of posts) {
    await writeFile(join(BLOG_DIR, `${p.slug}.html`), buildPostPage(p, style));
  }
}

// ─── Recipes (Recipe JSON-LD + baked cards, injected via markers) ────────────
function isoDuration(s) {
  if (!s) return null;
  const t = String(s).toLowerCase();
  let h = 0, m = 0, mt;
  if ((mt = t.match(/(\d+)\s*h/))) h = +mt[1];
  if ((mt = t.match(/(\d+)\s*m/))) m = +mt[1];
  if (!h && !m) { const n = t.match(/(\d+)/); if (n) m = +n[1]; }
  if (!h && !m) return null;
  return 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '');
}

function recipeJsonLd(recipes) {
  if (!recipes.length) return '';
  const graph = recipes.map((r) => {
    const o = {
      '@type': 'Recipe',
      name: r.title,
      description: r.description || undefined,
      author: { '@type': 'Person', name: r.author },
      datePublished: r.date,
      recipeCuisine: r.cuisine || undefined,
      recipeCategory: r.tags[0] || undefined,
      keywords: r.tags.length ? r.tags.join(', ') : undefined,
      recipeYield: r.servings || undefined,
      prepTime: isoDuration(r.prepTime) || undefined,
      cookTime: isoDuration(r.cookTime) || undefined,
      recipeIngredient: r.ingredients.length ? r.ingredients : undefined,
      recipeInstructions: r.steps.length
        ? r.steps.map((s) => ({ '@type': 'HowToStep', text: s }))
        : undefined,
      image: /^https?:\/\//.test(r.heroImage) ? r.heroImage : undefined,
    };
    return o;
  });
  const ld = { '@context': 'https://schema.org', '@graph': graph };
  return `<script type="application/ld+json">\n${jsonLd(ld)}\n    </script>`;
}

function recipeCards(recipes) {
  if (!recipes.length) return '';
  return recipes
    .map((r) => {
      const meta = [r.prepTime, r.cookTime].filter(Boolean).join(' + ');
      const tags = (r.cuisine ? [r.cuisine] : [])
        .concat(r.tags)
        .slice(0, 3)
        .map((t) => `<span class="tag">${text(t)}</span>`)
        .join('');
      return `<article class="recipe-card">
                <div class="card-body">
                    <h2 class="card-title">${text(r.title)}</h2>
                    ${meta ? `<div class="card-meta"><span>${text(meta)}</span></div>` : ''}
                    ${r.description ? `<p>${text(r.description)}</p>` : ''}
                    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
                </div>
            </article>`;
    })
    .join('\n            ');
}

function injectBetween(html, marker, content) {
  if (!content) return html; // nothing to inject (e.g. 0 recipes) → leave page as-is
  const re = new RegExp(`(<!-- @prerender:${marker}-start -->)([\\s\\S]*?)(<!-- @prerender:${marker}-end -->)`);
  if (!re.test(html)) return html; // markers absent → skip silently
  return html.replace(re, `$1\n    ${content}\n    $3`);
}

async function injectRecipes(recipes) {
  let html = await readFile(RECIPES_FILE, 'utf8');
  const before = html;
  html = injectBetween(html, 'recipes-jsonld', recipeJsonLd(recipes));
  html = injectBetween(html, 'recipes-cards', recipeCards(recipes));
  if (html !== before) {
    await writeFile(RECIPES_FILE, html);
    return true;
  }
  return false;
}

// ─── sitemap.xml (stable — no per-build date churn) ─────────────────────────
function buildSitemap(posts) {
  const staticPages = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/projects.html`, priority: '0.8' },
    { loc: `${SITE}/blog.html`, priority: '0.8' },
    { loc: `${SITE}/recipes.html`, priority: '0.6' },
  ];
  const postPages = posts.map((p) => ({
    loc: `${SITE}/blog/${p.slug}.html`,
    lastmod: ymd(p.updated || p.date),
    priority: '0.7',
  }));
  const body = [...staticPages, ...postPages]
    .map((u) => {
      const lm = u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '';
      return `  <url>\n    <loc>${xmlEsc(u.loc)}</loc>${lm}\n    <priority>${u.priority}</priority>\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// posts.json without churn: only rewrite when the post list content changes
// (ignore the generatedAt timestamp), so scheduled builds don't make empty commits.
async function writePostsJson(listPosts) {
  let prev = null;
  try {
    prev = JSON.parse(await readFile(POSTS_JSON, 'utf8'));
  } catch {}
  if (prev && JSON.stringify(prev.posts) === JSON.stringify(listPosts)) {
    return false; // unchanged
  }
  await writeFile(POSTS_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), posts: listPosts }, null, 0) + '\n');
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────
const [postDocs, recipeDocs] = await Promise.all([fetchCollection('posts'), fetchCollection('recipes')]);

const posts = assignSlugs(postDocs.map(toPost).sort((a, b) => new Date(b.date) - new Date(a.date)));
const recipes = recipeDocs.map(toRecipe).sort((a, b) => new Date(b.date) - new Date(a.date));

// posts.json keeps only the fields blog.html needs (now incl. slug) — not the body.
const listPosts = posts.map(({ id, slug, title, date, excerpt, readTime }) => ({
  id, slug, title, date, excerpt, readTime,
}));

const style = await extractPostStyle();

const wrotePosts = await writePostsJson(listPosts);
await writePostPages(posts, style);
const wroteRecipes = await injectRecipes(recipes);
await writeFile(SITEMAP, buildSitemap(posts));

console.log(`✓ posts.json ${wrotePosts ? 'updated' : 'unchanged'} (${posts.length} posts)`);
console.log(`✓ blog/ pages written (${posts.length})`);
console.log(`✓ recipes.html ${wroteRecipes ? 'updated' : 'unchanged'} (${recipes.length} recipes)`);
console.log(`✓ sitemap.xml written (${posts.length + 4} urls)`);
