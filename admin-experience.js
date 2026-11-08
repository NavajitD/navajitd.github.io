// Admin console → Experience: edit, add, archive and reorder the roles and
// result cards on the landing page, then publish. Publishing commits
// content/experience.json to GitHub; the "Build experience" Action rebuilds
// index.html from it and GitHub Pages serves the result, so visitors still
// get a static page. The token used to commit stays in this browser.

import {
  LANGS, LANG_NAMES, HASH_RE, validateExperience, suggestDelta, translationNotes,
  uniqueId, blankRole, blankCard, pick, formatDates, applyExperience,
} from '/scripts/experience.js?v=84cef3ce';

const OWNER = 'NavajitD';
const REPO = 'navajitd.github.io';
const BRANCH = 'main';
const FILE = 'content/experience.json';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const LIVE_ORIGIN = 'https://navajitd.github.io';
const TOKEN_KEY = 'xp.githubToken';
const DRAFT_KEY = 'xp.draft';
const TOKEN_HELP = 'https://github.com/settings/personal-access-tokens/new';

const root = document.getElementById('xpAdmin');
const state = {
  published: null,   // what GitHub (or the site) has
  publishedRaw: '',
  draft: null,       // your working copy
  sha: null,         // blob sha of the file on GitHub, needed to commit
  source: '',
  changes: [],       // plain-language list for the commit message
  notice: '',
  log: null,         // the last publish: commit, phase, timings
  publishing: false,
  user: '',
};

// ─── Small helpers ──────────────────────────────────────────────────────────

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
const clone = (x) => JSON.parse(JSON.stringify(x));
const serialize = (data) => `${JSON.stringify(data, null, 2)}\n`;
const isDirty = () => state.draft && serialize(state.draft) !== state.publishedRaw;
const canPublish = () => location.origin === LIVE_ORIGIN || localStorage.getItem('xp.allowLocalPublish') === '1';
const getToken = () => localStorage.getItem(TOKEN_KEY) || '';

const encodeBase64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const decodeBase64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
async function shortHash(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** A GitHub REST call: a path under the repo ("/contents/…"), or a full API URL. */
function gh(path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = opts.token ?? getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const url = path.startsWith('https://') ? path : API + path;
  return fetch(url, { method: opts.method || 'GET', body: opts.body, headers, cache: 'no-store' });
}

async function whoAmI(token) {
  try {
    const res = await gh('https://api.github.com/user', { token });
    return res.ok ? (await res.json()).login || '' : '';
  } catch { return ''; }
}

function datesText(r) {
  try { return /^\d{4}-\d{2}$/.test(r.start) ? formatDates(r.start, r.end, 'en') : ''; } catch { return ''; }
}

function note(text, kind = 'info') {
  return h('div', { class: `alert alert-${kind} show xp-alert` }, text);
}

// ─── Drafts survive a reload ────────────────────────────────────────────────

function saveDraft() {
  if (!isDirty()) return localStorage.removeItem(DRAFT_KEY);
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ baseRaw: state.publishedRaw, draft: state.draft, changes: state.changes }));
}
function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}
function change(text) {
  state.notice = '';
  if (state.changes[state.changes.length - 1] !== text) state.changes.push(text);
  saveDraft();
  render();
}

// ─── Loading ────────────────────────────────────────────────────────────────

