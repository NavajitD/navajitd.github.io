// Onboarding → credit cards: name, statement date, due date, last 4 digits.
// Same rules as Profile → Add payment method, stored the same way
// (creditCards + cardDetails), so the billing cycle works from day one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, plain } from './_expenses-harness.js';

function onboardingApp({ chips = ['Credit card', 'Cash'], categories = ['Groceries'] } = {}) {
  const app = createApp();
  app.el = app.getById;
  app.t.setUserProfile(null);
  app.t.setCurrentUser({ uid: 'u1', displayName: 'New User', email: 'new@example.com', photoURL: '' });
  // getSelectedChips() reads `.chip.selected` children of the grids.
  app.el('onboardPayments').querySelectorAll = () => chips.map(textContent => ({ textContent }));
  app.el('onboardCategories').querySelectorAll = () => categories.map(textContent => ({ textContent }));
  app.ctx.initOnboarding();
  app.card = ({ name = '', statement = '', due = '', last4 = '' } = {}) => {
    app.el('customCCInput').value = name;
    app.el('onboardCCStatement').value = String(statement);
    app.el('onboardCCDue').value = String(due);
    app.el('onboardCCLast4').value = last4;
  };
  app.saved = () => app.txWrites.find(w => w.data && 'paymentMethods' in w.data)?.data;
  return app;
}

describe('onboarding card form', () => {
  test('initOnboarding starts with no cards and an empty form with day pickers', () => {
    const app = onboardingApp();
    app.t.setOnboardCards([{ name: 'Stale', statementDay: 1, dueDay: 2, last4: '' }]);
    app.el('customCCInput').value = 'leftover';
    app.ctx.initOnboarding();
    assert.deepEqual(plain(app.t.getOnboardCards()), []);
    assert.equal(app.el('customCCInput').value, '');
    assert.equal(app.el('onboardCCNames').innerHTML, '');
    for (const id of ['onboardCCStatement', 'onboardCCDue']) {
      assert.match(app.el(id).innerHTML, /<option value="">Select day<\/option>/);
      assert.match(app.el(id).innerHTML, /<option value="31">31st<\/option>/);
      assert.equal(app.el(id).value, '');
    }
  });

  test('adding a complete card stores numbers, renders the row and resets the form', () => {
    const app = onboardingApp();
    app.card({ name: '  HDFC   Millennia ', statement: 15, due: 3, last4: '1234' });
    assert.equal(app.ctx.addOnboardCard(), true);
    assert.deepEqual(plain(app.t.getOnboardCards()), [{ name: 'HDFC Millennia', statementDay: 15, dueDay: 3, last4: '1234' }]);
    const html = app.el('onboardCCNames').innerHTML;
    assert.ok(html.includes('data-card="HDFC Millennia"'));
    assert.ok(html.includes('•• 1234 · Statement 15th · Due 3rd'));
    assert.ok(html.includes('onclick="removeOnboardCard(0)"'));
    assert.equal(app.el('customCCInput').value, '');
    assert.equal(app.el('onboardCCStatement').value, '');
    assert.equal(app.el('onboardCCLast4').value, '');
  });

  test('last 4 digits are optional', () => {
    const app = onboardingApp();
    app.card({ name: 'Amex', statement: 1, due: 20 });
    assert.equal(app.ctx.addOnboardCard(), true);
    assert.equal(app.t.getOnboardCards()[0].last4, '');
    assert.ok(!app.el('onboardCCNames').innerHTML.includes('••'));
  });

  test('an incomplete card shows every error and is not added', () => {
    const app = onboardingApp();
    app.card({ name: '', last4: '12' });
    assert.equal(app.ctx.addOnboardCard(), false);
    assert.equal(app.t.getOnboardCards().length, 0);
    assert.match(app.el('obErr-name').textContent, /card name/);
    assert.match(app.el('obErr-statementDay').textContent, /statement/);
    assert.match(app.el('obErr-dueDay').textContent, /due/);
    assert.match(app.el('obErr-last4').textContent, /4 digits/);
    assert.ok(app.el('customCCInput').classList.contains('invalid'));
    // fixing it clears the errors
    app.card({ name: 'Amex', statement: 1, due: 20, last4: '' });
    assert.equal(app.ctx.addOnboardCard(), true);
    assert.equal(app.el('obErr-name').textContent, '');
    assert.ok(!app.el('customCCInput').classList.contains('invalid'));
  });

  test('duplicates among cards added so far: name (any case) and last 4', () => {
    const app = onboardingApp();
    app.card({ name: 'Millennia', statement: 15, due: 3, last4: '1234' });
    app.ctx.addOnboardCard();
    app.card({ name: 'MILLENNIA', statement: 1, due: 20, last4: '1234' });
    assert.equal(app.ctx.addOnboardCard(), false);
    assert.match(app.el('obErr-name').textContent, /already have a card/);
    assert.match(app.el('obErr-last4').textContent, /Millennia already ends in 1234/);
    assert.equal(app.t.getOnboardCards().length, 1);
  });

  test('a brand-new user can use the names the app falls back to for old profiles', () => {
    const app = onboardingApp();
    app.card({ name: 'Sapphiro', statement: 25, due: 12 });
    assert.equal(app.ctx.addOnboardCard(), true);
  });

  test('markup and reserved names are rejected', () => {
    const app = onboardingApp();
    for (const name of ['<b>x</b>', 'A"B', 'CC - Foo', 'Credit card']) {
      app.card({ name, statement: 1, due: 20 });
      assert.equal(app.ctx.addOnboardCard(), false, name);
    }
    assert.equal(app.t.getOnboardCards().length, 0);
  });

  test('removing a card; out-of-range index is ignored', () => {
    const app = onboardingApp();
    for (const n of ['A1', 'B2', 'C3']) { app.card({ name: n, statement: 5, due: 25 }); app.ctx.addOnboardCard(); }
    app.ctx.removeOnboardCard(1);
    assert.deepEqual(plain(app.t.getOnboardCards().map(c => c.name)), ['A1', 'C3']);
    app.ctx.removeOnboardCard(9);
    app.ctx.removeOnboardCard(-1);
    assert.equal(app.t.getOnboardCards().length, 2);
    assert.ok(!app.el('onboardCCNames').innerHTML.includes('B2'));
  });

  test('stored names are escaped in the card list', () => {
    const app = onboardingApp();
    app.t.setOnboardCards([{ name: '<img src=x>', statementDay: 1, dueDay: 2, last4: '' }]);
    app.ctx.renderOnboardCards();
    assert.ok(!app.el('onboardCCNames').innerHTML.includes('<img'));
  });

  test('onboardCardFormTouched sees any filled field', () => {
    const app = onboardingApp();
    assert.equal(app.ctx.onboardCardFormTouched(), false);
    for (const [k, v] of [['name', 'X'], ['statement', '5'], ['due', '5'], ['last4', '1']]) {
      app.card({ [k]: v });
      assert.equal(app.ctx.onboardCardFormTouched(), true, k);
    }
    app.card({ name: '   ' });
    assert.equal(app.ctx.onboardCardFormTouched(), false, 'whitespace only');
  });
});

