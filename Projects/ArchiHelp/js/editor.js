// ArchiHelp — plan editor. The canvas is the engine's own A-101 drawing (what you see is what gets printed);
// an overlay in plan feet carries hover, selection and tool previews. Every change is a pure document edit
// (engine/edits.js), re-checked by the independent rule checker straight away, undoable, and autosaved.
import { h, s, clear, toast, modal, field, ftIn, seg, select } from './dom.js';
import { newId } from './store.js';
import { analysePlan, prepareConfig } from '../engine/index.js';
import { planSheet } from '../engine/drawing.js';
import { sheetToSvg } from '../engine/sheet.js';
import * as E from '../engine/edits.js';
import { fi, rw, rh } from '../engine/geom.js';
import { region } from '../engine/plan.js';
import { ROOM_TYPES } from '../engine/config.js';
import { renderSide } from './inspector.js';
import { openDrawings } from './drawings.js';
import { placeProto, snapToWalls, AUTO_TYPES, KIND_NAMES } from './palette.js';

const ICON = {
  select: ['M6 3l12 9-5.5 1L10 19z'],
  pan: ['M8 12V5.5a1.5 1.5 0 013 0V11', 'M11 10V4a1.5 1.5 0 013 0v6', 'M14 10V5.5a1.5 1.5 0 013 0V11', 'M17 11V8.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6.5 6.5 0 01-5.3-2.7L3.6 15a1.6 1.6 0 012.6-1.9L8 15'],
  split: ['M4 5h16v14H4z', 'M12 5v14'],
  door: ['M3 20h4', 'M17 20h4', 'M7 20V8', 'M7 8a12 12 0 0110 12'],
  open: ['M3 12h6', 'M15 12h6', 'M9 7v10', 'M15 7v10'],
  nowall: ['M4 6h16v12H4z', 'M12 6v2.5', 'M12 10.75v2.5', 'M12 15.5V18'],
  window: ['M3 9h18v6H3z', 'M3 12h18'],
  furniture: ['M5 11V8a2 2 0 012-2h10a2 2 0 012 2v3', 'M3 13a2 2 0 014 0v2h10v-2a2 2 0 014 0v5H3z'],
  keepout: ['M4 4h16v16H4z', 'M4 12l8-8', 'M4 20L20 4', 'M12 20l8-8'],
};
const TOOLS = [
  ['select', 'Select & move (V)', 'v'], ['pan', 'Pan (H, or hold Space)', 'h'], null,
  ['split', 'Split a room with a new wall (S)', 's'], ['door', 'Door between two rooms (D)', 'd'], ['open', 'Opening without a shutter (O)', 'o'],
  ['nowall', 'No wall between two rooms (N)', 'n'], ['window', 'Window on an outer wall (W)', 'w'], null,
  ['furniture', 'Place furniture (F)', 'f'], ['keepout', 'Keep-out zone: no tall furniture (K)', 'k'],
];
const HINT = {
  select: 'Click to select. Drag walls, doors, windows and furniture. Arrows nudge · R rotates · Delete removes · ⌘Z undoes.',
  pan: 'Drag to move around. Scroll or pinch to zoom.',
  split: 'Click inside a room to add a wall there. Tab switches between a north–south and an east–west wall.',
  door: 'Click the wall between two rooms. The door swings into the room on the side you click.',
  open: 'Click the wall between two rooms to make an opening without a shutter.',
  nowall: 'Click the wall between two rooms to take it away (the spaces stay separately named).',
  window: 'Click an outer wall of a room to set its window.',
  furniture: 'Pick an item in the panel, then click in a room. Wall items back onto the nearest wall.',
  keepout: 'Drag a rectangle inside a room: no tall furniture will be placed there.',
};
const SNAPS = [[1 / 24, '½"'], [1 / 12, '1"'], [0.25, '3"'], [0.5, '6"'], [1, "1'"]];
const SIDE_NAME = { S: 'south', N: 'north', W: 'west', E: 'east' };

