// Category goals: a goal is offered only after last month's spend rose ≥10%
// over the month before. Target unchanged: default 80% (adjustable) of the
// lowest month in the last 3. Without the rise gate, every month the user
// held a goal became the next baseline and targets ratcheted down forever
// (₹1,000 → ₹800 → ₹640 → …).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createApp, plain } from './_expenses-harness.js';

const CATS = ['Groceries', 'Eating out', 'Shopping', 'Rent/Maintenance'];

// Freeze "now" inside the app: every `new Date()` / `Date.now()` in the
// shipped script resolves the sandbox global `Date` at call time.
function setNow(app, y, m, d) {
  const FIXED = new Date(y, m - 1, d, 12, 0, 0).getTime();
  const Real = Date;
  class FakeDate extends Real {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  }
  app.ctx.Date = FakeDate;
}

// spend = { 'YYYY-MM': amount } → one expense on the 10th of each month
// (split into two entries so sums are exercised).
function expenses(category, spend) {
  const out = [];
  for (const [ym, amt] of Object.entries(spend)) {
    const [y, m] = ym.split('-').map(Number);
    out.push({ id: `${category}-${ym}-a`, category, amount: amt * 0.25, date: new Date(y, m - 1, 5) });
    out.push({ id: `${category}-${ym}-b`, category, amount: amt * 0.75, date: new Date(y, m - 1, 20) });
  }
  return out;
}

function goalsApp({ now = [2026, 11, 10], data = [], goals = {} } = {}) {
  const app = createApp();
  setNow(app, ...now);
  app.t.setUserProfile({ categories: CATS, paymentMethods: ['Cash'], categoryGoals: goals, learnedKeywords: {} });
  app.t.setExpenses(data);
  app.cand = () => plain(app.ctx.getGoalOfferCandidate());
  return app;
}

/* ─────────────────────────────── the rise test ─────────────────────────────── */

describe('spendRoseEnough (≥10% rise)', () => {
  const { ctx } = createApp();
  test('boundary: exactly +10% counts, just under does not', () => {
    assert.equal(ctx.spendRoseEnough(1000, 1100), true);
    assert.equal(ctx.spendRoseEnough(1000, 1100.01), true);
    assert.equal(ctx.spendRoseEnough(1000, 1099.99), false);
    assert.equal(ctx.spendRoseEnough(1000, 1099), false);
    assert.equal(ctx.spendRoseEnough(800, 880), true);   // 800 * 1.1 is 880.0000000000001 in floats
    assert.equal(ctx.spendRoseEnough(1234.5, 1357.95), true); // exactly 10% with paise
    assert.equal(ctx.spendRoseEnough(1234.5, 1357.94), false);
  });

  test('flat or falling spend never counts', () => {
    assert.equal(ctx.spendRoseEnough(1000, 1000), false);
    assert.equal(ctx.spendRoseEnough(1000, 800), false);
    assert.equal(ctx.spendRoseEnough(1200, 1000), false);
  });

  test('needs spend in both months', () => {
    for (const [a, b] of [[0, 1000], [1000, 0], [0, 0], [-5, 100], [NaN, 100], [100, NaN], [undefined, 100], [null, 100]])
      assert.equal(ctx.spendRoseEnough(a, b), false, `${a} → ${b}`);
  });

  test('large rises count; threshold is configurable', () => {
    assert.equal(ctx.spendRoseEnough(100, 5000), true);
    assert.equal(ctx.spendRoseEnough(1000, 1050, 5), true);
    assert.equal(ctx.spendRoseEnough(1000, 1049, 5), false);
  });

  test('the threshold is 10%', () => {
    const app = createApp();
    // GOAL is a top-level const: visible to later scripts in the same context.
    assert.equal(vm.runInContext('GOAL.minRisePct', app.ctx), 10);
    assert.equal(vm.runInContext('GOAL.defaultPct', app.ctx), 80);
  });
});

