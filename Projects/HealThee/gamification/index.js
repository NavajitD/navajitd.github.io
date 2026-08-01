// HealThee Gamification — public API (HTGam)
// One hook into health.html: HTGam.onDaySaved(dayData, dateKey).
// Everything else is derived inside this module.

import {
  XP_REWARDS, awardXp, levelForXp, dayQualifiesForStreak, applyQualifiedDay,
  pickDailyChallenges, completeDailyChallenge,
  isoWeekKey, pickWeeklyChallenge, evalWeeklyProgress,
  evaluateBadges, awardGems, dateKeyLocal, BADGES,
  GEM_SOURCES, STREAK_MILESTONES, WEEKLY_CHALLENGE_POOL, DAILY_CHALLENGE_POOL,
  DAILY_AUTO_EVAL,
} from './core.js';
import {
  DEFAULT_STATE, cloneState, makeLocalStorageAdapter, makeFirestoreAdapter,
  makeCompositeAdapter,
} from './store.js';
import * as ui from './ui.js';

// Derive a per-tab activity summary from the host's dayData shape.
// Mirrors emptyDay() shape in health.html.
export function deriveDayActivity(dayData) {
  if (!dayData || typeof dayData !== 'object') return { eat: false, move: false, sleep: false, care: false };
  const foods = Array.isArray(dayData.foods) ? dayData.foods.filter(f => f && !f.deletedAt) : [];
  const steps = Array.isArray(dayData.stepLogs) ? dayData.stepLogs.filter(s => s && !s.deletedAt) : [];
  const custom = Array.isArray(dayData.customExercises) ? dayData.customExercises.filter(s => s && !s.deletedAt) : [];
  const exChecks = countLwwTrue(dayData.exerciseChecks);
  const supplements = countLwwTrue(dayData.supplementChecks);
  const skincare = countLwwTrue(dayData.skincareChecks);
  const haircare = countLwwTrue(dayData.haircareChecks);
  const sleep = dayData.sleep && (dayData.sleep.bedtime || dayData.sleep.wakeup || dayData.sleep.hours);
  const journal = Array.isArray(dayData.chatHistory) && dayData.chatHistory.some(m => m && m.role === 'user');
  return {
    eat: foods.length > 0 || supplements > 0,
    move: steps.length > 0 || custom.length > 0 || exChecks > 0,
    sleep: !!sleep,
    care: journal || skincare > 0 || haircare > 0,
    _details: {
      foods: foods.length, supplements, steps: steps.length, custom: custom.length,
      exChecks, skincare, haircare, journal,
    },
  };
}

function countLwwTrue(m) {
  if (!m || typeof m !== 'object') return 0;
  let n = 0;
  for (const k of Object.keys(m)) {
    const o = m[k];
    if (o && typeof o === 'object') { if (o.v) n++; }
    else if (o) n++;
  }
  return n;
}

// Score XP for a saved day. Idempotent per (uid, dateKey, signature):
// we only award the delta between previously-credited signature and current one.
// Signature captures which discrete events (meals, sleep entry, exercise count, etc.) deserve XP.
export function computeDaySignature(dayData) {
  const a = deriveDayActivity(dayData)._details;
  return {
    meals: a.foods,
    sleepLogged: !!(dayData?.sleep && (dayData.sleep.bedtime || dayData.sleep.wakeup || dayData.sleep.hours)),
    stepEntries: a.steps,
    customEx: a.custom,
    waterLogs: (dayData?.waterLogs || []).filter(w => w && !w.deletedAt).length,
    journal: a.journal ? 1 : 0,
    allThreeMeals: a.foods >= 3,
  };
}

export function diffSignatures(prev, cur) {
  const p = prev || {};
  const c = cur || {};
  const inc = (k) => Math.max(0, (c[k] || 0) - (p[k] || 0));
  const delta = {
    meals: inc('meals'),
    sleepLogged: (!p.sleepLogged && c.sleepLogged) ? 1 : 0,
    stepEntries: inc('stepEntries'),
    customEx: inc('customEx'),
    waterLogs: inc('waterLogs'),
    journal: (!p.journal && c.journal) ? 1 : 0,
    allThreeMeals: (!p.allThreeMeals && c.allThreeMeals) ? 1 : 0,
  };
  let xp = 0;
  xp += delta.meals * XP_REWARDS.logMeal;
  xp += delta.allThreeMeals * XP_REWARDS.logAllThreeMeals;
  xp += delta.sleepLogged * XP_REWARDS.logSleep;
  xp += delta.stepEntries * XP_REWARDS.logSteps;
  xp += delta.customEx * XP_REWARDS.logCustomExercise;
  xp += delta.waterLogs * XP_REWARDS.logWater;
  xp += delta.journal * XP_REWARDS.useMate;
  return { delta, xp };
}

