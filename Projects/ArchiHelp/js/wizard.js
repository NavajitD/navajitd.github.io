// ArchiHelp — guided setup wizard: every input of the notebook's Config, in six steps, with a live preview.
import { h, clear, field, ftIn, num, seg, select, checkbox, toast } from './dom.js';
import { saveProject } from './store.js';
import { resolveConfig, ROOM_SPECS, SECTOR_RULES, BRAHMASTHAN_MAX_OVERLAP, PADAS } from '../engine/config.js';
import { designStair } from '../engine/stair.js';
import { buildStructure, coreRect } from '../engine/structure.js';
import { padaRange, sectorFrame, expandTier } from '../engine/sectors.js';
import { fi, pyG } from '../engine/geom.js';
import { svgNS } from './dom.js';

const STEPS = [
  ['site', 'Site'], ['building', 'Building'], ['rooms', 'Rooms'], ['vaastu', 'Vaastu rules'], ['sizes', 'Sizes'], ['generate', 'Generate'],
];
const TYPES_WITH_RULES = [['puja', 'Puja room'], ['kitchen', 'Kitchen'], ['bath', 'Bath / toilet'], ['stair', 'Staircase'], ['bedroom', 'Bedrooms (incl. master)'],
  ['hall', 'Hall'], ['dining', 'Dining'], ['veranda', 'Veranda']];
const SIZE_TYPES = ['master', 'bedroom', 'bath', 'kitchen', 'puja', 'hall', 'dining', 'veranda', 'passage', 'lobby', 'court'];

