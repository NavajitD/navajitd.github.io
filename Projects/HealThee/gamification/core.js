// HealThee Gamification — Phase 1 pure logic
// No DOM. No I/O. Safe to import in Node for tests.

// ── XP table (per GAMIFICATION_PLAN.md §1) ──────────────────────────────────
export const XP_REWARDS = Object.freeze({
  logMeal: 5,
  logAllThreeMeals: 10,        // bonus, in addition to per-meal
  hitCalorieGoal: 15,
  hitProteinGoal: 15,
  logSleep: 5,
  hitSleepGoal: 10,
  logSteps: 5,
  hitStepGoal: 15,
  logCustomExercise: 10,
  logWater: 3,
  useMate: 5,                  // capped at once/day
  completeDailyChallenge: 25,
  completeWeeklyChallenge: 75,
  bonusBurst: 50,              // all 3 daily challenges in one day
  comebackBonus: 20,           // first log after a streak break
});

// ── Level table (cumulative XP thresholds) ──────────────────────────────────
export const LEVELS = Object.freeze([
  { lvl: 1,  title: 'Seedling',   xp: 0 },
  { lvl: 2,  title: 'Sprout',     xp: 150 },
  { lvl: 3,  title: 'Sapling',    xp: 400 },
  { lvl: 4,  title: 'Grower',     xp: 800 },
  { lvl: 5,  title: 'Nurturer',   xp: 1400 },
  { lvl: 6,  title: 'Cultivator', xp: 2200 },
  { lvl: 7,  title: 'Sustainer',  xp: 3200 },
  { lvl: 8,  title: 'Thriver',    xp: 4500 },
  { lvl: 9,  title: 'Vitalist',   xp: 6200 },
  { lvl: 10, title: 'Luminary',   xp: 8500 },
  { lvl: 11, title: 'Greek God',  xp: 12000 },
]);
const ASCENDED_STEP = 3000;    // +3000 per tier past level 11

export function levelForXp(totalXp) {
  const xp = Math.max(0, Math.floor(totalXp || 0));
  let cur = LEVELS[0];
  for (const L of LEVELS) {
    if (xp >= L.xp) cur = L;
    else break;
  }
  if (xp < LEVELS[LEVELS.length - 1].xp) {
    return { ...cur };
  }
  // Ascended tiers past Greek God
  const beyond = xp - LEVELS[LEVELS.length - 1].xp;
  const extra = Math.floor(beyond / ASCENDED_STEP);
  if (extra === 0) return { ...cur };
  return { lvl: 11 + extra, title: `Ascended ${extra}`, xp: LEVELS[LEVELS.length - 1].xp + extra * ASCENDED_STEP };
}

export function xpToNextLevel(totalXp) {
  const cur = levelForXp(totalXp);
  const next = nextLevelThreshold(cur.lvl);
  return Math.max(0, next - Math.floor(totalXp || 0));
}

export function nextLevelThreshold(curLvl) {
  if (curLvl < LEVELS.length) return LEVELS[curLvl].xp; // LEVELS is 0-indexed; LEVELS[curLvl] is next
  // Past level 11, each tier is +3000
  const beyondTiers = curLvl - 11;
  return LEVELS[LEVELS.length - 1].xp + (beyondTiers + 1) * ASCENDED_STEP;
}

export function progressToNextLevel(totalXp) {
  const cur = levelForXp(totalXp);
  const curThreshold = cur.xp;
  const nextThreshold = nextLevelThreshold(cur.lvl);
  const span = nextThreshold - curThreshold;
  if (span <= 0) return 1;
  const into = Math.max(0, Math.floor(totalXp || 0) - curThreshold);
  return Math.min(1, into / span);
}

export function awardXp(state, amount, reason = '') {
  const delta = Math.max(0, Math.floor(amount || 0));
  if (!state || typeof state !== 'object') return { state, leveledUp: false, delta: 0 };
  const before = levelForXp(state.xp || 0);
  const newXp = (state.xp || 0) + delta;
  const after = levelForXp(newXp);
  const leveledUp = after.lvl > before.lvl;
  return {
    state: { ...state, xp: newXp },
    delta,
    reason,
    leveledUp,
    fromLevel: before,
    toLevel: after,
  };
}

