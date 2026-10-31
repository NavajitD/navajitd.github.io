// Profile → payment methods: per-card statement/due dates, last-4 matching,
// validation, profile patches, and the profile-sheet controller.
//
// All functions are the real ones from Projects/MyExpenses/expenses.html,
// loaded through the vm harness (see _expenses-harness.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, plain } from './_expenses-harness.js';

const D = (y, m, d) => new Date(y, m - 1, d); // 1-based month for readability
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const cardProfile = (extra = {}) => ({
  paymentMethods: ['GPay UPI', 'Credit card', 'Cash'],
  creditCards: ['Sapphiro', 'Neucard', 'Millennia'],
  cardDetails: [
    { name: 'Millennia', statementDay: 15, dueDay: 3, last4: '1234' },
    { name: 'Neucard', statementDay: 20, dueDay: 8, last4: '9876' },
  ],
  ...extra,
});

// Deep-freeze so any accidental mutation of the input throws in strict code
// or at least is detectable by comparing to a snapshot.
function frozen(o) {
  Object.values(o).forEach(v => { if (v && typeof v === 'object') frozen(v); });
  return Object.freeze(o);
}

/* ─────────────────────────────── billing cycle ─────────────────────────────── */

describe('getBillingCycle', () => {
  const { ctx } = createApp();
  const p = cardProfile();

  test('no card / unknown card / card without details keep the legacy 25th cycle', () => {
    assert.equal(ctx.getBillingCycle(D(2026, 3, 10)), 'Feb 25 - Mar 25');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 10), null, p), 'Feb 25 - Mar 25');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 10), 'Unknown', p), 'Feb 25 - Mar 25');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 10), 'Sapphiro', p), 'Feb 25 - Mar 25');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 20), 'Sapphiro', p), 'Mar 25 - Apr 25');
  });

  test('statement day 15: before, on and after the statement date', () => {
    assert.equal(ctx.getBillingCycle(D(2026, 3, 10), 'Millennia', p), 'Feb 16 - Mar 15');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 15), 'Millennia', p), 'Feb 16 - Mar 15');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 16), 'Millennia', p), 'Mar 16 - Apr 15');
    assert.equal(ctx.getBillingCycle(D(2026, 2, 16), 'Millennia', p), 'Feb 16 - Mar 15');
  });

  test('card lookup is case-insensitive', () => {
    assert.equal(ctx.getBillingCycle(D(2026, 3, 10), 'millennia', p), 'Feb 16 - Mar 15');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 10), 'MILLENNIA ', p), 'Feb 16 - Mar 15');
  });

  test('wraps across the year boundary', () => {
    assert.equal(ctx.getBillingCycle(D(2026, 12, 25), 'Neucard', p), 'Dec 21 - Jan 20');
    assert.equal(ctx.getBillingCycle(D(2027, 1, 5), 'Neucard', p), 'Dec 21 - Jan 20');
    assert.equal(ctx.getBillingCycle(D(2026, 12, 20), 'Neucard', p), 'Nov 21 - Dec 20');
  });

  test('statement day 31 clamps to short months', () => {
    const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: 31, dueDay: 20 }] };
    assert.equal(ctx.getBillingCycle(D(2026, 2, 10), 'X', q), 'Feb 1 - Feb 28');
    assert.equal(ctx.getBillingCycle(D(2026, 2, 28), 'X', q), 'Feb 1 - Feb 28');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 1), 'X', q), 'Mar 1 - Mar 31');
    assert.equal(ctx.getBillingCycle(D(2026, 4, 30), 'X', q), 'Apr 1 - Apr 30');
    assert.equal(ctx.getBillingCycle(D(2028, 2, 29), 'X', q), 'Feb 1 - Feb 29'); // leap year
  });

  test('statement day 30 around February', () => {
    const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: 30, dueDay: 20 }] };
    assert.equal(ctx.getBillingCycle(D(2026, 2, 28), 'X', q), 'Jan 31 - Feb 28');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 1), 'X', q), 'Mar 1 - Mar 30');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 31), 'X', q), 'Mar 31 - Apr 30');
  });

  test('statement day 1', () => {
    const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: 1, dueDay: 20 }] };
    assert.equal(ctx.getBillingCycle(D(2026, 3, 1), 'X', q), 'Feb 2 - Mar 1');
    assert.equal(ctx.getBillingCycle(D(2026, 3, 2), 'X', q), 'Mar 2 - Apr 1');
  });

  test('invalid stored statement days fall back to the legacy cycle', () => {
    for (const bad of [0, 32, -1, 15.5, 'abc', null, undefined]) {
      const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: bad, dueDay: 3 }] };
      assert.equal(ctx.getBillingCycle(D(2026, 3, 10), 'X', q), 'Feb 25 - Mar 25', `statementDay=${bad}`);
    }
    // A numeric string (e.g. from an older write) is accepted.
    const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: '15', dueDay: 3 }] };
    assert.equal(ctx.getBillingCycle(D(2026, 3, 10), 'X', q), 'Feb 16 - Mar 15');
  });

  test('uses the in-app profile when none is passed', () => {
    const app = createApp();
    app.t.setUserProfile(cardProfile());
    assert.equal(app.ctx.getBillingCycle(D(2026, 3, 10), 'Millennia'), 'Feb 16 - Mar 15');
  });
});

describe('getCardCycleRange invariants (every statement day, three years)', () => {
  const { ctx } = createApp();
  test('each day sits in exactly one contiguous cycle ending on its statement date', () => {
    for (let s = 1; s <= 31; s++) {
      let prevEnd = null;
      for (let t = D(2026, 1, 1); t <= D(2028, 12, 31); t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
        const { start, end } = ctx.getCardCycleRange(t, s);
        assert.ok(start <= t && t <= end, `S=${s} ${ymd(t)} not in ${ymd(start)}..${ymd(end)}`);
        const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
        assert.equal(end.getDate(), Math.min(s, lastDay), `S=${s} end ${ymd(end)}`);
        const len = Math.round((end - start) / 86400000) + 1;
        assert.ok(len >= 28 && len <= 31, `S=${s} cycle length ${len} for ${ymd(t)}`);
        if (prevEnd && +end !== +prevEnd) {
          // New cycle: must start the day after the previous one ended.
          const dayAfter = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() + 1);
          assert.equal(ymd(start), ymd(dayAfter), `S=${s} gap/overlap at ${ymd(t)}`);
        }
        prevEnd = end;
      }
    }
  });
});

