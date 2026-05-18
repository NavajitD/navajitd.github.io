import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  XP_REWARDS, LEVELS, levelForXp, xpToNextLevel, progressToNextLevel,
  awardXp, dayQualifiesForStreak, dayDiff, applyQualifiedDay, STREAK_MILESTONES,
  pickDailyChallenges, completeDailyChallenge, DAILY_CHALLENGE_POOL,
  isoWeekKey, pickWeeklyChallenge, evalWeeklyProgress, WEEKLY_CHALLENGE_POOL,
  evaluateBadges, awardGems, dateKeyLocal,
} from '../../Projects/HealThee/gamification/core.js';

// ── XP & Levels ─────────────────────────────────────────────────────────────
test('levelForXp returns Seedling at 0 XP', () => {
  assert.equal(levelForXp(0).title, 'Seedling');
  assert.equal(levelForXp(0).lvl, 1);
});

test('levelForXp returns correct level at each threshold', () => {
  assert.equal(levelForXp(149).lvl, 1);
  assert.equal(levelForXp(150).lvl, 2);
  assert.equal(levelForXp(399).lvl, 2);
  assert.equal(levelForXp(400).lvl, 3);
  assert.equal(levelForXp(8500).lvl, 10);
  assert.equal(levelForXp(12000).lvl, 11);
  assert.equal(levelForXp(12000).title, 'Greek God');
});

test('Ascended tiers past Greek God add +3000 each', () => {
  assert.equal(levelForXp(15000).lvl, 12);
  assert.equal(levelForXp(18000).lvl, 13);
  assert.equal(levelForXp(15000).title, 'Ascended 1');
});

test('xpToNextLevel decreases as XP grows within a level', () => {
  const a = xpToNextLevel(0);
  const b = xpToNextLevel(100);
  assert.ok(b < a);
  assert.equal(a, 150);
  assert.equal(b, 50);
});

test('progressToNextLevel returns 0..1 within current level', () => {
  assert.equal(progressToNextLevel(0), 0);
  assert.equal(progressToNextLevel(75), 0.5);
  assert.ok(progressToNextLevel(149) > 0.99);
});

test('awardXp grants delta and flags level-up', () => {
  const r1 = awardXp({ xp: 140 }, 20);
  assert.equal(r1.state.xp, 160);
  assert.equal(r1.leveledUp, true);
  assert.equal(r1.toLevel.title, 'Sprout');

  const r2 = awardXp({ xp: 140 }, 5);
  assert.equal(r2.leveledUp, false);
});

test('awardXp clamps negative and bad inputs to 0', () => {
  assert.equal(awardXp({ xp: 100 }, -50).state.xp, 100);
  assert.equal(awardXp({ xp: 100 }, NaN).state.xp, 100);
  assert.equal(awardXp({ xp: 100 }, '5').state.xp, 105);
});

test('XP rewards match plan §1', () => {
  assert.equal(XP_REWARDS.logMeal, 5);
  assert.equal(XP_REWARDS.completeDailyChallenge, 25);
  assert.equal(XP_REWARDS.completeWeeklyChallenge, 75);
  assert.equal(XP_REWARDS.bonusBurst, 50);
  assert.equal(XP_REWARDS.comebackBonus, 20);
});

// ── Streaks ─────────────────────────────────────────────────────────────────
test('dayQualifiesForStreak requires all four tabs', () => {
  assert.equal(dayQualifiesForStreak({ eat: 1, move: 1, sleep: 1, care: 1 }), true);
  assert.equal(dayQualifiesForStreak({ eat: 1, move: 1, sleep: 1 }), false);
  assert.equal(dayQualifiesForStreak(null), false);
});

test('dayDiff handles standard date strings', () => {
  assert.equal(dayDiff('2026-05-17', '2026-05-18'), 1);
  assert.equal(dayDiff('2026-05-17', '2026-05-19'), 2);
  assert.equal(dayDiff(null, '2026-05-18'), Infinity);
});

test('applyQualifiedDay starts a streak from zero', () => {
  const r = applyQualifiedDay({}, '2026-05-17');
  assert.equal(r.streak.current, 1);
  assert.equal(r.streak.longest, 1);
  assert.equal(r.comeback, false);
});

test('applyQualifiedDay extends streak on consecutive days', () => {
  let s = applyQualifiedDay({}, '2026-05-17').streak;
  s = applyQualifiedDay(s, '2026-05-18').streak;
  s = applyQualifiedDay(s, '2026-05-19').streak;
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
});

test('applyQualifiedDay same-day is idempotent', () => {
  const r1 = applyQualifiedDay({}, '2026-05-17');
  const r2 = applyQualifiedDay(r1.streak, '2026-05-17');
  assert.equal(r2.streak.current, 1);
});

test('applyQualifiedDay consumes a banked freeze on 1-day gap', () => {
  let s = applyQualifiedDay({}, '2026-05-17').streak;
  s = { ...s, freezesBanked: 1 };
  const r = applyQualifiedDay(s, '2026-05-19'); // 1 day missed
  assert.equal(r.streak.current, 2);
  assert.equal(r.streak.freezesBanked, 0);
  assert.equal(r.freezeConsumed, true);
});

test('applyQualifiedDay resets streak after gap if no freeze, flags comeback', () => {
  let s = applyQualifiedDay({}, '2026-05-17').streak;
  s.current = 5; s.longest = 5;
  const r = applyQualifiedDay(s, '2026-05-22'); // 5 day gap, no freeze
  assert.equal(r.streak.current, 1);
  assert.equal(r.streak.longest, 5);          // longest preserved
  assert.equal(r.comeback, true);
});

