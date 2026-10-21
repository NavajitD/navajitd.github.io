// ArchiHelp — the A3 drawing set (A-101 plan, A-102 Vaastu, S-101 structure, A-601 schedules): view, title block, PDF.
import { h, clear, toast, download } from './dom.js';
import { drawingSet } from '../engine/drawing.js';
import { sheetToSvg, sheetsToPdfAsync } from '../engine/sheet.js';

const TITLES = ['A-101 Floor plan', 'A-102 Vaastu sectors', 'S-101 Columns & beams', 'A-601 Schedules'];
const slug = (s) => String(s || 'drawings').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

/** Title-block info for a plan: project-wide name / rev / date, per-plan label. */
export function sheetInfo(p, doc) {
  const dr = p.drawing || {}, o = {};
  if (dr.name || p.name) o.name = dr.name || p.name;
  const lab = (doc.meta && doc.meta.sheetLabel) || dr.plan_label || doc.label;
  if (lab) o.plan_label = lab;
  if (dr.rev) o.rev = dr.rev;
  if (dr.date) o.date = dr.date;
  return o;
}

export async function pdfBytes(p, doc, plan) {
  const info = sheetInfo(p, doc);
  return sheetsToPdfAsync(drawingSet(plan, info), { title: `${info.name || 'Residence'} - ${info.plan_label || 'drawings'}` });
}

export function openDrawings(ed) {
  const p = ed.p, dr = p.drawing || (p.drawing = {});
  let k = 0, sheets = null;
  const view = h('div', { class: 'sheet-view', tabindex: '0', 'aria-live': 'polite' });
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Sheets' });
  const build = () => { sheets = drawingSet(ed.plan, sheetInfo(p, ed.doc)); };
  const show = () => {
    view.innerHTML = sheetToSvg(sheets[k], { attrs: `role="img" aria-label="${TITLES[k]}"` });
    clear(tabs);
    TITLES.forEach((t, i) => tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === k), class: i === k ? 'on' : '', onclick: () => { k = i; show(); } }, t.split(' ')[0])));
    title.textContent = TITLES[k];
  };
  const input = (value, placeholder, onChange, width) => {
    const i = h('input', { type: 'text', value: value || '', placeholder, style: { width, height: '30px' } });
    i.addEventListener('change', () => { onChange(i.value.trim()); ed.app.save(); build(); show(); });
    return i;
  };
  const busy = h('span', { class: 'small muted' });
  const pdfBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    pdfBtn.disabled = true; busy.textContent = 'Building PDF…';
    try {
      const info = sheetInfo(p, ed.doc), bytes = await pdfBytes(p, ed.doc, ed.plan);
      download(`${slug(info.name)}-${slug(info.plan_label)}-${slug(info.rev || 'P1')}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
      busy.textContent = `${Math.round(bytes.length / 1024)} KB`;
    } catch (e) { console.error(e); toast(`PDF failed: ${e.message}`, 'bad'); busy.textContent = ''; }
    pdfBtn.disabled = false;
  } }, 'Download PDF (4 sheets)');
  const title = h('h2', {});
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.target && e.target.closest && e.target.closest('input')) return;
    if (e.key === 'ArrowRight') { k = (k + 1) % 4; show(); }
    if (e.key === 'ArrowLeft') { k = (k + 3) % 4; show(); }
  };
  const head = h('div', { class: 'dlg-head' }, title, tabs,
    h('div', { class: 'row', style: { gap: '6px', flex: '1 1 380px' } },
      input(dr.name || p.name, 'Project', (v) => { dr.name = v; }, '210px'),
      input((ed.doc.meta && ed.doc.meta.sheetLabel) || dr.plan_label || '', ed.doc.label || 'Plan label', (v) => { ed.doc.meta = { ...(ed.doc.meta || {}), sheetLabel: v }; p.plans[ed.idx] = ed.doc; }, '230px'),
      input(dr.rev || 'P1', 'Rev', (v) => { dr.rev = v || 'P1'; }, '56px'),
      input(dr.date || '', 'Date (today)', (v) => { dr.date = v; }, '120px')),
    busy,
    h('button', { class: 'btn', type: 'button', onclick: () => download(`${slug(sheetInfo(p, ed.doc).name)}-${TITLES[k].split(' ')[0]}.svg`, sheetToSvg(sheets[k]), 'image/svg+xml') }, 'SVG'),
    pdfBtn,
    h('button', { class: 'btn ghost', type: 'button', onclick: close, 'aria-label': 'Close' }, 'Close'));
  const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Drawing set', onclick: (e) => { if (e.target === ov) close(); } }, h('div', { class: 'dlg' }, head, view));
  document.body.append(ov);
  document.addEventListener('keydown', onKey);
  build(); show();
  pdfBtn.focus();
}