/* ─────────────────────────────── due date ─────────────────────────────── */

describe('getCardDueDate / describeBillingCycle', () => {
  const { ctx } = createApp();
  const p = cardProfile();

  test('due day earlier than the statement day lands next month', () => {
    assert.equal(ymd(ctx.getCardDueDate(D(2026, 3, 10), 'Millennia', p)), '2026-04-03');
    assert.equal(ymd(ctx.getCardDueDate(D(2026, 3, 16), 'Millennia', p)), '2026-05-03');
  });

  test('due day later than the statement day lands the same month', () => {
    const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: 5, dueDay: 25 }] };
    assert.equal(ymd(ctx.getCardDueDate(D(2026, 3, 1), 'X', q)), '2026-03-25');
    assert.equal(ymd(ctx.getCardDueDate(D(2026, 3, 6), 'X', q)), '2026-04-25');
  });

  test('due day equal to statement day is a month after the statement', () => {
    const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: 10, dueDay: 10 }] };
    assert.equal(ymd(ctx.getCardDueDate(D(2026, 3, 1), 'X', q)), '2026-04-10');
  });

  test('wraps the year and clamps short months', () => {
    assert.equal(ymd(ctx.getCardDueDate(D(2026, 12, 25), 'Neucard', p)), '2027-02-08');
    const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: 5, dueDay: 31 }] };
    assert.equal(ymd(ctx.getCardDueDate(D(2026, 2, 3), 'X', q)), '2026-02-28');
    assert.equal(ymd(ctx.getCardDueDate(D(2026, 4, 3), 'X', q)), '2026-04-30');
  });

  test('due date is always after the statement date, within ~a month', () => {
    for (let s = 1; s <= 31; s++) for (let d = 1; d <= 31; d++) {
      const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: s, dueDay: d }] };
      for (const t of [D(2026, 1, 15), D(2026, 2, 27), D(2028, 2, 29), D(2026, 12, 31)]) {
        const { end } = ctx.getCardCycleRange(t, s);
        const due = ctx.getCardDueDate(t, 'X', q);
        const gap = Math.round((due - end) / 86400000);
        assert.ok(gap >= 1 && gap <= 31, `S=${s} D=${d} ${ymd(t)}: gap ${gap}`);
      }
    }
  });

  test('null without details or a valid due day', () => {
    assert.equal(ctx.getCardDueDate(D(2026, 3, 10), 'Sapphiro', p), null);
    assert.equal(ctx.getCardDueDate(D(2026, 3, 10), 'Nope', p), null);
    const q = { creditCards: ['X'], cardDetails: [{ name: 'X', statementDay: 15, dueDay: 0 }] };
    assert.equal(ctx.getCardDueDate(D(2026, 3, 10), 'X', q), null);
    assert.equal(ctx.getCardDueDate(D(2026, 3, 10), 'X', null), null);
  });

  test('describeBillingCycle adds the due date only when known', () => {
    assert.equal(ctx.describeBillingCycle(D(2026, 3, 10), 'Millennia', p), 'Billing Cycle: Feb 16 - Mar 15 · Due Apr 3');
    assert.equal(ctx.describeBillingCycle(D(2026, 3, 10), 'Sapphiro', p), 'Billing Cycle: Feb 25 - Mar 25');
    assert.equal(ctx.describeBillingCycle(D(2026, 3, 10), null, p), 'Billing Cycle: Feb 25 - Mar 25');
  });

  test('ordinalDay', () => {
    const want = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 30: '30th', 31: '31st' };
    for (const [n, s] of Object.entries(want)) assert.equal(ctx.ordinalDay(Number(n)), s);
  });
});

/* ─────────────────────────────── validation ─────────────────────────────── */