describe('categoryRecentTrend', () => {
  test('compares the last completed month with the one before, for that category only', () => {
    const app = goalsApp({
      data: [
        ...expenses('Groceries', { '2026-08': 9999, '2026-09': 1000, '2026-10': 1200, '2026-11': 5000 }),
        ...expenses('Shopping', { '2026-09': 50, '2026-10': 70 }),
      ],
    });
    const t = plain(app.ctx.categoryRecentTrend('Groceries'));
    assert.deepEqual(t, { lastTotal: 1200, prevTotal: 1000, lastName: 'October', prevName: 'September', rosePct: 20 });
  });

  test('January looks back to December and November of the previous year', () => {
    const app = goalsApp({ now: [2027, 1, 15], data: expenses('Groceries', { '2026-11': 500, '2026-12': 600 }) });
    const t = plain(app.ctx.categoryRecentTrend('Groceries'));
    assert.equal(t.lastName, 'December');
    assert.equal(t.prevName, 'November');
    assert.equal(t.lastTotal, 600);
    assert.equal(t.prevTotal, 500);
  });

  test('end of a long month does not skip February', () => {
    const app = goalsApp({ now: [2026, 3, 31], data: expenses('Groceries', { '2026-01': 100, '2026-02': 150 }) });
    const t = plain(app.ctx.categoryRecentTrend('Groceries'));
    assert.equal(t.lastName, 'February');
    assert.equal(t.prevName, 'January');
  });

  test('no spend the month before → rosePct null', () => {
    const app = goalsApp({ data: expenses('Groceries', { '2026-10': 1200 }) });
    assert.equal(app.ctx.categoryRecentTrend('Groceries').rosePct, null);
  });

  test('accepts stored date strings / timestamps', () => {
    const app = goalsApp({
      data: [
        { id: 'a', category: 'Groceries', amount: 1000, date: '2026-09-15T00:00:00' },
        { id: 'b', category: 'Groceries', amount: 1200, date: new Date(2026, 9, 15).getTime() },
      ],
    });
    const t = plain(app.ctx.categoryRecentTrend('Groceries'));
    assert.equal(t.prevTotal, 1000);
    assert.equal(t.lastTotal, 1200);
  });
});

/* ─────────────────────────────── when a goal is offered ─────────────────────────────── */

describe('getGoalOfferCandidate — only after a rise', () => {
  test('the reported bug: flat or falling spend gets no goal (no more 1,000 → 800 → 640)', () => {
    // Flat ₹1,000 for three months: previously offered ₹800.
    assert.equal(goalsApp({ data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1000 }) }).cand(), null);
    // Held last month's ₹800 goal: previously offered ₹640.
    assert.equal(goalsApp({ data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 800 }) }).cand(), null);
  });

  test('the user’s example: ₹1,000 in September → ₹1,200 in October ⇒ November offer at 80%', () => {
    const app = goalsApp({ data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 }) });
    assert.deepEqual(app.cand(), {
      category: 'Groceries', baseMin: 1000, target: 800,
      lastTotal: 1200, prevTotal: 1000, lastName: 'October', prevName: 'September', rosePct: 20,
    });
  });

  test('10% boundary', () => {
    assert.equal(goalsApp({ data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1100 }) }).cand()?.category, 'Groceries');
    assert.equal(goalsApp({ data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1099 }) }).cand(), null);
  });

  test('a rise after a dip still counts; the target is 80% of the lowest of the 3 months', () => {
    const app = goalsApp({ data: expenses('Groceries', { '2026-08': 1500, '2026-09': 700, '2026-10': 900 }) });
    const c = app.cand();
    assert.equal(c.baseMin, 700);
    assert.equal(c.target, 560);
    assert.equal(Math.round(c.rosePct), 29);
  });

  test('still needs 3 months of history', () => {
    assert.equal(goalsApp({ data: expenses('Groceries', { '2026-09': 1000, '2026-10': 1200 }) }).cand(), null);
    assert.equal(goalsApp({ data: expenses('Groceries', { '2026-07': 1000, '2026-09': 1000, '2026-10': 1200 }) }).cand(), null);
  });

  test('fixed costs are never offered, even after a rise', () => {
    assert.equal(goalsApp({ data: expenses('Rent/Maintenance', { '2026-08': 20000, '2026-09': 20000, '2026-10': 25000 }) }).cand(), null);
  });

  test('categories outside the profile are ignored', () => {
    assert.equal(goalsApp({ data: expenses('Travel', { '2026-08': 1000, '2026-09': 1000, '2026-10': 5000 }) }).cand(), null);
  });

  test('no offer when the category already has a goal this month', () => {
    const app = goalsApp({
      data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 }),
      goals: { Groceries: { category: 'Groceries', month: '2026-11', target: 900, pct: 90, baselineMin: 1000 } },
    });
    assert.equal(app.cand(), null);
  });

  test('a goal from an earlier month does not block a new offer', () => {
    const app = goalsApp({
      data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 }),
      goals: { Groceries: { category: 'Groceries', month: '2026-10', target: 800, pct: 80, baselineMin: 1000 } },
    });
    assert.equal(app.cand()?.category, 'Groceries');
  });

  test('"Not now" this month hides it; last month’s "Not now" does not', () => {
    const data = expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 });
    let app = goalsApp({ data });
    app.localStorage.setItem('goalOffersDismissed', JSON.stringify({ 'Groceries__2026-11': true }));
    assert.equal(app.cand(), null);
    app = goalsApp({ data });
    app.localStorage.setItem('goalOffersDismissed', JSON.stringify({ 'Groceries__2026-10': true }));
    assert.equal(app.cand()?.category, 'Groceries');
  });

  test('several rising categories: the biggest baseline wins; a bigger flat one does not block', () => {
    const app = goalsApp({
      data: [
        ...expenses('Shopping', { '2026-08': 9000, '2026-09': 9000, '2026-10': 9000 }),      // flat, biggest
        ...expenses('Groceries', { '2026-08': 3000, '2026-09': 3000, '2026-10': 4000 }),     // rising
        ...expenses('Eating out', { '2026-08': 2000, '2026-09': 2000, '2026-10': 2600 }),    // rising, smaller
      ],
    });
    assert.equal(app.cand().category, 'Groceries');
  });

  test('no profile → no offer', () => {
    const app = goalsApp({ data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 }) });
    app.t.setUserProfile(null);
    assert.equal(app.ctx.getGoalOfferCandidate(), null);
  });
});

