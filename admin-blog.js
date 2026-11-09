// Admin console → Blog posts. Write and edit every kind of post (Tech,
// Poetry, Makha-bhat, Recipe), preview it on the real post page, and publish
// it to Firestore. Posts are never committed to GitHub: the site's deploy
// (.github/workflows/deploy.yml) reads them from Firestore and builds a static
// page for each. After a publish or delete this tab asks GitHub to deploy,
// with the token the Experience tab keeps, and follows the deploy until the
// post is on the site (about a minute). Until then the post can be read at
// /blog-post.html?id=<id>&live, straight from Firestore.
//
// Firestore document `posts/<id>` (new posts get a slug of the title as id):
//   every type   type, title, lang, author, date, excerpt, readTime, createdAt, updatedAt
//   Tech and Makha-bhat   html (images replaced by <img data-media="n">), media[] (the images)
//   Poetry       poem (plain text: blank line = new stanza, leading spaces = indent), note
//   Recipe       description, cuisine, difficulty, prepTime, cookTime, servings, tags[],
//                ingredients[], steps[], notes, heroImage, images[], hasHero, galleryCount
//   older posts with a random id   slug (frozen on the first edit, so the address stays)
// The post page reads the text and the images in separate requests (blog-core.js).

import {
  TYPES, LANGS, typeName, slugify, readTime, wordCount, poemExcerpt, lineCount,
  normalize, fmtDate, postPath, livePath, postSlug, SLUG_RE, listUrl, docUrl, fromList, fromRest,
} from '/blog-core.js?v=db4c4ef6';

const DOC_LIMIT = 1048487; // Firestore's limit for one document, in bytes
const SAFE_BYTES = DOC_LIMIT - 24 * 1024;
const DRAFT_KEY = 'blog.draft.v1';
const MAMMOTH = 'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js';
const MARKED = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';

const root = document.getElementById('blogAdmin');
const posts = () => firebase.firestore().collection('posts');
const state = { posts: null, filter: 'all', loading: false, error: '', notice: null, view: 'list' };

// Listing posts is for the signed-in owner only (firestore.rules), so the
// REST reads carry his Firebase sign-in.
async function firestoreGet(url) {
  const token = await firebase.auth().currentUser?.getIdToken();
  return fetch(url, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

// ─── Small DOM helpers ──────────────────────────────────────────────────────
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}
let seq = 0;
/** A labelled field; the label points at the control (or the first input inside it). */
function field(label, control, hint) {
  const target = control.matches('input, textarea, select') ? control : control.querySelector('input, textarea, select');
  if (target && !target.id) target.id = `bl-field-${++seq}`;
  return h('div', { class: 'form-row' },
    h('label', { for: target?.id }, label),
    control,
    hint && h('div', { class: 'xp-hint' }, hint));
}
/** replaceChildren, skipping the empty slots that `cond && node` leaves (it would print "null"). */
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== ''));
const spinner = () => h('div', { class: 'spinner spinner-dark' });
/** Today in this browser's time zone (toISOString would give the UTC date, a day off before 05:30 IST). */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtBytes = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const linesOf = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
const langName = (id) => (LANGS.find((l) => l.id === id) || LANGS[0]).name;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)?.dataset.loaded) return resolve();
    const s = h('script', { src });
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`couldn’t load ${new URL(src).hostname}`));
    document.head.append(s);
  });
}

// Imported documents and pasted text may carry scripts, event handlers or
// Google Docs styling; keep only the tags and attributes a post needs.
const KEEP_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'IMG', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'CODE', 'PRE', 'SPAN', 'FIGURE', 'FIGCAPTION']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'SVG', 'MATH']);
const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'data-media', 'colspan', 'rowspan', 'lang']);
export function cleanHtml(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (DROP_TAGS.has(el.tagName)) { el.remove(); continue; }
      walk(el);
      if (!KEEP_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const name = a.name.toLowerCase();
        const bad = !KEEP_ATTRS.has(name)
          || ((name === 'href' || name === 'src') && /^\s*(javascript|vbscript|data:text)/i.test(a.value));
        if (bad) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
      }
    }
  };
  walk(box);
  box.querySelectorAll('p, span').forEach((el) => { if (!el.textContent.trim() && !el.querySelector('img, br')) el.remove(); });
  return box.innerHTML.trim();
}

