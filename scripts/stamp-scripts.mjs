// Stamps ?v=<content hash> on the site's own module scripts wherever a page
// or another module loads them, so a browser never mixes a fresh page with a
// stale copy of a script after a deploy (GitHub Pages caches for 10 minutes).
//
//   node scripts/stamp-scripts.mjs           update the stamps
//   node scripts/stamp-scripts.mjs --check   fail if a stamp is out of date
//
// Inner files come first: admin-experience.js imports scripts/experience.js
// and admin-blog.js imports blog-core.js, and admin.html loads both editors.
// blog-post.html loads blog-core.js (the static post pages built from it at
// deploy time load no module at all).

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
export const LINKS = [
  { file: 'admin-experience.js', target: 'scripts/experience.js' },
  { file: 'admin-blog.js', target: 'blog-core.js' },
  { file: 'admin.html', target: 'admin-experience.js' },
  { file: 'admin.html', target: 'admin-blog.js' },
  { file: 'admin.html', target: 'admin-jobs.js' },
  { file: 'blog-post.html', target: 'blog-core.js' },
];

export const versionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);

let stale = 0;
for (const { file, target } of LINKS) {
  const path = join(ROOT, file);
  const text = await readFile(path, 'utf8');
  const v = versionOf(await readFile(join(ROOT, target), 'utf8'));
  const re = new RegExp(`/${target.replace(/[.]/g, '\\.')}\\?v=[0-9a-f]+`, 'g');
  if (!(text.match(re) || []).length) throw new Error(`${file} should load /${target}?v=…`);
  const next = text.replace(re, `/${target}?v=${v}`);
  if (next === text) continue;
  stale++;
  if (check) console.error(`${file}: /${target} should be ?v=${v}. Run: node scripts/stamp-scripts.mjs`);
  else await writeFile(path, next);
}
if (check && stale) process.exit(1);
console.log(check ? 'Script stamps are current.' : `Stamped ${stale} reference(s).`);
