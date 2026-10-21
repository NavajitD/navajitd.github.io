// Vaastu Planner design engine — scalable layout generator.
//
// Replaces the notebook's per-skeleton CP-SAT model with a search that runs anywhere (browser Web Workers, Node):
//   1. Skeletons: the envelope is cut into three bands along its LONG axis (rooms | circulation spine | rooms), for every
//      band depth (0.5 ft steps) x spine width (3'-6" .. 4'-6") — 33..161 skeletons instead of the notebook's 18.
//   2. Candidates per skeleton: every legal slot for every space type on a 6" lattice (1' for big rooms), filtered by the
//      hard rules that are local to a space: NBC sizes, the 32-pada sector rule, the Brahmasthan limit, stair geometry.
//      Stacked slots put a small room on the exterior side of a band and a circulation space between it and the spine
//      (puja + lobby, stair + landing, kitchen + dining ...), so deep plots get legal puja / stair / bath positions.
//   3. Beam search per skeleton (two passes: plain slots, then with stacks): partial tilings grow left to right at the
//      lowest band frontier; equivalent states merge (dynamic programming); access rules (every room opens onto
//      circulation, master has an attached bath, stair arrival faces circulation) prune as soon as they are decided; the
//      beam keeps a few width variants of each room sequence so one layout family cannot take it over.
//   4. Every layout is re-checked by the independent checker; one per topology (room sequence per band) is kept, the best
//      are polished by moving walls in 3"-1' steps, and the results are ranked by Vaastu score, advisories and circulation.
//   Relaxed mode (minFrac = 0, the notebook's min_frac) keeps layouts whose only hard misses are pada shares, flagged.
import { rect, rw, rh, rarea, overlapArea, pyG, fmt } from './geom.js';
import { CIRC, BEDS } from './config.js';
import { region, netRect, validateTiles } from './plan.js';
import { FastSectors, sectorRule } from './sectors.js';
import { designStair, stairSizeOk } from './stair.js';
import { coreRect, buildStructure, structuralGrid } from './structure.js';
import { prepareConfig, analysePlan } from './index.js';
import { buildPlan } from './plan.js';
import { evaluate } from './checker.js';

const SPANS = { S: [0], C: [1], N: [2], SC: [0, 1], CN: [1, 2], SCN: [0, 1, 2] };
const VNB = { S: 1, N: 1, SC: 2, CN: 0, SCN: -1, C: -1 };      // vertical neighbour band (for access through a long wall)
const NEED = { master: 3.0, bedroom: 3.0, kitchen: 3.0, puja: 2.5, veranda: 3.0, bath: 2.5, lobby: 3.0, hall: 3.0, dining: 3.0 };
const RATED_ORDER = { stair: 0, kitchen: 1, bath: 2, puja: 3, master: 4, bedroom: 5 };
const COARSE = new Set(['court', 'hall', 'dining', 'bedroom', 'master', 'veranda']);   // 1-ft length steps (notebook)
// Stacked slots in one outer band: [outer room (exterior side), inner circulation space (spine side)]. The outer room opens
// onto the inner one, so small rooms (puja, bath, stair with its landing, kitchen off the dining) fit bands deeper than they
// could fill on their own -- the usual answer on deep plots (30x40, 30x50, 40x60), where the notebook's 3-row model has
// no legal puja position at all.
const STACKS = [['puja', 'lobby'], ['bath', 'lobby'], ['stair', 'lobby'], ['kitchen', 'dining'], ['puja', 'dining'], ['puja', 'hall']];

/** Program counts as space types (master = first bedroom). */
export function programCounts(cfg) {
  const P = cfg.program || {};
  return { master: P.bedroom ? 1 : 0, bedroom: Math.max(0, (P.bedroom || 0) - 1), bath: P.bath || 0, kitchen: P.kitchen || 0, stair: P.stair || 0,
    hall: P.hall || 0, dining: P.dining || 0, puja: P.puja || 0, veranda: P.veranda || 0 };
}

function spanTypes(span, types) {
  if (span === 'C') return types.filter((t) => t === 'passage' || t === 'court');
  if (span === 'S' || span === 'N') return types.filter((t) => t !== 'passage');
  return types.filter((t) => !['passage', 'stair', 'bath', 'puja', 'lobby'].includes(t));
}

function sizeOk(cfg, t, net, st, span) {
  if (rw(net) <= 0.05 || rh(net) <= 0.05) return false;
  if (t === 'stair') return stairSizeOk(net, st);
  const sp = cfg.room_specs[t];
  if (t === 'passage') { const d = span === 'C' ? rh(net) : rw(net); return sp.wmin - 1e-6 <= d && d <= sp.wmax + 1e-6; }
  const s = Math.min(rw(net), rh(net)), l = Math.max(rw(net), rh(net)), a = rarea(net);
  return s >= sp.wmin - 1e-6 && sp.amin - 1e-6 <= a && a <= sp.amax + 1e-6 && l / s <= sp.asp + 1e-9;
}

