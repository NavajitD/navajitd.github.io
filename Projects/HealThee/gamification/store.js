// HealThee Gamification — persistence layer
// Firestore primary, localStorage mirror for offline + first-paint speed.
// Pure of DOM; safe to import in Node (Firestore calls only fire when adapters are passed in).

export const DEFAULT_STATE = Object.freeze({
  schemaVersion: 1,
  xp: 0,
  gems: 0,
  streak: {
    current: 0,
    longest: 0,
    lastQualifiedDate: null,
    freezesBanked: 0,
    daysSinceFreezeEarn: 0,
  },
  dailyChallenges: {
    dateKey: null,
    completed: [],
    bonusBurstClaimed: false,
  },
  weeklyChallenge: {
    weekKey: null,
    challengeId: null,
    progress: 0,
    completed: false,
  },
  badges: [],                  // array of badge ids
  stats: {
    totalLogs: 0,              // any-day full-qualified day count (for First Step etc.)
    totalMeals: 0,
    totalStepEntries: 0,
    journalEntries: 0,
    sleepGoalStreak: 0,
    stepGoalHitOnce: false,
  },
  qualifiedDays: {},           // { 'YYYY-MM-DD': { eat, move, sleep, care } } — last 7 days only
  lastSeenDate: null,
});

export function cloneState(s) {
  return JSON.parse(JSON.stringify(s || DEFAULT_STATE));
}

// Merge stored state with DEFAULT_STATE so older saves (or partial writes) still load cleanly.
export function migrateState(raw) {
  const base = cloneState(DEFAULT_STATE);
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    streak: { ...base.streak, ...(raw.streak || {}) },
    dailyChallenges: { ...base.dailyChallenges, ...(raw.dailyChallenges || {}) },
    weeklyChallenge: { ...base.weeklyChallenge, ...(raw.weeklyChallenge || {}) },
    stats: { ...base.stats, ...(raw.stats || {}) },
    badges: Array.isArray(raw.badges) ? raw.badges.slice() : [],
    qualifiedDays: (raw.qualifiedDays && typeof raw.qualifiedDays === 'object') ? raw.qualifiedDays : {},
  };
}

const LS_PREFIX = 'HT_gam_v1_';

export function lsKey(uid) {
  return LS_PREFIX + (uid || 'anon');
}

// Storage adapter interface:
//   { get(uid) -> Promise<state|null>, set(uid, state) -> Promise<void> }
// Two reference adapters provided. health.html can pass in a Firestore adapter at init.

export function makeLocalStorageAdapter(storage) {
  const s = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  return {
    async get(uid) {
      if (!s) return null;
      try {
        const raw = s.getItem(lsKey(uid));
        return raw ? migrateState(JSON.parse(raw)) : null;
      } catch { return null; }
    },
    async set(uid, state) {
      if (!s) return;
      try { s.setItem(lsKey(uid), JSON.stringify(state)); } catch { /* quota — ignore */ }
    },
  };
}

export function makeFirestoreAdapter(db) {
  return {
    async get(uid) {
      if (!db || !uid) return null;
      try {
        const doc = await db.collection('users').doc(uid).collection('meta').doc('gamification').get();
        return doc.exists ? migrateState(doc.data()) : null;
      } catch { return null; }
    },
    async set(uid, state) {
      if (!db || !uid) return;
      try {
        await db.collection('users').doc(uid).collection('meta').doc('gamification').set(state, { merge: true });
      } catch { /* offline — localStorage mirror catches it */ }
    },
  };
}

// Composite adapter: read prefers Firestore but falls back to local; write fans out to both.
export function makeCompositeAdapter(firestoreAdapter, localAdapter) {
  return {
    async get(uid) {
      const remote = firestoreAdapter ? await firestoreAdapter.get(uid) : null;
      if (remote) return remote;
      return localAdapter ? localAdapter.get(uid) : null;
    },
    async set(uid, state) {
      // Local first (sync mirror); Firestore in parallel.
      if (localAdapter) await localAdapter.set(uid, state);
      if (firestoreAdapter) firestoreAdapter.set(uid, state); // fire-and-forget
    },
  };
}

// In-memory adapter for tests.
export function makeMemoryAdapter() {
  const store = new Map();
  return {
    async get(uid) { return store.has(uid) ? migrateState(JSON.parse(store.get(uid))) : null; },
    async set(uid, state) { store.set(uid, JSON.stringify(state)); },
    _dump: () => store,
  };
}
