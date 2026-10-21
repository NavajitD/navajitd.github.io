// ArchiHelp — layout options: run the search on every core, then browse, compare and open candidates.
import { h, clear, toast, modal, seg, checkbox, dropdown } from './dom.js';
import { floorsOf, levelName } from './floors.js';
import { designStair, stairRiseFt, stairSizeOk } from '../engine/stair.js';
import { netRect, region } from '../engine/plan.js';
import { saveProject } from './store.js';
import { planThumbSvg, planPreviewSvg, dominantPada } from './thumbs.js';
import { analysePlan, prepareConfig } from '../engine/index.js';
import { cloneDoc } from '../engine/edits.js';
import { fi, rw, rh } from '../engine/geom.js';

export const EFFORT = {
  quick: { budget: { beam: 300, perSig: 6, ms: 1500 }, perSkeleton: 3, maxCandidates: 18 },
  standard: { budget: { beam: 700, perSig: 8, ms: 5000 }, perSkeleton: 4, maxCandidates: 24 },
  thorough: { budget: { beam: 1600, perSig: 12, ms: 12000 }, perSkeleton: 6, maxCandidates: 36 },
};
const KEY_ROOMS = ['kitchen', 'puja', 'master'];

function programLine(cfg) {
  const P = cfg.program, parts = [];
  if (P.bedroom) parts.push(`${P.bedroom} bed`);
  if (P.bath) parts.push(`${P.bath} bath`);
  for (const t of ['kitchen', 'dining', 'hall', 'puja', 'stair', 'veranda']) if (P[t]) parts.push(P[t] > 1 ? `${P[t]} ${t}` : t);
  return parts.join(', ');
}

