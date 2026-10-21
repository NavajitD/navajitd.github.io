// Vaastu Planner — projects persist in this browser (IndexedDB, localStorage fallback). No account, no server.
const DB = 'vaastu-planner', STORE = 'projects', LS = 'vaastu-planner:projects';
let dbp = null;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (!('indexedDB' in self)) { resolve(null); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbp;
}
const tx = async (mode, fn) => {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), st = t.objectStore(STORE), r = fn(st);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
};
const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };

export async function listProjects() {
  const all = await tx('readonly', (st) => st.getAll());
  const arr = all || Object.values(lsAll());
  return arr.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
export async function getProject(id) {
  const p = await tx('readonly', (st) => st.get(id));
  return p === null ? lsAll()[id] : p;
}
export async function saveProject(p) {
  p.updated = Date.now();
  const r = await tx('readwrite', (st) => st.put(p));
  if (r === null) { const all = lsAll(); all[p.id] = p; localStorage.setItem(LS, JSON.stringify(all)); }
  return p;
}
export async function deleteProject(id) {
  const r = await tx('readwrite', (st) => st.delete(id));
  if (r === null) { const all = lsAll(); delete all[id]; localStorage.setItem(LS, JSON.stringify(all)); }
}
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
