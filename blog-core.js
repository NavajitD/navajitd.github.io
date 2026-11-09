// The blog's shared parts, used by scripts/build-blog.mjs (which writes the
// blog into the deployed site), blog-post.html, 404.html, the admin console
// (admin-blog.js) and the unit tests.
//
// The posts themselves (essays, poems, recipes) live only in Firestore
// (project recipes-7dc22, collection `posts`). The deploy workflow reads them
// and builds static pages straight into the site it deploys; none of it is
// ever written into this repository: the owner keeps his writing out of the
// public repo. blog-post.html reads one post at a time from Firestore, for
// posts published since the last deploy and for the admin's preview.
//
// Pure functions only (no DOM, no Node APIs), so the tests can import it.

export const PROJECT = 'recipes-7dc22';
// The site's public Firebase web key: it names the project; the Firestore
// rules decide who may do what (posts: anyone may open one by id; only the
// owner, and the deploy build's read-only account, may list them; only the
// owner may write).
export const API_KEY = 'AIzaSyCM8XiZ9tLn7jtVNcx0D6iZwYOGXBOLdjU';
export const SITE = 'https://navajitd.github.io';
export const OG_IMAGE = `${SITE}/og-image.png`;
export const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

export const TYPES = [
  { id: 'tech', name: 'Tech' },
  { id: 'poetry', name: 'Poetry' },
  { id: 'makha-bhat', name: 'Makha-bhat' },
  { id: 'recipe', name: 'Recipe' },
];
// Posts from before the sections existed have no type; they are Tech.
export const DEFAULT_TYPE = 'tech';
export const LANGS = [
  { id: 'en', name: 'English' },
  { id: 'bn', name: 'বাংলা' },
  { id: 'hi', name: 'हिन्दी' },
];

export const typeOf = (p) => (TYPES.some((t) => t.id === p?.type) ? p.type : DEFAULT_TYPE);
export const typeName = (id) => (TYPES.find((t) => t.id === id) || TYPES[0]).name;
export const langOf = (p) => (LANGS.some((l) => l.id === p?.lang) ? p.lang : 'en');

// ─── Firestore REST ─────────────────────────────────────────────────────────
// The admin's list needs no bodies and no images.
export const LIST_FIELDS = ['type', 'title', 'date', 'excerpt', 'readTime', 'lang', 'prepTime', 'cookTime', 'servings'];
// Everything a post page shows except its images...
export const TEXT_FIELDS = [
  'type', 'title', 'author', 'date', 'updatedAt', 'lang', 'excerpt', 'readTime',
  'html', 'poem', 'note',
  'description', 'cuisine', 'difficulty', 'prepTime', 'cookTime', 'servings', 'tags', 'ingredients', 'steps', 'notes',
  'hasHero', 'galleryCount',
];
// ...which come in a second request, so the text never waits for them.
export const MEDIA_FIELDS = ['media', 'heroImage', 'images'];

const mask = (fields) => fields.map((f) => `&mask.fieldPaths=${f}`).join('');
/** One page of the posts list. Listing needs the owner's sign-in or the build's account (see firestore.rules). */
export const listUrl = ({ fields = LIST_FIELDS, pageSize = 300, pageToken = '' } = {}) =>
  `${DOCS}/posts?key=${API_KEY}&pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}${fields ? mask(fields) : ''}`;
export const docUrl = (id, fields) =>
  `${DOCS}/posts/${encodeURIComponent(id)}?key=${API_KEY}${fields ? mask(fields) : ''}`;

export function value(f) {
  if (f == null) return '';
  if ('stringValue' in f) return f.stringValue;
  if ('timestampValue' in f) return f.timestampValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(value);
  if ('mapValue' in f) return fields(f.mapValue.fields);
  return '';
}
const fields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, value(v)]));

