// Budget sums: carry-forward, overspending, Ready to Assign, splits, transfers and targets.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../app/engine.js');

// Ready to Assign treats months before today as "past", so keep test months well clear of today:
// 2020 is always past, 2099 is always this month or later.
const cats = (...ids) => Object.fromEntries(ids.map((id, i) => [id, { name: id, order: i }]));
let n = 0;
const tx = (date, amt, cat, extra) => Object.assign({ id: 't' + (++n), acct: 'bank', date, amt, cat }, extra);
const pay = (date, amt) => tx(date, amt, E.INCOME);

test('unspent money carries forward into the next months', () => {
  const state = {
    cats: cats('food'),
    tx: [pay('2099-01-02', 100000), tx('2099-01-10', -30000, 'food')],
    assigned: { '2099-01': { food: 50000 }, '2099-02': { food: 10000 } },
  };
  const jan = E.computeMonth(state, '2099-01').rows.food;
  assert.deepEqual([jan.carry, jan.assigned, jan.activity, jan.available], [0, 50000, -30000, 20000]);
  const feb = E.computeMonth(state, '2099-02').rows.food;
  assert.deepEqual([feb.carry, feb.assigned, feb.activity, feb.available], [20000, 10000, 0, 30000]);
  // a month with nothing in it still carries the lot
  const mar = E.computeMonth(state, '2099-03').rows.food;
  assert.equal(mar.carry, 30000);
  assert.equal(mar.available, 30000);
  assert.equal(mar.assignedBefore, 60000);
});

test('overspending stays in the category as a negative until it is covered', () => {
  const state = {
    cats: cats('fuel'),
    tx: [pay('2099-01-02', 100000), tx('2099-01-15', -15000, 'fuel')],
    assigned: { '2099-01': { fuel: 10000 }, '2099-02': { fuel: 8000 } },
  };
  const jan = E.computeMonth(state, '2099-01');
  assert.equal(jan.rows.fuel.available, -5000);
  assert.equal(jan.rows.fuel.status, 'over');
  assert.equal(jan.overspentThis, -5000);
  assert.equal(jan.overspentCount, 1);
  assert.equal(jan.overspentTotal, -5000);

  const feb = E.computeMonth(state, '2099-02');
  assert.equal(feb.rows.fuel.carry, -5000); // carried, not wiped
  assert.equal(feb.rows.fuel.available, 3000); // February's 80 covers the 50 first
  assert.equal(feb.overspentThis, 0);
  assert.equal(feb.overspentBefore, -5000);
  assert.equal(feb.overspentCount, 0);
});

test('overspending never moves Ready to Assign', () => {
  const base = {
    cats: cats('fuel'),
    assigned: { '2099-01': { fuel: 10000 } },
  };
  const within = E.computeMonth(Object.assign({ tx: [pay('2099-01-02', 100000), tx('2099-01-15', -5000, 'fuel')] }, base), '2099-02');
  const over = E.computeMonth(Object.assign({ tx: [pay('2099-01-02', 100000), tx('2099-01-15', -25000, 'fuel')] }, base), '2099-02');
  assert.equal(within.rta, 90000);
  assert.equal(over.rta, 90000);
  assert.equal(over.rows.fuel.available, -15000);
});

test('Ready to Assign adds up income and takes off assignments, including future months', () => {
  const state = {
    cats: cats('rent', 'food'),
    tx: [pay('2099-01-02', 300000), pay('2099-02-02', 200000), tx('2099-01-05', -150000, 'rent')],
    assigned: {
      '2099-01': { rent: 150000, food: 50000 },
      '2099-02': { rent: 150000 },
      '2099-03': { food: 40000 },
    },
  };
  const jan = E.computeMonth(state, '2099-01');
  // this month and later: January's income less everything assigned so far, future months too
  assert.equal(jan.rta, 300000 - 390000);
  assert.equal(jan.incomeThisMonth, 300000);
  assert.equal(jan.assignedFuture, 190000);
  assert.equal(jan.assignedThisMonth, 200000);
  const feb = E.computeMonth(state, '2099-02');
  assert.equal(feb.rta, 500000 - 390000);
  assert.equal(feb.incomeThisMonth, 200000);
  assert.equal(feb.assignedFuture, 40000);
  // spending doesn't touch it
  assert.equal(feb.activityThisMonth, 0);
  assert.equal(feb.totalAvailable, 50000 + 150000);
});