async function load() {
  root.replaceChildren(h('div', { class: 'xp-loading' }, h('div', { class: 'spinner spinner-dark' }), 'Loading the experience section…'));
  try {
    let raw, sha = null, source;
    if (getToken()) {
      const res = await gh(`/contents/${FILE}?ref=${BRANCH}`);
      if (res.status === 401) throw new Error('GitHub rejected the saved token. Disconnect and connect a new one.');
      if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${FILE}.`);
      const j = await res.json();
      raw = decodeBase64(j.content);
      sha = j.sha;
      source = 'GitHub';
    } else {
      const res = await fetch(`/${FILE}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Couldn't read /${FILE} (${res.status}).`);
      raw = await res.text();
      source = 'the live site';
    }
    if (sha && !state.user) whoAmI().then((login) => { state.user = login; if (login) render(); });
    state.published = JSON.parse(raw);
    state.publishedRaw = raw.endsWith('\n') ? raw : `${raw}\n`;
    state.sha = sha;
    state.source = source;
    const saved = readDraft();
    if (saved && saved.baseRaw === state.publishedRaw) {
      state.draft = saved.draft;
      state.changes = saved.changes || [];
      state.notice = isDirty() ? 'Restored your unpublished changes from last time.' : '';
    } else {
      if (saved) state.notice = 'The file changed since your last unpublished edits, so they were set aside. Nothing was published.';
      if (saved) localStorage.setItem(`${DRAFT_KEY}.setAside`, JSON.stringify(saved));
      state.draft = clone(state.published);
      state.changes = [];
      localStorage.removeItem(DRAFT_KEY);
    }
  } catch (e) {
    root.replaceChildren(note(e.message, 'error'), h('button', { class: 'btn btn-secondary btn-sm', onclick: load }, 'Try again'));
    return;
  }
  render();
}

// ─── The list ───────────────────────────────────────────────────────────────

function actionButtons(items) {
  return h('div', { class: 'xp-actions' }, items.map(([label, title, disabled, fn, extra]) =>
    h('button', { type: 'button', class: `btn btn-secondary btn-sm${extra ? ` ${extra}` : ''}`, title, 'aria-label': title, disabled, onclick: fn }, label)));
}

const publishedRole = (id) => (state.published?.roles || []).find((r) => r.id === id);
const isNewRole = (r) => !publishedRole(r.id);
const isNewCard = (r, c) => !(publishedRole(r.id)?.cards || []).some((x) => x.id === c.id);

function cardRow(ri, c, ci, total) {
  const role = state.draft.roles[ri];
  const roleName = pick(role.company, 'en');
  const name = pick(c.metric, 'en') || 'Untitled card';
  return h('li', { class: `xp-item${c.archived ? ' is-archived' : ''}`, 'data-card': c.id },
    h('div', { class: 'xp-item-main' },
      h('div', { class: 'xp-item-title' }, name, c.archived && h('span', { class: 'xp-badge' }, 'Archived')),
      h('div', { class: 'xp-item-meta' }, `${c.before} → ${c.after}${c.delta ? ` · ${c.delta}` : ''} · ${(c.bullets || []).filter((b) => pick(b, 'en')).length} bullets`),
    ),
    actionButtons([
      ['↑', `Move “${name}” up`, ci === 0, () => moveCard(ri, ci, -1)],
      ['↓', `Move “${name}” down`, ci === total - 1, () => moveCard(ri, ci, 1)],
      ['Edit', `Edit “${name}”`, false, () => editCard(ri, ci)],
      isNewCard(role, c)
        ? ['Remove', `Remove “${name}” (not published yet)`, false, () => { role.cards.splice(ci, 1); change(`remove new card “${name}” (${roleName})`); }, 'xp-archive']
        : c.archived
        ? ['Restore', `Restore “${name}”`, false, () => { c.archived = false; change(`restore card “${name}” (${roleName})`); }]
        : ['Archive', `Archive “${name}”`, false, () => { c.archived = true; change(`archive card “${name}” (${roleName})`); }, 'xp-archive'],
    ]),
  );
}