// Updates state based on a single dayData snapshot. Pure (no I/O, no DOM).
// Returns { state, events[] } where events describe what to notify the user about.
// ctx (optional) is the nutrition context from health.html's htGamContext():
// { totals, targets, mealProtein, snackCount, steps, sleepHours, firstMealHour, nowHour, isPast }
export function applyDaySave(prevState, dayData, dateKey, sigCache /* { [dateKey]: sig } */, ctx = null) {
  let state = cloneState(prevState || DEFAULT_STATE);
  const events = [];

  // 1) XP from incremental actions
  const sigPrev = (sigCache && sigCache[dateKey]) || {};
  const sigNow = computeDaySignature(dayData);
  const { xp: xpGained } = diffSignatures(sigPrev, sigNow);
  if (xpGained > 0) {
    const r = awardXp(state, xpGained);
    state = r.state;
    events.push({ type: 'xp', delta: xpGained });
    if (r.leveledUp) {
      events.push({ type: 'levelUp', toLevel: r.toLevel });
      const g = awardGems(state, GEM_SOURCES.levelUp);
      state = g.state;
      events.push({ type: 'gems', delta: g.delta, reason: 'level-up' });
    }
  }

  // 2) Streak — only when the day qualifies (all 4 tabs touched)
  const activity = deriveDayActivity(dayData);
  state.qualifiedDays = state.qualifiedDays || {};
  const wasQualified = !!state.qualifiedDays[dateKey];
  const nowQualified = dayQualifiesForStreak(activity);
  if (nowQualified && !wasQualified) {
    state.qualifiedDays[dateKey] = { ...activity };
    // Trim qualifiedDays to last 14 entries to keep state small.
    const keys = Object.keys(state.qualifiedDays).sort();
    while (keys.length > 14) { delete state.qualifiedDays[keys.shift()]; }

    const before = state.streak?.current || 0;
    const r = applyQualifiedDay(state.streak, dateKey);
    state.streak = r.streak;
    state.stats = state.stats || {};
    state.stats.totalLogs = (state.stats.totalLogs || 0) + 1;
    if (r.comeback) {
      const cb = awardXp(state, XP_REWARDS.comebackBonus);
      state = cb.state;
      events.push({ type: 'comeback', xp: XP_REWARDS.comebackBonus });
    }
    if (r.milestoneHit) {
      events.push({ type: 'streakMilestone', days: r.milestoneHit });
      if (r.milestoneHit === 30) {
        const g = awardGems(state, GEM_SOURCES.streakMilestone30);
        state = g.state;
        events.push({ type: 'gems', delta: g.delta, reason: '30-day streak' });
      }
    }
    if ((state.streak.current || 0) > before) {
      events.push({ type: 'streakUp', current: state.streak.current });
    }
  }

  // 3) Update light stats used by badge predicates
  state.stats = state.stats || {};
  state.stats.totalMeals = (state.stats.totalMeals || 0) + Math.max(0, (sigNow.meals - (sigPrev.meals || 0)));
  state.stats.totalStepEntries = (state.stats.totalStepEntries || 0) + Math.max(0, (sigNow.stepEntries - (sigPrev.stepEntries || 0)));
  state.stats.journalEntries = (state.stats.journalEntries || 0) + Math.max(0, (sigNow.journal - (sigPrev.journal || 0)));

  // 3b) Goal XP — sticky per date, never re-awarded. Signature diffing can't be
  // used here: goal-hit oscillates true→false→true as more food is logged.
  // Calorie goal is a ±5% BAND, deliberately — far under target is a miss.
  if (ctx && ctx.targets) {
    state.awarded = state.awarded || {};
    const aw = state.awarded[dateKey] = state.awarded[dateKey] || {};
    if (!aw.cal && ctx.totals.cal > 0 && Math.abs(ctx.totals.cal - ctx.targets.cal) <= 0.05 * ctx.targets.cal) {
      aw.cal = true;
      const r = awardXp(state, XP_REWARDS.hitCalorieGoal);
      state = r.state;
      events.push({ type: 'xp', delta: XP_REWARDS.hitCalorieGoal, reason: 'calorie goal' });
      if (r.leveledUp) events.push({ type: 'levelUp', toLevel: r.toLevel });
    }
    if (!aw.protein && ctx.totals.protein >= ctx.targets.protein) {
      aw.protein = true;
      const r = awardXp(state, XP_REWARDS.hitProteinGoal);
      state = r.state;
      events.push({ type: 'xp', delta: XP_REWARDS.hitProteinGoal, reason: 'protein goal' });
      if (r.leveledUp) events.push({ type: 'levelUp', toLevel: r.toLevel });
    }
    const awKeys = Object.keys(state.awarded).sort();
    while (awKeys.length > 14) { delete state.awarded[awKeys.shift()]; }
  }

  // 4) Badge evaluation
  const badgeCtx = {
    totalLogs: state.stats.totalLogs,
    streak: state.streak?.current || 0,
    totalMeals: state.stats.totalMeals,
    totalStepEntries: state.stats.totalStepEntries,
    stepGoalHitOnce: state.stats.stepGoalHitOnce,
    sleepGoalStreak: state.stats.sleepGoalStreak,
    journalEntries: state.stats.journalEntries,
    allMacrosHitToday: !!(ctx && ctx.targets
      && ctx.totals.protein >= ctx.targets.protein
      && Math.abs(ctx.totals.carbs - ctx.targets.carbs) <= 0.15 * ctx.targets.carbs
      && Math.abs(ctx.totals.fat - ctx.targets.fat) <= 0.15 * ctx.targets.fat),
    allGoalsSet: false,
  };
  const newBadges = evaluateBadges(badgeCtx, state.badges || []);
  for (const id of newBadges) {
    state.badges.push(id);
    events.push({ type: 'badge', id });
    const g = awardGems(state, GEM_SOURCES.badgeUnlock);
    state = g.state;
    events.push({ type: 'gems', delta: g.delta, reason: 'badge' });
  }

  // 4b) Auto-evaluate the day's picked challenges against the nutrition ctx.
  // Routed through completeDailyChallenge so Bonus Burst logic stays shared.
  if (ctx && ctx.targets) {
    for (const c of pickDailyChallenges(dateKey)) {
      const already = state.dailyChallenges && state.dailyChallenges.dateKey === dateKey
        && (state.dailyChallenges.completed || []).includes(c.id);
      const fn = DAILY_AUTO_EVAL[c.id];
      let hit = false;
      if (!already && fn) { try { hit = !!fn(ctx); } catch { hit = false; } }
      if (hit) {
        const r = completeDailyChallenge(state.dailyChallenges, c.id, dateKey);
        state.dailyChallenges = r.state;
        const x = awardXp(state, XP_REWARDS.completeDailyChallenge);
        state = x.state;
        events.push({ type: 'dailyChallenge', id: c.id, label: c.label });
        if (x.leveledUp) events.push({ type: 'levelUp', toLevel: x.toLevel });
        if (r.bonusBurst) {
          const bb = awardXp(state, XP_REWARDS.bonusBurst);
          state = bb.state;
          const g = awardGems(state, GEM_SOURCES.allDailyChallenges);
          state = g.state;
          events.push({ type: 'bonusBurst', xp: XP_REWARDS.bonusBurst, gems: g.delta });
        }
      }
    }
  }

  // 5) Cache signature so we don't re-award next save
  if (!sigCache) sigCache = {};
  sigCache[dateKey] = sigNow;

  state.lastSeenDate = dateKey;
  return { state, events, sigCache, sigNow };
}