// ── Streak logic (per GAMIFICATION_PLAN.md §2) ──────────────────────────────
// A streak day is "valid" when the user logs at least one entry in each of the
// four tabs (Eat, Move, Sleep, Care) on that calendar day. Callers compute
// `qualified` (boolean) per day and feed it in here.

export const TABS = Object.freeze(['eat', 'move', 'sleep', 'care']);

export function dayQualifiesForStreak(dayLog) {
  if (!dayLog) return false;
  return TABS.every(t => !!dayLog[t]);
}

// dateKey: 'YYYY-MM-DD'. Returns the calendar diff in days (today − last).
export function dayDiff(lastDateKey, todayDateKey) {
  if (!lastDateKey || !todayDateKey) return Infinity;
  const a = new Date(lastDateKey + 'T00:00:00Z').getTime();
  const b = new Date(todayDateKey + 'T00:00:00Z').getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86400000);
}

// Advance streak for a newly-qualified day.
// streak: { current, longest, lastQualifiedDate, freezesBanked, daysSinceFreezeEarn }
// Returns updated streak + comebackBonus flag.
export function applyQualifiedDay(streak, todayDateKey) {
  const s = {
    current: 0, longest: 0, lastQualifiedDate: null,
    freezesBanked: 0, daysSinceFreezeEarn: 0,
    ...(streak || {}),
  };
  if (s.lastQualifiedDate === todayDateKey) {
    // Same day, already counted — no-op.
    return { streak: s, comeback: false, freezeConsumed: false, milestoneHit: null };
  }
  const diff = dayDiff(s.lastQualifiedDate, todayDateKey);
  let comeback = false;
  let freezeConsumed = false;

  if (s.lastQualifiedDate == null || diff === 1) {
    s.current = (s.current || 0) + 1;
  } else if (diff === 2 && (s.freezesBanked || 0) > 0) {
    // Gap of 1 missed day, but a freeze covers it.
    s.freezesBanked -= 1;
    s.current = (s.current || 0) + 1;
    freezeConsumed = true;
  } else if (diff <= 0) {
    // Out-of-order or duplicate; treat conservatively as same-day.
    return { streak: s, comeback: false, freezeConsumed: false, milestoneHit: null };
  } else {
    // Streak broken.
    s.current = 1;
    comeback = true;
  }

  s.lastQualifiedDate = todayDateKey;
  if (s.current > (s.longest || 0)) s.longest = s.current;

  // Earn a freeze every 14 days of continuous streaking, max 2 banked.
  s.daysSinceFreezeEarn = (s.daysSinceFreezeEarn || 0) + 1;
  if (s.daysSinceFreezeEarn >= 14 && (s.freezesBanked || 0) < 2) {
    s.freezesBanked = Math.min(2, (s.freezesBanked || 0) + 1);
    s.daysSinceFreezeEarn = 0;
  }

  const milestoneHit = STREAK_MILESTONES.find(m => m === s.current) || null;
  return { streak: s, comeback, freezeConsumed, milestoneHit };
}

export const STREAK_MILESTONES = Object.freeze([3, 7, 14, 21, 30, 60, 90, 180, 365]);

