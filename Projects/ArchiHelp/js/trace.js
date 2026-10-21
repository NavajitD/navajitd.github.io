// ArchiHelp — trace an existing drawing (photo, scan or PDF) into a floor the wind simulation can use.
// Steps: load the drawing → set the scale from one known dimension → draw the rooms (wall centre to wall centre;
// neighbours snap together) → add doors, windows, plain openings and missing walls → Wind circulation.
// Geometry is kept in image pixels (so a later scale change rescales everything) and converted to feet in p.trace.doc.
import { h, clear, toast, select, seg, field, ftIn, modal, s as svgEl, confirmDlg, addKey, ADD_CLICK } from './dom.js';
import { newId } from './store.js';
import { fi } from '../engine/geom.js';
import { floorsOf } from './floors.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
export const ROOM_TYPES = [['hall', 'Hall / living'], ['bedroom', 'Bedroom'], ['master', 'Master bedroom'], ['kitchen', 'Kitchen'], ['dining', 'Dining'], ['bath', 'Bath / toilet'],
  ['stair', 'Staircase'], ['passage', 'Passage'], ['lobby', 'Lobby'], ['puja', 'Puja room'], ['study', 'Study'], ['store', 'Store'], ['veranda', 'Veranda / balcony'], ['court', 'Courtyard (open to sky)'], ['other', 'Other']];
const TYPE_NAME = Object.fromEntries(ROOM_TYPES.map(([k, l]) => [k, l.split(' / ')[0].replace(' (open to sky)', '')]));
const KIND_DEFAULTS = { door: { w: 3.0, sill: 0, head: 7.0 }, window: { w: 4.0, sill: 3.0, head: 7.0 }, open: { w: 4.0, sill: 0, head: 7.0 } };
const BLANK = { w: 1400, h: 900, ftPerPx: 0.1 };

/** Feet geometry (p.trace.doc) from the pixel geometry. */
export function traceToFeet(tr) {
  const s = tr.scale ? tr.scale.ftPerPx : BLANK.ftPerPx, H = tr.image ? tr.image.h : BLANK.h, P = tr.px || { rooms: [], openings: [] };
  if (!P.rooms.length) return { rooms: [], openings: [], columns: [], units: 'ft' };
  const X = (x) => x * s, Y = (y) => (H - y) * s;
  const minX = Math.min(...P.rooms.map((r) => X(r.x0))), minY = Math.min(...P.rooms.map((r) => Y(r.y1)));
  const q = (v) => Math.round(v * 48) / 48;
  const rooms = P.rooms.map((r) => ({ uid: r.uid, name: r.name, rtype: r.rtype, tile: { x0: q(X(r.x0) - minX), y0: q(Y(r.y1) - minY), x1: q(X(r.x1) - minX), y1: q(Y(r.y0) - minY) } }));
  const openings = P.openings.map((o) => {
    const base = { id: o.id, kind: o.kind, a: o.a, b: o.b ?? null, label: o.label || '' };
    if (o.kind === 'nowall') return base;
    const x = o.horiz ? X(o.t) - minX : X(o.line) - minX, y = o.horiz ? Y(o.line) - minY : Y(o.t) - minY;
    return { ...base, x: q(x), y: q(y), horiz: o.horiz, w: o.w, sill: o.sill, head: o.head, vent: !!o.vent };
  });
  return { rooms, openings, columns: [], units: 'ft' };
}