/** Search context for one configuration (shared by all skeletons). */
export function makeContext(cfgIn, opts = {}) {
  const cfg = prepareConfig(cfgIn), R = region(cfg), st = designStair(cfg), fs = new FastSectors(cfg), core = coreRect(cfg);
  const swap = cfg.ns_ft > cfg.ew_ft + 1e-9;                     // bands always run along the long axis
  const U0 = swap ? R.y0 : R.x0, U1 = swap ? R.y1 : R.x1, V0 = swap ? R.x0 : R.y0, V1 = swap ? R.x1 : R.y1;
  const toReal = (u0, v0, u1, v1) => (swap ? rect(v0, u0, v1, u1) : rect(u0, v0, u1, v1));
  const step = opts.step ?? 0.5, pos = [];
  for (let k = 0; U0 + k * step < U1 - 1e-6; k++) pos.push(+(U0 + k * step).toFixed(6));
  pos.push(+U1.toFixed(6));
  const counts = programCounts(cfg);
  const maxLobby = opts.maxLobby ?? 2;
  const types = Object.keys(counts).filter((t) => counts[t] > 0).concat(['passage', 'lobby'], cfg.max_courtyards > 0 ? ['court'] : []);
  return { cfg, R, st, fs, core, swap, U0, U1, V0, V1, toReal, pos, counts, types, maxLobby, struct: buildStructure(cfg), minFrac: opts.minFrac ?? null,
    nRated: Object.entries(counts).reduce((a, [t, n]) => a + (sectorRule(cfg, t) ? n : 0), 0) };
}

/** (band-0 depth, spine clear width) pairs; band 2 takes the rest (>= 7 ft clear). */
export function skeletons(ctx, { depths = null, spines = [3.5, 3.75, 4.0, 4.5] } = {}) {
  const cfg = ctx.cfg, out = [], span = ctx.V1 - ctx.V0;
  const ds = depths || []; if (!depths) for (let s = 7.5; s <= span - 7.5; s += 0.5) ds.push(s);
  for (const s of ds) for (const c of spines) {
    const L1 = ctx.V0 + s, L2 = L1 + c + cfg.t_int;
    if (ctx.V1 - L2 - (cfg.t_int / 2 + cfg.t_ext / 2) < 7.0 - 1e-9) continue;
    if (s - (cfg.t_ext / 2 + cfg.t_int / 2) < 6.9) continue;
    out.push({ s, c, levels: [ctx.V0, L1, L2, ctx.V1] });
  }
  // middle depths first: they are the likeliest to fit a stair and generous rooms on both sides
  const mid = (span - 4) / 2;
  return out.sort((a, b) => Math.abs(a.s - mid) - Math.abs(b.s - mid) || a.c - b.c);
}

/** Candidate spaces for one skeleton: cand[span][i] = [{t, span, i, j, tile, net, score, frac}] sorted by score. */
function candidates(ctx, sk, stacks = true) {
  const { cfg, pos, fs, core, st } = ctx, n = pos.length - 1, need = ctx.minFrac ?? cfg.sector_min_frac, bmax = cfg.brahmasthan_max_overlap;
  const cand = {}, bestFrom = {};
  for (const t of ctx.types) bestFrom[t] = new Float64Array(n + 2).fill(-Infinity);
  for (const [span, bands] of Object.entries(SPANS)) {
    const v0 = sk.levels[bands[0]], v1 = sk.levels[bands[bands.length - 1] + 1];
    cand[span] = Array.from({ length: n + 1 }, () => []);
    for (const t of spanTypes(span, ctx.types)) {
      const rule = sectorRule(cfg, t);
      for (let i = 0; i < n; i++) for (let j = i + 1; j <= n; j++) {
        if (COARSE.has(t) && (j - i) % 2 && j !== n && i !== 0) continue;
        const tile = ctx.toReal(pos[i], v0, pos[j], v1), net = netRect(tile, ctx.R, cfg);
        const len = pos[j] - pos[i];
        if (t === 'passage' && len < 3.0 - 1e-6) continue;
        if (!sizeOk(cfg, t, net, st, span)) {
          if (t !== 'passage' && t !== 'stair' && cfg.room_specs[t] && rarea(net) > cfg.room_specs[t].amax) break;
          if (t === 'stair' && rarea(net) > st.block_w * st.block_l + 80) break;
          continue;
        }
        const [f, sc] = fs.fracScore(t, net);
        if (rule && rule.hard && f < need - 1e-9) continue;
        if (cfg.brahmasthan_rule && t in bmax && overlapArea(net, core) > bmax[t]) continue;
        cand[span][i].push({ t, span, bands, i, j, tile, net, score: sc, frac: f, area: rarea(net), len });
        if (sc !== null && sc > bestFrom[t][i]) bestFrom[t][i] = sc;
      }
    }
    if (stacks && (span === 'S' || span === 'N')) stackCandidates(ctx, sk, span, bands, cand[span], bestFrom, need);
    for (const L of cand[span]) L.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.j - b.j);
  }
  for (const t of ctx.types) { const B = bestFrom[t]; for (let i = n - 1; i >= 0; i--) B[i] = Math.max(B[i], B[i + 1]); }
  // canStart[b][i]: space types with a legal candidate starting at position i in a span that includes band b
  const canStart = [0, 1, 2].map(() => Array.from({ length: n + 1 }, () => new Set()));
  for (const [span, bands] of Object.entries(SPANS)) for (let i = 0; i <= n; i++) for (const c of cand[span][i]) for (const b of bands) { canStart[b][i].add(c.t); if (c.t2) canStart[b][i].add(c.t2); }
  // BF[t][span][i]: best score (0 for unrated types) of a type-t candidate in `span` starting at index >= i (-Inf: none)
  const BF = {}, minOuter = {}, maxOuter = {};
  for (const t of ctx.types) { BF[t] = {}; minOuter[t] = Infinity; maxOuter[t] = 0; }
  for (const [span, bands] of Object.entries(SPANS)) {
    const outer = bands.filter((b) => b !== 1).length;
    for (const t of ctx.types) BF[t][span] = new Float64Array(n + 2).fill(-Infinity);
    for (let i = 0; i <= n; i++) for (const c of cand[span][i]) {
      const v = (c.t2 ? c.scoreA : c.score) ?? 0, A = BF[c.t][span];
      if (v > A[i]) A[i] = v;
      if (c.t2) { const v2 = c.scoreB ?? 0, A2 = BF[c.t2][span]; if (v2 > A2[i]) A2[i] = v2; minOuter[c.t2] = 0; }
      const o = c.len * outer;
      if (o < minOuter[c.t]) minOuter[c.t] = o;
      if (o > maxOuter[c.t]) maxOuter[c.t] = o;
    }
    for (const t of ctx.types) { const A = BF[t][span]; for (let i = n - 1; i >= 0; i--) if (A[i + 1] > A[i]) A[i] = A[i + 1]; }
  }
  return { cand, bestFrom, n, BF, minOuter, maxOuter, canStart: canStart.map((B) => B.map((S) => [...S])) };
}

