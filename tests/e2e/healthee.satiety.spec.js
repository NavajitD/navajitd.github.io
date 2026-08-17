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
      const CANON = ['Breakfast', 'Mid-Morning', 'Lunch', 'Afternoon', 'Dinner', 'Before Bed'];
      return [1, 2, 3, 4, 5, 6, 0].map(d => {
        const p = PLAN[d];
        const t = p.meals.reduce((a, m) => ({
          cal: a.cal + m.cal, protein: a.protein + m.protein, fiber: a.fiber + m.fiber,
        }), { cal: 0, protein: 0, fiber: 0 });
        const present = new Set(p.meals.map(m => m.meal));
        return { label: p.label, target: getCalTargetFor(dates[d]), items: p.meals.length,
          missingSlots: CANON.filter(s => !present.has(s)), ...t };
      });
    }, [MON, TUE, WED, THU, FRI, SAT, SUN]);

    for (const d of days) {
      expect(d.cal, `${d.label} calories`).toBe(d.target);
      expect(d.protein, `${d.label} protein`).toBeGreaterThanOrEqual(137);
      expect(d.fiber, `${d.label} fiber`).toBeGreaterThanOrEqual(31);
      // Each of the 6 canonical slots is represented (some hold multiple line items now).
      expect(d.missingSlots, `${d.label} missing slots`).toEqual([]);
    }
    expect(days.reduce((s, d) => s + d.cal, 0)).toBe(13750);
  });

  test('no meal is a large drink — the root cause of the all-day hunger', async ({ page }) => {
    await boot(page);
    // Previously ~45% of intake was drunk, led by a 550-650 kcal blended shake
    // (whey + oats + banana + PB + milk + dates). Liquid calories barely blunt
    // hunger. Now each ritual is its OWN line item: the lean post-workout shake
    // (40g whey + creatine in WATER, ~150 kcal) and the bedtime skimmed milk stay
    // small; the calorie add-ins arrive on a plate.
    const r = await page.evaluate(() => {
      const PLAN = __htConst('MEAL_PLAN');
      const meals = [1, 2, 3, 4, 5, 6, 0].flatMap(d => PLAN[d].meals);
      const breakfasts = [1, 2, 3, 4, 5, 6, 0].flatMap(d => PLAN[d].meals.filter(m => m.meal === 'Breakfast'));
      // Any item that is purely a beverage (shake, milk, lime water, chaas…).
      const drink = /(^|→ )?(hot water|whey|shake|milk|chaas|buttermilk|lassi|smoothie)/i;
      const shakes = meals.filter(m => /shake/i.test(m.name));
      return {
        // No pure-drink item carries real calories — protein/fiber must be chewed.
        bigDrinks: meals.filter(m => drink.test(m.name) && m.cal > 200).map(m => m.name),
        // Every shake item is whey-in-water and lean (≤200 kcal), never a blended bomb.
        shakesWaterLean: shakes.every(m => /water/i.test(m.desc) && m.cal <= 200),
        creatineDaily: [1, 2, 3, 4, 5, 6, 0].every(d => PLAN[d].meals.some(m => /creatine/i.test(m.desc))),
        // The wake-up lime water is its own tappable line item on every day.
        limeWaterDaily: [1, 2, 3, 4, 5, 6, 0].every(d => PLAN[d].meals.some(m => /hot water/i.test(m.name))),
        maxBreakfastItem: Math.max(...breakfasts.map(m => m.cal)),
      };
    });
    expect(r.bigDrinks, 'no drink-only item over 200 kcal').toEqual([]);
    expect(r.shakesWaterLean, 'every shake is lean whey-in-water, not a blended bomb').toBe(true);
    expect(r.creatineDaily, 'creatine has a named home every day, incl. rest days').toBe(true);
    expect(r.limeWaterDaily, 'wake-up lime water is its own line item every day').toBe(true);
    expect(r.maxBreakfastItem, 'no single breakfast item is a 650 kcal bomb').toBeLessThanOrEqual(460);
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

test.describe('supplement scheduling', () => {
  test('dailies show every day; Shelcal alternates; Uprise D3 only on the 1st', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const supps = getUserSupplements();
      const byId = Object.fromEntries(supps.map(s => [s.id, s]));
      const dates = [];
      for (let i = 0; i < 6; i++) { const d = new Date('2026-08-01T12:00:00'); d.setDate(d.getDate() + i); dates.push(localDateStr(d)); }
      return {
        creatineEveryday: dates.every(dt => isSupplementDue(byId.creatine, dt)),
        shelcalPattern: dates.map(dt => isSupplementDue(byId.shelcal, dt)),
        upriseFirst: isSupplementDue(byId.vitd, '2026-08-01'),
        upriseSecond: isSupplementDue(byId.vitd, '2026-08-02'),
        dueOnAug2: getSupplementsForDay('2026-08-02').map(s => s.id),
        fullCount: supps.length,
      };
    });
    expect(r.creatineEveryday, 'a daily supplement shows every day').toBe(true);
    // Shelcal (everyDays:2) must alternate — never due two days running.
    for (let i = 1; i < r.shelcalPattern.length; i++) {
      expect(r.shelcalPattern[i], 'Shelcal alternates day to day').not.toBe(r.shelcalPattern[i - 1]);
    }
    expect(r.upriseFirst, 'Uprise D3 is due on the 1st').toBe(true);
    expect(r.upriseSecond, 'Uprise D3 is not due on the 2nd').toBe(false);
    expect(r.dueOnAug2, 'monthly item filtered out on a non-1st day').not.toContain('vitd');
    expect(r.dueOnAug2.length, 'a non-1st day shows fewer than the full stack').toBeLessThan(r.fullCount);
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

  test('meals pre-logged for a later slot do not count toward pace until that slot', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      window.__htSetState({ date: todayStr(), tab: 'fuel', freshDay: true, profile: null });
      // Plan the day in the "morning": tag a lunch and a dinner but it's only ~1pm.
      window.getISTHourFloat = () => 13;
      addFood({ name: 'Planned Lunch', meal: 'Lunch', cal: 600, protein: 40, carbs: 60, fat: 15, fiber: 6, micros: {} });
      addFood({ name: 'Planned Dinner', meal: 'Dinner', cal: 800, protein: 40, carbs: 80, fat: 20, fiber: 8, micros: {} });
      const morning = getPaceState();
      // Same logs, later in the evening — both slots have now passed.
      window.getISTHourFloat = () => 21;
      const evening = getPaceState();
      return {
        total: computeTotals(__htDay()).cal,
        mConsumed: consumedByNow(__htDay(), 13),
        mActual: morning.actual, mState: morning.state,
        eConsumed: consumedByNow(__htDay(), 21),
        eActual: evening.actual,
      };
    });
    // Both meals are logged (day totals reflect the plan)…
    expect(r.total).toBe(1400);
    // …but at 1pm neither slot is due, so pace sees 0 consumed and never says "ahead".
    expect(r.mConsumed).toBe(0);
    expect(r.mActual).toBe(0);
    expect(r.mState).not.toBe('ahead');
    // By 9pm both the lunch and dinner slots have passed → they count.
    expect(r.eConsumed).toBe(1400);
    expect(r.eActual).toBe(1400);
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