function roleBox(r, ri) {
  const total = state.draft.roles.length;
  const cards = r.cards || [];
  const shown = cards.filter((c) => !c.archived).length;
  const name = `${pick(r.title, 'en') || 'Untitled role'}${pick(r.company, 'en') ? `, ${pick(r.company, 'en')}` : ''}`;
  return h('section', { class: `xp-role${r.archived ? ' is-archived' : ''}`, 'data-role': r.id },
    h('div', { class: 'xp-item xp-role-head' },
      h('div', { class: 'xp-item-main' },
        h('div', { class: 'xp-role-title' }, pick(r.title, 'en') || 'Untitled role', r.archived && h('span', { class: 'xp-badge' }, 'Archived')),
        h('div', { class: 'xp-item-meta' }, [pick(r.company, 'en'), datesText(r), cards.length ? `${shown} of ${cards.length} cards shown` : 'no cards'].filter(Boolean).join(' · ')),
      ),
      actionButtons([
        ['↑', `Move ${name} up`, ri === 0, () => moveRole(ri, -1)],
        ['↓', `Move ${name} down`, ri === total - 1, () => moveRole(ri, 1)],
        ['Edit', `Edit ${name}`, false, () => editRole(ri)],
        isNewRole(r)
          ? ['Remove', `Remove ${name} (not published yet)`, false, () => { state.draft.roles.splice(ri, 1); change(`remove new role ${name}`); }, 'xp-archive']
          : r.archived
          ? ['Restore', `Restore ${name}`, false, () => { r.archived = false; change(`restore role ${name}`); }]
          : ['Archive', `Archive ${name}`, false, () => { r.archived = true; change(`archive role ${name}`); }, 'xp-archive'],
      ]),
    ),
    r.archived
      ? h('p', { class: 'xp-muted' }, 'Hidden from the page with all its cards. Restore to show it again.')
      : [
        cards.length ? h('ol', { class: 'xp-cards' }, cards.map((c, ci) => cardRow(ri, c, ci, cards.length))) : h('p', { class: 'xp-muted' }, 'No cards: the page shows the title, dates and description.'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm xp-add-card', onclick: () => editCard(ri, null) }, '+ Add card'),
      ],
  );
}

function moveRole(i, d) {
  const roles = state.draft.roles;
  [roles[i], roles[i + d]] = [roles[i + d], roles[i]];
  change(`reorder roles`);
}
function moveCard(ri, i, d) {
  const cards = state.draft.roles[ri].cards;
  [cards[i], cards[i + d]] = [cards[i + d], cards[i]];
  change(`reorder cards (${pick(state.draft.roles[ri].company, 'en')})`);
}

function connectionRow() {
  const token = getToken();
  if (token) {
    return h('div', { class: 'xp-connect' },
      h('span', { class: 'xp-dot is-on', 'aria-hidden': 'true' }),
      `GitHub connected${state.user ? ` as ${state.user}` : ''}. Publishing commits ${FILE} to ${OWNER}/${REPO}.`,
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { localStorage.removeItem(TOKEN_KEY); state.user = ''; state.sha = null; render(); } }, 'Disconnect'),
    );
  }
  return h('div', { class: 'xp-connect' },
    h('span', { class: 'xp-dot', 'aria-hidden': 'true' }),
    'GitHub not connected: you can edit and preview; connect once to publish.',
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: openConnect }, 'Connect GitHub'),
  );
}

function statusText() {
  if (state.publishing) return 'Publishing…';
  const n = state.changes.length;
  if (isDirty()) return `${n || 'Some'} unpublished change${n === 1 ? '' : 's'}`;
  return `Matches ${state.source}`;
}

function publishLog() {
  const log = state.log;
  if (!log) return null;
  const parts = [];
  if (log.error) return note(log.error, 'error');
  if (log.info) return note(log.info);
  if (log.commitUrl) parts.push('Committed ', h('a', { href: log.commitUrl, target: '_blank', rel: 'noopener' }, log.commitSha), '. ');
  if (log.phase === 'building') parts.push('The GitHub Action is rebuilding the page (', h('a', { href: `https://github.com/${OWNER}/${REPO}/actions/workflows/experience.yml`, target: '_blank', rel: 'noopener' }, 'progress'), `)… ${log.waited || 0}s`);
  if (log.phase === 'live') parts.push(`Live on the landing page after ${log.waited}s. `, h('a', { href: '/#experience', target: '_blank', rel: 'noopener' }, 'Open it'));
  if (log.phase === 'slow') parts.push('Still not live after 6 minutes. Check the ', h('a', { href: `https://github.com/${OWNER}/${REPO}/actions/workflows/experience.yml`, target: '_blank', rel: 'noopener' }, 'Build experience runs'), '.');
  if (log.phase === 'committed') parts.push('The GitHub Action rebuilds the live page in about a minute.');
  return h('div', { class: `alert alert-${log.phase === 'live' ? 'success' : 'info'} show xp-alert`, role: 'status' }, parts);
}

