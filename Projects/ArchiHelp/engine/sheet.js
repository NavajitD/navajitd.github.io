// Vaastu Planner — vector display list for drawing sheets, with an SVG renderer and a dependency-free PDF writer.
// Sheet coordinates are millimetres, origin bottom-left, y up (as matplotlib's figure axes in the notebook).
// Line widths and font sizes are in points, like matplotlib, so the drawings keep the notebook's proportions.
import { textWidthEm, winAnsiCode } from './fontmetrics.js';
import { clipSegmentToBox } from './geom.js';

export const PT = 25.4 / 72;                 // mm per point
const LP_ASC = 0.76, LP_DESC = 0.24;         // text box metrics used for layout (matches the notebook's DejaVu Sans boxes)
const ZDEF = { path: 1, line: 2, text: 3, ellipse: 1 };

export class Sheet {
  constructor({ w = 420, h = 297, name = '' } = {}) { this.w = w; this.h = h; this.name = name; this.items = []; this.seq = 0; this.layer = 0; }
  push(it, z, layer) { it.z = z ?? ZDEF[it.t] ?? 1; it.layer = layer ?? this.layer; it.seq = this.seq++; this.items.push(it); return it; }
  /** New view on its own layer (like a new matplotlib axes: drawn above every earlier axes, whenever items are added). */
  view(map) { const v = new View(this, map, this.layer); this.layer += 1; return v; }
  ordered() { return this.items.slice().sort((a, b) => a.layer - b.layer || a.z - b.z || a.seq - b.seq); }
}

