// Admin console → Jobs: the day's ten curated product-manager postings, a
// cover letter and contact emails for the ones worth applying to, and the
// search settings.
//
// Nothing about the search lives in this (public) repository. The backend is
// the private NavajitD/jobhunt repository: a GitHub Action there pulls and
// curates postings every morning and commits the result as JSON, and another
// drafts a letter when asked. This page reads and writes those files, and
// starts those Actions, through the GitHub API with a token that stays in
// this browser. The model key is a secret on that repository; it never comes
// here.

const OWNER = 'NavajitD';
const REPO = 'jobhunt';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const ACTIONS_URL = `https://github.com/${OWNER}/${REPO}/actions`;
const TOKEN_KEYS = ['jobs.githubToken', 'xp.githubToken']; // its own token, else the Experience tab's
const TOKEN_HELP = 'https://github.com/settings/personal-access-tokens';
const DRAFT_WAIT_MS = 6 * 60 * 1000;

// The geographies the backend can search. Keep in step with src/geo.js in the
// jobhunt repository (its tests compare the two).
export const GEOS = [
  ['in', 'India'], ['ae', 'UAE'], ['sa', 'Saudi Arabia'], ['sg', 'Singapore'], ['gb', 'United Kingdom'], ['ie', 'Ireland'],
  ['de', 'Germany'], ['nl', 'Netherlands'], ['eu', 'Rest of Europe'], ['jp', 'Japan'], ['au', 'Australia'], ['ca', 'Canada'],
  ['us', 'United States'], ['sea', 'Southeast Asia (ex-Singapore)'],
];

const root = document.getElementById('jobsAdmin');
const state = {
  loaded: false, loading: false, error: '', notice: '',
  user: '', days: [], day: null, date: '',
  settings: null, settingsSha: null,
  marks: {}, marksSha: null,        // data/state.json: what you did with each job
  resume: null,
  drafts: {},                        // job id → draft file contents
  hasDraft: new Set(),               // job ids with a draft on GitHub
  open: new Set(),                   // job ids whose draft panel is open
  pending: {},                       // job id → { since, note }
  run: null,                         // a "Run now" in flight: { since, note }
};

// ─── Small helpers ──────────────────────────────────────────────────────────

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
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
const getToken = () => TOKEN_KEYS.map((k) => localStorage.getItem(k)).find(Boolean) || '';
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : '#');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const countWords = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

const encodeBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const decodeBase64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\s/g, '')), (c) => c.charCodeAt(0)));

export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const days = Math.floor((now - new Date(iso).getTime()) / 864e5);
  if (!Number.isFinite(days)) return '';
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

export function gmailUrl({ to, subject, body }) {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to: to || '', su: subject || '', body: body || '' });
  return `https://mail.google.com/mail/?${q}`;
}

// ─── GitHub ─────────────────────────────────────────────────────────────────

class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function gh(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const t = token ?? getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path.startsWith('https://') ? path : API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new GitHubError(res.status, data?.message || `GitHub returned ${res.status}`);
  return data;
}

/** Read a JSON file from the repository. A missing file gives { json: fallback, sha: null }. */
async function readFile(path, fallback) {
  try {
    const f = await gh(`/contents/${path}?ref=${BRANCH}`);
    return { json: JSON.parse(decodeBase64(f.content)), sha: f.sha };
  } catch (e) {
    if (e.status === 404 && fallback !== undefined) return { json: fallback, sha: null };
    throw e;
  }
}

async function writeFile(path, content64, sha, message) {
  const r = await gh(`/contents/${path}`, { method: 'PUT', body: { message, content: content64, branch: BRANCH, ...(sha ? { sha } : {}) } });
  return r.content.sha;
}
const jsonBase64 = (v) => encodeBase64(new TextEncoder().encode(`${JSON.stringify(v, null, 2)}\n`));

const dispatch = (workflow, inputs = {}) => gh(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: { ref: BRANCH, inputs } });

async function lastRun(workflow, since) {
  const d = await gh(`/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=5`);
  return (d.workflow_runs || []).find((r) => new Date(r.created_at).getTime() >= since - 15000) || null;
}

