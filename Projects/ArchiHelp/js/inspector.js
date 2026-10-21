// Vaastu Planner — editor side panel: the inspector for whatever is selected, the live checks, and plan settings.
import { h, clear, toast, confirmDlg, prompt, field, ftIn, num, seg, select, checkbox, download, when } from './dom.js';
import { saveProject, newId } from './store.js';
import * as E from '../engine/edits.js';
import { fi, rw, rh } from '../engine/geom.js';
import { ROOM_TYPES } from '../engine/config.js';
import { PALETTE, KIND_NAMES, SIDED, AUTO_TYPES } from './palette.js';

const SIDE = { S: 'South', N: 'North', W: 'West', E: 'East' };
const KIND = { door: 'Door', open: 'Opening', nowall: 'No wall' };
const later = (fn) => (v) => setTimeout(() => fn(v), 0);       // let focus move before the panel re-renders
const tag = (el, k) => { el.dataset.k = k; return el; };
const typeLabel = (ed, t) => (t === 'suite' ? 'Part of a room' : (ed.cfg.room_specs[t] || {}).label || t);
const li = (main, sub, { onclick, sel = false, extra = null, k = null } = {}) => h('div', { class: `li ${sel ? 'sel' : ''}`, role: onclick ? 'button' : null, tabindex: onclick ? '0' : null, 'data-k': k,
  onclick, onkeydown: onclick ? (e) => { if (e.key === 'Enter') onclick(); } : null, style: onclick ? { cursor: 'pointer' } : null }, h('span', {}, main), extra || h('span'), sub ? h('small', {}, sub) : null);
const x = (onclick, label = 'Remove') => h('button', { class: 'btn sm ghost danger', type: 'button', 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); onclick(); } }, '×');

export function renderSide(ed, el) {
  const act = document.activeElement, focusKey = act && el.contains(act) ? act.dataset.k : null;
  const key = JSON.stringify([ed.tab, ed.sel, ed.tool === 'furniture']), old = el.querySelector('.panel'), scroll = old && el._key === key ? old.scrollTop : 0;
  el._key = key;
  clear(el);
  const soft = ed.plan.checks.filter((c) => !c.hard && !c.ok).length, hard = ed.plan.failed.length;
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['inspect', 'Inspect'], ['checks', `Checks${hard ? ` (${hard})` : ''}`], ['plan', 'Plan & sheets']].map(([id, label]) =>
    h('button', { role: 'tab', type: 'button', 'aria-selected': String(ed.tab === id), class: ed.tab === id ? 'on' : '', 'data-tab': id, onclick: () => { ed.tab = id; renderSide(ed, el); } }, label)));
  const panel = h('div', { class: 'panel', role: 'tabpanel' });
  el.append(tabs, panel);
  if (ed.tab === 'checks') checksPanel(ed, panel, soft);
  else if (ed.tab === 'plan') planPanel(ed, panel);
  else if (ed.tool === 'furniture') palettePanel(ed, panel);
  else inspect(ed, panel);
  panel.scrollTop = scroll;
  if (focusKey) { const f = panel.querySelector(`[data-k="${CSS.escape(focusKey)}"]`); if (f) f.focus(); }
}

function summary(ed) {
  const pl = ed.plan, soft = pl.checks.filter((c) => !c.hard && !c.ok).length;
  return h('div', { class: 'summary num' },
    h('div', {}, h('b', {}, pl.vaastu_score.toFixed(1)), h('span', {}, 'Vaastu score')),
    h('div', {}, h('b', { style: { color: pl.failed.length ? 'var(--bad)' : 'var(--ok)' } }, pl.failed.length || '✓'), h('span', {}, pl.failed.length ? 'hard rules missed' : 'hard rules pass')),
    h('div', {}, h('b', { style: { color: soft ? 'var(--adv)' : 'inherit' } }, soft), h('span', {}, 'advisories')));
}

function inspect(ed, panel) {
  const sl = ed.sel;
  if (!sl) return overview(ed, panel);
  if (sl.t === 'room') return roomPanel(ed, panel, sl.uid);
  if (sl.t === 'wall') return wallPanel(ed, panel, sl);
  if (sl.t === 'link') return linkPanel(ed, panel, sl);
  if (sl.t === 'window') return windowPanel(ed, panel, sl);
  if (sl.t === 'item') return itemPanel(ed, panel, sl);
  if (sl.t === 'keepout') return keepoutPanel(ed, panel, sl);
  return overview(ed, panel);
}

// ------------------------------------------------------------------------------------------------ overview
function overview(ed, panel) {
  const d = ed.doc;
  panel.append(h('h3', {}, d.label || 'Plan'), h('div', { class: 'sub' }, d.source || ''), summary(ed),
    h('p', { class: 'small muted' }, 'Select a room, wall, door, window or piece of furniture on the plan to change it. The tools on the left add doors, openings and windows, split rooms and place furniture. Every change is checked straight away.'),
    h('h4', {}, 'Rooms'),
    h('div', { class: 'list' }, ed.plan.rooms.map((r) => li(r.name, `${typeLabel(ed, r.rtype)} · ${fi(rw(r.net))} × ${fi(rh(r.net))}`, { onclick: () => ed.select({ t: 'room', uid: r.uid }), extra: h('span', { class: 'num small' }, `${Math.round(r.area)} sq ft`) }))));
}