/** A Firestore REST document as a plain object, with its id and last write time. */
export function fromRest(doc) {
  return { ...fields(doc.fields), id: String(doc.name || '').split('/').pop(), updateTime: doc.updateTime || '' };
}
export const fromList = (json) => (json?.documents || []).map(fromRest);

// ─── Text helpers ───────────────────────────────────────────────────────────
export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const str = (s) => (s == null ? '' : String(s)).trim();
const list = (a) => (Array.isArray(a) ? a : a ? [a] : []).map((x) => str(x)).filter(Boolean);

/** URL slug: new posts get slugify(title) as their id, and their page is /blog/<slug>.html. */
export function slugify(s, max = 70) {
  let base = String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length > max) {
    base = base.slice(0, max);
    const cut = base.lastIndexOf('-');
    if (cut > 0) base = base.slice(0, cut);
    base = base.replace(/-+$/, '');
  }
  return base;
}

/** Dates are stored as UTC midnight of the chosen day; show that day everywhere. */
export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
const isoDay = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

export const wordCount = (text) => String(text ?? '').split(/\s+/).filter(Boolean).length;
export const readTime = (text) => `${Math.max(1, Math.round(wordCount(text) / 200))} min read`;

/** Plain text to paragraphs: a blank line starts a new one, a line break stays a line break. */
export function paragraphs(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `<p>${esc(b).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Essays are HTML the admin already cleaned (cleanHtml in admin-blog.js), and
 * only the owner can write posts. The static pages run whatever is in them,
 * so drop anything active once more: scripts, frames, forms, event handlers
 * and javascript: links.
 */
export function stripActive(html) {
  return String(html ?? '')
    .replace(/<(script|style|iframe|object|embed|form|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|template|noscript|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src|xlink:href|formaction|action)\s*=\s*(["']?)\s*(?:javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi, '');
}

// ─── Poems ──────────────────────────────────────────────────────────────────
/** A poem's stanzas: blank lines separate them; leading spaces (an indent) are kept. */
export function stanzas(text) {
  const out = [];
  let cur = [];
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      if (cur.length) out.push(cur), (cur = []);
    } else cur.push(line);
  }
  if (cur.length) out.push(cur);
  return out;
}
export const poemLines = (text) => stanzas(text).flat();
export const poemExcerpt = (text, n = 2) => poemLines(text).slice(0, n).map((l) => l.trim()).join('\n');
export const lineCount = (text) => {
  const n = poemLines(text).length;
  return n === 1 ? '1 line' : `${n} lines`;
};

function poemHtml(p) {
  const body = stanzas(p.poem)
    .map((st) => {
      const lines = st
        .map((line) => {
          const lead = line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
          const indent = lead ? ` style="--indent:${Math.min(lead, 24)}"` : '';
          return `<span class="ln"${indent}>${esc(line.trim())}</span>`;
        })
        .join('');
      return `<p class="stanza">${lines}</p>`;
    })
    .join('');
  const note = str(p.note) ? `<div class="poem-note">${paragraphs(p.note)}</div>` : '';
  return body + note;
}

// ─── Recipes ────────────────────────────────────────────────────────────────
/** Ingredient lines; a line ending in a colon ("For the paste:") starts a group. */
export function ingredientGroups(lines) {
  const groups = [];
  let cur = { title: '', items: [] };
  for (const line of list(lines)) {
    if (/[:：]$/.test(line)) {
      if (cur.title || cur.items.length) groups.push(cur);
      cur = { title: line.replace(/[:：]$/, '').trim(), items: [] };
    } else cur.items.push(line);
  }
  if (cur.title || cur.items.length) groups.push(cur);
  return groups;
}

export function recipeFacts(p) {
  return [
    ['Prep', str(p.prepTime)],
    ['Cook', str(p.cookTime)],
    ['Serves', str(p.servings)],
    ['Level', str(p.difficulty)],
  ].filter(([, v]) => v);
}
/** The one-line summary on a recipe's card. */
export const recipeLine = (p) =>
  recipeFacts(p)
    .filter(([k]) => k !== 'Level')
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');

function recipeHtml(p) {
  const lead = str(p.description) ? `<div class="recipe-lead">${paragraphs(p.description)}</div>` : '';
  const hero = p.hasHero || p.heroImage
    ? `<figure class="recipe-hero"><img data-media="hero" alt="${esc(p.title)}" width="1280" height="800" decoding="async" fetchpriority="high"></figure>`
    : '';
  const groups = ingredientGroups(p.ingredients);
  const ingredients = groups.length
    ? '<h2>Ingredients</h2>' +
      groups
        .map((g) => (g.title ? `<h3>${esc(g.title)}</h3>` : '') + `<ul class="ingredients">${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`)
        .join('')
    : '';
  const steps = list(p.steps).length
    ? `<h2>Method</h2><ol class="steps">${list(p.steps).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
    : '';
  const notes = str(p.notes) ? `<h2>Notes</h2>${paragraphs(p.notes)}` : '';
  const count = Math.max(Number(p.galleryCount) || 0, Array.isArray(p.images) ? p.images.length : 0);
  const gallery = count
    ? `<div class="recipe-gallery">${Array.from({ length: count }, (_, i) => `<img data-media="g${i}" alt="" width="1000" height="1000" loading="lazy" decoding="async">`).join('')}</div>`
    : '';
  const tags = [str(p.cuisine), ...list(p.tags)].filter(Boolean);
  const tagLine = tags.length ? `<p class="recipe-tags">${tags.map(esc).join(' · ')}</p>` : '';
  return lead + hero + ingredients + steps + notes + gallery + tagLine;
}

// ─── Posts ──────────────────────────────────────────────────────────────────
/** A post with every field the pages read, defaults filled in. */
export function normalize(p) {
  const type = typeOf(p);
  return {
    ...p,
    id: str(p.id),
    type,
    lang: langOf(p),
    title: str(p.title) || 'Untitled',
    author: str(p.author) || 'Navajit D',
    date: isoDay(p.date) || isoDay(p.updateTime) || '',
    excerpt: str(p.excerpt) || (type === 'poetry' ? poemExcerpt(p.poem) : type === 'recipe' ? str(p.description) : ''),
    readTime: str(p.readTime) || (type === 'poetry' && p.poem ? lineCount(p.poem) : ''),
  };
}

/** Slugs are lowercase words joined by hyphens; new posts get one as their id. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The post's static page is /blog/<slug>.html. Older posts with random ids keep the slug of their title. */
export function postSlug(p) {
  if (SLUG_RE.test(str(p.slug))) return p.slug;
  if (SLUG_RE.test(str(p.id))) return p.id;
  return slugify(p.title) || slugify(p.id) || 'post';
}
export const postPath = (p) => `/blog/${postSlug(p)}.html`;
export const postUrl = (p) => `${SITE}${postPath(p)}`;
/** The page that reads a post from Firestore: for posts published since the last deploy, and previews. */
export const livePath = (p) => `/blog-post.html?id=${encodeURIComponent(p.id)}`;

const dateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');

const langAttr = (p) => (p.lang === 'en' ? '' : ` lang="${p.lang}"`);

/** A card on blog.html. The section name after the date shows only under All. */
export function cardHtml(post) {
  const p = normalize(post);
  const meta = p.type === 'recipe' ? recipeLine(p) : p.readTime;
  const excerpt = p.excerpt
    ? p.type === 'poetry'
      ? `<div class="blog-card-excerpt poem-lines">${esc(p.excerpt).replace(/\n/g, '<br>')}</div>`
      : `<div class="blog-card-excerpt">${esc(p.excerpt)}</div>`
    : '';
  return (
    `<a class="blog-card" href="${postPath(p)}" data-type="${p.type}"${langAttr(p)}>` +
    `<div class="blog-card-date" lang="en">${esc(fmtDate(p.date))}<span class="blog-card-section"> · ${typeName(p.type)}</span></div>` +
    `<div class="blog-card-title">${esc(p.title)}</div>` +
    excerpt +
    (meta ? `<div class="blog-card-reading" lang="en">${esc(meta)}</div>` : '') +
    '</a>'
  );
}

/** Posts newest first. */
export const newestFirst = (posts) => posts.map(normalize).sort(dateDesc);
/** Every post, newest first, as cards; blog.html filters them by section. */
export const listHtml = (posts) => newestFirst(posts).map(cardHtml).join('');

/**
 * The inside of <article>. Images are <img data-media="key"> slots; pass
 * `src` (key → URL) to fill them in now (static pages), or leave them for
 * the page to fill once the images arrive (blog-post.html).
 */
export function articleHtml(post, { src } = {}) {
  const p = normalize(post);
  const meta = [p.author, fmtDate(p.date), p.type === 'recipe' ? '' : p.readTime].filter(Boolean);
  const facts = p.type === 'recipe' && recipeFacts(p).length
    ? `<dl class="recipe-facts" lang="en">${recipeFacts(p).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
    : '';
  const body =
    p.type === 'poetry' ? poemHtml(p)
      : p.type === 'recipe' ? recipeHtml(p)
        : stripActive(p.html);
  const bodyClass = p.type === 'poetry' ? 'article-body poem' : p.type === 'recipe' ? 'article-body recipe' : 'article-body';
  const html =
    `<header class="article-header"${langAttr(p)}>` +
    `<h1 class="article-title">${esc(p.title)}</h1>` +
    `<div class="article-meta" lang="en">${meta.map((m, i) => (i ? '<span class="article-meta-divider"></span>' : '') + `<span${i ? '' : ' class="article-author"'}>${esc(m)}</span>`).join('')}</div>` +
    facts +
    '</header>' +
    `<div class="${bodyClass}"${langAttr(p)}>${body}</div>`;
  return src ? fillSlots(html, src) : html;
}

/** Put image URLs into the data-media slots of rendered HTML. */
export function fillSlots(html, src) {
  return html.replace(/<img\b([^>]*?)\sdata-media="([^"]+)"([^>]*)>/g, (m, before, key, after) => {
    const url = src[key];
    return url ? `<img${before} src="${esc(url)}"${after.replace(/\ssrc="[^"]*"/, '')}>` : m;
  });
}

/** Where each image of a post goes: data-media="<n>" in essays, "hero" and "g<n>" in recipes. */
export function mediaSources(m) {
  const out = {};
  (Array.isArray(m?.media) ? m.media : []).forEach((src, i) => { if (src) out[String(i)] = src; });
  if (m?.heroImage) out.hero = m.heroImage;
  (Array.isArray(m?.images) ? m.images : []).forEach((src, i) => { if (src) out[`g${i}`] = src; });
  return out;
}

const isoDuration = (s) => {
  const t = String(s ?? '').toLowerCase();
  let h = 0, m = 0, mt;
  if ((mt = t.match(/(\d+)\s*h/))) h = +mt[1];
  if ((mt = t.match(/(\d+)\s*m/))) m = +mt[1];
  if (!h && !m && (mt = t.match(/(\d+)/))) m = +mt[1];
  return h || m ? `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}` : undefined;
};

const LOCALES = { en: 'en_IN', bn: 'bn_IN', hi: 'hi_IN' };
const OG_DEFAULT_ALT = 'Navajit D - AI Product Manager';

/**
 * What a post page says about itself in <head>: title, description, address,
 * share image. `image` is an absolute URL of the post's own photo, if it has one.
 */
export function describePost(post, { image } = {}) {
  const p = normalize(post);
  const description = p.excerpt.replace(/\s+/g, ' ').trim().slice(0, 200) || `${typeName(p.type)}, by ${p.author}.`;
  return {
    title: p.title,
    pageTitle: `${p.title} - Navajit D`,
    description,
    url: postUrl(p),
    section: typeName(p.type),
    locale: LOCALES[p.lang] || LOCALES.en,
    published: p.date,
    modified: isoDay(p.updatedAt) || isoDay(p.updateTime) || p.date,
    image: image || OG_IMAGE,
    imageAlt: image ? p.title : OG_DEFAULT_ALT,
    imageSize: image ? null : { width: 1200, height: 630 },
  };
}

/** The <head> tags of a post's static page. */
export function postHeadHtml(post, opts = {}) {
  const p = normalize(post);
  const d = describePost(p, opts);
  const tag = (attr, key, value) => (value ? `    <meta ${attr}="${key}" content="${esc(value)}">\n` : '');
  return (
    `    <title>${esc(d.pageTitle)}</title>\n` +
    tag('name', 'description', d.description) +
    tag('name', 'author', p.author) +
    tag('name', 'theme-color', '#2563eb') +
    `    <link rel="canonical" href="${esc(d.url)}">\n` +
    tag('property', 'og:type', 'article') +
    tag('property', 'og:site_name', 'Navajit D') +
    tag('property', 'og:title', d.title) +
    tag('property', 'og:description', d.description) +
    tag('property', 'og:url', d.url) +
    tag('property', 'og:locale', d.locale) +
    tag('property', 'og:image', d.image) +
    (d.imageSize ? tag('property', 'og:image:width', String(d.imageSize.width)) + tag('property', 'og:image:height', String(d.imageSize.height)) : '') +
    tag('property', 'og:image:alt', d.imageAlt) +
    tag('property', 'article:published_time', d.published) +
    tag('property', 'article:modified_time', d.modified) +
    tag('property', 'article:section', d.section) +
    tag('name', 'twitter:card', 'summary_large_image') +
    tag('name', 'twitter:site', '@solitary_nav') +
    tag('name', 'twitter:creator', '@solitary_nav') +
    tag('name', 'twitter:title', d.title) +
    tag('name', 'twitter:description', d.description) +
    tag('name', 'twitter:image', d.image) +
    `    <script type="application/ld+json" id="postLd">${ldJson(jsonLd(p, opts))}</script>\n` +
    // analytics.js reads the Firestore id for read-to-end and time-spent events.
    `    <script>window.__nvPostReadyId = ${ldJson(p.id)};</script>\n`
  );
}

/** JSON for inside a <script>: no "</script>" or "<!--" can end it early. */
export const ldJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Structured data for a post page. */
export function jsonLd(post, { image } = {}) {
  const p = normalize(post);
  const person = { '@type': 'Person', name: p.author, url: `${SITE}/` };
  if (p.type === 'recipe') {
    return {
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: p.title,
      description: p.excerpt || undefined,
      author: person,
      datePublished: p.date || undefined,
      inLanguage: p.lang,
      recipeCuisine: str(p.cuisine) || undefined,
      keywords: list(p.tags).join(', ') || undefined,
      recipeYield: str(p.servings) || undefined,
      prepTime: isoDuration(p.prepTime),
      cookTime: isoDuration(p.cookTime),
      recipeIngredient: list(p.ingredients).filter((l) => !/[:：]$/.test(l)),
      recipeInstructions: list(p.steps).map((text) => ({ '@type': 'HowToStep', text })),
      image: image || undefined,
      url: postUrl(p),
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: p.excerpt || undefined,
    datePublished: p.date || undefined,
    dateModified: isoDay(p.updatedAt) || isoDay(p.updateTime) || p.date || undefined,
    author: person,
    publisher: { '@type': 'Person', name: 'Navajit D', url: `${SITE}/` },
    inLanguage: p.lang,
    articleSection: typeName(p.type),
    genre: p.type === 'poetry' ? 'Poetry' : undefined,
    image: image || OG_IMAGE,
    url: postUrl(p),
    mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl(p) },
  };
}
