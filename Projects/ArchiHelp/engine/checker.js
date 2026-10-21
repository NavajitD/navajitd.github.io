// ArchiHelp design engine — independent plan checker (port of the notebook's evaluate()).
// Re-measures the plan from its geometry and runs EVERY rule (no early exit). Hard rules gate a design;
// soft rules are advisory. Rule names and detail strings match the notebook so reports read the same.
import { rarea, rw, rh, sharedEdge, overlapArea, fmt, pyFixed, argmax, sortedBy, EPS } from './geom.js';
import { CIRC, BEDS } from './config.js';
import { roomSector, sectorRule, padaWeights, sectorSplit } from './sectors.js';
import { designStair, stairVariants, lobbyContact, stairSizeOk } from './stair.js';
import { coreRect } from './structure.js';

/** suite parts may reference their room by uid or by name */
function groupOf(p, rooms) {
  if (p.group === null || p.group === undefined) return null;
  if (typeof p.group === 'number') return p.group;
  const r = rooms.find((q) => q.name === p.group);
  return r ? r.uid : null;
}

export function evaluate(plan) {
  const cfg = plan.cfg, rooms = plan.rooms, R = plan.region, struct = plan.struct;
  const checks = [];
  const chk = (cat, name, ok, detail = '', hard = true) => checks.push({ cat, name, ok: !!ok, hard: !!hard, detail });
  const adj = new Map();
  const key = (a, b) => a * 100003 + b;
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j], [L, seg] = sharedEdge(a.tile, b.tile);
    if (L > 0) { adj.set(key(a.uid, b.uid), [L, seg]); adj.set(key(b.uid, a.uid), [L, seg]); }
  }
  const gid = new Map(rooms.map((r) => [r.uid, groupOf(r, rooms)]));
  const alen0 = (a, b) => (adj.get(key(a.uid, b.uid)) || [0])[0];
  const partsCache = new Map();
  const parts = (r) => {
    if (!partsCache.has(r.uid)) partsCache.set(r.uid, rooms.filter((p) => p.rtype === 'suite' && gid.get(p.uid) === r.uid));
    return partsCache.get(r.uid);
  };
  const alen = (a, b) => alen0(a, b) + parts(a).reduce((s, p) => s + alen0(p, b), 0) + parts(b).reduce((s, p) => s + alen0(a, p), 0);
  const garea = (r) => r.area + parts(r).reduce((s, p) => s + p.area, 0);
  const of = (...ts) => rooms.filter((r) => ts.includes(r.rtype));
  const circ = rooms.filter((r) => CIRC.has(r.rtype)), beds = rooms.filter((r) => BEDS.has(r.rtype)), baths = of('bath'), courts = of('court');
  const bestCirc = (r) => (circ.length ? argmax(circ, (c) => [alen(r, c), c.rtype === 'passage']) : null);
  const toCirc = (r) => Math.max(0, ...circ.map((c) => alen(r, c)));
  const st = designStair(cfg), specs = cfg.room_specs;

  // ---------------- planning ----------------
  let tot = 0, ovl = 0;
  for (const r of rooms) tot += rarea(r.tile);
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) ovl += overlapArea(rooms[i].tile, rooms[j].tile);
  chk('Planning', 'Spaces tile the envelope exactly', Math.abs(tot - rarea(R)) < 0.05 && ovl < 1e-6, `${pyFixed(tot, 1)} of ${pyFixed(rarea(R), 1)} sq ft, overlap ${pyFixed(ovl, 2)}`);
  for (const r of rooms) {
    const n = r.net;
    if (r.rtype === 'suite') continue;
    let ok;
    if (r.rtype === 'stair') ok = stairSizeOk(n, st);
    else if (r.rtype === 'passage') { const m = Math.min(rw(n), rh(n)); ok = specs.passage.wmin - 1e-6 <= m && m <= specs.passage.wmax + 1e-6; }
    else {
      const sp = specs[r.rtype] || { wmin: 0, amin: 0, amax: 1e9, asp: 99 };
      const s = Math.min(rw(n), rh(n)), l = Math.max(rw(n), rh(n)), ga = garea(r);
      ok = s >= sp.wmin - 1e-6 && sp.amin - 1e-6 <= ga && ga <= sp.amax + 1e-6 && l / s <= sp.asp + 1e-9;
    }
    chk('Planning', 'Room size within limits (NBC minimums)', ok, `${r.name}: ${fmt(rw(n))} x ${fmt(rh(n))}` + (parts(r).length ? ' + L-part' : '') + ` = ${pyFixed(garea(r), 0)} sq ft`);
  }
  const masters = of('master');
  if (masters.length) {
    const m0 = masters[0], others = beds.filter((b) => b !== m0);
    chk('Planning', 'Master bedroom is the largest bedroom', others.every((b) => garea(m0) > garea(b)),
      `master ${pyFixed(garea(m0), 1)} sq ft vs ` + others.map((b) => `${b.name} ${pyFixed(garea(b), 1)}`).join(', '));
  }
  const attach = {}, used = new Set();
  for (const b of sortedBy(beds, (r) => r.rtype !== 'master')) {
    const c = baths.filter((t) => !used.has(t.uid) && alen(b, t) >= 2.5).map((t) => [alen(b, t), t]);
    if (c.length) { const [, t] = argmax(c, (z) => z[0]); used.add(t.uid); attach[t.uid] = b.uid; }
  }
  for (const m of masters) chk('Planning', 'Master bedroom has an attached bath', baths.some((t) => attach[t.uid] === m.uid), m.name);
  const need = { master: 3.0, bedroom: 3.0, kitchen: 3.0, puja: 2.5, veranda: 3.0 };
  for (const r of rooms) if (r.rtype in need) chk('Planning', `${(specs[r.rtype] || {}).label || r.rtype} opens onto circulation`, toCirc(r) >= need[r.rtype], `${r.name}: ${pyFixed(toCirc(r), 1)} ft`);
  for (const t of baths) chk('Planning', 'Bath is attached to a bedroom or opens onto circulation', (t.uid in attach) || toCirc(t) >= 2.5, t.name);
  for (const r of rooms) {                       // light & ventilation: an exterior wall or a courtyard wall
    if (['passage', 'stair', 'court', 'suite', 'lobby'].includes(r.rtype)) continue;
    const t = r.tile; let ext = 0;
    if (t.x0 <= R.x0 + EPS) ext += rh(t);
    if (t.x1 >= R.x1 - EPS) ext += rh(t);
    if (t.y0 <= R.y0 + EPS) ext += rw(t);
    if (t.y1 >= R.y1 - EPS) ext += rw(t);
    for (const c of courts) ext += alen(r, c);
    chk('Planning', 'Light & ventilation (exterior or courtyard wall)', ext >= (r.rtype === 'bath' ? 2.0 : 3.0), `${r.name}: ${pyFixed(ext, 1)} ft`);
  }
  if (cfg.min_courtyards > 0) chk('Planning', `At least ${cfg.min_courtyards} courtyard(s)`, courts.length >= cfg.min_courtyards, `${courts.length} courtyard(s)`);

  // ---------------- doors / openings ----------------
  const links = [];
  const add = (a, b, kind, into = null, seg = null, extra = {}) => {
    links.push({ a: a.uid, b: b.uid, kind, into: (into || b).uid, seg: seg || (adj.get(key(a.uid, b.uid)) || [0, null])[1], ...extra });
  };
  const byuid = new Map(rooms.map((r) => [r.uid, r]));
  const spec = plan.link_spec;
  if (spec) {                                      // hand-specified doors / openings / "no wall"
    for (const s of spec) {
      const a = byuid.get(s.a), b = byuid.get(s.b), into = byuid.get(s.into ?? s.b);
      if (!a || !b) { chk('Planning', 'Door / opening joins two existing spaces', false, `link ${s.a}-${s.b}: space removed`); continue; }
      if (!adj.has(key(a.uid, b.uid))) { chk('Planning', 'Door / opening sits on a shared wall', false, `${a.name} and ${b.name} do not share a wall`); continue; }
      add(a, b, s.kind, into || b, null, s.hint ? { hint: { ...s.hint } } : {});
    }
  } else {
    for (let i = 0; i < circ.length; i++) for (let j = i + 1; j < circ.length; j++) if (alen(circ[i], circ[j]) >= 3.0) add(circ[i], circ[j], 'open');
    for (const r of rooms) {
      if (!circ.length) break;
      const c = bestCirc(r);
      if (BEDS.has(r.rtype) || r.rtype === 'puja' || r.rtype === 'veranda') { if (alen(r, c) > 0) add(c, r, 'door', r); }
      else if (r.rtype === 'bath') {
        const bed = byuid.get(attach[r.uid]);
        if (bed && (bed.rtype === 'master' || alen(r, c) < 2.5)) add(bed, r, 'door', r);
        else if (alen(r, c) >= 2.5) add(c, r, 'door', r);
      } else if (r.rtype === 'kitchen') {
        const dn = circ.filter((d) => d.rtype === 'dining' && alen(r, d) >= 3.0), best = dn.length ? dn[0] : c;
        if (alen(r, best) > 0) add(best, r, dn.length ? 'open' : 'door', r);
      }
    }
  }
  // auto links can involve suite parts whose own tile does not touch (alen counts parts): drop seg-less ones safely
  for (let i = links.length - 1; i >= 0; i--) if (!links[i].seg) links.splice(i, 1);
  let stairGeo = null;
  for (const s of of('stair')) {
    let best = null;
    for (const v of stairVariants(s.net, st)) for (const c of circ) {
      const [L, seg] = lobbyContact(s.tile, c.tile, v);
      if (L >= 3.0 && (best === null || L > best[0])) best = [L, seg, v, c];
    }
    chk('Planning', 'Staircase arrival lobby opens onto circulation', best !== null, s.name);
    if (best) {
      const [, seg, v, c] = best; stairGeo = { ...v, room: s.uid };
      if (!spec) add(c, s, 'open', c, seg);
    }
  }
  const g = new Map(rooms.filter((r) => r.rtype !== 'court').map((r) => [r.uid, new Set()]));
  for (const l of links) { if (g.has(l.a) && g.has(l.b)) { g.get(l.a).add(l.b); g.get(l.b).add(l.a); } }
  for (const p of rooms) {
    const pg = gid.get(p.uid);
    if (p.rtype === 'suite' && pg !== null && g.has(pg) && g.has(p.uid)) { g.get(p.uid).add(pg); g.get(pg).add(p.uid); }
  }
  const stairs = of('stair');
  if (g.size) {
    const start = stairs.length ? stairs[0].uid : g.keys().next().value;
    const seen = new Set([start]), todo = [start];
    while (todo.length) for (const x of g.get(todo.pop())) if (!seen.has(x)) { seen.add(x); todo.push(x); }
    const miss = rooms.filter((r) => g.has(r.uid) && !seen.has(r.uid)).map((r) => r.name);
    chk('Planning', 'Every room reachable from the staircase', !miss.length, miss.length ? 'unreachable: ' + miss.join(', ') : 'all');
  }
  if (masters.length) chk('Planning', 'All bedrooms have an attached bath', beds.every((b) => baths.some((t) => attach[t.uid] === b.uid)), '', false);
  for (const k of of('kitchen')) chk('Planning', 'Kitchen adjoins dining', of('dining').some((d) => alen(k, d) >= 3), '', false);

  // ---------------- Vaastu ----------------
  const rows = rooms.map((r) => roomSector(cfg, r));
  rows.forEach((row, i) => {                       // L-shaped rooms: area-weighted over all parts
    const r = rooms[i], ps = parts(r);
    if (ps.length && row.score !== null) {
      const totA = garea(r), rule = sectorRule(cfg, r.rtype), w = padaWeights(rule, cfg.sector_pref_floor);
      let fa = 0, sc = 0;
      for (const q of [r, ...ps]) {
        const sp = sectorSplit(cfg, q.net);
        let a1 = 0, s1 = 0;
        for (const [p, f] of Object.entries(sp)) { if (p in w) a1 += f; s1 += f * (w[p] || 0); }
        fa += q.area * a1; sc += q.area * 100 * s1;
      }
      Object.assign(row, { frac: fa / totA, score: sc / totA, ok: (fa / totA >= cfg.sector_min_frac - 1e-9) || !rule.hard });
    }
  });
  for (const row of rows) {
    if (row.score === null) continue;
    chk('Vaastu', `Sector placement (${row.rtype}): >= ${pyFixed(cfg.sector_min_frac * 100, 0)}% in allowed padas`, row.frac >= cfg.sector_min_frac - 1e-9,
      `${row.room}: ${pyFixed(row.frac * 100, 0)}% in allowed padas, score ${pyFixed(row.score, 0)}/100  [${row.padas}]`, row.hard);
  }
  const core = coreRect(cfg), bmax = cfg.brahmasthan_max_overlap;
  for (const r of rooms) if (r.rtype in bmax) {
    const ov = overlapArea(r.net, core);
    chk('Vaastu', 'Brahmasthan (centre) kept free', ov <= bmax[r.rtype], `${r.name}: ${pyFixed(ov, 0)} sq ft in the centre`, cfg.brahmasthan_rule);
  }
  if (courts.length) chk('Vaastu', 'Courtyard opens the Brahmasthan', courts.some((c) => overlapArea(c.net, core) > 0),
    courts.map((c) => `${c.name}: ${pyFixed(overlapArea(c.net, core), 0)} sq ft in the centre`).join(', '), false);
  if (stairGeo) chk('Vaastu', 'Staircase turns clockwise going up', true, `variant ${stairGeo.var} (all variants are clockwise)`);
  const nCore = struct.columns.filter((c) => core.x0 < c.x && c.x < core.x1 && core.y0 < c.y && c.y < core.y1).length;
  chk('Vaastu', 'No structural column in the Brahmasthan', nCore === 0, `${nCore} columns`, cfg.avoid_core_columns);
  for (const t of baths) {
    for (const k of of('kitchen')) chk('Vaastu', 'Toilet does not share a wall with the kitchen', alen(t, k) < 1.0, t.name, false);
    for (const p of of('puja')) chk('Vaastu', 'Puja room does not share a wall with a toilet', alen(t, p) < 1.0, t.name, false);
  }
  // ---------------- structure ----------------
  const vs = [], hs = [];
  for (const r of rooms) { const t = r.tile; vs.push([t.x0, t.y0, t.y1], [t.x1, t.y0, t.y1]); hs.push([t.y0, t.x0, t.x1], [t.y1, t.x0, t.x1]); }
  const tol = cfg.col_wall_tol_ft;
  for (const c of struct.columns) {
    const ok = vs.some(([x, y0, y1]) => Math.abs(x - c.x) <= tol && y0 - tol <= c.y && c.y <= y1 + tol) ||
               hs.some(([y, x0, x1]) => Math.abs(y - c.y) <= tol && x0 - tol <= c.x && c.x <= x1 + tol);
    if (!ok) chk('Structure', 'Column sits in a wall line', false, c.id, cfg.require_columns_in_walls);
  }
  const longs = struct.beams.filter((b) => b.long_span && !b.skipped);
  chk('Structure', 'No beam span over 6 m', !longs.length, `${longs.length} long spans (engineer to verify)`, false);

  plan.checks = checks; plan.links = links; plan.stair_geo = stairGeo; plan.attach = attach;
  plan.failed = checks.filter((c) => c.hard && !c.ok);
  plan.sector_rows = rows;
  const rated = rows.filter((r) => r.score !== null).map((r) => r.score);
  plan.vaastu_score = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 100.0;
  plan.adjLen = (a, b) => alen(a, b);
  plan.parts = parts;
  return !plan.failed.length;
}

export function checkSummary(plan) {
  const hardFail = plan.checks.filter((c) => c.hard && !c.ok).length, advisory = plan.checks.filter((c) => !c.hard && !c.ok).length;
  return { hardFail, advisory, passed: plan.checks.filter((c) => c.ok).length, total: plan.checks.length, vaastu: plan.vaastu_score };
}
