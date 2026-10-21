// ArchiHelp — Wind circulation: the two animated plan views of one floor (as the notebook's video, live):
//   left  "Airflow"     wind speed at the floor (2D lattice-Boltzmann, scaled to the wind at this floor's height) with
//                       drifting particles, plus the ceiling fans' air movement inside the rooms;
//   right "Temperature" rooms coloured by air temperature or "feels like" (SET), with the flow through each opening
//                       from the airflow network, fans, and the stair well.
// Fans can be dragged in the airflow view while editing.
import { h, clear } from './dom.js';
import { fanField } from '../wind/fans.js';
import { windFactor } from '../wind/model.js';

const VIRIDIS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
const RDYLBU = ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'];
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
function ramp(stops, n = 256) {
  const S = stops.map(hex), out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * (S.length - 1), k = Math.min(S.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(S[k][c] + (S[k + 1][c] - S[k][c]) * f);
  }
  return out;
}
export const LUT_SPEED = ramp(VIRIDIS), LUT_TEMP = ramp(RDYLBU);
export const lutColor = (lut, t, a = 1) => { const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3; return `rgba(${lut[i]},${lut[i + 1]},${lut[i + 2]},${a})`; };
export const lutCss = (stops) => `linear-gradient(90deg, ${stops.join(', ')})`;
export { VIRIDIS, RDYLBU };

/** Interpolate a frame series (15-min) at hour t. */
export const atFrame = (arr, t, frameMin = 15) => { const f = t * 60 / frameMin, k = Math.min(arr.length - 2, Math.max(0, Math.floor(f))), w = Math.min(1, Math.max(0, f - k)); return arr[k] * (1 - w) + arr[k + 1] * w; };

/**
 * Mount the two plan views. ctx = { model, floorIndex, result, fans (zone-mapped, metres), fieldFor(hourIndex) -> field|null,
 * colorBy: 'air'|'set', tRange: [lo, hi], editFans: bool, onFanMove(fan, x, y) }.
 */