/* ─────────────────────────────── a year of months ─────────────────────────────── */

describe('no ratchet across a year', () => {
  // Each month: if a goal is offered, the user accepts the default and spends
  // exactly the target; otherwise they spend `plan[month]`.
  function simulate(plan, months) {
    const spend = { ...plan.history };
    const offers = [];
    for (const [y, m] of months) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const app = goalsApp({ now: [y, m, 3], data: expenses('Groceries', spend) });
      const c = app.cand();
      if (c) offers.push({ month: ym, target: c.target, baseMin: c.baseMin });
      spend[ym] = c ? c.target : (plan[ym] ?? spend[Object.keys(spend).sort().at(-1)]);
    }
    return offers;
  }
  const MONTHS = [[2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2]];

  test('one rise ⇒ one goal; holding it never triggers a smaller one', () => {
    const offers = simulate({ history: { '2026-01': 1000, '2026-02': 1000, '2026-03': 1000, '2026-04': 1250 } }, MONTHS);
    assert.deepEqual(offers, [{ month: '2026-05', target: 800, baseMin: 1000 }]);
  });

  test('flat spending all year ⇒ no goals at all', () => {
    assert.deepEqual(simulate({ history: { '2026-02': 1000, '2026-03': 1000, '2026-04': 1000 } }, MONTHS), []);
  });

  test('a later ≥10% rise brings a new goal, once', () => {
    const offers = simulate({ history: { '2026-01': 1000, '2026-02': 1000, '2026-03': 1000, '2026-04': 1250 }, '2026-09': 1000 }, MONTHS);
    assert.deepEqual(offers.map(o => o.month), ['2026-05', '2026-10']);
  });

  test('small drifts upward (+5% a month) never nag', () => {
    const history = { '2026-02': 1000, '2026-03': 1050, '2026-04': 1102 };
    const plan = { history, '2026-05': 1157, '2026-06': 1215, '2026-07': 1276, '2026-08': 1340 };
    assert.deepEqual(simulate(plan, MONTHS.slice(0, 4)), []);
  });
});

/* ─────────────────────────────── offer card + setting the goal ─────────────────────────────── */

describe('offer card', () => {
  const data = expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 });

  test('explains the rise and keeps the adjustable 80% default', () => {
    const app = goalsApp({ data });
    const html = app.ctx.goalOfferHTML(app.ctx.getGoalOfferCandidate(), 'Groceries');
    assert.match(html, /Set a goal for Groceries\?/);
    assert.match(html, /Up 20% last month: ₹1,000 in September → ₹1,200 in October\./);
    assert.match(html, /lowest in the last 3 months was ₹1,000/);
    assert.match(html, /class="goal-pct-input"[^>]*value="80"/);
    assert.match(html, /id="goalTargetPreview-Groceries">₹800</);
    assert.match(html, /setGoalFromOffer\('Groceries', 1000\)/);
  });

  test('renderGoals shows the offer after a rise…', () => {
    const app = goalsApp({ data });
    app.ctx.renderGoals();
    assert.match(app.getById('goalsArea').innerHTML, /class="goal-offer"/);
  });

  test('…and nothing (no offer, no "unreachable" note) without one', () => {
    const app = goalsApp({ data: expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1000 }) });
    app.ctx.renderGoals();
    assert.equal(app.getById('goalsArea').innerHTML.trim(), '');
  });

  test('after a rise but already over the target this month → the "unreachable" note', () => {
    const app = goalsApp({ data: [...data, ...expenses('Groceries', { '2026-11': 900 })] });
    app.ctx.renderGoals();
    const html = app.getById('goalsArea').innerHTML;
    assert.match(html, /goal-unreachable/);
    assert.doesNotMatch(html, /class="goal-offer"/);
  });

  test('category names are escaped in the offer title', () => {
    const app = goalsApp();
    const html = app.ctx.goalOfferHTML({ category: '<b>x</b>', baseMin: 1000, target: 800, prevTotal: 1000, lastTotal: 1200, rosePct: 20, prevName: 'September', lastName: 'October' }, 'x');
    assert.doesNotMatch(html, /<b>x<\/b>/);
  });
});