/** Drawing surface with a data -> sheet-mm mapping (x' = ox + (x - x0) * s, y' = oy + (y - y0) * s). */
export class View {
  constructor(sheet, map = {}, layer = 0) {
    this.layer = layer; const sh = sheet;
    this.sh = { push: (it, z) => sh.push(it, z, this.layer) }; this.s = map.s ?? 1; this.x0 = map.x0 ?? 0; this.y0 = map.y0 ?? 0; this.ox = map.ox ?? 0; this.oy = map.oy ?? 0;
  }
  X(x) { return this.ox + (x - this.x0) * this.s; }
  Y(y) { return this.oy + (y - this.y0) * this.s; }
  P(p) { return [this.X(p[0]), this.Y(p[1])]; }
  plot(xs, ys, o = {}) {
    const pts = xs.map((x, i) => [this.X(x), this.Y(ys[i])]);
    return this.sh.push({ t: 'path', subs: [{ pts, closed: false }], stroke: o.c ?? o.color ?? '#000', lw: o.lw ?? 1.5, dash: dashPt(o.ls, o.lw ?? 1.5), alpha: o.alpha ?? 1 }, o.z ?? 2);
  }
  /** matplotlib Rectangle: fill=False / fc / ec / lw / hatch / ls */
  rect(x, y, w, h, o = {}) {
    const fill = o.fill === false || !o.fc || o.fc === 'none' ? null : o.fc;
    const stroke = !o.ec || o.ec === 'none' ? null : o.ec;
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((p) => this.P(p));
    const it = this.sh.push({ t: 'path', subs: [{ pts, closed: true }], fill: fill === 'none' ? null : fill, stroke: (o.lw === 0) ? null : stroke, lw: o.lw ?? 1.0, dash: dashPt(o.ls, o.lw ?? 1.0), alpha: o.alpha ?? 1, falpha: o.falpha }, o.z ?? 1);
    if (o.hatch) this.hatch(x, y, w, h, o.hatch, o.ec && o.ec !== 'none' ? o.ec : '#000', o.z ?? 1);
    return it;
  }
  /** 45-degree hatch lines like matplotlib ('/' = NE lines, 'x' = both, '.' = dots); spacing per hatch density. */
  hatch(x, y, w, h, pat, color, z) {
    const box = { x0: this.X(x), y0: this.Y(y), x1: this.X(x + w), y1: this.Y(y + h) };
    const nSlash = (pat.match(/\//g) || []).length, nX = (pat.match(/x/gi) || []).length, nDot = (pat.match(/\./g) || []).length;
    const fam = (dir, count) => {
      if (!count) return;
      const perp = Math.SQRT2 * 25.4 / (count * 6);      // mm between lines (72 pt hatch unit, density 6)
      const step = perp * Math.SQRT2, subs = [];
      const span = (box.x1 - box.x0) + (box.y1 - box.y0);
      for (let c = -span - step; c <= span + step; c += step) {
        // dir +1: y - x = c (NE); dir -1: y + x = c' (NW)
        const p0 = dir > 0 ? [box.x0 - 1, box.y0 - 1 + c] : [box.x0 - 1, box.y1 + 1 - c];
        const p1 = dir > 0 ? [box.x0 + span + 1, box.y0 - 1 + c + span + 2] : [box.x0 + span + 1, box.y1 + 1 - c - span - 2];
        const seg = clipSegmentToBox(p0, p1, box);
        if (seg && Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) > 1e-3) subs.push({ pts: seg, closed: false });
      }
      if (subs.length) this.sh.push({ t: 'path', subs, stroke: color, lw: 1.0, alpha: 1 }, z);
    };
    fam(1, nSlash + nX); fam(-1, nX);
    if (nDot) {
      const sp = 25.4 / (nDot * 6) * 2;
      for (let yy = box.y0 + sp / 2; yy < box.y1; yy += sp) for (let xx = box.x0 + sp / 2; xx < box.x1; xx += sp)
        this.sh.push({ t: 'ellipse', cx: xx, cy: yy, rx: 0.12, ry: 0.12, fill: color }, z);
    }
  }
  /** Filled / stroked polygon(s): loops = [[[x,y],...], ...]; even-odd fill (holes). */
  poly(loops, o = {}) {
    return this.sh.push({ t: 'path', subs: loops.map((l) => ({ pts: l.map((p) => this.P(p)), closed: true })), fill: o.fc ?? null, stroke: o.ec ?? null, lw: o.lw ?? 1.0, evenodd: true, alpha: o.alpha ?? 1 }, o.z ?? 1);
  }
  segments(segs, o = {}) {
    return this.sh.push({ t: 'path', subs: segs.map((s) => ({ pts: s.map((p) => this.P(p)), closed: false })), stroke: o.c ?? '#000', lw: o.lw ?? 1.0, dash: dashPt(o.ls, o.lw ?? 1.0), alpha: o.alpha ?? 1 }, o.z ?? 2);
  }
  circle(x, y, r, o = {}) { return this.ellipse(x, y, 2 * r, 2 * r, o); }
  /** matplotlib Ellipse(xy, width, height) */
  ellipse(x, y, w, h, o = {}) {
    const fill = o.fill === false || !o.fc || o.fc === 'none' ? null : o.fc;
    const stroke = !o.ec || o.ec === 'none' ? null : o.ec;
    return this.sh.push({ t: 'ellipse', cx: this.X(x), cy: this.Y(y), rx: w / 2 * this.s, ry: h / 2 * this.s, fill, stroke, lw: o.lw ?? 1.0, alpha: o.alpha ?? 1 }, o.z ?? 1);
  }
  /** matplotlib Arc(xy, width, height, theta1, theta2) in degrees, counter-clockwise */
  arc(x, y, w, h, a0, a1, o = {}) {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 3)), pts = [];
    for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push([this.X(x + w / 2 * Math.cos(a)), this.Y(y + h / 2 * Math.sin(a))]); }
    return this.sh.push({ t: 'path', subs: [{ pts, closed: false }], stroke: o.color ?? o.c ?? '#000', lw: o.lw ?? 1.0, alpha: 1 }, o.z ?? 1);
  }
  /** Line with a filled triangular head at (x1, y1); head sizes in points. */
  arrow(x0, y0, x1, y1, o = {}) {
    const A = this.P([x0, y0]), B = this.P([x1, y1]), dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, hl = (o.headLength ?? 2.4) * PT, hw = (o.headWidth ?? 1.2) * PT, sh = (o.shrink ?? 2) * PT;
    const S = [A[0] + ux * sh, A[1] + uy * sh], E = [B[0] - ux * sh, B[1] - uy * sh], base = [E[0] - ux * hl, E[1] - uy * hl];
    this.sh.push({ t: 'path', subs: [{ pts: [S, base], closed: false }], stroke: o.color ?? '#000', lw: o.lw ?? 1.0, alpha: 1 }, o.z ?? 2);
    return this.sh.push({ t: 'path', subs: [{ pts: [E, [base[0] - uy * hw, base[1] + ux * hw], [base[0] + uy * hw, base[1] - ux * hw]], closed: true }], fill: o.color ?? '#000', stroke: o.color ?? '#000', lw: o.lw ?? 1.0, alpha: 1 }, o.z ?? 2);
  }
  /** matplotlib-style text: fontsize (pt), ha, va, rotation (deg CCW), color, weight, bbox {fc, pad, alpha}, linespacing. */
  text(x, y, s, o = {}) {
    const lay = layoutText(this.X(x), this.Y(y), String(s), o);
    return this.sh.push({ t: 'text', ...lay }, o.z ?? 3);
  }
}