const isCirc = (t) => CIRC.has(t);

/** Stacked candidates (see STACKS) for one outer band of a skeleton, appended to cand[i]. */
function stackCandidates(ctx, sk, span, bands, cand, bestFrom, need) {
  const { cfg, pos, fs, core, st } = ctx, n = pos.length - 1, bmax = cfg.brahmasthan_max_overlap;
  const b = bands[0], vOut = b === 0 ? sk.levels[0] : sk.levels[3], vIn = b === 0 ? sk.levels[1] : sk.levels[2], D = Math.abs(vIn - vOut), dir = b === 0 ? 1 : -1;
  const tile = (i, j, va, vb) => ctx.toReal(pos[i], Math.min(va, vb), pos[j], Math.max(va, vb));
  for (const [A, Bt] of STACKS) {
    if (!(ctx.counts[A] > 0) || !ctx.types.includes(Bt)) continue;
    const spA = cfg.room_specs[A], spB = cfg.room_specs[Bt], ruleA = sectorRule(cfg, A), ruleB = sectorRule(cfg, Bt);
    const dMinA = A === 'stair' ? Math.min(st.block_w, st.block_l) : spA.wmin, dMinB = spB.wmin;
    for (let d1 = Math.ceil((dMinA + cfg.t_int) * 2) / 2; d1 <= D - dMinB - cfg.t_int + 1e-9; d1 += 0.5) {
      const vMid = vOut + dir * d1;
      for (let i = 0; i < n; i++) for (let j = i + 1; j <= n; j++) {
        if (COARSE.has(A) && (j - i) % 2 && j !== n && i !== 0) continue;
        const tA = tile(i, j, vOut, vMid), nA = netRect(tA, ctx.R, cfg);
        if (!sizeOk(cfg, A, nA, st, span)) {
          if (A === 'stair' ? rarea(nA) > st.block_w * st.block_l + 80 : rarea(nA) > spA.amax) break;
          continue;
        }
        const tB = tile(i, j, vMid, vIn), nB = netRect(tB, ctx.R, cfg);
        if (!sizeOk(cfg, Bt, nB, st, span)) continue;
        const [fA, scA] = fs.fracScore(A, nA), [fB, scB] = fs.fracScore(Bt, nB);
        if ((ruleA && ruleA.hard && fA < need - 1e-9) || (ruleB && ruleB.hard && fB < need - 1e-9)) continue;
        if (cfg.brahmasthan_rule && ((A in bmax && overlapArea(nA, core) > bmax[A]) || (Bt in bmax && overlapArea(nB, core) > bmax[Bt]))) continue;
        cand[i].push({ t: A, t2: Bt, span, bands, i, j, tile: tA, net: nA, tile2: tB, net2: nB, score: (scA ?? 0) + (scB ?? 0), scoreA: scA, scoreB: scB,
          frac: fA, area: rarea(nA), area2: rarea(nB), len: pos[j] - pos[i] });
        if (scA !== null && scA > bestFrom[A][i]) bestFrom[A][i] = scA;
      }
    }
  }
}

/**
 * Search one skeleton. Calls onLayout(pieces, objective) for every complete layout that passes the search-time rules.
 * Returns stats. Budget: { nodes, ms, keep } (keep = how many best layouts the bound competes against).
 */
/**
 * Beam search over left-to-right tilings of one skeleton. States = partial tilings; children = one more space at the lowest
 * frontier. Equivalent states (same frontiers, remaining programme, neighbour types, open requirements) are merged keeping
 * the better one (dynamic programming); the beam keeps the `beam` best by optimistic total (score so far + best possible rest).
 * Calls onLayout(pieces, objective) for complete layouts that pass every search-time rule.
 */