describe('buildOnboardingPaymentFields', () => {
  const { ctx } = createApp();
  const cards = Object.freeze([
    Object.freeze({ name: 'Millennia', statementDay: 15, dueDay: 3, last4: '1234' }),
    Object.freeze({ name: 'Amex', statementDay: 1, dueDay: 20 }),
  ]);

  test('with "Credit card" selected: names + details, last4 defaulted', () => {
    assert.deepEqual(plain(ctx.buildOnboardingPaymentFields(['Cash', 'Credit card'], cards)), {
      paymentMethods: ['Cash', 'Credit card'],
      creditCards: ['Millennia', 'Amex'],
      cardDetails: [
        { name: 'Millennia', statementDay: 15, dueDay: 3, last4: '1234' },
        { name: 'Amex', statementDay: 1, dueDay: 20, last4: '' },
      ],
    });
  });

  test('without "Credit card": cards are dropped even if some were added', () => {
    assert.deepEqual(plain(ctx.buildOnboardingPaymentFields(['Cash', 'GPay UPI'], cards)),
      { paymentMethods: ['Cash', 'GPay UPI'], creditCards: [], cardDetails: [] });
  });

  test('"credit card" match is case-insensitive', () => {
    assert.equal(ctx.buildOnboardingPaymentFields(['CREDIT CARD'], cards).creditCards.length, 2);
  });

  test('returns copies, not the inputs', () => {
    const payments = ['Credit card'];
    const out = ctx.buildOnboardingPaymentFields(payments, cards);
    assert.notEqual(out.paymentMethods, payments);
    assert.notEqual(out.cardDetails[0], cards[0]);
  });

  test('the saved profile drives the card billing cycle', () => {
    const app = createApp();
    app.t.setUserProfile(app.ctx.buildOnboardingPaymentFields(['Credit card'], cards));
    assert.equal(app.ctx.getBillingCycle(new Date(2026, 2, 10), 'Millennia'), 'Feb 16 - Mar 15');
    assert.equal(app.ctx.describeBillingCycle(new Date(2026, 2, 10), 'Millennia'), 'Billing Cycle: Feb 16 - Mar 15 · Due Apr 3');
  });
});

