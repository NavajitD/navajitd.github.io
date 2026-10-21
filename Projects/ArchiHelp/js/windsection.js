// ArchiHelp — Wind circulation: cut-away section of the whole house at a moment of the day.
// Every modelled floor at its true height above ground (plinth, slabs, roof, stair-top room), rooms coloured by
// temperature, flow through the openings in the walls the cut crosses (two-way when the stack effect splits it), air
// through the stair well between floors, ceiling fans, roof heat, the sun and the wind profile with height.
import { lutColor, LUT_TEMP, atFrame } from './windview.js';
import { windFactor } from '../wind/model.js';

const FONT = 'Inconsolata, monospace';

/** Default cut: through the middle of the stair (else the house), along the longer side of the plan. */
export function defaultCut(model) {
  const all = model.floors.flatMap((f) => f.rooms), xs = all.flatMap((r) => [r.x0, r.x1]), ys = all.flatMap((r) => [r.y0, r.y1]);
  const ew = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const st = all.find((r) => r.type === 'stair');
  const c = st ? [(st.nx0 + st.nx1) / 2, (st.ny0 + st.ny1) / 2] : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return ew ? { axis: 'EW', at: c[1] } : { axis: 'NS', at: c[0] };
}
/** Range of the cut position (m) for an axis. */
export function cutRange(model, axis) {
  const all = model.floors.flatMap((f) => f.rooms), v = all.flatMap((r) => (axis === 'EW' ? [r.y0, r.y1] : [r.x0, r.x1]));
  return [Math.min(...v), Math.max(...v)];
}