export function searchSkeleton(ctx, sk, onLayout, budget = {}) {
  const { cfg } = ctx, CAND = candidates(ctx, sk, budget.stacks !== false), { cand, n, canStart, BF, minOuter, maxOuter } = CAND, pos = ctx.pos;
  if (budget.inspect) budget.inspect(CAND);
  const B = budget.beam ?? 300, deadline = Date.now() + (budget.ms ?? 4000), keep = budget.keep ?? 30, perSig = budget.perSig ?? 6, slack = budget.slack ?? 12;
  const minCourt = cfg.min_courtyards || 0;
  const required = Object.keys(ctx.counts).filter((t) => ctx.counts[t] > 0);
  const rated = new Set(required.filter((t) => sectorRule(cfg, t)));
  const optional = ['lobby', ...(cfg.max_courtyards > 0 ? ['court'] : [])];
  const spansOf = {};
  for (const t of ctx.types) spansOf[t] = Object.keys(SPANS).filter((sp) => BF[t][sp][0] > -Infinity);
  const stats = { nodes: 0, layouts: 0, prunedBound: 0, prunedFit: 0, prunedAccess: 0, merged: 0, steps: 0, timeout: false };
  const reqKinds = (t) => (t === 'bath' ? (u) => isCirc(u) || BEDS.has(u) : isCirc);
  const spineOk = cfg.room_specs.passage, spineMin = 3.0;
  const v1 = sk.levels[1], v2 = sk.levels[2];
  // spine passage pieces are created when the open passage closes (at the next spine-spanning space or the band end)
  function mkPassage(i, j) {
    const tile = ctx.toReal(pos[i], v1, pos[j], v2), net = netRect(tile, ctx.R, cfg);
    return { t: 'passage', span: 'C', bands: [1], i, j, tile, net, score: null, frac: 1, area: rarea(net), len: pos[j] - pos[i] };
  }
  // a spine passage piece must be at least the minimum passage width clear (wall faces), like the checker's size rule
  const passOk = (i, j) => { if (pos[j] - pos[i] < spineMin - 1e-6) return false; const net = netRect(ctx.toReal(pos[i], v1, pos[j], v2), ctx.R, cfg); return Math.max(rw(net), rh(net)) >= spineOk.wmin - 1e-6 || Math.min(rw(net), rh(net)) >= spineOk.wmin - 1e-6 && (ctx.swap ? rh(net) : rw(net)) >= spineOk.wmin - 1e-6; };

  // circulation in band 1 known for sure: placed pieces + the open passage up to the lowest outer frontier
  const certainOpenEnd = (s) => pos[Math.min(s.f[0], s.f[2])];
  const overlapKind = (s, b, x0, x1, kinds) => {
    let sum = 0;
    for (const q of s.pieces) if (q.bands.includes(b) && kinds(q.t) && q.x1 > x0 + 1e-9 && q.x0 < x1 - 1e-9) sum += Math.min(q.x1, x1) - Math.max(q.x0, x0);
    if (b === 1 && s.pass >= 0 && kinds('passage')) { const a = pos[s.pass], e = certainOpenEnd(s); if (e > x0 && a < x1) sum += Math.max(0, Math.min(e, x1) - Math.max(a, x0)); }
    return sum;
  };
  const startKinds = (s, b, i, kinds) => canStart[b][i].some((t) => kinds(t) && (t === 'passage' || s.rem[t] > 0));
  function oneReq(s, p, r) {
    const kinds = r.kinds;
    if (p.left.some((t) => t && kinds(t))) return 1;
    let possible = false;
    for (const b of p.bands) {
      const q = s.pieces.find((o) => o !== p && o.bands.includes(b) && Math.abs(o.x0 - p.x1) < 1e-9);
      if (q) { if (kinds(q.t)) return 1; }
      else if (b === 1 && s.pass >= 0 && pos[s.pass] >= p.x1 - 1e-9 && kinds('passage')) return 1;   // spine passage opened right after it
      else if (s.f[b] < n && startKinds(s, b, p.c.j, kinds)) possible = true;
    }
    if (r.vb >= 0) {
      const sum = overlapKind(s, r.vb, p.x0, p.x1, r.stairLobby ? isCirc : kinds);
      if (sum >= r.need - 1e-6) return 1;
      const fr = r.vb === 1 && s.pass >= 0 ? certainOpenEnd(s) : pos[s.f[r.vb]];
      const open1 = r.vb === 1 && (s.pass >= 0 || s.f[1] < n);
      if ((fr < p.x1 - 1e-9 || open1) && sum + (p.x1 - Math.max(p.x0, Math.min(fr, p.x1))) >= r.need - 1e-6) possible = true;
    }
    return possible ? 0 : -1;
  }
  function status(s, p) {
    let und = false;
    for (const r of p.reqs) { const v = oneReq(s, p, r); if (v === -1) return -1; if (v === 0) und = true; }
    return und ? 0 : 1;
  }
  function makeReqs(c) {
    const reqs = [], t = c.t, vb = VNB[c.span];
    if (c.t2) { if (c.t2 in NEED) reqs.push({ need: NEED[c.t2], kinds: reqKinds(c.t2), vb }); return reqs; }   // the outer room opens onto the inner space
    if (t === 'stair') {
      const wide = Math.max(rw(c.net), rh(c.net)) - ctx.st.block_l >= 2.5;
      reqs.push({ need: 3.0, kinds: isCirc, vb: wide ? vb : -1, stairLobby: wide });
    } else if (t in NEED && !(c.bands.includes(1) && isCirc(t))) reqs.push({ need: NEED[t], kinds: reqKinds(t), vb });
    if (t === 'master') reqs.push({ need: 2.5, kinds: (u) => u === 'bath', vb: vb === 1 ? -1 : vb });
    return reqs;
  }
  const front1 = (s) => (s.pass >= 0 ? s.pass : s.f[1]);
  function bound(s) {
    let b = s.obj;
    for (const t of required) {
      const k = s.rem[t];
      if (!(k > 0)) continue;
      let best = -Infinity;
      for (const sp of spansOf[t]) {
        let st = 0; for (const bb of SPANS[sp]) { const fb = bb === 1 ? front1(s) : s.f[bb]; if (fb > st) st = fb; }
        const v = BF[t][sp][st]; if (v > best) best = v;
      }
      if (best === -Infinity) return -Infinity;
      if (rated.has(t)) b += k * best;
    }
    return b;
  }
  function masterBathPossible(s) {
    if (!(s.rem.master > 0) || s.rem.bath > 0) return true;
    for (const q of s.pieces) if (q.t === 'bath') {
      for (const b of q.bands) if (s.f[b] === q.c.j && s.f[b] < n) return true;
      const ob = q.bands[0] === 0 ? 2 : 0, fr = pos[s.f[ob]];
      if (q.x1 - Math.max(q.x0, fr) >= 2.5 - 1e-6) return true;
    }
    return false;
  }
  function fits(s) {
    if (!masterBathPossible(s)) return false;
    const L = (ctx.U1 - pos[s.f[0]]) + (ctx.U1 - pos[s.f[2]]);
    let need = 0, cap = 0;
    for (const t of required) { const k = s.rem[t]; if (k > 0) { need += k * minOuter[t]; cap += k * maxOuter[t]; } }
    for (const t of optional) { const k = s.rem[t]; if (k > 0 && maxOuter[t]) cap += k * maxOuter[t]; }
    return need <= L + 1e-6 && cap >= L - 1e-6;
  }
  const OPEN = { t: 'open-passage' };
  function options(s) {
    const f = s.f, open = s.pass >= 0, f1 = open ? Infinity : f[1];
    const m = Math.min(f[0], f1, f[2]);
    if (m === Infinity || m === n) return [];
    const cAt = (i) => (open ? passOk(s.pass, i) : f[1] === i);
    let spans;
    if (f[0] === m) spans = ['S', ...(cAt(m) ? ['SC'] : []), ...(cAt(m) && f[2] === m ? ['SCN'] : [])];
    else if (f1 === m) spans = ['C', ...(f[2] === m ? ['CN'] : [])];
    else spans = ['N', ...(cAt(m) ? ['CN'] : [])];
    const out = [];
    for (const sp of spans) {
      if (sp === 'C') {
        if (s.cState !== 2 && s.lastT[1] !== 'passage') out.push(OPEN);
        for (const c of cand.C[m]) if (c.t === 'court' && s.rem.court > 0) out.push(c);
        continue;
      }
      for (const c of cand[sp][m]) {
        if (!(s.rem[c.t] > 0) || (c.t2 && !(s.rem[c.t2] > 0))) continue;
        if (c.bands.includes(1) && isCirc(c.t) && s.cState === 2) continue;
        out.push(c);
      }
    }
    return out;
  }
  const gainOf = (c) => (c.score ?? 0) - (c.t === 'passage' ? 0.2 * rarea(c.tile) : 0) - (c.t === 'lobby' ? 10 + 0.2 * rarea(c.tile) : 0) - (c.t2 === 'lobby' ? 10 + 0.2 * rarea(c.tile2) : 0);
  function addPiece(ns, s, c) {
    const p = { c, t: c.t, x0: pos[c.i], x1: pos[c.j], bands: c.bands, reqs: makeReqs(c), left: c.bands.map((b) => ns.lastT[b]) };
    ns.obj += gainOf(c); ns.pieces.push(p);
    for (const b of c.bands) { ns.f[b] = c.j; ns.lastT[b] = c.t; }
    if (c.bands.includes(1)) { if (isCirc(c.t)) ns.cState = 1; else if (ns.cState === 1) ns.cState = 2; }
    if (c.t !== 'passage') ns.rem[c.t] -= 1;
    if (c.t2) ns.rem[c.t2] -= 1;
    if (c.t === 'court') ns.courts += 1;
    return p;
  }
  function expand(s, c) {
    const ns = { f: s.f.slice(), rem: { ...s.rem }, cState: s.cState, courts: s.courts, obj: s.obj, pieces: s.pieces.slice(), lastT: s.lastT.slice(),
      masterA: s.masterA, bedA: s.bedA, open: null, pass: s.pass };
    const added = [];
    if (c === OPEN) { ns.pass = ns.f[1]; ns.cState = 1; }
    else {
      if (c.bands.includes(1) && ns.pass >= 0) {                 // close the open spine passage at this space
        if (!passOk(ns.pass, c.i)) return null;
        added.push(addPiece(ns, s, mkPassage(ns.pass, c.i))); ns.pass = -1;
      }
      if (c.t === 'master') { if (c.area <= s.bedA + 1e-9) return null; ns.masterA = c.area; }
      if (c.t === 'bedroom') { if (s.masterA && c.area >= s.masterA - 1e-9) return null; ns.bedA = Math.max(s.bedA, c.area); }
      added.push(addPiece(ns, s, c));
    }
    if (ns.f[0] === n && ns.f[2] === n && ns.pass >= 0) {        // both outer bands done: the spine passage runs to the end
      if (!passOk(ns.pass, n)) return null;
      added.push(addPiece(ns, s, mkPassage(ns.pass, n))); ns.pass = -1;
    }
    const open = [];
    for (const q of s.open.concat(added)) {
      const v = status(ns, q);
      if (v === -1) { stats.prunedAccess++; return null; }
      if (v === 0) open.push(q);
    }
    ns.open = open;
    return ns;
  }
  const keyOf = (s) => `${s.f.join(',')},${s.pass}|${s.cState}${s.courts}|${required.map((t) => s.rem[t]).join('')}${s.rem.lobby}|${s.lastT.join(',')}|` +
    `${Math.round(s.masterA)},${Math.round(s.bedA)}|${s.open.map((q) => `${q.t}${q.c.i}-${q.c.j}`).join(';')}`;
  const done = (s) => s.f[0] === n && s.f[1] === n && s.f[2] === n && s.pass < 0;
  const finalOk = (s) => s.cState > 0 && s.courts >= minCourt && required.every((t) => !(s.rem[t] > 0)) && s.open.length === 0;

  let beam = [{ f: [0, 0, 0], rem: { ...ctx.counts, lobby: ctx.maxLobby, court: cfg.max_courtyards || 0 }, cState: 0, courts: 0, obj: 0, pieces: [], lastT: [null, null, null], masterA: 0, bedA: 0, open: [], pass: -1 }];
  const finished = [];
  for (let step = 0; step < 80 && beam.length; step++) {
    stats.steps = step + 1;
    if (Date.now() > deadline) { stats.timeout = true; break; }
    const next = new Map();
    for (const s of beam) {
      if (done(s)) { if (finalOk(s)) finished.push(s); continue; }
      for (const c of options(s)) {
        if (budget.force && !budget.force(c, pos)) continue;
        stats.nodes++;
        const ns = expand(s, c);
        if (!ns) continue;
        const ub = bound(ns);
        if (ub === -Infinity) { stats.prunedBound++; continue; }
        if (!fits(ns)) { stats.prunedFit++; continue; }
        ns.ub = ub;
        const k = keyOf(ns), prev = next.get(k);
        if (!prev) next.set(k, ns);
        else { stats.merged++; if (ns.obj > prev.obj) next.set(k, ns); }
      }
    }
    // per topology (room sequence per band) keep up to perSig states spread over the frontier positions (width variants),
    // drawn from those within `slack` of the topology's best bound; then the best topologies fill the beam
    const groups = new Map();
    for (const x of next.values()) {
      const sig = [0, 1, 2].map((bb) => x.pieces.filter((q) => q.bands[0] === bb).map((q) => (q.c.t2 ? `${q.t}/${q.c.t2}` : q.t) + q.bands.length).join(',')).join('|') + (x.pass >= 0 ? '+' : '');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(x);
    }
    const picks = [];
    for (const G of groups.values()) {
      G.sort((p1, p2) => p2.ub - p1.ub || p2.obj - p1.obj);
      const top = G.filter((x) => x.ub >= G[0].ub - slack);
      if (top.length <= perSig) { picks.push(...top); continue; }
      top.sort((p1, p2) => (p1.f[0] + p1.f[1] + p1.f[2]) - (p2.f[0] + p2.f[1] + p2.f[2]) || p2.ub - p1.ub);
      const chosen = new Set([0, top.length - 1]);
      for (let k = 1; chosen.size < perSig && k < perSig; k++) chosen.add(Math.round(k * (top.length - 1) / (perSig - 1)));
      for (const k of chosen) picks.push(top[k]);
    }
    picks.sort((p1, p2) => p2.ub - p1.ub || p2.obj - p1.obj);
    beam = picks.slice(0, B);
    if (budget.trace) budget.trace(step, next.size, beam.slice(0, 2).map((x) => `${x.ub.toFixed(0)} f=${x.f.map((k) => pos[k].toFixed(1))}${x.pass >= 0 ? ' open@' + pos[x.pass].toFixed(1) : ''} ${x.pieces.map((q) => q.t + q.bands.join('')).join(',')}`));
  }
  finished.sort((a, b) => b.obj - a.obj);
  for (const s of finished.slice(0, keep)) { stats.layouts++; onLayout(s.pieces.map((p) => p.c), s.obj); }
  return stats;
}

