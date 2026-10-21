// ArchiHelp design engine — public API.
//   analysePlan(cfg, doc)  -> runtime plan: checks, Vaastu rows, doors, furniture, openings, schedules data
//   (generation lives in generator.js; drawings in drawing.js)
import { resolveConfig } from './config.js';
import { buildPlan } from './plan.js';
import { evaluate } from './checker.js';
import { planDoorsAndFurniture, furnitureGaps, furnitureClashes } from './furniture.js';
import { computeOpenings } from './openings.js';
import { designStair } from './stair.js';

export function prepareConfig(cfg) {
  if (cfg && cfg.__resolved) return cfg;
  return Object.assign(resolveConfig(cfg || {}), { __resolved: true });
}

/** Full analysis of one plan document. Never throws on bad geometry: problems become failed checks. */
export function analysePlan(cfgIn, doc, { furniture = true } = {}) {
  const cfg = prepareConfig(cfgIn);
  const plan = buildPlan(cfg, doc);
  plan.stair = designStair(cfg);
  evaluate(plan);
  if (furniture) {
    planDoorsAndFurniture(plan);
    plan.openings = computeOpenings(plan);
    plan.gaps = furnitureGaps(plan);
    plan.clashes = furnitureClashes(plan);
    for (const g of plan.gaps) plan.checks.push({ cat: 'Furniture', name: 'Required furniture fits (doors and clearances respected)', ok: false, hard: false, detail: g });
    for (const c of plan.clashes) plan.checks.push({ cat: 'Furniture', name: 'Furniture clear of walls and other items', ok: false, hard: false, detail: c });
    if (!plan.gaps.length) plan.checks.push({ cat: 'Furniture', name: 'Required furniture fits (doors and clearances respected)', ok: true, hard: false, detail: 'all rooms' });
  }
  return plan;
}

export { resolveConfig };