function render() {
  if (!state.draft) return;
  const dirty = isDirty();
  root.replaceChildren(
    h('p', { class: 'xp-intro' }, 'The roles and result cards on the landing page, in page order. Archive hides an item from the page but keeps it here. Publish commits the changes to GitHub, and the page updates about a minute later.'),
    connectionRow(),
    state.notice && note(state.notice),
    h('div', { class: 'xp-toolbar' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => editRole(null) }, '+ Add role'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: preview }, 'Preview'),
      h('span', { class: 'xp-spacer' }),
      h('span', { class: 'xp-status', role: 'status' }, statusText()),
      dirty && h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: discard }, 'Discard'),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: publish, disabled: !dirty || state.publishing }, state.publishing ? 'Publishing…' : 'Publish'),
    ),
    (state.logEl = h('div', { class: 'xp-log' }, publishLog())),
    h('div', { class: 'xp-roles' }, state.draft.roles.map((r, i) => roleBox(r, i))),
  );
}
const renderLog = () => state.logEl && state.logEl.replaceChildren(publishLog() || '');

function discard() {
  if (!confirm('Discard all unpublished changes?')) return;
  state.draft = clone(state.published);
  state.changes = [];
  state.notice = '';
  localStorage.removeItem(DRAFT_KEY);
  render();
}

// ─── Editing dialogs ────────────────────────────────────────────────────────

const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };

let dialog;
function openDialog(content) {
  if (!dialog) {
    dialog = h('dialog', { class: 'xp-dialog' });
    dialog.addEventListener('cancel', () => dialog.replaceChildren());
    document.body.append(dialog);
  }
  dialog.replaceChildren(content);
  dialog.showModal();
  dialog.querySelectorAll('textarea').forEach(grow);
  new MutationObserver(() => dialog.querySelectorAll('textarea').forEach(grow)).observe(content, { childList: true, subtree: true });
  dialog.querySelector('input, textarea')?.focus();
}
const closeDialog = () => { dialog.close(); dialog.replaceChildren(); };

let fieldSeq = 0;
/** A labelled control; the label points at the control (or the first input inside it). */
function field(label, control, hint) {
  const target = control.matches('input, textarea, select') ? control : control.querySelector('input, textarea, select');
  if (target && !target.id) target.id = `xp-field-${++fieldSeq}`;
  return h('div', { class: 'form-row' }, h('label', { for: target?.id }, label), control, hint && h('div', { class: 'xp-hint' }, hint));
}

/** One translated field: English plus Bengali and Hindi, which fall back to English when empty. */
function tri(label, obj, { textarea = false, placeholder = '', hint = '' } = {}) {
  const notes = {};
  const inputs = {};
  const refresh = () => {
    const n = translationNotes(obj);
    for (const l of ['bn', 'hi']) {
      inputs[l].placeholder = obj.en ? `${obj.en}` : '';
      notes[l].textContent = n[l] || '';
    }
  };
  const cell = (l) => {
    const attrs = {
      lang: l, value: obj[l] || '', 'aria-label': `${label} (${LANG_NAMES[l]})`,
      placeholder: l === 'en' ? placeholder : '',
      oninput: (e) => { obj[l] = e.target.value; refresh(); if (textarea) grow(e.target); },
    };
    inputs[l] = textarea ? h('textarea', { ...attrs, rows: 3 }) : h('input', { ...attrs, type: 'text' });
    notes[l] = h('div', { class: 'xp-warn', 'aria-live': 'polite' });
    return h('div', { class: 'xp-lang' }, h('span', { class: 'xp-lang-tag' }, LANG_NAMES[l]), inputs[l], l !== 'en' && notes[l]);
  };
  const box = h('div', { class: 'form-row xp-tri' },
    h('label', {}, label),
    h('div', { class: 'xp-tri-grid' }, LANGS.map(cell)),
    hint && h('div', { class: 'xp-hint' }, hint),
  );
  refresh();
  return box;
}