// ------------------------------------------------------------------------------------------------ room
function roomPanel(ed, panel, uid) {
  const r = ed.room(uid), doc = ed.doc, cfg = ed.cfg, pl = ed.plan, n = r.net;
  if (!r) return overview(ed, panel);
  const movable = {};
  for (const sd of ['W', 'E', 'S', 'N']) { try { E.wallOfRoom(doc, cfg, uid, sd); movable[sd] = true; } catch { movable[sd] = false; } }
  let wSide = movable.E ? 'E' : movable.W ? 'W' : null, hSide = movable.N ? 'N' : movable.S ? 'S' : null;
  const nameIn = tag(h('input', { type: 'text', value: r.name }), 'room-name');
  nameIn.addEventListener('change', later(() => ed.apply((dd) => E.setRoom(dd, uid, { name: nameIn.value }), 'Renamed.')));
  const typeSel = tag(select(ROOM_TYPES.map((t) => [t, typeLabel(ed, t)]), r.rtype, later((v) => ed.apply((dd) => E.setRoom(dd, uid, { rtype: v }), `${r.name} is now a ${typeLabel(ed, v).toLowerCase()}.`))), 'room-type');
  const sideSeg = (opts, cur, set) => seg(opts.map((sd) => [sd, `${SIDE[sd]} wall`, movable[sd] ? '' : 'Outer wall or uneven neighbours: cannot move']), cur, set);
  const wIn = tag(ftIn({ value: rw(n), min: 1, max: 200, onChange: later((v) => wSide ? ed.apply((dd) => E.setClearSize(dd, cfg, uid, 'w', v, wSide), `${r.name} is now ${fi(v)} wide.`) : toast('Neither east nor west wall of this room can move.', 'bad')) }), 'room-w');
  const hIn = tag(ftIn({ value: rh(n), min: 1, max: 200, onChange: later((v) => hSide ? ed.apply((dd) => E.setClearSize(dd, cfg, uid, 'h', v, hSide), `${r.name} is now ${fi(v)} deep.`) : toast('Neither north nor south wall of this room can move.', 'bad')) }), 'room-h');
  const aIn = tag(num({ value: Math.round(r.area * 10) / 10, min: 5, max: 2000, step: 0.5, onChange: later((v) => {
    const sd = wSide || hSide;
    if (!sd) { toast('No wall of this room can move.', 'bad'); return; }
    ed.apply((dd) => E.setArea(dd, cfg, uid, v, sd), `${r.name} set to ${v} sq ft (moving the ${SIDE[sd].toLowerCase()} wall).`);
  }) }), 'room-area');
  const row = pl.sector_rows.find((q) => q.uid === uid), rule = cfg.sector_rules[r.rtype];
  panel.append(h('h3', {}, r.name), h('div', { class: 'sub num' }, `${typeLabel(ed, r.rtype)} · ${fi(rw(n))} × ${fi(rh(n))} clear · ${Math.round(r.area)} sq ft`),
    h('div', { class: 'grid2' }, field('Name', nameIn), field('Type', typeSel)),
    h('h4', {}, 'Size (clear, wall face to wall face)'),
    h('div', { class: 'inl' }, field('East–west', wIn), field('North–south', hIn)),
    h('div', { style: { display: 'grid', gap: '6px', marginTop: '8px' } },
      h('div', { class: 'row small' }, h('span', { class: 'muted' }, 'Width moves the'), movable.W || movable.E ? sideSeg(['W', 'E'].filter((sd) => movable[sd]), wSide, (v) => { wSide = v; }) : h('span', {}, 'nothing (outer walls)')),
      h('div', { class: 'row small' }, h('span', { class: 'muted' }, 'Depth moves the'), movable.S || movable.N ? sideSeg(['S', 'N'].filter((sd) => movable[sd]), hSide, (v) => { hSide = v; }) : h('span', {}, 'nothing (outer walls)'))),
    h('div', { class: 'inl', style: { marginTop: '8px' } }, field('Floor area (sq ft)', aIn, 'moves the width wall'), h('div')),
    h('h4', {}, 'Vaastu'),
    h('div', { class: 'small' }, row && row.padas ? `Padas: ${row.padas}` : 'No pada share computed.'),
    rule ? h('div', { class: 'row small', style: { marginTop: '6px' } }, h('span', { class: `badge ${row && row.ok ? 'ok' : 'bad'}` }, row && row.ok ? 'in its padas' : 'outside its padas'),
      h('span', { class: 'muted' }, `${rule.hard ? 'Hard' : 'Soft'} rule: ${rule.tiers.join(' › ')}${row ? ` · ${Math.round(row.frac * 100)}% inside` : ''}`))
      : h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'No pada rule for this room type.'));

  // layout changes
  const others = ed.plan.rooms.filter((q) => q.uid !== uid);
  const mergeable = others.filter((q) => E.canMerge(doc, uid, q.uid));
  const mergeSel = select([['', 'Merge with…'], ...mergeable.map((q) => [String(q.uid), q.name])], '', later((v) => { if (v !== '') ed.apply((dd) => E.mergeRooms(dd, cfg, uid, Number(v)), `Merged into ${r.name}.`, { sel: { t: 'room', uid } }); }), { disabled: !mergeable.length, 'aria-label': 'Merge with', title: mergeable.length ? '' : 'No neighbour forms a rectangle with this room' });
  const swapSel = select([['', 'Swap with…'], ...others.map((q) => [String(q.uid), q.name])], '', later((v) => { if (v !== '') ed.apply((dd) => E.swapRooms(dd, uid, Number(v)), `Swapped ${r.name} and ${ed.room(Number(v)).name}.`); }), { 'aria-label': 'Swap with' });
  panel.append(h('h4', {}, 'Layout'),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => ed.splitDialog(r, rw(n) >= rh(n) ? 'x' : 'y', rw(n) >= rh(n) ? (r.tile.x0 + r.tile.x1) / 2 : (r.tile.y0 + r.tile.y1) / 2) }, 'Split…'),
      h('div', { style: { flex: '1', minWidth: '120px' } }, mergeSel), h('div', { style: { flex: '1', minWidth: '120px' } }, swapSel)),
    h('p', { class: 'small muted', style: { margin: '6px 0 0' } }, 'Swap exchanges the use of two rooms (type, name, furniture choices); walls stay put.'));

  // doors & openings
  const links = pl.links_all.map((l, k) => [l, k]).filter(([l]) => l.a === uid || l.b === uid);
  const nb = E.neighbours(doc, uid, 2.5).filter((q) => !links.some(([l]) => l.a === q.uid || l.b === q.uid));
  let addKind = 'door';
  const addSel = select([['', 'Connect to…'], ...nb.map((q) => [String(q.uid), q.name])], '', later((v) => {
    if (v === '') return;
    ed.apply((dd, plan) => E.addLink(dd, plan, Number(v), uid, addKind, addKind === 'nowall' ? Number(v) : uid), `${KIND[addKind]} added.`, { sel: { t: 'link', a: Number(v), b: uid } });
  }), { disabled: !nb.length, 'aria-label': 'Connect to' });
  panel.append(h('h4', {}, 'Doors & openings'),
    h('div', { class: 'list' }, links.length ? links.map(([l, k]) => {
      const other = l.entrance ? null : ed.room(l.a === uid ? l.b : l.a), o = pl.openings.find((q) => q.link === k);
      const main = l.entrance ? 'Entrance door (road)' : `${KIND[l.kind]} to ${other.name}`;
      const sub = l.kind === 'door' ? `${o ? `${o.type} · ${fi(o.w)}` : ''}${l.into === uid ? ' · swings in here' : ` · swings into ${ed.room(l.into).name}`}` : o ? `${fi(o.w)} wide` : '';
      return li(main, sub, { onclick: () => ed.select(l.entrance ? { t: 'link', entrance: true } : { t: 'link', a: l.a, b: l.b }) });
    }) : h('div', { class: 'small muted' }, 'No connections — this room cannot be reached.')),
    h('div', { class: 'row', style: { marginTop: '8px' } }, seg([['door', 'Door'], ['open', 'Opening'], ['nowall', 'No wall']], addKind, (v) => { addKind = v; }), h('div', { style: { flex: 1, minWidth: '120px' } }, addSel)));

  // windows
  const R = { x0: cfg.t_ext / 2, y0: cfg.t_ext / 2, x1: cfg.ew_ft - cfg.t_ext / 2, y1: cfg.ns_ft - cfg.t_ext / 2 }, t = r.tile;
  const ext = ['S', 'N', 'W', 'E'].filter((sd) => ({ S: Math.abs(t.y0 - R.y0) < 1e-6, N: Math.abs(t.y1 - R.y1) < 1e-6, W: Math.abs(t.x0 - R.x0) < 1e-6, E: Math.abs(t.x1 - R.x1) < 1e-6 })[sd]
    || ed.plan.rooms.some((c) => c.rtype === 'court' && c.uid !== uid && sharesSide(t, c.tile, sd)));
  panel.append(h('h4', {}, 'Windows'), r.rtype === 'passage' || r.rtype === 'suite' || r.rtype === 'court' ? h('div', { class: 'small muted' }, 'This space takes no windows.')
    : ext.length ? h('div', { class: 'list' }, ext.map((sd) => {
      const spec = E.windowSpec(doc, uid, sd), ws = pl.openings.filter((o) => o.kind === 'window' && o.into === uid && ed.windowSide(o, r) === sd);
      const mode = !spec ? 'automatic' : spec.none || spec.w === 0 ? 'none' : spec.fit === 'max' ? 'widest between piers' : 'exact';
      return li(`${SIDE[sd]} wall`, ws.length ? ws.map((o) => `${o.type} ${fi(o.w)}`).join(', ') : 'no window', { onclick: () => ed.select({ t: 'window', room: uid, side: sd }), extra: h('span', { class: 'small muted' }, mode) });
    })) : h('div', { class: 'small muted' }, 'No outer walls — an interior room.'));

  // furniture
  const fs = (doc.furniture || {})[uid] || {}, items = pl.furniture[uid] || [], auto = AUTO_TYPES.has(r.rtype);
  panel.append(h('h4', {}, 'Furniture'));
  if (auto) {
    panel.append(h('div', { class: 'row' }, seg([['auto', 'Planner arranges'], ['manual', 'By hand']], fs.mode === 'manual' ? 'manual' : 'auto', async (v) => {
      if (v === 'manual') ed.apply((dd, plan) => ed.toManual(dd, plan, uid), `${r.name}: hand layout (the planner's arrangement, now yours to move).`);
      else if (await confirmDlg('Let the planner arrange this room?', 'Your hand layout of this room is replaced by the planner\'s arrangement.', 'Use the planner')) ed.apply((dd) => E.setFurniture(dd, uid, { mode: null, items: null }), `${r.name}: arranged by the planner.`);
      else ed.renderAll();
    })));
    if (fs.mode !== 'manual') {
      const pref = (label, key, opts) => field(label, seg([['', 'Auto'], ...opts.map((sd) => [sd, sd])], fs[key] || '', (v) => ed.apply((dd) => E.setFurniture(dd, uid, { [key]: v || null }), `${label}: ${v ? SIDE[v].toLowerCase() : 'automatic'}.`)));
      const prefs = [];
      if (r.rtype === 'master' || r.rtype === 'bedroom') prefs.push(pref('Bed head against', 'bedHead', ['S', 'E', 'W', 'N']), pref('Wardrobe on', 'wardrobeSide', ['S', 'N', 'W', 'E']));
      if (r.rtype === 'hall') prefs.push(pref('Sofa against', 'sofaSide', ['S', 'N', 'W', 'E']));
      if (prefs.length) panel.append(h('div', { style: { display: 'grid', gap: '8px', marginTop: '10px' } }, prefs));
      if ((fs.items || []).length) panel.append(h('p', { class: 'small muted' }, `${fs.items.length} fixed item${fs.items.length === 1 ? '' : 's'} added by hand; the planner arranges around ${fs.items.length === 1 ? 'it' : 'them'}.`));
    }
  }
  panel.append(h('div', { class: 'list', style: { marginTop: '10px' } }, items.length ? items.map((it, i) => li(KIND_NAMES[it.kind] || it.kind, `${fi(rw(it.rect))} × ${fi(rh(it.rect))}${it.label && it.label !== (KIND_NAMES[it.kind] || '').toUpperCase() ? ` · "${it.label}"` : ''}`,
    { onclick: () => ed.select({ t: 'item', uid, i }), extra: x(() => { ed.select({ t: 'item', uid, i }, { tab: false }); ed.deleteSel(); }) })) : h('div', { class: 'small muted' }, auto ? 'Nothing placed — the room may be too tight for the required furniture.' : 'No furniture.')),
  h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => ed.setTool('furniture') }, '+ Add furniture'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => ed.setTool('keepout') }, '+ Keep-out zone')));
  const kos = (doc.keepouts || []).map((k, i) => [k, i]).filter(([k]) => k.room === uid);
  if (kos.length) panel.append(h('div', { class: 'list', style: { marginTop: '8px' } }, kos.map(([k, i]) => li('Keep-out zone', `${fi(rw(k.rect))} × ${fi(rh(k.rect))}`, { onclick: () => ed.select({ t: 'keepout', i }), extra: x(() => ed.apply((dd) => E.removeKeepout(dd, i), 'Keep-out removed.', { sel: { t: 'room', uid } })) }))));
}
function sharesSide(t, c, sd) {
  const e = 1e-6;
  if (sd === 'S') return Math.abs(t.y0 - c.y1) < e && Math.min(t.x1, c.x1) - Math.max(t.x0, c.x0) >= 2.5;
  if (sd === 'N') return Math.abs(t.y1 - c.y0) < e && Math.min(t.x1, c.x1) - Math.max(t.x0, c.x0) >= 2.5;
  if (sd === 'W') return Math.abs(t.x0 - c.x1) < e && Math.min(t.y1, c.y1) - Math.max(t.y0, c.y0) >= 2.5;
  return Math.abs(t.x1 - c.x0) < e && Math.min(t.y1, c.y1) - Math.max(t.y0, c.y0) >= 2.5;
}

