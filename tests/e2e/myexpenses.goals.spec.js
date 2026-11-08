// End-to-end: the category-goal offer appears only after last month's spend
// rose ≥10% over the month before, keeps the adjustable 80% default, and
// explains the rise. Clock frozen at 10 Nov 2026.

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/MyExpenses/expenses.html';
const NOW = new Date('2026-11-10T12:00:00');

async function withSpend(page, spend) {
  await page.clock.setFixedTime(NOW);
  await page.route(/firestore\.googleapis\.com|identitytoolkit|securetoken/, r => r.abort());
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginScreen')).toBeVisible({ timeout: 8000 });
  await page.evaluate(spend => {
    currentUser = { uid: 'e2e-goals', displayName: 'Goals', email: 'g@example.com', photoURL: '' };
    userProfile = { categories: ['Groceries', 'Eating out', 'Rent/Maintenance'], paymentMethods: ['Cash'], categoryGoals: {}, learnedKeywords: {} };
    window.__goalWrites = 0;
    window.persistCategoryGoals = () => { window.__goalWrites++; };
    allExpenses = [];
    for (const [cat, months] of Object.entries(spend))
      for (const [ym, amt] of Object.entries(months)) {
        const [y, m] = ym.split('-').map(Number);
        allExpenses.push({ id: `${cat}${ym}`, expenseName: cat, category: cat, amount: amt, date: new Date(y, m - 1, 12), paymentMethod: 'Cash' });
      }
    applyUserProfile();
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    renderGoals();
  }, spend);
}

const offer = page => page.locator('#goalsArea .goal-offer');

test.describe('MyExpenses — goal offers only after a rise', () => {
  test('flat spending: no goal offered (was ₹800 before)', async ({ page }) => {
    await withSpend(page, { Groceries: { '2026-08': 1000, '2026-09': 1000, '2026-10': 1000 } });
    await expect(offer(page)).toHaveCount(0);
    await expect(page.locator('#goalsArea .goal-unreachable')).toHaveCount(0);
  });

  test('held last month’s goal (spend fell): no smaller goal (was ₹640)', async ({ page }) => {
    await withSpend(page, { Groceries: { '2026-08': 1000, '2026-09': 1000, '2026-10': 800 } });
    await expect(offer(page)).toHaveCount(0);
  });

  test('a 9% rise is not enough', async ({ page }) => {
    await withSpend(page, { Groceries: { '2026-08': 1000, '2026-09': 1000, '2026-10': 1090 } });
    await expect(offer(page)).toHaveCount(0);
  });

  test('a 20% rise: offer explains it, defaults to 80%, and the % is adjustable', async ({ page }) => {
    await withSpend(page, { Groceries: { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 } });
    await expect(offer(page)).toBeVisible();
    await expect(offer(page).locator('.goal-offer-title')).toHaveText('Set a goal for Groceries?');
    await expect(offer(page).locator('.goal-offer-sub')).toContainText('Up 20% last month: ₹1,000 in September → ₹1,200 in October.');
    await expect(offer(page).locator('.goal-pct-input')).toHaveValue('80');
    await expect(offer(page).locator('.goal-offer-target .amt')).toHaveText('₹800');

    await offer(page).locator('.goal-pct-input').fill('90');
    await expect(offer(page).locator('.goal-offer-target .amt')).toHaveText('₹900');
    await offer(page).locator('.goal-btn-primary').click();

    await expect(offer(page)).toHaveCount(0);
    const card = page.locator('#goalsArea .goal-card');
    await expect(card.locator('.goal-card-name')).toHaveText('Groceries goal');
    await expect(card.locator('.goal-numbers .target')).toHaveText('/ ₹900');
    await expect(page.locator('#toast')).toHaveText('Goal set — keep Groceries under ₹900');
    expect(await page.evaluate(() => window.__goalWrites)).toBe(1);
    expect(await page.evaluate(() => userProfile.categoryGoals.Groceries)).toMatchObject({ month: '2026-11', target: 900, pct: 90, baselineMin: 1000 });
  });

  test('"Not now" hides the offer for the rest of the month', async ({ page }) => {
    await withSpend(page, { Groceries: { '2026-08': 1000, '2026-09': 1000, '2026-10': 1200 } });
    await offer(page).locator('.goal-btn-ghost').click();
    await expect(offer(page)).toHaveCount(0);
    await page.evaluate(() => renderGoals());
    await expect(offer(page)).toHaveCount(0);
  });

  test('only the rising category is offered, even if a flat one is bigger', async ({ page }) => {
    await withSpend(page, {
      'Eating out': { '2026-08': 5000, '2026-09': 5000, '2026-10': 5000 },
      Groceries: { '2026-08': 1000, '2026-09': 1000, '2026-10': 1500 },
    });
    await expect(offer(page).locator('.goal-offer-title')).toHaveText('Set a goal for Groceries?');
  });
});