describe('validatePaymentMethodInput', () => {
  const { ctx } = createApp();
  const p = cardProfile();
  const card = (o = {}) => ({ type: 'Credit card', name: 'Amazon Pay', statementDay: '12', dueDay: '1', last4: '4321', ...o });
  const v = (input, prof = p, editing = null) => plain(ctx.validatePaymentMethodInput(input, prof, editing));

  test('a complete card is valid and coerced to numbers', () => {
    const r = v(card());
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.value, { type: 'Credit card', name: 'Amazon Pay', statementDay: 12, dueDay: 1, last4: '4321' });
  });

  test('name is trimmed and inner whitespace collapsed', () => {
    assert.equal(v(card({ name: '  Amazon   Pay ' })).value.name, 'Amazon Pay');
  });

  test('last 4 is optional and keeps leading zeros', () => {
    assert.equal(v(card({ last4: '' })).ok, true);
    assert.equal(v(card({ last4: '0042' })).value.last4, '0042');
  });

  test('card name rules', () => {
    assert.match(v(card({ name: '' })).errors.name, /card name/i);
    assert.match(v(card({ name: '   ' })).errors.name, /card name/i);
    assert.match(v(card({ name: 'x'.repeat(41) })).errors.name, /40/);
    assert.equal(v(card({ name: 'x'.repeat(40) })).ok, true);
    assert.match(v(card({ name: 'CC - Foo' })).errors.name, /CC -/);
    assert.match(v(card({ name: 'cc-foo' })).errors.name, /CC -/);
    assert.match(v(card({ name: 'Credit Card' })).errors.name, /own name/);
    for (const bad of ['<b>x</b>', 'A"B', 'a`b', 'a\\b', 'x>y']) assert.match(v(card({ name: bad })).errors.name || '', /Avoid/, bad);
    for (const ok of ["Dad's card", 'HDFC (Regalia)', 'Axis & Co', 'Kotak 811', 'Amex Platinum—Travel'])
      assert.equal(v(card({ name: ok, last4: '' })).ok, true, ok);
    assert.match(v(card({ name: 'millennia' })).errors.name, /already have a card/);
  });

  test('legacy profile (no creditCards field) still blocks the implicit card names', () => {
    assert.match(v(card({ name: 'Sapphiro' }), { paymentMethods: ['Credit card'] }).errors.name, /already have a card/);
  });

  test('statement and due dates are required whole days 1–31', () => {
    for (const bad of ['', '0', '32', '-3', '15.5', 'abc', undefined, null]) {
      const r = v(card({ statementDay: bad, dueDay: bad }));
      assert.equal(r.ok, false, `value ${bad}`);
      assert.ok(r.errors.statementDay && r.errors.dueDay, `value ${bad}`);
    }
    for (const ok of ['1', '31', 7, ' 9 ']) assert.equal(v(card({ statementDay: ok, dueDay: ok })).ok, true, `value ${ok}`);
  });

  test('last 4 must be exactly four digits', () => {
    for (const bad of ['123', '12345', '12a4', '12 4', '١٢٣٤']) {
      assert.match(v(card({ last4: bad })).errors.last4 || '', /4 digits/, `value ${bad}`);
    }
  });

  test('last 4 can’t repeat another card’s digits', () => {
    assert.match(v(card({ last4: '1234' })).errors.last4, /Millennia already ends in 1234/);
  });

  test('editing a card skips the self-duplicate checks', () => {
    const r = v(card({ name: 'Millennia', last4: '1234' }), p, 'Millennia');
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    // …but still flags another card's digits
    assert.match(v(card({ name: 'Millennia', last4: '9876' }), p, 'Millennia').errors.last4, /Neucard/);
  });

  test('reports every bad field at once', () => {
    const r = v({ type: 'Credit card', name: '', statementDay: '', dueDay: '', last4: '12' });
    assert.deepEqual(Object.keys(r.errors).sort(), ['dueDay', 'last4', 'name', 'statementDay']);
  });

  test('non-card methods: name rules only, card fields ignored', () => {
    const r = v({ type: 'UPI', name: 'PhonePe UPI', statementDay: 'zz', last4: 'abc' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { type: 'UPI', name: 'PhonePe UPI' });
    assert.match(v({ type: 'UPI', name: 'gpay upi' }).errors.name, /already exists/);
    assert.match(v({ type: 'Other', name: 'credit card' }).errors.name, /type to add a card/);
    assert.match(v({ type: 'Cash', name: '' }).errors.name, /Enter a name/);
  });

  test('unknown type is treated as Other', () => {
    assert.equal(v({ type: 'Crypto', name: 'BTC' }).value.type, 'Other');
    assert.equal(v({ name: 'BTC' }).value.type, 'Other');
  });

  test('works with no profile at all', () => {
    assert.equal(v(card(), null).ok, true);
  });
});

/* ─────────────────────────────── profile patches ─────────────────────────────── */

describe('buildPaymentMethodPatch', () => {
  const { ctx } = createApp();
  const cardVal = { type: 'Credit card', name: 'Amazon Pay', statementDay: 12, dueDay: 1, last4: '4321' };

  test('adding a card appends name + details, keeps one "Credit card" option', () => {
    const p = frozen(cardProfile());
    const before = JSON.stringify(p);
    const patch = plain(ctx.buildPaymentMethodPatch(p, cardVal));
    assert.deepEqual(Object.keys(patch).sort(), ['cardDetails', 'creditCards', 'paymentMethods']);
    assert.deepEqual(patch.creditCards, ['Sapphiro', 'Neucard', 'Millennia', 'Amazon Pay']);
    assert.deepEqual(patch.paymentMethods, ['GPay UPI', 'Credit card', 'Cash']);
    assert.deepEqual(patch.cardDetails.at(-1), { name: 'Amazon Pay', statementDay: 12, dueDay: 1, last4: '4321' });
    assert.equal(patch.cardDetails.length, 3);
    assert.equal(JSON.stringify(p), before, 'input profile must not change');
  });

  test('adding the first card also adds the "Credit card" option', () => {
    const patch = plain(ctx.buildPaymentMethodPatch({ paymentMethods: ['Cash'], creditCards: [] }, cardVal));
    assert.deepEqual(patch.paymentMethods, ['Cash', 'Credit card']);
    assert.deepEqual(patch.creditCards, ['Amazon Pay']);
  });

  test('"credit card" in any casing counts as present', () => {
    const patch = plain(ctx.buildPaymentMethodPatch({ paymentMethods: ['credit card'], creditCards: [] }, cardVal));
    assert.deepEqual(patch.paymentMethods, ['credit card']);
  });

  test('legacy profile without creditCards materialises the implicit cards', () => {
    const patch = plain(ctx.buildPaymentMethodPatch({ paymentMethods: ['Credit card', 'Cash'] }, cardVal));
    assert.deepEqual(patch.creditCards, ['Sapphiro', 'Neucard', 'Amazon Pay']);
  });

  test('missing last4 is stored as an empty string', () => {
    const patch = plain(ctx.buildPaymentMethodPatch({ paymentMethods: [] }, { ...cardVal, last4: '' }));
    assert.equal(patch.cardDetails[0].last4, '');
  });

  test('editing replaces the details in place of duplicating, keeping the stored casing', () => {
    const p = frozen(cardProfile());
    const patch = plain(ctx.buildPaymentMethodPatch(p,
      { type: 'Credit card', name: 'millennia', statementDay: 18, dueDay: 6, last4: '1111' }, 'millennia'));
    assert.deepEqual(patch.creditCards, ['Sapphiro', 'Neucard', 'Millennia']);
    const mil = patch.cardDetails.filter(c => c.name.toLowerCase() === 'millennia');
    assert.deepEqual(mil, [{ name: 'Millennia', statementDay: 18, dueDay: 6, last4: '1111' }]);
  });

  test('editing a legacy card with no details adds them', () => {
    const patch = plain(ctx.buildPaymentMethodPatch(cardProfile(),
      { type: 'Credit card', name: 'Sapphiro', statementDay: 25, dueDay: 12, last4: '' }, 'Sapphiro'));
    assert.deepEqual(patch.creditCards, ['Sapphiro', 'Neucard', 'Millennia']);
    assert.deepEqual(patch.cardDetails.find(c => c.name === 'Sapphiro'), { name: 'Sapphiro', statementDay: 25, dueDay: 12, last4: '' });
  });

  test('adding a non-card method appends it and leaves cards alone', () => {
    const p = frozen(cardProfile());
    const patch = plain(ctx.buildPaymentMethodPatch(p, { type: 'UPI', name: 'PhonePe UPI' }));
    assert.deepEqual(patch.paymentMethods, ['GPay UPI', 'Credit card', 'Cash', 'PhonePe UPI']);
    assert.deepEqual(patch.creditCards, p.creditCards);
    assert.deepEqual(patch.cardDetails, plain(p.cardDetails));
  });

  test('profile without paymentMethods starts from the defaults', () => {
    const { ctx: c } = createApp();
    const patch = plain(c.buildPaymentMethodPatch({}, { type: 'UPI', name: 'PhonePe UPI' }));
    assert.equal(patch.paymentMethods.at(-1), 'PhonePe UPI');
    assert.ok(patch.paymentMethods.includes('Cash'));
  });
});