// ------------------------------------------------------------------------------------------------ wall
function wallPanel(ed, panel, sl) {
  const w = ed.wallOf(sl), cfg = ed.cfg;
  if (!w) return overview(ed, panel);
  const ns = w.axis === 'x', lowEdge = ns ? 'x1' : 'y1';
  const lowRooms = w.rooms.filter(([, e]) => e === lowEdge).map(([u]) => ed.room(u)), highRooms = w.rooms.filter(([, e]) => e !== lowEdge).map(([u]) => ed.room(u));
  const posIn = tag(ftIn({ value: w.at, min: 0, max: ns ? cfg.ew_ft : cfg.ns_ft, onChange: later((v) => ed.apply((dd) => E.moveWall(dd, cfg, w, v), `Wall moved to ${fi(v)}.`)) }), 'wall-at');
  const sizeRow = (r, side) => {
    const dim = ns ? 'w' : 'h', cur = ns ? rw(r.net) : rh(r.net);
    return h('div', { class: 'inl', style: { alignItems: 'end' } }, h('div', { class: 'small' }, h('b', {}, r.name), h('div', { class: 'muted' }, `${SIDE[side === 'E' || side === 'N' ? (ns ? 'W' : 'S') : ns ? 'E' : 'N']} of the wall`)),
      tag(ftIn({ value: cur, min: 1, max: 200, onChange: later((v) => ed.apply((dd) => E.setClearSize(dd, cfg, r.uid, dim, v, side), `${r.name} is now ${fi(v)} ${ns ? 'wide' : 'deep'}.`)) }), `wall-room-${r.uid}`));
  };
  const step = (d, label) => h('button', { class: 'btn sm', type: 'button', onclick: () => ed.apply((dd) => E.moveWall(dd, cfg, w, w.at + d), 'Wall moved.') }, label);
  panel.append(h('h3', {}, ns ? 'North–south wall' : 'East–west wall'),
    h('div', { class: 'sub' }, `${Math.round(cfg.t_int * 12)}" internal wall, ${fi(w.hi - w.lo)} long`),
    field(`Centre-line from the ${ns ? 'west' : 'south'} outer face`, posIn),
    h('div', { class: 'row', style: { marginTop: '8px' } }, step(-ed.snap * 3, ns ? '← 3 steps' : '↓ 3 steps'), step(-ed.snap, ns ? '←' : '↓'), step(ed.snap, ns ? '→' : '↑'), step(ed.snap * 3, ns ? '3 steps →' : '3 steps ↑')),
    h('h4', {}, `Rooms on each side (clear ${ns ? 'width' : 'depth'})`),
    h('div', { style: { display: 'grid', gap: '10px' } }, lowRooms.map((r) => sizeRow(r, ns ? 'E' : 'N')), highRooms.map((r) => sizeRow(r, ns ? 'W' : 'S'))),
    h('p', { class: 'small muted' }, 'Drag the wall on the plan, or use the arrow keys (Shift = 1 ft). Rooms meet on wall centre-lines; furniture standing against the wall moves with it.'));
}