function dashPt(ls, lw) {
  if (!ls || ls === '-' || ls === 'solid') return null;
  if (ls === '--' || ls === 'dashed') return [3.7 * lw, 1.6 * lw];
  if (ls === ':' || ls === 'dotted') return [1 * lw, 1.65 * lw];
  if (ls === '-.' || ls === 'dashdot') return [6.4 * lw, 1.6 * lw, 1 * lw, 1.6 * lw];
  if (Array.isArray(ls)) return ls[1].map((v) => v * lw);     // (offset, (on, off, ...)) scaled by lw like matplotlib
  return null;
}

/** Text layout with matplotlib's default rotation mode: rotate the text box, then align its bounding box. */
export function layoutText(x, y, s, o = {}) {
  const size = o.fontsize ?? o.fs ?? 10, bold = o.weight === 'bold' || o.bold === true, rot = o.rotation ?? 0;
  const ha = o.ha ?? 'left', va = o.va ?? 'baseline', ls = o.linespacing ?? 1.2, k = size * PT;
  const lines = s.split('\n'), widths = lines.map((l) => textWidthEm(l, bold) * k), W = Math.max(...widths, 0);
  const pitch = LP_ASC * ls * k, Hh = (lines.length - 1) * pitch + (LP_ASC + LP_DESC) * k;
  const local = lines.map((l, i) => [ha === 'left' ? 0 : ha === 'center' ? (W - widths[i]) / 2 : W - widths[i], -(LP_ASC * k + i * pitch)]);
  const c = Math.cos(rot * Math.PI / 180), sn = Math.sin(rot * Math.PI / 180);
  const R = ([u, v]) => [u * c - v * sn, u * sn + v * c];
  const corners = [[0, 0], [W, 0], [W, -Hh], [0, -Hh]].map(R);
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const dx = ha === 'left' ? -minx : ha === 'center' ? -(minx + maxx) / 2 : -maxx;
  let dy;
  if (va === 'bottom') dy = -miny; else if (va === 'center') dy = -(miny + maxy) / 2; else if (va === 'top') dy = -maxy;
  else { const b = R(local[local.length - 1]); dy = -b[1]; }               // baseline (of the last line)
  const out = lines.map((l, i) => { const p = R(local[i]); return { s: l, x: x + dx + p[0], y: y + dy + p[1] }; });
  const res = { lines: out.filter((l) => l.s.length), size, bold, rot, color: o.color ?? o.c ?? '#000', alpha: o.alpha ?? 1 };
  if (o.bbox) {
    const pad = (o.bbox.pad ?? 0.3) * k;
    res.bbox = { pts: [[-pad, pad], [W + pad, pad], [W + pad, -Hh - pad], [-pad, -Hh - pad]].map(R).map((p) => [x + dx + p[0], y + dy + p[1]]),
                 fill: o.bbox.fc ?? '#fff', alpha: o.bbox.alpha ?? 1 };
  }
  res.box = corners.map((p) => [x + dx + p[0], y + dy + p[1]]);
  return res;
}

// ------------------------------------------------------------------------------------------------ SVG
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f3 = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };

export function sheetToSvg(sheet, { viewBox = null, cls = '', bg = '#ffffff', fontFamily = 'Helvetica, Arial, sans-serif', attrs = '' } = {}) {
  const H = sheet.h, vb = viewBox || [0, 0, sheet.w, sheet.h];
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f3(vb[0])} ${f3(H - vb[3])} ${f3(vb[2] - vb[0])} ${f3(vb[3] - vb[1])}" class="${cls}" ${attrs} font-family="${fontFamily}">`);
  if (bg) out.push(`<rect x="${f3(vb[0])}" y="${f3(H - vb[3])}" width="${f3(vb[2] - vb[0])}" height="${f3(vb[3] - vb[1])}" fill="${bg}"/>`);
  for (const it of sheet.ordered()) {
    if (it.t === 'path') {
      let d = '';
      for (const s of it.subs) { d += s.pts.map((p, i) => `${i ? 'L' : 'M'}${f3(p[0])} ${f3(H - p[1])}`).join('') + (s.closed ? 'Z' : ''); }
      const a = [`d="${d}"`];
      a.push(it.fill ? `fill="${it.fill}"` : 'fill="none"');
      if (it.fill && it.evenodd) a.push('fill-rule="evenodd"');
      if (it.stroke) a.push(`stroke="${it.stroke}" stroke-width="${f3(it.lw * PT)}" stroke-linejoin="miter" stroke-linecap="butt"`);
      if (it.dash) a.push(`stroke-dasharray="${it.dash.map((v) => f3(v * PT)).join(' ')}"`);
      if (it.alpha !== 1) a.push(`opacity="${it.alpha}"`);
      if (it.falpha !== undefined) a.push(`fill-opacity="${it.falpha}"`);
      out.push(`<path ${a.join(' ')}/>`);
    } else if (it.t === 'ellipse') {
      const a = [`cx="${f3(it.cx)}" cy="${f3(H - it.cy)}" rx="${f3(it.rx)}" ry="${f3(it.ry)}"`, it.fill ? `fill="${it.fill}"` : 'fill="none"'];
      if (it.stroke) a.push(`stroke="${it.stroke}" stroke-width="${f3(it.lw * PT)}"`);
      if (it.alpha !== 1) a.push(`opacity="${it.alpha}"`);
      out.push(`<ellipse ${a.join(' ')}/>`);
    } else if (it.t === 'text') {
      if (it.bbox) out.push(`<path d="${it.bbox.pts.map((p, i) => `${i ? 'L' : 'M'}${f3(p[0])} ${f3(H - p[1])}`).join('')}Z" fill="${it.bbox.fill}"${it.bbox.alpha !== 1 ? ` fill-opacity="${it.bbox.alpha}"` : ''}/>`);
      const fs = f3(it.size * PT);
      for (const l of it.lines) {
        const tr = it.rot ? ` transform="rotate(${f3(-it.rot)} ${f3(l.x)} ${f3(H - l.y)})"` : '';
        out.push(`<text x="${f3(l.x)}" y="${f3(H - l.y)}" font-size="${fs}"${it.bold ? ' font-weight="bold"' : ''} fill="${it.color}"${tr} xml:space="preserve">${esc(l.s)}</text>`);
      }
    }
  }
  out.push('</svg>');
  return out.join('');
}

// ------------------------------------------------------------------------------------------------ PDF
const K = 72 / 25.4;
const n2 = (v) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? '0' : String(r); };
const rgb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => n2(parseInt(h.slice(i, i + 2), 16) / 255 * 100 / 100));
};
const NAMED = { white: '#ffffff', black: '#000000', none: null };
const col = (c) => (c in NAMED ? NAMED[c] : c);

function pdfString(s) {
  let out = '(';
  for (const ch of s) {
    const c = winAnsiCode(ch);
    if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += String.fromCharCode(c);
  }
  return out + ')';
}

