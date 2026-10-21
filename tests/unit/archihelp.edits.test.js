// Vaastu Planner edit operations: the hand-sketch revision moves as pure document edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analysePlan } from '../../Projects/VaastuPlanner/engine/index.js';
import * as E from '../../Projects/VaastuPlanner/engine/edits.js';
import { rw, rh, rarea } from '../../Projects/VaastuPlanner/engine/geom.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const project = JSON.parse(readFileSync(join(HERE, '..', '..', 'Projects', 'VaastuPlanner', 'examples', 'residence-rev9.json'), 'utf8'));
const cfg = project.cfg, doc0 = project.plans[0];
const uid = (doc, name) => doc.rooms.find((r) => r.name === name).uid;
const room = (plan, name) => plan.rooms.find((r) => r.name === name);
const tiles = (doc) => JSON.stringify(doc.rooms.map((r) => [r.uid, r.rtype, r.name, Object.values(r.tile).map((v) => v.toFixed(6))]).sort());

test('area target: kitchen to exactly 80 sq ft by moving its east wall (revision 5 move)', () => {
  const d = E.setArea(doc0, cfg, uid(doc0, 'Kitchen'), 80, 'E');
  const p = analysePlan(cfg, d);
  assert.ok(Math.abs(rarea(room(p, 'Kitchen').net) - 80) < 1e-6);
  assert.ok(Math.abs(rw(room(p, 'Dining').net) - (rw(room(analysePlan(cfg, doc0), 'Dining').net) - (rw(room(p, 'Kitchen').net) - rw(room(analysePlan(cfg, doc0), 'Kitchen').net)))) < 1e-6);
});

test('clear size: passage 3\'-9" -> 4\'-0" moves the shared wall; moving back restores the plan', () => {
  const pas = uid(doc0, 'Passage');
  const d1 = E.setClearSize(doc0, cfg, pas, 'h', 4.0, 'N');
  assert.ok(Math.abs(rh(room(analysePlan(cfg, d1), 'Passage').net) - 4.0) < 1e-9);
  const d2 = E.setClearSize(d1, cfg, pas, 'h', 3.75, 'N');
  assert.equal(tiles(d2), tiles(doc0));
});

test('walls that do not line up on both sides refuse to move with a clear message', () => {
  assert.throws(() => E.wallOfRoom(doc0, cfg, uid(doc0, 'Master Bedroom'), 'W'), /outer wall/);
});

test('split then merge restores the space', () => {
  const h = uid(doc0, 'Hall'), t = doc0.rooms.find((r) => r.uid === h).tile;
  const d1 = E.splitRoom(doc0, cfg, h, 'y', (t.y0 + t.y1) / 2, { rtype: 'veranda', name: 'Sit-out', newSide: 'S' });
  assert.equal(d1.rooms.length, doc0.rooms.length + 1);
  const d2 = E.mergeRooms(d1, cfg, h, uid(d1, 'Sit-out'));
  assert.equal(tiles(d2), tiles(doc0));
});

test('swap is its own inverse', () => {
  const a = uid(doc0, 'Bedroom 2'), b = uid(doc0, 'Bedroom 3');
  const d = E.swapRooms(E.swapRooms(doc0, a, b), a, b);
  assert.equal(tiles(d), tiles(doc0));
});

test('doors: pinning keeps every door exactly where the planner put it; removing the puja door (revision 5 move)', () => {
  const p0 = analysePlan(cfg, doc0);
  let d = doc0;
  p0.links_all.forEach((l, k) => { if (!l.entrance && l.kind !== 'nowall' && !(doc0.links[E.linkIndex(doc0, l)] || {}).hint) d = E.pinLink(d, p0, k); });
  const p1 = analysePlan(cfg, d);
  for (const [k, v] of p0.door_plan) { const w = p1.door_plan.get(k); assert.ok(Math.abs(w[0] - v[0]) < 1e-9 && w[1] === v[1] && Math.abs(w[3] - v[3]) < 1e-9, `link ${k}`); }
  const i = d.links.findIndex((l) => l.b === uid(doc0, 'Puja Room'));
  const d2 = E.removeLink(d, i);
  const p2 = analysePlan(cfg, d2);
  assert.ok(p2.checks.some((c) => c.name === 'Every room reachable from the staircase' && !c.ok));
});

test('doors: a new connection must share a wall', () => {
  const p = analysePlan(cfg, doc0);
  assert.throws(() => E.addLink(doc0, p, uid(doc0, 'Kitchen'), uid(doc0, 'Bath 1')), /do not share a wall/);
});

test('windows: suppress a side, then ask for the widest window between piers', () => {
  const k = uid(doc0, 'Kitchen');
  const d1 = E.setWindow(doc0, k, 'S', { none: true });
  assert.ok(!analysePlan(cfg, d1).openings.some((o) => o.kind === 'window' && o.into === k));
  const d2 = E.setWindow(d1, k, 'S', { fit: 'max', sill: 3.5, desc: 'Window (over counter)', keepout: true });
  const w = analysePlan(cfg, d2).openings.find((o) => o.kind === 'window' && o.into === k);
  assert.equal(w.w, 5.0);
});

test('furniture: auto layout copied to a manual layout is identical; rotate twice = 180 degrees', () => {
  const p0 = analysePlan(cfg, doc0), b3 = uid(doc0, 'Bedroom 3');
  const d = E.furnitureToManual(doc0, p0, b3);
  const p1 = analysePlan(cfg, d);
  assert.deepEqual(p1.furniture[b3].map((i) => [i.kind, i.rect]), p0.furniture[b3].map((i) => [i.kind, i.rect]));
  const r0 = d.furniture[b3].items[0].rect, d2 = E.rotateItem(E.rotateItem(d, b3, 0), b3, 0), r2 = d2.furniture[b3].items[0].rect;
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(r0[k] - r2[k]) < 1e-9);
});

test('moving a wall slides hand-placed furniture that stands against it', () => {
  const k = uid(doc0, 'Kitchen'), before = doc0.furniture[k].items.find((i) => i.side === 'E').rect;
  const d = E.setClearSize(doc0, cfg, k, 'w', rw(room(analysePlan(cfg, doc0), 'Kitchen').net) + 0.5, 'E');
  const after = d.furniture[k].items.find((i) => i.side === 'E').rect;
  assert.ok(Math.abs(after.x0 - before.x0 - 0.5) < 1e-9);
});

test('doors: drag along the wall (placeLink) clamps to the clear wall, keeps the hinge; width and unpin work', () => {
  const p0 = analysePlan(cfg, doc0);
  const k = p0.links_all.findIndex((l) => l.kind === 'door' && !l.entrance && l.into === uid(doc0, 'Bath 2'));
  const iv = E.linkInterval(p0, k), w = p0.door_plan.get(k)[3];
  const d1 = E.placeLink(doc0, p0, k, { p: -100 });
  const p1 = analysePlan(cfg, d1);
  assert.ok(Math.abs(p1.door_plan.get(k)[0] - (iv.lo + w / 2)) < 1e-9);
  assert.equal(p1.door_plan.get(k)[1], p0.door_plan.get(k)[1]);
  const d2 = E.placeLink(d1, p1, k, { w: 3.0, hinge: 'hi' });
  const p2 = analysePlan(cfg, d2);
  assert.equal(p2.door_plan.get(k)[3], 3.0);
  assert.equal(p2.door_plan.get(k)[1], 'hi');
  const d3 = E.unpinLink(d2, p2, k);
  assert.equal(analysePlan(cfg, d3).door_plan.get(k)[3], 2.5);
});

test('entrance door (first floor plan: off) can be switched on, pinned and moved through the plan meta', () => {
  assert.equal(analysePlan(cfg, doc0).links_all.findIndex((l) => l.entrance), -1);
  const de = E.setDocField(doc0, 'roadDoor', true), p0 = analysePlan(cfg, de), k = p0.links_all.findIndex((l) => l.entrance);
  assert.ok(k >= 0);
  const iv = E.linkInterval(p0, k), w = p0.door_plan.get(k)[3];
  assert.equal(w, 3.5);
  const d = E.placeLink(de, p0, k, { p: iv.hi });
  assert.ok(Math.abs(analysePlan(cfg, d).door_plan.get(k)[0] - (iv.hi - w / 2)) < 1e-9);
});

test('connection kind: door -> opening -> no wall, and the swing side', () => {
  const p0 = analysePlan(cfg, doc0);
  const k = p0.links_all.findIndex((l) => l.kind === 'door' && !l.entrance && l.into === uid(doc0, 'Bedroom 3'));
  const l = p0.links_all[k], other = l.a === l.into ? l.b : l.a;
  const d1 = E.setLinkKind(doc0, p0, k, { into: other });
  assert.equal(analysePlan(cfg, d1).links_all[k].into, other);
  const d2 = E.setLinkKind(d1, analysePlan(cfg, d1), k, { kind: 'open' });
  assert.equal(analysePlan(cfg, d2).links_all[k].kind, 'open');
  const de = E.setDocField(doc0, 'roadDoor', true), pe = analysePlan(cfg, de);
  assert.throws(() => E.setLinkKind(de, pe, pe.links_all.findIndex((q) => q.entrance), { kind: 'open' }), /entrance/);
});