// ------------------------------------------------------------------------------------------------ door / opening
function linkPanel(ed, panel, sl) {
  const k = ed.linkK(sl), pl = ed.plan, l = pl.links_all[k], cfg = ed.cfg;
  if (!l) return overview(ed, panel);
  const A = l.a !== null && l.a !== undefined ? ed.room(l.a) : null, B = ed.room(l.b), dp = pl.door_plan.get(k), o = pl.openings.find((q) => q.link === k);
  const iv = E.linkInterval(pl, k), hz = iv.horiz;
  const pinned = l.entrance ? !!(ed.doc.meta && ed.doc.meta.entranceHint) : !!(l.hint && l.hint.at !== undefined);
  panel.append(h('h3', {}, l.entrance ? 'Entrance door' : KIND[l.kind]), h('div', { class: 'sub' }, l.entrance ? `${B.name}, on the road (${SIDE[cfg.road_side].toLowerCase()}) wall` : `${A.name} ↔ ${B.name}${o ? ` · ${o.type}` : ''}`));
  if (!l.entrance) panel.append(field('Kind', seg([['door', 'Door'], ['open', 'Opening'], ['nowall', 'No wall']], l.kind, (v) => ed.apply((dd, plan) => E.setLinkKind(dd, plan, k, { kind: v }), `${KIND[v]} between ${A.name} and ${B.name}.`))));
  if (l.kind === 'door' && !l.entrance) panel.append(h('div', { style: { marginTop: '10px' } }, field('Swings into', seg([[String(l.a), A.name], [String(l.b), B.name]], String(l.into), (v) => ed.apply((dd, plan) => E.setLinkKind(dd, plan, k, { into: Number(v) }), `Door swings into ${ed.room(Number(v)).name}.`)))));
  if (l.kind !== 'nowall' && dp) {
    const w = dp[3], fromLo = dp[0] - w / 2 - iv.lo;
    const widths = [2.5, 2.75, 3.0, 3.25, 3.5, 4.0, 4.5, 5.0, 6.0].filter((v) => v <= iv.hi - iv.lo + 1e-9);
    if (!widths.some((v) => Math.abs(v - w) < 1e-9)) widths.push(w);
    widths.sort((a, b) => a - b);
    const isDoor = l.kind === 'door' || l.entrance;
    panel.append(h('h4', {}, 'Size & position'),
      h('div', { class: 'inl' },
        field('Width', tag(select(widths.map((v) => [String(v), fi(v)]), String(w), later((v) => ed.apply((dd, plan) => E.placeLink(dd, plan, k, { w: Number(v) }), `Width ${fi(Number(v))}.`))), 'link-w')),
        field(`From the ${hz ? 'west' : 'south'} end`, tag(ftIn({ value: fromLo, min: 0, max: iv.hi - iv.lo, onChange: later((v) => ed.apply((dd, plan) => E.placeLink(dd, plan, k, { p: iv.lo + v + w / 2 }), 'Moved.')) }), 'link-at'))),
      h('div', { class: 'small muted num', style: { marginTop: '4px' } }, `${fi(iv.hi - iv.lo)} of clear wall here; ${fi(Math.max(0, iv.hi - dp[0] - w / 2))} left at the ${hz ? 'east' : 'north'} end.`));
    if (isDoor) panel.append(h('div', { style: { marginTop: '10px' } }, field('Hinged at the', seg([['lo', hz ? 'West end' : 'South end'], ['hi', hz ? 'East end' : 'North end']], dp[1], (v) => ed.apply((dd, plan) => E.placeLink(dd, plan, k, { hinge: v }), 'Hinge side changed.')))));
    panel.append(h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: `badge ${pinned ? 'plain' : 'adv'}` }, pinned ? 'Fixed where you put it' : 'Placed by the planner'),
      pinned ? h('button', { class: 'btn sm', type: 'button', onclick: () => ed.apply((dd, plan) => E.unpinLink(dd, plan, k), 'The planner places it again.') }, 'Let the planner place it')
        : h('button', { class: 'btn sm', type: 'button', onclick: () => ed.apply((dd, plan) => E.placeLink(dd, plan, k, { clamp: false }), 'Fixed here.') }, 'Fix it here')));
  } else if (l.kind === 'nowall') {
    panel.append(h('p', { class: 'small muted' }, 'The two spaces read as one room; the line between them stays on the drawing, dashed.'));
    const wc = E.wallComponents(ed.doc, cfg).find((c) => c.closed && c.rooms.some(([u]) => u === l.a) && c.rooms.some(([u]) => u === l.b));
    if (wc) panel.append(h('button', { class: 'btn sm', type: 'button', onclick: () => ed.select({ t: 'wall', ref: wc.rooms[0] }) }, 'Move this line'));
  }
  panel.append(h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn sm danger', type: 'button', onclick: () => ed.apply((dd, plan) => E.removeLinkAt(dd, plan, k), l.entrance ? 'No entrance door on the road wall.' : 'Connection removed.', { sel: null }) }, l.entrance ? 'No entrance on the road' : 'Remove')));
}

