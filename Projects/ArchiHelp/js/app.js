// ArchiHelp — application controller: the three tabs (Projects · Floor plan · Wind circulation), routing, projects,
// floors and the engine worker pool.
import { h, $, clear, toast, download, pickFile, confirmDlg, prompt, when, modal, select, seg } from './dom.js';
import { listProjects, getProject, saveProject, deleteProject, newId } from './store.js';
import { renderWizard } from './wizard.js';
import { renderCatalogue } from './catalogue.js';
import { renderEditor } from './editor.js';
import { renderTrace } from './trace.js';
import { renderWind } from './wind.js';
import { planThumbSvg } from './thumbs.js';
import { ensureFloors, floorsOf, activateFloor, addFloor, removeFloor, levelName, fixedStairFor, sameTile } from './floors.js';
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
export function newProject(cfg = {}, { kind = 'design' } = {}) {
  const c = { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), ...cfg };
  return ensureFloors({ format: 'archihelp-project', version: 2, id: newId(), name: c.project_name || 'New house', created: Date.now(), updated: Date.now(),
    cfg: c, drawing: { name: c.project_name || 'Residence', plan_label: '', rev: 'P1' }, plans: [], activePlan: 0, revisions: {}, candidates: [], kind, trace: null });
}

function normaliseImported(p) {
  if (!p || p.format !== 'archihelp-project' || !p.cfg || !Array.isArray(p.plans)) throw new Error('Not an ArchiHelp project file.');
  return ensureFloors({ revisions: {}, candidates: [], drawing: { name: p.name, plan_label: '', rev: 'P1' }, activePlan: 0, ...p, id: newId(), updated: Date.now() });
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
  // the example house is in Tripura: start the wind simulation there
  p.wind = { ...(p.wind || {}), location: { name: 'Agartala', admin: 'Tripura', country: 'India', lat: 23.8315, lon: 91.2868 } };
  return p;
}

// ------------------------------------------------------------------------------------------------ app
const app = {
  pool: new EnginePool(),
  project: null,
  saveTimer: null,
  fixedStair: null,
  /** Persist soon (debounced) — every edit autosaves. */
  save(now = false) {
    if (!this.project) return;
    clearTimeout(this.saveTimer);
    const p = this.project;
    const run = () => saveProject(p).catch((e) => toast(`Could not save: ${e.message}`, 'bad'));
    if (now) return run();
    this.saveTimer = setTimeout(run, 500);
  },
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  /** Screen-level breadcrumbs in the project bar (the tabs and the project name are shown separately). */
  crumbs(items) {
    const nav = clear($('#crumbs')), p = this.project;
    const list = items.filter(([label]) => label !== 'Projects' && !(p && label === p.name));
    list.forEach(([label, href], i) => {
      if (i) nav.append(h('span', { class: 'sep' }, '/'));
      nav.append(href ? h('a', { href }, label) : h('span', { class: 'cur' }, label));
    });
  },
  actions(nodes) { const el = clear($('#topActions')); for (const n of nodes || []) if (n) el.append(n); },
  toast,
};

function show(id) {
  for (const sc of document.querySelectorAll('.screen')) sc.hidden = sc.id !== id;
  window.scrollTo(0, 0);
  return clear(document.getElementById(id));
}

async function openProject(id) {
  if (app.project && app.project.id === id) return app.project;
  const p = await getProject(id);
  if (!p) { toast('That project is not in this browser.', 'bad'); app.go('#/'); return null; }
  app.project = ensureFloors(p);
  return p;
}

const lastId = () => { try { return localStorage.getItem('archihelp:last'); } catch { return null; } };
const rememberLast = (id) => { try { localStorage.setItem('archihelp:last', id); } catch { /* private mode */ } };