function dialogShell(title, body, onSave) {
  const errors = h('div', { class: 'xp-errors', role: 'alert' });
  const form = h('form', { class: 'xp-form', novalidate: true },
    h('div', { class: 'xp-dialog-head' }, h('h3', {}, title), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: closeDialog }, 'Cancel')),
    h('p', { class: 'xp-hint xp-lang-note' }, 'Bengali and Hindi are optional: left empty, the page shows the English there.'),
    body,
    errors,
    h('div', { class: 'btn-row' },
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: closeDialog }, 'Cancel')),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const problems = onSave();
    if (problems && problems.length) {
      errors.replaceChildren(h('strong', {}, 'Fix these first:'), h('ul', {}, problems.map((p) => h('li', {}, p.charAt(0).toUpperCase() + p.slice(1)))));
      errors.scrollIntoView({ block: 'nearest' });
      return;
    }
    closeDialog();
  });
  return form;
}

function editRole(ri) {
  const isNew = ri == null;
  const r = isNew ? blankRole('') : clone(state.draft.roles[ri]);
  const present = h('input', { type: 'checkbox', checked: !r.end, onchange: (e) => { r.end = e.target.checked ? '' : r.end; to.disabled = e.target.checked; if (e.target.checked) to.value = ''; } });
  const to = h('input', { type: 'month', value: r.end, disabled: !r.end, oninput: (e) => { r.end = e.target.value; } });
  const body = [
    tri('Title', r.title, { placeholder: 'AI Product Manager' }),
    tri('Company', r.company, { placeholder: 'Zoca', hint: 'The company name, linked when you add a link below.' }),
    field('Company link', h('input', { type: 'url', value: r.companyUrl, placeholder: 'https://…', oninput: (e) => { r.companyUrl = e.target.value.trim(); } }), 'Optional.'),
    tri('Location', r.location),
    h('div', { class: 'form-grid' },
      field('From', h('input', { type: 'month', value: r.start, required: true, oninput: (e) => { r.start = e.target.value; } })),
      field('To', h('div', { class: 'xp-to' }, to, h('label', { class: 'xp-check' }, present, 'Present'))),
    ),
    tri('Description', r.description, { textarea: true, hint: 'Optional, shown under the dates. Add a link like [AI receptionist](https://zoca.com/front-desk-agent). Bengali and Hindi fall back to English.' }),
  ];
  openDialog(dialogShell(isNew ? 'Add role' : `Edit role: ${pick(r.title, 'en')}`, body, () => {
    const roles = state.draft.roles;
    if (isNew) r.id = uniqueId(pick(r.company, 'en') || pick(r.title, 'en') || 'role', roles.map((x) => x.id));
    const problems = validateExperience({ roles: [r] }).map((p) => p.replace(/^Role 1( \([^)]*\))?: /, ''));
    if (problems.length) return problems;
    const name = `${pick(r.title, 'en')}, ${pick(r.company, 'en')}`;
    if (isNew) {
      roles.unshift(r);
      change(`add role ${name}`);
    } else {
      roles[ri] = r;
      change(`edit role ${name}`);
    }
    return [];
  }));
}

