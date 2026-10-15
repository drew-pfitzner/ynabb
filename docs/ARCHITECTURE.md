# Architecture

A single-page app in plain JavaScript (ES2020, no framework, no build step, no npm packages). The browser does all the work. The only backend need is somewhere to store a few JSON documents, plus optional file storage for receipts.

## Files (`app/`)

| File | Lines | What it does |
|---|---|---|
| `index.html` | ~1,000 | The page shell (top bar, nav, `#view`, `#sheet` side panel, `#toast`) and **all CSS**, with the light colours (dark ones are kept but switched off, under `[data-theme="dark"]`) and phone and computer layouts. It loads the scripts in order: `engine.js`, `store.js`, `ynab.js`, `app.js`, `guide.js`. Google Fonts: Bricolage Grotesque, Schibsted Grotesk, Caveat (the guide's handwritten notes) and a mono face. |
| `engine.js` | ~635 | **Pure logic, no DOM**, exported as `window.Engine`. It covers the main budget and import logic: <ul><li>month maths and money parsing;</li><li>`buildTree` for the category tree;</li><li>`computeMonth` for the whole budget for a month: carry-forward, overspending, Ready to Assign, card payment categories, targets;</li><li>`planAutoAssign`;</li><li>CSV, QIF and OFX parsing; `dateFromDesc` and `dayMonth` to read NAB's "dd/mm" from descriptions;</li><li>`classifyImport` to match bank rows to existing transactions;</li><li>`shopKey`, `isPending`, `descKey`.</li></ul>Easy to unit test. |
| `store.js` | ~250 | **The storage layer**, exported as `window.Store` (`S` in app.js). It has two backends today: `cloud` (the claude.ai artifact DB) and `local` (localStorage). It also handles optimistic writes, a per-document write queue, and undo/redo built from inverse patches. **This is the file to change for self-hosting.** |
| `ynab.js` | ~270 | Reads a YNAB export (the plan and register CSVs inside the zip) into YNABB's data shape. |
| `app.js` | ~4,300 | **All UI**: views (budget, transactions, accounts, settings), the inline editor, import wizard, reconcile and bank check, possible doubles, payees and rules sheet, menus, keyboard handling, backup and restore. One IIFE. `render()` rebuilds `#view` from state; clicks route through `data-action` to the `actions` object, and inside sheets through `data-saction` to `sheet.actions`. |
| `guide.js` | ~750 | The step-by-step setup guide and lessons overlay (`#zl-guide`). |

### Conventions in app.js

- **State:**
  - `D` is a derived snapshot rebuilt from `Store.data` on each change (`fresh()`/`snapshot()`), with `D.tx`, `D.txById`, `D.cats`, `D.accounts`, `D.tree`, `D.month`, `D.rules` and `D.debt`.
  - `UI` holds per-viewer state, remembered in localStorage `zeroline-ui`.
- **Writes:** use `putTxs(writes, removes)` for transactions (it handles which month document each lives in) and `S.write('meta', 'rules', {items: {...}})` and similar for the rest. Wrap a user action in `S.newStep()` so it undoes as one step.
- **Helpers:**
  - HTML: `esc()` for every value put into HTML; `$`/`$$` for queries.
  - Money: `money()`, `signed()`, `plain()`.
  - Other: `dateLabel()`, `toast()`, `openSheet()`.
- **Platform calls:** `S.assets` (receipt upload and `/_blob/<id>` URLs), `S.downloads` (saving files), `S.user`/`S.me` (who added a transaction). All are optional, and the UI hides what's missing.

## Server (`server/`)

`server.js` stores each budget's documents in SQLite, applies patches with the same merge rules as `store.js`, sends live changes over Server-Sent Events, and handles logins, budgets and receipts. `public/` holds the login and account pages. See `server/README.md`.

## Data model

Money is **integer cents**; dates are `YYYY-MM-DD`; months are `YYYY-MM`. Three collections of JSON documents. A patch deep-merges into a document, and writing `null` for a map entry deletes it.

```
meta/cats       {items: {catId: {id, name, parent, order, kind, hidden, note, target, linked, debtFor}}}
                 target e.g. {type: 'monthly', amount: 10000}
meta/accounts   {items: {acctId: {id, name, type, order, closed, csvMap, reconciledAt, reconciledBalance}}}
                 type: 'checking' | 'savings' | 'credit' | 'loan' | 'tracking' | ...
meta/rules      {items: {key: ...}}  three kinds:
                 learned:  key = descKey(bank text) -> {payee, cat, memo}
                 my rule:  'r:<id>' -> {kind:'rule', texts:[{match:'contains'|'starts'|'is'|'not', text}], all,
                           dir:'in'|'out', amtIs|amtMin|amtMax, acct, days:[23], payee, cat, memo,
                           alt:[{payee,cat,memo},...] (take turns), byPayee, order}
                 payee:    'p:<id>' -> {kind:'payee', name, cat, hidden}
meta/settings   {currency: 'AUD', ...}
meta/bankbal    {items: {acctId: {'YYYY-MM-DD': balanceCents}}}       from imported bank files
meta/bankrows   {items: {acctId: {rows: ['date|amt|desc30', ...]}}}  compact copy of bank lines
meta/imports    {items: {...}}                                       import history, for undoing an import
months/YYYY-MM  {assigned: {catId: cents}, moves: {moveId: {amt, from, to, note, by, ts}}}
tx/YYYY-MM      {t: {txId: tx}}    transactions stored in the month of their date
```

Transaction fields (`TX_KEYS` in app.js):

| Group | Fields |
|---|---|
| Identity | `id`, `acct` |
| Money | `date`, `payee`, `cat`, `amt` (negative means spending) |
| Text | `bank` (bank description), `memo` (note) |
| Receipt | `receipt` (asset id), `receiptType` |
| Status | `cleared` (`'u'`, `'c'` or `'r'` for reconciled), `approved` (`false` means waiting for review) |
| Import | `ik` (import key, for spotting duplicates), `iks`, `posted`, `imp`, `impd`, `match` (pending match or update awaiting approval), `bal` (the bank balance after this line) |
| Links | `transfer` (other account id), `pair` (the other side's tx id), `splits` (`[{cat, amt, memo}]`), `notWith` (ids marked "not a double") |
| Audit | `by`, `ts` |

Special category ids are `'_income'` (Ready to Assign) and `'_start'` (a debt's starting balance). A credit card or loan account gets a payment category (`cat.debtFor = acctId`).

YNAB-imported transactions keep the bank text in the note after a 🔹 marker. `bankText(t)` reads either form.

## Backup format

`{app: 'zero-line', version: 1, exportedAt, data: {meta: {...}, months: {...}, tx: {...}}}`. This is exactly `Store.data`, so a backup is a full copy of the database except receipt files. Restore replaces each document.
