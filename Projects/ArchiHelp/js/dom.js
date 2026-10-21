// Vaastu Planner UI — tiny DOM helpers (no framework).
import { fi, parseFtIn } from '../engine/geom.js';

/** h('div', {class:'x', onclick: fn, style: {...}}, child, [children], 'text') */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

export function toast(msg, kind = '', ms = 3400) {
  const box = document.getElementById('toast'), t = h('div', { class: `t ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Feet-inch input: shows 8'-11 1/2"; accepts 8'-11", 8 11, 8.5, 107", 8ft 6in. step = arrow-key step (ft). */
export function ftIn({ value, onChange, min = 0, max = 1e9, step = 1 / 12, title = '', id }) {
  const inp = h('input', { type: 'text', class: 'ftin num', inputmode: 'decimal', title, id, autocomplete: 'off', spellcheck: 'false' });
  let cur = value;
  const show = () => { inp.value = Number.isFinite(cur) ? fi(cur) : ''; inp.classList.remove('bad'); };
  const commit = () => {
    let s = inp.value.trim().replace(/\s+/g, ' ');
    if (/^\d+ \d+(\.\d+)?$/.test(s)) s = s.replace(' ', "'") + '"';          // "8 11" -> 8'11"
    const v = parseFtIn(s);
    if (!Number.isFinite(v) || v < min - 1e-9 || v > max + 1e-9) { inp.classList.add('bad'); return; }
    if (Math.abs(v - cur) < 1e-9) { show(); return; }
    cur = v; show(); onChange && onChange(v);
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); inp.blur(); }
    if (e.key === 'Escape') { show(); inp.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const s = (e.shiftKey ? 12 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
      const v = Math.min(max, Math.max(min, Math.round((cur + s) * 24) / 24));
      cur = v; show(); onChange && onChange(v);
    }
  });
  inp.setValue = (v) => { cur = v; show(); };
  show();
  return inp;
}

export function num({ value, onChange, min = -1e9, max = 1e9, step = 1, id, title = '' }) {
  const inp = h('input', { type: 'number', class: 'num', value: String(value), min: String(min), max: String(max), step: String(step), id, title });
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (!Number.isFinite(v) || v < min || v > max) { inp.classList.add('bad'); return; }
    inp.classList.remove('bad'); onChange && onChange(v);
  });
  return inp;
}

export function select(options, value, onChange, attrs = {}) {
  const s = h('select', attrs, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: String(v), selected: String(v) === String(value) }, l); }));
  s.addEventListener('change', () => onChange && onChange(s.value));
  return s;
}

export function seg(options, value, onChange, attrs = {}) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', ...attrs });
  for (const o of options) {
    const [v, l, tip] = Array.isArray(o) ? o : [o, o];
    const b = h('button', { type: 'button', class: String(v) === String(value) ? 'on' : '', role: 'radio', 'aria-checked': String(String(v) === String(value)), title: tip || null,
      onclick: () => { for (const x of wrap.children) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); } b.classList.add('on'); b.setAttribute('aria-checked', 'true'); onChange && onChange(v); } }, l);
    wrap.append(b);
  }
  return wrap;
}

/** Labelled control. Only real form controls get a <label> (a label around buttons would click the first one). */
export function field(label, control, hint) {
  const formCtl = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement;
  return h(formCtl ? 'label' : 'div', { class: 'field', role: formCtl ? null : 'group', 'aria-label': formCtl ? null : label }, h('span', {}, label), control, hint ? h('small', {}, hint) : null);
}

export function checkbox(label, checked, onChange, hint) {
  const inp = h('input', { type: 'checkbox', checked: !!checked });
  inp.addEventListener('change', () => onChange && onChange(inp.checked));
  return h('label', { class: 'check' }, inp, h('span', {}, label, hint ? h('div', { class: 'small muted' }, hint) : null));
}

/** Modal dialog. Returns a promise resolving to the action value (or null when dismissed). */
export function modal({ title, body, actions = [['Cancel', null], ['OK', true, 'primary']] }) {
  return new Promise((resolve) => {
    const close = (v) => { box.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: (e) => { if (e.target === box) close(null); } },
      h('div', { class: 'box' }, h('h2', {}, title), body,
        h('div', { class: 'acts' }, actions.map(([l, v, cls]) => h('button', { class: `btn ${cls || ''}`, type: 'button', onclick: () => close(typeof v === 'function' ? v() : v) }, l)))));
    document.body.append(box);
    document.addEventListener('keydown', onKey);
    const first = box.querySelector('input, select, textarea, .btn.primary');
    if (first) setTimeout(() => first.focus(), 30);
  });
}
export const confirmDlg = (title, text, ok = 'Delete') => modal({ title, body: h('p', { class: 'muted' }, text), actions: [['Cancel', false], [ok, true, 'primary']] });
export async function prompt(title, label, value = '') {
  const inp = h('input', { type: 'text', value });
  const r = await modal({ title, body: field(label, inp), actions: [['Cancel', null], ['OK', () => inp.value, 'primary']] });
  return r;
}

export function download(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', async () => { const f = inp.files[0]; inp.remove(); resolve(f ? await f.text() : null); });
    document.body.append(inp); inp.click();
  });
}

export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) { if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
  for (const k of kids.flat()) if (k !== null && k !== undefined) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export const sqft = (a) => `${Math.round(a)} sq ft`;
export const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
