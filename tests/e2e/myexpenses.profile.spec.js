// End-to-end tests for the MyExpenses profile sheet (avatar → Profile →
// payment methods). Runs the real page in Chromium.
//
// The app sits behind Google sign-in, so each test waits for the signed-out
// state, then injects a signed-in user + profile into the page's own globals
// and stubs only the Firestore write (persistProfileUpdate). Everything else
// — markup, CSS, event handlers, validation, rendering — is the shipped code.

import { test, expect } from '@playwright/test';

const PAGE = '/Projects/MyExpenses/expenses.html';
const NOISE = /firebase|firestore|auth|network|sign-in|popup|redirect|persistence|quota|offline|installations|400|403|net::/i;

const PROFILE = {
  paymentMethods: ['GPay UPI', 'Credit card', 'Cash'],
  creditCards: ['Sapphiro', 'Neucard'],
  categories: ['Groceries', 'Eating out', 'Shopping'],
  themes: { Needs: ['Groceries'], Wants: ['Eating out', 'Shopping'] },
  learnedKeywords: {},
};

async function signedIn(page, { profile = PROFILE, failWrites = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  // Keep the test hermetic: no real Firestore / auth traffic.
  await page.route(/firestore\.googleapis\.com|identitytoolkit|securetoken/, r => r.abort());
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginScreen')).toBeVisible({ timeout: 8000 }); // auth resolved: signed out
  await page.evaluate(({ profile, failWrites }) => {
    currentUser = { uid: 'e2e-user', displayName: 'Test User', email: 'test@example.com', photoURL: '' };
    userProfile = JSON.parse(JSON.stringify(profile));
    window.__writes = [];
    window.persistProfileUpdate = patch => {
      window.__writes.push(JSON.parse(JSON.stringify(patch)));
      return failWrites ? Promise.reject(new Error('permission-denied')) : Promise.resolve();
    };
    applyUserProfile();
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('userMenu').style.display = 'flex';
  }, { profile, failWrites });
  return errors;
}

const sheet = page => page.locator('#profileSheet');
const list = page => page.locator('#profilePaymentList');
const writes = page => page.evaluate(() => window.__writes);
const openProfile = page => page.locator('#userAvatar').click();

async function fillCard(page, { name, statement, due, last4 }) {
  await page.locator('#profileAddPmBtn').click();
  await expect(page.locator('#pmType')).toHaveValue('Credit card');
  if (name !== undefined) await page.locator('#pmName').fill(name);
  if (statement !== undefined) await page.locator('#pmStatementDay').selectOption(String(statement));
  if (due !== undefined) await page.locator('#pmDueDay').selectOption(String(due));
  if (last4 !== undefined) await page.locator('#pmLast4').fill(last4);
}

test.describe('MyExpenses — profile sheet', () => {
  test('avatar opens the profile with identity, cards and other methods', async ({ page }) => {
    const errors = await signedIn(page);
    await expect(sheet(page)).toBeHidden();
    await openProfile(page);
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('#profileName')).toHaveText('Test User');
    await expect(page.locator('#profileEmail')).toHaveText('test@example.com');
    await expect(page.locator('#profileAvatar')).toBeHidden(); // no photo URL → no broken image
    await expect(list(page).locator('[data-card]')).toHaveText([/Sapphiro.*Add statement & due dates/s, /Neucard.*Add statement & due dates/s]);
    await expect(list(page).locator('[data-method] .pm-name')).toHaveText(['GPay UPI', 'Cash']); // generic "Credit card" not listed
    await expect(page.locator('#pmForm')).toBeHidden();
    await expect(page.locator('.profile-signout')).toBeVisible();
    expect(errors.filter(e => !NOISE.test(e))).toEqual([]);
  });

  test('closes via ✕, backdrop and Escape; avatar works from the keyboard', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    await page.locator('#profileSheet .sheet-close').click();
    await expect(sheet(page)).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    await openProfile(page);
    await page.mouse.click(10, 10); // backdrop above the panel
    await expect(sheet(page)).toBeHidden();

    await page.locator('#userAvatar').focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
  });

  test('card fields show only for the Credit card type', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    await page.locator('#profileAddPmBtn').click();
    await expect(page.locator('#profileAddPmBtn')).toBeHidden();
    await expect(page.locator('#pmCardFields')).toBeVisible();
    await expect(page.locator('#pmNameLabel')).toHaveText('Card name');
    await page.locator('#pmType').selectOption('UPI');
    await expect(page.locator('#pmCardFields')).toBeHidden();
    await expect(page.locator('#pmNameLabel')).toHaveText('Name');
    await page.locator('#pmType').selectOption('Credit card');
    await expect(page.locator('#pmCardFields')).toBeVisible();
    await expect(page.locator('#pmStatementDay option')).toHaveCount(32); // placeholder + 1st…31st
    await page.locator('.pm-cancel-btn').click();
    await expect(page.locator('#pmForm')).toBeHidden();
    await expect(page.locator('#profileAddPmBtn')).toBeVisible();
  });

  test('empty card form shows inline errors and writes nothing', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    await page.locator('#profileAddPmBtn').click();
    await page.locator('#pmSaveBtn').click();
    await expect(page.locator('#pmErr-name')).toHaveText('Enter the card name');
    await expect(page.locator('#pmErr-statementDay')).toHaveText('Pick the statement date');
    await expect(page.locator('#pmErr-dueDay')).toHaveText('Pick the payment due date');
    await expect(page.locator('#pmErr-last4')).toBeHidden(); // optional
    await expect(page.locator('#pmName')).toHaveClass(/invalid/);
    await expect(page.locator('#pmName')).toBeFocused();
    expect(await writes(page)).toEqual([]);
  });

  test('last-4 input keeps digits only, max 4', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    await page.locator('#profileAddPmBtn').click();
    await page.locator('#pmLast4').pressSequentially('12ab3-4567');
    await expect(page.locator('#pmLast4')).toHaveValue('1234');
  });

  test('adding a credit card saves name, statement, due date and last 4', async ({ page }) => {
    const errors = await signedIn(page);
    await openProfile(page);
    await fillCard(page, { name: 'HDFC Millennia', statement: 15, due: 3, last4: '1234' });
    await page.locator('#pmSaveBtn').click();

    await expect(page.locator('#pmForm')).toBeHidden();
    await expect(page.locator('#toast')).toHaveText('HDFC Millennia added');
    await expect(list(page).locator('[data-card="HDFC Millennia"] .pm-meta')).toHaveText('•• 1234 · Statement 15th · Due 3rd');

    expect(await writes(page)).toEqual([{
      paymentMethods: ['GPay UPI', 'Credit card', 'Cash'],
      creditCards: ['Sapphiro', 'Neucard', 'HDFC Millennia'],
      cardDetails: [{ name: 'HDFC Millennia', statementDay: 15, dueDay: 3, last4: '1234' }],
    }]);
    // The add-expense card picker and the edit dropdown pick it up immediately.
    await expect(page.locator('#cardPickerRadios input[value="HDFC Millennia"]')).toHaveCount(1);
    await expect(page.locator('#editExpPayment option[value="CC - HDFC Millennia"]')).toHaveCount(1);
    expect(errors.filter(e => !NOISE.test(e))).toEqual([]);
  });

  test('Enter in the name field submits the form', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    await page.locator('#profileAddPmBtn').click();
    await page.locator('#pmType').selectOption('Wallet');
    await page.locator('#pmName').fill('Paytm Wallet');
    await page.locator('#pmName').press('Enter');
    await expect(list(page).locator('[data-method="Paytm Wallet"]')).toHaveCount(1);
  });

  test('the add-expense form shows the card’s own cycle and due date', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    await fillCard(page, { name: 'HDFC Millennia', statement: 15, due: 3, last4: '1234' });
    await page.locator('#pmSaveBtn').click();
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 1, y: 1 } }); // move focus off the form

    await page.evaluate(() => openFormSheet());
    await page.locator('#expPayment').selectOption('Credit card');
    await page.locator('#expDate').fill('2026-03-10');
    await page.evaluate(() => updateBillingInfo()); // initApp's change listener isn't attached in this harness
    await page.locator('#cardPickerRadios input[value="HDFC Millennia"]').check();
    await expect(page.locator('#billingInfo')).toHaveText('Billing Cycle: Feb 16 - Mar 15 · Due Apr 3');
    await page.locator('#cardPickerRadios input[value="Sapphiro"]').check();
    await expect(page.locator('#billingInfo')).toHaveText('Billing Cycle: Feb 25 - Mar 25'); // legacy, no details
  });

  test('adding a method keeps the add-expense form’s current selection', async ({ page }) => {
    await signedIn(page);
    await page.evaluate(() => { document.getElementById('expPayment').value = 'Cash'; });
    await openProfile(page);
    await page.locator('#profileAddPmBtn').click();
    await page.locator('#pmType').selectOption('UPI');
    await page.locator('#pmName').fill('PhonePe UPI');
    await page.locator('#pmSaveBtn').click();
    await expect(page.locator('#expPayment option[value="PhonePe UPI"]')).toHaveCount(1);
    await expect(page.locator('#expPayment')).toHaveValue('Cash');
    await expect(list(page).locator('[data-method] .pm-name')).toHaveText(['GPay UPI', 'Cash', 'PhonePe UPI']);
  });

  test('duplicates are rejected: method name, card name, last 4', async ({ page }) => {
    await signedIn(page, { profile: { ...PROFILE, cardDetails: [{ name: 'Neucard', statementDay: 20, dueDay: 8, last4: '9876' }] } });
    await openProfile(page);
    await page.locator('#profileAddPmBtn').click();
    await page.locator('#pmType').selectOption('UPI');
    await page.locator('#pmName').fill('gpay upi');
    await page.locator('#pmSaveBtn').click();
    await expect(page.locator('#pmErr-name')).toHaveText('This payment method already exists');

    await page.locator('#pmType').selectOption('Credit card');
    await page.locator('#pmName').fill('SAPPHIRO');
    await page.locator('#pmStatementDay').selectOption('1');
    await page.locator('#pmDueDay').selectOption('20');
    await page.locator('#pmLast4').fill('9876');
    await page.locator('#pmSaveBtn').click();
    await expect(page.locator('#pmErr-name')).toHaveText('You already have a card with this name');
    await expect(page.locator('#pmErr-last4')).toHaveText('Neucard already ends in 9876');
    expect(await writes(page)).toEqual([]);
  });

  test('editing a legacy card adds its details; name and type are locked', async ({ page }) => {
    const { creditCards, ...legacy } = PROFILE; // old profile: no creditCards field
    await signedIn(page, { profile: legacy });
    await openProfile(page);
    await list(page).locator('[data-card="Sapphiro"] button', { hasText: 'Edit' }).click();
    await expect(page.locator('#pmFormTitle')).toHaveText('Edit Sapphiro');
    await expect(page.locator('#pmName')).toHaveValue('Sapphiro');
    await expect(page.locator('#pmName')).toHaveAttribute('readonly', '');
    await expect(page.locator('#pmType')).toBeDisabled();
    await page.locator('#pmStatementDay').selectOption('25');
    await page.locator('#pmDueDay').selectOption('12');
    await page.locator('#pmLast4').fill('5678');
    await page.locator('#pmSaveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Sapphiro updated');
    await expect(list(page).locator('[data-card="Sapphiro"] .pm-meta')).toHaveText('•• 5678 · Statement 25th · Due 12th');
    const [w] = await writes(page);
    expect(w.creditCards).toEqual(['Sapphiro', 'Neucard']);
    expect(w.cardDetails).toEqual([{ name: 'Sapphiro', statementDay: 25, dueDay: 12, last4: '5678' }]);
  });

  test('remove asks first; cancel keeps, accept removes', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    page.once('dialog', d => { expect(d.message()).toContain('Remove Neucard?'); d.dismiss(); });
    await list(page).locator('[data-card="Neucard"] .pm-remove').click();
    await expect(list(page).locator('[data-card="Neucard"]')).toHaveCount(1);

    page.once('dialog', d => d.accept());
    await list(page).locator('[data-card="Neucard"] .pm-remove').click();
    await expect(list(page).locator('[data-card="Neucard"]')).toHaveCount(0);
    await expect(page.locator('#cardPickerRadios input[value="Neucard"]')).toHaveCount(0);
    expect((await writes(page))[0].creditCards).toEqual(['Sapphiro']);
  });

  test('removing every card removes the Credit card option; last method is protected', async ({ page }) => {
    await signedIn(page, { profile: { ...PROFILE, paymentMethods: ['Credit card', 'Cash'], creditCards: ['Solo'] } });
    page.on('dialog', d => d.accept());
    await openProfile(page);
    await list(page).locator('[data-card="Solo"] .pm-remove').click();
    await expect(list(page)).toContainText('No credit cards yet');
    await expect(page.locator('#expPayment option[value="Credit card"]')).toHaveCount(0);
    await list(page).locator('[data-method="Cash"] .pm-remove').click();
    await expect(page.locator('#toast')).toHaveText('Keep at least one payment method');
    await expect(list(page).locator('[data-method="Cash"]')).toHaveCount(1);
  });

  test('a failed save rolls back and shows the error', async ({ page }) => {
    await signedIn(page, { failWrites: true });
    await openProfile(page);
    await fillCard(page, { name: 'Amazon Pay', statement: 12, due: 1 });
    await page.locator('#pmSaveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Couldn’t save: permission-denied');
    await expect(list(page).locator('[data-card="Amazon Pay"]')).toHaveCount(0);
    await expect(page.locator('#cardPickerRadios input[value="Amazon Pay"]')).toHaveCount(0);
  });

  test('markup characters are rejected in new names', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    await fillCard(page, { name: '<b id=pwn>x</b>', statement: 1, due: 20 });
    await page.locator('#pmSaveBtn').click();
    await expect(page.locator('#pmErr-name')).toHaveText('Avoid < > " ` and \\ in the name');
    await expect(page.locator('#pwn')).toHaveCount(0);
    expect(await writes(page)).toEqual([]);
  });

  test('stored names with markup render as text everywhere (profile list, dropdowns, radios)', async ({ page }) => {
    const evil = '<img id=pwn src=x onerror="window.__pwned=1">';
    await signedIn(page, { profile: { ...PROFILE, paymentMethods: ['Cash', 'Credit card', evil], creditCards: ['Sapphiro', 'A"B' + evil] } });
    await openProfile(page);
    await expect(page.locator('#pwn')).toHaveCount(0);
    await expect(list(page).locator('[data-method] .pm-name').nth(1)).toHaveText(evil);
    await expect(page.locator('#expPayment option').nth(2)).toHaveText(evil);
    await expect(page.locator('#cardPickerRadios input[type=radio]')).toHaveCount(2);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('sign out lives in the profile and closes it', async ({ page }) => {
    await signedIn(page);
    await openProfile(page);
    await page.locator('.profile-signout').click();
    await expect(sheet(page)).toBeHidden();
  });

  test('fits a phone screen without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signedIn(page);
    await openProfile(page);
    await page.locator('#profileAddPmBtn').click();
    const box = await page.locator('#profileSheet .sheet-panel').boundingBox();
    expect(box.width).toBeLessThanOrEqual(360);
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector('#profileSheet .sheet-panel');
      return panel.scrollWidth - panel.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await page.locator('#pmSaveBtn').scrollIntoViewIfNeeded();
    await expect(page.locator('#pmSaveBtn')).toBeInViewport();
  });
});