describe('buildRemovePaymentPatch', () => {
  const { ctx } = createApp();

  test('removing a card drops its name and details only', () => {
    const p = frozen(cardProfile());
    const patch = plain(ctx.buildRemovePaymentPatch(p, 'card', 'millennia'));
    assert.deepEqual(patch.creditCards, ['Sapphiro', 'Neucard']);
    assert.deepEqual(patch.cardDetails.map(c => c.name), ['Neucard']);
    assert.deepEqual(patch.paymentMethods, ['GPay UPI', 'Credit card', 'Cash']);
  });

  test('removing the last card removes the "Credit card" option', () => {
    const p = { paymentMethods: ['Credit card', 'Cash'], creditCards: ['Solo'], cardDetails: [{ name: 'Solo', statementDay: 1, dueDay: 2 }] };
    const patch = plain(ctx.buildRemovePaymentPatch(p, 'card', 'Solo'));
    assert.deepEqual(patch, { paymentMethods: ['Cash'], creditCards: [], cardDetails: [] });
  });

  test('removing a method is case-insensitive', () => {
    const patch = plain(ctx.buildRemovePaymentPatch(cardProfile(), 'method', 'gpay upi'));
    assert.deepEqual(patch.paymentMethods, ['Credit card', 'Cash']);
  });

  test('refuses to leave no payment method', () => {
    assert.match(ctx.buildRemovePaymentPatch({ paymentMethods: ['Cash'], creditCards: [] }, 'method', 'Cash').error, /at least one/);
    assert.match(ctx.buildRemovePaymentPatch({ paymentMethods: ['Credit card'], creditCards: ['Solo'] }, 'card', 'Solo').error, /at least one/);
  });

  test('removing a legacy implicit card materialises the remaining one', () => {
    const patch = plain(ctx.buildRemovePaymentPatch({ paymentMethods: ['Credit card', 'Cash'] }, 'card', 'Sapphiro'));
    assert.deepEqual(patch.creditCards, ['Neucard']);
  });
});

/* ─────────────────────────────── last-4 matching ─────────────────────────────── */

describe('findCardByLast4', () => {
  const { ctx } = createApp();
  const p = cardProfile();
  const find = t => ctx.findCardByLast4(t, p);

  test('real-world Indian bank alert formats', () => {
    const hits = [
      'INR 1,250.00 spent using ICICI Bank Card XX1234 on 20-Oct-26 on AMAZON. Avl Limit: INR 1,20,000.00',
      'Spent Rs.500 On HDFC Bank Card 1234 At SWIGGY On 2026-10-20:12:00:00',
      'Rs.500 spent on HDFC Bank Card x1234 at ZOMATO on 20-10-26',
      'Thank you for using your HDFC Bank Credit Card ending 1234 for Rs 500.00 at DMART',
      'Rs.500.00 spent on your SBI Credit Card ending with 1234 at BIGBASKET on 20/10/26',
      'Transaction of INR 500 on Kotak Credit Card ending in 1234',
      'Spent INR 500 Axis Bank Card no. XX1234 20-10-26 UBER',
      'Your card number: 1234 was used for INR 99',
      'Txn of Rs 640 on card **1234 at BLINKIT',
      'Card xxxx-xxxx-xxxx-1234 charged INR 300',
      'Card ••1234 used at Starbucks',
      'card XX 1234 debited',
    ];
    for (const t of hits) assert.equal(find(t), 'Millennia', t);
  });

  test('picks the card whose digits appear, first one in text order', () => {
    assert.equal(find('Spent Rs 200 on card XX9876'), 'Neucard');
    assert.equal(find('Card XX9876 refund; later card XX1234 spent'), 'Neucard');
    assert.equal(find('card XX5555 then card XX1234'), 'Millennia');
  });

  test('bare numbers, OTPs and longer digit runs never match', () => {
    for (const t of [
      'Spent Rs 1234 at Amazon',
      'OTP 1234 for your transaction',
      'Rs.1234 debited from A/c',
      'Card XX12345 used',
      'card 12345 used',
      'Card 4111111111111234 used',
      'spending 1234 this month',
      'pending 1234',
      '',
    ]) assert.equal(find(t), null, t);
  });

  test('unknown digits, cards without last4, or no profile → null', () => {
    assert.equal(find('Card XX0000 used'), null);
    assert.equal(ctx.findCardByLast4('Card XX1234', { cardDetails: [{ name: 'A', last4: '' }] }), null);
    assert.equal(ctx.findCardByLast4('Card XX1234', { creditCards: ['A'] }), null);
    assert.equal(ctx.findCardByLast4('Card XX1234', null), null);
    assert.equal(ctx.findCardByLast4(null, p), null);
  });

  test('is stateless across calls (global regex lastIndex is reset)', () => {
    for (let i = 0; i < 3; i++) assert.equal(find('card XX1234'), 'Millennia');
  });
});

