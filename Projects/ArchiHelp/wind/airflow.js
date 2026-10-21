// ArchiHelp wind — multi-floor airflow network (wind + stack), after CONTAM / EnergyPlus AirflowNetwork.
//
// Zones are rooms (all floors). Every zone has one unknown: its pressure at its floor level; air density follows its
// temperature, so pressure falls with height inside each zone at its own rate (the stack effect). Links:
//   vertical openings (windows, doors, arches, missing walls, veranda railings, wall leakage, the stair-top vent) are cut
//   into horizontal strips; each strip carries an orifice flow in whichever direction its pressure difference says, so
//   one opening can breathe in at the bottom and out at the top (two-way flow, neutral plane);
//   horizontal openings (the stair well between floors) carry the net flow plus a buoyant exchange when the floor below
//   is warmer (Epstein 1988).
// Outdoor pressure on a facade = hydrostatic + Cp * 1/2 rho U(z)^2, with surface-averaged low-rise Cp (Swami & Chandra
// 1988, as EnergyPlus), U(z) from the 10 m reading with the terrain profile at the opening's own height, and a simple wake
// shelter behind taller neighbours. Mass balance per zone is solved by Newton iterations.
import { solveDense } from './lbm.js';

export const RHO_REF = 1.2, G = 9.81, P_ATM = 101325, R_AIR = 287.05;
export const rhoAt = (tC) => P_ATM / (R_AIR * (tC + 273.15));
const DP_LIN = 0.01;                        // Pa: below this an orifice is treated as linear (laminar), for a smooth Newton

/** Swami & Chandra (1988) surface-averaged wind pressure coefficient of a low-rise wall. inc = incidence (deg, 0 = windward). */
export function cpSwamiChandra(incDeg, sideRatio = 1, cp0 = 0.6) {
  const a = Math.abs(incDeg) * Math.PI / 180, g = Math.log(Math.max(sideRatio, 1e-3));
  const s = 1.248 - 0.703 * Math.sin(a / 2) - 1.175 * Math.sin(a) ** 2 + 0.131 * Math.sin(2 * a * g) ** 3 + 0.769 * Math.cos(a / 2) + 0.07 * g * g * Math.sin(a / 2) ** 2 + 0.717 * Math.cos(a / 2) ** 2;
  return cp0 * Math.log(Math.max(s, 1e-6));
}
/** Incidence of wind coming FROM `wd` (deg true) on a wall whose outward normal points to `az` (deg true): 0..180. */
export const incidence = (wd, az) => { const d = ((wd - az) % 360 + 540) % 360 - 180; return Math.abs(d); };

/** Orifice mass flow (kg/s) and its derivative for coefficient C = Cd * area (m2), pressure difference dp, upstream density. */
export function orifice(C, dp, rho) {
  const k = C * Math.sqrt(2 * rho), a = Math.abs(dp);
  if (a < DP_LIN) { const s = k / Math.sqrt(DP_LIN); return [s * dp, s]; }
  const m = k * Math.sqrt(a); return [dp > 0 ? m : -m, k / (2 * Math.sqrt(a))];
}

/**
 * Network structure. zones: [{ zref (m above ground) }]; links:
 *   { kind: 'v', a, b (zone or -1 = outdoor), zb, zt (m above ground), width, cd, cp (outdoor side), shelter }
 *   { kind: 'h', a (lower zone), b (upper zone or -1), z, area, cd }
 * Strip count per vertical link from its height.
 */
export function makeNetwork(zones, links) {
  for (const L of links) {
    if (L.kind !== 'v') continue;
    const h = Math.max(L.zt - L.zb, 1e-3), n = Math.max(2, Math.min(12, Math.ceil(h / 0.25)));
    L.strips = Array.from({ length: n }, (_, s) => L.zb + (s + 0.5) * h / n);
    L.dz = h / n;
  }
  return { zones, links, nZ: zones.length };
}

/**
 * Solve the zone pressures. env = { T: zone temps (C), Tout, U10, open: Float64Array per link (0 closed .. 1 open, its
 * area fraction), wind(z, link) -> m/s at that height, P (initial guess, updated) }.
 * Returns { P, m: per link net mass flow a->b (kg/s), q: per link [volume a->b, volume b->a] (m3/s), it, res }.
 */