// ------------------------------------------------------------------------------------------------ window
function windowPanel(ed, panel, sl) {
  const r = ed.room(sl.room), side = sl.side, pl = ed.plan;
  if (!r) return overview(ed, panel);
  const spec = E.windowSpec(ed.doc, r.uid, side), ws = pl.openings.filter((o) => o.kind === 'window' && o.into === r.uid && ed.windowSide(o, r) === side);
  const mode = !spec ? 'auto' : spec.none || spec.w === 0 ? 'none' : spec.fit === 'max' ? 'max' : 'exact';
  const types = (pl.windowsResolved || {}).winTypes || {}, hz = side === 'S' || side === 'N', n = r.net, lo = hz ? n.x0 : n.y0, hi = hz ? n.x1 : n.y1;
  const set = (s2, msg) => ed.apply((dd) => E.setWindow(dd, r.uid, side, s2), msg || 'Window updated.');
  const cur = ws[0];
  panel.append(h('h3', {}, `${SIDE[side]} wall window`), h('div', { class: 'sub' }, `${r.name}${ws.length ? ` · ${ws.map((o) => `${o.type} ${fi(o.w)} wide`).join(', ')}` : ' · no window'}`),
    field('Window', seg([['auto', 'Automatic'], ['max', 'Widest'], ['exact', 'Exact'], ['none', 'None']], mode, (v) => {
      if (v === 'auto') set(null, 'Window chosen by the planner.');
      else if (v === 'none') set({ none: true }, 'No window on this wall.');
      else if (v === 'max') set({ fit: 'max', sill: spec && spec.sill !== undefined ? spec.sill : 3.0, desc: (spec && spec.desc) || 'Window', keepout: true }, 'Widest window between the piers.');
      else set({ w: cur ? cur.w : Math.min(4.0, Math.floor((hi - lo - 3.0) * 4) / 4), c: null, sill: spec && spec.sill !== undefined ? spec.sill : 3.0, desc: (spec && spec.desc) || 'Window', keepout: !!(spec && spec.keepout) }, 'Window size set.');
    })));
  if (mode === 'auto') panel.append(h('p', { class: 'small muted' }, 'The planner picks a standard window for the room type, clear of doors, columns and tall furniture. Choose Widest or Exact to specify it yourself.'));
  if (mode === 'max' || mode === 'exact') {
    const s0 = { ...spec };
    const upd = (patch, msg) => set({ ...s0, ...patch }, msg);
    const full = s0.sill === null;
    const sillIn = tag(ftIn({ value: full ? 3.0 : (s0.sill ?? 3.0), min: 0, max: 7, onChange: later((v) => upd({ sill: v }, `Sill ${fi(v)}.`)) }), 'win-sill');
    if (full) sillIn.disabled = true;
    const desc = tag(h('input', { type: 'text', value: s0.desc || 'Window' }), 'win-desc');
    desc.addEventListener('change', later(() => upd({ desc: desc.value.trim() || 'Window' })));
    const tg = tag(h('input', { type: 'text', value: s0.tag || '', placeholder: 'auto (W1, W2…)' }), 'win-tag');
    tg.addEventListener('change', later(() => upd({ tag: tg.value.trim().toUpperCase() || undefined })));
    panel.append(h('h4', {}, 'Details'));
    if (mode === 'exact') {
      const w = s0.w || (cur ? cur.w : 3.0);
      const posIn = tag(ftIn({ value: s0.c !== null && s0.c !== undefined ? s0.c - w / 2 - lo : (cur ? (hz ? cur.x : cur.y) - w / 2 - lo : 0), min: 0, max: hi - lo, onChange: later((v) => upd({ c: lo + v + w / 2 }, 'Window moved.')) }), 'win-at');
      if (s0.c === null || s0.c === undefined) posIn.disabled = true;
      panel.append(h('div', { class: 'inl' }, field('Width', tag(ftIn({ value: w, min: 1, max: hi - lo, onChange: later((v) => upd({ w: v, c: s0.c !== null && s0.c !== undefined ? Math.min(hi - v / 2, Math.max(lo + v / 2, s0.c)) : null }, `Width ${fi(v)}.`)) }), 'win-w')),
        field(`From the ${hz ? 'west' : 'south'} wall face`, posIn)),
      h('div', { style: { margin: '6px 0 4px' } }, checkbox('Place it automatically (clear of doors and columns)', s0.c === null || s0.c === undefined, (v) => upd({ c: v ? null : (cur ? (hz ? cur.x : cur.y) : (lo + hi) / 2) }))));
    } else {
      panel.append(field('Solid pier at each end', tag(ftIn({ value: s0.pier ?? 1.5, min: 0, max: 6, onChange: later((v) => upd({ pier: v }, `Piers ${fi(v)}.`)) }), 'win-pier'), 'IS 4326 (Zone V): 450 mm of solid wall from column faces'));
    }
    panel.append(h('div', { class: 'inl', style: { marginTop: '8px' } }, field('Sill height', sillIn), field('Type tag', tg)),
      h('div', { style: { marginTop: '6px' } }, checkbox('Full-height glazing (no sill)', full, (v) => upd({ sill: v ? null : 3.0 }))),
      h('div', { style: { marginTop: '8px' } }, field('Description (schedule)', desc)),
      h('div', { style: { marginTop: '8px' } }, checkbox('Keep tall furniture 2 ft clear of it', !!s0.keepout, (v) => upd({ keepout: v }))));
  }
  if (ws.length) panel.append(h('h4', {}, 'Schedule'), h('div', { class: 'list' }, [...new Set(ws.map((o) => o.type))].map((t) => li(t, (types[t] || []).slice(1).join(' · '), { extra: h('span', { class: 'small' }, (types[t] || [])[0] || '') }))));
}