// ─── Images: resized and re-encoded in the browser, stored in the post ────
const WEBP = (() => {
  try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; }
})();
function compress(src, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h0 = img.naturalHeight;
      const small = w <= maxDim && h0 <= maxDim;
      if (small && /^data:image\/(jpeg|webp)/.test(src) && src.length < 350000) return resolve({ url: src, w, h: h0 });
      const k = Math.min(1, maxDim / Math.max(w, h0));
      w = Math.round(w * k); h0 = Math.round(h0 * k);
      const c = h('canvas', { width: w, height: h0 });
      const ctx = c.getContext('2d');
      if (!WEBP) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h0); }
      ctx.drawImage(img, 0, 0, w, h0);
      const url = c.toDataURL(WEBP ? 'image/webp' : 'image/jpeg', quality);
      resolve(small && url.length >= src.length && src.startsWith('data:') ? { url: src, w, h: h0 } : { url, w, h: h0 });
    };
    img.onerror = () => reject(new Error('that image couldn’t be read'));
    img.src = src;
  });
}
const fileToImage = async (file, maxDim, quality) => {
  if (!file?.type?.startsWith('image/')) throw new Error(`${file?.name || 'that file'} isn’t an image`);
  const url = URL.createObjectURL(file);
  try { return await compress(url, maxDim, quality); } finally { URL.revokeObjectURL(url); }
};
/** Put a stored post's images back into its HTML, so they show while editing. */
function inlineMedia(html, media) {
  const box = document.createElement('div');
  box.innerHTML = html || '';
  box.querySelectorAll('img[data-media]').forEach((img) => {
    const src = (media || [])[Number(img.dataset.media)];
    if (src) img.src = src;
  });
  return box.innerHTML;
}

// ─── List ───────────────────────────────────────────────────────────────────
window.blogAdminOpen = () => {
  if (state.view === 'edit') return;
  if (state.posts) renderList();
  else loadList();
};

async function loadList() {
  state.loading = true;
  renderList();
  try {
    const r = await firestoreGet(listUrl());
    if (!r.ok) throw new Error(`Firestore ${r.status}`);
    state.posts = fromList(await r.json()).map(normalize).sort((a, b) => b.date.localeCompare(a.date));
    state.error = '';
  } catch (e) {
    state.error = `The posts didn’t load: ${e.message}`;
    state.posts = state.posts || [];
  }
  state.loading = false;
  renderList();
}

function renderList() {
  state.view = 'list';
  const all = state.posts || [];
  const count = (id) => all.filter((p) => p.type === id).length;
  const chips = [['all', 'All', all.length], ...TYPES.map((t) => [t.id, t.name, count(t.id)])];
  const shown = all.filter((p) => state.filter === 'all' || p.type === state.filter);
  put(root, 
    state.notice && h('div', { class: `alert alert-${state.notice.kind} show bl-notice` }, state.notice.parts),
    h('div', { class: 'bl-toolbar' },
      h('div', { class: 'bl-filters', role: 'group', 'aria-label': 'Show posts from' },
        chips.map(([id, name, n]) => h('button', {
          type: 'button', class: `bl-chip${state.filter === id ? ' is-on' : ''}`, 'aria-pressed': String(state.filter === id),
          onclick: () => { state.filter = id; state.notice = null; renderList(); },
        }, name, h('span', { class: 'bl-count' }, String(n))))),
      h('span', { class: 'xp-spacer' }),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openEditor() }, '+ New post')),
    state.error && h('div', { class: 'alert alert-error show' }, state.error),
    state.loading
      ? h('div', { class: 'xp-loading' }, spinner(), 'Loading posts…')
      : shown.length
        ? h('div', { class: 'bl-list' }, shown.map(row))
        : h('p', { class: 'xp-muted' }, state.filter === 'all' ? 'No posts yet.' : `No ${typeName(state.filter)} posts yet.`));
}