describe('setGoalFromOffer', () => {
  const data = expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 });

  test('default 80% → target ₹800 stored for this month', () => {
    const app = goalsApp({ data });
    app.ctx.setGoalFromOffer('Groceries', 1000);
    assert.deepEqual(plain(app.t.getUserProfile().categoryGoals.Groceries), {
      category: 'Groceries', month: '2026-11', target: 800, pct: 80, baselineMin: 1000, setOn: '2026-11-10',
    });
    assert.match(app.getById('toast').textContent, /keep Groceries under ₹800/);
    assert.equal(app.ctx.getGoalOfferCandidate(), null, 'no second offer once set');
  });

  test('the % is adjustable and clamped to 1–100', () => {
    for (const [input, pct, target] of [['90', 90, 900], ['50', 50, 500], ['150', 100, 1000], ['abc', 80, 800], ['0', 80, 800]]) {
      const app = goalsApp({ data });
      app.getById('goalPct-Groceries').value = input;
      app.ctx.setGoalFromOffer('Groceries', 1000);
      const g = app.t.getUserProfile().categoryGoals.Groceries;
      assert.equal(g.pct, pct, input);
      assert.equal(g.target, target, input);
    }
  });

  test('refused when this month’s spend already exceeds the target', () => {
    const app = goalsApp({ data: [...data, ...expenses('Groceries', { '2026-11': 900 })] });
    app.ctx.setGoalFromOffer('Groceries', 1000);
    assert.equal(app.t.getUserProfile().categoryGoals.Groceries, undefined);
    assert.match(app.getById('toast').textContent, /try next month/);
  });

  test('holding the goal ⇒ no offer the following month', () => {
    const app = goalsApp({ data });
    app.ctx.setGoalFromOffer('Groceries', 1000);
    const goals = plain(app.t.getUserProfile().categoryGoals);
    const next = goalsApp({ now: [2026, 12, 4], data: [...data, ...expenses('Groceries', { '2026-11': 790 })], goals });
    assert.equal(next.cand(), null);
    assert.equal(next.ctx.activeGoalFor('Groceries'), null, 'November’s goal is not carried into December');
  });

  test('missing the goal with another ≥10% rise ⇒ offered again', () => {
    const app = goalsApp({ data });
    app.ctx.setGoalFromOffer('Groceries', 1000);
    const goals = plain(app.t.getUserProfile().categoryGoals);
    const next = goalsApp({ now: [2026, 12, 4], data: [...data, ...expenses('Groceries', { '2026-11': 1400 })], goals });
    const c = next.cand();
    assert.equal(c.category, 'Groceries');
    assert.equal(c.baseMin, 1000);
    assert.equal(c.target, 800);
  });
});

describe('isGoalAchievable (unchanged)', () => {
  const data = expenses('Groceries', { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 });
  test('fresh month, nothing spent → reachable', () => {
    assert.equal(goalsApp({ data }).ctx.isGoalAchievable('Groceries', 800), true);
  });
  test('already at or over the target → not reachable', () => {
    const app = goalsApp({ data: [...data, { id: 'n', category: 'Groceries', amount: 800, date: new Date(2026, 10, 2) }] });
    assert.equal(app.ctx.isGoalAchievable('Groceries', 800), false);
  });
  test('last day of the month → not reachable', () => {
    assert.equal(goalsApp({ now: [2026, 11, 30], data }).ctx.isGoalAchievable('Groceries', 800), false);
  });
  test('spent so fast that the rest of the month is under 80% of pace → not reachable', () => {
    // Nov 10: pace 800/30 = 26.7/day; ₹600 spent leaves 200/20 days = 10/day (< 21.3)
    const app = goalsApp({ data: [...data, { id: 'n', category: 'Groceries', amount: 600, date: new Date(2026, 10, 3) }] });
    assert.equal(app.ctx.isGoalAchievable('Groceries', 800), false);
  });
});