// ─── Loading ────────────────────────────────────────────────────────────────

function explain(e) {
  if (e.status === 401) return 'GitHub rejected the saved token. Connect a new one.';
  if (e.status === 404) return `The saved token can’t see ${OWNER}/${REPO}. Give it access to that repository (Contents and Actions, read and write), then press Check again.`;
  if (e.status === 403) return `GitHub refused: ${e.message}`;
  return `Couldn’t reach GitHub: ${e.message}`;
}

async function load(date) {
  if (!getToken()) { state.loaded = true; state.error = ''; return render(); }
  state.loading = true; state.error = '';
  render();
  try {
    // A private repository the token can't see answers 404 for everything,
    // which would otherwise read as "no data yet". Ask for the repository first.
    await gh('');
    const [index, settings, marks, resume, drafts] = await Promise.all([
      readFile('data/index.json', { days: [] }),
      readFile('data/settings.json', {}),
      readFile('data/state.json', {}),
      readFile('data/profile/resume.json', null),
      gh(`/contents/data/drafts?ref=${BRANCH}`).catch((e) => { if (e.status === 404) return []; throw e; }),
    ]);
    state.days = index.json.days || [];
    state.settings = settings.json; state.settingsSha = settings.sha;
    state.marks = marks.json || {}; state.marksSha = marks.sha;
    state.resume = resume.json;
    state.hasDraft = new Set((Array.isArray(drafts) ? drafts : []).map((f) => f.name.replace(/\.json$/, '')));
    state.date = date || state.days[0]?.date || '';
    state.day = state.date ? (await readFile(`data/daily/${state.date}.json`, null)).json : null;
    if (!state.user) gh('https://api.github.com/user').then((u) => { state.user = u.login || ''; render(); }).catch(() => {});
  } catch (e) {
    state.error = explain(e);
  }
  state.loading = false; state.loaded = true;
  render();
}

// ─── Actions on a job ───────────────────────────────────────────────────────

async function mark(job, status) {
  const prev = state.marks[job.id];
  const next = { ...state.marks };
  if (prev?.status === status) delete next[job.id];
  else next[job.id] = { status, at: new Date().toISOString(), title: job.title, company: job.company };
  state.marks = next;
  render();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        state.marksSha = await writeFile('data/state.json', jsonBase64(state.marks), state.marksSha, `state: ${prev?.status === status ? 'clear' : status} "${job.title}" at ${job.company}`);
        break;
      } catch (e) {
        if (e.status !== 409 || attempt) throw e;
        const fresh = await readFile('data/state.json', {});   // changed underneath us: reapply on top
        state.marksSha = fresh.sha;
        state.marks = { ...fresh.json, ...(next[job.id] ? { [job.id]: next[job.id] } : {}) };
        if (!next[job.id]) delete state.marks[job.id];
      }
    }
  } catch (e) {
    state.marks = { ...state.marks, ...(prev ? { [job.id]: prev } : {}) };
    if (!prev) delete state.marks[job.id];
    state.notice = `Couldn’t save that: ${e.message}`;
  }
  render();
}

async function loadDraft(id) {
  const f = await readFile(`data/drafts/${id}.json`, null);
  if (f.json) { state.drafts[id] = f.json; state.hasDraft.add(id); }
  return f.json;
}

async function toggleDraft(job) {
  if (state.open.has(job.id)) { state.open.delete(job.id); return render(); }
  state.open.add(job.id);
  render();
  if (state.hasDraft.has(job.id) && !state.drafts[job.id]) {
    try { await loadDraft(job.id); } catch (e) { state.notice = explain(e); }
    render();
  } else if (!state.hasDraft.has(job.id) && !state.pending[job.id]) requestDraft(job, '');
}