// ------------------------------------------------------------------------------------------------ tabs + project bar
const TAB_ICONS = {
  projects: ['M4 5h6v6H4z', 'M14 5h6v6h-6z', 'M4 15h6v4H4z', 'M14 15h6v4h-6z'],
  plan: ['M4 4h16v16H4z', 'M4 12h9', 'M13 4v16'],
  wind: ['M3 8h11a3 3 0 1 0-3-3', 'M3 12h16a3 3 0 1 1-3 3', 'M3 16h7'],
};
function drawTabs(tab) {
  const nav = clear($('#tabs')), p = app.project;
  const pid = (p && p.id) || lastId();
  const items = [['projects', 'Projects', 'Projects', '#/'], ['plan', 'Floor plan', 'Plan', pid ? `#/p/${pid}` : '#/plan'], ['wind', 'Wind circulation', 'Wind', pid ? `#/p/${pid}/wind` : '#/wind']];
  for (const [id, label, short, href] of items) {
    nav.append(h('a', { href, class: id === tab ? 'on' : '', 'aria-current': id === tab ? 'page' : null, 'data-tab': id, 'aria-label': label, title: label },
      h('span', { class: 'ticon', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24">${TAB_ICONS[id].map((d) => `<path d="${d}"/>`).join('')}</svg>` }),
      h('span', { class: 'long' }, label), h('span', { class: 'short' }, short)));
  }
}

function drawProjectBar(tab) {
  const bar = $('#subbar'), p = app.project, on = !!p && tab !== 'projects';
  bar.hidden = !on;
  document.body.classList.toggle('has-sub', on);
  const name = clear($('#sbProject')), ft = clear($('#floorTabs'));
  if (!on) { clear($('#crumbs')); return; }
  name.append(h('a', { href: '#/', class: 'sb-name', title: 'All projects' }, p.name));
  const fl = floorsOf(p);
  if (tab === 'plan') {
    for (const f of fl) {
      ft.append(h('button', { type: 'button', class: `ftab${f.active ? ' on' : ''}`, 'data-floor': String(f.level), 'aria-pressed': String(f.active),
        title: f.kind === 'trace' ? 'Traced from a drawing' : (f.doc ? 'Designed in ArchiHelp' : 'Not designed yet'),
        onclick: () => switchFloor(f.index) }, f.name, f.kind === 'trace' ? h('small', {}, 'traced') : (!f.doc ? h('small', {}, 'new') : null)));
    }
    ft.append(h('button', { type: 'button', class: 'ftab add', onclick: addFloorDialog, title: 'Add a floor to this house' }, '+ Floor'));
    if (fl.length > 1) ft.append(h('button', { type: 'button', class: 'ftab ghost', title: 'Delete this floor', 'aria-label': 'Delete this floor', onclick: deleteFloorDialog }, '×'));
  } else if (tab === 'wind') {
    ft.append(h('span', { class: 'muted small' }, fl.length > 1 ? `${fl.length} floors: ${fl.map((f) => f.short).join(', ')}` : fl[0].name));
  }
}

function switchFloor(idx) {
  const p = app.project;
  if (activateFloor(p, idx)) app.save(true);
  app.go(`#/p/${p.id}`);
}

async function addFloorDialog() {
  const p = app.project, used = new Set(floorsOf(p).map((f) => f.level));
  const free = [0, 1, 2, 3, 4, 5].filter((l) => !used.has(l));
  if (!free.length) { toast('This house already has six floors.', 'bad'); return; }
  let level = free.find((l) => l > Math.max(...used)) ?? free[0], kind = 'design';
  const body = h('div', { class: 'grid1' },
    h('label', { class: 'field' }, h('span', {}, 'Floor'), select(free.map((l) => [l, levelName(l)]), level, (v) => { level = Number(v); })),
    h('div', { class: 'field', role: 'group', 'aria-label': 'How' }, h('span', {}, 'How'),
      seg([['design', 'Design it in ArchiHelp'], ['trace', 'Trace a drawing (photo, scan or PDF)']], kind, (v) => { kind = v; })),
    h('p', { class: 'small muted' }, 'The plot, heights, walls, structural grid and Vaastu rules are shared by every floor. A floor designed here keeps the staircase where it is on the other floors.'));
  const ok = await modal({ title: 'Add a floor', body, actions: [['Cancel', null], ['Add floor', true, 'primary']] });
  if (!ok) return;
  try {
    const idx = addFloor(p, { level, kind });
    activateFloor(p, idx);
    await app.save(true);
    app.go(kind === 'trace' ? `#/p/${p.id}/trace` : `#/p/${p.id}/setup/rooms`);
  } catch (e) { toast(e.message, 'bad'); }
}

async function deleteFloorDialog() {
  const p = app.project, f = floorsOf(p).find((x) => x.active);
  if (!(await confirmDlg(`Delete the ${f.name.toLowerCase()}?`, `Its plans, options and revisions are removed from "${p.name}". The other floors stay.`))) return;
  try { removeFloor(p, p.activeFloor); await app.save(true); app.go(`#/p/${p.id}`); } catch (e) { toast(e.message, 'bad'); }
}

// ------------------------------------------------------------------------------------------------ routing
async function route() {
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  for (const o of document.querySelectorAll('.overlay, .modal')) o.remove();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let tab = 'projects';
  try {
    if (!parts.length) { app.project = null; drawTabs(tab); drawProjectBar(tab); return renderHome(show('screen-home')); }
    if (parts[0] === 'plan' || parts[0] === 'wind') {
      const id = lastId();
      if (id && (await getProject(id))) return app.go(parts[0] === 'plan' ? `#/p/${id}` : `#/p/${id}/wind`);
      toast(parts[0] === 'plan' ? 'Open or start a project first.' : 'Open a project first: the simulation runs on its floor plans.');
      return app.go('#/');
    }
    if (parts[0] === 'new') {
      tab = 'plan'; app.project = newProject(); app.fixedStair = null;
      drawTabs(tab); drawProjectBar(tab);
      return renderWizard(show('screen-wizard'), app, { fresh: true });
    }
    if (parts[0] === 'p' && parts[1]) {
      const p = await openProject(parts[1]);
      if (!p) return;
      rememberLast(p.id);
      tab = parts[2] === 'wind' ? 'wind' : 'plan';
      app.fixedStair = fixedStairFor(p);
      drawTabs(tab); drawProjectBar(tab);
      if (parts[2] === 'wind') return renderWind(show('screen-wind'), app);
      if (parts[2] === 'trace') return renderTrace(show('screen-trace'), app);
      if (parts[2] === 'setup') return renderWizard(show('screen-wizard'), app, { step: parts[3] });
      if (parts[2] === 'options') return renderCatalogue(show('screen-catalogue'), app);
      if (parts[2] === 'plan') return renderEditor(show('screen-editor'), app, Number(parts[3] || 0));
      if (p.kind === 'trace') return app.go(`#/p/${p.id}/trace`);
      return app.go(p.plans.length ? `#/p/${p.id}/plan/${p.activePlan || 0}` : (p.candidates && p.candidates.length ? `#/p/${p.id}/options` : `#/p/${p.id}/setup`));
    }
    app.go('#/');
  } catch (e) {
    console.error(e);
    toast(`Something went wrong: ${e.message}`, 'bad', 6000);
  }
}

// ------------------------------------------------------------------------------------------------ Projects tab
async function renderHome(root) {
  app.actions([]);
  document.title = 'ArchiHelp — floor plans, Vaastu checks, A3 drawings and wind + heat simulation';
  const list = h('div', { class: 'plist' }, h('div', { class: 'empty' }, h('span', { class: 'spin' }), ' Loading your projects…'));
  const open = async (p, where = '') => { app.project = ensureFloors(p); await saveProject(p); app.go(`#/p/${p.id}${where}`); };
  root.append(h('div', { class: 'home' },
    h('div', {},
      h('h1', {}, 'Design a house, then see how it breathes'),
      h('p', { class: 'lede' }, 'Floor plan: describe the plot, rooms and Vaastu rules; the engine searches thousands of layouts, scores each against the 32 padas, NBC room sizes and a structural grid, and hands you the best options to edit, floor by floor, down to doors, windows and furniture, with a dimensioned A3 drawing set. Wind circulation: put the house on its site and simulate airflow, fans and room temperatures through a day, season by season.'),
      h('div', { class: 'start' },
        h('button', { class: 'opt', type: 'button', onclick: () => app.go('#/new') }, h('b', {}, 'New project'), h('span', {}, 'Guided setup: plot, building, rooms, Vaastu rules → layout options'), h('i', {}, '→')),
        h('button', { class: 'opt', type: 'button', onclick: async () => {
          try { await open(await loadExample(), '/plan/0'); } catch (e) { toast(`Could not load the example: ${e.message}`, 'bad'); }
        } }, h('b', {}, 'Open the example'), h('span', {}, "A real 63' × 24' first floor: the final plan after nine hand-sketch revisions"), h('i', {}, '→')),
        h('button', { class: 'opt', type: 'button', onclick: async () => {
          const p = newProject({ project_name: 'Traced house', floor_level: 0 }, { kind: 'trace' });
          await open(p, '/trace');
        } }, h('b', {}, 'Start from a drawing'), h('span', {}, 'Trace an existing plan (photo, scan or PDF) to simulate wind and heat'), h('i', {}, '→')),
        h('button', { class: 'opt', type: 'button', onclick: async () => {
          const txt = await pickFile(); if (!txt) return;
          try { await open(normaliseImported(JSON.parse(txt))); toast('Project imported.'); } catch (e) { toast(e.message, 'bad'); }
        } }, h('b', {}, 'Import a project file'), h('span', {}, '.json exported from ArchiHelp'), h('i', {}, '↑'))),
      h('div', { class: 'how' }, h('b', {}, 'Three tabs'),
        h('ol', {},
          h('li', {}, h('b', {}, 'Projects'), ' — your houses, kept in this browser.'),
          h('li', {}, h('b', {}, 'Floor plan'), ' — one tab per floor: setup wizard, layout options (searched on every CPU core), editor and the A-101 / A-102 / S-101 / A-601 drawing set. The staircase stays in line from floor to floor.'),
          h('li', {}, h('b', {}, 'Wind circulation'), ' — location, weather (Open-Meteo), floor heights, windows, fans and neighbours → airflow and room temperatures through a typical day of each season or any date, per floor, in plan and in a cut-away section of the house.')),
        h('p', { class: 'small muted' }, 'No sign-in and nothing is uploaded: projects stay in this browser (export a file to keep a copy); the only network calls fetch public weather and place names.'))),
    h('div', { class: 'projects' }, h('h2', {}, 'Your projects'), list)));
  const projects = await listProjects();
  clear(list);
  if (!projects.length) { list.append(h('div', { class: 'empty' }, 'No projects yet. Start a new one or open the example.')); return; }
  for (const p of projects) {
    ensureFloors(p);
    const thumb = h('div', { class: 'thumb' });
    const fl = floorsOf(p), af = fl.find((f) => f.active) || fl[0];
    let score = null;
    if (af && af.doc && af.kind !== 'trace') {
      try { const r = planThumbSvg(af.cfg, af.doc, { labels: false }); thumb.innerHTML = r.svg; score = r.plan; } catch { /* broken plan: no thumbnail */ }
    }
    const floorsTxt = fl.length > 1 ? `${fl.length} floors (${fl.map((f) => f.short).join(', ')})` : fl[0].name;
    list.append(h('div', { class: 'pcard' }, thumb,
      h('div', {},
        h('h3', {}, p.name),
        h('div', { class: 'meta num' }, `${p.cfg.ew_ft}' × ${p.cfg.ns_ft}' · ${floorsTxt}`,
          score ? ` · Vaastu ${score.vaastu_score.toFixed(1)} · ${score.failed.length ? `${score.failed.length} rule${score.failed.length === 1 ? '' : 's'} failing` : 'all hard rules pass'}` : '',
          p.wind && p.wind.location && p.wind.location.name ? ` · ${p.wind.location.name}` : '', ` · ${when(p.updated)}`),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm primary', type: 'button', onclick: () => { app.project = p; app.go(`#/p/${p.id}`); } }, 'Floor plan'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { app.project = p; app.go(`#/p/${p.id}/wind`); } }, 'Wind'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => exportProject(p) }, 'Export'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
            const name = await prompt('Duplicate project', 'Name', `${p.name} (copy)`); if (!name) return;
            const c = { ...JSON.parse(JSON.stringify(p)), id: newId(), name, created: Date.now() }; await saveProject(c); route();
          } }, 'Duplicate'),
          h('button', { class: 'btn sm ghost danger', type: 'button', onclick: async () => {
            if (await confirmDlg('Delete project?', `"${p.name}" and all its floors, plans and revisions will be removed from this browser.`)) { await deleteProject(p.id); route(); }
          } }, 'Delete')))));
  }
}

export function exportProject(p) {
  const slug = p.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
  download(`${slug}.archihelp.json`, JSON.stringify(p, null, 1), 'application/json');
}
app.exportProject = exportProject;
app.newProject = newProject;
app.analyse = (doc) => analysePlan(app.project.cfg, doc);
app.refreshBar = (tab = 'plan') => { drawTabs(tab); drawProjectBar(tab); };
/** Multi-floor projects: the active floor's staircase must stay where the other floors have it. */
app.stairOk = (doc) => {
  const fx = app.fixedStair;
  if (!fx || !doc || !Array.isArray(doc.rooms)) return true;
  const st = doc.rooms.find((r) => r.rtype === 'stair');
  return !!st && sameTile(st.tile, fx.tile);
};

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => { if (app.project) saveProject(app.project); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__ah = app;                 // handy for debugging / e2e tests
route();