describe('applyCardLast4Match', () => {
  const { ctx } = createApp();
  const p = cardProfile();

  test('single result: card digits override the model’s guess', () => {
    for (const pm of ['UPI', 'Credit card', 'CC - Sapphiro', undefined]) {
      const out = plain(ctx.applyCardLast4Match({ name: 'Amazon', amount: 1250, paymentMethod: pm }, 'Card XX1234', p));
      assert.equal(out.paymentMethod, 'CC - Millennia', `from ${pm}`);
      assert.equal(out.amount, 1250);
    }
  });

  test('several results: only credit-card items are re-pointed', () => {
    const out = plain(ctx.applyCardLast4Match([
      { name: 'A', paymentMethod: 'Credit card' },
      { name: 'B', paymentMethod: 'Cash' },
      { name: 'C', paymentMethod: 'CC - Neucard' },
    ], 'card XX1234', p));
    assert.deepEqual(out.map(i => i.paymentMethod), ['CC - Millennia', 'Cash', 'CC - Millennia']);
  });

  test('no match returns the same object; null passes through', () => {
    const obj = { name: 'x', paymentMethod: 'UPI' };
    assert.equal(ctx.applyCardLast4Match(obj, 'Rs 1234 spent', p), obj);
    assert.equal(ctx.applyCardLast4Match(null, 'card XX1234', p), null);
  });

  test('does not mutate the parsed result', () => {
    const obj = frozen({ name: 'x', paymentMethod: 'UPI' });
    ctx.applyCardLast4Match(obj, 'card XX1234', p);
    assert.equal(obj.paymentMethod, 'UPI');
  });
});

describe('LLM parse integration', () => {
  test('system prompt lists card endings only for cards that have them', () => {
    const app = createApp();
    app.t.setUserProfile(cardProfile());
    const sys = app.ctx.buildParseSystemInstruction();
    assert.match(sys, /Card numbers: Millennia ends in 1234; Neucard ends in 9876\./);
    assert.doesNotMatch(sys, /Sapphiro ends in/);
  });

  test('no card-number line when no card has last 4 digits', () => {
    const app = createApp();
    app.t.setUserProfile({ ...cardProfile(), cardDetails: [] });
    assert.doesNotMatch(app.ctx.buildParseSystemInstruction(), /Card numbers:/);
  });

  test('details of a removed card are not leaked into the prompt', () => {
    const app = createApp();
    app.t.setUserProfile({ ...cardProfile(), creditCards: ['Sapphiro'] });
    assert.doesNotMatch(app.ctx.buildParseSystemInstruction(), /Card numbers:/);
  });

  test('callGeminiParseText applies the last-4 override to the model output', async () => {
    const app = createApp();
    app.t.setUserProfile(cardProfile());
    app.t.setExpenses([]);
    let seenSystem = '';
    app.ctx.callExpenseLLM = async (prompt, system) => { seenSystem = system; return { name: 'Amazon', amount: 1250, paymentMethod: 'Credit card' }; };
    const out = plain(await app.ctx.callGeminiParseText('INR 1,250.00 spent using ICICI Bank Card XX9876 on AMAZON'));
    assert.equal(out.paymentMethod, 'CC - Neucard');
    assert.match(seenSystem, /Neucard ends in 9876/);
  });
});

/* ─────────────────────────────── profile sheet controller ─────────────────────────────── */

function profileApp(profile = cardProfile()) {
  const app = createApp();
  app.t.setUserProfile(JSON.parse(JSON.stringify(profile)));
  app.t.setCurrentUser({ uid: 'u1', displayName: 'Navajit', email: 'n@example.com', photoURL: 'https://x/p.png' });
  const writes = [];
  app.persistResult = () => Promise.resolve();
  app.ctx.persistProfileUpdate = patch => { writes.push(plain(patch)); return app.persistResult(); };
  app.writes = writes;
  app.el = app.getById;
  app.fill = (o) => {
    app.ctx.openPaymentMethodForm();
    for (const [k, v] of Object.entries(o)) app.el({ type: 'pmType', name: 'pmName', statementDay: 'pmStatementDay', dueDay: 'pmDueDay', last4: 'pmLast4' }[k]).value = v;
  };
  return app;
}