async function requestDraft(job, steer) {
  const since = Date.now();
  const p = { since, note: 'Asking GitHub to start the draft…' };
  state.pending[job.id] = p;
  render();
  const update = (note) => { p.note = note; if (state.pending[job.id] === p) renderJob(job.id); };
  try {
    await dispatch('draft.yml', { job_id: job.id, steer: steer || '' });
    update('Started. Reading the posting, planning, writing and checking the letter, and looking for contacts. About a minute.');
    let failed = null;
    while (Date.now() - since < DRAFT_WAIT_MS && state.pending[job.id] === p) {
      await sleep(Number(localStorage.getItem('jobs.pollMs')) || 5000);
      const d = await loadDraft(job.id).catch(() => null);
      if (d && new Date(d.generatedAt).getTime() >= since - 15000) { failed = false; break; }
      if (Date.now() - since > 45000) {
        const run = await lastRun('draft.yml', since).catch(() => null);
        if (run?.status === 'completed' && run.conclusion !== 'success') {
          // The run writes an error record before failing; give its commit a moment.
          await sleep(3000);
          const again = await loadDraft(job.id).catch(() => null);
          failed = !(again && new Date(again.generatedAt).getTime() >= since - 15000);
          if (failed) state.drafts[job.id] = { status: 'error', errors: [`The draft run failed (${run.conclusion}).`], runUrl: run.html_url };
          break;
        }
      }
      update(`Working… ${Math.round((Date.now() - since) / 1000)}s`);
    }
    if (failed === null && state.pending[job.id] === p) state.drafts[job.id] = { status: 'error', errors: ['No draft after six minutes. Check the run on GitHub.'], runUrl: ACTIONS_URL };
    localStorage.removeItem(`jobs.letter.${job.id}`);
  } catch (e) {
    state.drafts[job.id] = { status: 'error', errors: [e.status === 403 || e.status === 404 ? 'The token can’t start workflows. Give it Actions: Read and write on the jobhunt repository.' : explain(e)] };
  }
  if (state.pending[job.id] === p) delete state.pending[job.id];
  render();
}

async function runNow() {
  const since = Date.now();
  state.run = { since, note: 'Starting the search…' };
  render();
  try {
    await dispatch('daily.yml');
    while (state.run && Date.now() - since < 20 * 60 * 1000) {
      await sleep(Number(localStorage.getItem('jobs.pollMs')) || 8000);
      const run = await lastRun('daily.yml', since).catch(() => null);
      if (run?.status === 'completed') {
        if (run.conclusion !== 'success') { state.notice = `The search run failed (${run.conclusion}). `; state.runUrl = run.html_url; }
        break;
      }
      state.run.note = `Searching… ${Math.round((Date.now() - since) / 1000)}s (usually three to five minutes)`;
      renderToolbarNote();
    }
  } catch (e) {
    state.notice = e.status === 403 || e.status === 404 ? 'The token can’t start workflows. Give it Actions: Read and write on the jobhunt repository.' : explain(e);
  }
  state.run = null;
  await load();
}

// ─── Rendering ──────────────────────────────────────────────────────────────

const GRADE = {
  verified: ['Verified', 'jb-ok', 'A verifier confirmed this mailbox exists.'],
  published: ['Published', 'jb-ok', 'The company printed this address itself.'],
  found: ['Unconfirmed', 'jb-warn', 'Seen in use by a lookup service, but the mailbox could not be confirmed.'],
};

function letterText(job, d) {
  return localStorage.getItem(`jobs.letter.${job.id}`) ?? d.letter?.body ?? '';
}