// ------------------------------------------------------------------------------------------------ furniture item
function itemPanel(ed, panel, sl) {
  const items = ed.plan.furniture[sl.uid] || [], it = items[sl.i], r = ed.room(sl.uid);
  if (!it || !r) return overview(ed, panel);
  const n = r.net, rc = it.rect, W = rw(rc), H = rh(rc), name = KIND_NAMES[it.kind] || it.kind;
  const edit = (patch, msg) => ed.editItem(sl.uid, sl.i, patch, msg || `${name} updated.`);
  const place = (x0, y0, w, hh) => {
    w = Math.min(w, rw(n)); hh = Math.min(hh, rh(n));
    x0 = Math.min(n.x1 - w, Math.max(n.x0, x0)); y0 = Math.min(n.y1 - hh, Math.max(n.y0, y0));
    return { x0, y0, x1: x0 + w, y1: y0 + hh };
  };
  panel.append(h('h3', {}, name), h('div', { class: 'sub num' }, `${r.name} · ${fi(W)} × ${fi(H)}${it.tall ? ' · tall' : ''}`));
  if (ed.needsManual(sl.uid)) panel.append(h('p', { class: 'note small' }, 'Placed by the planner. Changing it switches this room to a hand layout — everything stays where it is, including the doors.'));
  const lab = tag(h('input', { type: 'text', value: it.label || '', placeholder: 'drawn text (optional)' }), 'item-label');
  lab.addEventListener('change', later(() => edit({ label: lab.value }, 'Label changed.')));
  panel.append(h('div', { class: 'inl' },
    field('East–west', tag(ftIn({ value: W, min: 0.5, max: rw(n), onChange: later((v) => edit({ rect: place(rc.x0, rc.y0, v, H) }, `${name} ${fi(v)} × ${fi(H)}.`)) }), 'item-w')),
    field('North–south', tag(ftIn({ value: H, min: 0.5, max: rh(n), onChange: later((v) => edit({ rect: place(rc.x0, rc.y0, W, v) }, `${name} ${fi(W)} × ${fi(v)}.`)) }), 'item-h'))),
  h('div', { class: 'inl', style: { marginTop: '8px' } },
    field('From the west wall', tag(ftIn({ value: rc.x0 - n.x0, min: 0, max: rw(n), onChange: later((v) => edit({ rect: place(n.x0 + v, rc.y0, W, H) }, 'Moved.')) }), 'item-x')),
    field('From the south wall', tag(ftIn({ value: rc.y0 - n.y0, min: 0, max: rh(n), onChange: later((v) => edit({ rect: place(rc.x0, n.y0 + v, W, H) }, 'Moved.')) }), 'item-y'))),
  h('div', { style: { marginTop: '8px' } }, field('Text on the drawing', lab)));
  if (SIDED.has(it.kind)) {
    const label = it.kind === 'bed' ? 'Head against the' : it.kind === 'wc' ? 'Cistern on the' : 'Backs onto the';
    panel.append(h('div', { style: { marginTop: '10px' } }, field(label, seg(['S', 'N', 'W', 'E'].map((sd) => [sd, `${SIDE[sd]}`]), it.kind === 'bed' ? ((it.meta && it.meta.head) || it.side || 'S') : it.side || '', (v) => edit({ side: v, meta: it.kind === 'bed' ? { head: v } : {} }, `${name}: ${SIDE[v].toLowerCase()}.`)))));
  }
  if (it.kind === 'counter') {
    const m = it.meta || {}, endName = rw(rc) >= rh(rc) ? 'west' : 'south';
    const pos = (on, end) => (!on ? 'none' : end === 'lo' ? 'end' : 'mid');
    panel.append(h('div', { style: { display: 'grid', gap: '8px', marginTop: '10px' } },
      field('Hob', seg([['none', 'None'], ['end', `${endName} end`], ['mid', 'Middle']], pos(m.hob, m.hob_end), (v) => edit({ meta: { hob: v !== 'none', hob_end: v === 'end' ? 'lo' : undefined } }, 'Hob moved.'))),
      field('Sink', seg([['none', 'None'], ['end', `${endName} end`], ['mid', 'Middle']], pos(m.sink, m.sink_end), (v) => edit({ meta: { sink: v !== 'none', sink_end: v === 'end' ? 'lo' : undefined } }, 'Sink moved.')))));
  }
  if (it.kind === 'dining_table') panel.append(h('div', { style: { marginTop: '10px' } }, field('Seats', seg([2, 4, 6, 8].map((v) => [String(v), String(v)]), String((it.meta && it.meta.seats) || 4), (v) => edit({ meta: { seats: Number(v) } }, `${v} seats.`)))));
  panel.append(h('div', { style: { marginTop: '10px' } }, checkbox('Tall (windows keep clear of it)', !!it.tall, (v) => edit({ tall: v }, v ? 'Marked tall.' : 'Marked low.'))),
    h('div', { class: 'row', style: { marginTop: '14px' } },
      h('button', { class: 'btn sm', type: 'button', onclick: ed.rotateSel, title: 'R' }, 'Rotate 90°'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => ed.addItemTo(sl.uid, { ...it, rect: place(rc.x0 + 1, rc.y0 + 1, W, H), meta: { ...(it.meta || {}) } }) }, 'Duplicate'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: ed.deleteSel, title: 'Delete' }, 'Delete')),
    h('p', { class: 'small muted' }, 'Drag it on the plan; it snaps flush to walls. Arrow keys nudge by the snap step (Shift = 1 ft).'));
}

