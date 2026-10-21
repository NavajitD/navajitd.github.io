// ArchiHelp — plan pictures for cards and previews: the engine's own wall drawing (tinted by room type)
// with large room names fitted into each room, so a 300-px card stays readable.
import { analysePlan } from '../engine/index.js';
import { planSheet } from '../engine/drawing.js';
import { sheetToSvg } from '../engine/sheet.js';
import { textWidthEm } from '../engine/fontmetrics.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Short room name for small pictures: "Master Bedroom" -> "Master", "Bedroom 2" -> "Bed 2", "Stair Landing" -> "Landing". */
export function shortName(r) {
  const n = r.name || '';
  if (r.rtype === 'master') return 'Master';
  if (r.rtype === 'bedroom') return n.replace(/^Bedroom/, 'Bed');
  if (r.rtype === 'stair') return 'Stair';
  if (n === 'Stair Landing') return 'Landing';
  if (r.rtype === 'puja') return 'Puja';
  return n.replace(/ Room$/, '');
}

/** -> { svg, plan }. labels: room names fitted into each room; furniture / tags: more detail for larger previews. */
export function planThumbSvg(cfg, doc, { labels = true, furniture = false, plan = null, tags = false, minFont = 0.7, maxFont = 1.6 } = {}) {
  const p = plan || analysePlan(cfg, doc, { furniture: true });
  const { sheet, map } = planSheet(p, { furniture, dims: false, grid: false, tags, tint: true, labels: false, north: false, columns: false, pad: [0.8, 0.8, 0.8, 0.8], fs: 9 });
  let svg = sheetToSvg(sheet, { bg: null, attrs: 'preserveAspectRatio="xMidYMid meet" role="img"' });
  if (labels) {
    const H = sheet.h, X = (x) => (x - map.x0) * map.s, Y = (y) => H - (y - map.y0) * map.s, out = [];
    for (const r of p.rooms) {
      if (r.rtype === 'suite') continue;
      const n = r.net, w = n.x1 - n.x0, ht = n.y1 - n.y0, s = shortName(r), em = Math.max(textWidthEm(s, true), 0.5);
      const flat = Math.min(maxFont, (w - 0.5) / em, (ht - 0.4) * 0.7), up = Math.min(maxFont, (ht - 0.5) / em, (w - 0.4) * 0.7);
      const rot = up > flat * 1.25 && flat < 1.0, size = rot ? up : flat;
      if (size < minFont) continue;
      const cx = X((n.x0 + n.x1) / 2), cy = Y((n.y0 + n.y1) / 2), fs = size * map.s;
      out.push(`<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="${fs.toFixed(2)}" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="#1f2937"${rot ? ` transform="rotate(-90 ${cx.toFixed(2)} ${cy.toFixed(2)})"` : ''}>${esc(s)}</text>`);
    }
    svg = svg.replace(/<\/svg>$/, `${out.join('')}</svg>`);
  }
  return { svg, plan: p };
}

/** The A-101 style plan (furniture, tags, labels; dimension chains optional) for large previews. */
export function planPreviewSvg(cfg, doc, { plan = null, dims = false } = {}) {
  const p = plan || analysePlan(cfg, doc, { furniture: true });
  const { sheet } = planSheet(p, { furniture: true, dims, grid: dims, tags: true, tint: true, labels: true, north: true, columns: true });
  return { svg: sheetToSvg(sheet, { bg: '#ffffff', attrs: 'preserveAspectRatio="xMidYMid meet" role="img"' }), plan: p };
}

/** Dominant pada of a room ("S2"), from the analysed plan's Vaastu rows. */
export function dominantPada(plan, uid) {
  const row = plan.sector_rows.find((x) => x.uid === uid);
  return row && row.padas ? row.padas.split(' ')[0] : '';
}