function draftPanel(job) {
  const p = state.pending[job.id];
  if (p) return h('div', { class: 'jb-draft' }, h('div', { class: 'xp-loading jb-wait' }, h('div', { class: 'spinner spinner-dark' }), h('span', { class: 'jb-wait-note' }, p.note)));
  const d = state.drafts[job.id];
  if (!d) return h('div', { class: 'jb-draft' }, h('div', { class: 'xp-loading jb-wait' }, h('div', { class: 'spinner spinner-dark' }), 'Loading the draft…'));

  const box = h('div', { class: 'jb-draft' });
  for (const err of d.errors || []) box.append(h('div', { class: 'alert alert-error show xp-alert' }, err, d.runUrl && [' ', h('a', { href: safeUrl(d.runUrl), target: '_blank', rel: 'noopener' }, 'Open the run')]));

  let area = null;
  if (d.letter) {
    const count = h('span', { class: 'jb-count' });
    area = h('textarea', { class: 'jb-letter', rows: '16', spellcheck: 'true', 'aria-label': `Cover letter for ${job.title} at ${job.company}` });
    area.value = letterText(job, d);
    const recount = () => { count.textContent = `${countWords(area.value)} words`; };
    area.addEventListener('input', () => { localStorage.setItem(`jobs.letter.${job.id}`, area.value); recount(); refreshLinks(); });
    recount();
    const copy = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: async () => { await navigator.clipboard.writeText(area.value); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy letter'; }, 1500); } }, 'Copy letter');
    box.append(
      h('div', { class: 'jb-draft-head' }, h('strong', {}, 'Cover letter'), count, h('span', { class: 'xp-spacer' }), copy),
      area,
      d.letter.checks?.passed
        ? h('div', { class: 'xp-hint' }, 'Checked: length, no stock phrases, and every figure appears in your résumé, your site or the posting. Edit freely; your edits stay in this browser.')
        : h('div', { class: 'xp-hint xp-warn' }, 'Read this one closely. The automatic check still flags: ', (d.letter.checks?.issues || []).join(' ')),
      (d.letter.plan?.needs || []).length ? h('details', { class: 'jb-plan' }, h('summary', {}, 'What the letter was built on'),
        h('ul', {}, d.letter.plan.needs.map((n) => h('li', {}, h('b', {}, n.need), ': ', n.evidence))),
        d.letter.plan.hook && h('p', {}, h('b', {}, 'Hook: '), d.letter.plan.hook)) : null,
    );
  }

  const steer = h('input', { type: 'text', class: 'jb-steer', placeholder: 'Optional: what to emphasise or change (e.g. “lead with the voice agent work”)', 'aria-label': 'Note for the redraft', value: d.steer || '' });
  box.append(h('div', { class: 'jb-redraft' }, steer, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => requestDraft(job, steer.value.trim()) }, d.letter ? 'Redraft' : 'Try again')));

  const links = [];
  const refreshLinks = () => { for (const [a, to] of links) a.href = gmailUrl({ to, subject: d.letter?.subject || `${job.title} application`, body: area ? area.value : '' }); };
  const c = d.contacts;
  if (c) {
    const list = h('div', { class: 'jb-contacts' }, h('strong', {}, 'Where to send it'));
    if (c.domainSource === 'guessed from the name' && c.emails.length) list.append(h('div', { class: 'xp-hint xp-warn' }, `The company website (${c.domain}) was guessed from its name. Check it is the right company before using these addresses.`));
    for (const e of c.emails || []) {
      const [label, cls, tip] = GRADE[e.grade] || GRADE.found;
      const a = h('a', { class: 'btn btn-primary btn-sm', target: '_blank', rel: 'noopener' }, 'Open in Gmail');
      links.push([a, e.email]);
      const copy = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: async () => { await navigator.clipboard.writeText(e.email); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); } }, 'Copy');
      list.append(h('div', { class: 'jb-contact' },
        h('div', { class: 'jb-contact-main' },
          h('div', {}, h('span', { class: 'jb-email' }, e.email), h('span', { class: `xp-badge ${cls}`, title: tip }, label)),
          h('div', { class: 'xp-item-meta' }, [e.name && `${e.name}${e.title ? `, ${e.title}` : ''}`, e.kind === 'inbox' && !e.name && 'Shared inbox', e.detail].filter(Boolean).join(' · '),
            e.linkedin && [' · ', h('a', { href: safeUrl(e.linkedin), target: '_blank', rel: 'noopener' }, 'LinkedIn')])),
        h('div', { class: 'xp-actions' }, a, copy)));
    }
    for (const p of c.people || []) {
      list.append(h('div', { class: 'jb-contact' }, h('div', { class: 'jb-contact-main' },
        h('div', {}, h('span', { class: 'jb-email' }, p.name), p.title && h('span', { class: 'xp-item-meta' }, ` ${p.title}`)),
        h('div', { class: 'xp-item-meta' }, p.note, p.linkedin && [' ', h('a', { href: safeUrl(p.linkedin), target: '_blank', rel: 'noopener' }, 'Profile')]))));
    }
    for (const n of c.notes || []) list.append(h('div', { class: 'xp-hint' }, n));
    if ((c.emails || []).length) list.append(h('div', { class: 'xp-hint' }, 'Gmail opens with the letter filled in. Attach your résumé before sending, and apply on the posting as well.'));
    box.append(list);
    refreshLinks();
  }
  return box;
}

