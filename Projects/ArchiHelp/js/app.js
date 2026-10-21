// Vaastu Planner — application controller: routing, projects, engine worker pool.
import { h, $, clear, toast, download, pickFile, confirmDlg, prompt, when } from './dom.js';
import { listProjects, getProject, saveProject, deleteProject, newId } from './store.js';
import { renderWizard } from './wizard.js';
import { renderCatalogue } from './catalogue.js';
import { renderEditor } from './editor.js';
import { planThumbSvg } from './thumbs.js';
import { DEFAULT_CONFIG } from '../engine/config.js';
import { analysePlan } from '../engine/index.js';
import { cloneDoc } from '../engine/edits.js';

// ------------------------------------------------------------------------------------------------ engine pool
class EnginePool {
  constructor() {
    this.n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = []; this.seq = 0; this.pending = new Map();
  }
  worker(i) {
    if (!this.workers[i]) {
      const w = new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { const cb = this.pending.get(e.data.id); if (cb) cb(e.data); };
      w.onerror = (e) => { for (const [id, cb] of this.pending) if (cb.w === i) cb({ id, type: 'error', message: e.message || 'worker failed' }); };
      this.workers[i] = w;
    }
    return this.workers[i];
  }
  call(i, msg, onProgress) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const cb = (d) => {
        if (d.type === 'progress') { onProgress && onProgress(d); return; }
        this.pending.delete(id);
        if (d.type === 'error') reject(new Error(d.message)); else resolve(d);
      };
      cb.w = i;
      this.pending.set(id, cb);
      this.worker(i).postMessage({ ...msg, id });
    });
  }
  /** Search every skeleton across the workers, stream candidates, then polish the best in parallel. */
  async generate(cfg, { budget, perSkeleton = 4, relaxed = false, maxCandidates = 24, onProgress } = {}) {
    const c = relaxed ? { ...cfg, __minFrac: 0 } : cfg;
    const { count } = await this.call(0, { cmd: 'count', cfg: c });
    const shares = Array.from({ length: this.n }, () => []);
    for (let k = 0; k < count; k++) shares[k % this.n].push(k);
    const pool = []; let done = 0;
    const t0 = performance.now();
    await Promise.all(shares.map((sk, i) => (sk.length ? this.call(i, { cmd: 'search', cfg: c, skeletons: sk, budget, perSkeleton }, (d) => {
      done++; pool.push(...d.candidates);
      onProgress && onProgress({ phase: 'search', done, total: count, pool });
    }) : null)));
    // best per topology, then polish in parallel
    const best = new Map();
    for (const x of pool) { const p = best.get(x.key); if (!p || x.quality.score > p.quality.score) best.set(x.key, x); }
    const top = [...best.values()].sort((a, b) => b.quality.score - a.quality.score).slice(0, maxCandidates);
    onProgress && onProgress({ phase: 'polish', done: count, total: count, pool });
    const parts = Array.from({ length: this.n }, () => []);
    top.forEach((x, k) => parts[k % this.n].push(x));
    const polished = (await Promise.all(parts.map((p, i) => (p.length ? this.call(i, { cmd: 'rank', cfg: c, candidates: p, polish: { evals: 150 }, maxCandidates: p.length, polishMs: 12000 }) : { candidates: [] }))))
      .flatMap((r) => r.candidates);
    polished.sort((a, b) => b.quality.score - a.quality.score);
    polished.forEach((x, i) => { x.doc.id = i + 1; x.doc.label = `Option ${i + 1}`; });
    return { candidates: polished, stats: { skeletons: count, layouts: pool.length, topologies: best.size, ms: performance.now() - t0, workers: this.n } };
  }
  stop() { for (const w of this.workers) if (w) w.terminate(); this.workers = []; for (const [id, cb] of this.pending) cb({ id, type: 'error', message: 'stopped' }); this.pending.clear(); }
}

// ------------------------------------------------------------------------------------------------ projects
export function newProject(cfg = {}) {
  const c = { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), ...cfg };
  return { format: 'vaastu-planner-project', version: 1, id: newId(), name: c.project_name || 'New house', created: Date.now(), updated: Date.now(),
    cfg: c, drawing: { name: c.project_name || 'Residence', plan_label: '', rev: 'P1' }, plans: [], activePlan: 0, revisions: {}, candidates: [] };
}

