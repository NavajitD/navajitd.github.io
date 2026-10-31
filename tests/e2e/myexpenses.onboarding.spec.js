// End-to-end: onboarding collects each credit card's name, statement date,
// payment due date and last 4 digits, and the saved profile drives the
// billing cycle and the Profile sheet straight away.
//
// Sign-in is skipped the same way as the profile spec: wait for the
// signed-out state, inject a new (profile-less) user, and stub only the
// Firestore transaction that creates the profile.

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/MyExpenses/expenses.html';
const NOISE = /firebase|firestore|auth|network|sign-in|popup|redirect|persistence|quota|offline|installations|400|403|net::/i;

async function newUser(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  await page.route(/firestore\.googleapis\.com|identitytoolkit|securetoken/, r => r.abort());
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginScreen')).toBeVisible({ timeout: 8000 });
  await page.evaluate(() => {
    currentUser = { uid: 'e2e-new', displayName: 'New User', email: 'new@example.com', photoURL: '' };
    userProfile = null;
    window.__tx = [];
    db.runTransaction = async fn => fn({
      get: async () => ({ exists: true, data: () => ({ userCount: 3 }) }),
      set: (ref, data) => {
        if ('paymentMethods' in data) {
          const { paymentMethods, creditCards, cardDetails, categories } = data;
          window.__tx.push(JSON.parse(JSON.stringify({ paymentMethods, creditCards, cardDetails, categories })));
        }
      },
    });
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('userMenu').style.display = 'flex';
    initOnboarding();
    document.getElementById('onboardingScreen').style.display = 'block';
    document.getElementById('onboardingScreen').classList.add('active');
  });
  return errors;
}

const chip = (page, grid, text) => page.locator(`#${grid} .chip`, { hasText: new RegExp(`^${text}$`) });
const cards = page => page.locator('#onboardCCNames [data-card]');

async function typeCard(page, { name, statement, due, last4 }) {
  if (name !== undefined) await page.locator('#customCCInput').fill(name);
  if (statement !== undefined) await page.locator('#onboardCCStatement').selectOption(String(statement));
  if (due !== undefined) await page.locator('#onboardCCDue').selectOption(String(due));
  if (last4 !== undefined) await page.locator('#onboardCCLast4').fill(last4);
}