export function mountSection(root, ctx) {
  const cv = document.createElement('canvas'); cv.className = 'ws-c';
  root.append(cv);
  const st = { geo: null };
  const along = (axis) => (axis === 'EW' ? ['x0', 'x1', 'y0', 'y1', 'nx0', 'nx1', 'V', 0] : ['y0', 'y1', 'x0', 'x1', 'ny0', 'ny1', 'H', 1]);

  function layout() {
    const m = ctx.model, { axis, at } = ctx.cut, [a0, a1, c0, c1, n0, n1] = along(axis);
    const floors = m.floors.map((f) => ({ f, rooms: f.rooms.filter((r) => r[c0] - 1e-6 <= at && at <= r[c1] + 1e-6) }));
    const ss = m.floors.flatMap((f) => f.rooms.flatMap((r) => [r[a0], r[a1]]));
    let s0 = Math.min(...ss), s1 = Math.max(...ss);
    const span = s1 - s0, top = m.floors[m.floors.length - 1], zTop = top.ffl + top.storey + (m.mumty ? 2.8 : 1.2) + 2.0;
    const nb = (m.house.neighbours || []).map((n) => ({ n, s0: axis === 'EW' ? n.x0 : n.y0, s1: axis === 'EW' ? n.x1 : n.y1, cut: axis === 'EW' ? n.y0 <= at && at <= n.y1 : n.x0 <= at && at <= n.x1 }));
    const margin = Math.max(4.5, 0.28 * span);
    const lo = s0 - margin, hi = s1 + margin;
    const box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(280, box.width), zMin = -1.2, zMax = Math.max(zTop, ...nb.filter((x) => x.s1 > lo && x.s0 < hi).map((x) => x.n.height + 1));
    const scale = Math.min(W / (hi - lo), 520 / (zMax - zMin));
    const Hh = Math.max(220, (zMax - zMin) * scale);
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); cv.style.height = `${Hh}px`;
    const k = scale * dpr, ox = (cv.width - (hi - lo) * k) / 2 - lo * k;
    st.geo = { floors, lo, hi, s0, s1, zMin, zMax, k, ox, oy: cv.height + zMin * k, dpr, nb, axis, at };
  }
  const SX = (s) => st.geo.ox + s * st.geo.k, SZ = (z) => st.geo.oy - z * st.geo.k;

  function arrow(g, x0, z0, x1, z1, color, width, dash) {
    const X0 = SX(x0), Y0 = SZ(z0), X1 = SX(x1), Y1 = SZ(z1), d = st.geo.dpr;
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width * d;
    if (dash) { g.setLineDash([5 * d, 4 * d]); g.lineDashOffset = -(performance.now() / 40) % (9 * d); }
    g.beginPath(); g.moveTo(X0, Y0); g.lineTo(X1, Y1); g.stroke(); g.setLineDash([]);
    const a = Math.atan2(Y1 - Y0, X1 - X0), ah = (5 + width * 1.5) * d;
    g.beginPath(); g.moveTo(X1, Y1); g.lineTo(X1 - ah * Math.cos(a - 0.45), Y1 - ah * Math.sin(a - 0.45)); g.lineTo(X1 - ah * Math.cos(a + 0.45), Y1 - ah * Math.sin(a + 0.45)); g.closePath(); g.fill();
  }

  function draw(t) {
    if (!st.geo) layout();
    const G = st.geo, m = ctx.model, R = ctx.result, g = cv.getContext('2d'), d = G.dpr;
    const k = Math.min(24, Math.max(0, Math.round(t))), hr = R.hours[k];
    const [lo, hi] = ctx.tRange, series = ctx.colorBy === 'set' ? R.SET : R.Tair;
    const colorOf = (zone) => lutColor(LUT_TEMP, (atFrame(series[zone], t, R.frameMin) - lo) / (hi - lo));
    const [, , , , n0, n1, wallOrient, sIdx] = along(G.axis);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // sky by sun altitude
    const alt = hr ? hr.alt : 0, day = Math.max(0, Math.min(1, (alt + 6) / 12));
    const sky = g.createLinearGradient(0, 0, 0, SZ(0));
    sky.addColorStop(0, mix('#0f172a', '#93c5fd', day)); sky.addColorStop(1, mix('#1e293b', '#eff6ff', day));
    g.fillStyle = sky; g.fillRect(0, 0, cv.width, cv.height);
    const lit = day > 0.45;                       // text drawn on the sky: dark by day, light at night
    const INK = lit ? '#0f172a' : '#e2e8f0', SOFT = lit ? '#475569' : '#a5b4c8', ARROW = lit ? 'rgba(15,23,42,0.75)' : 'rgba(226,232,240,0.85)';
    // sun
    if (hr && alt > 0) {
      const azp = (hr.az - (m.rotation || 0)) * Math.PI / 180, comp = G.axis === 'EW' ? Math.sin(azp) : Math.cos(azp);
      const sx = comp >= 0 ? cv.width - 46 * d : 46 * d, sz = Math.max(30 * d, SZ(0) - Math.sin(alt * Math.PI / 180) * (SZ(0) - 40 * d));
      g.fillStyle = 'rgba(250,204,21,0.95)'; g.beginPath(); g.arc(sx, sz, 13 * d, 0, 7); g.fill();
      g.fillStyle = '#713f12'; g.font = `${11 * d}px ${FONT}`; g.textAlign = comp >= 0 ? 'right' : 'left';
      g.fillText(`sun ${alt.toFixed(0)}° up`, comp >= 0 ? sx - 18 * d : sx + 18 * d, sz + 4 * d); g.textAlign = 'left';
    }
    // neighbours (behind first, then cut)
    for (const x of G.nb.filter((q) => !q.cut)) { g.fillStyle = 'rgba(100,116,139,0.22)'; g.fillRect(SX(x.s0), SZ(x.n.height), (x.s1 - x.s0) * G.k, x.n.height * G.k); }
    for (const x of G.nb.filter((q) => q.cut)) { g.fillStyle = 'rgba(71,85,105,0.85)'; g.fillRect(SX(x.s0), SZ(x.n.height), (x.s1 - x.s0) * G.k, x.n.height * G.k); }
    // ground
    g.fillStyle = '#d6d3d1'; g.fillRect(0, SZ(0), cv.width, cv.height - SZ(0));
    g.strokeStyle = '#57534e'; g.lineWidth = 1.5 * d; g.beginPath(); g.moveTo(0, SZ(0)); g.lineTo(cv.width, SZ(0)); g.stroke();
    // floors
    const lowest = G.floors[0];
    for (const { f, rooms } of G.floors) {
      if (!rooms.length) continue;
      const fs0 = Math.min(...rooms.map((r) => r[G.axis === 'EW' ? 'x0' : 'y0'])), fs1 = Math.max(...rooms.map((r) => r[G.axis === 'EW' ? 'x1' : 'y1']));
      // slab or plinth under
      if (f === lowest.f && f.level === 0) { g.fillStyle = '#a8a29e'; g.fillRect(SX(fs0), SZ(f.ffl), (fs1 - fs0) * G.k, f.ffl * G.k); }
      else { g.fillStyle = '#9ca3af'; g.fillRect(SX(fs0), SZ(f.ffl), (fs1 - fs0) * G.k, f.slab * G.k); }
      if (f === lowest.f && f.level > 0) {           // unmodelled floors below: grey block
        g.fillStyle = 'rgba(148,163,184,0.35)'; g.fillRect(SX(fs0), SZ(f.ffl - f.slab), (fs1 - fs0) * G.k, (f.ffl - f.slab) * G.k);
        g.fillStyle = '#475569'; g.font = `${11 * d}px ${FONT}`; g.fillText('floors below (not modelled)', SX(fs0) + 6 * d, SZ((f.ffl - f.slab) / 2));
      }
      // rooms
      for (const r of rooms) {
        const a = r[n0], b = r[n1];
        if (r.court) { g.fillStyle = 'rgba(134,239,172,0.35)'; g.fillRect(SX(r[G.axis === 'EW' ? 'x0' : 'y0']), SZ(f.ffl + f.ceil), (r[G.axis === 'EW' ? 'x1' : 'y1'] - r[G.axis === 'EW' ? 'x0' : 'y0']) * G.k, f.ceil * G.k); continue; }
        g.fillStyle = colorOf(r.zone); g.fillRect(SX(a), SZ(f.ffl + f.ceil), (b - a) * G.k, f.ceil * G.k);
      }
      // ceiling slab / roof
      const isTop = f === G.floors[G.floors.length - 1].f, roofZ = f.ffl + f.ceil;
      if (isTop && (m.house.above || 'roof') === 'roof') {
        const v = atFrame(R.roofSlab, t, R.frameMin), vo = atFrame(R.roofT, t, R.frameMin);
        const gr = g.createLinearGradient(0, SZ(f.ffl + f.storey), 0, SZ(roofZ));
        gr.addColorStop(0, lutColor(LUT_TEMP, (vo - lo) / (hi - lo))); gr.addColorStop(1, lutColor(LUT_TEMP, (v - lo) / (hi - lo)));
        g.fillStyle = gr; g.fillRect(SX(fs0), SZ(f.ffl + f.storey), (fs1 - fs0) * G.k, (f.storey - f.ceil) * G.k);
        g.strokeStyle = '#1f2937'; g.lineWidth = 1 * d; g.strokeRect(SX(fs0), SZ(f.ffl + f.storey), (fs1 - fs0) * G.k, (f.storey - f.ceil) * G.k);
        g.fillStyle = '#374151'; const pz = f.ffl + f.storey;
        g.fillRect(SX(fs0), SZ(pz + 1.0), 0.15 * G.k, 1.0 * G.k); g.fillRect(SX(fs1 - 0.15), SZ(pz + 1.0), 0.15 * G.k, 1.0 * G.k);
        if (vo > atFrame(R.Tout, t, R.frameMin) + 6) {            // hot roof: shimmer
          g.strokeStyle = 'rgba(220,38,38,0.55)'; g.lineWidth = 1.3 * d;
          for (let x = fs0 + 1; x < fs1 - 0.5; x += 2.2) { g.beginPath(); for (let j = 0; j <= 8; j++) { const zz = pz + 0.2 + j * 0.09, xx = x + 0.12 * Math.sin(j * 1.4 + performance.now() / 300); j ? g.lineTo(SX(xx), SZ(zz)) : g.moveTo(SX(xx), SZ(zz)); } g.stroke(); }
        }
        g.fillStyle = lit ? '#7f1d1d' : '#fecaca'; g.font = `${11 * d}px ${FONT}`;
        g.fillText(`roof: outer ${vo.toFixed(0)}°C (sol-air) · slab ${v.toFixed(1)}°C`, SX(fs0) + 4 * d, SZ(pz + 1.2));
      } else {
        g.fillStyle = '#9ca3af'; g.fillRect(SX(fs0), SZ(f.ffl + f.storey), (fs1 - fs0) * G.k, (f.storey - f.ceil) * G.k);
        if (isTop) { g.fillStyle = 'rgba(148,163,184,0.35)'; g.fillRect(SX(fs0), SZ(f.ffl + f.storey + 2.6), (fs1 - fs0) * G.k, 2.6 * G.k); g.fillStyle = '#475569'; g.font = `${11 * d}px ${FONT}`; g.fillText('floor above (not modelled)', SX(fs0) + 6 * d, SZ(f.ffl + f.storey + 1.3)); }
      }
      // walls crossed by the cut, with their openings (shown in the cut)
      for (const w of f.walls) {
        if (w.orient !== wallOrient || w.open || !(w.s0 - 1e-6 <= G.at && G.at <= w.s1 + 1e-6)) continue;
        const t2 = Math.max(w.thick, 0.12) / 2, h = w.railing ? 0.9 : f.ceil;
        g.fillStyle = '#111827'; g.fillRect(SX(w.coord - t2), SZ(f.ffl + h), 2 * t2 * G.k, h * G.k);
        for (const o of f.opens.filter((q) => q.wall === w.id && q.kind !== 'railing' && q.kind !== 'nowall')) {
          const open = hr && hr.open[o.link] > 0, zb = o.zb, zt = Math.min(o.zt, f.ffl + f.ceil);
          g.fillStyle = open ? 'rgba(255,255,255,0.0)' : (o.kind === 'window' ? 'rgba(30,64,175,0.9)' : 'rgba(146,64,14,0.9)');
          g.clearRect(SX(w.coord - t2), SZ(zt), 2 * t2 * G.k, (zt - zb) * G.k);
          g.fillStyle = colorOrSky(o, f);
          g.fillRect(SX(w.coord - t2), SZ(zt), 2 * t2 * G.k, (zt - zb) * G.k);
          if (!open) { g.fillStyle = o.kind === 'window' ? '#1e40af' : '#92400e'; g.fillRect(SX(w.coord - 0.03), SZ(zt), 0.06 * G.k, (zt - zb) * G.k); }
          if (!hr || !open) continue;
          // two-way flow: a->b and b->a (warmer side leaves at the top)
          const [qab, qba] = hr.q[o.link], sgn = (w.A === o.a ? 1 : -1) * w.n[sIdx];
          const Ta = atFrame(R.Tair[zoneOf(o.a)], t, R.frameMin), Tb = o.b ? atFrame(R.Tair[zoneOf(o.b)], t, R.frameMin) : atFrame(R.Tout, t, R.frameMin);
          const both = qab > 0.004 && qba > 0.004, mid = (zb + zt) / 2;
          const put = (q, dir, z, from) => {
            if (q < 0.004) return;
            const L = Math.min(2.4, 0.5 + Math.sqrt(q) * 1.8), color = !o.b ? (from === 'out' ? '#0284c7' : '#dc2626') : '#334155';
            arrow(g, w.coord - dir * L / 2, z, w.coord + dir * L / 2, z, color, 1.6 + Math.min(2.5, q * 4), true);
          };
          const zA = both ? (Ta > Tb ? mid + (zt - zb) / 4 : mid - (zt - zb) / 4) : mid, zB = both ? (Ta > Tb ? mid - (zt - zb) / 4 : mid + (zt - zb) / 4) : mid;
          put(qab, sgn, zA, 'in'); put(qba, -sgn, zB, o.b ? 'in' : 'out');
        }
      }
      // fans in the cut rooms (projected)
      for (const fan of ctx.fans) {
        const z = m.zones[fan.zone]; if (!z || z.floor !== f.index || !rooms.some((r) => r.zone === fan.zone)) continue;
        const sPos = G.axis === 'EW' ? fan.x : fan.y, zb = f.ffl + f.ceil - 0.4, on = hr && hr.fanOn[fan.zone], D = fan.d || 1.2;
        g.strokeStyle = '#111827'; g.lineWidth = 1.4 * d;
        g.beginPath(); g.moveTo(SX(sPos), SZ(f.ffl + f.ceil)); g.lineTo(SX(sPos), SZ(zb)); g.stroke();
        const sw = on ? Math.abs(Math.cos(performance.now() / 90)) : 1;
        g.lineWidth = 2.4 * d; g.beginPath(); g.moveTo(SX(sPos - D / 2 * sw), SZ(zb)); g.lineTo(SX(sPos + D / 2 * sw), SZ(zb)); g.stroke();
        if (on) {
          const v = atFrame(R.vFan[fan.zone], t, R.frameMin), a = Math.min(0.45, 0.12 + v * 0.22);
          const cone = g.createLinearGradient(0, SZ(zb), 0, SZ(f.ffl));
          cone.addColorStop(0, `rgba(255,255,255,${a})`); cone.addColorStop(1, 'rgba(255,255,255,0.03)');
          g.fillStyle = cone; g.beginPath(); g.moveTo(SX(sPos - D / 2), SZ(zb)); g.lineTo(SX(sPos + D / 2), SZ(zb)); g.lineTo(SX(sPos + D * 0.9), SZ(f.ffl)); g.lineTo(SX(sPos - D * 0.9), SZ(f.ffl)); g.closePath(); g.fill();
          g.fillStyle = '#0f172a'; g.font = `${10 * d}px ${FONT}`; g.textAlign = 'center'; g.fillText(`${v.toFixed(1)} m/s`, SX(sPos), SZ(f.ffl + 0.25)); g.textAlign = 'left';
        }
      }
      // labels
      g.textAlign = 'center';
      for (const r of rooms) {
        if (r.court) continue;
        const a = r[n0], b = r[n1], wpx = (b - a) * G.k, v = atFrame(series[r.zone], t, R.frameMin);
        if (wpx < 26 * d) continue;
        const cx = SX((a + b) / 2), fsz = Math.max(9, Math.min(12.5, wpx / 8 / d)) * d;
        g.fillStyle = '#0f172a'; g.font = `bold ${fsz}px ${FONT}`;
        if (wpx > 60 * d) g.fillText(short(r.name), cx, SZ(f.ffl + f.ceil * 0.62));
        g.font = `${fsz}px ${FONT}`; g.fillText(`${v.toFixed(1)}°`, cx, SZ(f.ffl + f.ceil * 0.62) + fsz * 1.2);
      }
      g.textAlign = 'left';
      // level mark
      const cur = f.index === ctx.floorIndex;
      g.fillStyle = cur ? (lit ? '#1d4ed8' : '#93c5fd') : INK; g.font = `${cur ? 'bold ' : ''}${11 * d}px ${FONT}`;
      const lx = SX(G.s1) + 10 * d;
      g.beginPath(); g.moveTo(lx, SZ(f.ffl)); g.lineTo(lx + 8 * d, SZ(f.ffl) - 7 * d); g.lineTo(lx - 8 * d, SZ(f.ffl) - 7 * d); g.closePath(); g.fill();
      g.fillText(`+${f.ffl.toFixed(2)} m  ${f.name}`, lx + 12 * d, SZ(f.ffl) - 1 * d);
      g.font = `${10 * d}px ${FONT}`; g.fillStyle = SOFT; g.fillText(`ceiling ${f.ceil.toFixed(2)} m`, lx + 12 * d, SZ(f.ffl) + 12 * d);
    }
    // stair wells: openings in the slab + flows
    m.stairs.forEach((s, i) => {
      const lowF = m.floors[m.zones[s.lower].floor], [p0, p1, c0, c1] = G.axis === 'EW' ? [s.rect.x0, s.rect.x1, s.rect.y0, s.rect.y1] : [s.rect.y0, s.rect.y1, s.rect.x0, s.rect.x1];
      const cut = c0 - 0.3 <= G.at && G.at <= c1 + 0.3;
      const z0 = lowF.ffl + lowF.ceil, z1 = s.z;
      if (cut) { g.fillStyle = colorOf(s.upper); g.fillRect(SX(p0), SZ(z1), (p1 - p0) * G.k, (z1 - z0) * G.k); }
      // stair flight (schematic)
      if (cut) {
        g.strokeStyle = 'rgba(15,23,42,0.55)'; g.lineWidth = 1.2 * d; g.beginPath();
        const n = 12; for (let j = 0; j <= n; j++) { const x = p0 + 0.2 + (p1 - p0 - 0.4) * j / n, z = lowF.ffl + (z1 - lowF.ffl) * j / n; if (j) g.lineTo(SX(x), SZ(z)); else g.moveTo(SX(x), SZ(z)); g.lineTo(SX(x), SZ(z + (z1 - lowF.ffl) / n)); }
        g.stroke();
      }
      const v = hr && hr.stairs[i]; if (!v) return;
      const cx = (p0 + p1) / 2, Lu = Math.min(2.2, 0.4 + Math.sqrt(v.up) * 1.8), Ld = Math.min(2.2, 0.4 + Math.sqrt(v.down) * 1.8);
      if (v.up > 0.004) arrow(g, cx - 0.35, z1 - Lu / 2, cx - 0.35, z1 + Lu / 2, '#ea580c', 2 + Math.min(3, v.up * 3), true);
      if (v.down > 0.004) arrow(g, cx + 0.35, z1 + Ld / 2, cx + 0.35, z1 - Ld / 2, '#0284c7', 2 + Math.min(3, v.down * 3), true);
      g.fillStyle = lit ? '#7c2d12' : '#fed7aa'; g.font = `bold ${10.5 * d}px ${FONT}`;
      const txt = `stair: ${v.up >= v.down ? '↑' : '↓'} ${Math.abs(v.up - v.down).toFixed(2)} m³/s${v.exch > 0.005 ? ` (+ buoyant ⇅ ${v.exch.toFixed(2)})` : ''}${cut ? '' : ' — well not in this cut'}`;
      g.fillText(txt, SX(p1) + 6 * d, SZ(z1) - 4 * d);
    });
    // stair-top room (mumty)
    if (m.mumty && (m.house.above || 'roof') === 'roof') {
      const top = m.floors[m.floors.length - 1], sr = m.zones[m.mumty.zone].room, [p0, p1, c0, c1] = G.axis === 'EW' ? [sr.nx0, sr.nx1, sr.ny0, sr.ny1] : [sr.ny0, sr.ny1, sr.nx0, sr.nx1];
      if (c0 - 0.3 <= G.at && G.at <= c1 + 0.3) {
        const zb = top.ffl + top.storey, zt = zb + 2.6;
        g.fillStyle = colorOf(m.mumty.zone); g.fillRect(SX(p0), SZ(zt), (p1 - p0) * G.k, 2.6 * G.k);
        g.strokeStyle = '#111827'; g.lineWidth = 2 * d; g.strokeRect(SX(p0), SZ(zt), (p1 - p0) * G.k, 2.6 * G.k);
        const open = hr && hr.open[m.mumty.link] > 0, q = hr ? hr.q[m.mumty.link] : [0, 0];
        g.fillStyle = open ? '#e0f2fe' : '#1e40af'; g.fillRect(SX(p1 - 0.08), SZ(m.mumty.zt), 0.16 * G.k, (m.mumty.zt - m.mumty.zb) * G.k);
        if (open && q[0] > 0.004) arrow(g, p1, (m.mumty.zb + m.mumty.zt) / 2, p1 + Math.min(2.2, 0.5 + Math.sqrt(q[0]) * 1.8), (m.mumty.zb + m.mumty.zt) / 2 + 0.4, '#dc2626', 2.2, true);
        if (open && q[1] > 0.004) arrow(g, p1 + Math.min(2.2, 0.5 + Math.sqrt(q[1]) * 1.8), (m.mumty.zb + m.mumty.zt) / 2, p1, (m.mumty.zb + m.mumty.zt) / 2, '#0284c7', 2.2, true);
        g.fillStyle = SOFT; g.font = `${10 * d}px ${FONT}`; g.fillText(`stair-top vent ${open ? 'open' : 'closed'}`, SX(p0), SZ(zt) - 4 * d);
      }
    }
    // wind profile on the upwind side
    if (hr) {
      const ph = (hr.wd - (m.rotation || 0)) * Math.PI / 180, toward = G.axis === 'EW' ? -Math.sin(ph) : -Math.cos(ph);
      const fromLeft = toward >= 0, comp = Math.abs(toward), x = fromLeft ? G.lo + 0.4 : G.hi - 0.4, dir = fromLeft ? 1 : -1;
      const zs = [1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5].filter((z) => z < G.zMax - 0.5);
      const umax = Math.max(0.5, ...zs.map((z) => hr.U10 * windFactor(z, ctx.terrain)));
      for (const z of zs) {
        const u = hr.U10 * windFactor(z, ctx.terrain), L = Math.max(0.25, (G.hi - G.lo) * 0.09 * u / umax);
        if (comp > 0.25) arrow(g, x, z, x + dir * L * comp, z, ARROW, 1.5, false);
        else { g.strokeStyle = ARROW; g.lineWidth = 1.4 * d; g.beginPath(); g.arc(SX(x + dir * 0.4), SZ(z), 4 * d, 0, 7); g.stroke(); }
        g.fillStyle = INK; g.font = `${9.5 * d}px ${FONT}`; g.textAlign = fromLeft ? 'left' : 'right';
        g.fillText(`${u.toFixed(1)}`, SX(x + dir * (L * Math.max(comp, 0.3) + 0.2)), SZ(z) + 3.5 * d);
      }
      g.textAlign = fromLeft ? 'left' : 'right'; g.font = `bold ${10.5 * d}px ${FONT}`; g.fillStyle = INK;
      g.fillText(`wind m/s by height${comp <= 0.25 ? ' (mostly across this cut)' : ''}`, fromLeft ? 8 * d : cv.width - 8 * d, 16 * d);
      g.textAlign = 'left';
    }
    // compass labels
    g.fillStyle = '#334155'; g.font = `bold ${11 * d}px ${FONT}`;
    const [Lft, Rgt] = G.axis === 'EW' ? ['W', 'E'] : ['S', 'N'];
    g.fillText(Lft, 8 * d, SZ(0) + 16 * d); g.textAlign = 'right'; g.fillText(Rgt, cv.width - 8 * d, SZ(0) + 16 * d); g.textAlign = 'left';
    g.fillStyle = '#57534e'; g.font = `${10 * d}px ${FONT}`; g.fillText('ground ±0.00', SX(G.s0), SZ(0) + 13 * d);
  }
  const zoneOf = (id) => ctx.model.zones.findIndex((z) => z.id === id);
  function colorOrSky() { return 'rgba(224,242,254,0.9)'; }
  const short = (n) => n.replace('Master Bedroom', 'Master').replace('Bedroom ', 'Bed ').replace('Staircase', 'Stair').replace('Stair Landing', 'Landing').replace(' (entry)', ' entry').replace('Puja Room', 'Puja');

  let lastW = 0;
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastW) return;
    lastW = w; requestAnimationFrame(() => { st.geo = null; });
  });
  ro.observe(root);
  return { draw, refresh(next = {}) { Object.assign(ctx, next); st.geo = null; }, destroy() { ro.disconnect(); cv.remove(); }, canvas: cv };
}

function mix(a, b, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)], A = p(a), B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
