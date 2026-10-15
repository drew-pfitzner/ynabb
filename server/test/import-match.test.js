// Import matching: bank lines pair with entries typed by hand, closest first across the whole file.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../app/engine.js');

const bank = (date, amt, desc) => ({ date, amt, desc });
const typed = (id, date, amt, payee) => ({ id, acct: 'a', date, amt, payee });

test('two same-amount lines each take the entry closest to them, not the first one found', () => {
  // newest first, as NAB lists them: the 14th line used to grab the entry from the 10th, 4 days away
  const rows = [bank('2026-10-14', -460, 'V1234 14/10 DRIVER 7436'), bank('2026-10-10', -460, 'V1234 10/10 DRIVER 7436')];
  const existing = [typed('t10', '2026-10-10', -460, 'Driver')];
  const out = E.classifyImport('a', rows, existing);
  assert.equal(out[1].status, 'match');
  assert.equal(out[1].matchId, 't10');
  assert.equal(out[0].status, 'new');
});

test('an entry is matched to the closer bank line even when a farther one comes first', () => {
  const rows = [bank('2026-10-15', -24000, 'TRANSFER TO DREW'), bank('2026-10-11', -24000, 'TRANSFER TO DREW')];
  const existing = [typed('d1', '2026-10-11', -24000, 'Drew'), typed('d2', '2026-10-15', -24000, 'Drew')];
  const out = E.classifyImport('a', rows, existing);
  assert.equal(out[0].matchId, 'd2');
  assert.equal(out[1].matchId, 'd1');
});

test('lines more than 5 days from any entry still come in as new', () => {
  const out = E.classifyImport('a', [bank('2026-10-20', -460, 'DRIVER')], [typed('t', '2026-10-10', -460, 'Driver')]);
  assert.equal(out[0].status, 'new');
});

test('an overseas purchase imported while pending is updated when it clears with its foreign amount', () => {
  const pending = { id: 'p', acct: 'a', date: '2026-10-09', amt: -2965, payee: 'TradingView', ik: 'a|old|1', bank: 'POS 09/10 TRADINGVIEWA*PRODUCT WESTERVILLE', cleared: 'r' };
  const out = E.classifyImport('a', [bank('2026-10-09', -2965, 'V6913 09/10 TRADINGVIEWA*PRODUCT USD 19.99 74364816282')], [pending]);
  assert.equal(out[0].status, 'update');
  assert.equal(out[0].updateId, 'p');
});

test('a pending charge clears with different words after the shop name: same amount and date still update it', () => {
  const pending = { id: 'p', acct: 'a', date: '2026-10-09', amt: -2965, ik: 'a|old|1', bank: 'POS 09/10 TRADINGVIEWA*PRODUCT WESTERVILLE', cleared: 'r' };
  const out = E.classifyImport('a', [bank('2026-10-09', -2965, 'V6913 09/10 TRADINGVIEW.COM HTTPSTRADINGV OH 74364816282')], [pending]);
  assert.equal(out[0].status, 'update');
});

test('a different shop with the same amount and date is not taken for the pending one', () => {
  const pending = { id: 'p', acct: 'a', date: '2026-10-09', amt: -2965, ik: 'a|old|1', bank: 'POS 09/10 TRADINGVIEWA*PRODUCT WESTERVILLE' };
  const out = E.classifyImport('a', [bank('2026-10-09', -2965, 'V6913 09/10 TRADEMART SYDNEY 74364816282')], [pending]);
  assert.equal(out[0].status, 'new');
});

test("NAB's real wording: the town on the pending line, the support site on the cleared one", () => {
  const pending = { id: 'p', acct: 'a', date: '2026-10-09', amt: -2965, ik: 'a|old|1', bank: 'POS 09/10 TRADINGVIEWA*PRODUCTWESTERVILLE', cleared: 'r' };
  const out = E.classifyImport('a', [bank('2026-10-09', -2965, 'V1234 09/10 TRADINGVIEWA*PRODUCT TV.SUPPORT 74360000000')], [pending]);
  assert.equal(out[0].status, 'update');
});

test('a cleared line imported before comes back worded a little differently: skipped as already in', () => {
  const earlier = { id: 'e', acct: 'a', date: '2026-10-08', posted: '2026-10-09', amt: -460, ik: 'a|2026-10-09|-460|driver foodworks|1', bank: 'V6772 08/10 DRIVER FOODWORKS 74360000001' };
  const out = E.classifyImport('a', [bank('2026-10-10', -460, 'V6772 08/10 DRIVERFOODWORKS PTY 74360000002')], [earlier]);
  assert.equal(out[0].status, 'dupe');
});

test('two real purchases at the same shop on the same day both stay when the file has both', () => {
  const desc = 'V6772 08/10 DRIVER FOODWORKS 74360000001';
  const first = E.classifyImport('a', [bank('2026-10-09', -460, desc)], [])[0];
  const earlier = { id: 'e', acct: 'a', date: '2026-10-08', amt: -460, ik: first.ik, bank: desc };
  const out = E.classifyImport('a', [bank('2026-10-09', -460, desc), bank('2026-10-09', -460, 'V6772 08/10 DRIVER FOODWORKS 74360000009')], [earlier]);
  assert.equal(out[0].status, 'dupe');
  assert.equal(out[1].status, 'new');
});

test("NAB's real wording: the same line again without its reference number, processed on a different day", () => {
  const earlier = { id: 'e', acct: 'a', date: '2026-10-08', amt: -460, ik: 'a|2026-10-09|-460|driver foodworks griffith|1', bank: 'V1234 08/10 DRIVER FOODWORKS GRIFFITH 01500000000' };
  const out = E.classifyImport('a', [{ date: '2026-10-08', posted: '2026-10-12', amt: -460, desc: 'V1234 08/10 DRIVER FOODWORKS GRIFFITH' }], [earlier]);
  assert.equal(out[0].status, 'dupe');
});