describe('saveOnboarding', () => {
  test('writes creditCards + cardDetails with the profile', async () => {
    const app = onboardingApp();
    app.card({ name: 'Millennia', statement: 15, due: 3, last4: '1234' });
    app.ctx.addOnboardCard();
    await app.ctx.saveOnboarding();
    const saved = app.saved();
    assert.ok(saved, 'profile written');
    assert.deepEqual(plain(saved.paymentMethods), ['Credit card', 'Cash']);
    assert.deepEqual(plain(saved.creditCards), ['Millennia']);
    assert.deepEqual(plain(saved.cardDetails), [{ name: 'Millennia', statementDay: 15, dueDay: 3, last4: '1234' }]);
    assert.equal(saved.email, 'new@example.com');
    assert.deepEqual(plain(app.t.getUserProfile().cardDetails), plain(saved.cardDetails));
  });

  test('a filled-in card that was never “+ Add Card”-ed is added on save', async () => {
    const app = onboardingApp();
    app.card({ name: 'Amex', statement: 1, due: 20 });
    await app.ctx.saveOnboarding();
    assert.deepEqual(plain(app.saved().creditCards), ['Amex']);
  });

  test('a half-filled card blocks saving and shows its errors', async () => {
    const app = onboardingApp();
    app.card({ name: 'Amex' }); // no dates
    await app.ctx.saveOnboarding();
    assert.equal(app.saved(), undefined);
    assert.match(app.el('toast').textContent, /Finish the card details/);
    assert.match(app.el('obErr-statementDay').textContent, /statement/);
    assert.equal(app.el('onboardSaveBtn').disabled, false);
    assert.equal(app.el('onboardSaveBtn').textContent, 'Save & Start Tracking');
  });

  test('"Credit card" selected with no cards is refused', async () => {
    const app = onboardingApp();
    await app.ctx.saveOnboarding();
    assert.equal(app.saved(), undefined);
    assert.match(app.el('toast').textContent, /at least one credit card/);
  });

  test('without "Credit card", card fields are ignored entirely', async () => {
    const app = onboardingApp({ chips: ['Cash'] });
    app.card({ name: 'Leftover' }); // hidden section, half filled
    await app.ctx.saveOnboarding();
    const saved = app.saved();
    assert.deepEqual(plain(saved.creditCards), []);
    assert.deepEqual(plain(saved.cardDetails), []);
  });

  test('still enforces payment method / category / user-cap guards', async () => {
    let app = onboardingApp({ chips: [] });
    await app.ctx.saveOnboarding();
    assert.match(app.el('toast').textContent, /payment method/);
    app = onboardingApp({ categories: [] });
    await app.ctx.saveOnboarding();
    assert.match(app.el('toast').textContent, /category/);
    app = onboardingApp({ chips: ['Cash'] });
    app.txState.userCount = 15;
    await app.ctx.saveOnboarding();
    assert.equal(app.saved(), undefined);
    assert.equal(app.el('capScreen').style.display, 'flex');
  });
});

describe('custom payment / category chips', () => {
  test('markup characters are refused', () => {
    const app = onboardingApp();
    const grid = app.el('onboardPayments');
    grid.querySelectorAll = () => [];
    for (const v of ['<b>x</b>', 'A"B', 'a`b', 'a\\b']) {
      app.el('customPaymentInput').value = v;
      app.ctx.addCustomChip('onboardPayments', 'customPaymentInput');
    }
    assert.equal(grid.children.length, 0);
    assert.match(app.el('toast').textContent, /Avoid/);
  });

  test('plain names are added (whitespace collapsed), duplicates refused', () => {
    const app = onboardingApp();
    const grid = app.el('onboardPayments');
    grid.querySelectorAll = () => grid.children;
    app.el('customPaymentInput').value = '  PhonePe   UPI ';
    app.ctx.addCustomChip('onboardPayments', 'customPaymentInput');
    assert.equal(grid.children.length, 1);
    assert.equal(grid.children[0].textContent, 'PhonePe UPI');
    app.el('customPaymentInput').value = 'phonepe upi';
    app.ctx.addCustomChip('onboardPayments', 'customPaymentInput');
    assert.equal(grid.children.length, 1);
  });
});