export function renderEditor(root, app, idxIn) {
  const p = app.project;
  if (!p.plans.length) { app.go(`#/p/${p.id}/options`); return; }
  const idx = Math.min(Math.max(0, Number(idxIn) || 0), p.plans.length - 1);
  for (const d of p.plans) if (!d.pid) d.pid = newId();
  if (p.activePlan !== idx) { p.activePlan = idx; app.save(); }
  const stored = (k, dflt) => { try { const v = JSON.parse(localStorage.getItem(`archihelp:${k}`)); return v ?? dflt; } catch { return dflt; } };
  const ed = {
    app, p, idx, cfg: prepareConfig(p.cfg), doc: p.plans[idx], plan: null,
    sel: null, hover: null, tool: 'select', snap: stored('snap', 1 / 12), placing: null, splitAxis: null,
    show: { furniture: true, dims: false, padas: false, grid: true, ...stored('show', {}) },
    undo: [], redo: [], msg: '', tab: 'inspect', vb: null, map: null, cursor: null,
  };
  ed.plan = analysePlan(ed.cfg, ed.doc);

  // ------------------------------------------------------------------------------------------ layout
  const toolsEl = h('nav', { class: 'ed-tools', 'aria-label': 'Tools' });
  const svg = s('svg', { role: 'application', 'aria-label': 'Floor plan editor', tabindex: '0', 'aria-describedby': 'edHint' });
  const gBg = s('g', { 'font-family': 'Helvetica, Arial, sans-serif' }), gOv = s('g', { class: 'ov' });
  svg.append(gBg, gOv);
  const hintEl = h('div', { class: 'ed-hint', id: 'edHint' });
  const viewEl = h('div', { class: 'ed-zoom' });
  const canvas = h('div', { class: 'ed-canvas' }, svg, hintEl, viewEl);
  const sideEl = h('aside', { class: 'ed-side', 'aria-label': 'Inspector' });
  const statusEl = h('div', { class: 'ed-status', role: 'status' });
  root.append(h('div', { class: 'ed' }, toolsEl, canvas, sideEl, statusEl));

  // ------------------------------------------------------------------------------------------ state changes
  ed.select = (sel, { tab = true } = {}) => { ed.sel = sel; if (sel && tab) ed.tab = 'inspect'; drawOverlay(); renderSide(ed, sideEl); };
  /** Apply an edit: fn(doc, plan) -> new doc. EditErrors become a message; the old doc goes on the undo stack. */
  ed.apply = (fn, msg, { sel } = {}) => {
    let nd;
    try { nd = fn(ed.doc, ed.plan); } catch (e) {
      if (e instanceof E.EditError) { toast(e.message, 'bad', 4500); return false; }
      console.error(e); toast(`That edit failed: ${e.message}`, 'bad', 6000); return false;
    }
    if (!nd || nd === ed.doc) return false;
    ed.undo.push(ed.doc); if (ed.undo.length > 300) ed.undo.shift();
    ed.redo = [];
    commit(nd, msg, sel);
    return true;
  };
  function commit(nd, msg, sel) {
    ed.doc = nd; p.plans[ed.idx] = nd;
    ed.plan = analysePlan(ed.cfg, nd);
    if (sel !== undefined) ed.sel = typeof sel === 'function' ? sel(ed.plan) : sel;
    validateSel();
    ed.msg = msg || '';
    app.save();
    renderAll();
  }
  ed.undoFn = () => { if (!ed.undo.length) { toast('Nothing to undo.'); return; } ed.redo.push(ed.doc); commit(ed.undo.pop(), 'Undone.'); };
  ed.redoFn = () => { if (!ed.redo.length) { toast('Nothing to redo.'); return; } ed.undo.push(ed.doc); commit(ed.redo.pop(), 'Redone.'); };
  ed.replaceDoc = (nd, msg) => { ed.undo.push(ed.doc); ed.redo = []; commit(nd, msg, null); };
  ed.setTool = (t, opts = {}) => {
    ed.tool = t; ed.hover = null; ed.preview = null;
    if (t !== 'furniture') ed.placing = null;
    if (opts.placing) ed.placing = opts.placing;
    canvas.classList.toggle('picking', t !== 'select' && t !== 'pan');
    if (t === 'furniture') ed.tab = 'inspect';
    renderTools(); drawOverlay(); renderHint(); renderSide(ed, sideEl);
  };
  ed.wallOf = (sel) => E.wallComponents(ed.doc, ed.cfg).find((c) => c.closed && c.rooms.some(([u, e]) => u === sel.ref[0] && e === sel.ref[1])) || null;
  ed.linkK = (sel) => ed.plan.links_all.findIndex((l) => (sel.entrance ? !!l.entrance : !l.entrance && ((l.a === sel.a && l.b === sel.b) || (l.a === sel.b && l.b === sel.a))));
  ed.room = (uid) => ed.plan.rooms.find((r) => r.uid === uid);
  ed.needsManual = (uid) => { const r = ed.room(uid), fs = (ed.doc.furniture || {})[uid]; return !!r && AUTO_TYPES.has(r.rtype) && (!fs || fs.mode !== 'manual'); };
  /** Hand layout from the planner's: items copied, and the doors into the room pinned where they are. */
  ed.toManual = (doc, plan, uid) => {
    let d = E.furnitureToManual(doc, plan, uid);
    plan.links_all.forEach((l, k) => {
      if (l.into !== uid || !plan.door_plan.has(k) || l.kind === 'nowall') return;
      if (l.kind === 'open' && ed.room(l.into).rtype !== 'kitchen') return;
      const pinned = l.entrance ? !!(doc.meta && doc.meta.entranceHint) : !!(l.hint && l.hint.at !== undefined);
      if (!pinned) d = E.placeLink(d, plan, k, { clamp: false });
    });
    return d;
  };
  ed.editItem = (uid, i, patch, msg) => ed.apply((doc, plan) => E.updateItem(ed.needsManual(uid) ? ed.toManual(doc, plan, uid) : doc, uid, i, patch), msg);
  ed.addItemTo = (uid, item) => ed.apply((doc) => {
    let d = E.addItem(doc, uid, item);
    if (!AUTO_TYPES.has(ed.room(uid).rtype)) d = E.setFurniture(d, uid, { mode: 'manual' });
    return d;
  }, `Added ${(KIND_NAMES[item.kind] || item.kind).toLowerCase()} to ${ed.room(uid).name}.`,
  { sel: (plan) => ({ t: 'item', uid, i: (plan.furniture[uid] || []).length - 1 }) });
  ed.fitView = () => fit();
  ed.renderAll = () => renderAll();
  ed.openDrawings = () => openDrawings(ed);
  ed.splitDialog = (r, axis, at) => splitDialog(r, axis, at);

  function validateSel() {
    const sl = ed.sel;
    if (!sl) return;
    const ok = sl.t === 'room' ? !!ed.room(sl.uid)
      : sl.t === 'wall' ? !!ed.wallOf(sl)
        : sl.t === 'link' ? ed.linkK(sl) >= 0
          : sl.t === 'window' ? !!ed.room(sl.room)
            : sl.t === 'item' ? !!(ed.plan.furniture[sl.uid] && ed.plan.furniture[sl.uid][sl.i])
              : sl.t === 'keepout' ? !!(ed.doc.keepouts || [])[sl.i] : false;
    if (!ok) ed.sel = null;
  }

  // ------------------------------------------------------------------------------------------ rendering
  function renderAll() { renderCanvas(); renderSide(ed, sideEl); renderStatus(); renderTop(); }
  let rafPending = false;
  const renderSoon = () => { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; renderCanvas(); renderStatus(); }); };

  function renderCanvas() {
    const { sheet, map, size } = planSheet(ed.plan, { furniture: ed.show.furniture, dims: ed.show.dims, tint: true, labels: true, tags: true, grid: ed.show.grid, columns: ed.show.grid, sectors: ed.show.padas, north: true });
    const str = sheetToSvg(sheet, { bg: '#ffffff' });
    gBg.innerHTML = str.slice(str.indexOf('>') + 1, str.lastIndexOf('</svg>'));
    ed.map = { ...map, W: size[0], H: size[1] };
    gOv.setAttribute('transform', `matrix(${map.s} 0 0 ${-map.s} ${-map.x0 * map.s} ${size[1] + map.y0 * map.s})`);
    if (!ed.vb) fit();
    drawOverlay();
  }
  function fit() {
    if (!ed.map) return;
    const { W, H } = ed.map, m = 0.02;
    ed.vb = [-W * m, -H * m, W * (1 + 2 * m), H * (1 + 2 * m)];
    svg.setAttribute('viewBox', ed.vb.join(' '));
    drawOverlay();
  }
  const ppf = () => { const m = gOv.getScreenCTM(); return m ? Math.hypot(m.a, m.b) || 1 : 1; };
  const toFt = (e) => { const m = gOv.getScreenCTM(); if (!m) return [0, 0]; const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return [q.x, q.y]; };
  const rectEl = (r, cls) => s('rect', { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), width: Math.abs(r.x1 - r.x0), height: Math.abs(r.y1 - r.y0), class: cls });
  const lineEl = (x1, y1, x2, y2, cls, extra = {}) => s('line', { x1, y1, x2, y2, class: cls, ...extra });

  function shapeOf(sl, cls) {
    const out = [], cfg = ed.cfg;
    if (!sl) return out;
    if (sl.t === 'room') { const r = ed.room(sl.uid); if (r) out.push(rectEl(r.net, cls)); }
    else if (sl.t === 'wall') {
      const w = sl.w || ed.wallOf(sl);
      if (w) {
        const t = cfg.t_int;
        const r = w.axis === 'x' ? { x0: w.at - t / 2, y0: w.lo, x1: w.at + t / 2, y1: w.hi } : { x0: w.lo, y0: w.at - t / 2, x1: w.hi, y1: w.at + t / 2 };
        out.push(rectEl(r, `${cls} wall`));
        if (cls === 'sel') {
          const mid = (w.lo + w.hi) / 2, hs = 6 / ppf();
          const c = w.axis === 'x' ? [w.at, mid] : [mid, w.at];
          out.push(s('rect', { x: c[0] - hs, y: c[1] - hs, width: 2 * hs, height: 2 * hs, class: 'handle' }));
        }
      }
    } else if (sl.t === 'link') {
      const k = sl.k ?? ed.linkK(sl), l = ed.plan.links_all[k];
      if (!l) return out;
      const o = ed.plan.openings.find((q) => q.link === k && q.kind !== 'window');
      if (o) out.push(rectEl(o.horiz ? { x0: o.x - o.w / 2, y0: o.y - o.t / 2 - 0.15, x1: o.x + o.w / 2, y1: o.y + o.t / 2 + 0.15 } : { x0: o.x - o.t / 2 - 0.15, y0: o.y - o.w / 2, x1: o.x + o.t / 2 + 0.15, y1: o.y + o.w / 2 }, cls));
      else { const [[x0, y0], [x1, y1]] = l.seg, t = cfg.t_int / 2 + 0.15; out.push(rectEl(Math.abs(y0 - y1) < 1e-6 ? { x0: Math.min(x0, x1), y0: y0 - t, x1: Math.max(x0, x1), y1: y0 + t } : { x0: x0 - t, y0: Math.min(y0, y1), x1: x0 + t, y1: Math.max(y0, y1) }, cls)); }
    } else if (sl.t === 'window') {
      const r = ed.room(sl.room);
      if (!r) return out;
      const ws = ed.plan.openings.filter((o) => o.kind === 'window' && o.into === sl.room && windowSide(o, r) === sl.side);
      for (const o of ws) out.push(rectEl(o.horiz ? { x0: o.x - o.w / 2, y0: o.y - o.t / 2 - 0.15, x1: o.x + o.w / 2, y1: o.y + o.t / 2 + 0.15 } : { x0: o.x - o.t / 2 - 0.15, y0: o.y - o.w / 2, x1: o.x + o.t / 2 + 0.15, y1: o.y + o.w / 2 }, cls));
      const t = r.tile, e = cfg.t_ext / 2 + 0.1, side = sl.side;
      const band = side === 'S' ? { x0: t.x0, y0: t.y0 - e, x1: t.x1, y1: t.y0 + e } : side === 'N' ? { x0: t.x0, y0: t.y1 - e, x1: t.x1, y1: t.y1 + e }
        : side === 'W' ? { x0: t.x0 - e, y0: t.y0, x1: t.x0 + e, y1: t.y1 } : { x0: t.x1 - e, y0: t.y0, x1: t.x1 + e, y1: t.y1 };
      out.push(rectEl(band, `${cls} band`));
    } else if (sl.t === 'item') {
      const it = (ed.plan.furniture[sl.uid] || [])[sl.i];
      if (it) {
        out.push(rectEl(it.rect, cls));
        if (it.side && cls === 'sel') {
          const r = it.rect, sd = it.side;
          out.push(sd === 'S' ? lineEl(r.x0, r.y0, r.x1, r.y0, 'edge') : sd === 'N' ? lineEl(r.x0, r.y1, r.x1, r.y1, 'edge') : sd === 'W' ? lineEl(r.x0, r.y0, r.x0, r.y1, 'edge') : lineEl(r.x1, r.y0, r.x1, r.y1, 'edge'));
        }
      }
    } else if (sl.t === 'keepout') { const k = (ed.doc.keepouts || [])[sl.i]; if (k) out.push(rectEl(k.rect, cls)); }
    else if (sl.t === 'pair') {
      const [[x0, y0], [x1, y1]] = sl.seg, t = cfg.t_int / 2 + 0.2;
      out.push(rectEl(Math.abs(y0 - y1) < 1e-6 ? { x0: Math.min(x0, x1), y0: y0 - t, x1: Math.max(x0, x1), y1: y0 + t } : { x0: x0 - t, y0: Math.min(y0, y1), x1: x0 + t, y1: Math.max(y0, y1) }, `${cls} wall`));
      const into = ed.room(sl.into);
      if (into && ed.tool === 'door') out.push(rectEl(into.net, 'hov soft'));
    } else if (sl.t === 'outer') { out.push(...shapeOf({ t: 'window', room: sl.room, side: sl.side }, cls)); }
    return out;
  }

  function drawOverlay() {
    if (!ed.map) return;
    clear(gOv);
    if (ed.show.furniture) (ed.doc.keepouts || []).forEach((k) => gOv.append(rectEl(k.rect, 'ko')));
    if (ed.hover && !sameSel(ed.hover, ed.sel)) gOv.append(...shapeOf(ed.hover, 'hov'));
    if (ed.sel) gOv.append(...shapeOf(ed.sel, 'sel'));
    const pv = ed.preview;
    if (pv) {
      if (pv.t === 'split') gOv.append(pv.axis === 'x' ? lineEl(pv.at, pv.r.net.y0, pv.at, pv.r.net.y1, 'guide') : lineEl(pv.r.net.x0, pv.at, pv.r.net.x1, pv.at, 'guide'));
      if (pv.t === 'ghost') gOv.append(rectEl(pv.item.rect, 'ghost'));
      if (pv.t === 'band') gOv.append(rectEl(pv.rect, 'ghost'));
    }
  }
  const sameSel = (a, b) => !!a && !!b && a.t === b.t && JSON.stringify({ ...a, w: undefined, k: undefined }) === JSON.stringify({ ...b, w: undefined, k: undefined });
  ed.drawOverlay = drawOverlay;

  function renderTools() {
    clear(toolsEl);
    for (const t of TOOLS) {
      if (!t) { toolsEl.append(h('hr')); continue; }
      const [id, tip] = t;
      const b = h('button', { class: `tool ${ed.tool === id ? 'on' : ''}`, type: 'button', 'data-tip': tip, 'aria-label': tip, 'aria-pressed': String(ed.tool === id), 'data-tool': id, onclick: () => ed.setTool(id) });
      const ic = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
      for (const d of ICON[id]) ic.append(s('path', { d }));
      b.append(ic);
      toolsEl.append(b);
    }
  }
  function renderHint(extra) {
    hintEl.textContent = extra || (ed.tool === 'split' ? `${HINT.split} Now: ${(ed.splitAxis || 'auto') === 'auto' ? 'across the longer side' : ed.splitAxis === 'x' ? 'north–south wall' : 'east–west wall'}.` : HINT[ed.tool]);
  }
  function renderView() {
    clear(viewEl);
    const tg = (key, label, tip) => h('button', { class: `btn sm ${ed.show[key] ? 'on' : ''}`, type: 'button', title: tip, 'aria-pressed': String(!!ed.show[key]),
      onclick: () => { ed.show[key] = !ed.show[key]; localStorage.setItem('archihelp:show', JSON.stringify(ed.show)); renderView(); renderCanvas(); } }, label);
    viewEl.append(tg('furniture', 'Furniture', 'Show furniture'), tg('dims', 'Dims', 'Dimension chains'), tg('padas', 'Padas', '32 Vaastu padas'), tg('grid', 'Grid', 'Structural grid and columns'),
      h('button', { class: 'btn sm icon', type: 'button', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, '−'),
      h('button', { class: 'btn sm icon', type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.25) }, '+'),
      h('button', { class: 'btn sm', type: 'button', title: 'Fit the plan (0)', onclick: fit }, 'Fit'));
  }
  function renderStatus() {
    clear(statusEl);
    const pl = ed.plan, soft = pl.checks.filter((c) => !c.hard && !c.ok).length;
    statusEl.append(
      h('button', { class: 'btn sm ghost num', type: 'button', title: 'Open the checks', onclick: () => { ed.tab = 'checks'; renderSide(ed, sideEl); } },
        h('b', {}, `Vaastu ${pl.vaastu_score.toFixed(1)}`)),
      pl.failed.length ? h('span', { class: 'badge bad' }, `${pl.failed.length} hard rule${pl.failed.length === 1 ? '' : 's'} missed`) : h('span', { class: 'badge ok' }, 'Hard rules pass'),
      h('span', { class: `badge ${soft ? 'adv' : 'plain'}` }, `${soft} advisor${soft === 1 ? 'y' : 'ies'}`),
      h('label', { class: 'row small', style: { gap: '4px' } }, 'Snap', select(SNAPS.map(([v, l]) => [String(v), l]), String(ed.snap), (v) => { ed.snap = Number(v); localStorage.setItem('archihelp:snap', JSON.stringify(ed.snap)); }, { style: { height: '26px', width: 'auto', padding: '0 4px' }, 'aria-label': 'Snap step' })),
      h('span', { class: 'num muted', id: 'edCoords' }, ed.cursor ? coordsText(ed.cursor) : ''),
      h('span', { class: 'msg', title: ed.msg }, ed.msg));
  }
  const coordsText = ([x, y]) => `${fi(Math.max(0, x))} E, ${fi(Math.max(0, y))} N`;
  function renderTop() {
    app.actions([
      h('button', { class: 'btn sm icon', type: 'button', title: 'Undo (⌘Z)', 'aria-label': 'Undo', disabled: !ed.undo.length, onclick: ed.undoFn }, '↶'),
      h('button', { class: 'btn sm icon', type: 'button', title: 'Redo (⇧⌘Z)', 'aria-label': 'Redo', disabled: !ed.redo.length, onclick: ed.redoFn }, '↷'),
      h('button', { class: 'btn sm primary', type: 'button', onclick: ed.openDrawings, title: 'A3 drawing set: plan, Vaastu, structure, schedules' }, h('span', { class: 'hide-sm' }, 'Drawings & '), 'PDF'),
    ]);
    const planSel = select(p.plans.map((d, i) => [String(i), d.label || `Plan ${i + 1}`]), String(ed.idx), (v) => app.go(`#/p/${p.id}/plan/${v}`),
      { 'aria-label': 'Plan', style: { height: '28px', width: 'auto', maxWidth: '220px', padding: '0 6px' } });
    app.crumbs([['Projects', '#/'], [p.name, `#/p/${p.id}/setup`], ['Options', `#/p/${p.id}/options`]]);
    const nav = document.getElementById('crumbs');
    nav.append(h('span', { class: 'sep' }, '/'), planSel);
  }

  // ------------------------------------------------------------------------------------------ geometry helpers
  const R = region(ed.cfg);
  const clampIn = (x, y) => [Math.min(R.x1 - 1e-6, Math.max(R.x0 + 1e-6, x)), Math.min(R.y1 - 1e-6, Math.max(R.y0 + 1e-6, y))];
  function roomAt(x, y) {
    const [cx, cy] = clampIn(x, y);
    const hits = ed.plan.rooms.filter((r) => cx >= r.tile.x0 - 1e-9 && cx <= r.tile.x1 + 1e-9 && cy >= r.tile.y0 - 1e-9 && cy <= r.tile.y1 + 1e-9);
    return hits.find((r) => cx >= r.net.x0 && cx <= r.net.x1 && cy >= r.net.y0 && cy <= r.net.y1) || hits[0] || null;
  }
  function windowSide(o, r) { return o.horiz ? (Math.abs(o.y - r.tile.y0) < Math.abs(o.y - r.tile.y1) ? 'S' : 'N') : (Math.abs(o.x - r.tile.x0) < Math.abs(o.x - r.tile.x1) ? 'W' : 'E'); }
  ed.windowSide = windowSide;
  /** Wall between two rooms at (x, y): {a: room clicked, b: neighbour, seg} */
  function pairAt(x, y) {
    const r = roomAt(x, y);
    if (!r) return null;
    const tol = ed.cfg.t_int / 2 + 8 / ppf(), t = r.tile;
    const d = [['W', Math.abs(x - t.x0)], ['E', Math.abs(t.x1 - x)], ['S', Math.abs(y - t.y0)], ['N', Math.abs(t.y1 - y)]].sort((a, b) => a[1] - b[1]);
    for (const [side, dist] of d) {
      if (dist > tol) break;
      const q = ed.plan.rooms.find((o) => o.uid !== r.uid && (side === 'W' ? Math.abs(o.tile.x1 - t.x0) < 1e-6 && y >= o.tile.y0 && y <= o.tile.y1
        : side === 'E' ? Math.abs(o.tile.x0 - t.x1) < 1e-6 && y >= o.tile.y0 && y <= o.tile.y1
          : side === 'S' ? Math.abs(o.tile.y1 - t.y0) < 1e-6 && x >= o.tile.x0 && x <= o.tile.x1
            : Math.abs(o.tile.y0 - t.y1) < 1e-6 && x >= o.tile.x0 && x <= o.tile.x1));
      if (q) { const [L, sg] = sharedSeg(r.tile, q.tile); if (L > 0) return { t: 'pair', a: r.uid, b: q.uid, into: r.uid, seg: sg }; }
    }
    return null;
  }
  function sharedSeg(a, b) {
    if (Math.abs(a.x1 - b.x0) < 1e-6 || Math.abs(b.x1 - a.x0) < 1e-6) { const x = Math.abs(a.x1 - b.x0) < 1e-6 ? a.x1 : a.x0, y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1); return [y1 - y0, [[x, y0], [x, y1]]]; }
    const y = Math.abs(a.y1 - b.y0) < 1e-6 ? a.y1 : a.y0, x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1); return [x1 - x0, [[x0, y], [x1, y]]];
  }
  /** Outer wall (envelope or courtyard) of a room at (x, y): {room, side} */
  function outerAt(x, y) {
    const r = roomAt(x, y);
    if (!r) return null;
    const tol = ed.cfg.t_ext / 2 + 10 / ppf(), t = r.tile, courts = ed.plan.rooms.filter((q) => q.rtype === 'court');
    const ext = { S: Math.abs(t.y0 - R.y0) < 1e-6, N: Math.abs(t.y1 - R.y1) < 1e-6, W: Math.abs(t.x0 - R.x0) < 1e-6, E: Math.abs(t.x1 - R.x1) < 1e-6 };
    for (const c of courts) { const [L, sg] = sharedSeg(t, c.tile); if (L >= 2.5 && c.uid !== r.uid) ext[sg[0][1] === sg[1][1] ? (Math.abs(sg[0][1] - t.y0) < 1e-6 ? 'S' : 'N') : (Math.abs(sg[0][0] - t.x0) < 1e-6 ? 'W' : 'E')] = true; }
    const d = [['W', Math.abs(x - t.x0)], ['E', Math.abs(t.x1 - x)], ['S', Math.abs(y - t.y0)], ['N', Math.abs(t.y1 - y)]].filter(([sd]) => ext[sd]).sort((a, b) => a[1] - b[1]);
    if (d.length && d[0][1] <= tol) return { t: 'outer', room: r.uid, side: d[0][0] };
    return null;
  }
  function hitTest(x, y) {
    const pl = ed.plan, tol = 6 / ppf();
    if (ed.show.furniture) {
      let best = null;
      for (const [uid, items] of Object.entries(pl.furniture || {})) items.forEach((it, i) => {
        const r = it.rect;
        if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) { const a = rw(r) * rh(r); if (!best || a < best.a) best = { t: 'item', uid: Number(uid), i, a }; }
      });
      if (best) return { t: 'item', uid: best.uid, i: best.i };
    }
    for (const o of pl.openings) {
      const along = o.horiz ? Math.abs(x - o.x) : Math.abs(y - o.y), across = o.horiz ? Math.abs(y - o.y) : Math.abs(x - o.x);
      if (along <= o.w / 2 && across <= o.t / 2 + tol) {
        if (o.kind === 'window') { const r = ed.room(o.into); return { t: 'window', room: o.into, side: windowSide(o, r) }; }
        const l = pl.links_all[o.link];
        return l.entrance ? { t: 'link', entrance: true } : { t: 'link', a: l.a, b: l.b };
      }
    }
    for (const l of pl.links_all) {
      if (l.kind !== 'nowall') continue;
      const [[x0, y0], [x1, y1]] = l.seg, hz = Math.abs(y0 - y1) < 1e-6;
      const inSpan = hz ? x >= Math.min(x0, x1) && x <= Math.max(x0, x1) : y >= Math.min(y0, y1) && y <= Math.max(y0, y1);
      if (inSpan && (hz ? Math.abs(y - y0) : Math.abs(x - x0)) <= ed.cfg.t_int / 2 + tol) return { t: 'link', a: l.a, b: l.b };
    }
    if (ed.show.furniture) {
      const ki = (ed.doc.keepouts || []).findIndex((k) => x >= k.rect.x0 && x <= k.rect.x1 && y >= k.rect.y0 && y <= k.rect.y1);
      if (ki >= 0) return { t: 'keepout', i: ki };
    }
    const w = E.wallAt(ed.doc, ed.cfg, x, y, ed.cfg.t_int / 2 + tol);
    if (w) return { t: 'wall', ref: w.rooms[0] };
    const o = outerAt(x, y);
    if (o && (x < R.x0 + ed.cfg.t_ext / 2 || x > R.x1 - ed.cfg.t_ext / 2 || y < R.y0 + ed.cfg.t_ext / 2 || y > R.y1 - ed.cfg.t_ext / 2)) return { t: 'window', room: o.room, side: o.side };
    const r = roomAt(x, y);
    return r && x >= -0.5 && y >= -0.5 && x <= ed.cfg.ew_ft + 0.5 && y <= ed.cfg.ns_ft + 0.5 ? { t: 'room', uid: r.uid } : null;
  }
  const sn = (v) => Math.round(v / ed.snap) * ed.snap;

  // ------------------------------------------------------------------------------------------ hover + previews per tool
  function updateHover(x, y) {
    const t = ed.tool;
    ed.preview = null;
    if (t === 'select') ed.hover = hitTest(x, y);
    else if (t === 'door' || t === 'open' || t === 'nowall') ed.hover = pairAt(x, y);
    else if (t === 'window') ed.hover = outerAt(x, y);
    else if (t === 'split') {
      const r = roomAt(x, y); ed.hover = r ? { t: 'room', uid: r.uid } : null;
      if (r) {
        const axis = !ed.splitAxis || ed.splitAxis === 'auto' ? (rw(r.net) >= rh(r.net) ? 'x' : 'y') : ed.splitAxis;
        const lo = axis === 'x' ? r.tile.x0 : r.tile.y0, hi = axis === 'x' ? r.tile.x1 : r.tile.y1, m = ed.cfg.t_int + 1.0;
        const at = Math.min(hi - m - 1e-6, Math.max(lo + m + 1e-6, sn(axis === 'x' ? x : y)));
        ed.preview = { t: 'split', r, axis, at };
      }
    } else if (t === 'furniture') {
      const r = roomAt(x, y); ed.hover = r ? { t: 'room', uid: r.uid } : null;
      if (r && ed.placing) ed.preview = { t: 'ghost', item: placeProto(ed.placing, r.net, x, y, ed.snap), r };
    } else if (t === 'keepout') { const r = roomAt(x, y); ed.hover = r ? { t: 'room', uid: r.uid } : null; }
    else ed.hover = null;
    svg.style.cursor = t === 'select' && ed.hover ? (ed.hover.t === 'wall' ? (ed.wallOf(ed.hover) || {}).axis === 'x' ? 'ew-resize' : 'ns-resize' : ed.hover.t === 'room' ? 'default' : 'move') : '';
    drawOverlay();
  }

  // ------------------------------------------------------------------------------------------ pointer input
  let drag = null, pinch = null, spaceDown = false;
  const pointers = new Map();
  svg.addEventListener('pointerdown', (e) => {
    svg.focus({ preventScroll: true });
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), vb: [...ed.vb], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; drag = null; return; }
    const [x, y] = toFt(e);
    try { svg.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    if (e.button === 1 || ed.tool === 'pan' || spaceDown) { drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, vb: [...ed.vb] }; e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (ed.tool === 'select') drag = { kind: 'press', hit: hitTest(x, y), x, y, cx: e.clientX, cy: e.clientY, base: ed.doc, basePlan: ed.plan, moved: false };
    else if (ed.tool === 'keepout') { const r = roomAt(x, y); drag = r ? { kind: 'keepout', r, x, y } : { kind: 'pan', cx: e.clientX, cy: e.clientY, vb: [...ed.vb] }; }
    else drag = { kind: 'click', x, y, cx: e.clientX, cy: e.clientY, vb: [...ed.vb] };
  });
  svg.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      ed.vb = [...pinch.vb]; zoomAt(pinch.mid[0], pinch.mid[1], d / pinch.d, false);
      return;
    }
    const [x, y] = toFt(e);
    ed.cursor = [x, y];
    const ce = document.getElementById('edCoords'); if (ce) ce.textContent = coordsText([x, y]);
    if (!drag) { updateHover(x, y); return; }
    if (drag.kind === 'pan') { panBy(e.clientX - drag.cx, e.clientY - drag.cy, drag.vb); return; }
    if (drag.kind === 'click') { if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) > 6) drag = { kind: 'pan', cx: drag.cx, cy: drag.cy, vb: drag.vb }; return; }
    if (drag.kind === 'keepout') {
      const n = drag.r.net, cx = (v) => Math.min(n.x1, Math.max(n.x0, v)), cy = (v) => Math.min(n.y1, Math.max(n.y0, v));
      ed.preview = { t: 'band', rect: { x0: cx(sn(Math.min(drag.x, x))), y0: cy(sn(Math.min(drag.y, y))), x1: cx(sn(Math.max(drag.x, x))), y1: cy(sn(Math.max(drag.y, y))) } };
      drawOverlay(); return;
    }
    if (drag.kind === 'press') {
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 4) return;
        drag.moved = true; beginDrag(drag);
      }
      moveDrag(drag, x, y, e);
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    const d = drag; drag = null;
    if (!d) return;
    if (d.kind === 'press') {
      if (d.moved) endDrag(d);
      else ed.select(d.hit);
    } else if (d.kind === 'keepout') {
      const pv = ed.preview; ed.preview = null;
      if (pv && rw(pv.rect) >= 0.5 && rh(pv.rect) >= 0.5) ed.apply((doc) => E.addKeepout(doc, d.r.uid, pv.rect), `Keep-out added in ${d.r.name}.`, { sel: { t: 'keepout', i: (ed.doc.keepouts || []).length } });
      else drawOverlay();
    } else if (d.kind === 'click' && e.type === 'pointerup') toolClick(d.x, d.y);
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('pointerleave', () => { if (!drag) { ed.hover = null; if (ed.tool !== 'split' && ed.tool !== 'furniture') ed.preview = null; drawOverlay(); } });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey && !e.ctrlKey) { panBy(-e.deltaY, -e.deltaX, ed.vb); return; }
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });
  svg.addEventListener('dblclick', (e) => {
    if (ed.tool !== 'select') return;
    const [x, y] = toFt(e), hit = hitTest(x, y);
    if (hit && hit.t === 'room') { ed.select(hit); setTimeout(() => { const inp = sideEl.querySelector('[data-k="room-name"]'); if (inp) { inp.focus(); inp.select(); } }, 30); }
  });

  function panBy(dx, dy, vb0) {
    const m = svg.getScreenCTM(); if (!m) return;
    const k = 1 / m.a;
    ed.vb = [vb0[0] - dx * k, vb0[1] - dy * k, vb0[2], vb0[3]];
    svg.setAttribute('viewBox', ed.vb.join(' '));
  }
  function zoomAt(cx, cy, f, redraw = true) {
    const m = svg.getScreenCTM(); if (!m || !ed.map) return;
    const q = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    const [x, y, w, hh] = ed.vb, nw = Math.min(ed.map.W * 3, Math.max(ed.map.W * 0.05, w / f)), k = nw / w;
    ed.vb = [q.x - (q.x - x) * k, q.y - (q.y - y) * k, nw, hh * k];
    svg.setAttribute('viewBox', ed.vb.join(' '));
    if (redraw) drawOverlay();
  }
  function zoomBy(f) { const b = svg.getBoundingClientRect(); zoomAt(b.left + b.width / 2, b.top + b.height / 2, f); }

  // ------------------------------------------------------------------------------------------ drags (select tool)
  function beginDrag(d) {
    const hit = d.hit;
    if (!hit || hit.t === 'room' || hit.t === 'keepout') { d.kind = 'pan'; d.vb = [...ed.vb]; return; }
    ed.sel = hit; ed.hover = null;
    if (hit.t === 'item') {
      d.mode = 'item';
      d.docM = ed.needsManual(hit.uid) ? ed.toManual(d.base, d.basePlan, hit.uid) : d.base;
      d.rect0 = { ...d.docM.furniture[hit.uid].items[hit.i].rect };
      d.net = ed.room(hit.uid).net;
    } else if (hit.t === 'link') {
      const k = ed.linkK(hit), l = ed.plan.links_all[k];
      if (!l || l.kind === 'nowall') { d.kind = 'pan'; d.vb = [...ed.vb]; return; }
      d.mode = 'link'; d.k = k; d.iv = E.linkInterval(d.basePlan, k);
    } else if (hit.t === 'window') {
      const r = ed.room(hit.room), o = ed.plan.openings.find((q) => q.kind === 'window' && q.into === hit.room && windowSide(q, r) === hit.side);
      if (!o) { d.kind = 'pan'; d.vb = [...ed.vb]; return; }
      d.mode = 'window'; d.o = o; d.r = r;
      const spec = E.windowSpec(d.base, hit.room, hit.side);
      d.spec = spec && !spec.fit ? { ...spec } : { w: o.w, tag: spec ? spec.tag : o.type, sill: spec ? spec.sill : undefined, desc: spec ? spec.desc : undefined, keepout: spec ? !!spec.keepout : false };
      delete d.spec.fit;
    } else if (hit.t === 'wall') {
      const w = ed.wallOf(hit);
      if (!w) { d.kind = 'pan'; d.vb = [...ed.vb]; return; }
      d.mode = 'wall'; d.w = w;
    }
  }
  function preview(nd) { ed.doc = nd; ed.plan = analysePlan(ed.cfg, nd); renderSoon(); }
  function moveDrag(d, x, y, e) {
    if (d.kind === 'pan') { panBy(e.clientX - d.cx, e.clientY - d.cy, d.vb); return; }
    try {
      if (d.mode === 'item') {
        const n = d.net, W = rw(d.rect0), H = rh(d.rect0);
        let x0 = d.rect0.x0 + sn(x - d.x), y0 = d.rect0.y0 + sn(y - d.y);
        x0 = Math.min(n.x1 - W, Math.max(n.x0, x0)); y0 = Math.min(n.y1 - H, Math.max(n.y0, y0));
        const r = snapToWalls({ x0, y0, x1: x0 + W, y1: y0 + H }, n, 6 / ppf());
        preview(E.updateItem(d.docM, d.hit.uid, d.hit.i, { rect: r }));
        renderHint(`${fi(r.x0 - n.x0)} from the west wall, ${fi(r.y0 - n.y0)} from the south wall`);
      } else if (d.mode === 'link') {
        preview(E.placeLink(d.base, d.basePlan, d.k, { p: sn(d.iv.horiz ? x : y) }));
        const dp = ed.plan.door_plan.get(d.k);
        if (dp) renderHint(`${fi(dp[0] - dp[3] / 2 - d.iv.lo)} from the ${d.iv.horiz ? 'west' : 'south'} end · ${fi(d.iv.hi - dp[0] - dp[3] / 2)} from the ${d.iv.horiz ? 'east' : 'north'} end`);
      } else if (d.mode === 'window') {
        const n = d.r.net, hz = d.hit.side === 'S' || d.hit.side === 'N', lo = hz ? n.x0 : n.y0, hi = hz ? n.x1 : n.y1, w = d.spec.w;
        const c = Math.min(hi - w / 2, Math.max(lo + w / 2, sn(hz ? x : y)));
        preview(E.setWindow(d.base, d.hit.room, d.hit.side, { ...d.spec, c }));
        renderHint(`${fi(c - w / 2 - lo)} from the ${hz ? 'west' : 'south'} wall face · ${fi(hi - c - w / 2)} from the ${hz ? 'east' : 'north'} wall face`);
      } else if (d.mode === 'wall') {
        const at = d.w.at + sn((d.w.axis === 'x' ? x : y) - (d.w.axis === 'x' ? d.x : d.y));
        const nd = E.moveWall(d.base, ed.cfg, d.w, at);
        preview(nd);
        const names = d.w.rooms.map(([u]) => ed.room(u)).filter(Boolean);
        renderHint(names.map((r) => `${r.name} ${fi(rw(r.net))} × ${fi(rh(r.net))}`).join(' · '));
      }
    } catch (err) { if (!(err instanceof E.EditError)) throw err; }
  }
  function endDrag(d) {
    renderHint();
    if (d.kind === 'pan') return;
    if (ed.doc === d.base) { renderAll(); return; }
    const nd = ed.doc;
    ed.doc = d.base; ed.plan = d.basePlan;
    const what = d.mode === 'item' ? `Moved ${(KIND_NAMES[(ed.plan.furniture[d.hit.uid] || [])[d.hit.i]?.kind] || 'item').toLowerCase()} in ${ed.room(d.hit.uid).name}.`
      : d.mode === 'link' ? 'Moved the door / opening.' : d.mode === 'window' ? `Moved the ${SIDE_NAME[d.hit.side]} window of ${ed.room(d.hit.room).name}.` : 'Moved the wall.';
    ed.apply(() => nd, what, { sel: d.hit });
  }

  // ------------------------------------------------------------------------------------------ tool clicks
  async function toolClick(x, y) {
    const t = ed.tool;
    if (t === 'door' || t === 'open' || t === 'nowall') {
      const pr = pairAt(x, y);
      if (!pr) { toast('Click on the wall between two rooms.'); return; }
      const k = ed.plan.links_all.findIndex((l) => !l.entrance && ((l.a === pr.a && l.b === pr.b) || (l.a === pr.b && l.b === pr.a)));
      const A = ed.room(pr.a), B = ed.room(pr.b), what = { door: 'Door', open: 'Opening', nowall: 'No wall' }[t];
      if (k >= 0) {
        const l = ed.plan.links_all[k];
        if (l.kind === t && (t !== 'door' || l.into === pr.into)) { ed.select({ t: 'link', a: l.a, b: l.b }); return; }
        ed.apply((doc, plan) => E.setLinkKind(doc, plan, k, { kind: t, into: t === 'door' ? pr.into : null }), `${what} between ${A.name} and ${B.name}.`, { sel: { t: 'link', a: l.a, b: l.b } });
      } else {
        ed.apply((doc, plan) => E.addLink(doc, plan, pr.b, pr.a, t, t === 'nowall' ? pr.b : pr.into), `${what} added between ${A.name} and ${B.name}.`, { sel: { t: 'link', a: pr.b, b: pr.a } });
      }
    } else if (t === 'window') {
      const o = outerAt(x, y);
      if (!o) { toast('Click on an outer wall of a room (or a wall facing a courtyard).'); return; }
      ed.select({ t: 'window', room: o.room, side: o.side });
    } else if (t === 'split') {
      const pv = ed.preview;
      if (!pv || pv.t !== 'split') { toast('Click inside a room.'); return; }
      await splitDialog(pv.r, pv.axis, pv.at);
    } else if (t === 'furniture') {
      if (!ed.placing) { toast('Pick an item in the panel first.'); return; }
      const r = roomAt(x, y);
      if (!r) return;
      ed.addItemTo(r.uid, placeProto(ed.placing, r.net, x, y, ed.snap));
    }
  }

  async function splitDialog(r, axis, at) {
    const t = ed.cfg.t_int, n = r.net;
    let ax = axis, newSide = axis === 'x' ? 'E' : 'N', type = 'lobby';
    const lo = () => (ax === 'x' ? n.x0 : n.y0), total = () => (ax === 'x' ? rw(n) : rh(n));
    let first = Math.max(1, (ax === 'x' ? at : at) - t / 2 - lo());
    const rest = h('div', { class: 'small muted num' });
    const showRest = () => { rest.textContent = `The other part: ${fi(Math.max(0, total() - first - t))} clear.`; };
    const firstIn = ftIn({ value: first, min: 1, max: 200, onChange: (v) => { first = v; showRest(); } });
    const sideSeg = () => seg(ax === 'x' ? [['W', 'West part'], ['E', 'East part']] : [['S', 'South part'], ['N', 'North part']], newSide, (v) => { newSide = v; });
    const sideBox = h('div', {}, sideSeg());
    const label = h('span', {}, ax === 'x' ? 'Clear width of the west part' : 'Clear depth of the south part');
    const nameIn = h('input', { type: 'text', placeholder: 'e.g. Lobby, Wash area, Bath 3' });
    const typeSel = select(ROOM_TYPES.filter((q) => q !== 'court' || ed.cfg.max_courtyards > 0).map((q) => [q, q === 'suite' ? `Part of ${r.name}` : (ed.cfg.room_specs[q] || {}).label || q]), type, (v) => { type = v; });
    const body = h('div', { style: { display: 'grid', gap: '12px' } },
      h('p', { class: 'muted small', style: { margin: 0 } }, `${r.name} is ${fi(rw(n))} × ${fi(rh(n))} clear. The new wall is ${Math.round(t * 12)}" thick.`),
      field('New wall', seg([['x', 'North–south'], ['y', 'East–west']], ax, (v) => {
        ax = v; newSide = v === 'x' ? 'E' : 'N'; clear(sideBox).append(sideSeg()); label.textContent = v === 'x' ? 'Clear width of the west part' : 'Clear depth of the south part';
        first = Math.round((total() - t) / 2 * 12) / 12; firstIn.setValue(first); showRest();
      })),
      h('label', { class: 'field' }, label, firstIn, rest),
      field('Which part becomes the new space', sideBox),
      h('div', { class: 'grid2' }, field('New space is a', typeSel), field('Name (optional)', nameIn)));
    showRest();
    const ok = await modal({ title: `Split ${r.name}`, body, actions: [['Cancel', null], ['Split', true, 'primary']] });
    if (!ok) return;
    const wallAt = lo() + first + t / 2;
    const uidNew = E.nextUidOf(ed.doc);
    ed.apply((doc, plan) => {
      let d = E.splitRoom(doc, ed.cfg, r.uid, ax, wallAt, { rtype: type, name: nameIn.value.trim() || null, newSide });
      if (d.links && type === 'suite') d = { ...d, links: d.links.concat([{ a: r.uid, b: uidNew, kind: 'nowall', into: r.uid }]) };
      return d;
    }, `Split ${r.name}.`, { sel: { t: 'room', uid: uidNew } });
  }

  // ------------------------------------------------------------------------------------------ keyboard
  function nudge(dx, dy) {
    const sl = ed.sel;
    if (!sl) return;
    if (sl.t === 'item') {
      const it = ed.plan.furniture[sl.uid][sl.i], n = ed.room(sl.uid).net, r = it.rect, W = rw(r), H = rh(r);
      const x0 = Math.min(n.x1 - W, Math.max(n.x0, r.x0 + dx)), y0 = Math.min(n.y1 - H, Math.max(n.y0, r.y0 + dy));
      ed.editItem(sl.uid, sl.i, { rect: { x0, y0, x1: x0 + W, y1: y0 + H } }, 'Nudged.');
    } else if (sl.t === 'wall') {
      const w = ed.wallOf(sl); if (!w) return;
      const d = w.axis === 'x' ? dx : dy; if (!d) return;
      ed.apply((doc) => E.moveWall(doc, ed.cfg, w, w.at + d), 'Moved the wall.');
    } else if (sl.t === 'link') {
      const k = ed.linkK(sl), iv = E.linkInterval(ed.plan, k), dp = ed.plan.door_plan.get(k), d = iv.horiz ? dx : dy;
      if (!dp || !d) return;
      ed.apply((doc, plan) => E.placeLink(doc, plan, k, { p: dp[0] + d }), 'Moved the door / opening.');
    } else if (sl.t === 'window') {
      const r = ed.room(sl.room), o = ed.plan.openings.find((q) => q.kind === 'window' && q.into === sl.room && windowSide(q, r) === sl.side);
      const hz = sl.side === 'S' || sl.side === 'N', d = hz ? dx : dy;
      if (!o || !d) return;
      const spec = E.windowSpec(ed.doc, sl.room, sl.side), n = r.net, lo = hz ? n.x0 : n.y0, hi = hz ? n.x1 : n.y1;
      const base = spec && !spec.fit ? { ...spec } : { w: o.w, tag: spec ? spec.tag : o.type, sill: spec ? spec.sill : undefined, desc: spec ? spec.desc : undefined, keepout: spec ? !!spec.keepout : false };
      delete base.fit;
      const c = Math.min(hi - o.w / 2, Math.max(lo + o.w / 2, (hz ? o.x : o.y) + d));
      ed.apply((doc) => E.setWindow(doc, sl.room, sl.side, { ...base, c }), 'Moved the window.');
    }
  }
  ed.deleteSel = () => {
    const sl = ed.sel;
    if (!sl) return;
    if (sl.t === 'item') ed.apply((doc, plan) => E.removeItem(ed.needsManual(sl.uid) ? ed.toManual(doc, plan, sl.uid) : doc, sl.uid, sl.i), 'Item removed.', { sel: null });
    else if (sl.t === 'link') { const k = ed.linkK(sl); ed.apply((doc, plan) => E.removeLinkAt(doc, plan, k), 'Connection removed.', { sel: null }); }
    else if (sl.t === 'window') ed.apply((doc) => E.setWindow(doc, sl.room, sl.side, { none: true }), `No window on the ${SIDE_NAME[sl.side]} wall of ${ed.room(sl.room).name}.`);
    else if (sl.t === 'keepout') ed.apply((doc) => E.removeKeepout(doc, sl.i), 'Keep-out removed.', { sel: null });
    else if (sl.t === 'room') toast('To remove a room, merge it into a neighbour (Merge in the panel).');
  };
  ed.rotateSel = () => {
    const sl = ed.sel;
    if (!sl || sl.t !== 'item') return;
    ed.apply((doc, plan) => {
      const d = ed.needsManual(sl.uid) ? ed.toManual(doc, plan, sl.uid) : doc, nd = E.rotateItem(d, sl.uid, sl.i);
      const it = nd.furniture[sl.uid].items[sl.i], n = ed.room(sl.uid).net, W = rw(it.rect), H = rh(it.rect);
      if (W > rw(n) + 1e-9 || H > rh(n) + 1e-9) throw new E.EditError('It does not fit that way round.');
      const x0 = Math.min(n.x1 - W, Math.max(n.x0, it.rect.x0)), y0 = Math.min(n.y1 - H, Math.max(n.y0, it.rect.y0));
      it.rect = snapToWalls({ x0, y0, x1: x0 + W, y1: y0 + H }, n, 0.3);
      return nd;
    }, 'Rotated.');
  };
  function onKey(e) {
    if (!root.isConnected || root.closest('[hidden]')) return;
    if (document.querySelector('.modal, .overlay')) return;
    const tg = e.target;
    if (tg && tg.closest && tg.closest('input, textarea, select')) { if (e.key === 'Escape') tg.blur(); return; }
    const mod = e.metaKey || e.ctrlKey, k = e.key;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) ed.redoFn(); else ed.undoFn(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); ed.redoFn(); return; }
    if (mod || e.altKey) return;
    const tool = TOOLS.find((t) => t && t[2] === k.toLowerCase());
    if (tool && k.length === 1 && !(k.toLowerCase() === 'r')) { ed.setTool(tool[0]); return; }
    const step = e.shiftKey ? 1.0 : ed.snap;
    switch (k) {
      case 'Escape': if (ed.tool !== 'select') ed.setTool('select'); else ed.select(null); break;
      case 'Delete': case 'Backspace': e.preventDefault(); ed.deleteSel(); break;
      case 'r': case 'R': ed.rotateSel(); break;
      case 'ArrowLeft': e.preventDefault(); nudge(-step, 0); break;
      case 'ArrowRight': e.preventDefault(); nudge(step, 0); break;
      case 'ArrowUp': e.preventDefault(); nudge(0, step); break;
      case 'ArrowDown': e.preventDefault(); nudge(0, -step); break;
      case 'Tab': if (ed.tool === 'split') { e.preventDefault(); ed.splitAxis = !ed.splitAxis || ed.splitAxis === 'auto' ? 'x' : ed.splitAxis === 'x' ? 'y' : 'auto'; renderHint(); if (ed.cursor) updateHover(...ed.cursor); } break;
      case '+': case '=': zoomBy(1.25); break;
      case '-': case '_': zoomBy(1 / 1.25); break;
      case '0': fit(); break;
      case ' ': if (!spaceDown) { spaceDown = true; canvas.style.cursor = 'grab'; } e.preventDefault(); break;
      default:
    }
  }
  const onKeyUp = (e) => { if (e.key === ' ') { spaceDown = false; canvas.style.cursor = ''; } };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  const ro = new ResizeObserver(() => drawOverlay());
  ro.observe(canvas);
  app.cleanup = () => { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); ro.disconnect(); };

  document.title = `${ed.doc.label || 'Plan'} — ${p.name} — ArchiHelp`;
  renderTools(); renderHint(); renderView(); renderAll();
  window.__ahEditor = ed;              // e2e tests and debugging
}