function row(p) {
  const meta = [typeName(p.type), fmtDate(p.date), p.type === 'recipe' ? '' : p.readTime, p.lang === 'en' ? '' : langName(p.lang)]
    .filter(Boolean).join(' · ');
  return h('div', { class: 'post-item', 'data-id': p.id },
    h('div', { class: 'bl-row-main' },
      h('div', { class: 'post-item-title', lang: p.lang }, p.title),
      h('div', { class: 'post-item-meta' }, meta)),
    h('div', { class: 'post-item-actions' },
      h('a', { class: 'btn btn-secondary btn-sm', href: postPath(p), target: '_blank', rel: 'noopener' }, 'View'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': `Edit “${p.title}”`, onclick: () => openEditor(p.id) }, 'Edit'),
      h('button', { type: 'button', class: 'btn btn-danger btn-sm', 'aria-label': `Delete “${p.title}”`, onclick: () => removePost(p) }, 'Delete')));
}

async function removePost(p) {
  if (!confirm(`Delete “${p.title}”? This can’t be undone.`)) return;
  try {
    await posts().doc(p.id).delete();
    state.notice = { kind: 'success', parts: [`Deleted “${p.title}”. `, deployStatus({ deleted: true })] };
    await loadList();
  } catch (e) {
    state.notice = { kind: 'error', parts: [`Delete failed: ${e.message}`] };
    renderList();
  }
}

// ─── Putting changes on the site ────────────────────────────────────────────
// The site deploys from .github/workflows/deploy.yml, which builds every post
// into a static page. A repository_dispatch event starts it; the token the
// Experience tab saved (fine-grained, this repo, Contents: read and write)
// is allowed to send one. Without a token, the workflow's 6-hourly run picks
// the change up.
const REPO = 'NavajitD/navajitd.github.io';
const GH = `https://api.github.com/repos/${REPO}`;
const DEPLOYS = `https://github.com/${REPO}/actions/workflows/deploy.yml`;
const ghToken = () => localStorage.getItem('xp.githubToken') || '';
const ghHeaders = (token) => ({
  Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function requestDeploy() {
  const token = ghToken();
  if (!token) return { ok: false, why: 'none' };
  try {
    const r = await fetch(`${GH}/dispatches`, {
      method: 'POST', headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'blog-publish' }), // no titles: run details are public
    });
    if (r.status === 204) return { ok: true };
    return { ok: false, why: r.status === 401 || r.status === 403 || r.status === 404 ? 'refused' : `GitHub ${r.status}` };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

/** Follow the newest dispatched deploy until it finishes: 'live', 'failed' or 'slow'. */
async function watchDeploy(since, onRun) {
  let token = ghToken();
  const get = async (url) => {
    let r = await fetch(url, { headers: ghHeaders(token), cache: 'no-store' });
    // A token without the Actions permission may be refused; this repo's runs are public anyway.
    if ((r.status === 401 || r.status === 403) && token) { token = ''; r = await fetch(url, { headers: ghHeaders(''), cache: 'no-store' }); }
    return r.ok ? r.json() : null;
  };
  const deadline = Date.now() + 8 * 60_000;
  let run = null;
  while (Date.now() < deadline) {
    await sleep(run ? 6000 : 4000);
    try {
      if (!run) {
        const list = await get(`${GH}/actions/workflows/deploy.yml/runs?event=repository_dispatch&per_page=5`);
        // GitHub's clock and this one can differ by a little.
        run = list?.workflow_runs?.find((x) => Date.parse(x.created_at) >= since - 60_000) || null;
        if (run) onRun(run.html_url);
      } else {
        const now = await get(`${GH}/actions/runs/${run.id}`);
        if (now?.status === 'completed') return { state: now.conclusion === 'success' ? 'live' : 'failed', url: now.html_url };
      }
    } catch { /* offline for a moment: keep trying until the deadline */ }
  }
  return { state: 'slow', url: run?.html_url || DEPLOYS };
}

/**
 * The second half of a publish or delete notice: starts the deploy and keeps
 * itself up to date. `post` for a publish (links to it), `deleted` for a delete.
 */
function deployStatus({ post, deleted }) {
  const box = h('span', { class: 'bl-deploy', role: 'status' });
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  const readNow = () => post && [' ', link(`${livePath(post)}&live`, 'Read it now'), '.'];
  const retry = (label) => h('button', { type: 'button', class: 'bl-link', onclick: () => start() }, label);
  async function start() {
    if (!ghToken()) {
      put(box, deleted ? 'It comes off the site with the next update, within 6 hours. ' : 'It goes on the site with the next update, within 6 hours. ',
        readNow(), ' ', h('button', {
          type: 'button', class: 'bl-link',
          onclick: () => {
            addEventListener('xp-github-connected', () => start(), { once: true });
            window.xpConnect?.('Connect GitHub once, and every post you publish goes on the site within a minute.');
          },
        }, 'Connect GitHub'), ' to do it now.');
      return;
    }
    put(box, h('span', { class: 'spinner spinner-dark bl-spin' }), deleted ? 'Taking it off the site, about a minute…' : 'Putting it on the site, about a minute…', readNow());
    const since = Date.now();
    const sent = await requestDeploy();
    if (!sent.ok) {
      put(box, sent.why === 'refused'
        ? 'GitHub didn’t accept the saved token (it may have expired), so the site updates within 6 hours. Reconnect GitHub in the Experience tab, then '
        : `Couldn’t reach GitHub (${sent.why}), so the site updates within 6 hours. `, retry('try again'), '.', readNow());
      return;
    }
    const done = await watchDeploy(since, (url) => {
      put(box, h('span', { class: 'spinner spinner-dark bl-spin' }), deleted ? 'Taking it off the site' : 'Putting it on the site', ' (', link(url, 'deploy'), '), about a minute…', readNow());
    });
    if (done.state === 'live') put(box, deleted ? 'It’s off the site.' : ['It’s on the site: ', link(postPath(post), post.title), '.']);
    else if (done.state === 'failed') put(box, 'The site didn’t update: ', link(done.url, 'see what went wrong'), '. Your post is saved. ', retry('Try again'), '.', readNow());
    else put(box, 'The deploy is taking longer than usual: ', link(done.url, 'follow it on GitHub'), '.', readNow());
  }
  start();
  return box;
}

// ─── Editor ─────────────────────────────────────────────────────────────────
async function openEditor(id) {
  state.view = 'edit';
  state.notice = null;
  let doc = null;
  if (id) {
    put(root, h('div', { class: 'xp-loading' }, spinner(), 'Opening the post…'));
    try {
      const r = await firestoreGet(docUrl(id));
      if (!r.ok) throw new Error(r.status === 404 ? 'it no longer exists' : `Firestore ${r.status}`);
      doc = fromRest(await r.json());
    } catch (e) {
      state.notice = { kind: 'error', parts: [`Couldn’t open the post: ${e.message}`] };
      return renderList();
    }
  }
  renderEditor(doc);
}

function readDraft(id) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && (d.id || null) === (id || null) ? d : null;
  } catch { return null; }
}
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

function renderEditor(doc) {
  const d = doc ? normalize(doc) : null;
  const E = {
    id: doc?.id || null,
    original: doc,
    type: d?.type || 'tech',
    hero: doc?.heroImage || '',
    gallery: Array.isArray(doc?.images) ? [...doc.images] : [],
    excerptTouched: false,
    dirty: false,
  };

  // Common fields
  const typeGroup = h('div', { class: 'bl-seg', role: 'radiogroup', 'aria-label': 'Type' },
    TYPES.map((t) => h('label', { class: 'bl-seg-item' },
      h('input', { type: 'radio', name: 'blType', value: t.id, checked: t.id === E.type, onchange: () => setType(t.id) }),
      h('span', {}, t.name))));
  const title = h('input', { type: 'text', value: doc?.title || '', autocomplete: 'off', placeholder: 'Title' });
  const date = h('input', { type: 'date', value: (d?.date || '').slice(0, 10) || todayIso() });
  const lang = h('select', {}, LANGS.map((l) => h('option', { value: l.id, selected: l.id === (d?.lang || 'en') }, l.name)));

  // Tech and Makha-bhat: a document or written text
  const fileInput = h('input', { type: 'file', accept: '.docx,.md,.markdown' });
  const drop = h('div', { class: 'drop-zone sm', role: 'button', tabindex: '0', 'aria-label': 'Choose a .docx or .md file' },
    fileInput, h('strong', {}, 'Drop a .docx or .md file here'), h('span', {}, 'or click to choose one, or write in the box below'));
  const fileStatus = h('div', { class: 'xp-hint', role: 'status' });
  const prose = h('div', { class: 'preview-box bl-prose', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Text of the post' });
  prose.innerHTML = inlineMedia(doc?.html, doc?.media);
  const proseStats = h('div', { class: 'xp-hint' });

  // Poetry
  const poem = h('textarea', { class: 'bl-poem', rows: '14', spellcheck: 'false', value: doc?.poem || '' });
  const note = h('textarea', { rows: '3', value: doc?.note || '' });
  const poemStats = h('div', { class: 'xp-hint' });

  // Recipe
  const R = {
    description: h('textarea', { rows: '3', value: doc?.description || '' }),
    cuisine: h('input', { type: 'text', value: doc?.cuisine || '', placeholder: 'Bengali' }),
    difficulty: h('select', {}, ['', 'Easy', 'Medium', 'Hard'].map((v) => h('option', { value: v, selected: (doc?.difficulty || '') === v }, v || 'Not set'))),
    prepTime: h('input', { type: 'text', value: doc?.prepTime || '', placeholder: '15 min' }),
    cookTime: h('input', { type: 'text', value: doc?.cookTime || '', placeholder: '30 min' }),
    servings: h('input', { type: 'text', value: doc?.servings || '', placeholder: '4' }),
    tags: h('input', { type: 'text', value: (doc?.tags || []).join(', '), placeholder: 'vegetarian, quick' }),
    ingredients: h('textarea', { rows: '8', value: (doc?.ingredients || []).join('\n') }),
    steps: h('textarea', { rows: '8', value: (doc?.steps || []).join('\n') }),
    notes: h('textarea', { rows: '3', value: doc?.notes || '' }),
  };
  const heroInput = h('input', { type: 'file', accept: 'image/*' });
  const galleryInput = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const heroZone = h('div', { class: 'drop-zone sm', role: 'button', tabindex: '0', 'aria-label': 'Choose the main photo' }, heroInput, h('strong', {}, 'Drop the main photo'), h('span', {}, 'or click to choose it'));
  const galleryZone = h('div', { class: 'drop-zone sm', role: 'button', tabindex: '0', 'aria-label': 'Choose more photos' }, galleryInput, h('strong', {}, 'Drop more photos'), h('span', {}, 'steps, the finished dish'));
  const heroPreview = h('div', { class: 'img-grid' });
  const galleryPreview = h('div', { class: 'img-grid' });

  const excerpt = h('textarea', { rows: '3', value: doc?.excerpt || '' });
  const excerptRow = field('Shown on the blog page', excerpt, 'Filled in from the post until you edit it.');
  const sizeMeter = h('div', { class: 'size-meter', hidden: true },
    h('span', {}, ''), h('div', { class: 'bar' }, h('i', {})));
  const errors = h('div', { class: 'xp-errors', role: 'alert' });
  const publishBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => publish() }, E.id ? 'Update post' : 'Publish');

  const panels = [
    h('div', { class: 'bl-panel', 'data-for': 'tech makha-bhat' },
      field('Text', drop), fileStatus, prose, proseStats),
    h('div', { class: 'bl-panel', 'data-for': 'poetry' },
      field('Poem', poem, 'A blank line starts a new stanza. Spaces at the start of a line indent it.'), poemStats,
      field('Note (optional)', note, 'Shown under the poem in italics: a dedication, or where it came from.')),
    h('div', { class: 'bl-panel', 'data-for': 'recipe' },
      field('Description', R.description, 'A line or two about the dish. It is also the blurb on the blog page.'),
      h('div', { class: 'form-grid' }, field('Cuisine', R.cuisine), field('Difficulty', R.difficulty)),
      h('div', { class: 'form-grid bl-grid-3' }, field('Prep time', R.prepTime), field('Cook time', R.cookTime), field('Serves', R.servings)),
      field('Tags', R.tags, 'Separate them with commas.'),
      field('Ingredients', R.ingredients, 'One per line. End a line with a colon to start a group, like “For the paste:”.'),
      field('Method', R.steps, 'One step per line.'),
      field('Notes (optional)', R.notes),
      field('Main photo', heroZone), heroPreview,
      field('More photos (optional)', galleryZone), galleryPreview),
  ];

  put(root, 
    h('div', { class: 'xp-toolbar' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => leave() }, '← All posts'),
      h('strong', { class: 'bl-editor-title' }, E.id ? 'Edit post' : 'New post'),
      h('span', { class: 'xp-spacer' }),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => preview() }, 'Preview')),
    h('div', { class: 'bl-restored', hidden: true }),
    field('Type', typeGroup),
    h('div', { class: 'form-grid bl-grid-3' }, field('Title', title), field('Date', date), field('Language', lang)),
    panels,
    excerptRow,
    sizeMeter,
    errors,
    h('div', { class: 'btn-row' },
      publishBtn,
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => preview() }, 'Preview'),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => leave() }, 'Cancel')));

  // ─── Behaviour ───
  const proseText = () => prose.innerText || prose.textContent || '';
  function autoExcerpt() {
    if (E.type === 'poetry') return poemExcerpt(poem.value);
    if (E.type === 'recipe') return R.description.value.trim();
    const first = [...prose.querySelectorAll('p')].map((p) => p.textContent.trim()).find(Boolean) || proseText().trim();
    return first.replace(/\s+/g, ' ').slice(0, 280);
  }
  function refresh() {
    if (!E.excerptTouched) excerpt.value = autoExcerpt();
    proseStats.textContent = proseText().trim() ? `${wordCount(proseText())} words · ${readTime(proseText())}` : '';
    poemStats.textContent = poem.value.trim() ? lineCount(poem.value) : '';
    for (const el of [title, poem, prose, note, excerpt]) el.setAttribute('lang', lang.value);
    updateSize();
  }
  function setType(t) {
    E.type = t;
    for (const p of panels) p.hidden = !p.dataset.for.split(' ').includes(t);
    excerptRow.hidden = t === 'recipe';
    refresh();
  }
  function changed() { E.dirty = true; errors.replaceChildren(); refresh(); saveDraftSoon(); }

  function approxBytes() {
    let n = 2048 + title.value.length + excerpt.value.length;
    if (E.type === 'recipe') n += E.hero.length + E.gallery.reduce((s, x) => s + x.length, 0) + Object.values(R).reduce((s, el) => s + el.value.length, 0);
    else if (E.type === 'poetry') n += poem.value.length + note.value.length;
    else n += prose.innerHTML.length;
    return n;
  }
  function updateSize() {
    const bytes = approxBytes();
    const pct = Math.min(100, Math.round((bytes / DOC_LIMIT) * 100));
    sizeMeter.hidden = pct < 5;
    sizeMeter.firstChild.textContent = `Size: ${fmtBytes(bytes)} of about 1 MB that one post can hold`;
    sizeMeter.querySelector('i').style.width = `${pct}%`;
    sizeMeter.classList.toggle('warn', pct >= 75 && pct < 92);
    sizeMeter.classList.toggle('over', pct >= 92);
  }

  function renderImages() {
    const thumb = (src, onRemove, hero) => h('div', { class: `img-thumb${hero ? ' hero' : ''}` },
      h('img', { src, alt: '' }), h('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove photo', onclick: onRemove }, '✕'));
    put(heroPreview, E.hero ? thumb(E.hero, () => { E.hero = ''; renderImages(); changed(); }, true) : '');
    put(galleryPreview, ...E.gallery.map((src, i) => thumb(src, () => { E.gallery.splice(i, 1); renderImages(); changed(); })));
    updateSize();
  }

  function wireZone(zone, input, onFiles) {
    zone.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); onFiles([...e.dataTransfer.files]); });
    input.addEventListener('change', () => { onFiles([...input.files]); input.value = ''; });
  }
  wireZone(drop, fileInput, (files) => loadFile(files[0]));
  wireZone(heroZone, heroInput, async (files) => {
    if (!files[0]) return;
    try { E.hero = (await fileToImage(files[0], 1280, 0.8)).url; renderImages(); changed(); }
    catch (e) { errors.textContent = `Main photo: ${e.message}.`; }
  });
  wireZone(galleryZone, galleryInput, async (files) => {
    for (const f of files) {
      try { E.gallery.push((await fileToImage(f, 1000, 0.75)).url); }
      catch (e) { errors.textContent = `Photo: ${e.message}.`; }
    }
    renderImages(); changed();
  });

  async function loadFile(file) {
    const name = (file?.name || '').toLowerCase();
    if (!/\.(docx|md|markdown)$/.test(name)) { fileStatus.textContent = 'Choose a .docx or .md file.'; return; }
    fileStatus.textContent = `Converting ${file.name}…`;
    try {
      let html;
      if (name.endsWith('.docx')) {
        await loadScript(MAMMOTH);
        html = (await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value;
      } else {
        await loadScript(MARKED);
        html = window.marked.parse(await file.text(), { gfm: true, breaks: false });
      }
      const box = document.createElement('div');
      box.innerHTML = cleanHtml(html);
      const first = box.querySelector('h1, h2, h3');
      if (first && !title.value.trim()) { title.value = first.textContent.trim(); first.remove(); }
      prose.innerHTML = box.innerHTML;
      fileStatus.textContent = `Loaded ${file.name}. Edit it below if you like.`;
      changed();
    } catch (e) {
      fileStatus.textContent = `Couldn’t convert ${file.name}: ${e.message}.`;
    }
  }

  // Paste into the content box as clean HTML (no Google Docs styling).
  prose.addEventListener('paste', (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    e.preventDefault();
    document.execCommand('insertHTML', false, cleanHtml(html));
  });

  for (const el of [title, date, poem, note, prose, ...Object.values(R)]) el.addEventListener('input', changed);
  for (const el of [lang, R.difficulty]) el.addEventListener('change', changed);
  excerpt.addEventListener('input', () => { E.excerptTouched = excerpt.value.trim() !== ''; E.dirty = true; saveDraftSoon(); });

  // ─── Draft: kept in this browser until you publish or cancel ───
  let draftTimer = 0;
  function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); }
  function snapshot() {
    return {
      id: E.id, at: Date.now(), type: E.type, title: title.value, date: date.value, lang: lang.value,
      html: prose.innerHTML, poem: poem.value, note: note.value, excerpt: excerpt.value, excerptTouched: E.excerptTouched,
      recipe: Object.fromEntries(Object.entries(R).map(([k, el]) => [k, el.value])), hero: E.hero, gallery: E.gallery,
    };
  }
  function saveDraft() {
    const snap = snapshot();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snap)); }
    catch {
      // Too big for this browser's storage with the photos: keep the words.
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...snap, hero: '', gallery: [], html: snap.html.replace(/src="data:[^"]*"/g, '') })); } catch { /* ignore */ }
    }
  }
  function applyDraft(s) {
    title.value = s.title; date.value = s.date; lang.value = s.lang;
    prose.innerHTML = s.html; poem.value = s.poem; note.value = s.note;
    for (const [k, v] of Object.entries(s.recipe || {})) if (R[k]) R[k].value = v;
    E.hero = s.hero || E.hero; E.gallery = s.gallery?.length ? s.gallery : E.gallery;
    excerpt.value = s.excerpt; E.excerptTouched = !!s.excerptTouched;
    root.querySelector(`input[name="blType"][value="${s.type}"]`).checked = true;
    setType(s.type);
    renderImages();
  }
  function leave() {
    if (E.dirty && !confirm('Leave without publishing? Your changes stay saved in this browser as a draft.')) return;
    renderList();
  }

  // ─── Checks, the document, publishing ───
  function problems() {
    const out = [];
    if (!title.value.trim()) out.push('Add a title.');
    if (!date.value) out.push('Pick a date.');
    if ((E.type === 'tech' || E.type === 'makha-bhat') && !proseText().trim() && !prose.querySelector('img')) out.push('Add the content: drop a file, or write it in the box.');
    if (E.type === 'poetry' && !poem.value.trim()) out.push('Write the poem.');
    if (E.type === 'recipe') {
      if (!linesOf(R.ingredients.value).length) out.push('List the ingredients, one per line.');
      if (!linesOf(R.steps.value).length) out.push('Write the method, one step per line.');
    }
    return out;
  }
  function showProblems(list) {
    errors.replaceChildren(h('div', {}, 'Fix these first:'), h('ul', {}, list.map((p) => h('li', {}, p))));
  }

  /** The post as plain values (images inline), for the preview and for publishing. */
  function draftPost() {
    const base = {
      type: E.type, title: title.value.trim(), lang: lang.value, author: E.original?.author || 'Navajit D',
      date: `${date.value || todayIso()}T00:00:00Z`, excerpt: excerpt.value.trim() || autoExcerpt(),
    };
    if (E.type === 'poetry') return { ...base, poem: poem.value.replace(/\s+$/, ''), note: note.value.trim(), readTime: lineCount(poem.value) };
    if (E.type === 'recipe') {
      return {
        ...base, excerpt: R.description.value.trim(), readTime: '',
        description: R.description.value.trim(), cuisine: R.cuisine.value.trim(), difficulty: R.difficulty.value,
        prepTime: R.prepTime.value.trim(), cookTime: R.cookTime.value.trim(), servings: R.servings.value.trim(),
        tags: R.tags.value.split(',').map((s) => s.trim()).filter(Boolean),
        ingredients: linesOf(R.ingredients.value), steps: linesOf(R.steps.value), notes: R.notes.value.trim(),
        heroImage: E.hero, images: E.gallery, hasHero: !!E.hero, galleryCount: E.gallery.length,
      };
    }
    return { ...base, html: cleanHtml(prose.innerHTML), readTime: readTime(proseText()) };
  }

  /** Essays keep their images out of the HTML (data-media placeholders) so the text loads first. */
  async function packProse(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const media = [];
    for (const img of box.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      img.removeAttribute('data-media');
      if (src.startsWith('data:')) {
        const c = await compress(src, 1400, 0.82);
        img.removeAttribute('src');
        img.setAttribute('data-media', String(media.length));
        img.setAttribute('width', String(c.w));
        img.setAttribute('height', String(c.h));
        media.push(c.url);
      }
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
    }
    return { html: box.innerHTML, media };
  }

  async function newId(post) {
    let base = slugify(post.title);
    if (base.length < 3) base = `${post.type}-${post.date.slice(0, 10)}`;
    let id = base;
    for (let n = 2; (await posts().doc(id).get()).exists; n++) id = `${base}-${n}`;
    return id;
  }

  async function publish() {
    const list = problems();
    if (list.length) return showProblems(list);
    publishBtn.disabled = true;
    publishBtn.replaceChildren(h('span', { class: 'spinner' }), E.id ? 'Updating…' : 'Publishing…');
    try {
      const FV = firebase.firestore.FieldValue;
      const TS = firebase.firestore.Timestamp;
      const post = draftPost();
      const data = { ...post, date: TS.fromDate(new Date(post.date)), updatedAt: FV.serverTimestamp() };
      data.createdAt = E.original?.createdAt ? TS.fromDate(new Date(E.original.createdAt)) : FV.serverTimestamp();
      if (post.type === 'tech' || post.type === 'makha-bhat') {
        const packed = await packProse(post.html);
        data.html = packed.html;
        if (packed.media.length) data.media = packed.media;
      }
      const bytes = new Blob([JSON.stringify(data)]).size;
      if (bytes > SAFE_BYTES) throw new Error(`the post is ${fmtBytes(bytes)} and one post can hold about 1 MB. Remove some photos or use smaller ones`);
      const id = E.id || await newId(post);
      // An older post with a random id keeps the address its title gave it, even if the title changes.
      if (!SLUG_RE.test(id)) data.slug = postSlug({ ...E.original, id });
      await posts().doc(id).set(data);
      clearDraft();
      state.notice = {
        kind: 'success',
        parts: [`${E.id ? 'Updated' : 'Published'} “${post.title}”. `, deployStatus({ post: { ...post, id, slug: data.slug } })],
      };
      state.filter = 'all';
      await loadList();
    } catch (e) {
      showProblems([`Publishing failed: ${e.message}.`]);
      publishBtn.disabled = false;
      publishBtn.textContent = E.id ? 'Update post' : 'Publish';
    }
  }

  function preview() {
    const list = problems();
    if (list.length) return showProblems(list);
    const post = draftPost();
    const frame = h('iframe', { class: 'xp-frame', title: 'Preview of the post', src: '/blog-post.html?preview' });
    const sizes = h('div', { class: 'mx-toggle', role: 'group', 'aria-label': 'Width' },
      [['Desktop', '100%'], ['Phone', '390px']].map(([label, w], i) => h('button', {
        type: 'button', class: i ? '' : 'active',
        onclick: (e) => { frame.style.width = w; sizes.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); },
      }, label)));
    const close = () => { overlay.remove(); removeEventListener('message', onMessage); };
    const overlay = h('div', { class: 'xp-preview', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Preview' },
      h('div', { class: 'xp-preview-bar' },
        h('strong', {}, 'Preview, not published'), sizes, h('span', { class: 'xp-spacer' }),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: close }, 'Close')),
      h('div', { class: 'xp-preview-stage' }, frame));
    function onMessage(e) {
      if (e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.type !== 'blog-preview-ready') return;
      frame.contentWindow.postMessage({ type: 'blog-preview', post }, location.origin);
    }
    addEventListener('message', onMessage);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.append(overlay);
    overlay.querySelector('button').focus();
  }

  // ─── Start ───
  setType(E.type);
  renderImages();
  if (doc) E.excerptTouched = !!doc.excerpt && doc.excerpt.trim() !== autoExcerpt();
  const draft = readDraft(E.id);
  if (draft) {
    const before = snapshot();
    applyDraft(draft);
    const banner = root.querySelector('.bl-restored');
    banner.replaceChildren(
      `Restored your unsaved changes from ${new Date(draft.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}. `,
      h('button', { type: 'button', class: 'bl-link', onclick: () => { clearDraft(); applyDraft(before); E.dirty = false; banner.hidden = true; } }, 'Discard them'));
    banner.hidden = false;
  }

  refresh();
  E.dirty = !!draft;
  title.focus();
}