export function renderTrace(root, app) {
  const p = app.project;
  if (!p.trace) p.trace = { image: null, scale: null, px: { rooms: [], openings: [] }, doc: null };
  const tr = p.trace;
  tr.px = tr.px || { rooms: [], openings: [] };
  const me = floorsOf(p).find((f) => f.active);
  app.crumbs([['Trace a drawing']]);
  document.title = `Trace — ${me.name} — ${p.name} — ArchiHelp`;
  const ui = { tool: tr.image || tr.px.rooms.length ? (tr.scale ? 'room' : 'scale') : 'room', sels: [], zoom: null, undo: [], redo: [], scalePts: [] };
  // ui.sels: what is selected ({type: 'room'|'op', id}); Shift-click / Ctrl-click / ⌘-click selects several
  const isSel = (type, id) => ui.sels.some((q) => q.type === type && q.id === id);
  const W = () => (tr.image ? tr.image.w : BLANK.w), H = () => (tr.image ? tr.image.h : BLANK.h), S = () => (tr.scale ? tr.scale.ftPerPx : BLANK.ftPerPx);

  const commit = (label) => {
    tr.doc = traceToFeet(tr);
    if (tr.doc.rooms.length || tr.image) p.kind = 'trace';
    if (!p.plans.length && tr.doc.rooms.length && !floorsOf(p).some((f) => !f.active && f.kind !== 'trace' && f.doc)) {
      // a traced-only house: the envelope is the traced extent (used for neighbours and the drawings)
      p.cfg.ew_ft = Math.max(...tr.doc.rooms.map((r) => r.tile.x1)); p.cfg.ns_ft = Math.max(...tr.doc.rooms.map((r) => r.tile.y1));
    }
    app.save(); paint(); side(); if (label) status(label);
  };
  const snapshot = () => { ui.undo.push(JSON.stringify({ px: tr.px, scale: tr.scale })); if (ui.undo.length > 100) ui.undo.shift(); ui.redo = []; };
  const undo = () => { if (!ui.undo.length) return; ui.redo.push(JSON.stringify({ px: tr.px, scale: tr.scale })); const s = JSON.parse(ui.undo.pop()); tr.px = s.px; tr.scale = s.scale; ui.sels = []; commit('Undone.'); };
  const redo = () => { if (!ui.redo.length) return; ui.undo.push(JSON.stringify({ px: tr.px, scale: tr.scale })); const s = JSON.parse(ui.redo.pop()); tr.px = s.px; tr.scale = s.scale; ui.sels = []; commit('Redone.'); };

  // ------------------------------------------------------------------ layout
  const bar = h('div', { class: 'tr-bar' }), stage = h('div', { class: 'tr-stage' }), inspector = h('aside', { class: 'tr-side' }), hint = h('div', { class: 'tr-hint small', 'aria-live': 'polite' });
  root.append(h('div', { class: 'trace' }, bar, h('div', { class: 'tr-main' }, h('div', { class: 'tr-canvas' }, stage, hint), inspector)));
  const svg = svgEl('svg', { class: 'tr-svg', role: 'application', 'aria-label': 'Drawing to trace' });
  const gImg = svgEl('g'), gGrid = svgEl('g'), gRooms = svgEl('g'), gOps = svgEl('g'), gTool = svgEl('g');
  svg.append(gGrid, gImg, gRooms, gOps, gTool);
  stage.append(svg);
  const status = (t) => { hint.textContent = t; };

  function drawBar() {
    clear(bar);
    bar.append(
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn sm', onclick: loadDrawing }, tr.image ? 'Replace drawing' : 'Load drawing'),
        seg([['select', 'Select'], ['scale', 'Scale'], ['room', 'Room'], ['door', 'Door'], ['window', 'Window'], ['open', 'Opening'], ['nowall', 'No wall']], ui.tool, (v) => { ui.tool = v; ui.scalePts = []; paintTool(); toolHint(); }, { 'aria-label': 'Tool', class: 'seg tr-tools' }),
        h('button', { type: 'button', class: 'btn sm ghost', title: 'Undo (Ctrl+Z)', onclick: undo }, 'Undo'),
        h('button', { type: 'button', class: 'btn sm ghost', title: 'Fit to screen', onclick: () => { ui.zoom = null; fit(); } }, 'Fit')),
      h('div', { class: 'row' },
        h('span', { class: 'small muted' }, tr.scale ? `Scale: ${fi(tr.scale.lengthFt)} over ${Math.round(tr.scale.lengthFt / tr.scale.ftPerPx)} px` : (tr.image ? 'Scale not set' : 'No drawing: tracing on a 1 ft grid')),
        h('a', { class: 'btn sm primary', href: `#/p/${p.id}/wind`, onclick: (e) => { if (!tr.px.rooms.length) { e.preventDefault(); toast('Trace at least one room first.'); } } }, 'Wind circulation →')));
  }
  function toolHint() {
    const t = {
      select: `Click a room or an opening to edit it; ${ADD_CLICK} selects several. Delete removes them.`,
      scale: tr.image ? 'Click both ends of a dimension you know (a wall, a dimension line), then type its length.' : 'Load a drawing first, or trace on the grid (1 square = 1 ft).',
      room: 'Drag a rectangle from wall centre to wall centre. Edges snap to the rooms next to it.',
      door: 'Click on a wall to put a door there (between two rooms, or to the outside).',
      window: 'Click on an outside wall to put a window there.',
      open: 'Click on a wall for an opening with no shutter (arch, cut-out).',
      nowall: 'Click on the wall between two rooms that are really one open space.',
    }[ui.tool];
    status(t || '');
  }

  // ------------------------------------------------------------------ view (pan / zoom on the SVG viewBox)
  function fit() {
    const box = stage.getBoundingClientRect(), pad = 30;
    let x0 = 0, y0 = 0, x1 = W(), y1 = H();
    if (!tr.image && tr.px.rooms.length) { x0 = Math.min(...tr.px.rooms.map((r) => r.x0)) - 60; y0 = Math.min(...tr.px.rooms.map((r) => r.y0)) - 60; x1 = Math.max(...tr.px.rooms.map((r) => r.x1)) + 60; y1 = Math.max(...tr.px.rooms.map((r) => r.y1)) + 60; }
    const k = Math.min((box.width - 2 * pad) / (x1 - x0), (box.height - 2 * pad) / (y1 - y0));
    ui.zoom = { k, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    applyView();
  }
  function applyView() {
    const box = stage.getBoundingClientRect(), z = ui.zoom;
    const w = box.width / z.k, hh = box.height / z.k;
    svg.setAttribute('viewBox', `${z.cx - w / 2} ${z.cy - hh / 2} ${w} ${hh}`);
    paint();
  }
  const toImg = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, q.y]; };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = toImg(e), f = Math.exp(-e.deltaY * 0.0015), z = ui.zoom;
    z.k = Math.min(40, Math.max(0.05, z.k * f)); z.cx = x + (z.cx - x) / f; z.cy = y + (z.cy - y) / f;
    applyView();
  }, { passive: false });

  // ------------------------------------------------------------------ painting
  function paint() {
    if (!ui.zoom) return;
    const k = ui.zoom.k, lw = 1.5 / k, P = tr.px;
    clear(gImg); clear(gGrid);
    if (tr.image) gImg.append(svgEl('image', { href: tr.image.dataUrl, x: 0, y: 0, width: tr.image.w, height: tr.image.h, opacity: 0.85, preserveAspectRatio: 'none' }));
    else {
      const step = 1 / S(), d = [];
      for (let x = 0; x <= W(); x += step) d.push(`M${x},0V${H()}`);
      for (let y = 0; y <= H(); y += step) d.push(`M0,${y}H${W()}`);
      gGrid.append(svgEl('rect', { x: 0, y: 0, width: W(), height: H(), fill: '#fff' }), svgEl('path', { d: d.join(''), stroke: '#e5e7eb', 'stroke-width': lw * 0.6, fill: 'none' }));
    }
    clear(gRooms);
    for (const r of P.rooms) {
      const on = isSel('room', r.uid), cls = `tr-room t-${r.rtype}${on ? ' on' : ''}`;
      const g = svgEl('g', { class: cls, 'data-uid': r.uid });
      g.append(svgEl('rect', { x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0, 'stroke-width': lw * (on ? 2 : 1.2) }));
      const fs = Math.min(14 / k, (r.x1 - r.x0) / 6);
      g.append(svgEl('text', { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, 'font-size': fs, 'text-anchor': 'middle' }, r.name),
        svgEl('text', { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 + fs * 1.2, 'font-size': fs * 0.8, 'text-anchor': 'middle', class: 'dim' }, `${fi((r.x1 - r.x0) * S())} × ${fi((r.y1 - r.y0) * S())}`));
      gRooms.append(g);
    }
    clear(gOps);
    for (const o of P.openings) {
      const on = isSel('op', o.id);
      if (o.kind === 'nowall') {
        const e = sharedEdge(o.a, o.b); if (!e) continue;
        gOps.append(svgEl('line', { x1: e.horiz ? e.lo : e.line, y1: e.horiz ? e.line : e.lo, x2: e.horiz ? e.hi : e.line, y2: e.horiz ? e.line : e.hi, class: `tr-nowall${on ? ' on' : ''}`, 'stroke-width': 6 / k, 'data-id': o.id }));
        continue;
      }
      const half = o.w / S() / 2, t = 7 / k;
      const [x, y, w, hh] = o.horiz ? [o.t - half, o.line - t / 2, 2 * half, t] : [o.line - t / 2, o.t - half, t, 2 * half];
      gOps.append(svgEl('rect', { x, y, width: w, height: hh, class: `tr-op k-${o.kind}${on ? ' on' : ''}`, 'data-id': o.id }));
    }
    paintTool();
  }
  function paintTool() {
    clear(gTool);
    if (!ui.zoom) return;
    const k = ui.zoom.k;
    const pts = ui.scalePts.length ? ui.scalePts : (tr.scale && tr.image ? [tr.scale.p1, tr.scale.p2] : []);
    if (pts.length) {
      for (const [x, y] of pts) gTool.append(svgEl('circle', { cx: x, cy: y, r: 5 / k, class: 'tr-sp' }));
      if (pts.length === 2) gTool.append(svgEl('line', { x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], class: 'tr-sl', 'stroke-width': 2 }));
    }
    if (ui.band) gTool.append(svgEl('rect', { x: Math.min(ui.band[0], ui.band[2]), y: Math.min(ui.band[1], ui.band[3]), width: Math.abs(ui.band[2] - ui.band[0]), height: Math.abs(ui.band[3] - ui.band[1]), class: 'tr-band', 'stroke-width': 1.5 }));
  }

  // ------------------------------------------------------------------ geometry helpers (px)
  const edgesOf = (r) => [{ horiz: true, line: r.y0, lo: r.x0, hi: r.x1, r }, { horiz: true, line: r.y1, lo: r.x0, hi: r.x1, r }, { horiz: false, line: r.x0, lo: r.y0, hi: r.y1, r }, { horiz: false, line: r.x1, lo: r.y0, hi: r.y1, r }];
  function sharedEdge(a, b) {
    const A = tr.px.rooms.find((r) => r.uid === a), B = tr.px.rooms.find((r) => r.uid === b);
    if (!A || !B) return null;
    for (const e of edgesOf(A)) for (const f of edgesOf(B)) {
      if (e.horiz !== f.horiz || Math.abs(e.line - f.line) > 0.5) continue;
      const lo = Math.max(e.lo, f.lo), hi = Math.min(e.hi, f.hi);
      if (hi - lo > 1) return { horiz: e.horiz, line: e.line, lo, hi };
    }
    return null;
  }
  /** Nearest room edge to a point (px) within tol: { a, b (other room or null), horiz, line, t, lo, hi }. */
  function edgeAt(x, y, tol) {
    let best = null, bd = tol;
    for (const r of tr.px.rooms) for (const e of edgesOf(r)) {
      const along = e.horiz ? x : y, across = e.horiz ? y : x;
      if (along < e.lo - 1 || along > e.hi + 1) continue;
      const d = Math.abs(across - e.line);
      if (d < bd) { bd = d; best = { ...e, t: along }; }
    }
    if (!best) return null;
    const other = tr.px.rooms.find((r) => r !== best.r && edgesOf(r).some((e) => e.horiz === best.horiz && Math.abs(e.line - best.line) < 0.5 && best.t >= e.lo - 0.5 && best.t <= e.hi + 0.5));
    let lo = best.lo, hi = best.hi;
    if (other) { const e = edgesOf(other).find((q) => q.horiz === best.horiz && Math.abs(q.line - best.line) < 0.5); lo = Math.max(lo, e.lo); hi = Math.min(hi, e.hi); }
    return { a: best.r.uid, b: other ? other.uid : null, horiz: best.horiz, line: best.line, t: best.t, lo, hi };
  }
  /** Snap a coordinate to room edges within tol (px), else to whole inches. */
  function snap(v, axis, tol, skip) {
    let best = null, bd = tol;
    for (const r of tr.px.rooms) {
      if (r === skip) continue;
      for (const c of axis === 'x' ? [r.x0, r.x1] : [r.y0, r.y1]) { const d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } }
    }
    if (best !== null) return best;
    const inch = 1 / 12 / S();
    return Math.round(v / inch) * inch;
  }

  // ------------------------------------------------------------------ pointer
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || e.button === 2 || e.altKey || ui.space) { drag = { pan: true, x: e.clientX, y: e.clientY, cx: ui.zoom.cx, cy: ui.zoom.cy }; svg.setPointerCapture(e.pointerId); return; }
    const [x, y] = toImg(e), tol = 10 / ui.zoom.k;
    if (ui.tool === 'scale') {
      if (!tr.image) { toast('Load a drawing first (or trace on the grid: 1 square = 1 ft).'); return; }
      ui.scalePts.push([x, y]); paintTool();
      if (ui.scalePts.length === 2) askScale();
      return;
    }
    if (ui.tool === 'room') { const sx = snap(x, 'x', tol), sy = snap(y, 'y', tol); drag = { band: true }; ui.band = [sx, sy, sx, sy]; svg.setPointerCapture(e.pointerId); paintTool(); return; }
    if (ui.tool === 'select') {
      const opEl = e.target.closest('[data-id]'), roomEl = e.target.closest('[data-uid]');
      const hit = opEl ? { type: 'op', id: opEl.getAttribute('data-id') } : roomEl ? { type: 'room', id: roomEl.getAttribute('data-uid') } : null;
      if (addKey(e)) { if (hit) ui.sels = isSel(hit.type, hit.id) ? ui.sels.filter((q) => !(q.type === hit.type && q.id === hit.id)) : [...ui.sels, hit]; }
      else ui.sels = hit ? [hit] : [];
      paint(); side(); return;
    }
    // openings
    const ed = edgeAt(x, y, tol * 1.5);
    if (!ed) { toast('Click on a wall (a room edge).'); return; }
    if (ui.tool === 'nowall') {
      if (!ed.b) { toast('No wall works between two rooms: click on a wall they share.'); return; }
      if (tr.px.openings.some((o) => o.kind === 'nowall' && ((o.a === ed.a && o.b === ed.b) || (o.a === ed.b && o.b === ed.a)))) { toast('Already open.'); return; }
      snapshot(); tr.px.openings.push({ id: newId(), kind: 'nowall', a: ed.a, b: ed.b }); commit('Wall removed: the two rooms are one space.'); return;
    }
    if (ui.tool === 'window' && ed.b) { toast('Windows go on outside walls. Use Door or Opening between rooms.'); return; }
    const d = KIND_DEFAULTS[ui.tool], half = d.w / S() / 2;
    const t = Math.min(Math.max(ed.t, ed.lo + half), ed.hi - half);
    if (ed.hi - ed.lo < 2 * half) { toast(`That wall is shorter than ${fi(d.w)}.`); return; }
    snapshot();
    const o = { id: newId(), kind: ui.tool === 'door' && !ed.b ? 'entrance' : ui.tool, a: ed.a, b: ed.b, horiz: ed.horiz, line: ed.line, t, w: d.w, sill: d.sill, head: d.head, vent: false };
    if (o.kind === 'entrance') o.label = 'entrance';
    tr.px.openings.push(o);
    ui.sels = [{ type: 'op', id: o.id }];
    commit(`${o.kind === 'entrance' ? 'Outside door' : o.kind[0].toUpperCase() + o.kind.slice(1)} added: set its size on the right.`);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.pan) { ui.zoom.cx = drag.cx - (e.clientX - drag.x) / ui.zoom.k; ui.zoom.cy = drag.cy - (e.clientY - drag.y) / ui.zoom.k; applyView(); return; }
    if (drag.band) { const [x, y] = toImg(e), tol = 10 / ui.zoom.k; ui.band[2] = snap(x, 'x', tol); ui.band[3] = snap(y, 'y', tol); paintTool(); }
  });
  const endDrag = async () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.band) return;
    const [ax, ay, bx, by] = ui.band; ui.band = null; paintTool();
    const r = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
    if ((r.x1 - r.x0) * S() < 2.5 || (r.y1 - r.y0) * S() < 2.5) { if ((r.x1 - r.x0) + (r.y1 - r.y0) > 4) toast('Rooms need to be at least 2\'-6" each way.'); return; }
    const clash = tr.px.rooms.find((q) => Math.min(q.x1, r.x1) - Math.max(q.x0, r.x0) > 1 && Math.min(q.y1, r.y1) - Math.max(q.y0, r.y0) > 1);
    if (clash) { toast(`Overlaps ${clash.name}. Rooms must not overlap.`, 'bad'); return; }
    const type = await pickType();
    if (!type) return;
    snapshot();
    const n = tr.px.rooms.filter((q) => q.rtype === type).length + 1;
    const room = { uid: newId(), name: `${TYPE_NAME[type]}${['hall', 'kitchen', 'dining', 'stair', 'puja', 'master', 'court'].includes(type) && n === 1 ? '' : ` ${n}`}`, rtype: type, ...r };
    tr.px.rooms.push(room); ui.sels = [{ type: 'room', id: room.uid }];
    commit(`${room.name} added.`);
  };
  svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sels.length) { e.preventDefault(); removeSel(); }
    else if (e.key === ' ') { ui.space = true; }
    else if (e.key === 'Escape') { const busy = ui.scalePts.length || ui.band; ui.scalePts = []; ui.band = null; drag = null; if (!busy && ui.sels.length) { ui.sels = []; paint(); side(); } else paintTool(); }
  };
  const onKeyUp = (e) => { if (e.key === ' ') ui.space = false; };
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);
  const ro = new ResizeObserver(() => { if (ui.zoom) applyView(); });
  ro.observe(stage);
  app.cleanup = () => { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); ro.disconnect(); };

  async function pickType() {
    let type = 'bedroom';
    const body = h('div', { class: 'grid1' }, field('Room type', select(ROOM_TYPES, type, (v) => { type = v; }, { 'aria-label': 'Room type' })));
    const ok = await modal({ title: 'What is this room?', body, actions: [['Cancel', null], ['Add room', true, 'primary']] });
    return ok ? type : null;
  }
  async function askScale() {
    const [a, b] = ui.scalePts, dpx = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let len = tr.scale ? tr.scale.lengthFt : 10;
    const inp = ftIn({ value: len, min: 0.5, max: 2000, onChange: (v) => { len = v; } });
    const ok = await modal({ title: 'How long is that?', body: h('div', { class: 'grid1' }, field('Real length', inp, `${Math.round(dpx)} px on the drawing`)), actions: [['Cancel', null], ['Set scale', () => { inp.dispatchEvent(new Event('change')); return true; }, 'primary']] });
    ui.scalePts = [];
    if (!ok || !(dpx > 3)) { paintTool(); return; }
    snapshot();
    tr.scale = { ftPerPx: len / dpx, lengthFt: len, p1: a, p2: b };
    ui.tool = 'room';
    commit(`Scale set: ${fi(len)} = ${Math.round(dpx)} px. Now draw the rooms.`); drawBar();
  }

  // ------------------------------------------------------------------ inspector
  function removeSel() {
    if (!ui.sels.length) return;
    snapshot();
    const rooms = new Set(ui.sels.filter((q) => q.type === 'room').map((q) => q.id)), ops = new Set(ui.sels.filter((q) => q.type === 'op').map((q) => q.id));
    const n = rooms.size + ops.size;
    tr.px.rooms = tr.px.rooms.filter((r) => !rooms.has(r.uid));
    tr.px.openings = tr.px.openings.filter((o) => !ops.has(o.id) && !rooms.has(o.a) && !rooms.has(o.b));    // a room's doors and windows go with it
    ui.sels = []; commit(n > 1 ? `Removed ${n}.` : 'Removed.');
  }
  const OP_NAME = { door: 'Door', entrance: 'Outside door', window: 'Window', open: 'Opening', nowall: 'No wall' };
  function side() {
    clear(inspector);
    const P = tr.px, s = S(), sl = ui.sels.length === 1 ? ui.sels[0] : null;
    if (ui.sels.length > 1) { severalSide(P, s); return; }
    if (sl && sl.type === 'room') {
      const r = P.rooms.find((q) => q.uid === sl.id);
      if (r) {
        const setDim = (k, vFt) => { snapshot(); const H0 = H(); if (k === 'w') r.x1 = r.x0 + vFt / s; if (k === 'd') r.y0 = r.y1 - vFt / s; void H0; commit(); };
        inspector.append(h('h3', {}, 'Room'),
          field('Name', h('input', { type: 'text', value: r.name, onchange: (e) => { snapshot(); r.name = e.target.value.trim() || r.name; commit(); } })),
          field('Type', select(ROOM_TYPES, r.rtype, (v) => { snapshot(); r.rtype = v; commit(); })),
          h('div', { class: 'grid2' }, field('Width (E–W)', ftIn({ value: (r.x1 - r.x0) * s, min: 2.5, max: 300, onChange: (v) => setDim('w', v) })), field('Depth (N–S)', ftIn({ value: (r.y1 - r.y0) * s, min: 2.5, max: 300, onChange: (v) => setDim('d', v) }))),
          h('button', { type: 'button', class: 'btn sm danger', onclick: removeSel }, 'Delete room'));
      }
    } else if (sl && sl.type === 'op') {
      const o = P.openings.find((q) => q.id === sl.id);
      if (o) {
        const nm = (uid) => { const r = P.rooms.find((q) => q.uid === uid); return r ? r.name : 'outside'; };
        inspector.append(h('h3', {}, { door: 'Door', entrance: 'Outside door', window: 'Window', open: 'Opening', nowall: 'No wall' }[o.kind]),
          h('p', { class: 'small muted' }, o.b ? `Between ${nm(o.a)} and ${nm(o.b)}` : `${nm(o.a)} to the outside`));
        if (o.kind !== 'nowall') {
          const upd = (k, v) => { snapshot(); o[k] = v; commit(); };
          inspector.append(field('Width', ftIn({ value: o.w, min: 1, max: 30, onChange: (v) => upd('w', v) })));
          if (o.kind === 'window') inspector.append(h('div', { class: 'grid2' }, field('Sill height', ftIn({ value: o.sill, min: 0, max: 9, onChange: (v) => upd('sill', v) })), field('Head height', ftIn({ value: o.head, min: 1, max: 12, onChange: (v) => upd('head', v) }))),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!o.vent, onchange: (e) => upd('vent', e.target.checked) }), h('span', {}, 'Ventilator (always open, louvred)')));
          else inspector.append(field('Height', ftIn({ value: o.head, min: 5, max: 12, onChange: (v) => upd('head', v) })));
        }
        inspector.append(h('button', { type: 'button', class: 'btn sm danger', onclick: removeSel }, 'Delete'));
      }
    } else {
      const nWin = P.openings.filter((o) => o.kind === 'window').length, nDoor = P.openings.filter((o) => o.kind === 'door' || o.kind === 'entrance').length;
      const doc = tr.doc || traceToFeet(tr), ext = doc.rooms.length ? [Math.max(...doc.rooms.map((r) => r.tile.x1)), Math.max(...doc.rooms.map((r) => r.tile.y1))] : null;
      inspector.append(...[h('h3', {}, `${me.name}, traced`),
        h('ol', { class: 'tr-steps small' },
          h('li', { class: tr.image ? 'done' : '' }, 'Load the drawing (photo, scan or PDF) — optional: you can trace on the grid.'),
          h('li', { class: tr.scale || !tr.image ? 'done' : '' }, 'Scale: click both ends of a known length.'),
          h('li', { class: P.rooms.length ? 'done' : '' }, `Rooms: ${P.rooms.length} traced.`),
          h('li', { class: nWin + nDoor ? 'done' : '' }, `Doors ${nDoor}, windows ${nWin}, openings ${P.openings.filter((o) => o.kind === 'open' || o.kind === 'nowall').length}.`)),
        ext ? h('p', { class: 'small' }, `Traced extent ${fi(ext[0])} × ${fi(ext[1])}.`) : null,
        h('p', { class: 'small muted' }, 'Draw rooms to the middle of the walls so neighbours share an edge: that is where the walls go. Wall thicknesses come from the floor-plan setup. Hold space (or the middle button) and drag to pan; scroll to zoom.'),
        checks()].filter(Boolean));
    }
  }
  /** Several selected: what they are, sizes that apply to all of them, Delete. */
  function severalSide(P, s) {
    const rooms = ui.sels.filter((q) => q.type === 'room').map((q) => P.rooms.find((r) => r.uid === q.id)).filter(Boolean);
    const ops = ui.sels.filter((q) => q.type === 'op').map((q) => P.openings.find((o) => o.id === q.id)).filter(Boolean);
    const nm = (uid) => { const r = P.rooms.find((q) => q.uid === uid); return r ? r.name : 'outside'; };
    const count = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : null);
    inspector.append(h('h3', {}, `${ui.sels.length} selected`),
      h('p', { class: 'small muted' }, [count(rooms.length, 'room', 'rooms'), count(ops.filter((o) => o.kind === 'window').length, 'window', 'windows'),
        count(ops.filter((o) => o.kind === 'door' || o.kind === 'entrance').length, 'door', 'doors'), count(ops.filter((o) => o.kind === 'open' || o.kind === 'nowall').length, 'opening', 'openings')].filter(Boolean).join(' · ')));
    if (rooms.length > 1) inspector.append(h('p', { class: 'small num' }, `The ${rooms.length} rooms add up to ${Math.round(rooms.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0) * s * s)} sq ft (to the wall centre-lines).`));
    // doors / windows / openings only: one size for all of them
    const sized = ops.filter((o) => o.kind !== 'nowall');
    if (!rooms.length && sized.length > 1 && sized.length === ops.length) {
      const same = (k) => sized.every((o) => o[k] === sized[0][k]), lab = (t, k) => (same(k) ? t : `${t} (they differ)`);
      const updAll = (k, v) => { snapshot(); for (const o of sized) o[k] = v; commit(`${sized.length} changed.`); };
      inspector.append(h('h4', {}, 'All of them'), field(lab('Width', 'w'), ftIn({ value: sized[0].w, min: 1, max: 30, onChange: (v) => updAll('w', v) })));
      if (sized.every((o) => o.kind === 'window')) {
        inspector.append(h('div', { class: 'grid2' }, field(lab('Sill height', 'sill'), ftIn({ value: sized[0].sill, min: 0, max: 9, onChange: (v) => updAll('sill', v) })),
          field(lab('Head height', 'head'), ftIn({ value: sized[0].head, min: 1, max: 12, onChange: (v) => updAll('head', v) }))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: sized.every((o) => o.vent), onchange: (e) => updAll('vent', e.target.checked) }), h('span', {}, 'Ventilators (always open, louvred)')));
      } else if (sized.every((o) => o.kind !== 'window')) inspector.append(field(lab('Height', 'head'), ftIn({ value: sized[0].head, min: 5, max: 12, onChange: (v) => updAll('head', v) })));
    }
    inspector.append(h('div', { class: 'list', style: { marginTop: '10px' } }, ui.sels.map((q) => {
      const r = q.type === 'room' ? P.rooms.find((x) => x.uid === q.id) : null, o = q.type === 'op' ? P.openings.find((x) => x.id === q.id) : null;
      if (!r && !o) return null;
      const main = r ? r.name : OP_NAME[o.kind], sub = r ? `${fi((r.x1 - r.x0) * s)} × ${fi((r.y1 - r.y0) * s)}` : o.b ? `${nm(o.a)} ↔ ${nm(o.b)}` : `${nm(o.a)} to the outside`;
      return h('div', { class: 'li', role: 'button', tabindex: '0', style: { cursor: 'pointer' },
        onclick: (e) => { ui.sels = addKey(e) ? ui.sels.filter((x) => x !== q) : [q]; paint(); side(); } }, h('span', {}, main), h('span'), h('small', {}, sub));
    })),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { type: 'button', class: 'btn sm danger', onclick: removeSel }, `Delete all ${ui.sels.length}`),
      h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { ui.sels = []; paint(); side(); } }, 'Clear selection')),
    h('p', { class: 'small muted' }, `${ADD_CLICK} adds or takes away. Deleting a room takes its doors and windows with it.`));
  }
  function checks() {
    const P = tr.px, out = [];
    if (P.rooms.length && !P.openings.some((o) => o.kind === 'window')) out.push('No windows yet: outdoor air only gets in through leaks.');
    if (floorsOf(p).length > 1 && P.rooms.length && !P.rooms.some((r) => r.rtype === 'stair')) out.push('No staircase: this floor will not exchange air with the others.');
    const lonely = P.rooms.filter((r) => !P.openings.some((o) => o.a === r.uid || o.b === r.uid));
    if (lonely.length) out.push(`No door or opening yet: ${lonely.map((r) => r.name).join(', ')}.`);
    return out.length ? h('ul', { class: 'tr-warn small' }, out.map((t) => h('li', {}, t))) : null;
  }

  // ------------------------------------------------------------------ loading drawings
  async function loadDrawing() {
    if (tr.image && tr.px.rooms.length && !(await confirmDlg('Replace the drawing?', 'The traced rooms stay where they are on the screen; set the scale again if the new drawing is at a different size.', 'Replace'))) return;
    const file = await new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: 'image/*,application/pdf,.pdf', style: { display: 'none' } });
      inp.addEventListener('change', () => { const f = inp.files[0]; inp.remove(); resolve(f || null); });
      document.body.append(inp); inp.click();
    });
    if (file) await loadFile(file);
  }
  async function loadFile(file) {
    try {
      status('Reading the drawing…');
      const img = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? await pdfToImage(file) : await imageFile(file);
      snapshot();
      tr.image = { ...img, name: file.name };
      if (!tr.scale) ui.tool = 'scale';
      ui.zoom = null; drawBar(); fit(); commit(tr.scale ? 'Drawing replaced.' : 'Now set the scale: click both ends of a dimension you know.');
    } catch (e) { console.error(e); toast(`Could not read that file: ${e.message}`, 'bad', 6000); status(''); }
  }
  async function imageFile(file) {
    const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not an image')); i.src = url; });
    return downscale(im, im.naturalWidth, im.naturalHeight);
  }
  /** Keep stored drawings to ~2400 px on the long side (JPEG), so projects stay small. */
  function downscale(src, w, hgt) {
    const k = Math.min(1, 2400 / Math.max(w, hgt)), cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(hgt * k);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(src, 0, 0, cv.width, cv.height);
    return { dataUrl: cv.toDataURL('image/jpeg', 0.86), w: cv.width, h: cv.height };
  }
  async function pdfToImage(file) {
    status('Loading the PDF reader…');
    let lib;
    try { lib = await import(/* @vite-ignore */ PDFJS); } catch { throw new Error('the PDF reader could not be loaded (offline?). Export the page as an image and load that instead.'); }
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let pageNo = 1;
    if (doc.numPages > 1) {
      let v = 1;
      const ok = await modal({ title: `The PDF has ${doc.numPages} pages`, body: field('Page with this floor', select(Array.from({ length: doc.numPages }, (_, i) => [i + 1, `Page ${i + 1}`]), 1, (x) => { v = Number(x); })), actions: [['Cancel', null], ['Use this page', true, 'primary']] });
      if (!ok) throw new Error('cancelled');
      pageNo = v;
    }
    const page = await doc.getPage(pageNo), vp1 = page.getViewport({ scale: 1 }), scale = Math.min(4, 2400 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale }), cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, background: 'white' }).promise;
    return downscale(cv, cv.width, cv.height);
  }

  // ------------------------------------------------------------------ start
  drawBar(); side(); toolHint();
  requestAnimationFrame(() => { fit(); if (!tr.image && !tr.px.rooms.length) status('Load a drawing (photo, scan or PDF), or start tracing on the grid: 1 square = 1 ft.'); });
  app.actions([]);
  window.__ahTrace = { tr, ui, traceToFeet, loadFile };
}