export function renderWizard(root, app, { fresh = false, step = null } = {}) {
  const p = app.project, cfg = p.cfg;
  let k = Math.max(0, STEPS.findIndex(([id]) => id === step));
  const stepsEl = h('ol', {}), main = h('div', { class: 'wz-main' }), side = h('aside', { class: 'wz-side', 'aria-label': 'Preview' });
  root.append(h('div', { class: 'wz' }, h('nav', { class: 'wz-steps', 'aria-label': 'Setup steps' }, stepsEl), main, side));
  app.crumbs([['Projects', '#/'], [p.name || 'New project', p.plans.length ? `#/p/${p.id}` : null], ['Setup', null]]);
  app.actions(p.plans.length || (p.candidates && p.candidates.length) ? [h('a', { class: 'btn sm', href: `#/p/${p.id}/options` }, 'Options')] : []);
  document.title = `Setup — ${p.name} — ArchiHelp`;
  const changed = () => { p.updated = Date.now(); if (!fresh) app.save(); drawSide(); };

  function nav() {
    clear(stepsEl);
    STEPS.forEach(([id, label], i) => stepsEl.append(h('li', {}, h('button', { type: 'button', class: `${i === k ? 'on' : ''} ${i < k ? 'done' : ''}`, 'aria-current': i === k ? 'step' : null,
      onclick: () => go(i) }, h('span', { class: 'n' }, i < k ? '✓' : i + 1), h('span', { class: 'lbl' }, label)))));
  }
  async function go(i) {
    k = Math.max(0, Math.min(STEPS.length - 1, i));
    if (fresh && k > 0) { fresh = false; await saveProject(p); history.replaceState(null, '', `#/p/${p.id}/setup/${STEPS[k][0]}`); }
    else if (!fresh) history.replaceState(null, '', `#/p/${p.id}/setup/${STEPS[k][0]}`);
    nav(); drawStep(); drawSide();
  }
  const footer = () => h('div', { class: 'wz-nav' },
    k > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => go(k - 1) }, '← Back') : h('span'),
    k < STEPS.length - 1 ? h('button', { class: 'btn primary', type: 'button', onclick: () => go(k + 1) }, `Next: ${STEPS[k + 1][1]} →`) : h('span'));

  // ------------------------------------------------------------------ steps
  function drawStep() {
    clear(main);
    const id = STEPS[k][0];
    if (id === 'site') stepSite(); else if (id === 'building') stepBuilding(); else if (id === 'rooms') stepRooms();
    else if (id === 'vaastu') stepVaastu(); else if (id === 'sizes') stepSizes(); else stepGenerate();
    main.append(footer());
  }
  const set = (key, v) => { cfg[key] = v; changed(); };

  function stepSite() {
    main.append(h('h2', {}, 'Site'), h('p', { class: 'intro' }, 'The built-up envelope (outer face to outer face of the walls) of the floor you are designing, and where the road and north are. Lengths take feet-inches (8\'-11"), decimals (8.92) or inches (107").'),
      h('fieldset', {}, h('legend', {}, 'Project'),
        h('div', { class: 'grid2' },
          field('Project name', textIn(p.name, (v) => { p.name = v; cfg.project_name = v; p.drawing = { ...(p.drawing || {}), name: v }; changed(); })),
          field('Location / address', textIn(cfg.location, (v) => set('location', v)), 'Shown on every drawing sheet.'))),
      h('fieldset', {}, h('legend', {}, 'Envelope'),
        h('div', { class: 'grid3' },
          field('East–west extent', ftIn({ value: cfg.ew_ft, min: 15, max: 200, onChange: (v) => set('ew_ft', v) })),
          field('North–south extent', ftIn({ value: cfg.ns_ft, min: 15, max: 200, onChange: (v) => set('ns_ft', v) })),
          field('Seismic zone', select(['II', 'III', 'IV', 'V'], cfg.seismic_zone, (v) => set('seismic_zone', v)), 'IS 1893; shown in the notes.'))),
      h('fieldset', {}, h('legend', {}, 'Orientation'),
        h('div', { class: 'grid2' },
          field('Road side', seg([['N', 'North'], ['E', 'East'], ['S', 'South'], ['W', 'West']], cfg.road_side, (v) => set('road_side', v)), 'Main entrance faces the road unless you place it yourself.'),
          field('Plan north vs compass north (°)', num({ value: cfg.plan_north_bearing_deg || 0, min: -180, max: 180, step: 0.5, onChange: (v) => set('plan_north_bearing_deg', v) }),
            'Compass bearing of the plan\'s "up". Measure on site — the padas rotate with it.'))));
  }

  function stepBuilding() {
    const st = designStair(resolveConfig(cfg));
    main.append(h('h2', {}, 'Building'), h('p', { class: 'intro' }, 'Which floor you are designing, the construction, and the structural grid. Defaults follow the notebook: 7" brick walls, RCC frame, columns kept out of the Brahmasthan and inside wall lines.'),
      h('fieldset', {}, h('legend', {}, 'Levels'),
        h('div', { class: 'grid4' },
          field('Floor being designed', select([[0, 'Ground'], [1, 'First'], [2, 'Second'], [3, 'Third']], cfg.floor_level, (v) => set('floor_level', Number(v)))),
          field('Ground floor height', ftIn({ value: cfg.ground_floor_height_ft, min: 8, max: 16, onChange: (v) => set('ground_floor_height_ft', v) })),
          field('Typical floor height', ftIn({ value: cfg.typical_floor_height_ft, min: 8, max: 16, onChange: (v) => set('typical_floor_height_ft', v) })),
          field('Floors above', num({ value: cfg.floors_above, min: 0, max: 10, onChange: (v) => set('floors_above', Math.round(v)) }), 'For column loads.'))),
      h('fieldset', {}, h('legend', {}, 'Walls'),
        h('div', { class: 'grid2' },
          field('External wall (inches)', num({ value: +(cfg.t_ext * 12).toFixed(2), min: 3, max: 18, step: 0.5, onChange: (v) => set('t_ext', +(v / 12).toFixed(4)) })),
          field('Internal wall (inches)', num({ value: +(cfg.t_int * 12).toFixed(2), min: 3, max: 18, step: 0.5, onChange: (v) => set('t_int', +(v / 12).toFixed(4)) })))),
      h('fieldset', {}, h('legend', {}, 'Staircase (dog-leg, turns clockwise going up)'),
        h('div', { class: 'grid3' },
          field('Flight width', ftIn({ value: cfg.stair_width_ft, min: 3, max: 6, onChange: (v) => set('stair_width_ft', v) })),
          field('Max riser (inches)', num({ value: cfg.max_riser_in, min: 5, max: 8, step: 0.25, onChange: (v) => set('max_riser_in', v) })),
          field('Tread (inches)', num({ value: cfg.tread_in, min: 9, max: 13, step: 0.25, onChange: (v) => set('tread_in', v) }))),
        h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, `${st.risers} risers of ${st.riser_in.toFixed(2)}" (${st.r1} + ${st.r2}), block ${fi(st.block_w)} × ${fi(st.block_l)}.`)),
      h('details', { class: 'adv' }, h('summary', {}, 'Structure — grid, columns, loads'),
        h('div', {},
          h('div', { class: 'grid3' },
            field('Max column bay', ftIn({ value: cfg.max_bay_ft, min: 8, max: 25, onChange: (v) => set('max_bay_ft', v) })),
            field('Bays east–west', num({ value: cfg.ew_bays || 0, min: 0, max: 12, onChange: (v) => set('ew_bays', v ? Math.round(v) : null) }), '0 = from the max bay'),
            field('Bays north–south', num({ value: cfg.ns_bays || 0, min: 0, max: 12, onChange: (v) => set('ns_bays', v ? Math.round(v) : null) }), '0 = from the max bay'),
            field('Column min size (mm)', h('div', { class: 'inl' }, num({ value: cfg.min_column_mm[0], min: 200, max: 600, step: 5, onChange: (v) => set('min_column_mm', [v, cfg.min_column_mm[1]]) }),
              num({ value: cfg.min_column_mm[1], min: 200, max: 900, step: 5, onChange: (v) => set('min_column_mm', [cfg.min_column_mm[0], v]) }))),
            field('Column long axis', seg([['x', 'E–W'], ['y', 'N–S']], cfg.col_long_axis, (v) => set('col_long_axis', v))),
            field('Column-in-wall tolerance', ftIn({ value: cfg.col_wall_tol_ft, min: 0, max: 2, onChange: (v) => set('col_wall_tol_ft', v) })),
            field('Floor load (kN/m²)', num({ value: cfg.floor_load_kn_m2, min: 2, max: 30, step: 0.5, onChange: (v) => set('floor_load_kn_m2', v) })),
            field('Roof load (kN/m²)', num({ value: cfg.roof_load_kn_m2, min: 2, max: 30, step: 0.5, onChange: (v) => set('roof_load_kn_m2', v) })),
            field('Concrete / steel', h('div', { class: 'inl' }, select([20, 25, 30, 35], cfg.fck, (v) => set('fck', Number(v))), select([415, 500, 550], cfg.fy, (v) => set('fy', Number(v)))), 'M-grade / Fe-grade')),
          h('div', { class: 'grid2', style: { marginTop: '12px' } },
            checkbox('Keep columns out of the Brahmasthan', cfg.avoid_core_columns, (v) => set('avoid_core_columns', v), 'Hard rule.'),
            checkbox('Columns must sit in a wall line', cfg.require_columns_in_walls, (v) => set('require_columns_in_walls', v), 'Hard rule.')))));
  }

  function stepRooms() {
    const P = cfg.program;
    const counter = (key, label, hint, min = 0, max = 8) => {
      const out = h('output', {}, String(P[key] || 0));
      const bump = (d) => { P[key] = Math.max(min, Math.min(max, (P[key] || 0) + d)); out.value = String(P[key]); changed(); };
      return h('div', { class: 'counter' }, h('div', {}, h('b', {}, label), hint ? h('div', { class: 'small muted' }, hint) : null),
        h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': `Fewer ${label}`, onclick: () => bump(-1) }, '−'), out, h('button', { type: 'button', 'aria-label': `More ${label}`, onclick: () => bump(1) }, '+')));
    };
    main.append(h('h2', {}, 'Rooms'), h('p', { class: 'intro' }, 'The programme for this floor. The first bedroom becomes the master bedroom (largest, with an attached bath). Passages, lobbies and landings are added by the generator as needed.'),
      h('div', { class: 'grid2' },
        counter('bedroom', 'Bedrooms', 'incl. the master', 0, 6), counter('bath', 'Baths / toilets', null, 0, 6),
        counter('kitchen', 'Kitchen', null, 0, 1), counter('dining', 'Dining', null, 0, 1),
        counter('hall', 'Hall / living', null, 0, 1), counter('puja', 'Puja room', null, 0, 1),
        counter('stair', 'Staircase', 'internal dog-leg stair', 0, 1), counter('veranda', 'Veranda', 'open sit-out on an outer wall', 0, 2)),
      h('fieldset', { style: { marginTop: '18px' } }, h('legend', {}, 'Courtyards (open to sky)'),
        h('div', { class: 'grid2' },
          field('At least', num({ value: cfg.min_courtyards, min: 0, max: 2, onChange: (v) => { set('min_courtyards', Math.round(v)); if (cfg.max_courtyards < cfg.min_courtyards) set('max_courtyards', cfg.min_courtyards); } })),
          field('At most', num({ value: cfg.max_courtyards, min: 0, max: 2, onChange: (v) => set('max_courtyards', Math.round(v)) })))));
  }

  function stepVaastu() {
    const rules = { ...SECTOR_RULES, ...(cfg.sector_rules || {}) };
    const wheel = h('div', { class: 'preview', style: { maxWidth: '260px' } });
    let focus = 'kitchen';
    const drawWheel = () => { wheel.innerHTML = ''; wheel.append(padaWheel(rules[focus], 240)); };
    const rows = TYPES_WITH_RULES.map(([t, label]) => {
      const r = rules[t];
      const tiersIn = h('input', { type: 'text', value: r ? r.tiers.join(', ') : '', placeholder: 'no rule (any pada)', title: 'Padas in order of preference, e.g. N8, E1, E2  (a range N1-N8 counts as one tier)' });
      const mode = select([['hard', 'Hard'], ['soft', 'Soft'], ['none', 'No rule']], r ? (r.hard ? 'hard' : 'soft') : 'none', (v) => apply(v));
      const apply = (m = mode.value) => {
        const tiers = tiersIn.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
        const bad = tiers.filter((x) => !x.split('-').every((q) => PADAS.includes(q)));
        tiersIn.classList.toggle('bad', !!bad.length);
        if (bad.length) { toast(`Unknown pada: ${bad.join(', ')} (use N1…N8, E1…E8, S1…S8, W1…W8)`, 'bad'); return; }
        cfg.sector_rules = { ...(cfg.sector_rules || {}) };
        const val = m === 'none' || !tiers.length ? null : { tiers, hard: m === 'hard' };
        cfg.sector_rules[t] = val; rules[t] = val;
        if (t === 'bedroom') { cfg.sector_rules.master = val; rules.master = val; }
        focus = t; drawWheel(); changed();
      };
      tiersIn.addEventListener('change', () => apply());
      tiersIn.addEventListener('focus', () => { focus = t; drawWheel(); });
      return h('tr', {}, h('td', {}, label), h('td', {}, tiersIn), h('td', { style: { width: '110px' } }, mode));
    });
    const bm = { ...BRAHMASTHAN_MAX_OVERLAP, ...(cfg.brahmasthan_max_overlap || {}) };
    main.append(h('h2', {}, 'Vaastu rules'), h('p', { class: 'intro' }, 'Each room type may list the 32 padas it belongs in, best first. A hard rule needs the set share of the room\'s floor inside its padas; a soft rule only affects the score. Scores: first listed pada = 1.0, last = the floor value, linear in between.'),
      h('fieldset', {}, h('legend', {}, 'Scoring'),
        h('div', { class: 'grid3' },
          field('Share in allowed padas (hard rule)', num({ value: Math.round(cfg.sector_min_frac * 100), min: 30, max: 100, step: 5, onChange: (v) => set('sector_min_frac', v / 100) }), '% of the room\'s floor'),
          field('Weight of the last listed pada', num({ value: cfg.sector_pref_floor, min: 0, max: 1, step: 0.05, onChange: (v) => set('sector_pref_floor', v) })),
          field('Pada mapping', seg([['angular', 'Angular'], ['proportional', 'Proportional']], cfg.sector_mapping, (v) => set('sector_mapping', v)), 'Angular = true compass angles from the centre.'))),
      h('div', { class: 'rules-wrap' },
        h('table', { class: 'rules' }, h('thead', {}, h('tr', {}, h('th', {}, 'Room'), h('th', {}, 'Allowed padas, best first'), h('th', {}, 'Rule'))), h('tbody', {}, rows)),
        h('div', {}, wheel, h('p', { class: 'small muted' }, 'Dark = first-choice pada, light = other allowed padas. Click a row to preview it.'))),
      h('details', { class: 'adv', style: { marginTop: '18px' } }, h('summary', {}, 'Brahmasthan (centre third of the plan)'),
        h('div', {},
          checkbox('Keep heavy / wet rooms out of the Brahmasthan (hard rule)', cfg.brahmasthan_rule, (v) => set('brahmasthan_rule', v)),
          h('div', { class: 'grid4', style: { marginTop: '12px' } }, Object.keys(bm).map((t) => field(`${(ROOM_SPECS[t] || {}).label || t}: max sq ft`,
            num({ value: bm[t], min: 0, max: 400, onChange: (v) => { cfg.brahmasthan_max_overlap = { ...(cfg.brahmasthan_max_overlap || {}), [t]: v }; changed(); } })))))));
    drawWheel();
  }

  function stepSizes() {
    const specs = resolveConfig(cfg).room_specs;
    const upd = (t, key, v) => { cfg.room_specs = { ...(cfg.room_specs || {}) }; cfg.room_specs[t] = { ...(cfg.room_specs[t] || {}), [key]: v }; changed(); };
    main.append(h('h2', {}, 'Room sizes'), h('p', { class: 'intro' }, 'Clear floor sizes (inside the walls). Minimums default to NBC 2016 for residences; maximums keep options sensible. Aspect = long side ÷ short side.'),
      h('table', { class: 'rules' }, h('thead', {}, h('tr', {}, h('th', {}, 'Space'), h('th', {}, 'Min area (sq ft)'), h('th', {}, 'Max area'), h('th', {}, 'Min width'), h('th', {}, 'Max aspect'))),
        h('tbody', {}, SIZE_TYPES.map((t) => {
          const s = specs[t];
          return h('tr', {}, h('td', {}, s.label),
            h('td', {}, num({ value: s.amin, min: 0, max: 600, step: 0.1, onChange: (v) => upd(t, 'amin', v) })),
            h('td', {}, num({ value: s.amax, min: 1, max: 900, step: 1, onChange: (v) => upd(t, 'amax', v) })),
            h('td', {}, ftIn({ value: s.wmin, min: 1, max: 30, onChange: (v) => upd(t, 'wmin', v) })),
            h('td', {}, t === 'passage' ? h('span', { class: 'small muted' }, `width ≤ ${fi(s.wmax)}`) : num({ value: s.asp, min: 1, max: 20, step: 0.1, onChange: (v) => upd(t, 'asp', v) })));
        }))));
  }

  function stepGenerate() {
    const c = resolveConfig(cfg), P = cfg.program, diag = h('div', { class: 'note' }, h('span', { class: 'spin' }), ' Checking that every room has a legal position…');
    let effort = 'standard', relaxed = false;
    main.append(h('h2', {}, 'Generate options'),
      h('p', { class: 'intro' }, 'The search runs on every core of this device. Each layout is checked by the independent rule checker; only layouts that pass every hard rule are shown, ranked by Vaastu score, advisories and circulation area. You can edit any option afterwards.'),
      h('fieldset', {}, h('legend', {}, 'Summary'),
        h('div', { class: 'facts' },
          h('dt', {}, 'Envelope'), h('dd', {}, `${fi(c.ew_ft)} × ${fi(c.ns_ft)} (${Math.round(c.ew_ft * c.ns_ft)} sq ft), road ${c.road_side}`),
          h('dt', {}, 'Rooms'), h('dd', {}, Object.entries(P).filter(([, n]) => n).map(([t, n]) => `${n} ${t}`).join(', ')),
          h('dt', {}, 'Vaastu'), h('dd', {}, `${Math.round(c.sector_min_frac * 100)}% in allowed padas (hard: ${Object.entries(c.sector_rules).filter(([, r]) => r && r.hard).map(([t]) => t).join(', ') || 'none'})`))),
      diag,
      h('fieldset', { style: { marginTop: '18px' } }, h('legend', {}, 'Search'),
        h('div', { class: 'grid2' },
          field('Effort', seg([['quick', 'Quick'], ['standard', 'Standard'], ['thorough', 'Thorough']], effort, (v) => { effort = v; })),
          checkbox('Relaxed: allow layouts that miss the pada share', relaxed, (v) => { relaxed = v; }, 'Like the notebook\'s min_frac = 0: still maximises the score; misses are flagged.'))),
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          await saveProject(p);
          app.pendingGenerate = { effort, relaxed };
          app.go(`#/p/${p.id}/options`);
        } }, 'Generate options →')));
    app.pool.call(0, { cmd: 'count', cfg: { ...cfg }, diagnose: true }).then(({ count, diag: d }) => {
      clear(diag);
      if (d.missing.length) {
        diag.className = 'note bad';
        diag.append(`No legal position for: ${d.missing.join(', ')}. Check its padas (Vaastu rules), its size limits, or the envelope — or use the relaxed search.`);
      } else {
        diag.className = 'note ok';
        diag.append(`${count} skeletons to search. Every room has legal positions (fewest: ${Object.entries(d.positions).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([t, n]) => `${t} in ${n}`).join(', ')}).`);
      }
    }).catch((e) => { clear(diag).append(`Check failed: ${e.message}`); });
  }

  // ------------------------------------------------------------------ preview
  function drawSide() {
    clear(side);
    let c;
    try { c = resolveConfig(cfg); } catch { return; }
    const st = designStair(c), S = buildStructure(c);
    side.append(h('h3', {}, 'Preview'), h('div', { class: 'preview' }, envelopeSvg(c, S)),
      h('dl', { class: 'facts num' },
        h('dt', {}, 'Built-up'), h('dd', {}, `${Math.round(c.ew_ft * c.ns_ft)} sq ft`),
        h('dt', {}, 'Floor'), h('dd', {}, `${['Ground', 'First', 'Second', 'Third'][c.floor_level] || `Level ${c.floor_level}`}, ${pyG(c.floor_level === 1 ? c.ground_floor_height_ft : c.typical_floor_height_ft)} ft below`),
        h('dt', {}, 'Stair'), h('dd', {}, `${st.risers} × ${st.riser_in.toFixed(2)}", block ${fi(st.block_w)} × ${fi(st.block_l)}`),
        h('dt', {}, 'Columns'), h('dd', {}, `${S.columns.length} on a ${S.xs.length - 1} × ${S.ys.length - 1} bay grid`),
        h('dt', {}, 'Brahmasthan'), h('dd', {}, `${fi(c.ew_ft / 3)} × ${fi(c.ns_ft / 3)} at the centre`)),
      h('p', { class: 'small muted' }, 'Purple lines: the 32 padas from the building centre. Shaded: Brahmasthan. Dots: columns. Grey band: road.'));
  }
  nav(); drawStep(); drawSide();
}

