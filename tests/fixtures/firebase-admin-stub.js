// Stands in for the Firebase compat SDK on admin.html in tests: the admin
// (navjitdebnath5@gmail.com) is signed in and every Firestore read is empty.
// Load it with page.addInitScript and block the real SDK from gstatic.com.
(() => {
  const snap = { empty: true, size: 0, docs: [], forEach() {} };
  const docRef = { get: async () => ({ exists: false, data: () => ({}) }), update: async () => {}, delete: async () => {}, set: async () => {} };
  const query = {
    where: () => query, orderBy: () => query, limit: () => query, startAfter: () => query,
    get: async () => snap, doc: () => docRef, add: async () => ({ id: 'test' }),
  };
  const user = { email: 'navjitdebnath5@gmail.com' };
  window.firebase = {
    initializeApp() {},
    auth: Object.assign(
      () => ({ onAuthStateChanged(cb) { setTimeout(() => cb(user), 0); }, signOut() {}, signInWithPopup: async () => ({ user }) }),
      { GoogleAuthProvider: function GoogleAuthProvider() { this.setCustomParameters = () => {}; } },
    ),
    firestore: Object.assign(
      () => ({ collection: () => query, batch: () => ({ update() {}, commit: async () => {} }) }),
      { Timestamp: { fromDate: (d) => d }, FieldValue: { serverTimestamp: () => null } },
    ),
  };
})();