// ── Daily Challenges (per §4) ───────────────────────────────────────────────
// Phase 1: pool of 20, pick 3/day (deterministic by date), Bonus Burst on all 3.
export const DAILY_CHALLENGE_POOL = Object.freeze([
  // Nutrition (6)
  { id: 'n1', cat: 'eat',   label: 'Log breakfast before 10:00 AM' },
  { id: 'n2', cat: 'eat',   label: 'Eat at least 30g protein at lunch' },
  { id: 'n3', cat: 'eat',   label: 'Stay within 100 kcal of your calorie goal' },
  { id: 'n4', cat: 'eat',   label: 'Log a meal with 5+ ingredients' },
  { id: 'n5', cat: 'eat',   label: 'Avoid snacks for the entire day' },
  { id: 'n6', cat: 'eat',   label: 'Try a meal you have not logged before' },
  // Movement (5)
  { id: 'm1', cat: 'move',  label: 'Walk 8,000+ steps today' },
  { id: 'm2', cat: 'move',  label: 'Log at least 20 minutes of cardio' },
  { id: 'm3', cat: 'move',  label: 'Do two separate exercise sessions' },
  { id: 'm4', cat: 'move',  label: 'Hit your step goal before 6 PM' },
  { id: 'm5', cat: 'move',  label: 'Add a new custom exercise' },
  // Sleep (4)
  { id: 's1', cat: 'sleep', label: 'Be in bed by 11:00 PM' },
  { id: 's2', cat: 'sleep', label: 'Get at least 7.5 hours of sleep' },
  { id: 's3', cat: 'sleep', label: 'Wake up within 15 minutes of your target wake time' },
  { id: 's4', cat: 'sleep', label: 'Log sleep before 9:00 AM' },
  // Mindfulness (5)
  { id: 'c1', cat: 'care',  label: 'Write a journal entry of at least 50 words' },
  { id: 'c2', cat: 'care',  label: 'Ask HealThee Mate one health question' },
  { id: 'c3', cat: 'care',  label: 'Reflect on what you ate today in the Care tab' },
  { id: 'c4', cat: 'care',  label: 'Log your mood with a short note' },
  { id: 'c5', cat: 'care',  label: 'Spend 2 minutes on a breathing exercise' },
]);

// Deterministic 32-bit hash; same dateKey produces the same 3 challenges.
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickDailyChallenges(dateKey, pool = DAILY_CHALLENGE_POOL, n = 3) {
  const arr = pool.slice();
  // Fisher-Yates seeded by hash of dateKey
  let seed = hash32(dateKey || '');
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr.slice(0, Math.min(n, arr.length));
}

export function completeDailyChallenge(dailyState, challengeId, dateKey) {
  const s = { dateKey: null, completed: [], bonusBurstClaimed: false, ...(dailyState || {}) };
  if (s.dateKey !== dateKey) {
    s.dateKey = dateKey;
    s.completed = [];
    s.bonusBurstClaimed = false;
  }
  if (!s.completed.includes(challengeId)) s.completed.push(challengeId);
  const allThree = s.completed.length >= 3 && !s.bonusBurstClaimed;
  if (allThree) s.bonusBurstClaimed = true;
  return { state: s, bonusBurst: allThree };
}

// ── Weekly Challenges (per §5) ──────────────────────────────────────────────
export const WEEKLY_CHALLENGE_POOL = Object.freeze([
  { id: 'w_protein',  label: 'Protein Week — hit your protein goal every day for 7 days',  metric: 'proteinGoalDays',  target: 7 },
  { id: 'w_steps',    label: 'Step Challenge — accumulate 70,000 steps this week',          metric: 'stepsTotal',        target: 70000 },
  { id: 'w_sleep',    label: 'Sleep Reset — average 7+ hours of sleep across all 7 days',   metric: 'sleepAvgHours',     target: 7 },
  { id: 'w_full',     label: 'Full Logger — log all four tabs every single day',            metric: 'fullLogDays',       target: 7 },
  { id: 'w_mindful',  label: 'Mindful Week — write a journal entry every day',              metric: 'journalDays',       target: 7 },
  { id: 'w_caloric',  label: 'Calorie Precision — stay within ±5% of calorie goal 5/7 days', metric: 'calorieHitDays',   target: 5 },
]);