test.describe('MyExpenses — onboarding credit cards', () => {
  test('card section appears only when "Credit card" is selected', async ({ page }) => {
    await newUser(page);
    await expect(page.locator('#onboardCCSection')).toBeHidden();
    await chip(page, 'onboardPayments', 'Credit card').click();
    await expect(page.locator('#onboardCCSection')).toBeVisible();
    for (const label of ['Card name', 'Statement date', 'Payment due date', 'Last 4 digits'])
      await expect(page.locator('#onboardCCSection label', { hasText: label })).toBeVisible();
    await expect(page.locator('#onboardCCStatement option')).toHaveCount(32);
    await chip(page, 'onboardPayments', 'Credit card').click();
    await expect(page.locator('#onboardCCSection')).toBeHidden();
  });

  test('add, validate, de-duplicate and remove cards', async ({ page }) => {
    await newUser(page);
    await chip(page, 'onboardPayments', 'Credit card').click();

    await page.locator('#onboardAddCardBtn').click();
    await expect(page.locator('#obErr-name')).toHaveText('Enter the card name');
    await expect(page.locator('#obErr-statementDay')).toHaveText('Pick the statement date');
    await expect(page.locator('#obErr-dueDay')).toHaveText('Pick the payment due date');
    await expect(page.locator('#customCCInput')).toBeFocused();
    await expect(cards(page)).toHaveCount(0);

    await typeCard(page, { name: 'HDFC Millennia', statement: 15, due: 3 });
    await page.locator('#onboardCCLast4').pressSequentially('12x34');
    await expect(page.locator('#onboardCCLast4')).toHaveValue('1234');
    await page.locator('#onboardCCLast4').press('Enter'); // Enter adds the card
    await expect(cards(page).locator('.pm-meta')).toHaveText(['•• 1234 · Statement 15th · Due 3rd']);
    await expect(page.locator('#obErr-name')).toBeHidden();
    await expect(page.locator('#customCCInput')).toHaveValue('');
    await expect(page.locator('#onboardCCStatement')).toHaveValue('');

    await typeCard(page, { name: 'hdfc millennia', statement: 1, due: 20, last4: '1234' });
    await page.locator('#onboardAddCardBtn').click();
    await expect(page.locator('#obErr-name')).toHaveText('You already have a card with this name');
    await expect(page.locator('#obErr-last4')).toHaveText('HDFC Millennia already ends in 1234');

    await typeCard(page, { name: 'Amex Gold', statement: 1, due: 20, last4: '' });
    await page.locator('#onboardAddCardBtn').click();
    await expect(cards(page).locator('.pm-name')).toHaveText(['HDFC Millennia', 'Amex Gold']);
    await expect(cards(page).nth(1).locator('.pm-meta')).toHaveText('Statement 1st · Due 20th');

    await cards(page).first().locator('.pm-remove').click();
    await expect(cards(page).locator('.pm-name')).toHaveText(['Amex Gold']);
  });

  test('saving creates the profile with card details; Profile + billing cycle use them', async ({ page }) => {
    const errors = await newUser(page);
    await chip(page, 'onboardPayments', 'Credit card').click();
    await chip(page, 'onboardPayments', 'Cash').click();
    await chip(page, 'onboardCategories', 'Groceries').click();
    await typeCard(page, { name: 'HDFC Millennia', statement: 15, due: 3, last4: '1234' });
    await page.locator('#onboardAddCardBtn').click();
    // Second card typed but not "+ Add Card"-ed: saving picks it up.
    await typeCard(page, { name: 'Amex Gold', statement: 1, due: 20 });
    await page.locator('#onboardSaveBtn').click();

    await expect(page.locator('#onboardingScreen')).toBeHidden();
    await expect(page.locator('#mainApp')).toBeVisible();
    const [saved] = await page.evaluate(() => window.__tx);
    expect(saved.paymentMethods).toEqual(['Credit card', 'Cash']);
    expect(saved.creditCards).toEqual(['HDFC Millennia', 'Amex Gold']);
    expect(saved.cardDetails).toEqual([
      { name: 'HDFC Millennia', statementDay: 15, dueDay: 3, last4: '1234' },
      { name: 'Amex Gold', statementDay: 1, dueDay: 20, last4: '' },
    ]);

    await page.locator('#userAvatar').click();
    await expect(page.locator('#profilePaymentList [data-card="HDFC Millennia"] .pm-meta')).toHaveText('•• 1234 · Statement 15th · Due 3rd');
    await expect(page.locator('#profilePaymentList [data-card="Amex Gold"] .pm-meta')).toHaveText('Statement 1st · Due 20th');
    await page.locator('#profileSheet .sheet-close').click();

    await page.evaluate(() => openFormSheet());
    await page.locator('#expPayment').selectOption('Credit card');
    await page.locator('#expDate').fill('2026-03-10');
    await page.locator('#cardPickerRadios input[value="HDFC Millennia"]').check();
    await expect(page.locator('#billingInfo')).toHaveText('Billing Cycle: Feb 16 - Mar 15 · Due Apr 3');
    await page.locator('#cardPickerRadios input[value="Amex Gold"]').check();
    await expect(page.locator('#billingInfo')).toHaveText('Billing Cycle: Mar 2 - Apr 1 · Due Apr 20');
    expect(errors.filter(e => !NOISE.test(e))).toEqual([]);
  });

  test('a half-filled card blocks saving', async ({ page }) => {
    await newUser(page);
    await chip(page, 'onboardPayments', 'Credit card').click();
    await chip(page, 'onboardCategories', 'Groceries').click();
    await typeCard(page, { name: 'Amex Gold' });
    await page.locator('#onboardSaveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Finish the card details or clear them');
    await expect(page.locator('#obErr-statementDay')).toHaveText('Pick the statement date');
    await expect(page.locator('#onboardingScreen')).toBeVisible();
    await expect(page.locator('#onboardSaveBtn')).toBeEnabled();
    expect(await page.evaluate(() => window.__tx)).toEqual([]);
  });

  test('"Credit card" with no cards is refused; without it, no cards are saved', async ({ page }) => {
    await newUser(page);
    await chip(page, 'onboardPayments', 'Credit card').click();
    await chip(page, 'onboardCategories', 'Groceries').click();
    await page.locator('#onboardSaveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Add at least one credit card');

    await typeCard(page, { name: 'Amex Gold', statement: 1, due: 20 });
    await page.locator('#onboardAddCardBtn').click();
    await chip(page, 'onboardPayments', 'Credit card').click(); // changed their mind
    await chip(page, 'onboardPayments', 'Cash').click();
    await page.locator('#onboardSaveBtn').click();
    await expect(page.locator('#mainApp')).toBeVisible();
    const [saved] = await page.evaluate(() => window.__tx);
    expect(saved.creditCards).toEqual([]);
    expect(saved.cardDetails).toEqual([]);
  });

  test('custom payment names with markup are refused', async ({ page }) => {
    await newUser(page);
    await page.locator('#customPaymentInput').fill('<b id=pwn>x</b>');
    await page.locator('#customPaymentInput + button').click();
    await expect(page.locator('#toast')).toHaveText('Avoid < > " ` and \\ in names');
    await expect(chip(page, 'onboardPayments', '<b id=pwn>x</b>')).toHaveCount(0);
  });

  test('fits a phone screen without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await newUser(page);
    await chip(page, 'onboardPayments', 'Credit card').click();
    await typeCard(page, { name: 'HDFC Millennia', statement: 15, due: 3, last4: '1234' });
    await page.locator('#onboardAddCardBtn').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('#onboardAddCardBtn')).toBeVisible();
  });
});
