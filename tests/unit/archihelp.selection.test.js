// Several things selected at once in the plan editor (Shift-click, Ctrl-click or ⌘-click): moving them together,
// deleting and rotating them (Projects/ArchiHelp/js/selection.js), on the example plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analysePlan, prepareConfig } from '../../Projects/ArchiHelp/engine/index.js';
import * as E from '../../Projects/ArchiHelp/engine/edits.js';
import { rw, rh } from '../../Projects/ArchiHelp/engine/geom.js';
import * as S from '../../Projects/ArchiHelp/js/selection.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const project = JSON.parse(readFileSync(join(HERE, '..', '..', 'Projects', 'ArchiHelp', 'examples', 'residence-rev9.json'), 'utf8'));
const cfg = prepareConfig(project.cfg), doc0 = project.plans[0], plan0 = analysePlan(cfg, doc0);
const uid = (name) => plan0.rooms.find((r) => r.name === name).uid;
const room = (plan, name) => plan.rooms.find((r) => r.name === name);
const item = (plan, name, i) => plan.furniture[uid(name)][i];
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const linkSel = (a, b) => ({ t: 'link', a: uid(a), b: uid(b) });
const doorAt = (plan, a, b) => plan.door_plan.get(S.linkIndex(plan, linkSel(a, b)));

test('same thing twice: doors either way round, walls through any room along them', () => {
  assert.ok(S.sameSel(linkSel('Passage', 'Bedroom 2'), linkSel('Bedroom 2', 'Passage')));
  assert.ok(!S.sameSel({ t: 'link', entrance: true }, linkSel('Passage', 'Bedroom 2')));
  assert.ok(S.sameSel({ t: 'item', uid: 10, i: 0, extra: 1 }, { t: 'item', uid: 10, i: 0 }));
  assert.ok(!S.sameSel({ t: 'item', uid: 10, i: 0 }, { t: 'item', uid: 10, i: 1 }));
  const a = { t: 'wall', ref: [uid('Bath 2'), 'x1'] }, b = { t: 'wall', ref: [uid('Bedroom 2'), 'x0'] };
  assert.ok(!S.sameSel(a, b));
  assert.ok(S.sameSel(a, b, E.wallComponents(doc0, cfg)));
});

test('Shift / Ctrl / ⌘-click: adds in the order picked, a second click takes it out again', () => {
  const r1 = { t: 'room', uid: 1 }, r2 = { t: 'room', uid: 2 }, w = { t: 'window', room: 2, side: 'S' };
  let list = S.toggleSel([], r1);
  list = S.toggleSel(list, w);
  list = S.toggleSel(list, r2);
  assert.deepEqual(list, [r1, w, r2]);
  assert.deepEqual(S.toggleSel(list, { t: 'window', room: 2, side: 'S' }), [r1, r2]);
  assert.equal(S.countText([r1, r2, w, { t: 'item', uid: 1, i: 0 }]), '2 rooms · 1 window · 1 piece of furniture');
  assert.ok(!S.validSel(doc0, plan0, cfg, { t: 'item', uid: uid('Hall'), i: 99 }));
  assert.ok(S.validSel(doc0, plan0, cfg, { t: 'wall', ref: [uid('Bath 2'), 'x1'] }));
});

test('furniture in two rooms moves as one piece; the room the planner furnished becomes a hand layout', () => {
  const bed = { t: 'item', uid: uid('Bedroom 2'), i: 0 }, coffee = { t: 'item', uid: uid('Hall'), i: 1 };
  assert.ok(S.needsHandLayout(doc0, plan0, uid('Hall')));
  const r = S.moveSelection(cfg, doc0, plan0, [bed, coffee], 1, 0.5);
  assert.deepEqual([r.dx, r.dy], [1, 0.5]);
  const p = analysePlan(cfg, r.doc);
  for (const [name, i] of [['Bedroom 2', 0], ['Hall', 1]]) {
    near(item(p, name, i).rect.x0, item(plan0, name, i).rect.x0 + 1);
    near(item(p, name, i).rect.y1, item(plan0, name, i).rect.y1 + 0.5);
  }
  assert.equal(r.doc.furniture[uid('Hall')].mode, 'manual');
  for (const i of [0, 2]) assert.deepEqual(item(p, 'Hall', i).rect, item(plan0, 'Hall', i).rect);   // the rest of the hall stays put
  // too far: the bed reaches its east wall first and the coffee table stops with it
  const far = S.moveSelection(cfg, doc0, plan0, [bed, coffee], 10, -3);
  near(far.dx, room(plan0, 'Bedroom 2').net.x1 - item(plan0, 'Bedroom 2', 0).rect.x1);
  assert.equal(far.dy, 0);                                  // the bed already stands against its south wall
  const q = analysePlan(cfg, far.doc);
  near(item(q, 'Hall', 1).rect.x0 - item(q, 'Bedroom 2', 0).rect.x0, item(plan0, 'Hall', 1).rect.x0 - item(plan0, 'Bedroom 2', 0).rect.x0);
  near(item(q, 'Bedroom 2', 0).rect.x1, room(plan0, 'Bedroom 2').net.x1);
});