function editCard(ri, ci) {
  const role = state.draft.roles[ri];
  role.cards = role.cards || [];
  const isNew = ci == null;
  const c = isNew ? blankCard('') : clone(role.cards[ci]);
  c.bullets = c.bullets && c.bullets.length ? c.bullets : [{ en: '', bn: '', hi: '' }];
  let suggested = suggestDelta(c.before, c.after);
  const delta = h('input', { type: 'text', value: c.delta, placeholder: '2× or −32%', oninput: (e) => { c.delta = e.target.value; } });
  const onValue = (key) => (e) => {
    c[key] = e.target.value;
    const next = suggestDelta(c.before, c.after);
    if (!c.delta || c.delta === suggested) { c.delta = next; delta.value = next; }
    suggested = next;
  };
  const bulletsBox = h('div', { class: 'xp-bullets' });
  const drawBullets = () => {
    bulletsBox.replaceChildren(
      ...c.bullets.map((b, i) => h('div', { class: 'xp-bullet' },
        tri(`Bullet ${i + 1}`, b, { textarea: true, hint: i === 0 ? 'What you did. Start with a verb; links like [text](https://…) work.' : '' }),
        c.bullets.length > 1 && h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { c.bullets.splice(i, 1); drawBullets(); } }, `Remove bullet ${i + 1}`))),
      c.bullets.length < 4 && h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { c.bullets.push({ en: '', bn: '', hi: '' }); drawBullets(); } }, '+ Add bullet'),
    );
  };
  drawBullets();
  const body = [
    tri('Metric', c.metric, { placeholder: 'Customer appointments booked for businesses' }),
    h('div', { class: 'xp-values-grid' },
      field('Before', h('input', { type: 'text', value: c.before, placeholder: '26%', oninput: onValue('before') })),
      field('After', h('input', { type: 'text', value: c.after, placeholder: '53%', oninput: onValue('after') })),
      field('Change', delta, 'Filled in from before and after; edit freely.'),
    ),
    tri('Unit', c.unit, { placeholder: 'of conversations', hint: 'Shown after the values, for example “of calls” or “per 100 calls”.' }),
    h('label', { class: 'xp-check' }, h('input', { type: 'checkbox', checked: !!c.grid, onchange: (e) => { c.grid = e.target.checked; } }), 'Show the 10×10 grid (before and after are out of 100)'),
    h('div', { class: 'xp-section-label' }, 'Bullets (2-3 read best)'),
    bulletsBox,
  ];
  openDialog(dialogShell(isNew ? `Add card to ${pick(role.company, 'en')}` : `Edit card: ${pick(c.metric, 'en')}`, body, () => {
    c.bullets = c.bullets.filter((b) => pick(b, 'en'));
    if (isNew) c.id = uniqueId(pick(c.metric, 'en') || 'card', role.cards.map((x) => x.id));
    const test = { ...clone(role), cards: [c] };
    const problems = validateExperience({ roles: [test] }).map((p) => p.replace(/^Role 1( \([^)]*\))?, card 1( \([^)]*\))?: /, ''));
    if (!c.bullets.length) c.bullets = [{ en: '', bn: '', hi: '' }];
    if (problems.length) { drawBullets(); return problems; }
    const name = pick(c.metric, 'en');
    if (isNew) {
      role.cards.push(c);
      change(`add card “${name}” (${pick(role.company, 'en')})`);
    } else {
      role.cards[ci] = c;
      change(`edit card “${name}” (${pick(role.company, 'en')})`);
    }
    return [];
  }));
}

// ─── Preview: the real page with your draft, before anything is published ───

const PREVIEW_SHIM = `(function(){var s=Storage.prototype.setItem;Storage.prototype.setItem=function(k){if(k==='lang'||k==='theme')return;return s.apply(this,arguments)};var r=History.prototype.replaceState;History.prototype.replaceState=function(){try{return r.apply(this,arguments)}catch(e){}}})();`;