test('a past month shows Ready to Assign as it stood at the end of that month', () => {
  const state = {
    cats: cats('rent'),
    tx: [pay('2020-01-02', 300000), pay('2020-02-02', 200000)],
    assigned: { '2020-01': { rent: 250000 }, '2020-02': { rent: 200000 } },
  };
  assert.equal(E.computeMonth(state, '2020-01').rta, 50000); // February's assignment isn't taken off yet
  assert.equal(E.computeMonth(state, '2020-02').rta, 50000);
});

test('split transactions count each part in its own category, and income parts go to Ready to Assign', () => {
  const state = {
    cats: cats('food', 'home'),
    tx: [
      pay('2099-01-01', 100000),
      tx('2099-01-10', -12000, null, { splits: [{ cat: 'food', amt: -7000 }, { cat: 'home', amt: -5000 }] }),
      // a refund mixed with a cashback: part goes back to food, part is income
      tx('2099-01-12', 3000, null, { splits: [{ cat: 'food', amt: 1000 }, { cat: '_income', amt: 2000 }] }),
      tx('2099-01-14', -2500, null, { splits: [{ cat: 'food', amt: -1500 }, { cat: null, amt: -1000 }] }),
    ],
    assigned: { '2099-01': { food: 20000, home: 10000 } },
  };
  const m = E.computeMonth(state, '2099-01');
  assert.equal(m.rows.food.activity, -7000 + 1000 - 1500);
  assert.equal(m.rows.home.activity, -5000);
  assert.equal(m.incomeThisMonth, 102000);
  assert.equal(m.rta, 102000 - 30000);
  assert.equal(m.uncategorized, 1);
  assert.equal(m.uncategorizedAmt, -1000);
});

test('moving money between your own accounts changes no category and no Ready to Assign', () => {
  const state = {
    cats: cats('food'),
    tx: [
      pay('2099-01-01', 100000),
      tx('2099-01-05', -40000, null, { transfer: 'savings' }),
      tx('2099-01-05', 40000, null, { acct: 'savings', transfer: 'bank' }),
    ],
    assigned: { '2099-01': { food: 10000 } },
  };
  const m = E.computeMonth(state, '2099-01');
  assert.equal(m.rta, 90000);
  assert.equal(m.rows.food.available, 10000);
  assert.equal(m.uncategorized, 0); // a transfer has no category and that's fine
  assert.equal(m.activityThisMonth, 0);
});

test('credit card spending moves money to its payment category, and paying the card spends it', () => {
  const state = {
    cats: Object.assign(cats('food'), { ccpay: { name: 'Card payment', order: 9, debtFor: 'card' } }),
    debt: { card: 'ccpay' },
    tx: [
      pay('2099-01-01', 100000),
      tx('2099-01-10', -6000, 'food', { acct: 'card' }),
      tx('2099-01-11', 1000, 'food', { acct: 'card' }), // a refund
      // paying 50 off the card: the bank side and the card side
      tx('2099-01-20', -5000, null, { transfer: 'card' }),
      tx('2099-01-20', 5000, null, { acct: 'card', transfer: 'bank' }),
    ],
    assigned: { '2099-01': { food: 10000 } },
  };
  const m = E.computeMonth(state, '2099-01');
  assert.equal(m.rows.food.available, 10000 - 6000 + 1000);
  assert.equal(m.rows.ccpay.activity, 6000 - 1000 - 5000);
  assert.equal(m.rows.ccpay.available, 0);
  assert.equal(m.rta, 90000);
});

test('a debt starting balance touches no category', () => {
  const state = {
    cats: Object.assign(cats('food'), { ccpay: { name: 'Card payment', order: 9, debtFor: 'card' } }),
    debt: { card: 'ccpay' },
    tx: [tx('2099-01-01', -200000, '_start', { acct: 'card' })],
    assigned: {},
  };
  const m = E.computeMonth(state, '2099-01');
  assert.equal(m.rows.ccpay.available, 0);
  assert.equal(m.rta, 0);
  assert.equal(m.uncategorized, 0);
});