export function renderCatalogue(root, app) {
  const p = app.project, cfg = prepareConfig(p.cfg);
  app.crumbs([['Projects', '#/'], [p.name, p.plans.length ? `#/p/${p.id}/plan/${p.activePlan || 0}` : null], ['Options', null]]);
  app.actions([h('a', { class: 'btn sm', href: `#/p/${p.id}/setup` }, 'Edit setup')]);
  document.title = `Options — ${p.name} — ArchiHelp`;
  const picked = new Set();
  let effort = (p.lastRun && p.lastRun.effort) || 'standard', relaxed = !!(p.lastRun && p.lastRun.relaxed), running = false, sortBy = 'best';
  const SORTS = {
    best: ['Best overall', null, 'Vaastu score, advisories and circulation combined'],
    vaastu: ['Vaastu score', (c) => -c.quality.vaastu, 'Highest pada score first'],
    soft: ['Fewest advisories', (c) => c.quality.soft * 1000 - c.quality.vaastu, 'Fewest soft-rule notes, then Vaastu score'],
    circ: ['Least circulation', (c) => c.quality.circ, 'Smallest passage and lobby area first'],
  };
  const head = h('div', { class: 'cat-head' }), mine = h('div'), bar = h('div', { class: 'cat-bar' }), grid = h('div', { class: 'cards', 'aria-live': 'polite' }), cmpBar = h('div', { class: 'cmp', hidden: true });
  root.append(h('div', { class: 'cat' }, head, mine, bar, grid), cmpBar);
  const analysed = new Map();                // candidate index -> analysed plan (cache)
  const planOf = (c, i) => { if (!analysed.has(i)) analysed.set(i, analysePlan(cfg, c.doc)); return analysed.get(i); };

  function drawHead(progress = null) {
    clear(head);
    const run = p.lastRun;
    const sub = `${levelName(cfg.floor_level ?? 0)} · ${fi(cfg.ew_ft)} × ${fi(cfg.ns_ft)} · road ${cfg.road_side} · ${programLine(cfg)}${app.fixedStair ? ` · stair kept from the ${app.fixedStair.from.toLowerCase()}` : ''}`;
    const left = h('div', {}, h('h1', {}, 'Layout options'), h('div', { class: 'muted small num' }, sub));
    if (progress) {
      const pct = progress.total ? Math.round(100 * progress.done / progress.total) : 0;
      const best = progress.pool.length ? Math.max(...progress.pool.map((c) => c.quality.vaastu)) : null;
      left.append(h('div', { class: 'small num', style: { marginTop: '8px' } }, h('span', { class: 'spin' }), ' ',
        progress.phase === 'polish' ? `Fine-tuning the best layouts (walls in 3" to 1' steps)…` : `Searching skeleton ${progress.done} of ${progress.total} · ${progress.pool.length} valid layouts${best !== null ? ` · best Vaastu ${best.toFixed(1)}` : ''}`),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: `${progress.phase === 'polish' ? 100 : pct}%` } })));
    } else if (run) {
      left.append(h('div', { class: 'small muted num', style: { marginTop: '6px' } },
        `${p.candidates.length} option${p.candidates.length === 1 ? '' : 's'} · ${run.layouts} valid layouts in ${run.topologies} arrangements from ${run.skeletons} skeletons · ${(run.ms / 1000).toFixed(1)} s on ${run.workers} cores${run.relaxed ? ' · relaxed' : ''}`));
    }
    const rx = checkbox('Relaxed', relaxed, (v) => { relaxed = v; }, null);
    rx.classList.add('chip');
    const controls = h('div', { class: 'row cat-run' },
      seg([['quick', 'Quick'], ['standard', 'Standard'], ['thorough', 'Thorough']], effort, (v) => { effort = v; }, { 'aria-label': 'Search effort' }),
      rx,
      running ? h('button', { class: 'btn', type: 'button', onclick: () => { app.pool.stop(); } }, 'Stop')
        : h('button', { class: 'btn primary', type: 'button', onclick: () => run_({ effort, relaxed }) }, p.candidates && p.candidates.length ? 'Generate again' : 'Generate options'));
    controls.querySelector('.check').title = 'Also keep layouts that miss the pada share of a hard Vaastu rule (flagged), like the notebook\'s min_frac = 0';
    head.append(left, controls);
    drawBar(progress);
  }

  /** Heading row over the generated options: count on the left, sort menu on the right. */
  function drawBar(progress = null) {
    clear(bar);
    const n = (p.candidates || []).length;
    bar.hidden = !n && !p.plans.length;
    bar.append(h('h2', {}, n ? `Generated options · ${n}` : 'Generated options'));
    if (n && !progress) {
      bar.append(dropdown(Object.entries(SORTS).map(([k, [l, , d]]) => [k, l, d]), sortBy, (v) => { sortBy = v; drawCards(); },
        { label: 'Sort', ariaLabel: 'Sort options', align: 'right' }));
    }
  }

  function drawMine() {
    clear(mine);
    if (!p.plans.length) return;
    mine.append(h('h2', { class: 'small muted', style: { textTransform: 'uppercase', letterSpacing: '.06em', margin: '4px 0 10px' } }, 'Your plans'));
    const row = h('div', { class: 'cards', style: { marginBottom: '26px' } });
    p.plans.forEach((d, i) => {
      let pic = '', pl = null;
      try { const r = planThumbSvg(cfg, d); pic = r.svg; pl = r.plan; } catch { /* unreadable plan */ }
      row.append(h('div', { class: 'ccard' },
        h('div', { class: 'pic', html: pic, onclick: () => app.go(`#/p/${p.id}/plan/${i}`), title: 'Open in the editor' }),
        h('div', { class: 'hd' }, h('b', {}, d.label || `Plan ${i + 1}`), pl ? scoreEl(pl.vaastu_score) : null),
        h('div', { class: 'stats' }, pl ? statusBadges(pl) : null, h('span', { class: 'small muted', style: { gridColumn: '1 / -1' } }, d.source || '')),
        h('div', { class: 'ft' }, h('span', { style: { marginRight: 'auto' } }), h('a', { class: 'btn sm primary', href: `#/p/${p.id}/plan/${i}` }, 'Open'))));
    });
    mine.append(row);
  }

  function drawCards() {
    clear(grid);
    const cs = p.candidates || [];
    if (!cs.length) {
      if (running) return;
      const msg = p.lastRun
        ? h('div', { class: 'empty' }, h('p', {}, h('b', {}, 'No layout passed every hard rule.')),
          h('p', {}, p.lastRun.relaxed ? 'Even the relaxed search found nothing: check room sizes and the programme against the envelope in the setup.' : 'The Vaastu pada rules may be too tight for this plot. The relaxed search keeps layouts that miss a pada share and flags them.'),
          stairNote(),
          h('div', { class: 'row', style: { justifyContent: 'center' } },
            !p.lastRun.relaxed ? h('button', { class: 'btn primary', type: 'button', onclick: () => { relaxed = true; run_({ effort, relaxed: true }); } }, 'Try the relaxed search') : null,
            h('a', { class: 'btn', href: `#/p/${p.id}/setup/vaastu` }, 'Review the rules')))
        : h('div', { class: 'empty' }, 'No options yet. Pick an effort and generate — the search runs on this device, nothing is uploaded.');
      grid.append(msg);
      return;
    }
    // render in small batches so the page stays responsive
    const key = SORTS[sortBy][1], order = cs.map((c, i) => i);
    if (key) order.sort((a, b) => key(cs[a]) - key(cs[b]) || a - b);
    let j = 0;
    const step = () => {
      const end = Math.min(order.length, j + 4);
      for (; j < end; j++) grid.append(card(cs[order[j]], order[j]));
      if (j < order.length) setTimeout(step, 0);
    };
    step();
  }

  const scoreEl = (v) => h('span', { class: 'score num', title: 'Vaastu score (0-100): share of each room in its preferred padas, weighted' }, v.toFixed(1), h('small', {}, ' Vaastu'));
  function statusBadges(pl) {
    const soft = pl.checks.filter((c) => !c.hard && !c.ok).length;
    return [pl.failed.length
      ? h('span', { class: 'badge bad', title: pl.failed.map((c) => `${c.name}: ${c.detail}`).join('\n') }, `${pl.failed.length} hard rule${pl.failed.length === 1 ? '' : 's'} missed`)
      : h('span', { class: 'badge ok' }, 'All hard rules pass'),
    h('span', { class: `badge ${soft ? 'adv' : 'plain'}`, title: pl.checks.filter((c) => !c.hard && !c.ok).map((c) => `${c.name}: ${c.detail}`).join('\n') }, `${soft} advisor${soft === 1 ? 'y' : 'ies'}`)];
  }

  function card(c, i) {
    const pl = planOf(c, i), { svg } = planThumbSvg(cfg, c.doc, { plan: pl });
    const where = KEY_ROOMS.map((t) => { const r = pl.rooms.find((x) => x.rtype === t); return r ? `${t === 'master' ? 'Master' : t[0].toUpperCase() + t.slice(1)} ${dominantPada(pl, r.uid)}` : null; }).filter(Boolean).join(' · ');
    const circ = c.quality.circ, carpet = pl.rooms.reduce((a, r) => a + r.area, 0);
    const cb = h('input', { type: 'checkbox', checked: picked.has(i), onchange: () => { if (cb.checked) { if (picked.size >= 3) { cb.checked = false; toast('Compare up to three options.'); return; } picked.add(i); } else picked.delete(i); drawCmp(); } });
    return h('article', { class: 'ccard', 'data-option': String(i + 1) },
      h('div', { class: 'pic', html: svg, title: 'Preview', role: 'button', tabindex: '0', onclick: () => peek(c, i), onkeydown: (e) => { if (e.key === 'Enter') peek(c, i); } }),
      h('div', { class: 'hd' }, h('b', {}, c.doc.label || `Option ${i + 1}`), scoreEl(c.quality.vaastu)),
      h('div', { class: 'stats num' }, statusBadges(pl), c.quality.relaxed ? h('span', { class: 'badge bad', title: 'From the relaxed search' }, 'pada share missed') : null,
        h('span', { class: 'small', style: { gridColumn: '1 / -1' } }, where),
        h('span', { class: 'small muted', style: { gridColumn: '1 / -1' } }, `Carpet ${Math.round(carpet)} sq ft (${Math.round(100 * carpet / (cfg.ew_ft * cfg.ns_ft))}%) · circulation ${Math.round(circ)} sq ft`)),
      h('div', { class: 'ft' }, h('label', {}, cb, 'Compare'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => peek(c, i) }, 'Preview'),
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => openCandidate(c) }, 'Open')));
  }

  async function openCandidate(c) {
    let i = p.plans.findIndex((d) => d.meta && d.meta.candidateKey === c.key && d.meta.candidateRun === (p.lastRun && p.lastRun.time));
    if (i < 0) {
      const d = cloneDoc(c.doc);
      d.meta = { ...(d.meta || {}), candidateKey: c.key, candidateRun: p.lastRun && p.lastRun.time };
      p.plans.push(d); i = p.plans.length - 1;
    }
    p.activePlan = i;
    await saveProject(p);
    app.go(`#/p/${p.id}/plan/${i}`);
  }

  function peek(c, i) {
    const pl = planOf(c, i), { svg } = planPreviewSvg(cfg, c.doc, { plan: pl });
    const rows = pl.rooms.filter((r) => r.rtype !== 'suite').map((r) => h('tr', {}, h('td', {}, r.name), h('td', { class: 'num' }, `${fi(r.net.x1 - r.net.x0)} × ${fi(r.net.y1 - r.net.y0)}`), h('td', { class: 'num' }, Math.round(r.area)), h('td', {}, dominantPada(pl, r.uid))));
    const body = h('div', { style: { display: 'grid', gap: '12px' } },
      h('div', { class: 'preview', html: svg }),
      h('div', { class: 'row' }, statusBadges(pl), h('span', { class: 'small muted' }, c.doc.source)),
      h('table', { class: 'rules' }, h('thead', {}, h('tr', {}, h('th', {}, 'Room'), h('th', {}, 'Clear size'), h('th', {}, 'Sq ft'), h('th', {}, 'Main pada'))), h('tbody', {}, rows)));
    const m = modal({ title: `${c.doc.label} · Vaastu ${c.quality.vaastu.toFixed(1)}`, body, actions: [['Close', null], ['Open in editor', true, 'primary']] });
    document.querySelector('.modal .box').style.width = 'min(1100px, 100%)';
    m.then((v) => { if (v) openCandidate(c); });
  }

  function drawCmp() {
    clear(cmpBar);
    cmpBar.hidden = picked.size === 0;
    if (!picked.size) return;
    cmpBar.append(h('b', {}, `${picked.size} selected`), h('span', { class: 'muted small' }, picked.size < 2 ? 'pick one more to compare' : ''),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { picked.clear(); for (const x of grid.querySelectorAll('input[type=checkbox]')) x.checked = false; drawCmp(); } }, 'Clear'),
      h('button', { class: 'btn primary', type: 'button', disabled: picked.size < 2, onclick: compare }, 'Compare'));
  }

  function compare() {
    const ids = [...picked].sort((a, b) => a - b), cs = ids.map((i) => [p.candidates[i], planOf(p.candidates[i], i)]);
    const names = []; for (const [, pl] of cs) for (const r of pl.rooms) if (r.rtype !== 'suite' && !names.includes(r.name)) names.push(r.name);
    const cell = (v, best) => h('td', { class: 'num', style: best ? { fontWeight: '700', color: 'var(--ok)' } : null }, v);
    const metric = (label, f, better) => {
      const vals = cs.map(([c, pl]) => f(c, pl)), nums = vals.map((v) => (typeof v === 'number' ? v : NaN));
      const tgt = better === 'max' ? Math.max(...nums) : better === 'min' ? Math.min(...nums) : null;
      return h('tr', {}, h('th', {}, label), vals.map((v, k) => cell(typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : v, tgt !== null && nums[k] === tgt && new Set(nums).size > 1)));
    };
    const body = h('div', { style: { display: 'grid', gap: '14px' } },
      h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${cs.length}, minmax(0, 1fr))`, gap: '12px' } },
        cs.map(([c, pl]) => h('div', {}, h('div', { class: 'preview', html: planThumbSvg(cfg, c.doc, { plan: pl, furniture: true }).svg }), h('div', { class: 'row', style: { marginTop: '6px', justifyContent: 'space-between' } }, h('b', {}, c.doc.label), h('button', { class: 'btn sm primary', type: 'button', onclick: () => { document.querySelector('.modal').remove(); openCandidate(c); } }, 'Open'))))),
      h('table', { class: 'rules' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), cs.map(([c]) => h('th', {}, c.doc.label)))),
        h('tbody', {},
          metric('Vaastu score', (c) => c.quality.vaastu, 'max'),
          metric('Hard rules missed', (c, pl) => pl.failed.length, 'min'),
          metric('Advisories', (c, pl) => pl.checks.filter((x) => !x.hard && !x.ok).length, 'min'),
          metric('Circulation (sq ft)', (c) => Math.round(c.quality.circ), 'min'),
          metric('Carpet area (sq ft)', (c, pl) => Math.round(pl.rooms.reduce((a, r) => a + r.area, 0)), 'max'),
          names.map((nm) => h('tr', {}, h('th', { style: { fontWeight: 500 } }, nm), cs.map(([, pl]) => { const r = pl.rooms.find((x) => x.name === nm); return h('td', { class: 'num' }, r ? `${Math.round(r.area)} · ${dominantPada(pl, r.uid)}` : '—'); }))))));
    modal({ title: 'Compare options', body, actions: [['Close', null]] });
    document.querySelector('.modal .box').style.width = 'min(1280px, 100%)';
  }

  /** Search config: multi-floor projects keep the staircase of the other floors and size it for the tallest storey. */
  function runCfg() {
    const fl = floorsOf(p), extra = {};
    if (app.fixedStair) extra.__fixedStair = app.fixedStair.tile;
    if (fl.length > 1) extra.__stairRiseFt = Math.max(...fl.map((f) => stairRiseFt({ ...p.cfg, floor_level: f.level })));
    return Object.keys(extra).length ? { ...p.cfg, ...extra } : p.cfg;
  }
  /** Why a fixed staircase can make a floor impossible: it may be too small for this house's tallest flight. */
  function stairNote() {
    if (!app.fixedStair) return null;
    const c = prepareConfig(runCfg()), st = designStair({ ...c, floor_level: 2, typical_floor_height_ft: c.__stairRiseFt || stairRiseFt(c) });
    const net = netRect(app.fixedStair.tile, region(c), c);
    if (stairSizeOk(net, st)) return h('p', { class: 'small muted' }, `The staircase is kept where it is on the ${app.fixedStair.from.toLowerCase()}; the other rooms are arranged around it.`);
    return h('p', {}, `The staircase from the ${app.fixedStair.from.toLowerCase()} (${fi(rw(net))} × ${fi(rh(net))} clear) is too small for a ${fi(c.__stairRiseFt || stairRiseFt(c))} flight: a ${st.risers}-riser dog-leg needs ${fi(st.block_l)} × ${fi(st.block_w)}. Enlarge it on that floor or lower the floor heights in the setup.`);
  }
  async function run_({ effort: ef = 'standard', relaxed: rx = false } = {}) {
    if (running) return;
    running = true; picked.clear(); drawCmp();
    clear(grid);
    drawHead({ phase: 'search', done: 0, total: 0, pool: [] });
    let last = 0;
    try {
      const res = await app.pool.generate(runCfg(), { ...EFFORT[ef], relaxed: rx, onProgress: (d) => { const now = performance.now(); if (now - last > 120 || d.phase === 'polish') { last = now; drawHead(d); } } });
      p.candidates = res.candidates.map((c) => ({ doc: c.doc, quality: c.quality, key: c.key, skeleton: c.skeleton }));
      p.lastRun = { ...res.stats, layouts: res.stats.layouts, effort: ef, relaxed: rx, time: Date.now() };
      analysed.clear();
      await saveProject(p);
      if (res.candidates.length) toast(`${res.candidates.length} options ready.`);
    } catch (e) {
      if (e.message !== 'stopped') { console.error(e); toast(`The search failed: ${e.message.split('\n')[0]}`, 'bad', 6000); } else toast('Search stopped.');
    } finally {
      running = false;
      drawHead(); drawCards();
    }
  }

  drawHead(); drawMine(); drawCards(); drawCmp();
  if (app.pendingGenerate) { const g = app.pendingGenerate; app.pendingGenerate = null; effort = g.effort; relaxed = g.relaxed; run_(g); }
  else if (!p.lastRun && !(p.candidates || []).length) run_({ effort, relaxed });
}