function textIn(value, onChange) {
  const i = h('input', { type: 'text', value: value || '' });
  i.addEventListener('change', () => onChange(i.value.trim()));
  return i;
}

/** Envelope preview: padas, Brahmasthan, columns, road, north. */
function envelopeSvg(c, S) {
  const W = c.ew_ft, H = c.ns_ft, m = 7, vw = W + 2 * m, vh = H + 2 * m;
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `${-m} ${-m} ${vw} ${vh}`);
  const Y = (y) => H - y;
  const add = (tag, a) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); svg.append(e); return e; };
  const road = { E: [W + 1.5, -2, 3, H + 4], W: [-4.5, -2, 3, H + 4], N: [-2, Y(H) - 4.5, W + 4, 3], S: [-2, Y(0) + 1.5, W + 4, 3] }[c.road_side];
  add('rect', { x: road[0], y: road[1], width: road[2], height: road[3], fill: '#e5e7eb' });
  const core = coreRect(c);
  add('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff', stroke: '#111', 'stroke-width': Math.max(W, H) / 160 });
  add('rect', { x: core.x0, y: Y(core.y1), width: core.x1 - core.x0, height: core.y1 - core.y0, fill: 'rgba(245, 158, 11, 0.16)', stroke: 'rgba(245, 158, 11, 0.6)', 'stroke-width': 0.15, 'stroke-dasharray': '0.6 0.4' });
  const fr = sectorFrame(c), sw = Math.max(W, H) / 400;
  for (const p of PADAS) {
    const [a0] = padaRange(p), a = (a0 - fr.rot) * Math.PI / 180, L = 1e3;
    const x1 = fr.cx + fr.sx * L * Math.sin(a), y1 = fr.cy + fr.sy * L * Math.cos(a);
    const t = Math.min(...[[(0 - fr.cx) / (x1 - fr.cx)], [(W - fr.cx) / (x1 - fr.cx)], [(0 - fr.cy) / (y1 - fr.cy)], [(H - fr.cy) / (y1 - fr.cy)]].map(([v]) => (v > 0 ? v : Infinity)));
    add('line', { x1: fr.cx, y1: Y(fr.cy), x2: fr.cx + (x1 - fr.cx) * t, y2: Y(fr.cy + (y1 - fr.cy) * t), stroke: p.endsWith('1') ? '#7a1fa2' : '#c4a5dc', 'stroke-width': p.endsWith('1') ? sw * 2.2 : sw });
    const am = (a0 + 360 / 64 - fr.rot) * Math.PI / 180, R = Math.max(W, H) * 0.5 + 3.2;
    const lx = fr.cx + R * Math.sin(am) * (W / Math.max(W, H)) * 1.05, ly = fr.cy + R * Math.cos(am) * (H / Math.max(W, H)) * 1.12;
    if (p.endsWith('1') || p.endsWith('5')) { const tx = add('text', { x: Math.min(W + 4.5, Math.max(-4.5, lx)), y: Y(Math.min(H + 4, Math.max(-4, ly))), 'font-size': Math.max(W, H) / 34, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#7a1fa2' }); tx.textContent = p; }
  }
  for (const col of S.columns) add('rect', { x: col.x - 0.35, y: Y(col.y) - 0.35, width: 0.7, height: 0.7, fill: '#111' });
  const nx = W + (c.road_side === 'E' ? 5.6 : 3.5), ny = -m + 2.2;
  add('path', { d: `M${nx} ${ny} l-0.9 2.4 h1.8 z`, fill: '#111' });
  const n = add('text', { x: nx, y: ny + 4.2, 'font-size': 2, 'text-anchor': 'middle', 'font-weight': 700 }); n.textContent = 'N';
  return svg;
}

/** 32-pada wheel for one rule: dark = first tier, light = other allowed padas. */
function padaWheel(rule, size) {
  const svg = document.createElementNS(svgNS, 'svg'), r = 46;
  svg.setAttribute('viewBox', '-60 -60 120 120'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  const first = rule ? new Set(expandTier(rule.tiers[0])) : new Set(), allowed = rule ? new Set(rule.tiers.flatMap(expandTier)) : new Set();
  for (const p of PADAS) {
    const [a0, a1] = padaRange(p), A = (d) => (d - 90) * Math.PI / 180;
    const pt = (d, rr) => `${(rr * Math.cos(A(d))).toFixed(2)} ${(rr * Math.sin(A(d))).toFixed(2)}`;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M${pt(a0, 18)} L${pt(a0, r)} A${r} ${r} 0 0 1 ${pt(a1, r)} L${pt(a1, 18)} A18 18 0 0 0 ${pt(a0, 18)} Z`);
    path.setAttribute('fill', first.has(p) ? '#1d4ed8' : allowed.has(p) ? '#93c5fd' : '#f3f4f6');
    path.setAttribute('stroke', '#fff'); path.setAttribute('stroke-width', '0.8');
    const t = document.createElementNS(svgNS, 'title'); t.textContent = p; path.append(t);
    svg.append(path);
    const lbl = document.createElementNS(svgNS, 'text'), mid = (a0 + a1) / 2;
    const [x, y] = pt(mid, 53).split(' ').map(Number);
    lbl.setAttribute('x', x); lbl.setAttribute('y', y); lbl.setAttribute('font-size', '4.2'); lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('dominant-baseline', 'middle'); lbl.setAttribute('fill', '#6b7280');
    lbl.textContent = p; svg.append(lbl);
  }
  for (const [d, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const t = document.createElementNS(svgNS, 'text'), a = (d - 90) * Math.PI / 180;
    t.setAttribute('x', (9 * Math.cos(a)).toFixed(2)); t.setAttribute('y', (9 * Math.sin(a)).toFixed(2)); t.setAttribute('font-size', '7'); t.setAttribute('font-weight', '700');
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle'); t.textContent = l; svg.append(t);
  }
  return svg;
}