describe('profile sheet: open / close / render', () => {
  test('opening shows the sheet, locks scroll and renders identity + methods', () => {
    const app = profileApp();
    app.ctx.openProfileSheet();
    assert.ok(app.el('profileSheet').classList.contains('show'));
    assert.equal(app.ctx.document.body.style.overflow, 'hidden');
    assert.equal(app.el('profileName').textContent, 'Navajit');
    assert.equal(app.el('profileEmail').textContent, 'n@example.com');
    assert.equal(app.el('profileAvatar').src, 'https://x/p.png');
    const html = app.el('profilePaymentList').innerHTML;
    for (const s of ['Sapphiro', 'Neucard', 'Millennia', 'GPay UPI', 'Cash', '•• 1234', 'Statement 15th', 'Due 3rd', 'Add statement &amp; due dates'])
      assert.ok(html.includes(s), `missing ${s}`);
    assert.ok(!/data-method="Credit card"/.test(html), 'generic "Credit card" is not a removable row');
    assert.equal(app.el('pmForm').style.display, 'none', 'form starts closed');
  });

  test('closing restores scroll; closing when not open leaves scroll alone', () => {
    const app = profileApp();
    app.ctx.openProfileSheet();
    app.ctx.closeProfileSheet();
    assert.ok(!app.el('profileSheet').classList.contains('show'));
    assert.equal(app.ctx.document.body.style.overflow, '');
    app.ctx.document.body.style.overflow = 'hidden'; // e.g. expense sheet open
    app.ctx.closeProfileSheet();
    assert.equal(app.ctx.document.body.style.overflow, 'hidden');
  });

  test('backdrop click closes, click inside the panel does not', () => {
    const app = profileApp();
    app.ctx.openProfileSheet();
    app.ctx.handleProfileSheetClick({ target: app.el('somethingInside') });
    assert.ok(app.el('profileSheet').classList.contains('show'));
    app.ctx.handleProfileSheetClick({ target: app.el('profileSheet') });
    assert.ok(!app.el('profileSheet').classList.contains('show'));
  });

  test('before onboarding (no profile) only identity + sign out are shown', () => {
    const app = profileApp();
    app.t.setUserProfile(null);
    app.ctx.openProfileSheet();
    assert.equal(app.el('profilePaymentSection').style.display, 'none');
  });

  test('names are HTML-escaped in the list', () => {
    const app = profileApp({ paymentMethods: ['<img src=x onerror=alert(1)>'], creditCards: [] });
    app.ctx.renderProfileSheet();
    const html = app.el('profilePaymentList').innerHTML;
    assert.ok(!html.includes('<img src=x'), html);
    assert.ok(html.includes('&lt;img'));
    app.ctx.applyUserProfile();
    assert.ok(!app.el('expPayment').innerHTML.includes('<img'), app.el('expPayment').innerHTML);
    assert.ok(!app.el('editExpPayment').innerHTML.includes('<img'));
  });

  test('attribute values escape double quotes', () => {
    const app = profileApp({ paymentMethods: ['Credit card'], creditCards: ['A"B'] });
    app.ctx.applyUserProfile();
    app.ctx.renderProfileSheet();
    assert.ok(app.el('cardPickerRadios').innerHTML.includes('value="A&quot;B"'));
    assert.ok(app.el('editExpPayment').innerHTML.includes('value="CC - A&quot;B"'));
    assert.ok(app.el('profilePaymentList').innerHTML.includes('data-card="A&quot;B"'));
  });

  test('empty states', () => {
    const app = profileApp({ paymentMethods: ['Credit card'], creditCards: [] });
    app.ctx.renderProfileSheet();
    const html = app.el('profilePaymentList').innerHTML;
    assert.ok(html.includes('No credit cards yet'));
    assert.ok(html.includes('None'));
  });
});