function contentStream(sheet, gs) {
  const o = [];
  const alphaGs = (a) => { const key = n2(a); if (!gs.has(key)) gs.set(key, `GS${gs.size}`); return gs.get(key); };
  for (const it of sheet.ordered()) {
    if (it.t === 'path' || it.t === 'ellipse') {
      const fill = it.fill ? col(it.fill) : null, stroke = it.stroke ? col(it.stroke) : null;
      if (!fill && !stroke) continue;
      o.push('q');
      if (it.alpha !== undefined && it.alpha !== 1) o.push(`/${alphaGs(it.alpha)} gs`);
      if (fill) o.push(`${rgb(fill).join(' ')} rg`);
      if (stroke) { o.push(`${rgb(stroke).join(' ')} RG ${n2(it.lw)} w`); o.push(it.dash ? `[${it.dash.map(n2).join(' ')}] 0 d` : '[] 0 d'); }
      if (it.t === 'path') {
        for (const s of it.subs) {
          s.pts.forEach((p, i) => o.push(`${n2(p[0] * K)} ${n2(p[1] * K)} ${i ? 'l' : 'm'}`));
          if (s.closed) o.push('h');
        }
      } else {
        const cx = it.cx * K, cy = it.cy * K, rx = it.rx * K, ry = it.ry * K, m = 0.5523;
        o.push(`${n2(cx + rx)} ${n2(cy)} m`,
          `${n2(cx + rx)} ${n2(cy + m * ry)} ${n2(cx + m * rx)} ${n2(cy + ry)} ${n2(cx)} ${n2(cy + ry)} c`,
          `${n2(cx - m * rx)} ${n2(cy + ry)} ${n2(cx - rx)} ${n2(cy + m * ry)} ${n2(cx - rx)} ${n2(cy)} c`,
          `${n2(cx - rx)} ${n2(cy - m * ry)} ${n2(cx - m * rx)} ${n2(cy - ry)} ${n2(cx)} ${n2(cy - ry)} c`,
          `${n2(cx + m * rx)} ${n2(cy - ry)} ${n2(cx + rx)} ${n2(cy - m * ry)} ${n2(cx + rx)} ${n2(cy)} c h`);
      }
      const eo = it.evenodd ? '*' : '';
      o.push(fill && stroke ? `B${eo}` : fill ? `f${eo}` : 'S');
      o.push('Q');
    } else if (it.t === 'text') {
      if (it.bbox) {
        o.push('q');
        if (it.bbox.alpha !== 1) o.push(`/${alphaGs(it.bbox.alpha)} gs`);
        o.push(`${rgb(col(it.bbox.fill)).join(' ')} rg`);
        it.bbox.pts.forEach((p, i) => o.push(`${n2(p[0] * K)} ${n2(p[1] * K)} ${i ? 'l' : 'm'}`));
        o.push('h f Q');
      }
      const c = Math.cos(it.rot * Math.PI / 180), s = Math.sin(it.rot * Math.PI / 180);
      o.push('q BT', `/${it.bold ? 'F2' : 'F1'} ${n2(it.size)} Tf`, `${rgb(col(it.color) || '#000000').join(' ')} rg`);
      if (it.alpha !== 1) o.push(`/${alphaGs(it.alpha)} gs`);
      for (const l of it.lines) o.push(`${n2(c)} ${n2(s)} ${n2(-s)} ${n2(c)} ${n2(l.x * K)} ${n2(l.y * K)} Tm ${pdfString(l.s)} Tj`);
      o.push('ET Q');
    }
  }
  return o.join('\n');
}

/** Multi-page PDF (one page per sheet). Optional `deflate(Uint8Array) -> Uint8Array` compresses the content streams. */
export function sheetsToPdf(sheets, { title = 'Drawing set', author = 'Vaastu Planner', deflate = null, date = new Date() } = {}) {
  const enc = new TextEncoder();
  const objs = [];                       // [id] -> bytes/string
  const add = (body) => { objs.push(body); return objs.length; };
  const gs = new Map();
  const catalog = add(null), pages = add(null), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const gsObj = add(null);
  const pageIds = [];
  for (const sh of sheets) {
    const raw = enc.encode(contentStream(sh, gs));
    let data = raw, filt = '';
    if (deflate) { data = deflate(raw); filt = ' /Filter /FlateDecode'; }
    const cs = add({ dict: `<< /Length ${data.length}${filt} >>`, data });
    pageIds.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${n2(sh.w * K)} ${n2(sh.h * K)}] /Contents ${cs} 0 R ` +
      `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /ExtGState ${gsObj} 0 R >> >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objs[gsObj - 1] = `<< ${[...gs.entries()].map(([a, nm]) => `/${nm} << /Type /ExtGState /ca ${a} /CA ${a} >>`).join(' ')} >>`;
  const pad = (v) => String(v).padStart(2, '0');
  const d = `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const info = add(`<< /Title ${pdfString(title)} /Author ${pdfString(author)} /Creator (Vaastu Planner design engine) /Producer (Vaastu Planner) /CreationDate (${d}) >>`);
  const chunks = [], offsets = []; let len = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  objs.forEach((o, i) => {
    offsets.push(len);
    if (o && typeof o === 'object' && o.data) { put(`${i + 1} 0 obj\n${o.dict}\nstream\n`); put(o.data); put('\nendstream\nendobj\n'); }
    else put(`${i + 1} 0 obj\n${o}\nendobj\n`);
  });
  const xref = len;
  put(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((v) => `${String(v).padStart(10, '0')} 00000 n \n`).join(''));
  put(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/** Browser variant: page streams compressed with the native CompressionStream('deflate') (zlib = /FlateDecode). */
export async function sheetsToPdfAsync(sheets, opts = {}) {
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') return sheetsToPdf(sheets, opts);
  const gs = new Map(), enc = new TextEncoder();
  const comp = await Promise.all(sheets.map(async (sh) => {
    const raw = enc.encode(contentStream(sh, gs));
    return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  }));
  let i = 0;
  return sheetsToPdf(sheets, { ...opts, deflate: () => comp[i++] });
}
