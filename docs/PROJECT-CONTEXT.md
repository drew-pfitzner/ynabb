# Project context

## Why it exists

The owner's family (six people) budgeted in YNAB. YNABB replaces it with an app they control. It does the same zero-based budgeting, with much smarter bank import and reconciling. The big pain it solves: YNAB's balance had drifted about $1,000 from the bank because of hand-entered transactions that later doubled up with the bank's lines. Finding them by hand took hours.

**North star:** import the NAB file, click a couple of buttons, and have a reliably reconciled budget.

## Where it runs today (claude.ai artifacts)

| Copy | Link | Purpose |
|---|---|---|
| YABB (real) | https://claude.ai/artifact/9o6ZkRQdEjUaGrk7sqza35 | The family's real, reconciled budget. |
| YABB Test | https://claude.ai/artifact/EcWcw7m2K9Kgm4ZcmqHfNp | Mock data for testing changes. |
| YABB Fresh | https://claude.ai/artifact/LqHnaSYMpp6KK48yLY6b3t | Empty budget for trying the setup guide. |
| YABB Redo | https://claude.ai/artifact/Nn5xmVJ5qMgu6EiU12LKGs | Empty copy made on 4 Oct 2026 to re-import YNAB and redo the reconcile without touching the real one. |

These claude.ai copies still carry the old YABB titles. All four run the same code (the files in `app/`); only the `<title>` differs. Each has its own database. They can only be updated from a Claude Code session using the Artifact tool, which is one reason to self-host.

## What the app does (as of 4 Oct 2026)

**Budget page**
- Ready to Assign banner; monthly categories with Assigned, Spent and Available; nested groups at any depth; hidden categories; Needs attention filter.
- Targets (monthly, by-date and similar) with "Fund targets" auto-assign; a needs/wants/savings split bar with goals.
- Credit cards and loans: spending on a card moves money into its payment category; debt payoff plan.
- Overspending stays red in the category, carried forward until covered (YNAB-style).
- Month switcher sits under the logo. Click any **Spent** amount to jump to the transactions behind it (a card's payment line shows the card's transactions).
- Past months show Ready to Assign as it stood at the end of that month. This was fixed on 4 Oct; it used to subtract later months' assignments.

**Transactions page**
- Inline editing: payee, category, note, date in dd/mm/yy with a calendar button, amount, splits, transfers and receipts.
- Search, filters and sorting. "All accounts" leaves out tracking accounts.
- Selecting rows:
  - Click selects; shift-click selects a range; ⌘/Ctrl-click adds or removes single rows; ⌘A or **Select all N** selects everything shown.
  - A bar acts on the selection: Approve all, set payee, set category, replace or add to notes, delete (with confirm), and merge two into one.
- Right-click menu: approve, unmatch, show possible doubles, manage payee, make a rule from this, and more.
- Keyboard: arrows move, Enter edits, A approves, U unmatches, Delete twice deletes, Esc clears, ⌘Z/⌘⇧Z undo and redo.

**Bank import (NAB CSV preferred; also OFX, QFX and QIF)**
- Reads columns automatically and skips the column screen when the file reads cleanly. Uses the purchase date written in NAB's description ("V1234 23/09 …").
- Classifies each row as new, already imported, matches a hand entry, updates a pending "POS" line that has now cleared, or is before the starting balance.
- Imported rows wait in **Needs review** until approved.
- Saves the bank's running balance per transaction (`bal`) and per day (`meta/bankbal`), plus a compact copy of the bank rows (`meta/bankrows`).

**Reconcile and the bank check**
- Reconcile an account against the bank balance (prefilled from the file).
- **Check against the bank:** finds the last day YNABB and the bank agreed, then lists each difference after that: missing lines, extra lines, amounts that differ.
- Fixes: **Fix all** (keeps the bank's copy and carries over hand-entered notes, category and receipt), **Add to YNABB**, and **Lock it in**.
- **Possible doubles:** pair cards with **Merge into one** or **Not a double**. Uses bank-text dates with ±1 day tolerance.

**Payees and rules**
- Payees: rename, merge look-alikes, delete (click, shift-click, Delete key), and a **Matches** box that links bank descriptions to a payee.
- Rules fill in payee, category and note when transactions arrive. A rule can have:
  - several descriptions, matched by any one or all of them, including **does not contain**;
  - Only-if conditions: spending or income, amount (exactly or between), account, and **day of the month** (taken from the description's date);
  - **take turns** fill-ins: alternating between, say, two people's identical "splurge money" transfers or phone bills, in bank-balance order.
- The most specific matching rule wins. The app also learns payee and category from what you categorise.

**Other**
- YNAB import from YNAB's export zip, including history, assignments and "moves".
- A step-by-step setup guide and lessons (`guide.js`), and a phone layout toggle.
- Backup and restore (JSON), with a safety copy kept before any restore, start fresh or YNAB move; **Put the budget back to an earlier time** (Settings, under Recent imports), rebuilt from the server's log of every change; transactions CSV export, and one light colour scheme (it no longer follows the device's dark mode, so everyone sees the same colours).

## Timeline

- **2 Oct 2026:** first build as "Zero Line": budget engine, categories, targets, transactions, import and a YNAB import.
- **3 Oct:**
  - Renamed **YABB** ("Yet Another Bloody Budget"), with a three-slice pie logo (teal, light teal, gold).
  - Real budget emptied, real YNAB data imported fresh, NAB CSVs imported.
  - Built the bank check, Fix all, possible doubles, the merge tools and the rules redesign.
  - The real everyday account was reconciled to the exact bank balance.
- **4 Oct:**
  - Bulk select and approve; rule day-of-month and "does not contain".
  - Month switcher moved; Spent drill-down; fixed the negative Ready to Assign in past months.
  - Range and ⌘ selection with bulk edits; the Redo copy; this handover.

- **5 Oct:** moved to its own server on the A6 (logins, separate budgets, backups, auto-deploy), and renamed **YNABB**: "Yikes Not Another Bloody Budget".
- **17 Oct:** a check-over of safety: edits survive a weak signal, restores happen in one go with a safety copy, put the budget back to an earlier time, safer sign-ins, backups that catch up and run before each update, and tests for the budget sums.

## Ideas parked for later

- Make the rules screen its own page instead of a side sheet, and give rules more powers.
- Self-hosting (see `SELF-HOSTING.md`): the owner's stated next goal.