/** Layout pieces -> plan document (real coordinates, notebook room names). */
export function piecesToDoc(ctx, stacked, meta = {}) {
  const cfg = ctx.cfg, label = (t) => (cfg.room_specs[t] || {}).label || t;
  const pieces = [];
  for (const c of stacked) { pieces.push(c); if (c.t2) pieces.push({ ...c, t: c.t2, t2: undefined, tile: c.tile2, net: c.net2 }); }
  const order = pieces.map((c, k) => [c, k]).sort((a, b) => (a[0].t !== 'master') - (b[0].t !== 'master') || (a[0].t < b[0].t ? -1 : a[0].t > b[0].t ? 1 : 0) || a[0].tile.x0 - b[0].tile.x0 || a[0].tile.y0 - b[0].tile.y0).map((x) => x[0]);
  const cnt = {}; for (const c of pieces) cnt[c.t] = (cnt[c.t] || 0) + 1;
  const seen = {}, rooms = [];
  for (const c of order) {
    const t = c.t; seen[t] = (seen[t] || 0) + 1;
    let nm;
    if (t === 'lobby') {
      const nearStair = pieces.some((o) => o.t === 'stair' && o.bands.join() === c.bands.join() && (Math.abs(o.tile.x1 - c.tile.x0) < 1e-6 || Math.abs(o.tile.x0 - c.tile.x1) < 1e-6 || Math.abs(o.tile.y1 - c.tile.y0) < 1e-6 || Math.abs(o.tile.y0 - c.tile.y1) < 1e-6));
      nm = nearStair ? 'Stair Landing' : (cnt.lobby > 1 ? `Lobby ${seen[t]}` : 'Lobby');
    } else if (t === 'bedroom') nm = `Bedroom ${seen[t] + 1}`;
    else if (cnt[t] > 1) nm = `${label(t)} ${seen[t]}`;
    else nm = label(t);
    rooms.push({ uid: rooms.length, rtype: t, name: nm, tile: { ...c.tile }, group: null });
  }
  return { id: meta.id ?? 0, source: meta.source || 'generated', label: meta.label || '', rooms, links: null, roadDoor: (cfg.floor_level || 0) === 0, windows: [], keepouts: [], furniture: {}, notes: [], meta: { skeleton: meta.skeleton } };
}