// ── HTGam runtime singleton ─────────────────────────────────────────────────
const HTGam = {
  _ready: false,
  _enabled: false,           // toggled by the Vanilla/Gamified mode switch
  _adapter: null,
  _uid: null,
  _state: cloneState(DEFAULT_STATE),
  _sigCache: {},             // per-date signatures (in-memory only)
  _saveQueue: Promise.resolve(),

  /**
   * @param {object} opts
   * @param {object} [opts.firebaseDb]  Firestore instance (firebase.firestore())
   * @param {string} [opts.uid]         User id
   * @param {boolean} [opts.enabled]    Gamified mode flag
   * @param {Storage} [opts.storage]    Optional localStorage override (for tests)
   */
  async init(opts = {}) {
    const fs = opts.firebaseDb ? makeFirestoreAdapter(opts.firebaseDb) : null;
    const ls = makeLocalStorageAdapter(opts.storage);
    this._adapter = makeCompositeAdapter(fs, ls);
    this._uid = opts.uid || null;
    this._enabled = !!opts.enabled;
    if (this._uid) {
      const loaded = await this._adapter.get(this._uid);
      if (loaded) this._state = loaded;
    }
    this._ready = true;
    return this._state;
  },

  setEnabled(flag) { this._enabled = !!flag; },
  isEnabled() { return this._enabled; },
  isReady() { return this._ready; },

  getState() { return cloneState(this._state); },

  /** Called by health.html every time the user saves a day. ctx is optional nutrition context. */
  async onDaySaved(dayData, dateKey, ctx = null) {
    if (!this._ready || !this._enabled) return null;
    const key = dateKey || dateKeyLocal();
    const r = applyDaySave(this._state, dayData, key, this._sigCache, ctx);
    const prevState = this._state;
    this._state = r.state;
    this._sigCache = r.sigCache;

    // Notify UI for visible events
    for (const ev of r.events) {
      try {
        if (ev.type === 'xp') ui.showXpToast(ev.delta, ev.reason);
        else if (ev.type === 'levelUp') ui.showLevelUp(ev.toLevel);
        else if (ev.type === 'badge') ui.showBadgeUnlock(ev.id);
        else if (ev.type === 'streakMilestone') ui.showStreakMilestone(ev.days);
        else if (ev.type === 'comeback') ui.showComebackBonus(ev.xp);
        else if (ev.type === 'dailyChallenge') ui.showXpToast(XP_REWARDS.completeDailyChallenge, ev.label);
        else if (ev.type === 'bonusBurst') ui.showBonusBurst(ev.xp, ev.gems);
      } catch { /* UI failures must not break logging */ }
    }

    // Persist (debounced via queue serialization)
    this._saveQueue = this._saveQueue.then(() => this._persist()).catch(() => {});
    return { events: r.events, prevState };
  },

  async completeDailyChallenge(challengeId, dateKey) {
    if (!this._ready || !this._enabled) return null;
    const key = dateKey || dateKeyLocal();
    const r = completeDailyChallenge(this._state.dailyChallenges, challengeId, key);
    this._state.dailyChallenges = r.state;
    const x = awardXp(this._state, XP_REWARDS.completeDailyChallenge);
    this._state = x.state;
    ui.showXpToast(XP_REWARDS.completeDailyChallenge, 'Daily Challenge');
    if (x.leveledUp) ui.showLevelUp(x.toLevel);
    if (r.bonusBurst) {
      const bb = awardXp(this._state, XP_REWARDS.bonusBurst);
      this._state = bb.state;
      const g = awardGems(this._state, GEM_SOURCES.allDailyChallenges);
      this._state = g.state;
      ui.showBonusBurst(XP_REWARDS.bonusBurst, g.delta);
    }
    this._saveQueue = this._saveQueue.then(() => this._persist());
    return r;
  },

  todaysDailyChallenges(dateKey) {
    return pickDailyChallenges(dateKey || dateKeyLocal());
  },

  thisWeeksChallenge(dateKey) {
    return pickWeeklyChallenge(isoWeekKey(dateKey || dateKeyLocal()));
  },

  // UI helpers
  renderHud(el)          { ui.renderHud(this._state, el); },
  renderTrophyWall(el)   { ui.renderTrophyWall(this._state, el); },
  renderDailyChallenges(el, dateKey) {
    const key = dateKey || dateKeyLocal();
    ui.renderDailyChallenges(this._state, key, this.todaysDailyChallenges(key), el);
  },

  async _persist() {
    if (!this._adapter || !this._uid) return;
    try { await this._adapter.set(this._uid, this._state); } catch { /* ignore */ }
  },

  // Testing / debug
  _reset() {
    this._state = cloneState(DEFAULT_STATE);
    this._sigCache = {};
  },
};

// Expose to window for the inline health.html script.
if (typeof window !== 'undefined') {
  window.HTGam = HTGam;
}

export default HTGam;
// applyDaySave, deriveDayActivity, computeDaySignature, diffSignatures are
// already `export function ...` declarations above — no re-export needed.
