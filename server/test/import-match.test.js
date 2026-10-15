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
