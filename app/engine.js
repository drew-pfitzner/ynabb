/* Zero Line budget engine: pure functions, no DOM, no storage.
   All money is integer cents. Outflows are negative. */
(function (root) {
  'use strict';

  const INCOME = '_income'; // the "Ready to Assign" category id
  const START = '_start'; // a debt's starting balance: owed before the budget began, so it doesn't touch any category

  // ---------- months & dates ----------
  const monthOf = (d) => d.slice(0, 7);
  function addMonths(m, n) {
    let [y, mo] = m.split('-').map(Number);
    mo = mo - 1 + n;
    y += Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    return y + '-' + String(mo + 1).padStart(2, '0');
  }
  function monthDiff(a, b) { // b - a in months
    const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
    return (yb - ya) * 12 + (mb - ma);
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------- money parsing ----------
  // Accepts "12.50", "$1,200", "-4", and simple math like "50+25.5-3", "600/3" or "25.00×3".
  function parseMoney(str) {
    if (typeof str === 'number') return Math.round(str * 100);
    let s = String(str || '').replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/[^0-9.+\-*/()]/g, ''); // the number pad's − × ÷ too
    if (!s) return 0;
    if (!/^[0-9.+\-*/()]+$/.test(s)) return NaN;
    try {
      const v = calc(s);
      return Number.isFinite(v) ? Math.round(v * 100) : NaN;
    } catch (e) { return NaN; }
  }
  // + - * / and brackets, worked out by hand so no text is ever run as code (lets the server forbid eval)
  function calc(s) {
    let i = 0;
    const num = () => {
      if (s[i] === '(') { i++; const v = sum(); if (s[i++] !== ')') throw new Error('bracket'); return v; }
      if (s[i] === '-') { i++; return -num(); }
      if (s[i] === '+') { i++; return num(); }
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m) throw new Error('number');
      i += m[0].length;
      return parseFloat(m[0]);
    };
    const prod = () => {
      let v = num();
      while (s[i] === '*' || s[i] === '/') { const op = s[i++], r = num(); v = op === '*' ? v * r : v / r; }
      return v;
    };
    const sum = () => {
      let v = prod();
      while (s[i] === '+' || s[i] === '-') { const op = s[i++], r = prod(); v = op === '+' ? v + r : v - r; }
      return v;
    };
    const v = sum();
    if (i !== s.length) throw new Error('extra');
    return v;
  }

  // ---------- category tree ----------
  function buildTree(cats) {
    const byId = {}, children = {}, roots = [];
    for (const id in cats) {
      const c = cats[id];
      if (c && !c.deleted) byId[id] = c;
    }
    for (const id in byId) {
      const p = byId[id].parent;
      if (p && byId[p]) (children[p] = children[p] || []).push(id);
      else roots.push(id);
    }
    const ord = (a, b) => (byId[a].order || 0) - (byId[b].order || 0) || String(byId[a].name).localeCompare(byId[b].name);
    roots.sort(ord);
    for (const k in children) children[k].sort(ord);
    const order = [], depth = {}, path = {};
    (function walk(ids, d, trail) {
      for (const id of ids) {
        order.push(id); depth[id] = d;
        path[id] = trail.concat(byId[id].name);
        if (children[id]) walk(children[id], d + 1, path[id]);
      }
    })(roots, 0, []);
    const isLeaf = (id) => !(children[id] && children[id].length);
    const leaves = order.filter(isLeaf);
    // a group below the top level holds money of its own (its "Unallocated" pot);
    // top-level groups are headings that only total things up
    const isPot = (id) => !!byId[id] && !isLeaf(id) && depth[id] >= 1;
    // where a category's money comes from: its group's pot, or Ready to Assign (null)
    // a subcategory is linked to its group unless switched off: then its money comes straight from Ready to Assign
    const source = (id) => { const c = byId[id], p = c && c.parent; return p && isPot(p) && c.linked !== false ? p : null; };
    const isLinkable = (id) => { const p = byId[id] && byId[id].parent; return !!(p && isPot(p)); };
    return { byId, children, roots, order, depth, path, isLeaf, leaves, isPot, source, isLinkable };
  }

  function descendants(tree, id) {
    const out = [];
    (function rec(i) { for (const c of tree.children[i] || []) { out.push(c); rec(c); } })(id);
    return out;
  }

  // ---------- transaction helpers ----------
  function txParts(t) {
    if (t.splits && t.splits.length) return t.splits;
    return [{ cat: t.cat, amt: t.amt }];
  }

  // ---------- targets ----------
  // how many times a weekday (0 Sunday … 6 Saturday) falls in month M
  function weekdaysIn(M, wd) {
    const [y, m] = M.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Math.floor((days - 1 - ((wd - first + 7) % 7)) / 7) + 1;
  }
  // r = {carry, assigned, activity, available, assignedBefore}
  function targetInfo(t, r, M) {
    if (!t || !t.type) return null;
    const amt = Math.max(0, t.amount | 0);
    let need = 0, info = {};
    switch (t.type) {
      case 'refill': // bill that drains and refills to a fixed amount each month
        need = Math.max(0, amt - r.carry);
        break;
      case 'monthly': // always set aside this much each month
        need = amt;
        break;
      case 'weekly': { // this much every week on one weekday, so a month with five Fridays asks for five lots
        const n = weekdaysIn(M, t.day | 0);
        need = amt * n;
        info = { weeks: n };
        break;
      }
      case 'due': { // a payment due on a date, optionally repeating every N months
        if (!t.due) return null;
        let dm = monthOf(t.due);
        const every = t.every | 0;
        if (every > 0) while (dm < M) dm = addMonths(dm, every);
        if (dm < M) return { type: t.type, need: 0, under: 0, done: true };
        const left = monthDiff(M, dm) + 1;
        need = Math.ceil(Math.max(0, amt - r.carry) / left);
        info = { dueMonth: dm, monthsLeft: left, dueDay: Number(t.due.slice(8, 10)) };
        break;
      }
      case 'goal': { // save a total; spending from it still counts as progress
        const funded = r.assignedBefore + r.assigned;
        if (t.by) {
          const dm = monthOf(t.by);
          const left = dm >= M ? monthDiff(M, dm) + 1 : 1;
          need = Math.ceil(Math.max(0, amt - r.assignedBefore) / left);
          info.monthsLeft = left;
        }
        const avail = Math.max(0, r.available);
        info.funded = funded;
        info.spent = Math.max(0, funded - avail);
        info.remaining = Math.max(0, amt - funded);
        info.pct = amt ? Math.min(1, funded / amt) : 0;
        break;
      }
      case 'cap': // add a fixed amount each month until a ceiling is reached
        need = Math.min(amt, Math.max(0, (t.cap | 0) - r.carry));
        break;
      default:
        return null;
    }
    const under = Math.max(0, need - r.assigned);
    return Object.assign({ type: t.type, need, under }, info);
  }

  // ---------- the budget for month M ----------
  /* state = {
       cats: {id: cat|null},
       tx: [tx, ...]            (live transactions only)
       assigned: {month: {catId: cents}}
     } */
  function computeMonth(state, M) {
    const tree = buildTree(state.cats || {});
    const act = {}, income = {};
    let minMonth = M, maxMonth = M, uncategorized = 0, uncategorizedAmt = 0;

    // credit cards and loans: {accountId: its payment category}
    const debt = state.debt || {};
    const addAct = (m, id, v) => { const a = act[m] = act[m] || {}; a[id] = (a[id] || 0) + v; };
    for (const t of state.tx) {
      const pay = debt[t.acct];
      const m = monthOf(t.date);
      if (t.transfer) {
        // moving money between your own accounts doesn't change the budget,
        // except paying a card or loan: that spends the money set aside in its payment category
        if (pay && !debt[t.transfer]) { if (m < minMonth) minMonth = m; addAct(m, pay, -t.amt); }
        continue;
      }
      if (m < minMonth) minMonth = m;
      let uncat = false;
      for (const p of txParts(t)) {
        if (p.cat === START) continue;
        if (!p.cat) { uncat = true; if (m <= M) uncategorizedAmt += p.amt; continue; }
        if (p.cat === INCOME) income[m] = (income[m] || 0) + p.amt;
        else addAct(m, p.cat, p.amt);
        // spending on a card moves that money from the category into the card's payment category, ready to pay it off
        if (pay) addAct(m, pay, -p.amt);
      }
      if (uncat) uncategorized++;
    }
    let totalAssigned = 0, assignedFuture = 0;
    for (const m in state.assigned) {
      const row = state.assigned[m] || {};
      for (const k in row) {
        const v = row[k] || 0;
        if (!v) continue;
        totalAssigned += v;
        if (m > M) assignedFuture += v;
        if (m < minMonth) minMonth = m;
        if (m > maxMonth) maxMonth = m;
      }
    }

    // every id that holds money, including deleted categories that still have data
    const ids = new Set(tree.order);
    for (const m in act) for (const k in act[m]) ids.add(k);
    for (const m in state.assigned) for (const k in (state.assigned[m] || {})) if (k !== INCOME) ids.add(k);

    const res = {}, prevAvail = {}, cumA = {};
    let overspentBefore = 0, overspentThis = 0;
    for (let m = minMonth; m <= maxMonth; m = addMonths(m, 1)) {
      let over = 0;
      const arow = state.assigned[m] || {}, crow = act[m] || {};
      for (const id of ids) {
        // overspending stays in the category (carried as a negative) until it's covered or topped up
        const carry = prevAvail[id] || 0;
        const a = arow[id] || 0, ac = crow[id] || 0;
        const av = carry + a + ac;
        if (m === M) res[id] = { carry, assigned: a, activity: ac, available: av, assignedBefore: cumA[id] || 0 };
        cumA[id] = (cumA[id] || 0) + a;
        prevAvail[id] = av;
        if (av < 0) over += av;
      }
      if (m < M) overspentBefore += over;
      else if (m === M) overspentThis = over;
    }
    let incomeToDate = 0, incomeThisMonth = 0;
    for (const m in income) {
      if (m <= M) incomeToDate += income[m];
      if (m === M) incomeThisMonth += income[m];
    }
    // Ready to Assign only changes when you assign money or income arrives; overspending never moves it.
    // This month and later take off money already assigned to future months; a past month shows where it stood at the end of that month
    const rta = M < monthOf(todayISO()) ? incomeToDate - (totalAssigned - assignedFuture) : incomeToDate - totalAssigned;

    // each category's own money (for a group below the top level, that's its Unallocated pot)
    const zero = { carry: 0, assigned: 0, activity: 0, available: 0, assignedBefore: 0 };
    const rows = {};
    for (const id of ids) rows[id] = Object.assign({ id, target: null }, res[id] || zero);
    for (const id of tree.leaves) rows[id].target = targetInfo(tree.byId[id].target, rows[id], M);

    // roll up: every group's totals, its target (on the totals), what it still needs, and what's in the red
    const roll = {};
    const NUM = ['carry', 'assigned', 'activity', 'available', 'assignedBefore'];
    for (let i = tree.order.length - 1; i >= 0; i--) {
      const id = tree.order[i];
      const own = rows[id];
      if (tree.isLeaf(id)) {
        own.parts = barParts(own);
        own.status = statusOf(own);
        roll[id] = Object.assign({}, own, {
          needSub: own.target ? own.target.need : 0,
          under: own.target ? own.target.under : 0,
          underCount: own.target && own.target.under > 0 ? 1 : 0,
          overCount: own.available < 0 ? 1 : 0,
        });
        continue;
      }
      own.parts = barParts(own);
      own.status = statusOf(own);
      const agg = { id };
      for (const k of NUM) agg[k] = own[k];
      let under = 0, underCount = 0, overCount = own.available < 0 ? 1 : 0, kidsNeed = 0;
      const parts = Object.assign({}, own.parts);
      for (const c of tree.children[id]) {
        const ca = roll[c];
        for (const k of NUM) agg[k] += ca[k];
        under += ca.under; underCount += ca.underCount; overCount += ca.overCount; kidsNeed += ca.needSub;
        for (const k in ca.parts) parts[k] = (parts[k] || 0) + ca.parts[k];
      }
      agg.target = tree.isPot(id) ? targetInfo(tree.byId[id].target, agg, M) : null;
      if (agg.target) {
        // a group target covers the whole group, so its subcategories' targets aren't asked for twice
        agg.parts = barParts(agg);
        agg.under = agg.target.under;
        agg.underCount = agg.target.under > 0 ? 1 : 0;
      } else {
        agg.parts = parts;
        agg.under = under;
        agg.underCount = underCount;
      }
      agg.overCount = overCount;
      // what the targets inside this group ask for this month, and whether the group's own target covers it
      agg.kidsNeed = kidsNeed;
      agg.needSub = agg.target ? agg.target.need : kidsNeed;
      agg.targetShort = agg.target ? Math.max(0, kidsNeed - agg.target.need) : 0;
      agg.status = agg.available < 0 ? 'over' : agg.under > 0 ? 'under' : agg.target ? statusOf(agg) : (agg.available > 0 ? 'pos' : 'zero');
      roll[id] = agg;
    }
    const orphans = [...ids].filter((id) => !tree.byId[id] && rows[id] && (rows[id].available || rows[id].activity || rows[id].assigned));
    for (const id of orphans) { rows[id].parts = barParts(rows[id]); rows[id].status = statusOf(rows[id]); }

    let underTotal = 0, overspentCount = 0, overspentTotal = 0;
    for (const id of tree.roots) underTotal += roll[id].under;
    for (const id of ids) {
      const r = rows[id];
      if (r.available < 0) { overspentCount++; overspentTotal += r.available; }
    }
    let totalAvailable = 0, assignedThisMonth = 0, activityThisMonth = 0;
    for (const id of ids) { totalAvailable += rows[id].available; assignedThisMonth += rows[id].assigned; activityThisMonth += rows[id].activity; }

    return {
      month: M, tree, rows, roll, orphans, rta, incomeThisMonth, assignedFuture,
      overspentThis, overspentBefore, underTotal, overspentCount, overspentTotal, uncategorized, uncategorizedAmt,
      totalAvailable, assignedThisMonth, activityThisMonth,
    };
  }

  // segments for the per-category bar: spent, available, still needed, overspent
  function barParts(r) {
    const t = r.target;
    if (t && t.type === 'goal') {
      return {
        spent: t.spent, avail: Math.max(0, r.available), need: t.remaining,
        over: r.available < 0 ? -r.available : 0,
      };
    }
    return {
      spent: Math.max(0, Math.max(0, -r.activity) - (r.available < 0 ? -r.available : 0)),
      avail: Math.max(0, r.available),
      need: t ? t.under : 0,
      over: r.available < 0 ? -r.available : 0,
    };
  }

  function statusOf(r) {
    if (r.available < 0) return 'over';
    const t = r.target;
    if (t) {
      if (t.under > 0) return 'under';
      if (t.type === 'goal' && !t.need && t.remaining > 0) return 'goal';
      return 'funded';
    }
    return r.available > 0 ? 'pos' : 'zero';
  }

  /* Fund targets. Money flows down: Ready to Assign → a group's Unallocated pot → its subcategories.
     If a pot is short, the group total is raised from where its own money comes from, by just the
     amount needed, unless the group has its own target (then subcategories share what the target gave).
     Returns {changes: {catId: newAssigned}, rtaUsed} */
  function planAutoAssign(month) {
    const { tree, rows, roll } = month;
    let rtaLeft = Math.max(0, month.rta);
    const changes = {};
    const A = (id) => (id in changes ? changes[id] : rows[id].assigned);
    const potAvail = (g) => rows[g].available + (A(g) - rows[g].assigned);
    function draw(g, amount) {
      if (amount <= 0) return 0;
      if (!g) { const p = Math.min(amount, rtaLeft); rtaLeft -= p; return p; }
      const fromPot = Math.min(amount, Math.max(0, potAvail(g)));
      const short = amount - fromPot;
      const got = short > 0 && !roll[g].target ? draw(tree.source(g), short) : 0;
      changes[g] = A(g) - fromPot; // raised money passes straight through the pot
      return fromPot + got;
    }
    function visit(id) {
      if (tree.isLeaf(id)) {
        const t = rows[id].target;
        if (t && t.under > 0) { const got = draw(tree.source(id), t.under); if (got) changes[id] = A(id) + got; }
        return;
      }
      if (tree.isPot(id)) {
        const gt = roll[id].target;
        if (gt && gt.under > 0) { const got = draw(tree.source(id), gt.under); if (got) changes[id] = A(id) + got; }
      }
      for (const c of tree.children[id]) visit(c);
    }
    for (const r of tree.roots) visit(r);
    for (const k in changes) if (changes[k] === rows[k].assigned) delete changes[k];
    return { changes, rtaUsed: Math.max(0, month.rta) - rtaLeft };
  }

  // What a target asks for in a typical month, so different kinds of target can be compared.
  function monthlyOf(t, M) {
    if (!t || !t.type) return 0;
    const amt = Math.max(0, t.amount | 0);
    switch (t.type) {
      case 'refill': case 'monthly': case 'cap': return amt;
      case 'weekly': return Math.ceil(amt * 52 / 12);
      case 'due': {
        if ((t.every | 0) > 0) return Math.ceil(amt / t.every);
        if (!t.due) return 0;
        const left = monthOf(t.due) >= M ? monthDiff(M, monthOf(t.due)) + 1 : 1;
        return Math.ceil(amt / left);
      }
      case 'goal': {
        if (!t.by) return 0;
        const left = monthOf(t.by) >= M ? monthDiff(M, monthOf(t.by)) + 1 : 1;
        return Math.ceil(amt / left);
      }
    }
    return 0;
  }
  // The monthly amount a category's targets add up to: its own target if it has one, otherwise its subcategories'.
  // overrides: {catId: target or null} to test a change before saving it.
  function subtreeMonthly(tree, id, M, overrides) {
    const t = overrides && id in overrides ? overrides[id] : (tree.byId[id] && tree.byId[id].target);
    if (t && t.type && (tree.isLeaf(id) || tree.isPot(id))) return monthlyOf(t, M);
    return (tree.children[id] || []).reduce((s, c) => s + subtreeMonthly(tree, c, M, overrides), 0);
  }
  /* Check a group target is at least what its subcategories' targets add up to, all the way up.
     Returns null if fine, or {group, groupMonthly, kidsMonthly} for the first group that would be short. */
  function checkTargets(tree, id, M, overrides) {
    let g = id;
    while (g) {
      const t = overrides && g in overrides ? overrides[g] : tree.byId[g].target;
      if (tree.isPot(g) && t && t.type) {
        const groupMonthly = monthlyOf(t, M);
        const kidsMonthly = tree.children[g].reduce((s, c) => s + subtreeMonthly(tree, c, M, overrides), 0);
        if (kidsMonthly > groupMonthly) return { group: g, groupMonthly, kidsMonthly };
      }
      g = tree.byId[g].parent;
    }
    return null;
  }

  // ---------- accounts ----------
  function accountBalances(accounts, tx) {
    const out = {};
    for (const id in accounts) if (accounts[id]) out[id] = { balance: 0, cleared: 0, uncleared: 0, unclearedCount: 0, review: 0 };
    for (const t of tx) {
      const b = out[t.acct];
      if (!b) continue;
      b.balance += t.amt;
      if (t.cleared === 'c' || t.cleared === 'r') b.cleared += t.amt;
      else { b.uncleared += t.amt; b.unclearedCount++; }
      if (t.approved === false) b.review++;
    }
    return out;
  }

  // ---------- import helpers ----------
  function descKey(desc) {
    return String(desc || '').toLowerCase()
      .replace(/\d+/g, ' ').replace(/[^a-z&' ]+/g, ' ')
      .replace(/\b(card|purchase|pos|eftpos|visa|debit|credit|aud|usd|nzd|value date|tap|pay|ref|xx+)\b/g, ' ').replace(/\b[a-z]\b/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 32);
  }

  // Split CSV text into rows of fields. Handles quotes, escaped quotes and CRLF.
  function parseCSV(text) {
    const rows = [];
    let row = [], f = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = '';
        if (row.some((x) => x.trim() !== '')) rows.push(row);
        row = [];
      } else f += ch;
    }
    row.push(f);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows;
  }

  // Parse a date string in the given format to YYYY-MM-DD, or null.
  function parseDate(s, fmt) {
    s = String(s || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return iso(m[1], m[2], m[3]);
    const mon = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})/);
    if (mon) {
      const mi = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(mon[2].toLowerCase()) / 3 + 1;
      if (mi > 0) return iso(fullYear(mon[3]), mi, mon[1]);
    }
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
      return fmt === 'mdy' ? iso(fullYear(m[3]), m[1], m[2]) : iso(fullYear(m[3]), m[2], m[1]);
    }
    return null;
  }
  const fullYear = (y) => (String(y).length === 2 ? '20' + y : String(y));
  function iso(y, m, d) {
    m = Number(m); d = Number(d);
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  // Guess day/month order from a column of date strings.
  function guessDateFormat(samples) {
    let dmy = 0, mdy = 0;
    for (const s of samples) {
      const m = String(s).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/);
      if (!m) continue;
      if (Number(m[1]) > 12) dmy++;
      if (Number(m[2]) > 12) mdy++;
    }
    if (mdy > dmy) return 'mdy';
    if (dmy > mdy) return 'dmy';
    return null; // ambiguous
  }

  function parseOFX(text) {
    const out = [];
    const blocks = String(text).split(/<STMTTRN>/i).slice(1);
    const tag = (b, name) => {
      const m = b.match(new RegExp('<' + name + '>([^<\\r\\n]*)', 'i'));
      return m ? m[1].trim() : '';
    };
    for (const b of blocks) {
      const amt = parseFloat(tag(b, 'TRNAMT'));
      const d = tag(b, 'DTPOSTED');
      if (!Number.isFinite(amt) || !d) continue;
      const name = tag(b, 'NAME'), memo = tag(b, 'MEMO');
      out.push({
        date: iso(d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)),
        amt: Math.round(amt * 100),
        desc: [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' '),
        fitid: tag(b, 'FITID'),
      });
    }
    return out;
  }

  // QIF: D date, T/U amount, P payee, M memo, ^ ends a record. Australian banks write dates day-first.
  function parseQIF(text) {
    const out = [];
    let cur = {};
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const k = line[0], v = line.slice(1).trim();
      if (k === '^') {
        if (cur.date && Number.isFinite(cur.amt)) out.push({ date: cur.date, amt: cur.amt, desc: [cur.p, cur.m && cur.m !== cur.p ? cur.m : ''].filter(Boolean).join(' ') });
        cur = {};
      } else if (k === 'D') cur.date = parseDate(v.replace(/'/g, '/'), 'dmy');
      else if (k === 'T' || k === 'U') cur.amt = Math.round(parseFloat(v.replace(/,/g, '')) * 100);
      else if (k === 'P') cur.p = v;
      else if (k === 'M') cur.m = v;
    }
    return out;
  }

  /* The date the purchase was made, read from the bank's description (e.g. "V1234 01/10 WOOLWORTHS").
     Banks often post a few days later. The year comes from the posting date. Returns null if none found. */
  function dateFromDesc(desc, posted, fmt) {
    if (!desc || !posted) return null;
    const s = String(desc);
    let cand = null;
    const full = s.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?!\d)/);
    if (full) cand = parseDate(full[1] + '/' + full[2] + '/' + full[3], fmt);
    if (!cand) {
      const m = s.match(/(?:^|[^\d\/])(\d{1,2})\/(\d{1,2})(?![\d\/])/);
      if (!m) return null;
      const d = Number(fmt === 'mdy' ? m[2] : m[1]), mo = Number(fmt === 'mdy' ? m[1] : m[2]);
      const y = Number(posted.slice(0, 4));
      cand = iso(y, mo, d);
      if (!cand) return null;
      if (Date.parse(cand) - Date.parse(posted) > 2 * 864e5) cand = iso(y - 1, mo, d); // e.g. bought 30/12, posted 2 Jan
    }
    if (!cand) return null;
    const gap = (Date.parse(posted) - Date.parse(cand)) / 864e5;
    return gap >= -2 && gap <= 45 ? cand : null; // ignore numbers that aren't really a recent date
  }

  /* Classify incoming bank rows against existing transactions in one account.
     rows: [{date, amt, desc, fitid?}]; existing: account's live tx.
     Returns rows annotated with {ik, status: 'new'|'match'|'dupe', matchId} */
  // the first "dd/mm" written in a description, as "d/m", or null
  // two "d/m" dates no more than a day apart (a pending POS line and the final card line can differ by one)
  function dmNear(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const t = (x) => { const [d, m] = x.split('/').map(Number); return Date.UTC(2000, m - 1, d); };
    const g = Math.abs(t(a) - t(b)) / 864e5;
    return g <= 1 || g >= 365; // 31/12 and 1/1
  }
  function dayMonth(text) {
    const m = String(text || '').match(/(?:^|[^\d\/])(\d{1,2})\/(\d{1,2})(?![\d\/])/);
    return m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12 ? (+m[1]) + '/' + (+m[2]) : null;
  }
  // Pending card purchases: NAB writes "POS dd/mm SHOP" until they clear.
  const isPending = (desc) => /^\s*POS\b/i.test(String(desc || ''));
  // The shop part of a bank description, keeping its numbers (pump 4471 is not pump 4472):
  // drops "POS"/"V1234", the dd/mm date, the long reference number at the end, spaces and punctuation.
  // An overseas purchase clears with its foreign amount where the pending line had the town
  // ("TRADINGVIEWA*PRODUCT USD 19.99" vs "TRADINGVIEWA*PRODUCT WESTERVILLE"), so that amount goes too.
  function shopKey(desc) {
    return String(desc || '').toLowerCase()
      .replace(/^\s*(pos|v\d{3,5})\s+/, '')
      .replace(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s+/, '')
      .replace(/\s+\d{8,}\s*$/, '')
      .replace(/\s+[a-z]{3}\s+[\d,]+\.\d{2}\s*$/, '')
      .replace(/[^a-z0-9]+/g, '');
  }
  const commonStart = (a, b) => { let n = 0; while (n < a.length && a[n] === b[n]) n++; return n; };
  function classifyImport(acctId, rows, existing) {
    const byIk = new Set();
    for (const t of existing) { if (t.ik) byIk.add(t.ik); for (const k of t.iks || []) byIk.add(k); }
    const imported = existing.filter((t) => t.ik);
    const seen = {};
    const used = new Set();
    const candidates = existing.filter((t) => !t.ik);
    const out = rows.map((r) => {
      let ik;
      if (r.fitid) ik = acctId + '|f|' + r.fitid;
      else {
        const base = acctId + '|' + (r.posted || r.date) + '|' + r.amt + '|' + descKey(r.desc);
        seen[base] = (seen[base] || 0) + 1;
        ik = base + '|' + seen[base];
      }
      if (byIk.has(ik)) return Object.assign({}, r, { ik, status: 'dupe' });
      // a purchase imported earlier while pending ("POS 01/10 SHOP   SUBURB") that has now cleared ("V1234 01/10 SHOPSUBURB 7436…")
      if (!isPending(r.desc)) {
        const shop = shopKey(r.desc);
        // same shop within 3 days; the amount can change when it clears (fuel, tips, holds), so an exact amount only wins ties
        let same = null, score = 1e9;
        if (shop.length >= 4) for (const t of imported) {
          if (used.has(t.id) || !t.bank || !isPending(t.bank)) continue;
          if (t.amt !== r.amt && ((t.amt < 0) !== (r.amt < 0) || (t.splits && t.splits.length))) continue;
          const other = shopKey(t.bank);
          // the shop names agree, or the exact amount on the same written date with the same first 6 letters
          // (an overseas or online charge can clear with different words after the name: town, currency, website)
          const sameDay = t.amt === r.amt && dmNear(dayMonth(r.desc), dayMonth(t.bank));
          if (other.length < 4 || !(other === shop || shop.startsWith(other) || other.startsWith(shop) || (sameDay && commonStart(shop, other) >= 6))) continue;
          const g = Math.abs((Date.parse(t.date) - Date.parse(r.date)) / 864e5);
          if (g > 3) continue;
          const sc = (t.amt === r.amt ? 0 : 100) + g;
          if (sc < score) { same = t; score = sc; }
        }
        // a pending line with a different amount is only used if no line in this file is the exact same purchase
        if (same && same.amt !== r.amt && rows.some((o) => o !== r && o.amt === same.amt && shopKey(o.desc) === shopKey(same.bank))) same = null;
        if (same) { used.add(same.id); return Object.assign({}, r, { ik, status: 'update', updateId: same.id, amtFrom: same.amt !== r.amt ? same.amt : undefined }); }
      }
      return Object.assign({}, r, { ik, status: 'new' });
    });
    // Match bank lines to entries typed by hand. Every possible pair is scored first, and the closest pairs are taken first
    // across the whole file: going line by line, an earlier $4.60 could take the entry that belongs to a later $4.60
    // a few days away, leaving the right line to come in as a double.
    const pairs = [];
    out.forEach((r, i) => {
      if (r.status !== 'new') return;
      const rDM = dayMonth(r.desc), rShop = shopKey(r.desc);
      for (const t of candidates) {
        if (t.amt !== r.amt) continue;
        const gap = Math.abs((Date.parse(t.date) - Date.parse(r.date)) / 864e5);
        // the entry's own note or bank text may name its date ("POS 26/06 BOOST"): a different date means a different purchase
        const told = (t.bank || '') + ' ' + (t.memo || '');
        const tDM = dayMonth(told);
        if (rDM && tDM && !dmNear(rDM, tDM)) continue;
        // the same date written in both trusts the bank text over an entry dated wrongly (5 May with "05/06" in it)
        if (gap > 5 && !(rDM && dmNear(rDM, tDM) && gap <= 62)) continue;
        let score = gap;
        if (rDM && tDM === rDM) score -= 10; // same date written in both: almost certainly the same purchase
        // the payee's name showing up in the bank description beats a closer date (Target $20 vs Kmart $20)
        const pk = String(t.payee || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (pk.length >= 3 && rShop.indexOf(pk.slice(0, 6)) >= 0) score -= 3;
        pairs.push({ i, t, score });
      }
    });
    pairs.sort((x, y) => x.score - y.score || x.i - y.i);
    const done = new Set();
    for (const p of pairs) {
      if (done.has(p.i) || used.has(p.t.id)) continue;
      done.add(p.i); used.add(p.t.id);
      out[p.i] = Object.assign({}, out[p.i], { status: 'match', matchId: p.t.id });
    }
    return out;
  }

  const api = {
    INCOME, START, monthOf, addMonths, monthDiff, todayISO, parseMoney, buildTree, descendants, txParts,
    dayMonth, dmNear, targetInfo, computeMonth, planAutoAssign, monthlyOf, subtreeMonthly, checkTargets, accountBalances, descKey, parseCSV, parseDate,
    guessDateFormat, parseOFX, parseQIF, classifyImport, dateFromDesc, shopKey, isPending,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(this);