/** Topology signature: space types per band, left to right (widths ignored). */
export function topologyKey(ctx, pieces) {
  const by = [[], [], []];
  for (const c of pieces) by[c.bands[0]].push([ctx.pos[c.i], c.t + (c.t2 ? `/${c.t2}` : '') + (c.bands.length > 1 ? '+' + c.bands.length : '')]);
  return by.map((L) => L.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(',')).join(' | ');
}

// ---------------------------------------------------------------- scoring + polish
/** Composite quality used for ranking and polishing (higher is better). */
export function quality(plan) {
  const hard = plan.failed.length, soft = plan.checks.filter((c) => !c.hard && !c.ok).length;
  const circ = plan.rooms.filter((r) => CIRC.has(r.rtype) && r.rtype !== 'hall' && r.rtype !== 'dining').reduce((a, r) => a + r.area, 0);
  const carpet = plan.rooms.reduce((a, r) => a + r.area, 0), env = plan.cfg.ew_ft * plan.cfg.ns_ft;
  return { hard, soft, vaastu: plan.vaastu_score, circ, efficiency: carpet / env,
    score: plan.vaastu_score - 1000 * hard - 1.0 * soft - 0.03 * circ, sectorMisses: plan.failed.filter((c) => c.cat === 'Vaastu').length };
}