function jobCard(job, i) {
  const m = state.marks[job.id];
  const others = (job.links || []).filter((l) => l.url !== job.url);
  const yoe = job.yoe || {};
  const card = h('article', { class: `jb-job${m ? ` is-${m.status}` : ''}`, 'data-job': job.id },
    h('div', { class: 'jb-job-head' },
      h('div', { class: 'jb-job-main' },
        h('h3', { class: 'jb-title' }, h('span', { class: 'jb-rank' }, `${i + 1}.`), ' ', h('a', { href: safeUrl(job.url), target: '_blank', rel: 'noopener' }, job.title)),
        h('div', { class: 'jb-meta' }, [job.company, job.location, job.postedAt && `posted ${ago(job.postedAt)}`, job.salary].filter(Boolean).join(' · ')),
        h('div', { class: 'jb-meta' },
          h('span', { class: yoe.stated ? '' : 'xp-warn' }, `Experience asked: ${yoe.label || 'not stated'}`), ' · ',
          `via ${(job.sources || [job.source]).join(', ')}`,
          others.map((l) => [' · ', h('a', { href: safeUrl(l.url), target: '_blank', rel: 'noopener' }, `also on ${l.source}`)]),
          job.thinDescription && [' · ', h('span', { class: 'xp-warn' }, 'the board gave no full description')])),
      h('div', { class: 'jb-score', title: job.llm ? 'Fit, as scored by the model against your résumé and site' : 'Keyword score (the model did not score this run)' }, String(job.score), !job.llm && h('span', { class: 'jb-score-note' }, 'kw'))),
    (job.why || []).length ? h('ul', { class: 'jb-why' }, job.why.map((w) => h('li', {}, w))) : null,
    job.gap ? h('div', { class: 'jb-gap' }, h('b', {}, 'Gap: '), job.gap) : null,
    h('details', { class: 'jb-desc' }, h('summary', {}, 'Posting'), h('div', { class: 'jb-desc-text' }, job.description || 'No description was available.')),
    h('div', { class: 'jb-actions' },
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'aria-expanded': String(state.open.has(job.id)), onclick: () => toggleDraft(job) }, state.open.has(job.id) ? 'Hide draft' : state.hasDraft.has(job.id) ? 'Show draft' : 'Draft cover letter'),
      h('a', { class: 'btn btn-secondary btn-sm', href: safeUrl(job.url), target: '_blank', rel: 'noopener' }, 'Apply online ↗'),
      h('span', { class: 'xp-spacer' }),
      h('button', { type: 'button', class: `btn btn-secondary btn-sm${m?.status === 'applied' ? ' is-on' : ''}`, 'aria-pressed': String(m?.status === 'applied'), onclick: () => mark(job, 'applied') }, m?.status === 'applied' ? `Applied ${ago(m.at)}` : 'Mark applied'),
      h('button', { type: 'button', class: `btn btn-secondary btn-sm${m?.status === 'skipped' ? ' is-on' : ''}`, 'aria-pressed': String(m?.status === 'skipped'), onclick: () => mark(job, 'skipped') }, m?.status === 'skipped' ? 'Skipped' : 'Skip')),
    state.open.has(job.id) ? draftPanel(job) : null,
  );
  return card;
}