function normaliseImported(p) {
  if (!p || p.format !== 'vaastu-planner-project' || !p.cfg || !Array.isArray(p.plans)) throw new Error('Not a Vaastu Planner project file.');
  return { revisions: {}, candidates: [], drawing: { name: p.name, plan_label: '', rev: 'P1' }, activePlan: 0, ...p, id: newId(), updated: Date.now() };
}

async function loadExample() {
  const r = await fetch(new URL('../examples/residence-rev9.json', import.meta.url));
  const p = normaliseImported(await r.json());
  p.name = 'Example house (final hand-sketch revision)';
  p.created = Date.now();
  const d = p.plans[0];
  d.pid = newId();
  if (p.drawing && p.drawing.plan_label) { d.meta = { ...(d.meta || {}), sheetLabel: p.drawing.plan_label }; delete p.drawing.plan_label; }
  p.revisions = { [d.pid]: [{ id: newId(), label: 'Revision 9 (final hand sketch)', time: Date.now(), doc: cloneDoc(d) }] };
  return p;
}

// ------------------------------------------------------------------------------------------------ app
const app = {
  pool: new EnginePool(),
  project: null,
  dirty: false,
  saveTimer: null,
  /** Persist soon (debounced) — every edit autosaves. */
  save(now = false) {
    if (!this.project) return;
    clearTimeout(this.saveTimer);
    const run = () => saveProject(this.project).catch((e) => toast(`Could not save: ${e.message}`, 'bad'));
    if (now) return run();
    this.saveTimer = setTimeout(run, 500);
  },
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  crumbs(items) {
    const nav = clear($('#crumbs'));
    items.forEach(([label, href], i) => {
      if (i) nav.append(h('span', { class: 'sep' }, '/'));
      nav.append(href ? h('a', { href }, label) : h('span', { class: 'cur' }, label));
    });
  },
  actions(nodes) { const el = clear($('#topActions')); for (const n of nodes || []) if (n) el.append(n); },
  toast,
};

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
  return clear(document.getElementById(id));
}

async function openProject(id) {
  if (app.project && app.project.id === id) return app.project;
  const p = await getProject(id);
  if (!p) { toast('That project is not in this browser.', 'bad'); app.go('#/'); return null; }
  app.project = p;
  return p;
}

async function route() {
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  for (const o of document.querySelectorAll('.overlay, .modal')) o.remove();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (!parts.length) return renderHome(show('screen-home'));
    if (parts[0] === 'new') { app.project = newProject(); return renderWizard(show('screen-wizard'), app, { fresh: true }); }
    if (parts[0] === 'p' && parts[1]) {
      const p = await openProject(parts[1]);
      if (!p) return;
      if (parts[2] === 'setup') return renderWizard(show('screen-wizard'), app, { step: parts[3] });
      if (parts[2] === 'options') return renderCatalogue(show('screen-catalogue'), app);
      if (parts[2] === 'plan') return renderEditor(show('screen-editor'), app, Number(parts[3] || 0));
      return app.go(p.plans.length ? `#/p/${p.id}/plan/${p.activePlan || 0}` : `#/p/${p.id}/setup`);
    }
    app.go('#/');
  } catch (e) {
    console.error(e);
    toast(`Something went wrong: ${e.message}`, 'bad', 6000);
  }
}