export function quickPlan(cfg, doc) { const p = buildPlan(cfg, doc); evaluate(p); return p; }

/** Wall segments that can be moved without breaking the tiling: [{axis:'x'|'y', at, rooms:[[uid, edge]...]}]. */
export function movableWalls(doc, R) {
  const out = [], rooms = doc.rooms, E = 1e-6;
  for (const axis of ['x', 'y']) {
    const lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1', plo = axis === 'x' ? 'y0' : 'x0', phi = axis === 'x' ? 'y1' : 'x1';
    const lines = new Set(rooms.map((r) => r.tile[hi]).filter((v) => v < (axis === 'x' ? R.x1 : R.y1) - E));
    for (const at of lines) {
      const left = rooms.filter((r) => Math.abs(r.tile[hi] - at) < E), right = rooms.filter((r) => Math.abs(r.tile[lo] - at) < E);
      // connected components along the line (by perpendicular overlap chains)
      const items = left.map((r) => ({ r, side: hi })).concat(right.map((r) => ({ r, side: lo })));
      const comp = [], used = new Set();
      for (let k = 0; k < items.length; k++) {
        if (used.has(k)) continue;
        const group = [k]; used.add(k);
        for (let g = 0; g < group.length; g++) for (let m = 0; m < items.length; m++) {
          if (used.has(m)) continue;
          const a = items[group[g]].r.tile, b = items[m].r.tile;
          if (Math.min(a[phi], b[phi]) - Math.max(a[plo], b[plo]) > E) { used.add(m); group.push(m); }
        }
        comp.push(group.map((q) => items[q]));
      }
      for (const g of comp) {
        const L = g.filter((q) => q.side === hi), Rr = g.filter((q) => q.side === lo);
        if (!L.length || !Rr.length) continue;
        const ext = (arr) => [Math.min(...arr.map((q) => q.r.tile[plo])), Math.max(...arr.map((q) => q.r.tile[phi]))];
        const [a0, a1] = ext(L), [b0, b1] = ext(Rr);
        if (Math.abs(a0 - b0) > E || Math.abs(a1 - b1) > E) continue;
        out.push({ axis, at, rooms: g.map((q) => [q.r.uid, q.side]) });
      }
    }
  }
  return out;
}

export function shiftWall(doc, wall, d) {
  const nd = { ...doc, rooms: doc.rooms.map((r) => ({ ...r, tile: { ...r.tile } })) };
  const by = new Map(nd.rooms.map((r) => [r.uid, r]));
  for (const [uid, side] of wall.rooms) by.get(uid).tile[side] += d;
  for (const r of nd.rooms) if (rw(r.tile) < 2.0 || rh(r.tile) < 2.0) return null;
  return nd;
}

/** Hill-climb wall positions (3" to 1' moves) on the composite quality; hard rules must keep passing. */
export function polish(cfgIn, doc, { evals = 400, steps = [1.0, 0.5, 0.25], deadline = Infinity } = {}) {
  const cfg = prepareConfig(cfgIn), R = region(cfg);
  let cur = doc, best = quality(quickPlan(cfg, cur)), used = 1, improved = true;
  while (improved && used < evals && Date.now() < deadline) {
    improved = false;
    for (const st of steps) {
      const walls = movableWalls(cur, R);
      let bestMove = null;
      for (const w of walls) for (const d of [st, -st]) {
        if (used >= evals) break;
        const nd = shiftWall(cur, w, d);
        if (!nd) continue;
        used++;
        const q = quality(quickPlan(cfg, nd));
        if (q.score > best.score + 1e-6 && (!bestMove || q.score > bestMove[1].score)) bestMove = [nd, q];
      }
      if (bestMove) { cur = bestMove[0]; best = bestMove[1]; improved = true; break; }
    }
  }
  return { doc: cur, quality: best, evals: used };
}