async function preview() {
  const problems = validateExperience(state.draft);
  if (problems.length) return alert(`Fix these before previewing:\n\n${problems.join('\n')}`);
  let page;
  try {
    const res = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' });
    page = applyExperience(await res.text(), state.draft, 'preview');
  } catch (e) {
    return alert(`Couldn't build the preview: ${e.message}`);
  }
  page = page
    .replace(/<script defer src="\/analytics\.js"><\/script>/, '')
    .replace('<head>', `<head><base href="${location.origin}/"><script>${PREVIEW_SHIM}</script>`);
  const frame = h('iframe', { class: 'xp-frame', title: 'Preview of the landing page with your changes' });
  const sizes = h('div', { class: 'mx-toggle', role: 'group', 'aria-label': 'Preview width' },
    h('button', { type: 'button', class: 'active', onclick: (e) => size(e, '100%') }, 'Desktop'),
    h('button', { type: 'button', onclick: (e) => size(e, '390px') }, 'Phone'));
  function size(e, w) {
    frame.style.width = w;
    sizes.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.target));
  }
  const close = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => overlay.remove() }, 'Close');
  const overlay = h('div', { class: 'xp-preview', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Preview' },
    h('div', { class: 'xp-preview-bar' },
      h('strong', {}, 'Preview, not published'),
      sizes,
      h('span', { class: 'xp-spacer' }),
      close),
    h('div', { class: 'xp-preview-stage' }, frame));
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  frame.addEventListener('load', () => {
    try { frame.contentDocument.getElementById('experience')?.scrollIntoView(); } catch { /* cross-origin never happens here */ }
  });
  document.body.append(overlay);
  frame.srcdoc = page;
  close.focus();
}

// ─── Connecting GitHub ──────────────────────────────────────────────────────

function openConnect(reason) {
  const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…', 'aria-label': 'GitHub token' });
  const errors = h('div', { class: 'xp-errors', role: 'alert' });
  const form = h('form', { class: 'xp-form', novalidate: true },
    h('div', { class: 'xp-dialog-head' }, h('h3', {}, 'Connect GitHub'), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: closeDialog }, 'Cancel')),
    typeof reason === 'string' && h('p', {}, reason),
    h('p', {}, 'Publishing commits ', h('code', {}, FILE), ' with a token that only this browser keeps. Make one once:'),
    h('ol', { class: 'xp-steps' },
      h('li', {}, 'Open ', h('a', { href: TOKEN_HELP, target: '_blank', rel: 'noopener' }, 'GitHub → New fine-grained token'), '.'),
      h('li', {}, 'Repository access: ', h('b', {}, 'Only select repositories'), ', then ', h('b', {}, `${OWNER}/${REPO}`), '.'),
      h('li', {}, 'Permissions: ', h('b', {}, 'Contents → Read and write'), '. Nothing else is needed.'),
      h('li', {}, 'Generate the token and paste it here.')),
    field('Token', input, 'Stored in this browser only (localStorage) and sent only to api.github.com. Disconnect removes it.'),
    errors,
    h('div', { class: 'btn-row' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Connect')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = input.value.trim();
    const fail = (msg) => errors.replaceChildren(msg);
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) return fail('That doesn’t look like a GitHub token (they start with github_pat_).');
    fail('Checking…');
    try {
      const repo = await gh('', { token });
      if (repo.status === 401) return fail('GitHub rejected this token. Check it was copied whole and hasn’t expired.');
      if (repo.status === 404) return fail(`This token can’t see ${OWNER}/${REPO}. Give it access to that repository.`);
      const file = await gh(`/contents/${FILE}?ref=${BRANCH}`, { token });
      if (file.status === 404) return fail(`${FILE} isn’t on GitHub yet. Publishing works once this feature is released.`);
      if (!file.ok) return fail(`GitHub returned ${file.status}.`);
      localStorage.setItem(TOKEN_KEY, token);
      state.user = await whoAmI(token);
      closeDialog();
      await load(); // from GitHub now; a draft made against the same version comes back with it
    } catch (err) {
      fail(`Couldn’t reach GitHub: ${err.message}`);
    }
  });
  openDialog(form);
}

