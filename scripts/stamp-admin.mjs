// Stamps ?v=<content hash> on the admin console's own scripts, so a browser
// never keeps a stale copy after a deploy (GitHub Pages caches for 10 minutes).
//
//   node scripts/stamp-admin.mjs           update the stamps
//   node scripts/stamp-admin.mjs --check   fail if a stamp is out of date
//
// admin-experience.js imports scripts/experience.js, and admin.html loads
// admin-experience.js, so the inner file is stamped first.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const LINKS = [
  { file: 'admin-experience.js', target: 'scripts/experience.js' },
  { file: 'admin.html', target: 'admin-experience.js' },
];

export const versionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);

let stale = 0;
for (const { file, target } of LINKS) {
  const path = join(ROOT, file);
  const text = await readFile(path, 'utf8');
  const v = versionOf(await readFile(join(ROOT, target), 'utf8'));
  const re = new RegExp(`/${target.replace(/[.]/g, '\\.')}\\?v=[0-9a-f]+`, 'g');
  const found = text.match(re) || [];
  if (found.length !== 1) throw new Error(`${file} should reference /${target}?v=… once (found ${found.length}).`);
  const next = text.replace(re, `/${target}?v=${v}`);
  if (next === text) continue;
  stale++;
  if (check) console.error(`${file}: /${target} should be ?v=${v}. Run: node scripts/stamp-admin.mjs`);
  else await writeFile(path, next);
}
if (check && stale) process.exit(1);
console.log(check ? 'Admin script stamps are current.' : `Stamped ${stale} reference(s).`);