test('Freeze earned every 14 days, max 2 banked', () => {
  let s = {};
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    s = applyQualifiedDay(s, d).streak;
  }
  assert.equal(s.freezesBanked, 1);
  for (let i = 14; i < 28; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    s = applyQualifiedDay(s, d).streak;
  }
  assert.equal(s.freezesBanked, 2);
  // 14 more days; cap at 2.
  for (let i = 28; i < 42; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    s = applyQualifiedDay(s, d).streak;
  }
  assert.equal(s.freezesBanked, 2);
});

test('Streak milestones fire at 3/7/14/...', () => {
  let s = {};
  const fires = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const r = applyQualifiedDay(s, d);
    s = r.streak;
    if (r.milestoneHit) fires.push(r.milestoneHit);
  }
  assert.deepEqual(fires, [3, 7, 14, 21, 30]);
});

test('STREAK_MILESTONES is the documented set', () => {
  assert.deepEqual([...STREAK_MILESTONES], [3, 7, 14, 21, 30, 60, 90, 180, 365]);
});

// ── Daily Challenges ────────────────────────────────────────────────────────
test('pickDailyChallenges returns 3 distinct challenges', () => {
  const c = pickDailyChallenges('2026-05-17');
  assert.equal(c.length, 3);
  assert.equal(new Set(c.map(x => x.id)).size, 3);
});

test('pickDailyChallenges is deterministic per date', () => {
  const a = pickDailyChallenges('2026-05-17').map(x => x.id);
  const b = pickDailyChallenges('2026-05-17').map(x => x.id);
  assert.deepEqual(a, b);
});

test('pickDailyChallenges differs across dates', () => {
  const a = pickDailyChallenges('2026-05-17').map(x => x.id).join(',');
  const b = pickDailyChallenges('2026-05-18').map(x => x.id).join(',');
  assert.notEqual(a, b);
});

test('completeDailyChallenge fires Bonus Burst exactly once', () => {
  let s = {};
  let r = completeDailyChallenge(s, 'n1', '2026-05-17');
  assert.equal(r.bonusBurst, false);
  r = completeDailyChallenge(r.state, 'm1', '2026-05-17');
  assert.equal(r.bonusBurst, false);
  r = completeDailyChallenge(r.state, 's1', '2026-05-17');
  assert.equal(r.bonusBurst, true);
  // Marking another as complete same day shouldn't re-fire.
  r = completeDailyChallenge(r.state, 'c1', '2026-05-17');
  assert.equal(r.bonusBurst, false);
});

test('completeDailyChallenge resets state on new day', () => {
  let r = completeDailyChallenge({}, 'n1', '2026-05-17');
  r = completeDailyChallenge(r.state, 'n2', '2026-05-18');
  assert.equal(r.state.completed.length, 1);
  assert.equal(r.state.bonusBurstClaimed, false);
});

test('DAILY_CHALLENGE_POOL has 20 entries', () => {
  assert.equal(DAILY_CHALLENGE_POOL.length, 20);
});

// ── Weekly Challenges ───────────────────────────────────────────────────────
test('isoWeekKey is stable for same week', () => {
  // 2026-05-17 (Sun) and 2026-05-18 (Mon) — Mon is start of ISO week 21
  const a = isoWeekKey('2026-05-18');
  const b = isoWeekKey('2026-05-21');
  assert.equal(a, b);
});

test('pickWeeklyChallenge is deterministic per week', () => {
  const a = pickWeeklyChallenge('2026-W20');
  const b = pickWeeklyChallenge('2026-W20');
  assert.equal(a.id, b.id);
});

test('evalWeeklyProgress reports progress and completion', () => {
  const ch = WEEKLY_CHALLENGE_POOL.find(c => c.id === 'w_steps');
  const r1 = evalWeeklyProgress(ch, { stepsTotal: 35000 });
  assert.equal(r1.progress, 0.5);
  assert.equal(r1.complete, false);
  const r2 = evalWeeklyProgress(ch, { stepsTotal: 80000 });
  assert.equal(r2.progress, 1);
  assert.equal(r2.complete, true);
});

// ── Badges ──────────────────────────────────────────────────────────────────
test('evaluateBadges returns First Step on first log', () => {
  const earned = evaluateBadges({ totalLogs: 1 });
  assert.ok(earned.includes('first_step'));
});

test('evaluateBadges respects already-earned set', () => {
  const earned = evaluateBadges({ totalLogs: 5, streak: 3 }, ['first_step']);
  assert.ok(!earned.includes('first_step'));
  assert.ok(earned.includes('three_peat'));
});

test('evaluateBadges fires streak ladder progressively', () => {
  assert.deepEqual(
    evaluateBadges({ streak: 7 }).filter(id => id.startsWith('') === false || true).sort(),
    ['three_peat', 'week_warrior'].sort()
  );
});

test('evaluateBadges Macro Mind needs allMacrosHitToday flag', () => {
  assert.ok(evaluateBadges({ allMacrosHitToday: true }).includes('macro_mind'));
  assert.ok(!evaluateBadges({ allMacrosHitToday: false }).includes('macro_mind'));
});

// ── Gems ────────────────────────────────────────────────────────────────────
test('awardGems adds to balance', () => {
  const r = awardGems({ gems: 2 }, 3);
  assert.equal(r.state.gems, 5);
  assert.equal(r.delta, 3);
});

test('awardGems clamps bad input', () => {
  assert.equal(awardGems({ gems: 2 }, -1).state.gems, 2);
  assert.equal(awardGems({}, 2).state.gems, 2);
});

// ── Date helpers ────────────────────────────────────────────────────────────
test('dateKeyLocal returns YYYY-MM-DD for current date', () => {
  const k = dateKeyLocal(new Date(2026, 4, 17));
  assert.equal(k, '2026-05-17');
});
