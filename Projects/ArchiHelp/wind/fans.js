// ArchiHelp wind — ceiling fans: occupied-zone air speed and heat.
// Room statistics follow the dimensionless models of Raftery et al. (2019), "Ceiling fans: Predicting indoor air speeds
// based on full scale laboratory measurements", Building and Environment 155, Table 1 (downward fans):
//   lowest   so = 0.047 + 0.900 dr - 0.017 cd + 0.110 do + 0.024 seated
//   average  so = 0.250 + 0.990 dr - 0.060 cd + 0.110 do + 0.024 seated
//   highest  so = 1.300 - 0.180 hd - 0.100 seated
// so = air speed / fan air speed SF (airflow / swept area); dr = D / room size served per fan; cd = ceiling / D;
// do = D / 1.7 m; hd = blade height / D. The plan map is a smooth radial profile (peak under the blades, a level floor
// further out) scaled so its area-weighted average is the model's average.
export const FAN_TYPES = {
  standard: { label: 'Standard 1200 mm (70 W)', d: 1.2, q: 2.4, watts: 70 },
  bldc: { label: 'BLDC 1200 mm (32 W)', d: 1.2, q: 2.3, watts: 32 },
  large: { label: 'Large 1400 mm (80 W)', d: 1.4, q: 3.2, watts: 80 },
  small: { label: 'Small 900 mm (55 W)', d: 0.9, q: 1.3, watts: 55 },
};
export const SPEEDS = { high: 1.0, medium: 0.65, low: 0.4 };
const POWER = { high: 1.0, medium: 0.55, low: 0.3 };

/** Room statistics (m/s) for one fan serving `area` m2 (several fans: area per fan). */
export function fanStats({ d = 1.2, q = 2.4, speed = 'high', blade = 2.6, ceiling = 3.0, area = 16, seated = true }) {
  const sf = q * (SPEEDS[speed] ?? 1) / (Math.PI * d * d / 4);
  const R = Math.sqrt(Math.max(area, 1)), dr = d / R, cd = ceiling / d, dO = d / 1.7, hd = blade / d, s = seated ? 1 : 0;
  const low = Math.max(0.03, 0.047 + 0.900 * dr - 0.017 * cd + 0.110 * dO + 0.024 * s) * sf;
  const avg = Math.max(0.05, 0.250 + 0.990 * dr - 0.060 * cd + 0.110 * dO + 0.024 * s) * sf;
  const high = Math.max(avg, (1.300 - 0.180 * hd - 0.100 * s) * sf);
  return { sf, low: Math.min(low, avg), avg, high, b: 0.75 * d };
}

/** Heat from a running fan (W). */
export const fanWatts = (type = 'standard', speed = 'high') => (FAN_TYPES[type] || FAN_TYPES.standard).watts * (POWER[speed] ?? 1);

/**
 * Plan map of fan air speed for a room: returns sample(x, y) -> { s (m/s), ux, uy } (outward radial direction) and the room
 * statistics. room = { x0, y0, x1, y1 } (net, metres); fans = [{ x, y, d, q, speed, blade }].
 */
export function fanField(room, fans, { ceiling = 3.0, seated = true } = {}) {
  if (!fans.length) return { sample: () => ({ s: 0, ux: 0, uy: 0 }), avg: 0, stats: [] };
  const A = (room.x1 - room.x0) * (room.y1 - room.y0), per = A / fans.length;
  const stats = fans.map((f) => fanStats({ d: f.d, q: f.q, speed: f.speed, blade: f.blade, ceiling, area: per, seated }));
  // level away from the fan so the profile's area average over the fan's share equals the model average
  const shape = fans.map((f, k) => {
    const st = stats[k], n = 24; let I = 0, cnt = 0;
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) {
      const x = room.x0 + (a + 0.5) * (room.x1 - room.x0) / n, y = room.y0 + (c + 0.5) * (room.y1 - room.y0) / n;
      if (nearest(fans, x, y) !== k) continue;
      I += Math.exp(-(((x - f.x) ** 2 + (y - f.y) ** 2) / (st.b * st.b))); cnt++;
    }
    I = cnt ? I / cnt : 0.5;
    const out = Math.max(st.low * 0.9, Math.min(st.avg, (st.avg - st.high * I) / Math.max(1 - I, 1e-6)));
    return { ...st, out };
  });
  const sample = (x, y) => {
    const k = nearest(fans, x, y), f = fans[k], sh = shape[k], dx = x - f.x, dy = y - f.y, r = Math.hypot(dx, dy);
    const s = sh.out + (sh.high - sh.out) * Math.exp(-(r * r) / (sh.b * sh.b));
    const w = r > 1e-6 ? 1 / r : 0;           // under the blades the flow is downwards: no plan direction
    const radial = Math.min(1, r / sh.b);
    return { s, ux: dx * w * s * radial, uy: dy * w * s * radial };
  };
  const avg = shape.reduce((a, sh) => a + sh.avg, 0) / shape.length;
  return { sample, avg, stats: shape };
}
function nearest(fans, x, y) { let k = 0, d = Infinity; fans.forEach((f, i) => { const e = (x - f.x) ** 2 + (y - f.y) ** 2; if (e < d) { d = e; k = i; } }); return k; }

/** Default fan positions in a room (net rect, metres): 1 at the centre, 2-3 spread along the long axis. */
export function defaultFanPositions(r, n) {
  const W = r.x1 - r.x0, H = r.y1 - r.y0, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, out = [];
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    out.push(W >= H ? [r.x0 + t * W, cy] : [cx, r.y0 + t * H]);
  }
  return out;
}