async function renderHome(root) {
  app.project = null;
  app.crumbs([]); app.actions([]);
  document.title = 'Vaastu Planner — parametric floor plans, 32-pada Vaastu checks, A3 drawing sets';
  const list = h('div', { class: 'plist' }, h('div', { class: 'empty' }, h('span', { class: 'spin' }), ' Loading your projects…'));
  root.append(h('div', { class: 'home' },
    h('div', {},
      h('h1', {}, 'Design a Vaastu-compliant floor plan'),
      h('p', { class: 'lede' }, 'Describe the plot, the rooms and your rules. The engine searches thousands of layouts, scores each against the 32 padas, NBC room sizes and a structural grid, and hands you the best options to edit — down to door swings, windows and furniture — and a dimensioned A3 drawing set.'),
      h('div', { class: 'start' },
        h('button', { class: 'opt', type: 'button', onclick: () => app.go('#/new') }, h('b', {}, 'New project'), h('span', {}, 'Guided setup: plot, building, rooms, Vaastu rules → layout options'), h('i', {}, '→')),
        h('button', { class: 'opt', type: 'button', onclick: async () => {
          try { const p = await loadExample(); app.project = p; await saveProject(p); app.go(`#/p/${p.id}/plan/0`); } catch (e) { toast(`Could not load the example: ${e.message}`, 'bad'); }
        } }, h('b', {}, 'Open the example'), h('span', {}, "A real 63' × 24' first floor — the final plan after nine hand-sketch revisions"), h('i', {}, '→')),
        h('button', { class: 'opt', type: 'button', onclick: async () => {
          const txt = await pickFile(); if (!txt) return;
          try { const p = normaliseImported(JSON.parse(txt)); await saveProject(p); app.project = p; app.go(`#/p/${p.id}`); toast('Project imported.'); } catch (e) { toast(e.message, 'bad'); }
        } }, h('b', {}, 'Import a project file'), h('span', {}, '.json exported from Vaastu Planner'), h('i', {}, '↑'))),
      h('div', { class: 'how' }, h('b', {}, 'How it works'),
        h('ol', {},
          h('li', {}, 'Setup wizard — plot and road side, floor heights, rooms, walls and columns, the Vaastu pada rules.'),
          h('li', {}, 'Options — the search runs on every CPU core in your browser; each layout is re-checked by an independent rule checker.'),
          h('li', {}, 'Editor — move walls to exact sizes, split / merge / swap rooms, place doors, openings and windows, arrange furniture. Every change is re-checked live.'),
          h('li', {}, 'Drawings — A-101 plan, A-102 Vaastu sectors, S-101 columns & beams, A-601 schedules (A3, 1:75, PDF).')),
        h('p', { class: 'small muted' }, 'Projects stay in this browser — no sign-in, nothing uploaded. Export a project file to keep a copy or move it to another device.'))),
    h('div', { class: 'projects' }, h('h2', {}, 'Your projects'), list)));
  const projects = await listProjects();
  clear(list);
  if (!projects.length) { list.append(h('div', { class: 'empty' }, 'No projects yet. Start a new one or open the example.')); return; }
  for (const p of projects) {
    const thumb = h('div', { class: 'thumb' });
    const doc = p.plans[p.activePlan || 0];
    let score = null;
    if (doc) {
      try { const r = planThumbSvg(p.cfg, doc, { labels: false }); thumb.innerHTML = r.svg; score = r.plan; } catch { /* broken plan: no thumbnail */ }
    }
    list.append(h('div', { class: 'pcard' }, thumb,
      h('div', {},
        h('h3', {}, p.name),
        h('div', { class: 'meta num' }, `${p.cfg.ew_ft}' × ${p.cfg.ns_ft}' · ${p.plans.length} plan${p.plans.length === 1 ? '' : 's'}`,
          score ? ` · Vaastu ${score.vaastu_score.toFixed(1)} · ${score.failed.length ? `${score.failed.length} rule${score.failed.length === 1 ? '' : 's'} failing` : 'all hard rules pass'}` : '', ` · ${when(p.updated)}`),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm primary', type: 'button', onclick: () => { app.project = p; app.go(`#/p/${p.id}`); } }, 'Open'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { app.project = p; app.go(`#/p/${p.id}/options`); } }, 'Options'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => exportProject(p) }, 'Export'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
            const name = await prompt('Duplicate project', 'Name', `${p.name} (copy)`); if (!name) return;
            const c = { ...JSON.parse(JSON.stringify(p)), id: newId(), name, created: Date.now() }; await saveProject(c); route();
          } }, 'Duplicate'),
          h('button', { class: 'btn sm ghost danger', type: 'button', onclick: async () => {
            if (await confirmDlg('Delete project?', `"${p.name}" and its plans and revisions will be removed from this browser.`)) { await deleteProject(p.id); route(); }
          } }, 'Delete')))));
  }
}

export function exportProject(p) {
  const slug = p.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
  download(`${slug}.vaastu-planner.json`, JSON.stringify(p, null, 1), 'application/json');
}
app.exportProject = exportProject;
app.newProject = newProject;
app.analyse = (doc) => analysePlan(app.project.cfg, doc);

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => { if (app.project) saveProject(app.project); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__vp = app;                 // handy for debugging / e2e tests
route();