export function solve(net, env, { tol = 1e-6, maxIt = 60 } = {}) {
  const { nZ, links, zones } = net, rhoO = rhoAt(env.Tout);
  const rho = env.T.map(rhoAt), P = env.P || new Float64Array(nZ);
  const pw = links.map((L) => (L.kind === 'v' && L.b < 0 ? (L.cp || 0) * 0.5 * rhoO * env.wind(0.5 * (L.zb + L.zt), L) ** 2 : 0));
  const pIn = (i, z) => P[i] - rho[i] * G * (z - zones[i].zref);
  const pOut = (z, k) => -rhoO * G * z + pw[k];
  let it = 0, res = Infinity;
  const R = new Float64Array(nZ), J = Array.from({ length: nZ }, () => new Float64Array(nZ));
  const accumulate = (withJ) => {
    R.fill(0); if (withJ) for (const row of J) row.fill(0);
    links.forEach((L, k) => {
      const f = env.open[k]; if (!(f > 0)) return;
      const a = L.a, b = L.b;
      if (L.kind === 'v') {
        const C = L.cd * L.width * L.dz * f;
        for (const z of L.strips) {
          const dp = pIn(a, z) - (b >= 0 ? pIn(b, z) : pOut(z, k));
          const [m, dm] = orifice(C, dp, dp > 0 ? rho[a] : (b >= 0 ? rho[b] : rhoO));
          R[a] -= m; if (b >= 0) R[b] += m;
          if (withJ) { J[a][a] -= dm; if (b >= 0) { J[a][b] += dm; J[b][a] += dm; J[b][b] -= dm; } }
        }
      } else {
        const dp = pIn(a, L.z) - (b >= 0 ? pIn(b, L.z) : pOut(L.z, k));
        const [m, dm] = orifice(L.cd * L.area * f, dp, dp > 0 ? rho[a] : (b >= 0 ? rho[b] : rhoO));
        R[a] -= m; if (b >= 0) R[b] += m;
        if (withJ) { J[a][a] -= dm; if (b >= 0) { J[a][b] += dm; J[b][a] += dm; J[b][b] -= dm; } }
      }
    });
    let mx = 0; for (let i = 0; i < nZ; i++) mx = Math.max(mx, Math.abs(R[i])); return mx;
  };
  for (it = 0; it < maxIt; it++) {
    res = accumulate(true);
    if (res < tol) break;
    // isolated zones (no open link at all) have an all-zero row: pin their pressure
    for (let i = 0; i < nZ; i++) if (Math.abs(J[i][i]) < 1e-12) { J[i][i] = -1e-6; }
    const d = solveDense(J, Array.from(R, (v) => -v));
    let step = 1; const mxd = Math.max(...Array.from(d, Math.abs));
    if (mxd > 50) step = 50 / mxd;                       // limit the pressure step (Pa) far from the solution
    for (let i = 0; i < nZ; i++) P[i] += 0.9 * step * d[i];
  }
  // flows
  const m = new Float64Array(links.length), q = links.map(() => [0, 0]);
  links.forEach((L, k) => {
    const f = env.open[k]; if (!(f > 0)) return;
    const a = L.a, b = L.b;
    const add = (C, z) => {
      const dp = pIn(a, z) - (b >= 0 ? pIn(b, z) : pOut(z, k)), up = dp > 0 ? rho[a] : (b >= 0 ? rho[b] : rhoO);
      const [mm] = orifice(C, dp, up);
      m[k] += mm; if (mm > 0) q[k][0] += mm / up; else q[k][1] += -mm / up;
    };
    if (L.kind === 'v') { const C = L.cd * L.width * L.dz * f; for (const z of L.strips) add(C, z); }
    else add(L.cd * L.area * f, L.z);
  });
  return { P, m, q, it, res };
}

/** Buoyant exchange (m3/s, each way) through a horizontal opening when the space below is warmer (Epstein 1988). */
export function epsteinExchange(area, tLow, tUp) {
  if (!(tLow > tUp)) return 0;
  const D = Math.sqrt(4 * area / Math.PI), gp = G * (rhoAt(tUp) - rhoAt(tLow)) / rhoAt(0.5 * (tLow + tUp));
  return 0.055 * Math.sqrt(Math.max(gp, 0) * D ** 5);
}

/** Wake shelter of an opening behind taller neighbours (cavity ~3 H downstream, Hosker 1984): factor on wind speed. */
export function shelterFactor(x, y, z, wdPlanDeg, neighbours) {
  if (!neighbours || !neighbours.length) return 1;
  const a = wdPlanDeg * Math.PI / 180, dx = Math.sin(a), dy = Math.cos(a);      // towards where the wind comes from
  let s = 1;
  for (const nb of neighbours) {
    if (!(nb.height > z)) continue;
    const t = rayBox2(x, y, dx, dy, nb);
    if (t === null) continue;
    const L = 3 * nb.height;
    if (t < L) s = Math.min(s, Math.max(0.3, t / L));
  }
  return s;
}
/** Distance along a plan ray to an axis-aligned box (null = no hit). */
export function rayBox2(x, y, dx, dy, b) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[x, dx, b.x0, b.x1], [y, dy, b.y0, b.y1]]) {
    if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return null; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null;
  }
  return t0;
}
/** Is the sun blocked from point (x, y, z) by a neighbour box (with height)? sun direction in plan coordinates. */
export function sunBlocked(x, y, z, alt, azPlanDeg, neighbours) {
  if (!neighbours || !neighbours.length || alt <= 0) return false;
  const a = azPlanDeg * Math.PI / 180, ca = Math.cos(alt * Math.PI / 180), dx = Math.sin(a) * ca, dy = Math.cos(a) * ca, dz = Math.sin(alt * Math.PI / 180);
  for (const b of neighbours) {
    const t = rayBox2(x, y, dx, dy, b);
    if (t === null) continue;
    if (z + dz * t < b.height) return true;
  }
  return false;
}
