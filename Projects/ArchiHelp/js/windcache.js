// ArchiHelp — local cache for downloaded climate data and computed wind pictures (IndexedDB, separate from projects).
const DB = 'archihelp-cache', STORE = 'kv';
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (!('indexedDB' in self)) { resolve(null); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbp;
}
export async function cacheGet(key) {
  const db = await open(); if (!db) return null;
  return new Promise((resolve) => { const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => resolve(null); });
}
export async function cachePut(key, value) {
  const db = await open(); if (!db) return;
  return new Promise((resolve) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, key); t.oncomplete = () => resolve(); t.onerror = () => resolve(); });
}
/** FNV-1a 32-bit hash of a string (cache keys). */
export function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }
