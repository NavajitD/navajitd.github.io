// Calorie-adherence & satiety features: pacing, weekly budget, hunger rescue,
// the ease-in ramp, and the satiety-tuned meal plan.
//
// The MEAL_PLAN assertions are deliberately strict — a silent +330/week drift is
// exactly how the previous plan went off target, so the totals are pinned here.

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/HealThee/health.html';

// Mon 2026-08-03 .. Sun 2026-08-09
const MON = '2026-08-03', TUE = '2026-08-04', WED = '2026-08-05',
  THU = '2026-08-06', FRI = '2026-08-07', SAT = '2026-08-08', SUN = '2026-08-09';

async function boot(page) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.getCalTargetFor === 'function', { timeout: 8000 });
  // Reveal the app shell without auth and clear any leaked ramp/week state.
  await page.evaluate(() => {
    document.querySelectorAll('.screen, #loginScreen, #authScreen').forEach(d => { d.style.display = 'none'; });
    const app = document.getElementById('mainApp');
    if (app) app.style.display = 'block';
    localStorage.removeItem('HT_WK');
    window.__htSetState({ freshDay: true, profile: null, weekCache: null });
  });
}

test.describe('calorie targets and the ease-in ramp', () => {
  test('rest/training classification is unchanged and week sums to 13750', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(([mon, tue, wed, thu, fri, sat, sun]) => ({
      mon: getCalTargetFor(mon), tue: getCalTargetFor(tue), wed: getCalTargetFor(wed),
      thu: getCalTargetFor(thu), fri: getCalTargetFor(fri), sat: getCalTargetFor(sat),
      sun: getCalTargetFor(sun),
    }), [MON, TUE, WED, THU, FRI, SAT, SUN]);

    // Wed/Sat/Sun are rest days (workout names contain recovery/rest/mobility).
    expect(r).toEqual({ mon: 2050, tue: 2050, wed: 1850, thu: 2050, fri: 2050, sat: 1850, sun: 1850 });
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBe(13750);
  });

  test('ramp steps weekly and is a pure function of the date', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((mon) => {
      window.__htSetState({ ramp: { start: mon, days: 14, startPct: 1.18 } });
      const at = (offset) => {
        const d = new Date(mon + 'T12:00:00'); d.setDate(d.getDate() + offset);
        return localDateStr(d);
      };
      return {
        f0: rampFactorFor(at(0)), f6: rampFactorFor(at(6)),
        f7: rampFactorFor(at(7)), f13: rampFactorFor(at(13)),
        f14: rampFactorFor(at(14)), fBefore: rampFactorFor(at(-1)),
        t0: getCalTargetFor(at(0)), t7: getCalTargetFor(at(7)), t14: getCalTargetFor(at(14)),
      };
    }, MON);

    expect(r.f0).toBeCloseTo(1.18, 4);
    expect(r.f6).toBeCloseTo(1.18, 4);   // still week 1
    expect(r.f7).toBeCloseTo(1.09, 4);   // steps down at day 7
    expect(r.f13).toBeCloseTo(1.09, 4);
    expect(r.f14).toBe(1);               // ramp over
    expect(r.fBefore).toBe(1);           // before start: no effect
    expect(r).toMatchObject({ t0: 2420, t7: 2230, t14: 2050 });
  });

  test('ramp off by default', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate((d) => rampFactorFor(d), MON)).toBe(1);
  });
});

test.describe('satiety-tuned meal plan', () => {
  test('every day hits its calorie target exactly, with protein >=137 and fiber >=31', async ({ page }) => {
    await boot(page);
    const days = await page.evaluate(([mon, tue, wed, thu, fri, sat, sun]) => {
      const dates = { 1: mon, 2: tue, 3: wed, 4: thu, 5: fri, 6: sat, 0: sun };
      const PLAN = __htConst('MEAL_PLAN');
      return [1, 2, 3, 4, 5, 6, 0].map(d => {
        const p = PLAN[d];
        const t = p.meals.reduce((a, m) => ({
          cal: a.cal + m.cal, protein: a.protein + m.protein, fiber: a.fiber + m.fiber,
        }), { cal: 0, protein: 0, fiber: 0 });
        return { label: p.label, target: getCalTargetFor(dates[d]), slots: p.meals.length, ...t };
      });
    }, [MON, TUE, WED, THU, FRI, SAT, SUN]);

    for (const d of days) {
      expect(d.cal, `${d.label} calories`).toBe(d.target);
      expect(d.protein, `${d.label} protein`).toBeGreaterThanOrEqual(137);
      expect(d.fiber, `${d.label} fiber`).toBeGreaterThanOrEqual(31);
      expect(d.slots, `${d.label} meal slots`).toBe(6);
    }
    expect(days.reduce((s, d) => s + d.cal, 0)).toBe(13750);
  });

  test('no meal is a large drink — the root cause of the all-day hunger', async ({ page }) => {
    await boot(page);
    // Previously ~45% of intake was drunk: a 550-650 kcal breakfast shake, plus
    // afternoon whey and before-bed casein. Liquid calories barely blunt hunger.
    const r = await page.evaluate(() => {
      const PLAN = __htConst('MEAL_PLAN');
      const meals = [1, 2, 3, 4, 5, 6, 0].flatMap(d => PLAN[d].meals);
      // A meal is "drunk" only if every component is a beverage. Meals like
      // "Paneer Chilla + Banana + Whey" or "Soup First -> Khichdi" are chewed food.
      const drinkOnly = /^(whey|milk|shake|chaas|buttermilk|golden milk|warm milk|clear veg soup)\b/i;
      return {
        shakes: meals.filter(m => /shake/i.test(m.name)).length,
        maxDrinkMeal: Math.max(0, ...meals.filter(m => drinkOnly.test(m.name)).map(m => m.cal)),
        maxBreakfast: Math.max(...[1, 2, 3, 4, 5, 6, 0].map(d => PLAN[d].meals.find(m => m.meal === 'Breakfast').cal)),
      };
    });
    expect(r.shakes, 'no meal-replacement shakes remain').toBe(0);
    expect(r.maxDrinkMeal, 'no drink-only meal over 200 kcal').toBeLessThanOrEqual(200);
    expect(r.maxBreakfast, 'breakfast is chewed food, not a 650 kcal shake').toBeLessThanOrEqual(560);
  });

  test('every dinner opens with a salad or soup starter', async ({ page }) => {
    await boot(page);
    const dinners = await page.evaluate(() => {
      const PLAN = __htConst('MEAL_PLAN');
      return [1, 2, 3, 4, 5, 6, 0].map(d => PLAN[d].meals.find(m => m.meal === 'Dinner').name);
    });
    for (const name of dinners) expect(name, `dinner "${name}"`).toMatch(/salad first|soup first/i);
  });

  test('addFromPlan keeps the hand-tuned fiber when the LLM call fails', async ({ page }) => {
    await boot(page);
    // Regression for the bug where fiber was hardcoded to 0 and only ever set
    // from the LLM — offline (a PWA!) that logged every planned meal as 0g fiber.
    const src = await page.evaluate(() => window.addFromPlan.toString());
    expect(src).toContain('fiber: num0(data.fiber)');
    expect(src).toContain('num0(est.fiber) || num0(data.fiber)');
  });
});

test.describe('calorie pacing', () => {
  test('pace curve is monotonic, starts at 0 and ends at the day target', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((mon) => {
      const pts = getPaceCurve(mon);
      const samples = [];
      for (let h = 6; h <= 23; h += 0.5) samples.push(expectedByHour(pts, h));
      return {
        atStart: expectedByHour(pts, __htConst('DAY_START_HOUR')),
        beforeStart: expectedByHour(pts, 5),
        atEnd: Math.round(expectedByHour(pts, 23.9)),
        target: getCalTargetFor(mon),
        monotonic: samples.every((v, i) => i === 0 || v >= samples[i - 1]),
      };
    }, MON);

    expect(r.atStart).toBe(0);
    expect(r.beforeStart).toBe(0);
    expect(r.atEnd).toBe(r.target);
    expect(r.monotonic).toBe(true);
  });

  test('pacing is hidden for non-today dates', async ({ page }) => {
    await boot(page);
    const shown = await page.evaluate((mon) => {
      window.__htSetState({ date: mon, tab: 'fuel', freshDay: true });
      return getPaceState().show;
    }, MON);
    expect(shown).toBe(false);
  });

  test('today shows a pace chip, and nothing-logged-yet does not read as "behind"', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      window.__htSetState({ date: todayStr(), tab: 'fuel', freshDay: true });
      const s = getPaceState();
      return { show: s.show, state: s.state, chip: !!document.querySelector('#tabContent .stat-box[onclick*="openWeekModal"]') };
    });
    expect(r.show).toBe(true);
    // Empty day: never "behind" — that would nag before the user has eaten.
    expect(['early', 'none', 'on']).toContain(r.state);
    expect(r.chip).toBe(true);
  });
});

test.describe('weekly rolling budget', () => {
  test('bank is advisory and capped at -200/day, with the residue forgiven', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const today = todayStr();
      const dates = weekDatesOf(today);
      // Blow one earlier day of this week by a large amount.
      const past = dates.filter(d => d < today);
      if (!past.length) return { skip: true };
      const days = {};
      days[past[0]] = getCalTargetFor(past[0]) + 1400;
      window.__htSetState({
        date: today, tab: 'fuel', freshDay: true,
        weekCache: { uid: null, weekStart: weekStartOf(today), builtAt: Date.now(), days },
      });
      const wb = getWeekBudget();
      return { skip: false, adj: wb.adj, bank: wb.bank, carry: wb.carry, todayTarget: wb.todayTarget, adjusted: wb.adjustedToday };
    });

    if (r.skip) test.skip(true, 'today is Monday — no completed days this week');
    expect(r.adj).toBe(-200);                        // floored, never a starvation day
    expect(r.adjusted).toBe(r.todayTarget - 200);
    expect(r.carry).toBeLessThan(0);                 // unrepayable residue, forgiven
    // The ring target itself must not move.
    expect(await page.evaluate(() => getCalTarget())).toBe(r.todayTarget);
  });

  test('surplus is capped at +200/day too', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const today = todayStr();
      const past = weekDatesOf(today).filter(d => d < today);
      if (!past.length) return { skip: true };
      const days = {};
      past.forEach(d => { days[d] = 200; }); // ate almost nothing
      window.__htSetState({
        date: today, tab: 'fuel', freshDay: true,
        weekCache: { uid: null, weekStart: weekStartOf(today), builtAt: Date.now(), days },
      });
      return { skip: false, adj: getWeekBudget().adj };
    });
    if (r.skip) test.skip(true, 'today is Monday');
    expect(r.adj).toBe(200);
  });

  test('week modal opens from the pace chip', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.__htSetState({ date: todayStr(), tab: 'fuel', freshDay: true }); });
    await page.click('#tabContent .stat-box[onclick*="openWeekModal"]');
    await expect(page.locator('#modalContainer .modal-title')).toHaveText('This Week');
    const body = await page.locator('#modalContainer .modal-body').textContent();
    expect(body).toMatch(/practical today/i);
  });

  test('getWeekBudget does no network I/O', async ({ page }) => {
    await boot(page);
    // renderFuel calls it on every interaction — a Firestore read here would be a perf bug.
    const src = await page.evaluate(() => window.getWeekBudget.toString());
    expect(src).not.toMatch(/await|\.get\(\)|fetch\(/);
  });
});

test.describe('hunger rescue', () => {
  test('tiers pick the right rescue set for the calories left', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ({
      plenty: hungerTier(450), mid: hungerTier(200), low: hungerTier(80), over: hungerTier(-50),
      boundaryHigh: hungerTier(400), boundaryLow: hungerTier(150),
    }));
    expect(r).toEqual({
      plenty: 'plan', mid: 'protein', low: 'volume', over: 'volume',
      boundaryHigh: 'protein', boundaryLow: 'protein',
    });
  });

  test('over-budget offers only genuinely free foods', async ({ page }) => {
    await boot(page);
    const opts = await page.evaluate(() => rescueOptions(-200, 'volume').map(f => ({ cal: f.cal, tier: f.tier })));
    expect(opts.length).toBeGreaterThan(3);
    expect(opts.every(o => o.tier === 'free' && o.cal < 65)).toBe(true);
  });

  test('protein tier ranks by satiety per calorie and respects the budget', async ({ page }) => {
    await boot(page);
    const opts = await page.evaluate(() => rescueOptions(200, 'protein').map(f => ({ name: f.name, cal: f.cal, protein: f.protein, fiber: f.fiber })));
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every(o => o.cal <= 200)).toBe(true);
    expect(opts.every(o => o.protein >= 5 || o.fiber >= 4)).toBe(true);
    const density = opts.map(o => (o.protein + o.fiber) / o.cal);
    expect(density.every((v, i) => i === 0 || v <= density[i - 1] + 1e-9)).toBe(true);
  });

  test('one tap logs hunger and opens the rescue modal; a rescue food logs to the diary', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.__htSetState({ date: todayStr(), tab: 'fuel', freshDay: true }); });

    await page.click('#tabContent .food-btn[onclick*="logHunger"]');
    await expect(page.locator('#modalContainer .modal-title')).toHaveText('Hungry right now');
    expect(await page.evaluate(() => activeItems(__htDay().hungerLogs).length)).toBe(1);

    // Empty day => lots of room => 'plan' tier offers the next planned meal.
    const before = await page.evaluate(() => activeItems(__htDay().foods).length);
    await page.click('#modalContainer .plan-item');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      foods: activeItems(__htDay().foods).length,
      resolved: activeItems(__htDay().hungerLogs)[0].resolvedWith,
      fiber: computeTotals(__htDay()).fiber,
    }));
    expect(after.foods).toBe(before + 1);
    expect(after.resolved).toBeTruthy();       // hunger log records what resolved it
    expect(after.fiber).toBeGreaterThan(0);    // planned meal carried its fiber through
  });

  test('hunger button is hidden on past dates and logging refuses', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((mon) => {
      window.__htSetState({ date: mon, tab: 'fuel', freshDay: true });
      const btn = document.querySelector('#tabContent .food-btn[onclick*="logHunger"]');
      logHunger(2); // must be a no-op for a non-today date
      return { btn: !!btn, logs: activeItems(__htDay().hungerLogs || []).length };
    }, MON);
    expect(r.btn).toBe(false);
    expect(r.logs).toBe(0);
  });
});

test.describe('regressions', () => {
  test('no console errors while exercising the new surfaces', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

    await boot(page);
    await page.evaluate(() => {
      window.__htSetState({ date: todayStr(), tab: 'fuel', freshDay: true });
      logHunger(3); closeModal();
      openWeekModal(); closeModal();
      getPaceState(); getWeekBudget(); htGamContext();
    });
    await page.waitForTimeout(300);

    const fatal = errors.filter(e => !/firebase|auth|network|sign-in|popup|redirect|FIRESTORE|Save failed/i.test(e));
    expect(fatal, `Unexpected console errors:\n${fatal.join('\n')}`).toEqual([]);
  });

  test('equipment-variant workout feature still works', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((fri) => {
      localStorage.setItem('HT_equipMode', 'none');
      window.__htSetState({ date: fri, tab: 'move', freshDay: true });
      const none = document.querySelector('#tabContent details[data-key="workout"] .check-item span')?.textContent;
      setEquipMode('std');
      const std = document.querySelector('#tabContent details[data-key="workout"] .check-item span')?.textContent;
      return { none, std };
    }, FRI);
    expect(r.none).not.toBe(r.std);
    expect(r.std).toContain('Trap Bar');
  });
});
