// Rebuilds the Experience section of index.html from content/experience.json.
//
//   node scripts/build-experience.mjs           rewrite index.html
//   node scripts/build-experience.mjs --check   fail if index.html is out of date
//
// The "Build experience" GitHub Action (.github/workflows/experience.yml) runs
// this on every push that changes the JSON, which is what the admin console
// (admin.html → Experience) commits, and then commits index.html. The page
// stays static: nothing is fetched when a visitor loads it.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyExperience, validateExperience } from './experience.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_FILE = join(ROOT, 'content', 'experience.json');
const PAGE = join(ROOT, 'index.html');
const check = process.argv.includes('--check');

const raw = await readFile(JSON_FILE, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`content/experience.json is not valid JSON: ${e.message}`);
  process.exit(1);
}
const errors = validateExperience(data);
if (errors.length) {
  console.error(`content/experience.json needs fixing:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

// The hash of the exact bytes lets the admin console tell when its commit is live.
const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12);
const html = await readFile(PAGE, 'utf8');
const next = applyExperience(html, data, hash);

if (check) {
  if (next !== html) {
    console.error('index.html is out of date with content/experience.json. Run: node scripts/build-experience.mjs');
    process.exit(1);
  }
  console.log(`index.html matches content/experience.json (${hash}).`);
} else if (next === html) {
  console.log(`index.html already matches content/experience.json (${hash}).`);
} else {
  await writeFile(PAGE, next);
  const roles = data.roles.filter((r) => !r.archived);
  const cards = roles.reduce((n, r) => n + (r.cards || []).filter((c) => !c.archived).length, 0);
  console.log(`Rebuilt the Experience section: ${roles.length} roles, ${cards} cards (${hash}).`);
}
