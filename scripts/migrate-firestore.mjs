// One-time Firestore migration: numo-3984a  →  recipes-7dc22 ("Site Admin").
//
// Copies the site-content collections out of the shared Numo project into the
// dedicated Site Admin project, PRESERVING DOCUMENT IDS (blog-post links use
// ?id=<docId>, so ids must survive). Idempotent — re-running overwrites, never
// duplicates. Field types (Timestamps, arrays, numbers) are preserved because
// the Admin SDK reads/writes native values.
//
// Usage:
//   npm i firebase-admin            # one-time (dev dependency)
//   node scripts/migrate-firestore.mjs <numo-sa.json> <site-sa.json> [--dry-run]
//
// Where the two args are service-account JSON keys downloaded from:
//   numo-3984a    → Project settings → Service accounts → Generate new private key
//   recipes-7dc22 → same
// These keys are gitignored; never commit them.

import { readFile } from 'node:fs/promises';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const COLLECTIONS = ['posts', 'analytics_events'];
const BATCH = 450; // Firestore hard cap is 500 writes/commit; stay safely under.

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [numoPath, sitePath] = args.filter((a) => !a.startsWith('--'));

if (!numoPath || !sitePath) {
  console.error('Usage: node scripts/migrate-firestore.mjs <numo-sa.json> <site-sa.json> [--dry-run]');
  process.exit(1);
}

const numoSA = JSON.parse(await readFile(numoPath, 'utf8'));
const siteSA = JSON.parse(await readFile(sitePath, 'utf8'));

console.log(`Source: ${numoSA.project_id}   →   Dest: ${siteSA.project_id}${dryRun ? '   [DRY RUN]' : ''}`);
if (numoSA.project_id !== 'numo-3984a' || siteSA.project_id !== 'recipes-7dc22') {
  console.warn('⚠ Unexpected project ids — double-check you passed the keys in the right order (numo first, site second).');
}

const src = getFirestore(initializeApp({ credential: cert(numoSA) }, 'src'));
const dst = getFirestore(initializeApp({ credential: cert(siteSA) }, 'dst'));

async function migrate(coll) {
  const snap = await src.collection(coll).get();
  console.log(`\n${coll}: ${snap.size} docs in source`);
  if (dryRun) { console.log('  (dry run — not writing)'); return snap.size; }

  let written = 0;
  let batch = dst.batch();
  let inBatch = 0;
  for (const doc of snap.docs) {
    batch.set(dst.collection(coll).doc(doc.id), doc.data()); // same id, full overwrite
    if (++inBatch >= BATCH) {
      await batch.commit();
      written += inBatch;
      process.stdout.write(`  …${written}/${snap.size}\r`);
      batch = dst.batch();
      inBatch = 0;
    }
  }
  if (inBatch) { await batch.commit(); written += inBatch; }
  console.log(`  ✓ ${coll}: wrote ${written} docs`);
  return written;
}

let total = 0;
for (const coll of COLLECTIONS) total += await migrate(coll);
console.log(`\n${dryRun ? 'Would migrate' : 'Migrated'} ${total} docs total.`);
console.log('Next: run `npm run build:blog` (now pointed at recipes-7dc22) to regenerate posts.json.');
process.exit(0);