test('group totals add up their subcategories and the group pot', () => {
  const state = {
    cats: {
      bills: { name: 'Bills', order: 0 },
      util: { name: 'Utilities', parent: 'bills', order: 0 },
      power: { name: 'Power', parent: 'util', order: 0 },
      water: { name: 'Water', parent: 'util', order: 1 },
    },
    tx: [pay('2099-01-01', 100000), tx('2099-01-09', -12000, 'power')],
    assigned: { '2099-01': { util: 5000, power: 10000, water: 3000 } },
  };
  const m = E.computeMonth(state, '2099-01');
  assert.equal(m.roll.util.assigned, 18000);
  assert.equal(m.roll.util.activity, -12000);
  assert.equal(m.roll.util.available, 6000);
  assert.equal(m.roll.util.overCount, 1); // power is 20 in the red
  assert.equal(m.roll.bills.available, 6000);
  assert.equal(m.rta, 100000 - 18000);
});

// ---------- targets ----------
const r0 = (o) => Object.assign({ carry: 0, assigned: 0, activity: 0, available: 0, assignedBefore: 0 }, o);

test('refill asks only for what tops the carry back up to the amount', () => {
  const t = { type: 'refill', amount: 20000 };
  assert.deepEqual(E.targetInfo(t, r0({ carry: 5000, assigned: 10000 }), '2099-01'), { type: 'refill', need: 15000, under: 5000 });
  assert.equal(E.targetInfo(t, r0({ carry: 25000 }), '2099-01').need, 0);
});

test('weekly asks once for each time the weekday falls in the month', () => {
  // October 2026 has five Fridays, November 2026 has four
  const t = { type: 'weekly', amount: 5000, day: 5 };
  assert.equal(E.targetInfo(t, r0(), '2026-10').need, 25000);
  assert.equal(E.targetInfo(t, r0(), '2026-11').need, 20000);
});

test('a due date spreads what is left over the months until it', () => {
  const t = { type: 'due', amount: 120000, due: '2099-06-15' };
  const info = E.targetInfo(t, r0({ carry: 30000 }), '2099-01');
  assert.equal(info.monthsLeft, 6);
  assert.equal(info.need, 15000);
  // a repeating bill rolls on to its next due month once the date has passed
  const yearly = E.targetInfo({ type: 'due', amount: 120000, due: '2098-03-01', every: 12 }, r0(), '2099-04');
  assert.equal(yearly.dueMonth, '2100-03');
  assert.equal(yearly.need, 10000);
  // a one-off that's past is done
  assert.equal(E.targetInfo({ type: 'due', amount: 5000, due: '2098-03-01' }, r0(), '2099-04').done, true);
});

test('a savings goal counts spending from it as progress', () => {
  const t = { type: 'goal', amount: 100000, by: '2099-04-30' };
  const info = E.targetInfo(t, r0({ assignedBefore: 40000, assigned: 10000, available: 30000 }), '2099-01');
  assert.equal(info.need, 15000); // (1000 - 400) over four months
  assert.equal(info.under, 5000);
  assert.equal(info.funded, 50000);
  assert.equal(info.spent, 20000);
  assert.equal(info.remaining, 50000);
  assert.equal(info.pct, 0.5);
});

test('computeMonth works targets out on the carried balance', () => {
  const state = {
    cats: { phone: { name: 'Phone', order: 0, target: { type: 'refill', amount: 6000 } } },
    tx: [pay('2099-01-01', 100000), tx('2099-01-20', -4000, 'phone')],
    assigned: { '2099-01': { phone: 6000 } },
  };
  const feb = E.computeMonth(state, '2099-02');
  assert.equal(feb.rows.phone.carry, 2000);
  assert.equal(feb.rows.phone.target.need, 4000);
  assert.equal(feb.rows.phone.status, 'under');
  assert.equal(feb.underTotal, 4000);
});

test('checkTargets warns when a group target is less than its subcategories ask for', () => {
  const tree = E.buildTree({
    bills: { name: 'Bills', order: 0 },
    util: { name: 'Utilities', parent: 'bills', order: 0, target: { type: 'monthly', amount: 10000 } },
    power: { name: 'Power', parent: 'util', order: 0, target: { type: 'monthly', amount: 8000 } },
    water: { name: 'Water', parent: 'util', order: 1, target: { type: 'weekly', amount: 1000, day: 1 } },
  });
  // water's weekly 10 is about 43.34 a month, so the kids ask for 123.34
  assert.deepEqual(E.checkTargets(tree, 'power', '2099-01'), { group: 'util', groupMonthly: 10000, kidsMonthly: 8000 + 4334 });
  assert.equal(E.checkTargets(tree, 'power', '2099-01', { util: { type: 'monthly', amount: 15000 } }), null);
});