function keepoutPanel(ed, panel, sl) {
  const k = (ed.doc.keepouts || [])[sl.i];
  if (!k) return overview(ed, panel);
  const r = ed.room(k.room), n = r.net, rc = k.rect, W = rw(rc), H = rh(rc);
  const set = (x0, y0, w, hh) => ed.apply((dd) => E.setKeepout(dd, sl.i, { x0, y0, x1: x0 + w, y1: y0 + hh }), 'Keep-out changed.');
  panel.append(h('h3', {}, 'Keep-out zone'), h('div', { class: 'sub' }, `${r.name} · ${fi(W)} × ${fi(H)}`),
    h('p', { class: 'small muted' }, 'The planner places no tall furniture (wardrobe, fridge, TV unit) here — for example in front of a window or a meter board.'),
    h('div', { class: 'inl' }, field('East–west', tag(ftIn({ value: W, min: 0.5, max: rw(n), onChange: later((v) => set(rc.x0, rc.y0, v, H)) }), 'ko-w')), field('North–south', tag(ftIn({ value: H, min: 0.5, max: rh(n), onChange: later((v) => set(rc.x0, rc.y0, W, v)) }), 'ko-h'))),
    h('div', { class: 'inl', style: { marginTop: '8px' } }, field('From the west wall', tag(ftIn({ value: rc.x0 - n.x0, min: 0, max: rw(n), onChange: later((v) => set(n.x0 + v, rc.y0, W, H)) }), 'ko-x')), field('From the south wall', tag(ftIn({ value: rc.y0 - n.y0, min: 0, max: rh(n), onChange: later((v) => set(rc.x0, n.y0 + v, W, H)) }), 'ko-y'))),
    h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn sm danger', type: 'button', onclick: ed.deleteSel }, 'Delete')));
}

function palettePanel(ed, panel) {
  panel.append(h('h3', {}, 'Place furniture'), h('div', { class: 'sub' }, 'Pick an item, then click in a room. Wall items back onto the nearest wall; Esc finishes.'));
  for (const [group, items] of PALETTE) {
    panel.append(h('h4', {}, group), h('div', { class: 'palette' }, items.map((pr) => h('button', { type: 'button', class: ed.placing === pr ? 'on' : '', 'aria-pressed': String(ed.placing === pr), title: `${fi(pr.w)} × ${fi(pr.h)}`,
      style: ed.placing === pr ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : null, onclick: () => ed.setTool('furniture', { placing: pr }) }, pr.name))));
  }
  panel.append(h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => ed.setTool('select') }, 'Done')));
}

// ------------------------------------------------------------------------------------------------ checks
function checksPanel(ed, panel) {
  const pl = ed.plan, names = pl.rooms.map((r) => r.name).sort((a, b) => b.length - a.length);
  const roomIn = (txt) => { const nm = names.find((q) => (txt || '').includes(q)); return nm ? pl.rooms.find((r) => r.name === nm) : null; };
  panel.append(summary(ed));
  const cats = [...new Set(pl.checks.map((c) => c.cat))];
  const order = (c) => (!c.ok && c.hard ? 0 : !c.ok ? 1 : 2);
  for (const cat of cats) {
    const cs = pl.checks.filter((c) => c.cat === cat).sort((a, b) => order(a) - order(b));
    const bad = cs.filter((c) => !c.ok).length;
    panel.append(h('h4', {}, `${cat}${bad ? ` · ${bad} to look at` : ' · all pass'}`));
    const row = (c) => {
      const r = !c.ok ? roomIn(c.detail) : null, cls = c.ok ? 'ok' : c.hard ? 'bad' : 'adv';
      return h('div', { class: `chk ${cls}`, 'data-room': r ? String(r.uid) : null, role: r ? 'button' : null, tabindex: r ? '0' : null, title: r ? `Show ${r.name}` : null,
        onclick: r ? () => ed.select({ t: 'room', uid: r.uid }) : null, onkeydown: r ? (e) => { if (e.key === 'Enter') ed.select({ t: 'room', uid: r.uid }); } : null },
      h('span', { class: 'i', 'aria-label': c.ok ? 'passes' : c.hard ? 'fails' : 'advisory' }, c.ok ? '✓' : c.hard ? '✗' : '!'), h('span', {}, c.name), c.detail ? h('span', { class: 'd' }, c.detail) : null);
    };
    for (const c of cs.filter((q) => !q.ok)) panel.append(row(c));
    const ok = cs.filter((q) => q.ok);
    if (ok.length) panel.append(h('details', { class: 'passing' }, h('summary', { class: 'small muted' }, `${ok.length} passing check${ok.length === 1 ? '' : 's'}`), ok.map(row)));
  }
  panel.append(h('h4', {}, 'Vaastu by room'),
    h('table', { class: 'rules' }, h('thead', {}, h('tr', {}, h('th', {}, 'Room'), h('th', {}, 'Padas'), h('th', {}, ''))),
      h('tbody', {}, pl.sector_rows.filter((q) => q.rtype !== 'suite').map((q) => h('tr', {}, h('td', {}, q.room), h('td', { class: 'small' }, q.padas), h('td', {}, q.score === null || q.score === undefined ? '' : h('span', { class: `badge ${q.ok ? 'ok' : 'bad'}` }, q.ok ? 'ok' : 'off')))))));
}

