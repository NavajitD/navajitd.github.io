// Parity harness: JS engine vs the notebook (Python) golden dumps. Used by tests/unit/archihelp.engine.test.js too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analysePlan } from '../../Projects/ArchiHelp/engine/index.js';
import { docFromNotebook } from '../../Projects/ArchiHelp/engine/io.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const loadFixture = (name) => JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'archihelp', name), 'utf8'));

const close = (a, b, tol = 1e-6) => (a === null || b === null || a === undefined || b === undefined) ? a == b : Math.abs(a - b) <= tol;
const rectArr = (r) => [r.x0, r.y0, r.x1, r.y1];
const sameArr = (a, b, tol) => a.length === b.length && a.every((v, i) => close(v, b[i], tol));

/** Engine config from the golden notebook config (only keys the engine knows). */
export function cfgFromGolden(g) {
  const c = { ...g.config };
  delete c.sector_rules;
  return c;
}

/** Notebook-final plan -> doc with the hand-sketch overrides expressed as engine furniture specs. */
export function finalDoc(g) {
  const f = g.final, doc = docFromNotebook(f), byName = new Map(f.rooms.map((r) => [r.name, r.uid]));
  const items = (nm) => f.furniture[String(byName.get(nm))].map((i) => ({ kind: i.kind, rect: { x0: i.rect[0], y0: i.rect[1], x1: i.rect[2], y1: i.rect[3] }, label: i.label, tall: i.tall, side: i.side, meta: i.meta || {} }));
  for (const nm of ['Bath 1', 'Kitchen', 'Bedroom 2', 'Lobby']) doc.furniture[byName.get(nm)] = { ...(doc.furniture[byName.get(nm)] || {}), mode: 'manual', items: items(nm) };
  doc.furniture[byName.get('Dining')] = { mode: 'auto', items: items('Dining').filter((i) => i.kind === 'basin') };
  doc.furniture[byName.get('Hall')] = { ...(doc.furniture[byName.get('Hall')] || {}), sofaSide: 'S' };
  return doc;
}

export function generatedDoc(q) {
  const doc = docFromNotebook(q);
  for (const r of q.rooms) if (r.rtype === 'hall') doc.furniture[r.uid] = { sofaSide: 'S' };   // HALL_SOFA_SIDE = "S" was global in the dump run
  return doc;
}

/** Compare one analysed JS plan with its Python dump. Returns a list of human-readable differences. */
export function diffPlan(p, q, { tol = 1e-6 } = {}) {
  const d = [];
  const pc = p.checks.filter((c) => c.cat !== 'Furniture');
  if (pc.length !== q.checks.length) d.push(`checks: ${pc.length} vs ${q.checks.length}`);
  for (let i = 0; i < Math.min(pc.length, q.checks.length); i++) {
    const a = pc[i], b = q.checks[i];
    // pada lists: equal shares are ordered by float noise in shapely, so compare them as sets
    const norm = (s) => s.replace(/\[([^\]]*)\]/, (_, m) => '[' + m.split(', ').sort().join(', ') + ']');
    if (a.cat !== b.cat || a.name !== b.name || a.ok !== b.ok || a.hard !== b.hard || norm(a.detail) !== norm(b.detail)) d.push(`check ${i}: JS ${JSON.stringify([a.name, a.ok, a.detail])} vs PY ${JSON.stringify([b.name, b.ok, b.detail])}`);
  }
  if (!close(p.vaastu_score, q.vaastu_score, 1e-6)) d.push(`vaastu ${p.vaastu_score} vs ${q.vaastu_score}`);
  const la = p.links_all, lb = q.links_all;
  if (la.length !== lb.length) d.push(`links_all ${la.length} vs ${lb.length}`);
  for (let i = 0; i < Math.min(la.length, lb.length); i++) {
    const a = la[i], b = lb[i];
    if (a.a !== b.a || a.b !== b.b || a.kind !== b.kind || a.into !== b.into || !sameArr(a.seg.flat(), b.seg.flat(), tol)) d.push(`link ${i}: ${JSON.stringify([a.a, a.b, a.kind, a.into, a.seg])} vs ${JSON.stringify([b.a, b.b, b.kind, b.into, b.seg])}`);
  }
  const keys = new Set([...p.door_plan.keys()].map(String).concat(Object.keys(q.door_plan)));
  for (const k of keys) {
    const a = p.door_plan.get(Number(k)), b = q.door_plan[k];
    if (!a || !b || !close(a[0], b[0], tol) || a[1] !== b[1] || a[2] !== b[2] || !close(a[3], b[3], tol)) d.push(`door_plan ${k}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  const fk = new Set(Object.keys(p.furniture).concat(Object.keys(q.furniture)));
  for (const u of fk) {
    const A = p.furniture[u] || [], B = q.furniture[u] || [];
    const sa = A.map((i) => i.kind + ':' + rectArr(i.rect).map((v) => v.toFixed(4)).join(',')), sb = B.map((i) => i.kind + ':' + i.rect.map((v) => v.toFixed(4)).join(','));
    if (sa.join('|') !== sb.join('|')) d.push(`furniture ${u}:\n   JS ${sa.join(' | ')}\n   PY ${sb.join(' | ')}`);
    A.forEach((it, i) => { const b = B[i]; if (b && (it.side !== b.side || !!it.tall !== !!b.tall || (it.label || '') !== (b.label || ''))) d.push(`furniture ${u}#${i} attrs ${JSON.stringify([it.side, it.tall, it.label, it.meta])} vs ${JSON.stringify([b.side, b.tall, b.label, b.meta])}`); });
  }
  const oa = p.openings, ob = q.openings;
  if (oa.length !== ob.length) d.push(`openings ${oa.length} vs ${ob.length}`);
  for (let i = 0; i < Math.min(oa.length, ob.length); i++) {
    const a = oa[i], b = ob[i];
    if (a.kind !== b.kind || a.type !== b.type || !close(a.w, b.w, tol) || !close(a.x, b.x, tol) || !close(a.y, b.y, tol) || a.horiz !== b.horiz || !close(a.t, b.t, tol) || (a.hinge ?? null) !== (b.hinge ?? null) || a.into !== b.into || a.rooms.join('|') !== b.rooms.join('|'))
      d.push(`opening ${i}: ${JSON.stringify([a.kind, a.type, a.w, a.x, a.y, a.hinge, a.into, a.rooms])} vs ${JSON.stringify([b.kind, b.type, b.w, b.x, b.y, b.hinge, b.into, b.rooms])}`);
  }
  if (JSON.stringify(p.gaps) !== JSON.stringify(q.gaps)) d.push(`gaps ${JSON.stringify(p.gaps)} vs ${JSON.stringify(q.gaps)}`);
  return d;
}

export function runParity() {
  const g = loadFixture('golden.json'), gg = loadFixture('golden_gen.json');
  const cfg = cfgFromGolden(g);
  const out = { final: diffPlan(analysePlan(cfg, finalDoc(g)), g.final) };
  gg.generated.forEach((q, i) => { out[`gen${i}`] = diffPlan(analysePlan(cfg, generatedDoc(q)), q); });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = runParity();
  for (const [k, v] of Object.entries(res)) { console.log(`== ${k}: ${v.length} differences`); for (const s of v.slice(0, 25)) console.log('  ' + s); }
}