export function mountPlanViews(root, ctx) {
  const wrap = h('div', { class: 'wv' });
  const mk = (title, sub) => {
    const cv = h('canvas', { class: 'wv-c' }), trail = document.createElement('canvas');
    const panel = h('div', { class: 'wv-p' }, h('div', { class: 'wv-h' }, h('b', {}, title), h('span', { class: 'muted small' }, sub)), h('div', { class: 'wv-box' }, cv));
    return { cv, trail, panel };
  };
  const A = mk('Airflow', 'speed at the floor, particles follow the wind'), Tm = mk('Temperature', 'rooms, flow through openings, fans');
  const legA = h('div', { class: 'wv-leg' }), legT = h('div', { class: 'wv-leg' });
  A.panel.append(legA); Tm.panel.append(legT);
  wrap.append(A.panel, Tm.panel);
  root.append(wrap);
  const st = { t: 12, parts: [], lastT: null, img: null, imgKey: '', drag: null, raf: 0 };
  let geo = null;

  function setup() {
    const m = ctx.model, f = m.floors[ctx.floorIndex];
    const xs = f.rooms.flatMap((r) => [r.x0, r.x1]), ys = f.rooms.flatMap((r) => [r.y0, r.y1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = Math.max(x1 - x0, y1 - y0), pad = Math.max(2.5, 0.16 * span);
    const nb = (m.house.neighbours || []).filter((n) => n.height > f.ffl + 1.2);
    for (const n of m.house.neighbours || []) { x0 = Math.min(x0, Math.max(n.x0, x0 - 2 * pad)); x1 = Math.max(x1, Math.min(n.x1, x1 + 2 * pad)); y0 = Math.min(y0, Math.max(n.y0, y0 - 2 * pad)); y1 = Math.max(y1, Math.min(n.y1, y1 + 2 * pad)); }
    geo = { f, nb, all: m.house.neighbours || [], box: [x0 - pad, y0 - pad, x1 + pad, y1 + pad], zones: m.zones };
    // fans per zone with their plan fields
    geo.fanZones = new Map();
    for (const fan of ctx.fans) {
      const z = m.zones[fan.zone]; if (!z || z.floor !== ctx.floorIndex) continue;
      if (!geo.fanZones.has(fan.zone)) geo.fanZones.set(fan.zone, []);
      geo.fanZones.get(fan.zone).push(fan);
    }
    geo.fanFields = new Map([...geo.fanZones].map(([zi, fans]) => {
      const r = m.zones[zi].room;
      return [zi, fanField({ x0: r.nx0, y0: r.ny0, x1: r.nx1, y1: r.ny1 }, fans.map((q) => ({ x: q.x, y: q.y, d: q.d || 1.2, q: q.q || 2.4, speed: q.speed, blade: Math.max(2.3, f.ceil - 0.35) })), { ceiling: f.ceil })];
    }));
    st.parts = []; st.img = null; st.imgKey = '';
    resize();
  }

  function resize() {
    for (const P of [A, Tm]) {
      const box = P.cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const [bx0, by0, bx1, by1] = geo.box, aspect = (by1 - by0) / (bx1 - bx0);
      const w = Math.max(200, box.width), hh = Math.min(Math.max(160, w * aspect), 620);
      P.cv.width = Math.round(w * dpr); P.cv.height = Math.round(hh * dpr); P.cv.style.height = `${hh}px`;
      P.trail.width = P.cv.width; P.trail.height = P.cv.height;
      const s = Math.min(P.cv.width / (bx1 - bx0), P.cv.height / (by1 - by0));
      P.s = s; P.ox = (P.cv.width - s * (bx1 - bx0)) / 2 - bx0 * s; P.oy = (P.cv.height + s * (by1 - by0)) / 2 + by0 * s; P.dpr = dpr;
    }
  }
  const X = (P, x) => P.ox + x * P.s, Y = (P, y) => P.oy - y * P.s;
  const toWorld = (P, px, py) => [(px - P.ox) / P.s, (P.oy - py) / P.s];

  // ---------------------------------------------------------------- fields
  function hourField(k) { return ctx.fieldFor ? ctx.fieldFor(Math.max(0, Math.min(24, k))) : null; }
  const fieldAt = (F, x, y) => {
    const fx = (x - F.xmin) / F.dx + F.pad - 0.5, fy = (y - F.ymin) / F.dx + F.pad - 0.5, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= F.nx - 1 || j >= F.ny - 1) return null;
    const tx = fx - i, ty = fy - j, c = i * F.ny + j, n = F.ny;
    const b = (a) => (1 - tx) * ((1 - ty) * a[c] + ty * a[c + 1]) + tx * ((1 - ty) * a[c + n] + ty * a[c + n + 1]);
    return [b(F.ux), b(F.uy)];
  };
  /** Per-frame flow context: the two hourly wind fields around t, the wind at this floor, the fans that run. */
  function frameCtx(t) {
    const k = Math.min(23, Math.floor(t)), R = ctx.result, f = geo.f, wf = windFactor(f.ffl + 1.5, ctx.terrain);
    const hr = R.hours[k];
    return { k, w: t - k, F0: hourField(k), F1: hourField(k + 1), U0: hr ? hr.U10 * wf : 0, U1: R.hours[k + 1] ? R.hours[k + 1].U10 * wf : (hr ? hr.U10 * wf : 0),
      fans: [...geo.fanFields].filter(([zi]) => hr && hr.fanOn[zi]).map(([zi, ff]) => [ctx.model.zones[zi].room, ff]) };
  }
  /** Velocity (m/s) at a plan point: blended wind field scaled to this floor + fans that run. */
  function velocity(x, y, fc) {
    let ux = 0, uy = 0, have = false;
    const a = fc.F0 && fieldAt(fc.F0, x, y), b = fc.F1 && fieldAt(fc.F1, x, y);
    if (a) { const m = b ? 1 - fc.w : 1; ux += a[0] * fc.U0 * m; uy += a[1] * fc.U0 * m; have = true; }
    if (b) { const m = a ? fc.w : 1; ux += b[0] * fc.U1 * m; uy += b[1] * fc.U1 * m; have = true; }
    for (const [r, ff] of fc.fans) {
      if (x < r.nx0 || x > r.nx1 || y < r.ny0 || y > r.ny1) continue;
      const v = ff.sample(x, y); ux += v.ux; uy += v.uy; have = true;
    }
    return have ? [ux, uy] : null;
  }

  // ---------------------------------------------------------------- drawing
  function drawStatic(P, g, { dim = false } = {}) {
    const f = geo.f;
    g.fillStyle = dim ? 'rgba(120,120,120,0.55)' : '#9ca3af';
    for (const n of geo.all) {
      const tall = n.height > f.ffl + 1.2;
      g.fillStyle = tall ? 'rgba(107,114,128,0.85)' : 'rgba(156,163,175,0.35)';
      g.fillRect(X(P, n.x0), Y(P, n.y1), (n.x1 - n.x0) * P.s, (n.y1 - n.y0) * P.s);
      g.fillStyle = tall ? '#e5e7eb' : '#6b7280'; g.font = `${11 * P.dpr}px Inconsolata, monospace`;
      g.fillText(`${(n.height).toFixed(0)} m${tall ? '' : ' (below)'}`, X(P, n.x0) + 4 * P.dpr, Y(P, n.y1) + 13 * P.dpr);
    }
    for (const w of f.walls) {
      if (w.open) continue;
      const t = Math.max(w.thick, 0.12);
      g.fillStyle = w.railing ? '#6b7280' : '#111827';
      if (w.orient === 'V') g.fillRect(X(P, w.coord - t / 2), Y(P, w.s1), t * P.s, (w.s1 - w.s0) * P.s);
      else g.fillRect(X(P, w.s0), Y(P, w.coord + t / 2), (w.s1 - w.s0) * P.s, t * P.s);
    }
    for (const c of f.columns) { g.fillStyle = '#111827'; g.fillRect(X(P, c.x - c.size / 2), Y(P, c.y + c.size / 2), c.size * P.s, c.size * P.s); }
  }
  function drawOpenings(P, g, hr) {
    for (const o of geo.f.opens) {
      if (o.kind === 'nowall' || o.kind === 'railing') continue;
      const w = o.wallObj, t = Math.max(w.thick, 0.12) + 0.04, open = hr ? hr.open[o.link] > 0 : false;
      g.fillStyle = o.kind === 'window' ? (open ? '#22d3ee' : '#1e40af') : o.kind === 'open' ? '#f9fafb' : (open ? '#f9fafb' : '#92400e');
      const a = o.at - o.width / 2;
      if (w.orient === 'V') g.fillRect(X(P, w.coord - t / 2), Y(P, a + o.width), t * P.s, o.width * P.s);
      else g.fillRect(X(P, a), Y(P, w.coord + t / 2), o.width * P.s, t * P.s);
    }
  }
  function north(P, g) {
    const rot = (ctx.model.rotation || 0) * Math.PI / 180, cx = P.cv.width - 26 * P.dpr, cy = 30 * P.dpr, L = 15 * P.dpr;
    const dx = -Math.sin(rot), dy = -Math.cos(rot);
    g.strokeStyle = '#111827'; g.fillStyle = '#111827'; g.lineWidth = 2 * P.dpr;
    g.beginPath(); g.moveTo(cx - dx * L, cy - dy * L); g.lineTo(cx + dx * L, cy + dy * L); g.stroke();
    g.beginPath(); g.arc(cx + dx * L, cy + dy * L, 3 * P.dpr, 0, 7); g.fill();
    g.font = `bold ${12 * P.dpr}px Inconsolata, monospace`; g.textAlign = 'center'; g.fillText('N', cx + dx * (L + 11 * P.dpr), cy + dy * (L + 11 * P.dpr) + 4 * P.dpr); g.textAlign = 'left';
  }

  function speedImage(t) {
    const k = Math.min(23, Math.floor(t)), F0 = hourField(k), F1 = hourField(k + 1);
    const F = F0 || F1; if (!F) return null;
    const key = `${k}|${Math.round((t - k) * 12)}|${!!F0}|${!!F1}`;
    if (st.imgKey === key && st.img) return st.img;
    const off = st.img ? st.img.canvas : document.createElement('canvas');
    off.width = F.nx; off.height = F.ny;
    const g = off.getContext('2d'), im = g.createImageData(F.nx, F.ny), R = ctx.result, f = geo.f;
    const U0 = R.hours[k].U10 * windFactor(f.ffl + 1.5, ctx.terrain), U1 = (R.hours[k + 1] || R.hours[k]).U10 * windFactor(f.ffl + 1.5, ctx.terrain), w = Math.round((t - k) * 12) / 12;
    const vmax = Math.max(1, ctx.vmax || 3);
    for (let i = 0; i < F.nx; i++) for (let j = 0; j < F.ny; j++) {
      const c = i * F.ny + j;
      let u = 0, v = 0;
      if (F0) { u += F0.ux[c] * U0 * (F1 ? 1 - w : 1); v += F0.uy[c] * U0 * (F1 ? 1 - w : 1); }
      if (F1) { u += F1.ux[c] * U1 * (F0 ? w : 1); v += F1.uy[c] * U1 * (F0 ? w : 1); }
      const sp = Math.sqrt(Math.hypot(u, v) / vmax), li = Math.min(255, Math.round(Math.min(1, sp) * 255)) * 3, p = ((F.ny - 1 - j) * F.nx + i) * 4;
      im.data[p] = LUT_SPEED[li]; im.data[p + 1] = LUT_SPEED[li + 1]; im.data[p + 2] = LUT_SPEED[li + 2]; im.data[p + 3] = (F0 || F1).mask[c] ? 0 : 255;
    }
    g.putImageData(im, 0, 0);
    st.img = { canvas: off, F }; st.imgKey = key;
    return st.img;
  }

  function drawAir(t) {
    const P = A, g = P.cv.getContext('2d'), hr = ctx.result.hours[Math.round(t)];
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, P.cv.width, P.cv.height);
    g.fillStyle = '#0b1020'; g.fillRect(0, 0, P.cv.width, P.cv.height);
    const img = speedImage(t);
    if (img) {
      const F = img.F, x0 = F.xmin + (0 - F.pad) * F.dx, y1 = F.ymin + (F.ny - F.pad) * F.dx;
      g.imageSmoothingEnabled = true;
      g.drawImage(img.canvas, X(P, x0), Y(P, y1), F.nx * F.dx * P.s, F.ny * F.dx * P.s);
    }
    // fan glow inside rooms
    for (const [zi, ff] of geo.fanFields) {
      if (!hr || !hr.fanOn[zi]) continue;
      for (const fan of geo.fanZones.get(zi)) {
        const rr = (fan.d || 1.2) * 1.2 * P.s, gr = g.createRadialGradient(X(P, fan.x), Y(P, fan.y), 0, X(P, fan.x), Y(P, fan.y), rr);
        gr.addColorStop(0, 'rgba(253,231,37,0.55)'); gr.addColorStop(1, 'rgba(253,231,37,0)'); g.fillStyle = gr;
        g.beginPath(); g.arc(X(P, fan.x), Y(P, fan.y), rr, 0, 7); g.fill();
      }
    }
    // particle trails
    const tg = P.trail.getContext('2d');
    tg.globalCompositeOperation = 'destination-out'; tg.fillStyle = 'rgba(0,0,0,0.12)'; tg.fillRect(0, 0, P.trail.width, P.trail.height);
    tg.globalCompositeOperation = 'source-over'; tg.strokeStyle = 'rgba(255,255,255,0.85)'; tg.lineWidth = 1.1 * P.dpr;
    const dtReal = st.lastT === null ? 0 : Math.min(0.05, (performance.now() - st.lastT) / 1000);
    st.lastT = performance.now();
    const [bx0, by0, bx1, by1] = geo.box, N = 900, fc = frameCtx(t);
    while (st.parts.length < N) st.parts.push(spawn(bx0, by0, bx1, by1));
    tg.beginPath();
    for (const q of st.parts) {
      const v = velocity(q.x, q.y, fc);
      if (!v || q.age > q.life) { Object.assign(q, spawn(bx0, by0, bx1, by1)); continue; }
      const nx = q.x + v[0] * dtReal * 1.6, ny = q.y + v[1] * dtReal * 1.6;
      if (Math.hypot(v[0], v[1]) > 0.04) { tg.moveTo(X(P, q.x), Y(P, q.y)); tg.lineTo(X(P, nx), Y(P, ny)); }
      q.x = nx; q.y = ny; q.age += dtReal;
      if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) q.age = q.life + 1;
    }
    tg.stroke();
    g.drawImage(P.trail, 0, 0);
    drawStatic(P, g); drawOpenings(P, g, hr);
    // fans (draggable when editing)
    for (const [, fans] of geo.fanZones) for (const fan of fans) {
      g.strokeStyle = ctx.editFans ? '#fde725' : 'rgba(255,255,255,0.8)'; g.lineWidth = (ctx.editFans ? 2 : 1.2) * P.dpr;
      g.beginPath(); g.arc(X(P, fan.x), Y(P, fan.y), (fan.d || 1.2) / 2 * P.s, 0, 7); g.stroke();
      const on = hr && hr.fanOn[fan.zone], ang = on ? performance.now() / 120 : 0.4;
      for (let k = 0; k < 3; k++) { const a = ang + k * 2.094; g.beginPath(); g.moveTo(X(P, fan.x), Y(P, fan.y)); g.lineTo(X(P, fan.x + Math.cos(a) * (fan.d || 1.2) * 0.45), Y(P, fan.y + Math.sin(a) * (fan.d || 1.2) * 0.45)); g.stroke(); }
    }
    // wind arrow (10 m wind) + text
    if (hr) {
      const rot = (ctx.model.rotation || 0), ph = ((hr.wd - rot) * Math.PI) / 180, cx = 34 * P.dpr, cy = 34 * P.dpr, L = 20 * P.dpr;
      const dx = -Math.sin(ph), dy = Math.cos(ph);     // canvas y down: plan +y is up
      g.strokeStyle = '#f87171'; g.fillStyle = '#f87171'; g.lineWidth = 3 * P.dpr;
      g.beginPath(); g.moveTo(cx - dx * L, cy - dy * L); g.lineTo(cx + dx * L, cy + dy * L); g.stroke();
      const ax = cx + dx * L, ay = cy + dy * L, nx = -dy, ny = dx;
      g.beginPath(); g.moveTo(ax + dx * 7 * P.dpr, ay + dy * 7 * P.dpr); g.lineTo(ax + nx * 6 * P.dpr, ay + ny * 6 * P.dpr); g.lineTo(ax - nx * 6 * P.dpr, ay - ny * 6 * P.dpr); g.fill();
    }
    if (!img) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = `${12 * P.dpr}px Inconsolata, monospace`; g.fillText(ctx.fieldMsg || 'Computing the wind picture for this hour…', 12 * P.dpr, P.cv.height - 12 * P.dpr); }
    north(P, g);
  }
  function spawn(bx0, by0, bx1, by1) { return { x: bx0 + Math.random() * (bx1 - bx0), y: by0 + Math.random() * (by1 - by0), age: 0, life: 1.5 + Math.random() * 3 }; }

  function drawTemp(t) {
    const P = Tm, g = P.cv.getContext('2d'), R = ctx.result, hr = R.hours[Math.round(t)], [lo, hi] = ctx.tRange;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, P.cv.width, P.cv.height);
    g.fillStyle = '#f8fafc'; g.fillRect(0, 0, P.cv.width, P.cv.height);
    const f = geo.f, series = ctx.colorBy === 'set' ? R.SET : R.Tair;
    for (const r of f.rooms) {
      if (r.court) { g.fillStyle = '#dcfce7'; g.fillRect(X(P, r.x0), Y(P, r.y1), (r.x1 - r.x0) * P.s, (r.y1 - r.y0) * P.s); continue; }
      const v = atFrame(series[r.zone], t, R.frameMin);
      g.fillStyle = lutColor(LUT_TEMP, (v - lo) / (hi - lo));
      g.fillRect(X(P, r.x0), Y(P, r.y1), (r.x1 - r.x0) * P.s, (r.y1 - r.y0) * P.s);
    }
    drawStatic(P, g); drawOpenings(P, g, hr);
    // flow arrows through openings (net, airflow network)
    if (hr) {
      g.lineWidth = 2 * P.dpr;
      for (const o of f.opens) {
        if (o.link === undefined || o.kind === 'nowall' || !(hr.open[o.link] > 0)) continue;
        const [qab, qba] = hr.q[o.link], net = qab - qba;          // > 0: from room a to the other side (or outside)
        if (Math.abs(net) < 0.02) continue;
        const w = o.wallObj, nrm = w.n, dir = (w.A === o.a ? 1 : -1) * Math.sign(net);   // the wall normal points from w.A to w.B
        const [cx, cy] = o.mid, L = Math.min(2.2, 0.6 + Math.sqrt(Math.abs(net)) * 1.6);
        const x0 = cx - nrm[0] * dir * L / 2, y0 = cy - nrm[1] * dir * L / 2, x1 = cx + nrm[0] * dir * L / 2, y1 = cy + nrm[1] * dir * L / 2;
        g.strokeStyle = o.b ? '#334155' : (net < 0 ? '#0369a1' : '#b91c1c'); g.fillStyle = g.strokeStyle;
        g.beginPath(); g.moveTo(X(P, x0), Y(P, y0)); g.lineTo(X(P, x1), Y(P, y1)); g.stroke();
        const ang = Math.atan2(-(y1 - y0), x1 - x0), ah = 6 * P.dpr;
        g.beginPath(); g.moveTo(X(P, x1), Y(P, y1)); g.lineTo(X(P, x1) - ah * Math.cos(ang - 0.5), Y(P, y1) - ah * Math.sin(ang - 0.5)); g.lineTo(X(P, x1) - ah * Math.cos(ang + 0.5), Y(P, y1) - ah * Math.sin(ang + 0.5)); g.fill();
      }
    }
    // labels
    g.textAlign = 'center';
    for (const r of f.rooms) {
      if (r.court) continue;
      const v = atFrame(series[r.zone], t, R.frameMin), w = (r.x1 - r.x0) * P.s, hh = (r.y1 - r.y0) * P.s;
      const cx = X(P, (r.x0 + r.x1) / 2), cy = Y(P, (r.y0 + r.y1) / 2), fs = Math.max(9, Math.min(13, w / 9 / P.dpr)) * P.dpr;
      g.fillStyle = '#0f172a'; g.font = `bold ${fs}px Inconsolata, monospace`;
      if (w > 34 * P.dpr && hh > 26 * P.dpr) { g.fillText(shortName(r.name), cx, cy - 2 * P.dpr); g.font = `${fs}px Inconsolata, monospace`; g.fillText(`${v.toFixed(1)}°`, cx, cy + fs); }
      else if (w > 22 * P.dpr) g.fillText(`${v.toFixed(0)}°`, cx, cy + 4 * P.dpr);
    }
    // stair well flows
    const m = ctx.model;
    m.stairs.forEach((s, k) => {
      if (!hr || !hr.stairs[k]) return;
      const here = m.zones[s.lower].floor === ctx.floorIndex ? 'up-from' : m.zones[s.upper].floor === ctx.floorIndex ? 'down-to' : null;
      if (!here) return;
      const v = hr.stairs[k], r = s.rect, net = v.up - v.down;
      g.font = `bold ${11 * P.dpr}px Inconsolata, monospace`; g.fillStyle = '#7c2d12';
      g.fillText(`${net >= 0 ? '↑' : '↓'} ${Math.abs(net).toFixed(2)} m³/s${v.exch > 0.005 ? ` ⇅${v.exch.toFixed(2)}` : ''}`, X(P, (r.x0 + r.x1) / 2), Y(P, r.y0) - 6 * P.dpr);
    });
    g.textAlign = 'left';
    for (const [, fans] of geo.fanZones) for (const fan of fans) {
      const on = hr && hr.fanOn[fan.zone];
      g.strokeStyle = on ? '#0f172a' : 'rgba(15,23,42,0.35)'; g.lineWidth = 1.2 * P.dpr;
      g.beginPath(); g.arc(X(P, fan.x), Y(P, fan.y), 5 * P.dpr, 0, 7); g.stroke();
      if (on) { g.beginPath(); g.moveTo(X(P, fan.x) - 4 * P.dpr, Y(P, fan.y)); g.lineTo(X(P, fan.x) + 4 * P.dpr, Y(P, fan.y)); g.moveTo(X(P, fan.x), Y(P, fan.y) - 4 * P.dpr); g.lineTo(X(P, fan.x), Y(P, fan.y) + 4 * P.dpr); g.stroke(); }
    }
    north(P, g);
  }
  const shortName = (n) => n.replace('Master Bedroom', 'Master').replace('Bedroom ', 'Bed ').replace('Staircase', 'Stair').replace('Stair Landing', 'Landing').replace(' (entry)', ' entry').replace('Puja Room', 'Puja');

  function legends() {
    clear(legA).append(h('span', { class: 'small' }, '0'), h('i', { style: { background: lutCss(VIRIDIS) } }), h('span', { class: 'small' }, `${(ctx.vmax || 3).toFixed(1)} m/s (√ scale)`),
      h('span', { class: 'small muted', style: { marginLeft: 'auto' } }, 'red arrow: 10 m wind · grey: neighbours (pale = lower than this floor)'));
    const [lo, hi] = ctx.tRange;
    clear(legT).append(h('span', { class: 'small' }, `${lo.toFixed(0)}°`), h('i', { style: { background: lutCss(RDYLBU) } }), h('span', { class: 'small' }, `${hi.toFixed(0)}°C`),
      h('span', { class: 'small muted', style: { marginLeft: 'auto' } }, `${ctx.colorBy === 'set' ? 'feels like (SET)' : 'air temperature'} · blue arrow in, red out`));
  }

  // fan dragging
  const onDown = (e) => {
    if (!ctx.editFans) return;
    const r = A.cv.getBoundingClientRect(), [x, y] = toWorld(A, (e.clientX - r.left) * A.dpr, (e.clientY - r.top) * A.dpr);
    let best = null, bd = 0.9;
    for (const [, fans] of geo.fanZones) for (const fan of fans) { const d = Math.hypot(fan.x - x, fan.y - y); if (d < bd) { bd = d; best = fan; } }
    if (best) { st.drag = best; A.cv.setPointerCapture && A.cv.setPointerCapture(e.pointerId); e.preventDefault(); }
  };
  const onMove = (e) => {
    if (!st.drag) return;
    const r = A.cv.getBoundingClientRect(), [x, y] = toWorld(A, (e.clientX - r.left) * A.dpr, (e.clientY - r.top) * A.dpr);
    const room = ctx.model.zones[st.drag.zone].room, m = 0.4;
    st.drag.x = Math.min(room.nx1 - m, Math.max(room.nx0 + m, x)); st.drag.y = Math.min(room.ny1 - m, Math.max(room.ny0 + m, y));
  };
  const onUp = () => { if (st.drag) { const f = st.drag; st.drag = null; setup(); if (ctx.onFanMove) ctx.onFanMove(f); } };
  A.cv.addEventListener('pointerdown', onDown); A.cv.addEventListener('pointermove', onMove); A.cv.addEventListener('pointerup', onUp);
  // react to width changes only (setting the canvas height must not feed back into the observer)
  let lastW = 0;
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (!geo || w === lastW) return;
    lastW = w; requestAnimationFrame(() => { resize(); st.img = null; });
  });
  ro.observe(wrap);

  setup(); legends();
  return {
    draw(t) { st.t = t; drawAir(t); drawTemp(t); },
    refresh(next = {}) { Object.assign(ctx, next); setup(); legends(); },
    legends,
    destroy() { ro.disconnect(); wrap.remove(); },
    canvases: [A.cv, Tm.cv],
  };
}