function renderJob(id) {
  const old = root.querySelector(`[data-job="${id}"]`);
  const i = (state.day?.jobs || []).findIndex((j) => j.id === id);
  if (!old || i < 0) return render();
  // Typing in the letter must not be interrupted by a status tick elsewhere.
  if (old.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;
  old.replaceWith(jobCard(state.day.jobs[i], i));
}

function renderToolbarNote() {
  const el = root.querySelector('.jb-run-note');
  if (el && state.run) el.textContent = state.run.note;
}

function funnelText(day) {
  const f = day.stats?.funnel || {};
  const parts = [`${(f.fetched ?? 0).toLocaleString('en-IN')} postings pulled`];
  if (f.droppedTitle != null) parts.push(`${f.candidates} were PM roles in your geographies and new`);
  if (f.droppedYoe) parts.push(`${f.droppedYoe} asked for a different experience range`);
  if (f.scored != null) parts.push(`${f.scored} scored by ${f.scoredBy === 'model' ? 'the model' : 'keywords'}`);
  parts.push(`${day.jobs.length} shown`);
  return parts.join(' → ');
}

function connectionRow() {
  const token = getToken();
  return h('div', { class: 'xp-connect' },
    h('span', { class: `xp-dot${token && !state.error ? ' is-on' : ''}` }),
    token ? (state.error ? 'GitHub token saved, but it can’t read the jobs data' : `Connected to ${OWNER}/${REPO}${state.user ? ` as ${state.user}` : ''}`) : 'Not connected to GitHub',
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openConnect() }, token ? 'Change token' : 'Connect GitHub'));
}

