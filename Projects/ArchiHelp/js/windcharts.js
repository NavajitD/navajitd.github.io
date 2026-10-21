// ArchiHelp — Wind circulation charts (SVG): temperatures through the day, wind + window / fan timeline.
import { s, h, clear } from './dom.js';

export const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#a21caf', '#ca8a04', '#475569'];
const W = 760, PADL = 44, PADR = 14, PADT = 12;
const hh = (t) => `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;
export { hh };

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || raw;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/**
 * Temperature chart. series: [{ name, color, values (frames) }], out: outdoor frames, band {lo, hi}, frameMin, range [lo, hi].
 * Returns { el, setCursor(t), highlight(name|null) }.
 */
export function tempChart({ series, outdoor, band, frameMin = 15, range, title = '', unit = '°C', onPick }) {
  const H = 250, PADB = 26, plotW = W - PADL - PADR, plotH = H - PADT - PADB;
  const [lo, hi] = range, X = (t) => PADL + t / 24 * plotW, Y = (v) => PADT + (1 - (v - lo) / (hi - lo)) * plotH;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title });
  if (band) svg.append(s('rect', { x: PADL, y: Y(Math.min(hi, band.hi)), width: plotW, height: Math.max(0, Y(Math.max(lo, band.lo)) - Y(Math.min(hi, band.hi))), fill: 'rgba(5,150,105,0.10)' }),
    s('text', { x: PADL + 4, y: Y(Math.min(hi, band.hi)) + 12, class: 'ch-note' }, `comfort band ${band.lo.toFixed(1)}–${band.hi.toFixed(1)}${unit}`));
  for (const v of niceTicks(lo, hi)) svg.append(s('line', { x1: PADL, x2: W - PADR, y1: Y(v), y2: Y(v), class: 'ch-grid' }), s('text', { x: PADL - 6, y: Y(v) + 4, class: 'ch-ax', 'text-anchor': 'end' }, `${v}°`));
  for (let t = 0; t <= 24; t += 3) svg.append(s('line', { x1: X(t), x2: X(t), y1: PADT, y2: PADT + plotH, class: 'ch-grid v' }), s('text', { x: X(t), y: H - 8, class: 'ch-ax', 'text-anchor': 'middle' }, hh(t)));
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${X(i * frameMin / 60).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  if (outdoor) svg.append(s('path', { d: path(outdoor), class: 'ch-out' }));
  const lines = new Map();
  series.forEach((ser) => {
    const p = s('path', { d: path(ser.values), stroke: ser.color, class: 'ch-line' });
    p.addEventListener('click', () => onPick && onPick(ser.name));
    p.append(s('title', {}, ser.name));
    lines.set(ser.name, p); svg.append(p);
  });
  const cur = s('line', { x1: X(12), x2: X(12), y1: PADT, y2: PADT + plotH, class: 'ch-cur' });
  const tip = s('text', { x: X(12) + 5, y: PADT + 12, class: 'ch-tip' });
  svg.append(cur, tip);
  const el = h('div', { class: 'chart-wrap' }, svg);
  return {
    el,
    setCursor(t) {
      cur.setAttribute('x1', X(t)); cur.setAttribute('x2', X(t));
      const k = Math.min((outdoor || series[0].values).length - 1, Math.round(t * 60 / frameMin));
      tip.textContent = outdoor ? `${hh(t)} · outdoor ${outdoor[k].toFixed(1)}°` : hh(t);
      tip.setAttribute('x', t > 18 ? X(t) - 5 : X(t) + 5); tip.setAttribute('text-anchor', t > 18 ? 'end' : 'start');
    },
    highlight(name) { for (const [n, p] of lines) p.classList.toggle('dim', !!name && n !== name); for (const [n, p] of lines) if (n === name) svg.append(p); },
  };
}

/** Legend chips for the temperature chart. */
export function legend(series, onPick) {
  return h('div', { class: 'ch-legend' }, series.map((ser) => h('button', { type: 'button', class: 'ch-chip', onclick: () => onPick(ser.name) }, h('i', { style: { background: ser.color } }), ser.name)),
    h('span', { class: 'ch-chip static' }, h('i', { class: 'dash' }), 'Outdoor'));
}

/**
 * Wind + operation chart: wind at 10 m and at this floor, direction arrows, windows-open and fans-on strips.
 * hours: result.hours (25), uFloor: [25] m/s at the floor, floorIndex, fanZones: zone indices of fans on this floor.
 */
export function windChart({ hours, uFloor, floorIndex, fanZones, rotation = 0 }) {
  const H = 190, PADB = 64, plotW = W - PADL - PADR, plotH = H - PADT - PADB - 14;
  const vmax = Math.max(2, ...hours.map((x) => x.U10), ...uFloor) * 1.1;
  const X = (t) => PADL + t / 24 * plotW, Y = (v) => PADT + 14 + (1 - v / vmax) * plotH;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Wind and openings through the day' });
  for (const v of niceTicks(0, vmax, 3)) svg.append(s('line', { x1: PADL, x2: W - PADR, y1: Y(v), y2: Y(v), class: 'ch-grid' }), s('text', { x: PADL - 6, y: Y(v) + 4, class: 'ch-ax', 'text-anchor': 'end' }, `${v}`));
  for (let t = 0; t <= 24; t += 3) svg.append(s('text', { x: X(t), y: H - 6, class: 'ch-ax', 'text-anchor': 'middle' }, hh(t)));
  const line = (vals, cls) => s('path', { d: vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(''), class: cls });
  svg.append(line(hours.map((x) => x.U10), 'ch-out'), line(uFloor, 'ch-line wind'));
  // direction arrows (wind blows towards the arrow head; plan north up)
  hours.forEach((x, i) => {
    if (i % 2) return;
    const a = (x.wd - rotation) * Math.PI / 180, cx = X(i), cy = PADT + 6, L = 6, dx = -Math.sin(a) * L, dy = Math.cos(a) * L;
    svg.append(s('line', { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, class: 'ch-dir' }), s('circle', { cx: cx + dx, cy: cy + dy, r: 1.8, class: 'ch-dirh' }));
  });
  // strips
  const sy = H - PADB + 10, sh = 11;
  svg.append(s('text', { x: PADL - 6, y: sy + 9, class: 'ch-ax', 'text-anchor': 'end' }, 'win'), s('text', { x: PADL - 6, y: sy + sh + 13, class: 'ch-ax', 'text-anchor': 'end' }, 'fans'));
  for (let i = 0; i < 24; i++) {
    const x = hours[i], open = x.windowsOpen[floorIndex], fan = fanZones.some((z) => x.fanOn[z]);
    svg.append(s('rect', { x: X(i) + 0.5, y: sy, width: plotW / 24 - 1, height: sh, class: open ? 'st-open' : 'st-closed' }));
    if (fanZones.length) svg.append(s('rect', { x: X(i) + 0.5, y: sy + sh + 4, width: plotW / 24 - 1, height: sh, class: fan ? 'st-fan' : 'st-closed' }));
  }
  const cur = s('line', { x1: X(12), x2: X(12), y1: PADT, y2: H - 22, class: 'ch-cur' });
  svg.append(cur);
  return {
    el: h('div', { class: 'chart-wrap' }, svg,
      h('div', { class: 'ch-legend' }, h('span', { class: 'ch-chip static' }, h('i', { class: 'dash' }), 'Wind at 10 m (weather station height)'), h('span', { class: 'ch-chip static' }, h('i', { style: { background: '#0891b2' } }), 'At this floor (m/s)'),
        h('span', { class: 'ch-chip static' }, h('i', { style: { background: '#22d3ee' } }), 'Windows open'), fanZones.length ? h('span', { class: 'ch-chip static' }, h('i', { style: { background: '#facc15' } }), 'Fans on') : null)),
    setCursor(t) { cur.setAttribute('x1', X(t)); cur.setAttribute('x2', X(t)); },
  };
}

export const clearEl = clear;