describe('profile sheet: add / edit / remove', () => {
  test('form opens in add mode with card fields visible', () => {
    const app = profileApp();
    app.ctx.openPaymentMethodForm();
    assert.equal(app.el('pmForm').style.display, 'block');
    assert.equal(app.el('profileAddPmBtn').style.display, 'none');
    assert.equal(app.el('pmType').value, 'Credit card');
    assert.equal(app.el('pmType').disabled, false);
    assert.equal(app.el('pmName').readOnly, false);
    assert.equal(app.el('pmCardFields').style.display, '');
    assert.match(app.el('pmStatementDay').innerHTML, /<option value="31">31st<\/option>/);
    app.el('pmType').value = 'UPI';
    app.ctx.updatePmFormType();
    assert.equal(app.el('pmCardFields').style.display, 'none');
    assert.equal(app.el('pmNameLabel').textContent, 'Name');
  });

  test('invalid form: inline errors, nothing written, profile untouched', async () => {
    const app = profileApp();
    const before = JSON.stringify(app.t.getUserProfile());
    app.fill({ name: '', statementDay: '', dueDay: '', last4: '12' });
    assert.equal(await app.ctx.saveProfilePaymentMethod(), false);
    assert.equal(app.writes.length, 0);
    assert.equal(JSON.stringify(app.t.getUserProfile()), before);
    assert.match(app.el('pmErr-name').textContent, /card name/);
    assert.match(app.el('pmErr-statementDay').textContent, /statement/);
    assert.match(app.el('pmErr-dueDay').textContent, /due/);
    assert.match(app.el('pmErr-last4').textContent, /4 digits/);
    assert.ok(app.el('pmName').classList.contains('invalid'));
    assert.equal(app.el('pmForm').style.display, 'block', 'form stays open');
  });

  test('errors clear once corrected', async () => {
    const app = profileApp();
    app.fill({ name: '' });
    await app.ctx.saveProfilePaymentMethod();
    app.el('pmName').value = 'Amazon Pay';
    app.el('pmStatementDay').value = '12';
    app.el('pmDueDay').value = '1';
    app.el('pmLast4').value = '';
    assert.equal(await app.ctx.saveProfilePaymentMethod(), true);
    assert.equal(app.el('pmErr-name').textContent, '');
    assert.ok(!app.el('pmName').classList.contains('invalid'));
  });

  test('adding a card updates profile, writes only payment fields, refreshes UI', async () => {
    const app = profileApp();
    app.ctx.openProfileSheet();
    app.fill({ name: 'Amazon Pay', statementDay: '12', dueDay: '1', last4: '4321' });
    const pending = app.ctx.saveProfilePaymentMethod();
    // Optimistic: state + UI already updated before the write settles.
    assert.ok(app.t.getUserProfile().creditCards.includes('Amazon Pay'));
    assert.equal(app.el('pmForm').style.display, 'none');
    assert.ok(app.el('profilePaymentList').innerHTML.includes('Amazon Pay'));
    assert.ok(app.el('cardPickerRadios').innerHTML.includes('value="Amazon Pay"'));
    assert.ok(app.el('editExpPayment').innerHTML.includes('CC - Amazon Pay'));
    assert.match(app.el('toast').textContent, /Amazon Pay added/);
    assert.equal(await pending, true);
    assert.equal(app.writes.length, 1);
    assert.deepEqual(Object.keys(app.writes[0]).sort(), ['cardDetails', 'creditCards', 'paymentMethods']);
    assert.deepEqual(app.writes[0].cardDetails.at(-1), { name: 'Amazon Pay', statementDay: 12, dueDay: 1, last4: '4321' });
    assert.equal(app.ctx.getBillingCycle(D(2026, 3, 10), 'Amazon Pay'), 'Feb 13 - Mar 12');
  });

  test('adding a non-card method adds it to the payment dropdown', async () => {
    const app = profileApp();
    app.fill({ type: 'UPI', name: 'PhonePe UPI' });
    assert.equal(await app.ctx.saveProfilePaymentMethod(), true);
    assert.deepEqual(app.writes[0].paymentMethods, ['GPay UPI', 'Credit card', 'Cash', 'PhonePe UPI']);
    assert.ok(app.el('expPayment').innerHTML.includes('<option value="PhonePe UPI">'));
  });

  test('failed write rolls everything back and reports the error', async () => {
    const app = profileApp();
    const before = JSON.stringify(app.t.getUserProfile());
    app.persistResult = () => Promise.reject(new Error('permission-denied'));
    app.fill({ name: 'Amazon Pay', statementDay: '12', dueDay: '1' });
    assert.equal(await app.ctx.saveProfilePaymentMethod(), false);
    assert.equal(JSON.stringify(app.t.getUserProfile()), before);
    assert.ok(!app.el('cardPickerRadios').innerHTML.includes('Amazon Pay'));
    assert.match(app.el('toast').textContent, /Couldn’t save: permission-denied/);
  });

  test('rollback restores missing legacy fields (no creditCards / cardDetails)', async () => {
    const app = profileApp({ paymentMethods: ['Credit card', 'Cash'] });
    app.persistResult = () => Promise.reject(new Error('offline?'));
    app.fill({ name: 'Amazon Pay', statementDay: '12', dueDay: '1' });
    await app.ctx.saveProfilePaymentMethod();
    const prof = app.t.getUserProfile();
    assert.equal(prof.creditCards, undefined);
    assert.equal(prof.cardDetails, undefined);
    assert.deepEqual(plain(app.ctx.getCardNames()), ['Sapphiro', 'Neucard']);
  });

  test('a synchronous throw from the write is handled like a rejection', async () => {
    const app = profileApp();
    app.ctx.persistProfileUpdate = () => { throw new Error('boom'); };
    app.fill({ type: 'UPI', name: 'PhonePe UPI' });
    assert.equal(await app.ctx.saveProfilePaymentMethod(), false);
    assert.ok(!app.t.getUserProfile().paymentMethods.includes('PhonePe UPI'));
  });

  test('editing a card: name + type locked, fields prefilled, details replaced', async () => {
    const app = profileApp();
    app.ctx.editProfileCard(2); // Millennia
    assert.equal(app.t.getPmEditingCard(), 'Millennia');
    assert.equal(app.el('pmName').value, 'Millennia');
    assert.equal(app.el('pmName').readOnly, true);
    assert.equal(app.el('pmType').disabled, true);
    assert.equal(app.el('pmStatementDay').value, '15');
    assert.equal(app.el('pmDueDay').value, '3');
    assert.equal(app.el('pmLast4').value, '1234');
    assert.equal(app.el('pmFormTitle').textContent, 'Edit Millennia');
    app.el('pmStatementDay').value = '18';
    assert.equal(await app.ctx.saveProfilePaymentMethod(), true);
    const det = app.t.getUserProfile().cardDetails.filter(c => c.name === 'Millennia');
    assert.equal(det.length, 1);
    assert.equal(det[0].statementDay, 18);
    assert.deepEqual(plain(app.t.getUserProfile().creditCards), ['Sapphiro', 'Neucard', 'Millennia']);
    assert.match(app.el('toast').textContent, /Millennia updated/);
    assert.equal(app.t.getPmEditingCard(), null);
  });

  test('editing a legacy card with no details starts with empty days', () => {
    const app = profileApp();
    app.ctx.editProfileCard(0); // Sapphiro
    assert.equal(app.el('pmStatementDay').value, '');
    assert.equal(app.el('pmDueDay').value, '');
    assert.equal(app.el('pmLast4').value, '');
  });

  test('opening "add" after "edit" resets edit mode and unlocks fields', () => {
    const app = profileApp();
    app.ctx.editProfileCard(2);
    app.ctx.openPaymentMethodForm();
    assert.equal(app.t.getPmEditingCard(), null);
    assert.equal(app.el('pmName').value, '');
    assert.equal(app.el('pmName').readOnly, false);
    assert.equal(app.el('pmType').disabled, false);
  });

  test('editProfileCard ignores an out-of-range index', () => {
    const app = profileApp();
    app.ctx.editProfileCard(99);
    assert.equal(app.t.getPmEditingCard(), null);
  });

  test('remove: cancelled confirm changes nothing', async () => {
    const app = profileApp();
    app.ctx.confirm = () => false;
    assert.equal(await app.ctx.removeProfilePaymentMethod('card', 2), false);
    assert.equal(app.writes.length, 0);
    assert.ok(app.t.getUserProfile().creditCards.includes('Millennia'));
  });

  test('remove: confirmed removal of a card and of a method', async () => {
    const app = profileApp();
    let asked = '';
    app.ctx.confirm = msg => { asked = msg; return true; };
    assert.equal(await app.ctx.removeProfilePaymentMethod('card', 2), true);
    assert.match(asked, /Remove Millennia\?/);
    assert.deepEqual(plain(app.t.getUserProfile().creditCards), ['Sapphiro', 'Neucard']);
    assert.ok(!app.t.getUserProfile().cardDetails.some(c => c.name === 'Millennia'));
    // index 1 of the non-card list ['GPay UPI', 'Cash'] is Cash
    assert.equal(await app.ctx.removeProfilePaymentMethod('method', 1), true);
    assert.deepEqual(plain(app.t.getUserProfile().paymentMethods), ['GPay UPI', 'Credit card']);
    assert.equal(app.writes.length, 2);
  });

  test('remove: refusing to delete the only payment method', async () => {
    const app = profileApp({ paymentMethods: ['Cash'], creditCards: [] });
    assert.equal(await app.ctx.removeProfilePaymentMethod('method', 0), false);
    assert.match(app.el('toast').textContent, /at least one/);
    assert.equal(app.writes.length, 0);
  });

  test('removing the card being edited closes the form', async () => {
    const app = profileApp();
    app.ctx.editProfileCard(2);
    await app.ctx.removeProfilePaymentMethod('card', 2);
    assert.equal(app.el('pmForm').style.display, 'none');
    assert.equal(app.t.getPmEditingCard(), null);
  });

  test('save / remove are no-ops without a profile', async () => {
    const app = profileApp();
    app.t.setUserProfile(null);
    assert.equal(await app.ctx.saveProfilePaymentMethod(), false);
    assert.equal(await app.ctx.removeProfilePaymentMethod('card', 0), false);
    assert.equal(app.writes.length, 0);
  });
});