function render() {
  if (!root) return;
  const kids = [
    h('p', { class: 'xp-intro' }, 'Every morning a private GitHub Action pulls product-manager postings for your geographies, keeps the ones whose experience range contains yours, and ranks them against your résumé and site. The ten best are here. Pick one and it drafts the letter and looks for an address worth writing to.'),
    connectionRow(),
  ];
  if (state.notice) kids.push(h('div', { class: 'alert alert-info show xp-alert', role: 'status' }, state.notice, state.runUrl && h('a', { href: safeUrl(state.runUrl), target: '_blank', rel: 'noopener' }, 'Open the run')));
  if (state.error) kids.push(h('div', { class: 'alert alert-error show xp-alert', role: 'alert' }, state.error, ' ', h('button', { type: 'button', class: 'bl-link', onclick: () => load() }, 'Check again')));

  if (!getToken()) {
    kids.push(h('p', { class: 'xp-muted' }, `Connect a GitHub token that can read ${OWNER}/${REPO} to see your jobs.`));
  } else if (state.loading && !state.day) {
    kids.push(h('div', { class: 'xp-loading' }, h('div', { class: 'spinner spinner-dark' }), 'Loading your jobs…'));
  } else if (!state.error) {
    const day = state.day;
    kids.push(h('div', { class: 'xp-toolbar' },
      state.days.length > 1
        ? h('select', { class: 'jb-day', 'aria-label': 'Day', onchange: (e) => load(e.target.value) }, state.days.map((d) => h('option', { value: d.date, selected: d.date === state.date }, `${d.date} (${d.count})`)))
        : h('strong', {}, state.date || 'No runs yet'),
      h('span', { class: 'xp-status jb-run-note' }, state.run ? state.run.note : day ? `Run at ${new Date(day.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''),
      h('span', { class: 'xp-spacer' }),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: openSettings }, 'Settings'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: Boolean(state.run), onclick: runNow }, state.run ? 'Searching…' : 'Run now')));
    if (!day) {
      kids.push(h('p', { class: 'xp-muted' }, 'The search hasn’t run yet. It runs every morning at 7:00 IST; press Run now to start one.'));
    } else {
      const f = day.stats?.funnel || {};
      if (f.scoredBy !== 'model') kids.push(h('div', { class: 'alert alert-info show xp-alert' }, `This run was ranked by keywords, not by the model${f.scoreError ? ` (${f.scoreError})` : ''}. Treat the order as rough.`));
      kids.push(h('details', { class: 'jb-funnel' },
        h('summary', {}, funnelText(day)),
        h('div', { class: 'jb-sources' }, Object.entries(day.stats?.perSource || {}).filter(([, n]) => n !== 'off').map(([s, n]) => h('span', { class: n ? '' : 'xp-warn' }, `${s} ${n}`))),
        (day.stats?.errors || []).map((e) => h('div', { class: 'xp-hint xp-warn' }, e)),
        h('div', { class: 'xp-hint' }, `Searched ${(day.settings?.geos || []).map((id) => (GEOS.find((g) => g[0] === id) || [id, id])[1]).join(', ')}${day.settings?.remote ? ' and remote' : ''} for roles whose experience range contains ${day.settings?.years} years.`)));
      if (!day.jobs.length) kids.push(h('p', { class: 'xp-muted' }, 'Nothing new cleared the bar on this day.'));
      kids.push(h('div', { class: 'jb-list' }, day.jobs.map(jobCard)));
    }
  }
  root.replaceChildren(...kids);
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

let dialog;
function openDialog(content) {
  if (!dialog) {
    dialog = h('dialog', { class: 'xp-dialog' });
    dialog.addEventListener('cancel', () => dialog.replaceChildren());
    document.body.append(dialog);
  }
  dialog.replaceChildren(content);
  dialog.showModal();
}
const closeDialog = () => { dialog.close(); dialog.replaceChildren(); };
let seq = 0;
function field(label, control, hint) {
  const target = control.matches('input, textarea, select') ? control : control.querySelector('input, textarea, select');
  if (target && !target.id) target.id = `jb-field-${++seq}`;
  return h('div', { class: 'form-row' }, h('label', { for: target?.id }, label), control, hint && h('div', { class: 'xp-hint' }, hint));
}

function openConnect() {
  const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
  const errors = h('div', { class: 'xp-errors', role: 'alert' });
  const check = async (token) => {
    await gh('', { token });
    await gh(`/contents/data/settings.json?ref=${BRANCH}`, { token });
  };
  const form = h('form', { class: 'xp-form', novalidate: true },
    h('div', { class: 'xp-dialog-head' }, h('h3', {}, 'Connect the jobs repository'), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: closeDialog }, 'Cancel')),
    h('p', {}, 'The jobs data lives in the private ', h('code', {}, `${OWNER}/${REPO}`), ' repository. This page needs a token that can read and write its files and start its workflows.'),
    h('ol', { class: 'xp-steps' },
      h('li', {}, 'Open ', h('a', { href: TOKEN_HELP, target: '_blank', rel: 'noopener' }, 'GitHub → Fine-grained tokens'), '. Edit the token you made for the Experience tab, or generate a new one.'),
      h('li', {}, 'Repository access: include ', h('b', {}, `${OWNER}/${REPO}`), '.'),
      h('li', {}, 'Permissions: ', h('b', {}, 'Contents → Read and write'), ' and ', h('b', {}, 'Actions → Read and write'), '.'),
      h('li', {}, 'If you edited the existing token, leave the box empty and press Connect. If you made a new one, paste it.')),
    field('Token (only if new)', input, 'Stored in this browser only (localStorage) and sent only to api.github.com.'),
    errors,
    h('div', { class: 'btn-row' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Connect'),
      localStorage.getItem(TOKEN_KEYS[0]) && h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { localStorage.removeItem(TOKEN_KEYS[0]); closeDialog(); load(); } }, 'Forget the jobs token')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pasted = input.value.trim();
    const token = pasted || getToken();
    const fail = (msg) => errors.replaceChildren(msg);
    if (!token) return fail('Paste a token.');
    if (pasted && !/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(pasted)) return fail('That doesn’t look like a GitHub token (they start with github_pat_).');
    fail('Checking…');
    try {
      await check(token);
      if (pasted) localStorage.setItem(TOKEN_KEYS[0], pasted);
      closeDialog();
      await load();
    } catch (err) {
      fail(err.status === 401 ? 'GitHub rejected this token. Check it was copied whole and hasn’t expired.'
        : err.status === 404 ? `This token can’t see ${OWNER}/${REPO} yet. Add the repository to it with Contents: Read and write.`
          : `Couldn’t reach GitHub: ${err.message}`);
    }
  });
  openDialog(form);
  input.focus();
}

function openSettings() {
  const s = JSON.parse(JSON.stringify(state.settings || {}));
  s.geos = Array.isArray(s.geos) ? s.geos : ['in'];
  s.yoe = s.yoe || { careerStart: '2023-07', override: null };
  const errors = h('div', { class: 'xp-errors', role: 'alert' });
  const status = h('span', { class: 'xp-status' });

  const geoBoxes = GEOS.map(([id, label]) => h('label', { class: 'xp-check jb-geo' }, h('input', { type: 'checkbox', value: id, checked: s.geos.includes(id) }), label));
  const remote = h('input', { type: 'checkbox', checked: Boolean(s.remote) });
  const start = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'YYYY-MM', value: s.yoe.careerStart || '' });
  const override = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'leave empty to count from the start month', value: s.yoe.override ?? '' });
  const avoid = h('input', { type: 'text', placeholder: 'e.g. Uplers, Turing', value: (s.avoidCompanies || []).join(', ') });
  const file = h('input', { type: 'file', accept: 'application/pdf' });
  const resumeNote = state.resume ? `Current résumé parsed ${ago(state.resume.parsedAt)} (${state.resume.pages} page, ${state.resume.characters.toLocaleString('en-IN')} characters).` : 'No résumé has been parsed yet.';

  const form = h('form', { class: 'xp-form', novalidate: true },
    h('div', { class: 'xp-dialog-head' }, h('h3', {}, 'Search settings'), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: closeDialog }, 'Close')),
    h('div', { class: 'xp-section-label' }, 'Geographies'),
    h('div', { class: 'jb-geos' }, geoBoxes),
    h('label', { class: 'xp-check' }, remote, 'Also show remote roles open to these geographies'),
    h('div', { class: 'xp-section-label' }, 'Years of experience'),
    h('div', { class: 'form-grid' },
      field('Career start (month)', start, 'Your years are counted from here, in whole years, so they stay current.'),
      field('Or fix the number', override, 'Only roles whose stated range contains this are kept.')),
    field('Companies to leave out', avoid, 'Staffing agencies and others you don’t want to see, comma-separated.'),
    h('div', { class: 'xp-section-label' }, 'Résumé'),
    field('Upload a new résumé (PDF)', file, `${resumeNote} Cover letters draw on it and on the Experience section of your site, archived points included.`),
    errors,
    h('div', { class: 'btn-row' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'), status));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fail = (msg) => { errors.replaceChildren(msg); status.textContent = ''; };
    const geos = geoBoxes.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
    if (!geos.length) return fail('Choose at least one geography.');
    const ov = override.value.trim();
    if (ov && !/^\d{1,2}$/.test(ov)) return fail('Years must be a whole number.');
    if (!ov && !/^\d{4}-(0[1-9]|1[0-2])$/.test(start.value.trim())) return fail('Career start must look like 2023-07.');
    const pdf = file.files[0];
    if (pdf && (pdf.type !== 'application/pdf' || pdf.size > 5 * 1024 * 1024)) return fail('The résumé must be a PDF under 5 MB.');
    const next = { ...s, geos, remote: remote.checked, yoe: { careerStart: start.value.trim() || s.yoe.careerStart, override: ov ? Number(ov) : null }, avoidCompanies: avoid.value.split(',').map((x) => x.trim()).filter(Boolean) };
    errors.replaceChildren();
    try {
      const changed = JSON.stringify(next) !== JSON.stringify(state.settings);
      if (changed) {
        status.textContent = 'Saving settings…';
        state.settingsSha = await writeFile('data/settings.json', jsonBase64(next), state.settingsSha, 'settings: update from the admin console');
        state.settings = next;
      }
      if (pdf) {
        status.textContent = 'Uploading the résumé…';
        const existing = await gh(`/contents/resume/resume.pdf?ref=${BRANCH}`).catch((err) => { if (err.status === 404) return null; throw err; });
        await writeFile('resume/resume.pdf', encodeBase64(new Uint8Array(await pdf.arrayBuffer())), existing?.sha, 'resume: upload from the admin console');
      }
      closeDialog();
      state.notice = [changed && 'Settings saved. They apply from the next search; press Run now to search again today.', pdf && 'Résumé uploaded. It is parsed within a minute and used from the next draft.'].filter(Boolean).join(' ') || '';
      render();
    } catch (err) {
      fail(err.status === 409 ? 'The settings changed on GitHub since this page loaded. Close, reload the tab and try again.' : `Couldn’t save: ${err.message}`);
    }
  });
  openDialog(form);
}

// The tab handler in admin.html calls this each time Jobs opens.
window.jobsAdminOpen = () => { if (!state.loaded && !state.loading) load(); };
if (document.getElementById('tabJobs')?.classList.contains('active')) load();
