# Running and testing

## Run locally

With the server (logins, live sync between browsers, receipts): see `server/README.md`. `npm run dev`, then open http://127.0.0.1:8080. Run `npm test` for the server tests.

Without the server (this browser only):

```sh
cd app
python3 -m http.server 8765
# open http://localhost:8765
```

Local mode saves to localStorage key `zeroline-local-v1` (the whole `Store.data` object: `{meta, months, tx}`); UI state is in `zeroline-ui`.

To load test data: **Settings → Restore from backup**, then pick a file from `test-data/`. Or, in the browser console:
`localStorage.setItem('zeroline-local-v1', JSON.stringify(backup.data)); location.reload()`. Use the backup's `data` object, not the whole file.

The two bare-server quirks (the `[hidden]` rule and the UTF-8 charset, which the claude.ai wrapper used to supply) are now fixed in `index.html`. In regexes, still write emoji as escapes.

## Test data (`test-data/`)

| Files | What they test |
|---|---|
| `mock-budget-backup.json` + `NAB-Everyday-test.qif` | Import and reconcile; the bank balance should come out at $11,644.69. Answers are in `ANSWER-KEY.md`. |
| `mock-budget-2-backup.json` + `NAB-Everyday-test-2.qif` | Three weeks without importing, plus traps: a tip that changes an amount, a hold that vanishes, crossed same-amount matches, a sign flip, a year typo, a late bill, the wrong account, a reversal. Should reach $14,476.24; see `ANSWER-KEY-2.md` and `Test-2-bank-statement.pdf`. |
| `mock-budget-debt-backup.json` | Credit cards and loans. |
| `.generator-2.js`, `.generator-debt.py` | Regenerate the mocks. The JS one runs with `engine.js` prepended. |

Real NAB exports (CSV preferred) have these columns: Date, Amount, Account Number, (blank), Transaction Type, Transaction Details, Balance, Category, Merchant Name, Processed On. Rows are newest first. One real file is in `private-data/`.

## Checking logic without a browser

`engine.js` has no DOM, so you can load it in Node and call `Engine.computeMonth(...)` or `Engine.classifyImport(...)` directly. See `tools/rtachk.js`, which checks Ready to Assign per month against a database dump. It was written for macOS `osascript`; port it to Node with `require`/`fs`. `npm test` also runs engine tests: `server/test/import-match.test.js` (import matching) and `server/test/budget-sums.test.js` (carry-forward, overspending, Ready to Assign, splits, transfers, cards and targets).
