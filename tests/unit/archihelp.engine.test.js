// Vaastu Planner design engine — parity with the notebook (Python) and the final drawing set, plus generator sanity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFixture, cfgFromGolden, finalDoc, generatedDoc, diffPlan } from './_vaastu-planner-parity.js';
import { analysePlan } from '../../Projects/VaastuPlanner/engine/index.js';
import { drawingSet } from '../../Projects/VaastuPlanner/engine/drawing.js';
import { sheetsToPdf, sheetToSvg } from '../../Projects/VaastuPlanner/engine/sheet.js';
import { sectorSplit } from '../../Projects/VaastuPlanner/engine/sectors.js';
import { resolveConfig } from '../../Projects/VaastuPlanner/engine/config.js';
import { generate, diagnose } from '../../Projects/VaastuPlanner/engine/generator.js';
import { fi, fmt, parseFtIn, pyFixed, rectUnionLoops, polyArea } from '../../Projects/VaastuPlanner/engine/geom.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const g = loadFixture('golden.json'), gg = loadFixture('golden_gen.json'), cfg = cfgFromGolden(g);
const example = JSON.parse(readFileSync(join(HERE, '..', '..', 'Projects', 'VaastuPlanner', 'examples', 'residence-rev9.json'), 'utf8'));

test('formatting helpers match the notebook', () => {
  assert.equal(fi(4.75), `4'-9"`);
  assert.equal(fi(8 + 11.5 / 12), `8'-11 1/2"`);
  assert.equal(fmt(3.75), `3'-9"`);
  assert.equal(pyFixed(0.125, 2), '0.12');           // Python rounds exact ties half-to-even
  assert.equal(pyFixed(2.5, 0), '2');
  assert.equal(pyFixed(106.05, 1), '106.0');
  assert.ok(Math.abs(parseFtIn(`8'-11"`) - (8 + 11 / 12)) < 1e-12);
  assert.ok(Math.abs(parseFtIn('8 ft 6 in') - 8.5) < 1e-12);
  assert.ok(Math.abs(parseFtIn('42"') - 3.5) < 1e-12);
});

test('32-pada split matches shapely to 1e-9', () => {
  const c = resolveConfig(cfg);
  for (const p of g.probes) {
    const s = sectorSplit(c, { x0: p.rect[0], y0: p.rect[1], x1: p.rect[2], y1: p.rect[3] });
    for (const k of new Set([...Object.keys(s), ...Object.keys(p.split)])) assert.ok(Math.abs((s[k] || 0) - (p.split[k] || 0)) < 1e-9, k);
  }
});

test('final hand-sketch plan: checks, doors, furniture and openings identical to the notebook', () => {
  assert.deepEqual(diffPlan(analysePlan(cfg, finalDoc(g)), g.final), []);
});

test('CP-SAT generated plans: identical analysis', () => {
  gg.generated.forEach((q) => assert.deepEqual(diffPlan(analysePlan(cfg, generatedDoc(q)), q), []));
});

test('seed example (semantic windows / overrides) reproduces the final plan exactly', () => {
  const p = analysePlan(example.cfg, example.plans[0]);
  assert.deepEqual(diffPlan(p, g.final), []);
  assert.equal(p.failed.length, 0);
  assert.equal(pyFixed(p.vaastu_score, 1), '62.4');
});

test('drawing set text equals Drawings_Final_Plan.pdf (every dimension, label, schedule row)', () => {
  const p = analysePlan(example.cfg, example.plans[0]);
  const sheets = drawingSet(p, { ...example.drawing, site: example.cfg.location, date: '2026-10-20' });
  const want = loadFixture('final_pdf_text.json');
  assert.equal(sheets.length, 4);
  const norm = (s) => s.replace(/\[([^\]]*)\]/, (_, m) => m).split(', ').sort().join(', ');
  sheets.forEach((sh, i) => {
    const got = sh.items.filter((it) => it.t === 'text').flatMap((it) => it.lines.map((l) => l.s.trim())).filter(Boolean).sort();
    // equal shares of padas are listed in pada order here; the notebook's order follows float noise
    const a = got.map(norm).sort(), b = want[i].map(norm).sort();
    assert.deepEqual(a, b, `sheet ${sh.name}`);
  });
  const pdf = sheetsToPdf(sheets);
  assert.equal(String.fromCharCode(...pdf.slice(0, 8)), '%PDF-1.4');
  assert.ok(sheetToSvg(sheets[0]).startsWith('<svg'));
});

test('wall outline: union of wall strips minus openings is a valid set of loops', () => {
  const loops = rectUnionLoops([{ x0: 0, y0: 0, x1: 10, y1: 1 }, { x0: 0, y0: 0, x1: 1, y1: 10 }], [{ x0: 4, y0: -1, x1: 6, y1: 2 }]);
  const area = loops.reduce((a, l) => a + polyArea(l), 0);
  assert.ok(Math.abs(area - (10 + 9 - 2)) < 1e-9);
});

test('generator: valid candidates on the notebook configuration, better than CP-SAT', () => {
  const res = generate(cfg, { skeletons: [0, 1, 2, 3, 4, 5, 6, 7], perSkeleton: 3, polish: { evals: 40 }, maxCandidates: 6 });
  assert.ok(res.candidates.length >= 2, 'candidates');
  for (const c of res.candidates) assert.equal(c.quality.hard, 0);
  const best = Math.max(...res.candidates.map((c) => c.quality.vaastu));
  assert.ok(best > Math.max(...gg.generated.filter((q) => !q.checks.some((k) => k.hard && !k.ok)).map((q) => q.vaastu_score)), `best ${best}`);
  for (const c of res.candidates) { const p = analysePlan(cfg, c.doc); assert.equal(p.failed.length, 0); }
});

test('generator diagnostics name rooms that cannot be placed', () => {
  const d = diagnose({ ...cfg, ns_ft: 40, program: { ...cfg.program } });
  assert.ok(Array.isArray(d.missing));
  assert.ok(d.skeletons > 0);
});

test('generator: deep plots get strict layouts through stacked slots (the notebook\'s 3-row CP-SAT finds none)', () => {
  // 40 x 30 ft, west road, ground floor, 2 bed / 2 bath: no skeleton has a legal puja / stair slot without stacking
  const deep = { ew_ft: 40, ns_ft: 30, road_side: 'W', floor_level: 0, program: { bedroom: 2, bath: 2 } };
  const res = generate(deep, { skeletons: [7, 14, 16], budget: { beam: 400, perSig: 6, ms: 1500 }, perSkeleton: 2, polish: { evals: 30 }, maxCandidates: 3 });
  assert.ok(res.candidates.length >= 1, 'strict candidates');
  for (const c of res.candidates) {
    assert.equal(analysePlan(deep, c.doc).failed.length, 0);
    assert.ok(c.doc.roadDoor, 'ground floor keeps the road entrance');
  }
  assert.ok(res.candidates.some((c) => /\/(lobby|dining|hall)/.test(c.key)), 'uses a stacked slot');
  // upper floors are entered by the internal stair (hand-sketch revision 2): no road door on generated plans
  assert.equal(generate(cfg, { skeletons: [0], perSkeleton: 1, polish: false, maxCandidates: 1 }).candidates.every((c) => c.doc.roadDoor === false), true);
});