/* ─────────────────────────────── wiring into the expense form ─────────────────────────────── */

describe('expense form uses the selected card', () => {
  function withCheckedCard(app, radioName, card) {
    // The checked radio reports `card`; other selectors (e.g. the sheet
    // header) get an inert stub element, as a real page would have them.
    app.ctx.document.querySelector = sel =>
      sel.includes(`name="${radioName}"`) && sel.includes(':checked') ? { value: card }
        : sel.includes('input[name=') ? null : app.el('qs:' + sel);
  }

  test('applyUserProfile falls back to the first card when the remembered card was removed', () => {
    const app = profileApp();
    app.localStorage.setItem('lastSelectedCard', 'Gone');
    app.ctx.applyUserProfile();
    const html = app.el('cardPickerRadios').innerHTML;
    assert.match(html, /value="Sapphiro"[^>]*checked/);
    assert.doesNotMatch(html, /value="Neucard"[^>]*checked/);
  });

  test('applyUserProfile keeps the remembered card when it still exists', () => {
    const app = profileApp();
    app.localStorage.setItem('lastSelectedCard', 'Millennia');
    app.ctx.applyUserProfile();
    const html = app.el('cardPickerRadios').innerHTML;
    assert.match(html, /value="Millennia"[^>]*checked/);
    assert.doesNotMatch(html, /value="Sapphiro"[^>]*checked/);
  });

  test('card radios refresh the billing info when changed', () => {
    const app = profileApp();
    app.ctx.applyUserProfile();
    assert.match(app.el('cardPickerRadios').innerHTML, /onchange="saveLastSelectedCard\(this\.value\); updateBillingInfo\(\);"/);
    assert.match(app.el('editCardPickerRadios').innerHTML, /onchange="saveLastSelectedCard\(this\.value\); updateEditBillingInfo\(\);"/);
  });

  test('updateBillingInfo shows the selected card’s cycle and due date', () => {
    const app = profileApp();
    app.el('expPayment').value = 'Credit card';
    app.el('expDate').value = '2026-03-10';
    withCheckedCard(app, 'cardType', 'Millennia');
    app.ctx.updateBillingInfo();
    assert.equal(app.el('billingInfo').textContent, 'Billing Cycle: Feb 16 - Mar 15 · Due Apr 3');
    assert.equal(app.el('billingInfo').style.display, 'block');
    withCheckedCard(app, 'cardType', 'Sapphiro');
    app.ctx.updateBillingInfo();
    assert.equal(app.el('billingInfo').textContent, 'Billing Cycle: Feb 25 - Mar 25');
  });

  test('updateEditBillingInfo uses the edit form’s card', () => {
    const app = profileApp();
    app.el('editExpPayment').value = 'Credit card';
    app.el('editExpDate').value = '2026-12-25';
    withCheckedCard(app, 'editCardType', 'Neucard');
    app.ctx.updateEditBillingInfo();
    assert.equal(app.el('editBillingInfo').textContent, 'Billing Cycle: Dec 21 - Jan 20 · Due Feb 8');
  });

  test('billing info hidden for non-card payments', () => {
    const app = profileApp();
    app.el('expPayment').value = 'Cash';
    app.el('expDate').value = '2026-03-10';
    app.ctx.updateBillingInfo();
    assert.equal(app.el('billingInfo').style.display, 'none');
  });

  test('addExpense stores the card’s own billing cycle', async () => {
    const app = profileApp();
    app.t.setExpenses([]);
    app.el('expName').value = 'Amazon order';
    app.el('expAmount').value = '1250';
    app.el('expDate').value = '2026-03-10';
    app.el('expPayment').value = 'Credit card';
    app.el('expCategory').value = 'Shopping';
    withCheckedCard(app, 'cardType', 'Millennia');
    await app.ctx.addExpense();
    const saved = app.t.getExpenses()[0];
    assert.equal(saved.paymentMethod, 'CC - Millennia');
    assert.equal(saved.billingCycle, 'Feb 16 - Mar 15');
  });

  test('addExpense keeps the legacy cycle for a card without details, none for UPI', async () => {
    const app = profileApp();
    app.t.setExpenses([]);
    Object.assign(app.el('expName'), { value: 'Dinner' });
    app.el('expAmount').value = '800';
    app.el('expDate').value = '2026-03-10';
    app.el('expPayment').value = 'Credit card';
    withCheckedCard(app, 'cardType', 'Sapphiro');
    await app.ctx.addExpense();
    assert.equal(app.t.getExpenses()[0].billingCycle, 'Feb 25 - Mar 25');

    app.el('expName').value = 'Chai';
    app.el('expAmount').value = '20';
    app.el('expDate').value = '2026-03-10';
    app.el('expPayment').value = 'GPay UPI';
    await app.ctx.addExpense();
    assert.equal(app.t.getExpenses()[0].paymentMethod, 'GPay UPI');
    assert.equal(app.t.getExpenses()[0].billingCycle, '');
  });
});
