// Builds the seed example project (the final hand-sketch plan, revision 9) in the engine's own edit vocabulary,
// from the notebook dump. Run:  node tests/unit/_vaastu-planner-example.js  -> writes Projects/VaastuPlanner/examples/residence-rev9.json
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFixture, cfgFromGolden } from './_vaastu-planner-parity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const R4 = (a) => ({ x0: a[0], y0: a[1], x1: a[2], y1: a[3] });

export function buildExampleDoc(g) {
  const f = g.final, id = new Map(f.rooms.map((r) => [r.name, r.uid]));
  const items = (nm) => f.furniture[String(id.get(nm))].map((i) => ({ kind: i.kind, rect: R4(i.rect), label: i.label, tall: i.tall, side: i.side, meta: i.meta || {} }));
  const win = (room, side, o) => ({ room: id.get(room), side, ...o });
  return {
    id: 'S', source: 'hand sketch IMG_5243, revision 9', label: 'Final - hand sketch IMG_5243, revision 9',
    rooms: f.rooms.map((r) => ({ uid: r.uid, rtype: r.rtype, name: r.name, tile: R4(r.tile), group: r.group ? id.get(r.group) : null })),
    links: f.link_spec.map((s) => ({ a: id.get(s[0]), b: id.get(s[1]), kind: s[2], into: id.get(s[3]), ...(s[4] ? { hint: { ...s[4] } } : {}) })),
    roadDoor: false,
    // windows: every south window as wide as the 1'-6" piers allow (tall furniture kept clear); dining east likewise
    windows: [
      win('Master Bedroom', 'S', { fit: 'max', sill: 3.0, desc: 'Window', keepout: true }),
      win('Bedroom 3', 'S', { fit: 'max', sill: 3.0, desc: 'Window', keepout: true }),
      win('Dining', 'S', { fit: 'max', sill: 3.0, desc: 'Window', keepout: true }),
      win('Staircase', 'S', { fit: 'max', sill: null, desc: 'Fixed glazing, non-openable', keepout: true }),
      win('Stair Landing', 'S', { none: true }),
      win('Kitchen', 'S', { fit: 'max', sill: 3.5, desc: 'Window (over counter)', keepout: true }),
      win('Dining', 'E', { fit: 'max', sill: 3.0, desc: 'Window' }),
      win('Master Bedroom', 'W', { w: f.window_hints['Master Bedroom'][1][1], c: f.window_hints['Master Bedroom'][1][3], sill: 3.0, desc: 'Window' }),
      win('Bath 1', 'N', { w: 2.0, tag: 'V1', c: f.window_hints['Bath 1'][0][3] }),
      win('Bath 1', 'W', { none: true }),
      win('Hall', 'E', { w: 10.0, tag: 'W5' }),
    ],
    // west window above a 3'-0" wardrobe: no tall furniture in front of it
    keepouts: [{ room: id.get('Master Bedroom'), rect: R4(f.tall_keepout['Master Bedroom'][1]) }],
    furniture: {
      [id.get('Bath 1')]: { mode: 'manual', items: items('Bath 1') },
      [id.get('Kitchen')]: { mode: 'manual', items: items('Kitchen') },
      [id.get('Bedroom 2')]: { mode: 'manual', items: items('Bedroom 2'), bedHead: 'S', wardrobeSide: 'E' },
      [id.get('Lobby')]: { mode: 'manual', items: items('Lobby') },
      [id.get('Dining')]: { mode: 'auto', items: items('Dining').filter((i) => i.kind === 'basin') },
      [id.get('Hall')]: { sofaSide: 'S' },
      [id.get('Bedroom 3')]: { bedHead: 'E' },
    },
    notes: f.extra_notes,
    meta: { revision: 9 },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const g = loadFixture('golden.json');
  const project = {
    format: 'vaastu-planner-project', version: 1,
    name: 'Residence - Example House', createdFrom: 'parametric_vaastu_floorplan_v3.ipynb + hand-sketch revisions 1-9',
    cfg: { ...cfgFromGolden(g), project_name: 'Residence - Example House' },
    drawing: { name: 'Residence - Example House', plan_label: 'Final - hand sketch IMG_5243, revision 9', rev: 'P1' },
    plans: [buildExampleDoc(g)], activePlan: 0,
  };
  const out = join(HERE, '..', '..', 'Projects', 'VaastuPlanner', 'examples', 'residence-rev9.json');
  writeFileSync(out, JSON.stringify(project, null, 1));
  console.log('wrote', out);
}