// ─── Publishing ─────────────────────────────────────────────────────────────

function commitMessage() {
  const list = state.changes.length ? state.changes : ['update the experience section'];
  const head = list.length > 2 ? `${list.slice(0, 2).join('; ')} and ${list.length - 2} more` : list.join('; ');
  return `experience: ${head}\n\n${list.map((c) => `- ${c}`).join('\n')}\n\nPublished from admin.html (Experience).`;
}

async function publish() {
  if (!canPublish()) {
    state.log = { info: `Publishing works on ${LIVE_ORIGIN}/admin.html. Here you can edit and preview; your changes stay saved in this browser.` };
    return render();
  }
  if (!getToken()) return openConnect('Connect GitHub to publish.');
  const problems = validateExperience(state.draft);
  if (problems.length) {
    state.log = { error: `Fix these first: ${problems.join(' ')}` };
    return render();
  }
  state.publishing = true;
  state.log = null;
  render();
  try {
    if (!state.sha) {
      const cur = await gh(`/contents/${FILE}?ref=${BRANCH}`);
      if (!cur.ok) throw new Error(`GitHub returned ${cur.status} while reading ${FILE}.`);
      const j = await cur.json();
      if (`${decodeBase64(j.content).replace(/\n?$/, '\n')}` !== state.publishedRaw) {
        throw new Error(`${FILE} changed on GitHub since this page loaded it. Reload to get the latest; your unpublished edits are set aside, not lost.`);
      }
      state.sha = j.sha;
    }
    const raw = serialize(state.draft);
    const res = await gh(`/contents/${FILE}`, {
      method: 'PUT',
      body: JSON.stringify({ message: commitMessage(), content: encodeBase64(raw), sha: state.sha, branch: BRANCH }),
    });
    if (res.status === 409 || res.status === 422) throw new Error(`${FILE} changed on GitHub since you loaded it (maybe an edit on github.com). Reload to get the latest, then redo your edit.`);
    if (res.status === 401) throw new Error('GitHub rejected the token. Disconnect and connect a new one.');
    if (res.status === 403 || res.status === 404) throw new Error(`The token can’t write to ${OWNER}/${REPO}. Give it Contents: Read and write on that repository.`);
    if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);
    const j = await res.json();
    state.sha = j.content.sha;
    state.published = clone(state.draft);
    state.publishedRaw = raw;
    state.changes = [];
    state.notice = '';
    state.source = 'GitHub';
    localStorage.removeItem(DRAFT_KEY);
    state.log = { commitUrl: j.commit.html_url, commitSha: j.commit.sha.slice(0, 7), phase: location.origin === LIVE_ORIGIN ? 'building' : 'committed', waited: 0 };
    if (location.origin === LIVE_ORIGIN) watchLive(await shortHash(raw), Date.now(), state.log);
  } catch (e) {
    state.log = { error: e.message };
  } finally {
    state.publishing = false;
    render();
  }
}

/** Poll the live page until the Action's rebuild (stamped with the JSON's hash) is served. */
async function watchLive(hash, started, log) {
  while (state.log === log && log.phase === 'building') {
    await new Promise((r) => setTimeout(r, 5000));
    log.waited = Math.round((Date.now() - started) / 1000);
    try {
      const page = await (await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' })).text();
      if ((page.match(HASH_RE) || [])[1] === hash) log.phase = 'live';
    } catch { /* keep waiting */ }
    if (log.phase === 'building' && log.waited > 360) log.phase = 'slow';
    if (state.log === log) renderLog();
  }
}

// The tab handler in admin.html calls this the first time Experience opens.
window.xpAdminOpen = () => { if (!state.draft) load(); };
if (document.getElementById('tabExperience')?.classList.contains('active')) load();