/** Layouts for one skeleton -> valid candidate documents (one per topology, best first). */
/** Which required spaces have no legal position in any skeleton (sizes + sector rule + Brahmasthan)? -> {type: skeletons with a position} */
export function diagnose(cfgIn, opts = {}) {
  const ctx = makeContext(cfgIn, opts), sks = skeletons(ctx), out = {};
  const required = Object.keys(ctx.counts).filter((t) => ctx.counts[t] > 0);
  for (const t of required) out[t] = 0;
  for (const sk of sks) {
    const { cand } = candidates(ctx, sk), have = new Set();
    for (const arr of Object.values(cand)) for (const L of arr) for (const c of L) { have.add(c.t); if (c.t2) have.add(c.t2); }
    for (const t of required) if (have.has(t)) out[t] += 1;
  }
  return { skeletons: sks.length, positions: out, missing: required.filter((t) => out[t] === 0) };
}

export function collectSkeleton(ctx, sk, opts = {}) {
  const found = [];
  const budget = { beam: 700, perSig: 8, ms: 5000, ...(opts.budget || {}) };
  // two passes: plain slots, then with stacked slots (more options per band, but they would crowd a single beam)
  const st = { nodes: 0, layouts: 0 }, add = (pieces, obj) => found.push({ pieces: pieces.slice(), obj });
  for (const stacks of [false, true]) { const r = searchSkeleton(ctx, sk, add, { ...budget, stacks }); st.nodes += r.nodes; st.layouts += r.layouts; }
  found.sort((a, b) => b.obj - a.obj);
  const byTopo = new Map(), perSk = opts.perSkeleton ?? 4;
  let checked = 0;
  for (const fd of found) {
    if (byTopo.size >= perSk && checked > perSk * 3) break;
    const key = topologyKey(ctx, fd.pieces);
    if (byTopo.has(key)) continue;
    const doc = piecesToDoc(ctx, fd.pieces, { source: `generated (band ${pyG(sk.s)} ft, spine ${fmt(sk.c)})`, skeleton: { s: sk.s, c: sk.c } });
    const plan = quickPlan(ctx.cfg, doc), q = quality(plan); checked++;
    if (q.hard) {
      // relaxed search: keep layouts whose only hard failures are Vaastu sector placements (flagged in the UI)
      if (!(ctx.minFrac !== null && plan.failed.every((c) => c.cat === 'Vaastu' && c.name.startsWith('Sector placement')))) continue;
      q.relaxed = true;
    }
    byTopo.set(key, { doc, quality: q, key, skeleton: { s: sk.s, c: sk.c } });
  }
  return { candidates: [...byTopo.values()], stats: { ...st, checked } };
}

/** Deduplicate by topology, polish the best, rank. */
export function rankCandidates(cfgIn, list, opts = {}) {
  const cfg = prepareConfig(cfgIn), byTopo = new Map();
  for (const c of list) { const prev = byTopo.get(c.key); if (!prev || c.quality.score > prev.quality.score) byTopo.set(c.key, c); }
  let cands = [...byTopo.values()].sort((a, b) => b.quality.score - a.quality.score).slice(0, opts.maxCandidates ?? 24);
  if (opts.polish !== false) {
    const deadline = Date.now() + (opts.polishMs ?? 20000);
    cands = cands.map((c) => { const r = polish(cfg, c.doc, { evals: (opts.polish && opts.polish.evals) || 150, deadline }); return { ...c, doc: r.doc, quality: { ...r.quality, relaxed: r.quality.hard > 0 } }; });
  }
  cands.sort((a, b) => b.quality.score - a.quality.score);
  cands.forEach((c, i) => { c.doc.id = i + 1; c.doc.label = `Option ${i + 1}`; });
  return cands;
}

/**
 * Generate candidates (single thread). The UI runs collectSkeleton() for slices of the skeletons in Web Workers and
 * rankCandidates() at the end; this function does both in one call (used by tests and Node).
 */
export function generate(cfgIn, opts = {}) {
  const t0 = Date.now(), ctx = makeContext(cfgIn, opts);
  const all = skeletons(ctx, opts.skeletonOpts || {});
  const list = opts.skeletons ? opts.skeletons.map((k) => (typeof k === 'number' ? all[k] : k)).filter(Boolean) : all;
  const deadline = t0 + (opts.deadlineMs ?? 60000), pool = [], stats = { skeletons: 0, layouts: 0, valid: 0, nodes: 0 };
  for (const sk of list) {
    if (Date.now() > deadline) break;
    const r = collectSkeleton(ctx, sk, opts);
    stats.skeletons++; stats.layouts += r.stats.layouts; stats.nodes += r.stats.nodes; stats.valid += r.candidates.length;
    pool.push(...r.candidates);
  }
  const cands = rankCandidates(ctx.cfg, pool, opts);
  if (opts.onCandidate) for (const c of cands) opts.onCandidate(c);
  return { candidates: cands, stats: { ...stats, topologies: new Set(pool.map((c) => c.key)).size, ms: Date.now() - t0 } };
}

export { analysePlan };
