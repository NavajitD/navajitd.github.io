// Stands in for the Firebase compat SDK on admin.html in tests: the admin
// (navjitdebnath5@gmail.com) is signed in (getIdToken gives 'test-id-token'
// for REST reads), every Firestore read through the SDK is empty, and
// writes are recorded in window.__fsWrites instead of being sent anywhere.
// Load it with page.addInitScript and block the real SDK from gstatic.com.
(() => {
  const writes = (window.__fsWrites = []);
  const snap = { empty: true, size: 0, docs: [], forEach() {} };
  const docRef = (path) => ({
    id: path.split('/').pop(),
    get: async () => ({ exists: (window.__fsExisting || []).includes(path), data: () => ({}) }),
    set: async (data) => { writes.push({ op: 'set', path, data }); },
    update: async (data) => { writes.push({ op: 'update', path, data }); },
    delete: async () => { writes.push({ op: 'delete', path }); },
  });
  const query = (name) => {
    const q = {
      where: () => q, orderBy: () => q, limit: () => q, startAfter: () => q,
      get: async () => snap,
      doc: (id) => docRef(`${name}/${id}`),
      add: async (data) => { writes.push({ op: 'add', path: `${name}/test`, data }); return { id: 'test' }; },
    };
    return q;
  };
  const user = { email: 'navjitdebnath5@gmail.com', getIdToken: async () => 'test-id-token' };
  window.firebase = {
    initializeApp() {},
    auth: Object.assign(
      () => ({ currentUser: user, onAuthStateChanged(cb) { setTimeout(() => cb(user), 0); }, signOut() {}, signInWithPopup: async () => ({ user }) }),
      { GoogleAuthProvider: function GoogleAuthProvider() { this.setCustomParameters = () => {}; } },
    ),
    firestore: Object.assign(
      () => ({ collection: (name) => query(name), batch: () => ({ update() {}, commit: async () => {} }) }),
      {
        Timestamp: { fromDate: (d) => ({ __ts: new Date(d).toISOString() }) },
        FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
      },
    ),
  };
})();