test('doors and windows slide along their own walls; furniture moves both ways', () => {
  const door = linkSel('Passage', 'Bedroom 2'), win = { t: 'window', room: uid('Bedroom 2'), side: 'N' }, coffee = { t: 'item', uid: uid('Hall'), i: 1 };
  const w0 = S.windowsOn(plan0, uid('Bedroom 2'), 'N')[0];
  const r = S.moveSelection(cfg, doc0, plan0, [door, win, coffee], 2, 1);
  const p = analysePlan(cfg, r.doc);
  near(doorAt(p, 'Passage', 'Bedroom 2')[0], doorAt(plan0, 'Passage', 'Bedroom 2')[0] + 2);
  const w1 = S.windowsOn(p, uid('Bedroom 2'), 'N')[0];
  near(w1.x, w0.x + 2); near(w1.w, w0.w); near(w1.y, w0.y);
  near(item(p, 'Hall', 1).rect.y0, item(plan0, 'Hall', 1).rect.y0 + 1);
  // a door on a north-south wall moves only north-south: an east-west request leaves it alone
  const g = S.groupMovers(cfg, doc0, plan0, [linkSel('Bedroom 2', 'Bath 2')]);
  assert.deepEqual(S.groupDelta(g.movers, 5, 1), [0, 1]);
});

test('walls move together, the leading wall first, so a narrow room in between never vanishes on the way', () => {
  const west = { t: 'wall', ref: [uid('Staircase'), 'x1'] }, east = { t: 'wall', ref: [uid('Stair Landing'), 'x1'] };
  const land = rw(room(plan0, 'Stair Landing').net);
  assert.throws(() => E.moveWall(doc0, cfg, S.wallOf(doc0, cfg, west), S.wallOf(doc0, cfg, west).at + 3), /too small/);
  const r = S.moveSelection(cfg, doc0, plan0, [west, east], 3, 0);
  const p = analysePlan(cfg, r.doc);
  near(rw(room(p, 'Stair Landing').net), land);
  near(rw(room(p, 'Staircase').net), rw(room(plan0, 'Staircase').net) + 3);
  near(rw(room(p, 'Kitchen').net), rw(room(plan0, 'Kitchen').net) - 3);
  const back = S.moveSelection(cfg, r.doc, p, [east, west], -3, 0);           // and back again, the other way round
  assert.deepEqual([back.dx, back.dy], [-3, 0]);
  for (const q of doc0.rooms) for (const k of ['x0', 'x1', 'y0', 'y1']) near(back.doc.rooms.find((z) => z.uid === q.uid).tile[k], q.tile[k], 1e-9);
});

test('the dragged piece snaps flush to its wall and the rest follow by the same amount', () => {
  const coffee = { t: 'item', uid: uid('Hall'), i: 1 }, door = linkSel('Bedroom 2', 'Bath 2');
  const g = S.groupMovers(cfg, doc0, plan0, [coffee, door]);
  const want = room(plan0, 'Hall').net.x0 - item(plan0, 'Hall', 1).rect.x0;              // flush against the hall's west wall
  const [dx, dy] = S.groupDelta(g.movers, want + 0.1, 0.2, { lead: coffee, snapTol: 0.3 });
  near(dx, want); near(dy, 0.2);
});

test('Delete takes away furniture, keep-outs, windows and doors in one go; rooms and walls stay', () => {
  const list = [
    { t: 'item', uid: uid('Bedroom 2'), i: 0 }, { t: 'item', uid: uid('Bedroom 2'), i: 2 }, { t: 'item', uid: uid('Hall'), i: 1 },
    { t: 'keepout', i: 0 }, { t: 'window', room: uid('Dining'), side: 'E' },
    linkSel('Passage', 'Bath 2'), linkSel('Passage', 'Bedroom 2'), { t: 'room', uid: uid('Dining') }, { t: 'wall', ref: [uid('Bath 2'), 'x1'] },
  ];
  assert.equal(S.deleteText(list), 'Removed 2 doors and openings, 1 window, 3 pieces of furniture and 1 keep-out zone.');
  const d = S.deleteSelection(cfg, doc0, plan0, list), p = analysePlan(cfg, d);
  assert.deepEqual(p.furniture[uid('Bedroom 2')].map((i) => i.kind), ['side_table']);
  assert.deepEqual(p.furniture[uid('Hall')].map((i) => i.kind), ['sofa', 'tv']);
  assert.equal((d.keepouts || []).length, 0);
  assert.equal(S.windowsOn(p, uid('Dining'), 'E').length, 0);
  assert.equal(S.linkIndex(p, linkSel('Passage', 'Bath 2')), -1);
  assert.equal(S.linkIndex(p, linkSel('Passage', 'Bedroom 2')), -1);
  assert.equal(p.links_all.length, plan0.links_all.length - 2);
  assert.equal(p.rooms.length, plan0.rooms.length);
  assert.equal(S.deleteText([{ t: 'room', uid: 1 }, { t: 'wall', ref: [1, 'x1'] }]), '');
});

test('Rotate turns each piece about its centre; one that does not fit turned round stays as it was', () => {
  const coffee = { t: 'item', uid: uid('Hall'), i: 1 }, shower = { t: 'item', uid: uid('Bath 1'), i: 0 };
  const r = S.rotateSelection(cfg, doc0, plan0, [coffee, shower]);
  assert.deepEqual([r.done, r.stuck], [1, 1]);
  const p = analysePlan(cfg, r.doc), a = item(plan0, 'Hall', 1).rect, b = item(p, 'Hall', 1).rect;
  near(rw(b), rh(a)); near(rh(b), rw(a));
  assert.deepEqual(item(p, 'Bath 1', 0).rect, item(plan0, 'Bath 1', 0).rect);
  const none = S.rotateSelection(cfg, doc0, plan0, [shower]);
  assert.equal(none.done, 0); assert.equal(none.doc, doc0);
});