// ISO week key, e.g. 2026-W20
export function isoWeekKey(date) {
  const d = (date instanceof Date) ? new Date(date) : new Date(date + 'T00:00:00Z');
  d.setUTCHours(0, 0, 0, 0);
  // Thursday in current week
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function pickWeeklyChallenge(weekKey, pool = WEEKLY_CHALLENGE_POOL) {
  if (!pool.length) return null;
  const idx = hash32(weekKey || '') % pool.length;
  return pool[idx];
}

export function evalWeeklyProgress(challenge, metrics) {
  if (!challenge) return { progress: 0, complete: false };
  const v = (metrics || {})[challenge.metric] || 0;
  const progress = Math.min(1, v / Math.max(1, challenge.target));
  return { progress, complete: v >= challenge.target, value: v };
}

// ── Badges (Phase 1: 15 core) ───────────────────────────────────────────────
export const BADGES = Object.freeze([
  // Consistency (8) — streak based
  { id: 'first_step',       cat: 'consistency', name: 'First Step',       test: ctx => ctx.totalLogs >= 1 },
  { id: 'three_peat',       cat: 'consistency', name: 'Three-peat',       test: ctx => (ctx.streak || 0) >= 3 },
  { id: 'week_warrior',     cat: 'consistency', name: 'Week Warrior',     test: ctx => (ctx.streak || 0) >= 7 },
  { id: 'fortnight_focus',  cat: 'consistency', name: 'Fortnight Focus',  test: ctx => (ctx.streak || 0) >= 14 },
  { id: 'monthly_maven',    cat: 'consistency', name: 'Monthly Maven',    test: ctx => (ctx.streak || 0) >= 30 },
  { id: 'quarter_century',  cat: 'consistency', name: 'Quarter Century',  test: ctx => (ctx.streak || 0) >= 90 },
  { id: 'half_year_hero',   cat: 'consistency', name: 'Half Year Hero',   test: ctx => (ctx.streak || 0) >= 180 },
  { id: 'annual_legend',    cat: 'consistency', name: 'Annual Legend',    test: ctx => (ctx.streak || 0) >= 365 },
  // Nutrition (2)
  { id: 'macro_mind',       cat: 'nutrition',   name: 'Macro Mind',       test: ctx => !!ctx.allMacrosHitToday },
  { id: 'the_100',          cat: 'nutrition',   name: 'The 100',          test: ctx => (ctx.totalMeals || 0) >= 100 },
  // Movement (2)
  { id: 'on_your_feet',     cat: 'movement',    name: 'On Your Feet',     test: ctx => (ctx.totalStepEntries || 0) >= 1 },
  { id: 'step_starter',     cat: 'movement',    name: 'Step Starter',     test: ctx => !!ctx.stepGoalHitOnce },
  // Sleep (1)
  { id: 'sleep_scholar',    cat: 'sleep',       name: 'Sleep Scholar',    test: ctx => (ctx.sleepGoalStreak || 0) >= 7 },
  // Care (1)
  { id: 'first_thoughts',   cat: 'care',        name: 'First Thoughts',   test: ctx => (ctx.journalEntries || 0) >= 1 },
  // Special (1)
  { id: 'goal_setter',      cat: 'special',     name: 'Goal Setter',      test: ctx => !!ctx.allGoalsSet },
]);

export function evaluateBadges(ctx, alreadyEarned = []) {
  const earned = new Set(alreadyEarned);
  const newlyEarned = [];
  for (const b of BADGES) {
    if (earned.has(b.id)) continue;
    try {
      if (b.test(ctx || {})) newlyEarned.push(b.id);
    } catch { /* ignore badge predicate errors */ }
  }
  return newlyEarned;
}

// ── Gems (Phase 1: earn-only) ───────────────────────────────────────────────
export const GEM_SOURCES = Object.freeze({
  allDailyChallenges: 1,
  weeklyChallenge: 3,
  levelUp: 2,
  streakMilestone30: 5,
  badgeUnlock: 1,
});

export function awardGems(state, amount) {
  const delta = Math.max(0, Math.floor(amount || 0));
  const before = (state && state.gems) || 0;
  return { state: { ...(state || {}), gems: before + delta }, delta };
}

// ── Date helpers ────────────────────────────────────────────────────────────
export function dateKeyLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