// ------------------------------------------------------------------------------------------------ plan settings, sheets, revisions
function planPanel(ed, panel) {
  const p = ed.p, d = ed.doc, dr = p.drawing || (p.drawing = {});
  const text = (value, k, onChange, attrs = {}) => { const i = tag(h('input', { type: 'text', value: value || '', ...attrs }), k); i.addEventListener('change', later(() => onChange(i.value.trim()))); return i; };
  const label = text(d.label, 'plan-label', (v) => ed.apply((dd) => E.setDocField(dd, 'label', v), 'Plan renamed.'));
  panel.append(h('h4', { style: { marginTop: 0 } }, 'This plan'), field('Name', label),
    h('div', { class: 'small muted', style: { margin: '4px 0 8px' } }, d.source || ''),
    checkbox(`Entrance door on the road (${SIDE[ed.cfg.road_side].toLowerCase()}) wall`, d.roadDoor !== false, (v) => ed.apply((dd) => E.setDocField(dd, 'roadDoor', v), v ? 'Entrance door added.' : 'No entrance door on the road wall.'), 'Off for upper floors reached by the staircase.'));
  // plans
  panel.append(h('h4', {}, 'Plans in this project'), h('div', { class: 'list' }, p.plans.map((q, i) => li(q.label || `Plan ${i + 1}`, i === ed.idx ? 'open now' : null, { sel: i === ed.idx, onclick: i === ed.idx ? null : () => ed.app.go(`#/p/${p.id}/plan/${i}`) }))),
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        const nm = await prompt('Duplicate plan', 'Name of the copy', `${d.label || 'Plan'} (copy)`); if (!nm) return;
        p.plans.push({ ...E.cloneDoc(d), label: nm, pid: newId() }); await saveProject(p); ed.app.go(`#/p/${p.id}/plan/${p.plans.length - 1}`);
      } }, 'Duplicate'),
      h('button', { class: 'btn sm danger', type: 'button', disabled: p.plans.length < 2, title: p.plans.length < 2 ? 'The only plan' : '', onclick: async () => {
        if (!(await confirmDlg('Delete this plan?', `"${d.label}" and its saved revisions will be removed.`))) return;
        if (p.revisions) delete p.revisions[d.pid];
        p.plans.splice(ed.idx, 1); p.activePlan = 0; await saveProject(p); ed.app.go(`#/p/${p.id}/plan/0`);
      } }, 'Delete'),
      h('a', { class: 'btn sm', href: `#/p/${p.id}/options` }, 'More options')));
  // sheets
  const saveDr = (key, v) => { dr[key] = v; ed.app.save(); toast('Title block updated.'); };
  panel.append(h('h4', {}, 'Drawing sheets (title block)'),
    h('div', { style: { display: 'grid', gap: '8px' } },
      field('Project', text(dr.name || p.name, 'dr-name', (v) => saveDr('name', v))),
      field('Plan label', text((d.meta && d.meta.sheetLabel) || dr.plan_label || '', 'dr-label', (v) => ed.apply((dd) => E.setDocField(dd, 'meta', { ...(dd.meta || {}), sheetLabel: v }), 'Plan label updated.'), { placeholder: d.label || '' })),
      h('div', { class: 'inl' }, field('Revision', text(dr.rev || 'P1', 'dr-rev', (v) => saveDr('rev', v || 'P1'))), field('Date', text(dr.date || '', 'dr-date', (v) => saveDr('date', v), { placeholder: 'today (YYYY-MM-DD)' })))),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm primary', type: 'button', onclick: ed.openDrawings }, 'View drawings & download PDF')));
  // notes
  const notes = d.notes || [];
  panel.append(h('h4', {}, 'Notes on the plan sheet'),
    h('div', { style: { display: 'grid', gap: '6px' } }, notes.map((nt, i) => {
      const ta = tag(h('textarea', { rows: '3' }, nt), `note-${i}`);
      ta.addEventListener('change', later(() => { const arr = notes.slice(); arr[i] = ta.value; ed.apply((dd) => E.setNotes(dd, arr), 'Note updated.'); }));
      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px', alignItems: 'start' } }, ta, x(() => ed.apply((dd) => E.setNotes(dd, notes.filter((_, j) => j !== i)), 'Note removed.'), 'Remove note'));
    })),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const t = await prompt('Add a note', 'Note text (shown under the general notes on A-101)'); if (t) ed.apply((dd) => E.setNotes(dd, notes.concat([t])), 'Note added.');
    } }, '+ Add a note')));
  // revisions
  const revs = (p.revisions = p.revisions || {})[d.pid] || [];
  panel.append(h('h4', {}, 'Revisions'),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const nm = await prompt('Save a revision', 'Revision name', `Revision ${revs.length + 1}`); if (!nm) return;
      (p.revisions[d.pid] = p.revisions[d.pid] || []).push({ id: newId(), label: nm, time: Date.now(), doc: E.cloneDoc(ed.doc), vaastu: ed.plan.vaastu_score, hard: ed.plan.failed.length });
      await saveProject(p); toast('Revision saved.'); ed.renderAll();
    } }, 'Save this version…')),
    h('div', { class: 'list', style: { marginTop: '8px' } }, revs.length ? revs.slice().reverse().map((rv) => li(rv.label, `${when(rv.time)}${rv.vaastu !== undefined ? ` · Vaastu ${rv.vaastu.toFixed(1)}` : ''}${rv.hard ? ` · ${rv.hard} hard` : ''}`, {
      extra: h('span', { class: 'row', style: { gap: '2px' } },
        h('button', { class: 'btn sm', type: 'button', onclick: () => ed.replaceDoc({ ...E.cloneDoc(rv.doc), pid: d.pid }, `Restored "${rv.label}" (undo brings back what you had).`) }, 'Restore'),
        x(async () => { if (await confirmDlg('Delete revision?', `"${rv.label}" will be removed.`)) { p.revisions[d.pid] = revs.filter((q) => q.id !== rv.id); await saveProject(p); ed.renderAll(); } }, 'Delete revision')),
    })) : h('div', { class: 'small muted' }, 'Save versions as you go — each keeps the full plan, so you can always step back.')));
  // files
  panel.append(h('h4', {}, 'Files'), h('div', { class: 'row' },
    h('button', { class: 'btn sm', type: 'button', onclick: () => ed.app.exportProject(p) }, 'Export project'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => download(`${(d.label || 'plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.plan.json`, JSON.stringify(d, null, 1), 'application/json') }, 'Plan as JSON'),
    h('a', { class: 'btn sm', href: `#/p/${p.id}/setup` }, 'Project setup')));
}
