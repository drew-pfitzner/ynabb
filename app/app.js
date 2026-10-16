/* YNABB UI */
(function () {
  'use strict';
  const E = window.Engine, S = window.Store;
  const INCOME = E.INCOME;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const poss = (n) => (/s$/i.test(n) ? n + "'" : n + "'s");

  // the Transactions page always opens on everything, unfiltered
  function daysAgo(n) {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function defaultFilters() { return NO_FILTERS(); }
  const NO_FILTERS = () => ({ acct: '', cat: '', from: '', to: '', min: '', max: '', status: '' });

  // ---------- per-viewer UI state (remembered in this browser only) ----------
  const UI = {
    view: 'budget', month: E.monthOf(E.todayISO()), collapsed: {}, editCats: false, showHidden: false,
    budgetFilter: 'all', q: '', f: defaultFilters(),
    showFilters: false, limit: 150,
    sort: { k: 'date', dir: -1 },
    only: null, // ids of a possible double-up being looked at
    rec: null, recAll: false, lastImport: null, // reconciling: {acct, bank, from}; lastImport: account last imported into
  };
  try {
    const saved = JSON.parse(localStorage.getItem('zeroline-ui') || '{}');
    if (saved.collapsed) UI.collapsed = saved.collapsed;
    if (saved.view) UI.view = saved.view;
    if (saved.rec && saved.rec.acct) UI.rec = saved.rec;
    if (saved.lastImport) UI.lastImport = saved.lastImport;
  } catch (e) { /* ignore */ }
  function saveUI() {
    try { localStorage.setItem('zeroline-ui', JSON.stringify({ collapsed: UI.collapsed, view: UI.view, rec: UI.rec, lastImport: UI.lastImport })); } catch (e) { /* ignore */ }
  }

  // ---------- layout: phone or computer (remembered per device) ----------
  function layoutPref() { try { return localStorage.getItem('zeroline-layout') || 'auto'; } catch (e) { return 'auto'; } }
  function detectedLayout() {
    const touch = window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;
    return touch && Math.min(screen.width, screen.height) < 600 ? 'phone' : 'desktop';
  }
  function applyLayout() {
    const p = layoutPref();
    document.documentElement.dataset.layout = p === 'auto' ? detectedLayout() : p;
  }
  function setLayout(p) {
    try { if (p === 'auto') localStorage.removeItem('zeroline-layout'); else localStorage.setItem('zeroline-layout', p); } catch (e) { /* ignore */ }
    applyLayout();
    render();
    window.scrollTo(0, 0);
  }
  applyLayout();
  function barPref() { try { return localStorage.getItem('zeroline-bar') || 'thick'; } catch (e) { return 'thick'; } }
  document.documentElement.dataset.bar = barPref();
  // phone transactions show one line each: the payee, or your note (remembered on this device)
  function txLine() { try { return localStorage.getItem('zeroline-txline') === 'note' ? 'note' : 'payee'; } catch (e) { return 'payee'; } }
  document.documentElement.dataset.txline = txLine();
  // the Target column and the needs/wants/savings bar start off every time the page opens; the buttons show them for now
  const SHOW = { tgt: false, pct: false };
  const tgtOn = () => SHOW.tgt, pctOn = () => SHOW.pct;
  document.documentElement.dataset.tgt = 'off';
  document.documentElement.dataset.pct = 'off';

  // ---------- formatting ----------
  let fmtCache = null;
  function fmt() {
    const cur = S.settings().currency || guessCurrency();
    if (!fmtCache || fmtCache.cur !== cur) {
      let f;
      try { f = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }); } catch (e) { f = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }); }
      fmtCache = { cur, f };
    }
    return fmtCache.f;
  }
  function guessCurrency() {
    const lang = (navigator.language || 'en-US').toUpperCase();
    const map = { AU: 'AUD', NZ: 'NZD', GB: 'GBP', CA: 'CAD', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', ZA: 'ZAR', IN: 'INR', SG: 'SGD' };
    const region = lang.split('-')[1];
    return map[region] === 'NZD' ? 'NZD' : 'AUD';
  }
  const money = (c) => fmt().format((c || 0) / 100).replace('-', '\u2212\u2060'); // minus sign that never wraps away from its number
  const signed = (c) => (c > 0 ? '+' : '') + money(c);
  const plain = (c) => ((c || 0) / 100).toFixed(2);
  // money in an edit box, with commas to read it by: 1,234.50 (parseMoney skips them)
  const commas = (s) => String(s).replace(/^(-?\d+)(\.\d*)?$/, (m, w, f) => w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f || ''));
  const box = (c) => commas(plain(c));
  function monthLabel(m, short) {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(undefined, short ? { month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' });
  }
  function dateLabel(d) {
    const [y, m, dd] = d.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    const sameYear = y === new Date().getFullYear();
    return dt.toLocaleDateString(undefined, sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));

  const ICON = {
    trash: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6M8.7 8.5v5M11.3 8.5v5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    unlink: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 9.5l-1.8 1.8a2.8 2.8 0 004 4L11 13.5M13 10.5l1.8-1.8a2.8 2.8 0 00-4-4L9 6.5M4 4l2 2M16 16l-2-2M12 3v2M3 12h2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
    tick: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    link: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5l3-3M7 9.5l-1.8 1.8a2.8 2.8 0 004 4L11 13.5M13 10.5l1.8-1.8a2.8 2.8 0 00-4-4L9 6.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
    redo: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 7a6 6 0 10.8 5M15.5 3v4h-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    left: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    up: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 12l5-5 5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    receipt: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h10v15l-2-1.3-1.7 1.3L10 16.2l-1.3 1.3L7 16.2l-2 1.3z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M7 9V6.5a3 3 0 016 0V9" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    search: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12.5 12.5l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    cross: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
    swap: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3v13M6 16l-3-3M6 16l3-3M14 17V4M14 4l-3 3M14 4l3 3" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // little pictures of a category row: a name line, then a thick, thin or no bar
  const barIcon = (bar) => `<svg viewBox="0 0 20 16" aria-hidden="true"><rect x="2" y="3" width="9" height="2" rx="1" fill="currentColor" opacity=".55"/>${bar}</svg>`;
  const BAR_ICON = {
    thick: barIcon('<rect x="2" y="8.5" width="16" height="4.5" rx="2.25" fill="currentColor"/>'),
    thin: barIcon('<rect x="2" y="10" width="16" height="1.6" rx=".8" fill="currentColor"/>'),
    none: barIcon(''),
  };
  const BAR_LABEL = { thick: 'Thick bars', thin: 'Thin bars', none: 'No bars' };
  const BAR_NEXT = { thick: 'thin', thin: 'none', none: 'thick' };

  // ---------- data snapshot ----------
  let D = null;
  function snapshot() {
    const cats = S.items('cats'), accounts = S.items('accounts'), rules = S.items('rules');
    const tx = S.allTx();
    const assigned = S.assignedByMonth();
    // tracking accounts (investments, super, crypto) show a balance but stay out of the budget
    const trk = (id) => !!(accounts[id] && accounts[id].type === 'tracking');
    // money moved into a tracking account leaves the budget, so it's spent from its category like a purchase
    const btx = tx.filter((t) => !trk(t.acct)).map((t) => (t.transfer && trk(t.transfer) ? Object.assign({}, t, { transfer: null }) : t));
    // credit cards and loans each have a payment category that holds the money to pay them
    const debt = {};
    for (const id in cats) { const a = cats[id].debtFor && accounts[cats[id].debtFor]; if (a && DEBT_TYPES[a.type]) debt[a.id] = id; }
    const month = E.computeMonth({ cats, tx: btx, assigned, debt }, UI.month);
    const bal = E.accountBalances(accounts, tx);
    const txById = {};
    for (const t of tx) txById[t.id] = t;
    return { cats, accounts, rules, tx, txById, assigned, month, tree: month.tree, bal, debt };
  }
  const catName = (id) => (id === INCOME ? 'Ready to Assign' : (D.cats[id] ? D.cats[id].name : 'Deleted category'));
  const catPath = (id) => (id === INCOME ? 'Ready to Assign' : (D.tree.path[id] ? D.tree.path[id].join(' › ') + (D.tree.isPot(id) ? ' (unallocated)' : '') : 'Deleted category'));
  const acctName = (id) => (D.accounts[id] ? D.accounts[id].name : 'Deleted account');
  const isTrack = (id) => !!(D.accounts[id] && D.accounts[id].type === 'tracking');
  const isDebt = (id) => !!(D.accounts[id] && DEBT_TYPES[D.accounts[id].type]);
  const START = E.START;
  // the budget side of a transfer to or from a tracking account: it leaves the budget, so it keeps a category
  const trkXfer = (t) => !!(t.transfer && isTrack(t.transfer) && !isTrack(t.acct));
  // the other side of a transfer: a tracking account's side has no category; a budget account's side keeps its own
  const pairCat = (t, p) => (isTrack(t.acct) && !isTrack(t.transfer) ? p.cat || null : null);

  // ---------- writes ----------
  const CAT_KEYS = ['id', 'name', 'parent', 'order', 'hidden', 'target', 'note', 'kind', 'linked', 'debtFor'];
  const DEBT_TYPES = { credit: 1, bnpl: 1, loan: 1 };
  const TGT_KEYS = ['type', 'amount', 'day', 'due', 'every', 'by', 'cap'];
  const TX_KEYS = ['id', 'acct', 'date', 'payee', 'cat', 'amt', 'bank', 'memo', 'receipt', 'receiptType', 'cleared', 'approved', 'ik', 'transfer', 'pair', 'splits', 'by', 'ts', 'match', 'posted', 'iks', 'imp', 'impd', 'notWith', 'bal'];
  const full = (keys, o) => { const r = {}; for (const k of keys) r[k] = o[k] === undefined ? null : o[k]; return r; };
  const fullTarget = (t) => (t ? full(TGT_KEYS, t) : null);
  function putCat(c) { c = full(CAT_KEYS, c); c.target = fullTarget(c.target); return guard(S.write('meta', 'cats', { items: { [c.id]: c } })); }
  function putAcct(a) { return guard(S.write('meta', 'accounts', { items: { [a.id]: a } })); }
  function putAssigned(m, map, moves) {
    const patch = { assigned: map };
    if (moves) patch.moves = moves;
    return guard(S.write('months', m, patch));
  }
  function putTxs(list, removed, each) {
    const byMonth = {};
    for (const t of list) {
      const m = E.monthOf(t.date);
      (byMonth[m] = byMonth[m] || {})[t.id] = full(TX_KEYS, Object.assign({}, t, { ts: Date.now() }));
    }
    // a date moved into another month: take it out of the old month too, or it shows up twice after a reload
    for (const t of list) {
      const o = D.txById[t.id], om = o && E.monthOf(o.date);
      if (om && om !== E.monthOf(t.date)) { const row = byMonth[om] = byMonth[om] || {}; if (!(t.id in row)) row[t.id] = null; }
    }
    for (const t of removed || []) {
      const m = E.monthOf(t.date);
      const row = byMonth[m] = byMonth[m] || {};
      if (!(t.id in row)) row[t.id] = null;
    }
    const ms = Object.keys(byMonth);
    if (each) each(0, ms.length);
    let done = 0;
    return Promise.all(ms.map((m) => guard(S.write('tx', m, { t: byMonth[m] })).then(() => { if (each) each(++done, ms.length); })));
  }
  // a bar along the bottom that fills while a big change saves
  function saveBar(label) {
    let el = $('#save-bar');
    if (!el) { el = document.createElement('div'); el.id = 'save-bar'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.hidden = false; el.className = '';
    const set = (n, total) => {
      if (!total) { el.hidden = true; return; } // nothing to save
      const pct = total ? Math.round((n / total) * 100) : 0;
      el.innerHTML = `<span>${n >= total && total ? `${esc(label)}: saved &#10003;` : `${esc(label)}: saving&hellip; ${pct}%`}</span><i style="width:${pct}%"></i>`;
      if (n >= total && total) { el.className = 'done'; setTimeout(() => { el.hidden = true; }, 2500); }
    };
    return set;
  }
  function guard(p) { return p.catch(() => { render(); }); }
  const myId = () => (S.me && S.me.id) || null;

  // ---------- toast ----------
  let toastTimer;
  let toastFn = null;
  // a short message, optionally with one button (stays up longer so there's time to click it)
  function toast(msg, action) {
    const el = $('#toast');
    el.textContent = msg;
    toastFn = null;
    if (action) {
      const b = document.createElement('button');
      b.className = 'toast-btn';
      b.dataset.action = 'toast-act';
      b.textContent = action.label;
      el.append(' ', b);
      toastFn = action.fn;
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; toastFn = null; }, action ? 9000 : 3200);
  }

  // ---------- render ----------
  const view = () => $('#view');
  let pending = false;
  const healing = new Set();
  function healDebt() {
    if (!D || !S.canWrite) return;
    for (const a of Object.values(D.accounts)) {
      if (!DEBT_TYPES[a.type] || D.debt[a.id] || healing.has(a.id)) continue;
      healing.add(a.id);
      ensurePayCat(a).finally(() => healing.delete(a.id));
    }
  }
  function render() {
    if (!S.ready()) { renderChrome(); view().innerHTML = '<p class="loading">Loading your budget…</p>'; return; }
    const a = document.activeElement;
    const inView = a && view().contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName);
    // don't wipe out something the person is in the middle of typing; render once they leave the field.
    // A box they've only clicked or tabbed into is safe to refresh (focus is put back afterwards).
    // (inline transaction edits are kept in a draft, so they never block a refresh)
    const dirty = inView && a.tagName !== 'SELECT' && !(a.id && a.id.indexOf('ie-') === 0) && a.value !== a.defaultValue;
    if (dirty && a.dataset.live !== '0') { pending = true; return; }
    // remember where the cursor is so it can be put back after the refresh
    let keep = null;
    if (a && view().contains(a)) {
      const sel = a.id ? '#' + CSS.escape(a.id) : a.dataset.action ? `[data-action="${a.dataset.action}"]${a.dataset.id ? `[data-id="${a.dataset.id}"]` : ''}${a.dataset.v ? `[data-v="${a.dataset.v}"]` : ''}` : null;
      if (sel) keep = { sel, s: a.selectionStart, e: a.selectionEnd, text: /INPUT|TEXTAREA/.test(a.tagName) };
    }
    pending = false;
    D = snapshot();
    if (Object.values(D.accounts).some((x) => DEBT_TYPES[x.type] && !D.debt[x.id])) setTimeout(healDebt, 0);
    renderChrome();
    const empty = !Object.keys(D.cats).length && !Object.keys(D.accounts).length;
    view().innerHTML = empty ? viewWelcome() : ({ budget: viewBudget, tx: viewTx, accounts: viewAccounts, settings: viewSettings }[UI.view] || viewBudget)();
    if (keep) {
      const n = view().querySelector(keep.sel);
      if (n) { n.focus({ preventScroll: true }); if (keep.text && !n.classList.contains('asg')) { try { n.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text field */ } } }
    }
    if (sheet && sheet.refresh && !(document.activeElement && $('#sheet').contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) sheet.refresh();
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pending) render(); }, 0));

  function renderChrome() {
    const st = $('#sync');
    const mode = S.mode;
    let label, cls;
    if (mode === 'loading') { label = 'Connecting'; cls = 'wait'; }
    else if (mode === 'local') { label = 'This browser only'; cls = 'local'; }
    else if (S.status === 'saving') { label = 'Saving'; cls = 'wait'; }
    else if (S.status === 'error') { label = 'Not saved'; cls = 'bad'; }
    else { label = 'Synced'; cls = 'ok'; }
    st.className = 'sync ' + cls;
    st.querySelector('span').textContent = label;
    $('#banner').innerHTML = mode === 'local'
      ? '<div class="banner">Preview mode: changes are saved in this browser only. Open YNABB from its web address and sign in to sync between your devices.</div>'
      : (S.status === 'error' && S.error ? `<div class="banner bad">${esc(S.error)}</div>` : '');
    $$('[data-nav]').forEach((b) => b.setAttribute('aria-current', b.dataset.nav === UI.view ? 'page' : 'false'));
    const lb = $('#layoutbtn');
    const isPhone = document.documentElement.dataset.layout === 'phone';
    lb.innerHTML = isPhone
      ? '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="10" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M7 17h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Computer view'
      : '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="2.5" width="8" height="15" rx="1.8" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M9 15h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Phone view';
    lb.title = isPhone ? 'Switch to the computer layout' : 'Switch to the phone layout';
    const ms = $('#monthsw');
    ms.hidden = UI.view !== 'budget';
    const pn = $('#pagename');
    const pname = { tx: 'Transactions', accounts: 'Accounts', settings: 'Settings' }[UI.view];
    if (pn) { pn.hidden = !pname; pn.textContent = pname || ''; }
    // sticky headings sit just under the header, whatever its height
    document.documentElement.style.setProperty('--hdr', ($('.top') ? $('.top').offsetHeight : 50) + 'px');
    requestAnimationFrame(rtaLine);
    $('#monthlabel').textContent = monthLabel(UI.month);
    const review = D ? D.tx.filter((t) => t.approved === false).length : 0;
    const badge = $('#txbadge');
    badge.textContent = review;
    badge.hidden = !review;
  }

  // ---------- welcome ----------
  function viewWelcome() {
    return `<section class="welcome">
      <h1>Give every dollar a job.</h1>
      <p class="lede">YNABB is a zero-based budget. Money comes in and waits in <b>Ready to Assign</b>. You give each dollar a job by assigning it to a category, until Ready to Assign is at zero. When you overspend, that category goes red and stays red, even into next month, until you cover it from another category or top it up.</p>
      <ol class="steps">
        <li><b>Add your accounts</b> with today's balances. That money becomes Ready to Assign.</li>
        <li><b>Set up categories.</b> Nest them as deep as you like: Bills › Insurance › Car.</li>
        <li><b>Add targets</b> so the app can tell you how much each category needs this month.</li>
      </ol>
      <div class="row-btns">
        <button class="btn primary" data-action="guide">Set it up with the step-by-step guide (recommended)</button>
        <button class="btn" data-action="starter">Start with a suggested category list</button>
        <button class="btn" data-action="add-group">Start with no categories</button>
        <label class="btn" for="ynab-file">Move my budget from YNAB</label><input type="file" id="ynab-file" accept=".zip,.csv,application/zip,text/csv" multiple hidden data-live="0">
        <label class="btn" for="restore-file">Restore a YNABB backup</label><input type="file" id="restore-file" accept=".json,application/json" hidden data-live="0">
      </div>
      <p class="fine">You can rename, nest, hide or delete any category later.</p>
      ${S.mode === 'server' ? `<p class="fine">Signed in as ${esc(S.account.name)} · <a class="linkish" href="/account">Account and password</a> · <a class="linkish" href="#" data-action="sign-out">Sign out</a></p>` : ''}
    </section>`;
  }

  const STARTER = [
    ['Bills', [['Rent or mortgage'], ['Electricity'], ['Gas'], ['Water'], ['Internet'], ['Phone'], ['Insurance', [['Car insurance'], ['Health insurance'], ['Home & contents']]]]],
    ['Everyday', [['Groceries'], ['Fuel'], ['Eating out'], ['Household supplies']]],
    ['Car', [['Registration'], ['Servicing & repairs']]],
    ['Personal', [['Clothing'], ['Haircuts'], ['Gifts'], ['Subscriptions']]],
    ['Savings goals', [['Holiday'], ['Emergency fund'], ['Pet emergency fund']]],
  ];
  async function addStarter() {
    const items = {};
    (function add(list, parent) {
      list.forEach(([name, kids], i) => {
        const id = S.uid();
        items[id] = full(CAT_KEYS, { id, name, parent: parent || null, order: i + 1, hidden: false, target: null, note: '' });
        if (kids) add(kids, id);
      });
    })(STARTER, null);
    await guard(S.write('meta', 'cats', { items }));
    toast('Categories added. Next, add your accounts.');
    UI.view = 'accounts'; saveUI(); render();
  }

  // ---------- budget ----------
  function viewBudget() {
    const M = D.month;
    const tree = D.tree;
    if (!tree.order.length) {
      return rtaBanner(M) + `<div class="empty-note"><p>No categories yet.</p><button class="btn primary" data-action="add-group">Add a category</button></div>`;
    }
    // which rows to show
    let visible = null;
    if (UI.budgetFilter.indexOf('kind:') === 0) {
      const want = UI.budgetFilter.slice(5);
      visible = new Set();
      for (const id of tree.order) {
        if (!(tree.isLeaf(id) || tree.isPot(id))) continue;
        if (payAcct(id) ? want !== 'need' && want !== 'save' : (kindOf(id) || 'none') !== want) continue;
        let p = id;
        while (p) { visible.add(p); p = tree.byId[p].parent; }
      }
    }
    if (UI.budgetFilter === 'attention') {
      visible = new Set();
      for (const id of tree.order) {
        const needs = tree.isLeaf(id) ? (M.rows[id].status === 'over' || M.rows[id].status === 'under')
          : tree.isPot(id) ? (M.rows[id].available < 0 || M.roll[id].targetShort > 0 || (M.roll[id].target && M.roll[id].target.under > 0)) : false;
        if (!needs) continue;
        let p = id;
        while (p) { visible.add(p); p = tree.byId[p].parent; }
      }
    }
    let rows = '';
    // each top-level group is wrapped in its own box, so on a phone its heading sticks only until the group ends
    const walk = (ids, top) => {
      for (const id of ids) {
        const c = tree.byId[id];
        if (c.hidden && !UI.showHidden) continue;
        if (visible && !visible.has(id)) continue;
        if (top) rows += '<div class="bgrp">';
        rows += tree.isLeaf(id) ? leafRow(id) : tree.isPot(id) ? potRow(id) : parentRow(id);
        if (!tree.isLeaf(id) && !UI.collapsed[id]) {
          const own = M.rows[id];
          // Unallocated only shows when it has money, spending or a balance in it this month
          if (tree.isPot(id)) { if (own.available || own.activity || own.assigned) rows += unallocRow(id); }
          else if (own.available || own.activity || own.assigned) rows += ownMoneyRow(id);
          walk(tree.children[id]);
        }
        if (top) rows += '</div>';
      }
    };
    walk(tree.roots, true);
    for (const id of M.orphans) rows += orphanRow(id);

    const underCount = D.tree.roots.reduce((n, id) => n + M.roll[id].underCount, 0);
    const attnTitle = [M.overspentCount ? `${M.overspentCount} in the red (${money(M.overspentTotal)})` : '', underCount ? `${underCount} short of their target` : ''].filter(Boolean).join(', ');
    return rtaBanner(M) + (pctOn() && !isPhone() ? splitBar() : '') + `
      <div class="month-sum">
          <span>Income <b>${money(M.incomeThisMonth)}</b></span>
          <span>Assigned <b>${money(M.assignedThisMonth)}</b></span>
          <span>Spent <b>${money(-M.activityThisMonth)}</b></span>
          <span>Available <b>${money(M.totalAvailable)}</b></span>
        </div>
      <div class="bud-tools">
        <div class="seg-ctl" role="group" aria-label="Show">
          <button data-action="bfilter" data-v="all" aria-pressed="${UI.budgetFilter === 'all'}">All categories</button>
          <button data-action="bfilter" data-v="attention" aria-pressed="${UI.budgetFilter === 'attention'}" class="${M.overspentCount ? 'alert' : ''}" title="${attnTitle || 'Nothing needs attention'}">Needs attention${M.overspentCount ? ` <b class="count bad" aria-label="${M.overspentCount} in the red">${M.overspentCount}</b>` : ''}${underCount ? ` <b class="count warn" aria-label="${underCount} short of target">${underCount}</b>` : ''}</button>
        </div>
        ${UI.budgetFilter.indexOf('kind:') === 0 ? `<button class="chip" data-action="bfilter" data-v="all" title="Show all categories">Only ${esc(UI.budgetFilter === 'kind:none' ? 'not tagged' : (KINDS.find((x) => x[0] === UI.budgetFilter.slice(5)) || [0, ''])[1].toLowerCase())} ✕</button>` : ''}
        <div class="tools-r">
          <button class="btn sm icon-cycle${tgtOn() ? ' on' : ''}" data-action="tgt-toggle" aria-pressed="${tgtOn()}" aria-label="${tgtOn() ? 'Hide' : 'Show'} the Target column" title="${tgtOn() ? 'Hide' : 'Show'} the Target column"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.7" fill="none"/><circle cx="10" cy="10" r="3.6" stroke="currentColor" stroke-width="1.7" fill="none"/><circle cx="10" cy="10" r="1.1" fill="currentColor"/></svg></button>
          <button class="btn sm icon-cycle pct-btn${pctOn() ? ' on' : ''}" data-action="pct-toggle" aria-pressed="${pctOn()}" title="${pctOn() ? 'Hide' : 'Show'} the needs, wants and freedom bar">%</button>
          <button class="btn sm icon-cycle desk-only" data-action="bar-cycle" aria-label="${BAR_LABEL[barPref()]}. Click to change." title="${BAR_LABEL[barPref()]} (click to change)">${BAR_ICON[barPref()]}</button>
          <button class="btn sm phone-only" data-action="collapse-all">${Object.keys(UI.collapsed).length ? 'Expand all' : 'Collapse all'}</button>
          <button class="btn sm ${UI.editCats ? 'on' : ''}" data-action="edit-cats" aria-pressed="${UI.editCats}">${UI.editCats ? 'Done' : '<span class="desk-only">Edit categories</span><span class="phone-only">Edit</span>'}</button>
        </div>
      </div>
      <div class="bud" role="table" aria-label="Budget for ${esc(monthLabel(UI.month))}">
        <div class="bud-head" role="row"><span role="columnheader" class="head-cat">${(() => { const any = Object.keys(UI.collapsed).length; const l = any ? 'Expand all groups' : 'Collapse all groups'; return `<button class="twisty" data-action="collapse-all" aria-label="${l}" title="${l}">${any ? ICON.right : ICON.down}</button>`; })()}Category</span><span role="columnheader" class="h-tgt">Target</span><span role="columnheader" class="h-asg">Assigned</span><span role="columnheader">Spent</span><span role="columnheader">Available</span></div>
        ${rows || '<p class="empty-note">Nothing needs attention this month.</p>'}
      </div>
      ${UI.editCats ? '<div class="row-btns"><button class="btn" data-action="add-group">' + ICON.plus + ' Add top-level category</button><label class="check"><input type="checkbox" id="showhidden" data-action="toggle-hidden" ' + (UI.showHidden ? 'checked' : '') + '> Show hidden categories</label></div>' : ''}
      <div class="legend" aria-hidden="true"><span><i class="seg spent"></i>Spent</span><span><i class="seg avail"></i>Available</span><span><i class="seg need"></i>Still needed</span><span><i class="seg over"></i>Overspent</span></div>`;
  }

  function rtaBanner(M) {
    const rta = M.rta;
    const cls = rta > 0 ? 'pos' : rta < 0 ? 'neg' : 'zero';
    let msg, act = '';
    if (rta > 0) {
      msg = 'These dollars don\'t have a job yet. Assign them to categories below.';
      const plan = E.planAutoAssign(M);
      if (Object.keys(plan.changes).length) act = `<button class="btn on-rta" data-action="auto-assign">Fund targets${plan.rtaUsed ? ` (${money(plan.rtaUsed)})` : ''}</button>`;
    } else if (rta < 0) {
      msg = 'You\'ve assigned more money than you have. Take some back from a category.';
      act = `<button class="btn on-rta" data-action="move" data-id="${INCOME}">Fix this</button>`;
    } else {
      msg = M.underTotal > 0 ? `Every dollar has a job. Targets still need ${money(M.underTotal)} this month.` : 'Every dollar has a job.';
    }
    const links = [];
    const review = D.tx.filter((t) => t.approved === false).length;
    if (review) links.push(`<button class="rta-link" data-action="goto-review">${review} to review</button>`);
    if (M.uncategorized) links.push(`<button class="rta-link" data-action="goto-uncat">${M.uncategorized} uncategorized</button>`);
    if (M.assignedFuture && M.month >= E.monthOf(E.todayISO())) links.push(`<span>${money(M.assignedFuture)} assigned in future months</span>`);
    return `<section class="rta ${cls}" aria-live="polite">
      <button class="rta-amt" data-action="move" data-id="${INCOME}" aria-label="Move money from or to Ready to Assign">
        <span class="rta-label">Ready to Assign</span>
        <span class="rta-num">${money(rta)}</span>
      </button>
      <div class="rta-info">
        <p class="rta-msg">${esc(msg)}</p>
        ${links.length ? `<p class="rta-links">${links.join('<span class="dot" aria-hidden="true">·</span>')}</p>` : ''}
      </div>
      ${act ? `<div class="rta-act">${act}</div>` : ''}
    </section>`;
  }

  function bar(p) {
    const total = p.spent + p.avail + p.need + p.over;
    if (!total) return '<div class="bar empty"></div>';
    const seg = (k) => (p[k] > 0 ? `<i class="seg ${k}" style="flex-grow:${p[k]}"></i>` : '');
    return `<div class="bar">${seg('spent')}${seg('over')}${seg('avail')}${seg('need')}</div>`;
  }

  // a card or loan's payment category: what's owed and how much is ready to pay it
  function debtLine(id, r) {
    const a = D.accounts[D.cats[id].debtFor];
    const owing = Math.max(0, -((D.bal[a.id] || {}).balance || 0));
    if (r.available < 0) return '';
    if (!owing) return `<span class="st funded">Nothing owed</span>${r.available > 0 ? `<span class="tdesc">${money(r.available)} spare</span>` : ''}`;
    const ti = r.target, owes = `Owes ${money(owing)}`;
    if (a.type === 'credit') {
      // a card is on track when everything owed has money waiting to pay it
      if (r.available >= owing) return `<span class="st funded">Ready to pay all ${money(owing)}</span>`;
      if (ti && ti.under === 0) return `<span class="st funded">On track</span><span class="tdesc">${owes} · ${money(r.available)} ready to pay</span>`;
      return `<span class="st under">${owes}</span><span class="tdesc">${money(r.available)} ready to pay${ti && ti.under > 0 ? ` · target asks for ${money(ti.under)} more` : ''}</span>`;
    }
    // a loan is meant to be paid over time: what matters is this month's repayment, and for a weekly plan the next one
    const nxt = payWeekly(a) && a.payment ? ` · next ${money(a.payment)} on ${dateLabel(nextWeekday(a.payDay))}` : '';
    if (ti && ti.under > 0) return `<span class="st under">Needs ${money(ti.under)} for this month</span><span class="tdesc">${owes}${nxt}</span>`;
    if (ti) return `<span class="st funded">Repayment covered</span><span class="tdesc">${owes}${nxt}</span>`;
    return `<span class="tdesc">${owes} · ${money(r.available)} ready to pay</span>`;
  }
  function targetLine(id, r) {
    const c = D.cats[id], t = c && c.target, ti = r.target;
    if (c && c.debtFor && D.debt[c.debtFor] === id) { const d = debtLine(id, r); if (d) return d; }
    if (r.available < 0) {
      const carried = r.carry < 0;
      const red = `<span class="st over">${carried && r.activity >= 0 ? `In the red by ${money(-r.available)} from last month` : `Overspent by ${money(-r.available)}`}</span>`;
      return ti && ti.under > 0 ? `${red}<span class="tdesc">Target asks for ${money(ti.under)} more</span>` : red;
    }
    if (!t || !ti) return '';
    let desc = '';
    switch (t.type) {
      case 'refill': desc = `Refill to ${money(t.amount)}${t.day ? ` by the ${ordinal(t.day)}` : ''} each month`; break;
      case 'monthly': desc = `${money(t.amount)} every month`; break;
      case 'weekly': desc = `${money(t.amount)} every ${WEEKDAYS[t.day | 0]} (${ti.weeks} ${WEEKDAYS[t.day | 0]}s this month)`; break;
      case 'due': desc = ti.done ? 'Due date has passed' : `${money(t.amount)} due ${dueText(t, ti)}`; break;
      case 'goal': desc = `${Math.round(ti.pct * 100)}% of ${money(t.amount)}${t.by ? ` by ${monthLabel(E.monthOf(t.by), true)}` : ''}${ti.spent ? ` · ${money(ti.spent)} already spent from it` : ''}`; break;
      case 'cap': desc = `${money(t.amount)} a month until it holds ${money(t.cap)}`; break;
    }
    let st;
    if (ti.under > 0) st = `<span class="st under">Needs ${money(ti.under)} more</span>`;
    else if (t.type === 'goal' && ti.remaining <= 0) st = '<span class="st funded">Goal reached</span>';
    else if (t.type === 'goal' && !ti.need) st = `<span class="st goal">${money(ti.remaining)} to go</span>`;
    else if (t.type === 'cap' && !ti.need) st = '<span class="st funded">Full</span>';
    else st = '<span class="st funded">Funded</span>';
    return `${st}<span class="tdesc">${esc(desc)}</span>`;
  }
  function dueText(t, ti) {
    const [y, m] = ti.dueMonth.split('-').map(Number);
    const d = new Date(y, m - 1, Math.min(ti.dueDay || 1, 28));
    const when = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' });
    const rep = { 1: 'monthly', 2: 'every 2 months', 3: 'quarterly', 6: 'every 6 months', 12: 'yearly' }[t.every | 0];
    return `${when}${rep ? ` (${rep})` : ''} · ${ti.monthsLeft === 1 ? 'this month' : `${ti.monthsLeft} months to go`}`;
  }

  function tlineHTML(html) {
    if (!html) return '<div class="tline"></div>';
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return `<div class="tline" title="${text}">${html}</div>`;
  }
  function editControls(id) {
    if (!UI.editCats) return '';
    const own = D.cats[id].kind, eff = kindOf(id);
    const kchip = payAcct(id) ? '<span class="kchip tx-need" title="The minimum payment is a need; anything extra is freedom">Need + Freedom</span>' : `<button class="kchip tx-${eff || 'none'}${own ? '' : ' inh'}" data-action="kind-cycle" data-id="${id}" title="${own ? kindLabel(own) : eff ? `${kindLabel(eff)} (from the group above)` : 'Not tagged'}. Click to change.">${eff ? KIND_SHORT[eff] : 'Tag'}</button>`;
    return `<span class="edit-ctl">${kchip}
      <button class="icon-btn" data-action="cat-up" data-id="${id}" aria-label="Move up">${ICON.up}</button>
      <button class="icon-btn" data-action="cat-down" data-id="${id}" aria-label="Move down">${ICON.down}</button>
      ${payAcct(id) ? '' : `<button class="btn xs" data-action="add-sub" data-id="${id}">${ICON.plus} Sub</button>`}
    </span>`;
  }

  // what a category's target asks for this month
  function tgtCell(need, desc) {
    const v = need == null ? '<span class="num faint">—</span>' : `<span class="num">${money(need)}</span>`;
    return `<div class="b-tgt"${desc ? ` title="${esc(desc)}"` : ''}><span class="m-lbl">Target</span>${v}</div>`;
  }
  const tgtDesc = (id, info) => (info ? targetLine(id, info).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

  // ---------- needs, wants, freedom (the 50/30/20 check) ----------
  // 'save' is the stored id; people see it as Freedom (savings, investing and paying off debt)
  const KINDS = [['need', 'Needs', 'Need'], ['want', 'Wants', 'Want'], ['save', 'Freedom', 'Freedom']];
  const KIND_SHORT = { need: 'Need', want: 'Want', save: 'Freedom' };
  const kindLabel = (k) => (KINDS.find((x) => x[0] === k) || [0, 'Not tagged', 'Not tagged'])[2];
  // a category's type: its own tag, or the nearest group above it that has one
  function kindOf(id) {
    let p = id;
    while (p && D.cats[p]) { if (D.cats[p].kind) return D.cats[p].kind; p = D.cats[p].parent; }
    return null;
  }
  const DEBT_ICON = {
    card: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5" width="15" height="10.5" rx="1.8" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M2.5 8.5h15M5 12.5h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    home: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9.5L10 4l7 5.5M5 8.3V16h10V8.3M8.5 16v-4h3v4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tax: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.8h7l3 3V17H5zM12 2.8v3h3M7.5 9.5h5M7.5 12.5h5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    loan: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M7.3 12.7l5.4-5.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="7.6" cy="7.6" r="1.1" fill="currentColor"/><circle cx="12.4" cy="12.4" r="1.1" fill="currentColor"/></svg>',
    bank: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8l7-4 7 4M4.5 8v6.5M8.5 8v6.5M11.5 8v6.5M15.5 8v6.5M3 16h14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    piggy: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5c0-3 2.7-5 6-5s6.5 1.6 6.5 4.6c0 1.6-.8 2.9-2 3.7V16h-2.3v-1.4H8.3V16H6v-2.1c-1.3-.8-2-2-2-3.4zM3.5 10H2.5M13 8.5h.01" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cash: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5.5" width="15" height="9" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="10" cy="10" r="2" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
    chart: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16h14M4.5 13l3.5-4 3 2.5 4.5-6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const acctIcon = (a) => DEBT_ICON[DEBT_TYPES[a.type] ? debtIconKey(a) : a.type === 'savings' ? 'piggy' : a.type === 'cash' ? 'cash' : a.type === 'tracking' ? 'chart' : 'bank'];
  const debtIconKey = (a) => (a.type !== 'loan' ? 'card' : /mortgage|home|house/i.test(a.name) ? 'home' : /\bato\b|\btax\b/i.test(a.name) ? 'tax' : 'loan');
  // is this the payment category of a card or loan?
  const payAcct = (id) => { const c = D.cats[id]; return c && c.debtFor && D.debt[c.debtFor] === id ? D.accounts[c.debtFor] : null; };
  const kdot = (id) => {
    const a = payAcct(id);
    if (a) return `<i class="kdot debt-ic" title="Pays ${esc(a.name)} (${esc(ASHORT[a.type] || 'debt')})">${DEBT_ICON[debtIconKey(a)]}</i>`;
    const k = kindOf(id); return `<i class="kdot bg-${k || 'none'}" title="${esc(kindLabel(k))}"></i>`;
  };
  function splitBasis() { try { return localStorage.getItem('zeroline-split-basis') || 'assigned'; } catch (e) { return 'assigned'; } }
  function splitGoals() { return Object.assign({ need: 50, want: 30, save: 20 }, S.settings().split || {}); }
  // a card or loan's minimum each month: the minimum payment if set, otherwise a loan's set repayment
  const minPayOf = (a) => (a ? (a.minPay != null ? a.minPay : a.type !== 'credit' ? payMonthly(a) : 0) : 0);
  // a loan repaid weekly (like an ATO payment plan) keeps the amount of each payment and the weekday it comes out
  const payWeekly = (a) => !!a && a.payDay != null && a.type !== 'credit';
  const payMonthly = (a) => (payWeekly(a) ? Math.ceil((a.payment || 0) * 52 / 12) : a.payment || 0);
  const payTarget = (a) => (payWeekly(a) ? { type: 'weekly', amount: a.payment, day: a.payDay } : { type: 'monthly', amount: a.payment });
  const paySay = (a) => (payWeekly(a) ? `${money(a.payment)} every ${WEEKDAYS[a.payDay]}` : `${money(a.payment)}/month`);
  // the next time a weekday comes round, today included
  const nextWeekday = (wd) => { const d = new Date(); d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function splitTotals(basis) {
    const tot = { need: 0, want: 0, save: 0, none: 0 };
    const add = (id, v) => {
      if (!v) return;
      // paying a debt: the minimum is a need, anything on top is freedom
      const a = payAcct(id);
      if (a && v > 0) { const m = Math.min(v, minPayOf(a)); tot.need += m; tot.save += v - m; return; }
      tot[kindOf(id) || 'none'] += v;
    };
    if (basis === 'targets') {
      const walk = (id) => {
        if (D.tree.isLeaf(id)) { const t = D.month.rows[id].target; if (t) add(id, t.need); return; }
        if (D.tree.isPot(id) && D.month.roll[id].target) { add(id, D.month.roll[id].target.need); return; }
        D.tree.children[id].forEach(walk);
      };
      D.tree.roots.forEach(walk);
    } else {
      for (const id of D.tree.order) add(id, D.month.rows[id].assigned);
    }
    return tot;
  }
  function splitBar() {
    const basis = splitBasis(), goals = splitGoals(), tot = splitTotals(basis);
    for (const k in tot) tot[k] = Math.max(0, tot[k]);
    const sum = tot.need + tot.want + tot.save + tot.none;
    const head = `<div class="nws-head">
        <label class="title-sel"><span class="sr">Show</span><select id="split-basis" data-live="0">
          <option value="assigned" ${basis === 'assigned' ? 'selected' : ''}>Where this month's budget is going</option>
          <option value="targets" ${basis === 'targets' ? 'selected' : ''}>Where your targets would send your money</option>
        </select></label>
        <button class="linkish" data-action="split-goals">Change goal</button>
      </div>`;
    if (sum <= 0) return `<section class="nws">${head}<p class="hint">${basis === 'targets' ? 'No targets this month yet.' : 'Nothing budgeted this month yet.'}</p></section>`;
    const names = { need: 'Needs', want: 'Wants', save: 'Freedom', none: 'Not tagged' };
    const short = { need: 'Needs', want: 'Wants', save: 'Savings', none: 'Not tagged' };
    const pct = (v) => Math.round((v / sum) * 100);
    const seg = (k, p, click, extra) => {
      const label = p >= 14 ? `${short[k]} ${p}%` : p >= 4 ? `${p}%` : '';
      const tip = `${names[k]}: ${p}%${extra || ''}`;
      return click
        ? `<button class="sp-seg bg-${k}" style="flex-grow:${p}" data-action="kind-filter" data-k="${k}" title="${esc(tip)}. Click to show only these.">${label}</button>`
        : `<span class="sp-seg bg-${k}" style="flex-grow:${p}" title="${esc(tip)}">${label}</span>`;
    };
    const order = ['need', 'want', 'save', 'none'];
    const you = order.filter((k) => tot[k] > 0).map((k) => seg(k, pct(tot[k]), true, k !== 'none' ? ` (goal ${goals[k]}%)` : '')).join('');
    // goal: a thin line in each colour, broken in the middle by its percentage
    const goal = order.filter((k) => k !== 'none' && goals[k] > 0).map((k) => `<span class="gseg tx-${k}" style="flex-grow:${goals[k]}" title="${esc(names[k])} goal: ${goals[k]}%"><i></i><b>${goals[k]}%</b><i></i></span>`).join('');
    return `<section class="nws">${head}
      <div class="sp-rows">
        <span class="sp-lbl">You</span><div class="sp-bar">${you}</div>
        <span class="sp-lbl">Goal</span><div class="sp-goal">${goal}</div>
      </div>
      ${tot.none > 0 ? `<p class="sp-say">${pct(tot.none)}% isn't tagged as a need, want or saving yet. <button class="linkish" data-action="tag-mode">Tag categories</button></p>` : ''}
    </section>`;
  }
  function openSplitGoals() {
    const g = splitGoals();
    openSheet({
      title: 'Goal split',
      body: `<p>How you'd like each month's money to divide. The usual rule is 50/30/20.</p>
        <div class="grid3">
          <div class="field"><label for="sg-need">Needs %</label><input id="sg-need" type="number" min="0" max="100" inputmode="numeric" value="${g.need}"></div>
          <div class="field"><label for="sg-want">Wants %</label><input id="sg-want" type="number" min="0" max="100" inputmode="numeric" value="${g.want}"></div>
          <div class="field"><label for="sg-save">Freedom %</label><input id="sg-save" type="number" min="0" max="100" inputmode="numeric" value="${g.save}"></div>
        </div><p id="sg-sum" class="hint"></p>`,
      foot: '<button class="btn primary" data-saction="save">Save</button><button class="btn" data-saction="reset">Use 50/30/20</button>',
    });
    const vals = () => ({ need: Number($('#sg-need').value) || 0, want: Number($('#sg-want').value) || 0, save: Number($('#sg-save').value) || 0 });
    const check = () => { const v = vals(), t = v.need + v.want + v.save; $('#sg-sum').textContent = t === 100 ? 'Adds up to 100%.' : `Adds up to ${t}%. It needs to be 100%.`; $('#sg-sum').className = 'hint ' + (t === 100 ? '' : 'bad'); return t === 100; };
    check();
    sheet.onInput = check;
    const save = async (v) => { await guard(S.write('meta', 'settings', { split: v })); closeSheet(); render(); };
    sheet.actions = { save: () => { if (check()) save(vals()); }, reset: () => save({ need: 50, want: 30, save: 20 }) };
  }

  const ICON_LINK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5l3-3M7.2 9.3L5.6 10.9a2.6 2.6 0 003.7 3.7l1.6-1.6M12.8 10.7l1.6-1.6a2.6 2.6 0 00-3.7-3.7L9.1 7" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>';
  const ICON_UNLINK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.2 9.3L5.6 10.9a2.6 2.6 0 003.7 3.7l1.6-1.6M12.8 10.7l1.6-1.6a2.6 2.6 0 00-3.7-3.7L9.1 7M4 4l2 2M16 16l-2-2" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>';
  // the chain beside a subcategory's Assigned box: linked = money moves within its group
  function linkBtn(id) {
    if (!D.tree.isLinkable(id)) return '';
    const on = D.cats[id].linked !== false, g = esc(D.cats[D.cats[id].parent].name);
    const tip = on ? `Linked to ${g}: changes here move money in and out of ${poss(g)} Unallocated. Click to unlink.` : `Not linked: changes here come from Ready to Assign, and ${g}'s total changes with it. Click to link.`;
    return `<button class="link-btn${on ? ' on' : ''}" data-action="link-toggle" data-id="${id}" aria-pressed="${on}" aria-label="${tip}" title="${tip}">${on ? ICON_LINK : ICON_UNLINK}</button>`;
  }

  // phone: one category at a time shows its Assigned, Spent and Target (no re-render, so typing isn't interrupted)
  function toggleCatRow(id) {
    UI.openCat = UI.openCat === id ? null : id;
    document.querySelectorAll('.brow.open').forEach((r) => r.classList.remove('open'));
    const r = UI.openCat && document.querySelector(`.brow[data-cat="${UI.openCat}"]`);
    if (r) r.classList.add('open');
  }
  function leafRow(id) {
    const r = D.month.rows[id], c = D.cats[id], depth = D.tree.depth[id];
    return `<div class="brow leaf st-${r.status}${c.hidden ? ' hidden-cat' : ''}${payAcct(id) ? ' debt' : ''}${UI.openCat === id ? ' open' : ''}" data-cat="${id}" role="row" style="--d:${depth}">
      <div class="b-name">
        <span class="twisty-sp"></span>
        ${kdot(id)}<button class="cname" data-action="cat" data-id="${id}" title="${esc(c.name)}">${esc(c.name)}</button>
        ${editControls(id)}
        ${tlineHTML(targetLine(id, r))}
      </div>
      <button class="b-edit" data-action="cat-edit" data-id="${id}" aria-label="Edit ${esc(c.name)}: target, name and more" title="Edit target, name and more"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.6l2.8 2.8L7.2 15.6 3.8 16.2l.6-3.4 9.2-9.2z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M11.8 5.4l2.8 2.8" stroke="currentColor" stroke-width="1.6"/></svg></button>
      <div class="b-bar">${bar(r.parts)}</div>
      ${tgtCell(r.target ? r.target.need : null, r.target ? tgtDesc(id, r) : '')}
      <div class="b-asg"><label class="m-lbl" for="asg-${id}">Assigned</label><input id="asg-${id}" class="asg cents${D.tree.isLinkable(id) ? ' has-link' : ''}" inputmode="numeric" autocomplete="off" data-id="${id}" value="${box(r.assigned)}" aria-label="Assigned to ${esc(c.name)}">${linkBtn(id)}</div>
      <div class="b-act"><span class="m-lbl">Spent</span>${c.debtFor && D.debt[c.debtFor] === id ? `<button class="num spent-link" data-action="spent" data-id="${id}" title="Spending on the card moved in, less payments made. Click to see the transactions">${r.activity ? signed(r.activity) : money(0)}</button>` : `<button class="num spent-link" data-action="spent" data-id="${id}" title="See the transactions">${money(-r.activity)}</button>`}</div>
      <div class="b-avl"><span class="m-lbl">Available</span><button class="pill st-${r.status}" data-action="move" data-id="${id}" aria-label="Available in ${esc(c.name)}: ${money(r.available)}. Move money.">${money(r.available)}</button></div>
    </div>`;
  }

  function parentRow(id) {
    const g = D.month.roll[id], c = D.cats[id], depth = D.tree.depth[id];
    const collapsed = !!UI.collapsed[id];
    const st = g.overCount ? 'over' : g.underCount ? 'under' : g.available > 0 ? 'pos' : 'zero';
    const flag = g.overCount ? `<span class="st over">${g.overCount} in the red</span>` : g.under ? `<span class="st under">Needs ${money(g.under)}</span>` : '';
    return `<div class="brow parent${depth === 0 ? ' top' : ''}${collapsed ? ' collapsed' : ''}${c.hidden ? ' hidden-cat' : ''}${D.tree.children[id].some((k) => payAcct(k)) ? ' debt-grp' : ''}${UI.openCat === id ? ' open' : ''}" data-cat="${id}" role="row" style="--d:${depth}">
      <div class="b-name">
        <button class="twisty" data-action="toggle" data-id="${id}" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(c.name)}">${collapsed ? ICON.right : ICON.down}</button>
        ${kdot(id)}<button class="cname" data-action="cat" data-id="${id}" title="${esc(c.name)}">${esc(c.name)}</button>${D.tree.children[id].some((k) => payAcct(k)) ? '<span class="debt-chip">Cards &amp; loans</span>' : ''}
        ${editControls(id)}
        ${tlineHTML(flag)}
      </div>
      <div class="b-bar">${bar(g.parts)}</div>
      <div class="b-tgt" title="Total of the targets in ${esc(c.name)} this month"><span class="m-lbl">Target</span><span class="num">${g.needSub ? money(g.needSub) : '<span class="faint">—</span>'}</span></div>
      <div class="b-asg"><span class="m-lbl">Assigned</span><span class="num">${money(g.assigned)}</span></div>
      <div class="b-act"><span class="m-lbl">Spent</span><button class="num spent-link" data-action="spent" data-id="${id}" title="See the transactions">${money(-g.activity)}</button></div>
      <div class="b-avl"><span class="m-lbl">Available</span><span class="pill flat st-${st}">${money(g.available)}</span></div>
    </div>`;
  }

  // a group below the top level: shows the total of everything in it, and typing changes its Unallocated pot
  function potRow(id) {
    const g = D.month.roll[id], c = D.cats[id], depth = D.tree.depth[id];
    const collapsed = !!UI.collapsed[id];
    let line = c.target ? targetLine(id, g) : '';
    if (g.targetShort > 0) line = `<span class="st under">Targets inside need ${money(g.kidsNeed)} this month, ${money(g.targetShort)} more than ${poss(esc(c.name))} target</span>` + (line ? `<span class="tdesc">${line.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}</span>` : '');
    if (!line) line = g.overCount ? `<span class="st over">${g.overCount} in the red</span>` : g.under ? `<span class="st under">Needs ${money(g.under)}</span>` : '';
    return `<div class="brow pot st-${g.status}${collapsed ? ' collapsed' : ''}${c.hidden ? ' hidden-cat' : ''}${UI.openCat === id ? ' open' : ''}" data-cat="${id}" role="row" style="--d:${depth}">
      <div class="b-name">
        <button class="twisty" data-action="toggle" data-id="${id}" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(c.name)}">${collapsed ? ICON.right : ICON.down}</button>
        ${kdot(id)}<button class="cname" data-action="cat" data-id="${id}" title="${esc(c.name)}">${esc(c.name)}</button>
        ${editControls(id)}
        ${tlineHTML(line)}
      </div>
      <div class="b-bar">${bar(g.parts)}</div>
      ${tgtCell(g.needSub || (g.target ? 0 : null), g.target ? tgtDesc(id, g) : g.needSub ? `Total of the targets inside ${c.name}` : '')}
      <div class="b-asg"><label class="m-lbl" for="asgt-${id}">Assigned</label><input id="asgt-${id}" class="asg cents${D.tree.isLinkable(id) ? ' has-link' : ''}" data-mode="total" inputmode="numeric" autocomplete="off" data-id="${id}" value="${box(g.assigned)}" aria-label="Total assigned to ${esc(c.name)}" title="Total for ${esc(c.name)}. Changing it adds to or takes from Unallocated.">${linkBtn(id)}</div>
      <div class="b-act"><span class="m-lbl">Spent</span><button class="num spent-link" data-action="spent" data-id="${id}" title="See the transactions">${money(-g.activity)}</button></div>
      <div class="b-avl"><span class="m-lbl">Available</span><button class="pill st-${g.status}" data-action="move" data-id="${id}" aria-label="Available in all of ${esc(c.name)}: ${money(g.available)}. Move money in or out of its Unallocated.">${money(g.available)}</button></div>
    </div>`;
  }
  function unallocRow(id) {
    const r = D.month.rows[id], name = D.cats[id].name;
    const line = r.available < 0 ? `<span class="st over">In the red by ${money(-r.available)}</span><span class="tdesc">Raise ${poss(esc(name))} total, or take some back from a subcategory</span>` : '';
    return `<div class="brow leaf unalloc st-${r.status}" data-cat="${id}" data-own="1" role="row" style="--d:${D.tree.depth[id] + 1}">
      <div class="b-name"><span class="twisty-sp"></span><span class="cname muted" title="Money in ${esc(name)} not given to a subcategory">Unallocated</span>${tlineHTML(line)}</div>
      <div class="b-bar">${bar(r.parts)}</div>
      <div class="b-tgt"></div>
      <div class="b-asg"><label class="m-lbl" for="asg-${id}">Assigned</label><input id="asg-${id}" class="asg cents" inputmode="numeric" autocomplete="off" data-id="${id}" value="${box(r.assigned)}" aria-label="Unallocated in ${esc(name)}"></div>
      <div class="b-act"><span class="m-lbl">Spent</span><span class="num">${money(-r.activity)}</span></div>
      <div class="b-avl"><button class="pill st-${r.status}" data-action="move" data-id="${id}" aria-label="Unallocated in ${esc(name)}: ${money(r.available)}. Move money.">${money(r.available)}</button></div>
    </div>`;
  }

  function ownMoneyRow(id) {
    const r = D.month.rows[id], name = D.cats[id].name;
    return `<div class="brow leaf own st-${r.status}" data-cat="${id}" data-own="1" role="row" style="--d:${D.tree.depth[id] + 1}">
      <div class="b-name"><span class="twisty-sp"></span><span class="cname muted" title="${esc(name)} (not in a subcategory)">${esc(name)} (not in a subcategory)</span>
        ${tlineHTML(`<span class="tdesc">Money from before ${esc(name)} had subcategories. Set it to 0, or click the amount on the right to move it into a subcategory.</span>`)}</div>
      <div class="b-bar">${bar(r.parts)}</div>
      <div class="b-tgt"></div>
      <div class="b-asg"><label class="m-lbl" for="asg-${id}">Assigned</label><input id="asg-${id}" class="asg cents" inputmode="numeric" autocomplete="off" data-id="${id}" value="${box(r.assigned)}" aria-label="Assigned to ${esc(name)} itself"></div>
      <div class="b-act"><span class="m-lbl">Spent</span><span class="num">${money(-r.activity)}</span></div>
      <div class="b-avl"><button class="pill st-${r.status}" data-action="move" data-id="${id}" aria-label="Available in ${esc(name)} itself: ${money(r.available)}. Move money.">${money(r.available)}</button></div>
    </div>`;
  }
  function orphanRow(id) {
    const r = D.month.rows[id];
    return `<div class="brow leaf own st-${r.status}" role="row" style="--d:0">
      <div class="b-name"><span class="twisty-sp"></span><span class="cname muted">Deleted category</span>
        <div class="tline"><span class="tdesc">Still has money or transactions. Move its money and recategorize its transactions.</span></div></div>
      <div class="b-bar">${bar(r.parts)}</div>
      <div class="b-tgt"></div>
      <div class="b-asg"><span class="m-lbl">Assigned</span><span class="num">${money(r.assigned)}</span></div>
      <div class="b-act"><span class="m-lbl">Spent</span><span class="num">${money(-r.activity)}</span></div>
      <div class="b-avl"><button class="pill st-${r.status}" data-action="move" data-id="${id}">${money(r.available)}</button></div>
    </div>`;
  }

  async function setAssigned(id, input) {
    const total = input.dataset.mode === 'total';
    const cur = total ? D.month.roll[id].assigned : D.month.rows[id].assigned;
    const v = E.parseMoney(input.value);
    if (Number.isNaN(v)) { toast('Enter an amount, like 250.00.'); input.value = box(cur); return; }
    if (v === cur) { input.value = box(v); return; }
    const delta = v - cur;
    const map = { [id]: D.month.rows[id].assigned + delta };
    const src = D.tree.source(id); // the group whose Unallocated this comes from, if any
    if (src) map[src] = D.month.rows[src].assigned - delta;
    await putAssigned(UI.month, map);
  }

  // ---------- category sheet ----------
  function openCat(id) {
    let editingTarget = false, view = 'main';
    // More options: name, what it counts as, group, note, and the rarely used buttons
    const optionsPage = (c) => {
      const ownK = c.kind || '', par = c.parent ? kindOf(c.parent) : null, eff = ownK || par;
      const pa = payAcct(id), grp = c.parent && D.cats[c.parent] ? D.cats[c.parent].name : '';
      return `<button class="back-link" data-saction="back">${ICON.left} Back</button>
        <div class="field"><label for="cat-name">Name</label><input id="cat-name" value="${esc(c.name)}" autocomplete="off"></div>
        <div class="field"><label>Counts as</label>
          ${pa ? `<p class="hint">The minimum payment is a need; anything extra is freedom. <button class="linkish" data-saction="edit-acct">Set the minimum</button></p>`
            : `<div class="seg-ctl kind-ctl" role="group" aria-label="Counts as">${KINDS.map(([k]) => `<button data-saction="kind" data-v="${k}" aria-pressed="${eff === k}">${KIND_SHORT[k]}</button>`).join('')}</div>
            ${!ownK && par ? `<p class="fine">Same as ${esc(grp)}</p>` : ''}`}
        </div>
        <div class="field"><label for="cat-parent">Group</label><select id="cat-parent">${parentOptions(id, c.parent)}</select></div>
        <div class="field"><label for="cat-note">Note</label><textarea id="cat-note" rows="2" placeholder="Anything to remember">${esc(c.note || '')}</textarea></div>
        ${pa ? `<p class="hint">This pays ${esc(pa.name)}, so it stays while that's a card or loan.</p>` : `<div class="opt-btns">
          <button class="btn" data-saction="add-sub">${ICON.plus} Add subcategory</button>
          <button class="btn" data-saction="hide">${c.hidden ? 'Unhide' : 'Hide'}</button>
          <button class="btn danger" data-saction="delete">Delete</button>
        </div>`}`;
    };
    const paint = () => {
      D = snapshot();
      const c = D.cats[id];
      if (!c) { closeSheet(); return; }
      const leaf = D.tree.isLeaf(id);
      const pot = D.tree.isPot(id);
      const r = leaf ? D.month.rows[id] : null;
      const g = D.month.roll[id];
      const txs = D.tx.filter((t) => E.monthOf(t.date) === UI.month && E.txParts(t).some((p) => p.cat === id || (!leaf && E.descendants(D.tree, id).includes(p.cat))))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      const moves = S.moves(UI.month).filter((mv) => mv.from === id || mv.to === id);
      const pathTxt = D.tree.path[id].slice(0, -1).join(' › ');
      const title = $('#sheet-title'); if (title) title.textContent = c.name;
      if (view === 'more') { setSheetBody(optionsPage(c)); return; }
      // the opened row already shows Assigned, Spent and Available: only say something if it's in the red
      const num = leaf ? r : g;
      let html = `${pathTxt ? `<p class="crumb">In ${esc(pathTxt)}</p>` : ''}`;
      if ((leaf || pot) && num.available < 0) html += `<div class="cover-bar"><span>In the red by <b>${money(-num.available)}</b></span><button class="btn sm" data-saction="move">Cover it now</button></div>`;
      if (leaf || pot) {
        if (pot && g.targetShort > 0 && !editingTarget) html += `<div class="warn-box">The targets inside ${esc(c.name)} need ${money(g.kidsNeed)} this month, ${money(g.targetShort)} more than ${poss(esc(c.name))} own target.</div>`;
        html += editingTarget ? `<h3>Target</h3>${targetEditor(c, num)}` : targetCard(c, num);
      } else {
        html += `<p class="hint">A heading: its numbers are the totals of the categories under it.</p>`;
        const own = D.month.rows[id];
        if (own && (own.available || own.assigned)) html += `<div class="warn-box">${money(own.available)} is held in ${esc(c.name)} itself, from before it had subcategories. <div class="row-btns"><button class="btn sm primary" data-saction="move">Move it into a subcategory</button></div></div>`;
      }
      // 3. this month's spending: on a phone, one line that opens Transactions filtered to it
      if (isPhone()) {
        const spent = (leaf ? r : g).activity;
        html += `<button class="spent-row" data-saction="see-spent"><span class="sr-l"><span class="sr-lbl">Spent in ${esc(monthLabel(UI.month))}</span><span class="sr-n">${txs.length ? `${txs.length} ${txs.length === 1 ? 'transaction' : 'transactions'}` : 'Nothing yet'}</span></span><b class="sr-amt">${money(-spent)}</b><span class="sr-go" aria-hidden="true">${ICON.right}</span></button>`;
      } else html += `<h3>${esc(monthLabel(UI.month))}</h3>`;
      if (!isPhone()) html += txs.length ? `<ul class="mini-tx">${txs.slice(0, 40).map((t) => `<li><button data-saction="open-tx" data-id="${t.id}"><span>${esc(dateLabel(t.date))}</span><span>${esc(t.payee || t.bank || '—')}</span><b class="${t.amt > 0 ? 'pos' : ''}">${signed(partAmount(t, id, leaf))}</b></button></li>`).join('')}</ul>` : '<p class="hint">Nothing spent yet this month.</p>';
      if (moves.length) {
        html += `<h3>Money moved</h3><ul class="mini-tx">${moves.map((mv) => `<li><span>${esc(new Date(mv.ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span><span>${mv.from === id ? 'To ' + esc(catName(mv.to)) : 'From ' + esc(catName(mv.from))}</span><b>${mv.from === id ? '−' : '+'}${money(mv.amt)}</b></li>`).join('')}</ul>`;
      }
      // 4. everything else, folded away until it's wanted
      html += `<button class="more-toggle" data-saction="more">More options <span aria-hidden="true">${ICON.right}</span></button>`;
      setSheetBody(html);
    };
    const partAmount = (t, cid, leaf) => {
      const set = leaf ? [cid] : [cid].concat(E.descendants(D.tree, cid));
      return E.txParts(t).filter((p) => set.includes(p.cat)).reduce((s, p) => s + p.amt, 0);
    };
    openSheet({ title: 'Category', body: '', refresh: () => { if (!editingTarget) paint(); } });
    paint();
    sheet.actions = {
      'move': () => openMove(id),
      'see-spent': () => { closeSheet(); actions.spent({ dataset: { id } }); },
      more: () => { view = 'more'; paint(); const b = $('#sheet .sheet-b'); if (b) b.scrollTop = 0; },
      back: () => { view = 'main'; paint(); const b = $('#sheet .sheet-b'); if (b) b.scrollTop = 0; },
      kind: async (el) => {
        const c = D.cats[id], par = c.parent ? kindOf(c.parent) : null, v = el.dataset.v || null;
        // the same as the group, or tapping the chosen one again: follow the group
        const next = v === par || v === (c.kind || null) ? null : v;
        await putCat(Object.assign({}, c, { kind: next })); paint();
      },
      'add-sub': () => promptNewCat(id),
      'edit-acct': () => { const pa = payAcct(id); if (pa) openAcct(pa.id); },
      'open-tx': (el) => (isPhone() ? openTx(D.txById[el.dataset.id]) : startInline(el.dataset.id)),
      'sel-tx': (el) => startInline(el.dataset.id),
    'ie-save': async () => { await saveInline(true); render(); },
    'ie-cancel': () => { UI.editTx = null; UI.editDraft = null; render(); },
    'ie-delete': () => ieDelete(),
      'hide': async () => { const c = D.cats[id]; await putCat(Object.assign({}, c, { hidden: !c.hidden })); toast(c.hidden ? 'Category shown' : 'Category hidden. Its money still counts.'); paint(); },
      'delete': () => deleteCat(id),
      'edit-target': () => { editingTarget = true; paint(); },
      'cancel-target': () => { editingTarget = false; paint(); },
      'remove-target': async () => { await putCat(Object.assign({}, D.cats[id], { target: null })); editingTarget = false; paint(); },
      'save-target': async () => {
        const t = readTarget();
        if (!t) return;
        // a group's target has to cover its subcategories' targets
        const clash = E.checkTargets(D.tree, id, UI.month, { [id]: t });
        if (clash) { showTargetClash(id, t, clash); return; }
        await putCat(Object.assign({}, D.cats[id], { target: t }));
        editingTarget = false; toast('Target saved'); paint();
      },
      'raise-group': async (el) => {
        const gid = el.dataset.g, k = Number(el.dataset.k);
        await putCat(Object.assign({}, D.cats[gid], { target: Object.assign({}, D.cats[gid].target, { amount: k }) }));
        D = snapshot();
        sheet.actions['save-target']();
      },
      'use-min': () => { $('#t-amount').value = box(Number($('[data-saction="use-min"]').dataset.k)); previewTarget(id); sheet.actions['save-target'](); },
      'open-cat': (el) => openCat(el.dataset.id),
      'ttype': (el) => { $('#tgt-fields').innerHTML = targetFields(el.value, D.cats[id].target || {}); previewTarget(id); },
    };
    sheet.onInput = (el) => { if (el.closest('#tgt')) { previewTarget(id); const ck = $('#tgt-check'); if (ck) ck.innerHTML = ''; } };
    sheet.onChange = async (el) => {
      const c = D.cats[id];
      if (el.id === 'cat-name' && el.value.trim() && el.value.trim() !== c.name) {
        await putCat(Object.assign({}, c, { name: el.value.trim() }));
        const pa = payAcct(id);
        if (pa) await putAcct(Object.assign({}, pa, { name: el.value.trim() })); // a payment category and its account share a name
      }
      if (el.id === 'cat-note' && el.value !== (c.note || '')) await putCat(Object.assign({}, c, { note: el.value }));
      if (el.id === 'cat-parent') {
        const parent = el.value || null;
        const siblings = Object.values(D.cats).filter((x) => (x.parent || null) === parent);
        await putCat(Object.assign({}, c, { parent, order: siblings.reduce((m, x) => Math.max(m, x.order || 0), 0) + 1 }));
        paint();
      }
    };
  }

  function parentOptions(id, current) {
    const bad = new Set([id].concat(E.descendants(D.tree, id)));
    let out = `<option value="">(Top level)</option>`;
    for (const cid of D.tree.order) {
      if (bad.has(cid)) continue;
      out += `<option value="${cid}" ${cid === current ? 'selected' : ''}>${'  '.repeat(D.tree.depth[cid])}${esc(D.tree.path[cid].join(' › '))}</option>`;
    }
    return out;
  }

  // the category sheet's target, as a card: what it is, how this month is going, and the button to change it
  function targetCard(c, r) {
    if (payAcct(c.id) || !c.target || !r.target) {
      if (c.target && !payAcct(c.id)) return `<section class="tcard"><div class="tc-what">${targetLine(c.id, r) || ''}</div><button class="btn tc-btn" data-saction="edit-target">Edit target</button></section>`;
      if (payAcct(c.id)) return `<section class="tcard"><div class="tc-what">${targetLine(c.id, r) || '<span class="tdesc">No monthly amount set</span>'}</div><button class="btn tc-btn" data-saction="edit-target">${c.target ? 'Edit target' : 'Add a target'}</button></section>`;
      return `<section class="tcard empty"><p class="tc-big">No target yet</p><p class="tc-sub">Add one and YNABB works out how much ${esc(c.name)} needs each month.</p><button class="btn primary tc-btn" data-saction="edit-target">${ICON.plus} Add a target</button></section>`;
    }
    const t = c.target, ti = r.target, kind = (TTYPES.find((x) => x[0] === t.type) || [0, 'Target'])[1];
    const desc = targetLine(c.id, Object.assign({}, r, { available: Math.max(0, r.available) })).replace(/^.*?<span class="tdesc">/, '').replace(/<\/span>$/, '').replace(/<[^>]+>/g, '');
    let pct, line, status;
    if (t.type === 'goal') {
      pct = Math.max(0, Math.min(1, ti.pct || 0));
      line = `${Math.round(pct * 100)}% saved`;
    } else {
      pct = ti.need > 0 ? Math.max(0, Math.min(1, r.assigned / ti.need)) : 1;
      line = ti.need > 0 ? `${money(Math.min(r.assigned, ti.need))} of ${money(ti.need)} assigned this month` : 'Nothing needed this month';
    }
    if (ti.under > 0) status = `<span class="tc-st under">Needs ${money(ti.under)} more</span>`;
    else if (t.type === 'goal' && ti.remaining > 0 && !ti.need) status = `<span class="tc-st goal">${money(ti.remaining)} to go</span>`;
    else status = `<span class="tc-st ok">${t.type === 'goal' && ti.remaining <= 0 ? 'Goal reached' : t.type === 'cap' && !ti.need ? 'Full' : 'Funded'}</span>`;
    return `<section class="tcard">
      <p class="tc-kind">${esc(kind)}</p>
      <p class="tc-big">${esc(desc)}</p>
      <div class="tc-bar"><i style="width:${Math.round(pct * 100)}%" class="${ti.under > 0 ? 'under' : 'ok'}"></i></div>
      <div class="tc-line"><span>${esc(line)}</span>${status}</div>
      <button class="btn tc-btn" data-saction="edit-target">Edit target</button>
    </section>`;
  }
  function targetSummary(c, r) {
    if (!c.target) return `<p class="hint">No target. Add one and the app will tell you how much this category needs each month.</p><button class="btn" data-saction="edit-target">${ICON.plus} Add a target</button>`;
    return `<div class="tsum">${targetLine(c.id, r) || ''}</div><div class="row-btns"><button class="btn" data-saction="edit-target">Edit target</button></div>`;
  }

  const TTYPES = [
    ['refill', 'Bill that refills', 'Tops up to the same amount each month, ready for a bill that empties it. Good for phone, internet, rent.'],
    ['weekly', 'Set aside every week', 'The same amount each week on the day you choose. Months with five of that day ask for five lots. Good for groceries and pocket money.'],
    ['monthly', 'Set aside every month', 'Adds the same amount every month, no matter how much is already there.'],
    ['due', 'Payment due on a date', 'A set amount due on a date, once or repeating (quarterly, yearly). Splits it into monthly amounts.'],
    ['goal', 'Savings goal', 'Save toward a total. Money you spend from it still counts toward the goal. Add a date to get a monthly amount.'],
    ['cap', 'Build up to a limit', 'Adds a set amount each month until the category holds the limit, then stops asking.'],
  ];
  function targetEditor(c, r) {
    const t = c.target || {};
    const type = t.type || 'refill';
    return `<div id="tgt" class="tgt">
      <fieldset class="ttypes"><legend class="sr">Target type</legend>
        ${TTYPES.map(([v, l, d]) => `<label class="tt"><input type="radio" name="ttype" value="${v}" data-saction="ttype" ${v === type ? 'checked' : ''}><span><b>${l}</b><small>${d}</small></span></label>`).join('')}
      </fieldset>
      <div id="tgt-fields">${targetFields(type, t)}</div>
      <p id="tgt-preview" class="tprev"></p>
      <div id="tgt-check"></div>
      <div class="row-btns">
        <button class="btn primary" data-saction="save-target">Save target</button>
        <button class="btn" data-saction="cancel-target">Cancel</button>
        ${c.target ? '<button class="btn danger" data-saction="remove-target">Remove target</button>' : ''}
      </div>
    </div>`;
  }
  function targetFields(type, t) {
    const amt = (id, label, v) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" class="cents" inputmode="numeric" autocomplete="off" value="${v ? box(v) : ''}" placeholder="0.00"></div>`;
    switch (type) {
      case 'refill': return amt('t-amount', 'Refill to', t.amount) + `<div class="field"><label for="t-day">Bill is due on day (optional)</label><input id="t-day" type="number" min="1" max="31" inputmode="numeric" value="${t.day || ''}" placeholder="e.g. 19"></div>`;
      case 'monthly': return amt('t-amount', 'Amount each month', t.amount);
      case 'weekly': { const wd = t.type === 'weekly' ? t.day | 0 : 5; return amt('t-amount', 'Amount each week', t.amount) + `<div class="field"><label for="t-wday">Every</label><select id="t-wday">${WEEKDAYS.map((l, v) => [v, l]).slice(1).concat([[0, WEEKDAYS[0]]]).map(([v, l]) => `<option value="${v}" ${wd === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`; }
      case 'due': return amt('t-amount', 'Amount due', t.amount) + `<div class="field"><label for="t-due">Next due date</label><input id="t-due" type="date" value="${t.due || ''}"></div>
        <div class="field"><label for="t-every">Repeats</label><select id="t-every">${[[0, 'Does not repeat'], [1, 'Every month'], [2, 'Every 2 months'], [3, 'Every 3 months (quarterly)'], [4, 'Every 4 months'], [6, 'Every 6 months'], [12, 'Every year']].map(([v, l]) => `<option value="${v}" ${(t.every | 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
      case 'goal': return amt('t-amount', 'Goal total', t.amount) + `<div class="field"><label for="t-by">Reach it by (optional)</label><input id="t-by" type="date" value="${t.by || ''}"></div>`;
      case 'cap': return amt('t-amount', 'Add each month', t.amount) + amt('t-cap', 'Until it holds', t.cap);
    }
    return '';
  }
  function readTarget() {
    const type = ($('input[name="ttype"]:checked') || {}).value;
    if (!type) return null;
    const amount = E.parseMoney(($('#t-amount') || {}).value);
    if (!(amount > 0)) { toast('Enter an amount for the target.'); return null; }
    const t = { type, amount };
    if (type === 'refill') { const d = parseInt(($('#t-day') || {}).value, 10); if (d >= 1 && d <= 31) t.day = d; }
    if (type === 'weekly') t.day = parseInt($('#t-wday').value, 10) || 0;
    if (type === 'due') { t.due = $('#t-due').value; t.every = parseInt($('#t-every').value, 10) || 0; if (!t.due) { toast('Choose the date it is due.'); return null; } }
    if (type === 'goal') { if ($('#t-by').value) t.by = $('#t-by').value; }
    if (type === 'cap') { t.cap = E.parseMoney($('#t-cap').value); if (!(t.cap > 0)) { toast('Enter the limit to build up to.'); return null; } }
    return t;
  }
  function previewTarget(id) {
    const el = $('#tgt-preview');
    if (!el) return;
    const type = ($('input[name="ttype"]:checked') || {}).value;
    const amount = E.parseMoney(($('#t-amount') || {}).value);
    if (!type || !(amount > 0)) { el.textContent = ''; return; }
    const t = { type, amount, due: ($('#t-due') || {}).value, every: parseInt(($('#t-every') || {}).value, 10) || 0, by: ($('#t-by') || {}).value, cap: E.parseMoney(($('#t-cap') || {}).value) || 0, day: parseInt(($('#t-wday') || {}).value, 10) || 0 };
    const ti = E.targetInfo(t, D.tree.isPot(id) ? D.month.roll[id] : D.month.rows[id], UI.month);
    if (!ti) { el.textContent = ''; return; }
    let s;
    if (type === 'goal' && !t.by) s = `Progress so far: ${money(ti.funded)} of ${money(amount)}. No monthly amount until you add a date.`;
    else if (ti.done) s = 'That date is in the past.';
    else if (type === 'weekly') s = `This month has ${ti.weeks} ${WEEKDAYS[t.day]}s, so it needs ${money(ti.need)}${ti.under !== ti.need ? `, and ${money(ti.under)} of that is still to assign` : ''}.`;
    else s = `This month it needs ${money(ti.need)}${ti.under !== ti.need ? `, and ${money(ti.under)} of that is still to assign` : ''}.`;
    el.textContent = s;
  }

  const PER_MONTH = { refill: 1, monthly: 1, cap: 1 };
  function showTargetClash(id, t, clash) {
    const box = $('#tgt-check');
    if (!box) return;
    const g = clash.group, gname = esc(D.cats[g].name);
    const gt = g === id ? t : D.cats[g].target;
    if (g === id) {
      box.innerHTML = `<div class="warn-box">The targets inside ${gname} add up to <b>${money(clash.kidsMonthly)} a month</b>. ${poss(gname)} target has to be at least that.
        ${PER_MONTH[t.type] ? `<div class="row-btns"><button class="btn sm primary" data-saction="use-min" data-k="${clash.kidsMonthly}">Use ${money(clash.kidsMonthly)}</button></div>` : '<br>Raise the amount, or lower a target inside it.'}</div>`;
      return;
    }
    // this target would push the group's subcategory targets over the group's own target
    const others = [];
    (function collect(n) {
      for (const k of D.tree.children[n] || []) {
        const kt = k === id ? t : D.cats[k].target;
        if (kt && kt.type && k !== id) others.push(k);
        else if (!kt && !D.tree.isLeaf(k)) collect(k);
      }
    })(g);
    box.innerHTML = `<div class="warn-box">This brings the targets inside ${gname} to <b>${money(clash.kidsMonthly)} a month</b>, more than ${poss(gname)} own target of ${money(clash.groupMonthly)} a month.
      <div class="row-btns">${PER_MONTH[gt.type] ? `<button class="btn sm primary" data-saction="raise-group" data-g="${g}" data-k="${clash.kidsMonthly}">Raise ${poss(gname)} target to ${money(clash.kidsMonthly)}</button>` : `<button class="btn sm" data-saction="open-cat" data-id="${g}">Change ${poss(gname)} target</button>`}</div>
      ${others.length ? `Or lower another target in ${gname}:<ul class="mini-tx">${others.map((k) => `<li><button data-saction="open-cat" data-id="${k}"><span>${money(E.monthlyOf(D.cats[k].target, UI.month))}/mo</span><span>${esc(catPath(k))}</span><b>Change</b></button></li>`).join('')}</ul>` : ''}</div>`;
  }

  function promptNewCat(parent) {
    if (parent && payAcct(parent)) { toast('A payment category can\'t have subcategories.'); return; }
    const pc = parent ? D.cats[parent] : null;
    const r = parent ? D.month.rows[parent] : null;
    const hasMoney = pc && D.tree.isLeaf(parent) && r && (r.assigned || r.activity || r.available || D.tx.some((t) => E.txParts(t).some((p) => p.cat === parent)));
    const warn = !hasMoney ? '' : D.tree.depth[parent] >= 1
      ? `<p class="hint">${poss(esc(pc.name))} money becomes its Unallocated money. Its total stays the same.</p>`
      : `<p class="hint">${esc(pc.name)} already has money or transactions. They stay on a line called “${esc(pc.name)} (not in a subcategory)” until you move them.</p>`;
    openSheet({
      title: parent ? `New subcategory in ${pc.name}` : 'New category',
      body: `<div class="field"><label for="new-cat">Name</label><input id="new-cat" autocomplete="off" placeholder="${parent ? 'e.g. Electricity' : 'e.g. Bills'}"></div>${warn}`,
      foot: `<button class="btn primary" data-saction="create">Add</button>`,
    });
    setTimeout(() => $('#new-cat') && $('#new-cat').focus(), 50);
    const create = async () => {
      const name = $('#new-cat').value.trim();
      if (!name) { toast('Give the category a name.'); return; }
      const siblings = Object.values(D.cats).filter((x) => (x.parent || null) === (parent || null));
      const id = S.uid();
      await putCat({ id, name, parent: parent || null, order: siblings.reduce((m, x) => Math.max(m, x.order || 0), 0) + 1, hidden: false, target: null, note: '' });
      if (parent) delete UI.collapsed[parent];
      closeSheet();
      toast(`Added ${name}`);
      render();
    };
    sheet.actions = { create };
    sheet.onEnter = create;
  }

  async function moveCat(id, dir) {
    const c = D.cats[id];
    const sibs = (c.parent ? D.tree.children[c.parent] : D.tree.roots).slice();
    const i = sibs.indexOf(id), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    const items = {};
    sibs.forEach((sid, k) => { if ((D.cats[sid].order || 0) !== k + 1) items[sid] = { order: k + 1 }; });
    await guard(S.write('meta', 'cats', { items }));
  }

  function deleteCat(id) {
    const pa = payAcct(id);
    if (pa) { toast(`This pays ${pa.name}. It goes when that account is deleted or changed to another type.`); return; }
    const leaf = D.tree.isLeaf(id);
    if (!leaf) { toast('Move or delete its subcategories first.'); return; }
    const used = D.tx.some((t) => E.txParts(t).some((p) => p.cat === id));
    const hasMoney = Object.values(D.assigned).some((row) => row[id]);
    if (used || hasMoney) {
      openSheet({
        title: 'Delete category',
        body: `<p>${esc(catName(id))} has ${used ? 'transactions' : ''}${used && hasMoney ? ' and ' : ''}${hasMoney ? 'money assigned in some months' : ''}. Choose a category to receive them. Its history moves there too.</p>
          <div class="field"><label for="merge-into">Move everything to</label><select id="merge-into">${catOptions('', { exclude: id, income: false, forTx: true })}</select></div>`,
        foot: `<button class="btn danger" data-saction="merge">Move and delete</button>`,
      });
      sheet.actions = {
        merge: async () => {
          const to = $('#merge-into').value;
          if (!to) { toast('Choose a category.'); return; }
          const changed = [];
          for (const t of D.tx) {
            if (t.cat === id) changed.push(Object.assign({}, t, { cat: to }));
            else if (t.splits && t.splits.some((p) => p.cat === id)) changed.push(Object.assign({}, t, { splits: t.splits.map((p) => (p.cat === id ? Object.assign({}, p, { cat: to }) : p)) }));
          }
          if (changed.length) await putTxs(changed);
          for (const m in D.assigned) {
            const v = D.assigned[m][id];
            if (v) await putAssigned(m, { [id]: 0, [to]: (D.assigned[m][to] || 0) + v });
          }
          await guard(S.write('meta', 'cats', { items: { [id]: null } }));
          closeSheet(); toast('Category deleted'); render();
        },
      };
      return;
    }
    openSheet({
      title: 'Delete category',
      body: `<p>Delete ${esc(catName(id))}? It has no money or transactions.</p>`,
      foot: `<button class="btn danger" data-saction="yes">Delete</button><button class="btn" data-saction="no">Cancel</button>`,
    });
    sheet.actions = {
      yes: async () => { await guard(S.write('meta', 'cats', { items: { [id]: null } })); closeSheet(); toast('Category deleted'); render(); },
      no: closeSheet,
    };
  }

  // ---------- move money ----------
  function catOptions(selected, opts) {
    opts = opts || {};
    let out = opts.blank === false ? '' : `<option value="">${opts.blankLabel || 'Choose a category'}</option>`;
    // money held on a top-level heading or a deleted category can still be moved out
    const stray = selected && selected !== INCOME && D.month.rows[selected] && (!D.cats[selected] || (!D.tree.isLeaf(selected) && !D.tree.isPot(selected)));
    if (stray) {
      out += `<option value="${selected}" selected>${esc(D.cats[selected] ? 'Held in ' + D.tree.path[selected].join(' › ') : 'Deleted category')}${opts.avail ? ' · ' + money(D.month.rows[selected].available) : ''}</option>`;
    }
    if (selected === START) out += `<option value="${START}" selected>Starting balance owed</option>`;
    if (opts.income !== false) out += `<option value="${INCOME}" ${selected === INCOME ? 'selected' : ''}>Ready to Assign${opts.avail ? ' · ' + money(D.month.rta) : ''}</option>`;
    // on a card or loan, interest and fees go to its own payment category: they add to what's owed without touching the budget
    const ownPay = opts.forTx && opts.acct && D.debt[opts.acct];
    if (ownPay) out += `<option value="${ownPay}" ${selected === ownPay ? 'selected' : ''}>Interest or fees on this debt</option>`;
    // transactions can only go to real categories, never a group's Unallocated
    if (opts.forTx && selected && D.tree.isPot(selected)) {
      out += `<option value="${selected}" selected>${esc(D.tree.path[selected].join(' › '))} (unallocated): choose a subcategory</option>`;
    }
    for (const id of D.tree.order) {
      if (!D.tree.isLeaf(id) && !(D.tree.isPot(id) && !opts.forTx)) continue;
      const c = D.cats[id];
      if (id === opts.exclude) continue;
      if (c.hidden && id !== selected) continue;
      if (opts.forTx && c.debtFor && D.debt[c.debtFor] === id) continue; // paying a card is a transfer, not spending
      const a = opts.avail ? ' · ' + money(D.month.rows[id].available) : '';
      out += `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(catPath(id))}${a}</option>`;
    }
    return out;
  }
  const availOf = (id) => (id === INCOME ? D.month.rta : (D.month.rows[id] ? D.month.rows[id].available : 0));

  function openMove(id) {
    let from = '', to = '', amount = 0;
    const av = availOf(id);
    if (id === INCOME) { if (av < 0) { to = INCOME; amount = -av; } else { from = INCOME; } }
    else if (av < 0) { to = id; amount = -av; from = D.tree.source(id) || ''; }
    else {
      // tapping a category means putting money into it: from its group if it has one, otherwise Ready to Assign,
      // and as much as its target still asks for. The swap button turns it round to take money out.
      to = id;
      from = D.tree.source(id) || (availOf(INCOME) > 0 ? INCOME : '');
      const ti = D.month.rows[id] && D.month.rows[id].target;
      amount = ti && ti.under > 0 ? ti.under : 0;
    }
    openSheet({
      title: av < 0 && id !== INCOME ? 'Cover overspending' : 'Move money',
      body: `<div class="move">
        <div class="field"><label for="mv-amt">Amount</label><input id="mv-amt" class="cents" inputmode="numeric" autocomplete="off" value="${amount ? box(amount) : ''}" placeholder="0.00"></div>
        <div class="field"><label for="mv-from">Take from</label><select id="mv-from">${catOptions(from, { avail: true })}</select></div>
        <button class="icon-btn swap" data-saction="swap" aria-label="Swap from and to">${ICON.swap}</button>
        <div class="field"><label for="mv-to">Give to</label><select id="mv-to">${catOptions(to, { avail: true })}</select></div>
        <div id="mv-prev" class="mv-prev" aria-live="polite"></div>
      </div>`,
      foot: `<button class="btn primary" data-saction="go" id="mv-go">Move</button>`,
    });
    const preview = () => {
      const a = E.parseMoney($('#mv-amt').value), f = $('#mv-from').value, t = $('#mv-to').value;
      const box = $('#mv-prev');
      if (!f || !t || !(a > 0) || f === t) { box.innerHTML = '<p class="hint">Choose where the money comes from and where it goes. Every dollar you move has to come out of somewhere.</p>'; $('#mv-go').textContent = 'Move'; return; }
      const line = (cid, delta) => {
        const before = availOf(cid), after = before + delta;
        return `<div class="mv-line ${after < 0 ? 'bad' : ''}"><span>${esc(catPath(cid))}</span><span>${money(before)} <i aria-hidden="true">→</i> <b>${money(after)}</b></span></div>`;
      };
      let warn = '';
      const fAfter = availOf(f) - a;
      if (fAfter < 0) warn = `<p class="hint bad">${esc(catName(f))} will be ${f === INCOME ? 'negative' : 'overspent'} by ${money(-fAfter)}. You'd need to cover that from somewhere else.</p>`;
      const ct = D.cats[f] && D.cats[f].target && D.month.rows[f].target;
      if (ct && !warn && ct.type !== 'goal' && f !== INCOME) {
        const left = D.month.rows[f].assigned - a;
        if (left < ct.need) warn = `<p class="hint warn">${esc(catName(f))} will be ${money(ct.need - Math.max(0, left))} short of its target this month.</p>`;
      }
      box.innerHTML = line(f, -a) + line(t, a) + warn;
      $('#mv-go').textContent = `Move ${money(a)}`;
    };
    preview();
    setTimeout(() => (amount && !from ? $('#mv-from') : $('#mv-amt')).focus(), 50);
    sheet.onInput = preview;
    sheet.onChange = preview;
    sheet.actions = {
      swap: () => { const f = $('#mv-from'), t = $('#mv-to'); const x = f.value; f.value = t.value; t.value = x; preview(); },
      go: async () => {
        const a = E.parseMoney($('#mv-amt').value), f = $('#mv-from').value, t = $('#mv-to').value;
        if (!(a > 0)) { toast('Enter an amount to move.'); return; }
        if (!f || !t || f === t) { toast('Choose two different places.'); return; }
        const row = D.month.rows;
        const map = {};
        if (f !== INCOME) map[f] = (row[f] ? row[f].assigned : 0) - a;
        if (t !== INCOME) map[t] = (row[t] ? row[t].assigned : 0) + a;
        const mid = S.uid();
        await putAssigned(UI.month, map, { [mid]: { id: mid, from: f, to: t, amt: a, ts: Date.now(), by: myId() } });
        closeSheet();
        toast(`Moved ${money(a)} from ${catName(f)} to ${catName(t)}`);
        render();
      },
    };
    sheet.onEnter = sheet.actions.go;
  }

  async function autoAssign() {
    const plan = E.planAutoAssign(D.month);
    const n = Object.keys(plan.changes).length;
    if (!n) return;
    await putAssigned(UI.month, plan.changes);
    toast(plan.rtaUsed ? `Funded targets with ${money(plan.rtaUsed)} from Ready to Assign` : 'Funded targets from money already in their groups');
  }

  // ---------- transactions ----------
  function txSearchText(t) {
    const parts = [t.payee, t.bank, t.memo, t.date, dateLabel(t.date), acctName(t.acct), plain(Math.abs(t.amt)), plain(t.amt), String(Math.abs(t.amt) / 100)];
    for (const p of E.txParts(t)) { if (p.cat) parts.push(catPath(p.cat)); if (p.memo) parts.push(p.memo); }
    if (t.transfer) parts.push('transfer', acctName(t.transfer));
    if (!t.cat && !(t.splits && t.splits.length) && !t.transfer) parts.push('uncategorized');
    return parts.filter(Boolean).join(' ').toLowerCase();
  }
  function filteredTx() {
    // possible doubles sit next to each other: same amounts together, newest first
    if (UI.only) { const ids = new Set(UI.only); return D.tx.filter((t) => ids.has(t.id)).sort(UI.onlyWhat === 'double' ? (a, b) => a.amt - b.amt || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) : txSorter()); }
    const f = UI.f;
    const words = UI.q.trim().toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/^\$/, '').replace(/,/g, ''));
    let catSet = null;
    if (f.cat && f.cat !== '_none' && f.cat !== INCOME) catSet = new Set([f.cat].concat(E.descendants(D.tree, f.cat)));
    const min = f.min ? E.parseMoney(f.min) : null, max = f.max ? E.parseMoney(f.max) : null;
    return D.tx.filter((t) => {
      if (f.acct && t.acct !== f.acct) return false;
      if (!f.acct && !UI.rec && isTrack(t.acct)) return false; // All accounts means the budget's accounts, not tracking ones
      if (UI.rec && (t.acct !== UI.rec.acct || (!UI.recAll && t.cleared === 'r'))) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (min != null && Math.abs(t.amt) < min) return false;
      if (max != null && Math.abs(t.amt) > max) return false;
      if (f.cat === '_none' && (t.cat || (t.splits && t.splits.length) || t.transfer || isTrack(t.acct))) return false;
      if (f.cat === INCOME && !E.txParts(t).some((p) => p.cat === INCOME)) return false;
      if (catSet && !E.txParts(t).some((p) => catSet.has(p.cat))) return false;
      if (f.status === 'review' && t.approved !== false) return false;
      if (f.status === 'uncleared' && (t.cleared === 'c' || t.cleared === 'r')) return false;
      if (f.status === 'receipt' && !t.receipt) return false;
      if (f.status === 'noreceipt' && t.receipt) return false;
      if (words.length) { const s = txSearchText(t); if (!words.every((w) => s.includes(w))) return false; }
      return true;
    }).sort(txSorter());
  }
  // column sorting; ties fall back to newest first
  function txSorter() {
    const { k, dir } = UI.sort;
    const byDate = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0));
    if (k === 'date') return (a, b) => dir * -byDate(a, b);
    const val = {
      payee: (t) => (t.payee || t.bank || '').toLowerCase(),
      cat: (t) => (t.transfer ? 'transfer' : t.splits && t.splits.length ? 'split' : t.cat ? catName(t.cat) : '').toLowerCase(),
      acct: (t) => acctName(t.acct).toLowerCase(),
      bank: (t) => (t.bank || '').toLowerCase(),
      memo: (t) => (t.memo || '').toLowerCase(),
      amt: (t) => t.amt,
    }[k];
    if (!val) return byDate;
    return (a, b) => {
      const x = val(a), y = val(b);
      // blanks always go to the bottom
      if (x === '' && y !== '') return 1;
      if (y === '' && x !== '') return -1;
      return (x < y ? -dir : x > y ? dir : 0) || byDate(a, b);
    };
  }

  // small removable chips showing which filters are on
  function filterChips() {
    const f = UI.f, chips = [];
    const st = { review: 'Needs review', uncleared: 'Not yet cleared', receipt: 'Has a receipt', noreceipt: 'No receipt' };
    if (f.status) chips.push(['status', st[f.status]]);
    // a phone already names the account in the card above
    if (f.acct && !isPhone()) chips.push(['acct', 'Account: ' + acctName(f.acct)]);
    if (f.cat) chips.push(['cat', f.cat === '_none' ? 'Uncategorized' : f.cat === INCOME ? 'Ready to Assign (income)' : 'Category: ' + (D.tree.path[f.cat] ? D.tree.path[f.cat].join(' › ') : 'deleted')]);
    if (f.from) chips.push(['from', f.from === daysAgo(30) && !f.to ? 'Last 30 days' : 'From ' + dateLabel(f.from)]);
    if (f.to) chips.push(['to', 'To ' + dateLabel(f.to)]);
    if (f.min) chips.push(['min', 'At least ' + money(E.parseMoney(f.min))]);
    if (f.max) chips.push(['max', 'At most ' + money(E.parseMoney(f.max))]);
    if (!chips.length) return '';
    return `<div class="fchips">${chips.map(([k, l]) => `<button class="chip fchip" data-action="clear-one" data-k="${k}" title="Remove this filter">${esc(l)} <span aria-hidden="true">×</span></button>`).join('')}${chips.length > 1 ? '<button class="linkish" data-action="clear-filters">Clear all</button>' : ''}</div>`;
  }

  // big balance at the top: the filtered account, or every account added together
  function acctBalanceHead() {
    const rec = UI.rec && D.accounts[UI.rec.acct];
    const ids = rec ? [UI.rec.acct] : UI.f.acct && D.accounts[UI.f.acct] ? [UI.f.acct] : Object.keys(D.accounts).filter((id) => !isTrack(id));
    if (!ids.length) return '';
    const sum = (k) => ids.reduce((s, id) => s + ((D.bal[id] || {})[k] || 0), 0);
    const bal = sum('balance');
    const name = ids.length === 1 ? D.accounts[ids[0]].name : 'All accounts';
    const open = Object.values(D.accounts).filter((a) => !a.closed);
    // more than one account: the name is a drop-down to switch accounts
    const grp = (label, list) => (list.length ? `<optgroup label="${label}">${list.map((a) => `<option value="${a.id}" ${ids.length === 1 && ids[0] === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : '');
    const pick = !rec && open.length > 1
      ? `<span class="ah-pick"><span class="ah-pick-t">${esc(name)}</span>${ICON.down}<select id="ah-acct" class="ah-sel" data-live="0" aria-label="Show account"><option value="" ${ids.length > 1 ? 'selected' : ''}>All accounts</option>${grp('Bank accounts and cash', open.filter((a) => a.type !== 'tracking' && !DEBT_TYPES[a.type]))}${grp('Credit cards and loans', open.filter((a) => DEBT_TYPES[a.type]))}${grp('Tracking', open.filter((a) => a.type === 'tracking'))}</select></span>`
      : esc(name);
    // one account: green for a bank account, plum for a card or loan, grey for tracking
    const one = ids.length === 1 ? D.accounts[ids[0]] : null;
    const kind = !one ? 'all' : DEBT_TYPES[one.type] ? 'debt' : one.type === 'tracking' ? 'trk' : 'bank';
    const balHTML = kind === 'debt'
      ? `<div class="ah-name">${pick} <span>· ${bal < 0 ? 'owing' : bal > 0 ? 'in credit' : 'paid off'}</span></div><div class="ah-bal">${money(Math.abs(bal))}</div>`
      : `<div class="ah-name">${pick}</div><div class="ah-bal ${bal < 0 ? 'neg' : ''}">${money(bal)}</div>`;
    return `<div class="acct-head ah-${kind}">
        <div class="ah-main">${one ? `<span class="ah-ic">${acctIcon(one)}</span>` : ''}<div>${balHTML}</div></div>
        ${rec ? '' : `<div class="ah-rec">
          <button class="btn sm primary" data-action="rec-flow">${one && one.type === 'tracking' ? 'Update balance' : 'Import &amp; reconcile'}</button>
          ${ids.length === 1 ? `<span>${D.accounts[ids[0]].reconciledAt ? 'Last done ' + esc(dateLabel(D.accounts[ids[0]].reconciledAt)) : 'Never reconciled'}</span>` : ''}
        </div>`}
      </div>${UI.dbl ? dblPanel() : UI.bc ? bcPanel() : ''}`;
  }
  // what to look at first when it doesn't add up
  // approved, with its own bank line: two of these are separate purchases, not a double-up
  const settled = (x) => !!x.bank && x.approved !== false && !x.match;
  // the date written in a transaction's own bank text ("V1234 05/06 …" is 5 June), in the year nearest its date
  function descDate(t) {
    const dm = E.dayMonth((t.bank || '') + ' ' + (t.memo || ''));
    if (!dm) return null;
    const [d, m] = dm.split('/').map(Number), y = +String(t.date).slice(0, 4);
    let best = null;
    for (const yy of [y - 1, y, y + 1]) {
      const iso = `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (Number.isNaN(Date.parse(iso)) || new Date(iso).getUTCDate() !== d) continue;
      if (!best || Math.abs(Date.parse(iso) - Date.parse(t.date)) < Math.abs(Date.parse(best) - Date.parse(t.date))) best = iso;
    }
    return best;
  }
  // a bank text date more than 5 days from the transaction's date: the date is probably wrong
  const dateOff = (t) => { const d = descDate(t); return d && Math.abs(Date.parse(d) - Date.parse(t.date)) > 5 * 864e5 ? d : null; };
  // pairs that look like the same purchase recorded twice
  // outBy: how far out reconcile is. Two lines that both came from the bank are normally two real purchases, but when the
  // account is out by exactly their amount and they name the same day and shop, the same line was imported twice.
  function recPairs(acct, outBy) {
    const byAmt = {};
    D.tx.forEach((t) => { if (t.acct === acct) (byAmt[t.amt] = byAmt[t.amt] || []).push(t); });
    const out = [], twice = [];
    for (const k in byAmt) {
      const g = byAmt[k];
      if (g.length < 2) continue;
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const x = g[i], y = g[j];
        const both = !!(x.ik && y.ik);
        if (both && !outBy) continue; // two lines from the bank are two real transactions
        if (x.pair && y.pair) continue;
        if ((x.notWith || []).includes(y.id) || (y.notWith || []).includes(x.id)) continue;
        const dx = descDate(x), dy = descDate(y);
        if (dx && dy && dayGap(dx, dy) > 1) continue; // their bank text names different days (a day apart is allowed: pending and final lines can differ)
        const exact = !!(dx && dx === dy), same = !!(dx && dy && dayGap(dx, dy) <= 1);
        const gap = dayGap(dx || x.date, dy || y.date);
        if (gap > 5) continue;
        // bank text can sit in the note after a 🔹 (from YNAB)
        const btxt = (t) => t.bank || (String(t.memo || '').split('\uD83D\uDD39')[1] || '').trim();
        const sk = (t) => E.shopKey(btxt(t).replace(/^\s*(POS|EFTPOS|V?\d{3,5})\s+[\d/:\s]*/i, ''));
        const sameWords = E.sameWords(btxt(x), btxt(y));
        if (!exact && !sameWords && btxt(x) && btxt(y) && sk(x) !== sk(y)) continue;
        if (both && !((exact && sk(x) === sk(y)) || (sameWords && gap <= 1))) continue;
        if (x.cleared === 'r' && y.cleared === 'r' && !dateOff(x) && !dateOff(y)) continue; // settled long ago
        const [a, b] = (x.ik ? 1 : 0) >= (y.ik ? 1 : 0) ? [x, y] : [y, x]; // the bank's copy first
        (both ? twice : out).push({ a, b, same, exact, gap, both, sameWords, day: dx || dy, day2: dy && dy !== dx ? dy : null });
      }
    }
    // the same line imported twice only counts when it explains how far out it is: one on its own,
    // or all of them together (an ATM $100 and a $0.01 both doubled leave it out by $99.99)
    const one = twice.filter((p) => Math.abs(p.a.amt) === Math.abs(outBy));
    out.push(...(one.length ? one : Math.abs(twice.reduce((n, p) => n + p.a.amt, 0)) === Math.abs(outBy || 0) ? twice : []));
    return out.sort((p, q) => (q.same ? 1 : 0) - (p.same ? 1 : 0) || (p.a.date < q.a.date ? 1 : -1));
  }
  function recFlags(acct) {
    const flags = {};
    const flag = (t, short, long, ids) => (flags[t.id] = flags[t.id] || []).push([short, long, ids]);
    for (const p of recPairs(acct)) {
      flag(p.a, 'Doubled?', `Possibly the same as ${p.b.payee || p.b.bank || 'another'} on ${dateLabel(p.b.date)}`, [p.a.id, p.b.id]);
      flag(p.b, 'Doubled?', `Possibly the same as ${p.a.payee || p.a.bank || 'another'} on ${dateLabel(p.a.date)}`, [p.a.id, p.b.id]);
    }
    return flags;
  }
  // the details worth keeping from t when it goes and k stays
  function carryInto(k, t) {
    k = Object.assign({}, k);
    if (!k.cat && !(k.splits && k.splits.length) && (t.cat || (t.splits && t.splits.length)) && (!t.splits || t.amt === k.amt)) { k.cat = t.cat || null; k.splits = t.splits || null; }
    const note = String(t.memo || '').replace(/\s*\uD83D\uDD39.*$/, '').trim(); // leave out bank text kept in the note
    if (note && !String(k.memo || '').includes(note)) k.memo = k.memo ? `${k.memo} · ${note}` : note;
    if (t.receipt && !k.receipt) { k.receipt = t.receipt; k.receiptType = t.receiptType || null; }
    if (t.payee && (!k.payee || (k.bank && k.payee === tidyPayee(k.bank)))) k.payee = t.payee; // your own name beats one made from the bank text
    if (!k.bank && t.bank) k.bank = t.bank;
    if (k.ik && t.ik) k.iks = (k.iks || []).concat(t.ik, t.iks || []).filter((x, i, l) => x !== k.ik && l.indexOf(x) === i);
    return k;
  }
  // shift- or ⌘-clicked rows: the main selection plus these
  const picked = () => (UI.multi && UI.multi.length ? [UI.sel].concat(UI.multi).filter((x, i, l) => x && D.txById[x] && l.indexOf(x) === i) : []);
  // which of two to keep: the bank's own copy (its final line over a pending "POS" one), then one with bank text, then the first one clicked
  function keeperOf(x, y) {
    const rank = (t) => (t.ik ? 4 : 0) + (t.bank ? 2 : 0) - (E.isPending(t.bank) ? 1 : 0);
    return rank(y) > rank(x) ? [y, x] : [x, y];
  }
  // a transfer typed by hand and the bank's own line for it: [bank, typed], or null
  // (the typed one may already hold a bank line too, when the bank sent the same line twice: it keeps both keys)
  const xferPair = (x, y) => (x.ik && !x.pair && y.pair ? [x, y] : y.ik && !y.pair && x.pair ? [y, x] : null);
  function mergeProblem(x, y) {
    if (x.acct !== y.acct) return "They're in different accounts.";
    if ((x.pair || y.pair) && !xferPair(x, y)) return 'One is a transfer. Delete the extra one instead.';
    return '';
  }
  function selectAll() {
    const ids = filteredTx().map((t) => t.id);
    if (!ids.length) return;
    if (UI.editTx) { UI.editTx = null; UI.editDraft = null; }
    UI.sel = ids[0]; UI.multi = ids.slice(1); UI.delAsk = null; render();
  }
  function multiBar() {
    const ids = picked();
    if (ids.length < 2) return '';
    const ts = ids.map((x) => D.txById[x]), total = ts.reduce((n, t) => n + t.amt, 0);
    let act = '';
    if (ids.length === 2) {
      const [k, d] = keeperOf(ts[0], ts[1]), bad = mergeProblem(k, d);
      const note = bad || (k.amt !== d.amt ? `The amounts differ: keeps ${signed(k.amt)}${k.ik ? ' from the bank' : ''}.` : xferPair(k, d) ? `Keeps your transfer with the bank's details.` : k.ik && d.ik ? 'Both came from the bank, so check they really are the same purchase.' : `Keeps the ${k.ik ? "bank's copy" : 'copy'} from ${dateLabel(k.date)} with the category, note and payee from both.`);
      act = `<div class="mb-line mb-merge">${bad ? '' : `<button class="btn sm primary" data-action="multi-merge">Merge into one</button>`}<span class="mb-note${bad ? ' bad' : ''}">${esc(note)}</span></div>`;
    }
    const toOk = ts.filter((t) => t.match || t.approved === false), noCat = toOk.filter((t) => !t.match && !t.cat && !(t.splits && t.splits.length) && !t.transfer && !isTrack(t.acct)).length;
    const ok = toOk.length ? `<button class="btn sm${act ? '' : ' primary'}" data-action="multi-approve" title="${noCat ? `${noCat} of them ${noCat === 1 ? 'has' : 'have'} no category yet` : ''}">${ICON.tick} Approve ${toOk.length === ids.length ? 'all ' : ''}${toOk.length}</button>${noCat && !isPhone() ? `<span class="mb-warn">${noCat} with no category</span>` : ''}` : '';
    const del = UI.multiDel ? `<span class="mb-warn">Delete all ${ids.length}?</span><button class="btn sm danger" data-action="multi-del-yes">Yes, delete</button><button class="btn sm" data-action="multi-del-no">Keep them</button>` : `<button class="btn sm" data-action="multi-del">Delete</button>`;
    // on a phone the change-all fields stay folded away until asked for
    const edit = !isPhone() || UI.mbEdit;
    return `<div id="multi-bar" role="region" aria-label="Selected transactions">
      ${isPhone() ? '' : `<div class="mb-line mb-head"><b>${ids.length} selected</b><span class="muted">${signed(total)}</span><button class="btn sm mb-x" data-action="multi-clear">Clear</button></div>`}
      ${act}
      <div class="mb-line mb-acts">${ok}${del}${isPhone() ? `<button class="btn sm mb-more" data-action="multi-edit" aria-expanded="${edit}">${edit ? 'Hide changes' : 'Change all…'}</button>` : ''}</div>
      ${edit ? `<div class="mb-line mb-edit">
        <span class="mb-f"><input id="mb-payee" data-payee="1" ${isPhone() ? 'readonly ' : ''}placeholder="New payee for all" autocomplete="off" data-live="0" aria-label="Payee for all of them"><button class="btn sm" data-action="multi-payee">Set payee</button></span>
        <span class="mb-f"><select id="mb-cat" aria-label="Category for all of them"><option value="">Set category for all&hellip;</option>${catOptions('', { blank: false, forTx: true })}</select></span>
        <span class="mb-f mb-n"><input id="mb-note" placeholder="Note" autocomplete="off" data-live="0" aria-label="Note for all of them"><span class="mb-nb"><button class="btn sm" data-action="multi-note" data-how="set">Replace notes</button><button class="btn sm" data-action="multi-note" data-how="add">Add to notes</button></span></span>
      </div>` : ''}</div>`;
  }
  // change every picked transaction at once: one undo step
  async function multiChange(fn, what) {
    const ts = picked().map((x) => D.txById[x]), out = [];
    let skipped = 0;
    for (const t of ts) { const n = fn(Object.assign({}, t)); if (n) out.push(n); else skipped++; }
    if (!out.length) { toast(`None of them can take a ${what}.`); return; }
    S.newStep(); await putTxs(out); S.newStep();
    toast(`Changed the ${what} on ${out.length}${skipped ? `. Left ${skipped} ${skipped === 1 ? 'transfer or split' : 'transfers or splits'} alone` : ''}. ${MAC ? '⌘Z' : 'Ctrl+Z'} to undo.`);
    render();
  }
  async function mergePair(aId, bId) {
    const a = D.txById[aId], b = D.txById[bId];
    if (!a || !b) return;
    const keep = carryInto(a, b);
    S.newStep(); await putTxs([keep], [b]); S.newStep();
    toast(`Merged into one: kept the ${a.ik ? "bank's " : ''}copy from ${dateLabel(a.date)} with the details from both. ${MAC ? '⌘Z' : 'Ctrl+Z'} to undo.`);
    render();
  }
  // keeps the bank's line, made into the transfer you typed (the other account's side moves onto it)
  async function mergeXfer(bank, typed) {
    const plan = recFixPlan({ kind: 'transfer', ts: [typed], bs: [bank] });
    S.newStep(); await putTxs(plan.puts, plan.removes); S.newStep();
    toast(`Merged into one: your transfer ${bank.amt < 0 ? 'to' : 'from'} ${acctName(typed.transfer)} now has the bank's details. ${MAC ? '⌘Z' : 'Ctrl+Z'} to undo.`);
    render();
  }
  async function notDouble(aId, bId) {
    const a = D.txById[aId], b = D.txById[bId];
    if (!a || !b) return;
    await putTxs([Object.assign({}, a, { notWith: (a.notWith || []).concat(bId) }), Object.assign({}, b, { notWith: (b.notWith || []).concat(aId) })]);
    render();
  }
  function dblPanel() {
    const acct = UI.rec ? UI.rec.acct : UI.f.acct;
    if (!acct || !D.accounts[acct]) return '';
    const pairs = recPairs(acct);
    const x = '<button class="rb-x" data-action="dbl-close" aria-label="Close" title="Close">&times;</button>';
    if (!pairs.length) return `<div class="bc-panel dp"><header><b>Possible doubles</b>${x}</header><div class="bc-ok"><b>None left</b><span>Nothing in ${esc(acctName(acct))} looks like it's been counted twice.</span></div></div>`;
    const src = (t) => (t.ik ? 'From a bank import' : t.bank ? 'Entered by hand, with bank text' : 'Entered by hand') + (t.cleared === 'r' ? ' · reconciled' : '');
    const side = (t) => `<button class="dp-side" data-action="dbl-see" data-id="${t.id}" title="Show it in the list"><small>${src(t)}</small>
      <span class="dp-top"><b>${esc(dateLabel(t.date))}</b><b class="${t.amt > 0 ? 'pos' : ''}">${signed(t.amt)}</b></span>
      <span>${esc(t.payee || 'No payee')}${t.cat ? ` · <span class="muted">${esc(catName(t.cat))}</span>` : t.splits && t.splits.length ? ' · <span class="muted">split</span>' : ' · <span class="warn">no category</span>'}</span>
      ${t.memo ? `<span class="dp-note">${esc(t.memo)}</span>` : ''}${t.bank ? `<span class="dp-bank">${esc(t.bank)}</span>` : ''}</button>`;
    return `<div class="bc-panel dp"><header><b>${pairs.length} possible ${pairs.length === 1 ? 'double' : 'doubles'} in ${esc(acctName(acct))}</b>${x}</header>
      <p class="hint">Each pair has the same amount close together. <b>Merge into one</b> keeps the bank's copy and adds the category, note and payee from the other. <b>Not a double</b> stops this pair being suggested again.</p>
      <ol class="dp-list">${pairs.map((p) => `<li class="dp-card${p.same ? ' strong' : ''}">
        <p class="dp-why">${p.exact ? `<b>Very likely:</b> the same amount, and both bank descriptions say <b>${esc(dateLabel(p.day))}</b>.` : p.same ? `<b>Likely:</b> the same amount, and the bank descriptions are a day apart (${esc(dateLabel(p.day))} and ${esc(dateLabel(p.day2))}). That happens when a pending POS line becomes the final card line.` : `The same amount, ${p.gap < 1 ? 'on the same day' : `${Math.round(p.gap)} ${Math.round(p.gap) === 1 ? 'day' : 'days'} apart`}.`}</p>
        <div class="dp-two">${side(p.a)}${side(p.b)}</div>
        <div class="dp-act">${(p.a.pair || p.b.pair) && !xferPair(p.a, p.b) ? '<span class="hint">One is a transfer, so delete the extra one by hand if they are the same.</span>' : `<button class="btn sm primary" data-action="dbl-merge" data-a="${p.a.id}" data-b="${p.b.id}">Merge into one</button>`}<button class="btn sm" data-action="dbl-not" data-a="${p.a.id}" data-b="${p.b.id}">Not a double</button></div></li>`).join('')}</ol></div>`;
  }
  // the last day the bank's balance covers: the bank file's last day, or today when the balance was typed in.
  // Anything dated later (a bill booked ahead) isn't at the bank yet, so it isn't counted.
  const recCutoff = () => (UI.rec && UI.rec.from) || E.todayISO();
  // transactions in the account being reconciled that still wait for approval
  const recWaiting = () => (UI.rec ? D.tx.filter((t) => t.acct === UI.rec.acct && t.date <= recCutoff() && checkOf(t)) : []);
  // reconciled once it matches the bank and everything is approved: no Finish button to remember
  // checked each time the reconcile card is drawn, so any change that settles it (approving, fixing, the balance) finishes it
  async function recAutoFinish() {
    if (UI.recFinishing || !UI.rec || !D.accounts[UI.rec.acct] || recState().diff || recWaiting().length) return;
    UI.recFinishing = true;
    try { await recFinish(0); } finally { UI.recFinishing = false; }
  }
  function recState() {
    const r = UI.rec, cut = recCutoff(), total = D.tx.filter((t) => t.acct === r.acct && t.date <= cut).reduce((s, t) => s + t.amt, 0);
    return { total, diff: r.bank - total };
  }
  // while reconciling, the top of the page is just the two numbers that matter, side by side
  // While reconciling, the page is just this: a coloured card with one message, then a checklist of what's waiting.
  function recCard() {
    const r = UI.rec, { total, diff } = recState(), debt = isDebt(r.acct), waiting = recWaiting();
    if (!diff && !waiting.length) setTimeout(recAutoFinish, 0);
    const show = (v) => money(debt ? -v : v), gap = money(Math.abs(diff));
    const res = diff && !waiting.length ? recDiff() : null;
    const big = diff ? `Out by ${gap}` : waiting.length ? `${waiting.length} to check` : 'Matches &#10003;';
    let sub = diff ? `YNABB has ${gap} ${diff < 0 ? 'more' : 'less'} than the bank.${waiting.length ? ' Check the list below first.' : ''}`
      : waiting.length ? "The totals match the bank. Approve these and it's reconciled." : '';
    let act = '';
    if (res && !res.start) act = '<button class="btn sm" data-action="rec-flow-import">Import your bank file</button>';
    else if (res && !res.items.length) act = `<button class="linkish rc-adj" data-action="rec-adjust">Can't find it? Add a ${gap} adjustment</button>`;
    return `<div class="rc ${diff ? 'off' : waiting.length ? 'wait' : 'ok'}">
        <div class="rc-top"><span>Reconciling <b>${esc(acctName(r.acct))}</b></span><button class="rb-x" data-action="rec-stop" aria-label="Stop reconciling" title="Stop reconciling">&times;</button></div>
        <div class="rc-big">${big}</div>
        ${sub ? `<p class="rc-sub">${sub}</p>` : ''}
        <div class="rc-nums">
          <label class="rc-fig"><span>${debt ? 'Bank says you owe' : 'Bank'}${r.from ? ` · ${esc(dateLabel(r.from))}` : ''}</span><span class="rc-edit">$<input id="rec-bank-live" class="cents" inputmode="decimal" autocomplete="off" data-live="0" value="${esc(money(debt ? -r.bank : r.bank).replace('$', ''))}" aria-label="Bank balance" title="Tap to change it if it doesn't match your banking app"></span></label>
          <div class="rc-fig"><span>YNABB</span><b>${show(total)}</b></div>
        </div>
        ${act ? `<div class="rc-act">${act}</div>` : ''}
      </div>`;
  }
  // the checklist: what's waiting, under headings, most worth a look first
  const CHECK_ORDER = ['amount', 'extra', 'double', 'fix', 'date', 'joined', 'parts', 'swap', 'hold', 'nocat', 'update', 'match', 'new'];
  const CHECK_HEAD = { fix: 'Edited Since Your Last Reconcile', double: 'Possible Matches', amount: 'Different Amount', date: 'Different Date', joined: 'Paid in One Go', parts: 'Charged in Parts', swap: 'Might Be Swapped', hold: 'Hold Released', extra: 'No Matching Bank Transaction', nocat: 'Needs a Category', update: 'Gone Through', match: 'Perfect Matches', new: 'New Transactions' };
  // what they are, then what ticking does, said once under each heading
  const CHECK_HINT = {
    fix: ["These matched the bank, then someone changed the amount in YNABB.", "Tick to put back the bank's amount."],
    double: ["The same amount, but too far apart for YNABB to be sure they're the same.", 'Tick to match them as one.'],
    amount: ["The bank's amount is different from the manual one.", "Tick to match using the bank's amount."],
    date: ["The bank's date is different from the manual one.", "Tick to match using the bank's date."],
    joined: ['Manually entered as separate transactions, paid by the bank as one.', 'Tick to match them as one.'],
    parts: ['Manually entered as one transaction, paid by the bank in parts.', 'Tick to match.'],
    swap: ["Same amount, close dates: YNABB couldn't tell which is which.", ''],
    hold: ['A pending hold the bank has since let go of.', 'Tick to remove the hold.'],
    extra: ['Entered manually, but no matching bank transaction was found.', 'Tap the cross to delete it. Open it if you need to keep it.'],
    nocat: ["YNABB couldn't guess these from your past choices.", 'Tap one to choose its category.'],
    update: ['These were pending and have now gone through.', "Tick if it's the same purchase."],
    match: ['Same amount and date as the manual entry.', 'Tick if they look right.'],
    new: ['From the bank, not entered manually. Category picked from your past choices.', 'Tick if they look right.'],
  };
  const PEN = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.6l2.8 2.8L7.2 15.6 3.8 16.2l.6-3.4 9.2-9.2z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M11.8 5.4l2.8 2.8" stroke="currentColor" stroke-width="1.6"/></svg>';
  function recView() {
    const groups = {};
    // the same amount in twice close together: often the whole gap. Only looked for while it's out.
    // and while it's out, entries typed by hand that don't line up with the bank's: under the heading that fits
    const out = !!recState().diff, items = out ? recDiff().items : [];
    UI.recItems = items;
    const ritems = {}, inItem = new Set(items.flatMap((it) => it.ts.concat(it.bs).map((t) => t.id)));
    items.forEach((it, i) => (ritems[RD_SEC[it.kind]] = ritems[RD_SEC[it.kind]] || []).push(i));
    const gone = extraFit(items);
    const pairs = out ? recPairs(UI.rec.acct, recState().diff).filter((p) => !inItem.has(p.a.id) && !inItem.has(p.b.id)) : [];
    const inPair = new Set(pairs.flatMap((p) => [p.a.id, p.b.id]));
    // a waiting row that's part of one of those sits only there, till it's sorted, so nothing shows twice
    recWaiting().filter((t) => !inPair.has(t.id) && !inItem.has(t.id)).forEach((t) => (groups[checkOf(t)[0]] = groups[checkOf(t)[0]] || []).push(t));
    const sec = (k) => {
      const l = k === 'double' ? pairs : (groups[k] || []).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      const ri = (ritems[k] || []).sort((a, b) => (gone.mark && gone.mark.has(b) ? 1 : 0) - (gone.mark && gone.mark.has(a) ? 1 : 0)), n = l.length + ri.length;
      if (!n) return '';
      const bulk = (k === 'match' || k === 'new') && l.length > 1;
      const rows = ri.map((i) => rdRow(items[i], i, gone.mark)).join('') + l.map(k === 'double' ? dblRow : chkRow).join('');
      const body = k === 'swap' ? (ri.length ? `<div class="ck-list">${ri.map((i) => rdRow(items[i], i)).join('')}</div>` : '') + swapCards(l) : `<div class="ck-list">${rows}</div>`;
      // what the group means stays tucked away behind the little ? until asked for
      const info = !!(UI.ckInfo && UI.ckInfo[k]);
      return `<section class="ck-sec"><header class="ck-h"><b>${CHECK_HEAD[k]}</b><span class="ck-n">${n}</span>${bulk ? `<button class="btn sm primary ck-all" data-action="chk-all" data-k="${k}">${ICON.tick} All ${l.length}</button>` : ''}<button class="ck-i${info ? ' on' : ''}" data-action="ck-info" data-k="${k}" aria-expanded="${info}" aria-label="What these are" title="What these are">?</button></header>
        ${info ? `<p class="ck-hint">${CHECK_HINT[k].filter(Boolean).map(esc).join('<br>')}</p>` : ''}${k === 'extra' ? gone.html : ''}${body}</section>`;
    };
    const search = !UI.ckFind ? `<button class="linkish ck-findlink" data-action="ck-find">${ICON.search} Search past transactions</button>` : `<div class="search ck-q"><span aria-hidden="true">${ICON.search}</span><input id="ckq" type="search" data-live="0" placeholder="Search past transactions" value="${esc(UI.ckQ || '')}" aria-label="Search past transactions" autocomplete="off" enterkeyhint="search"></div>${pastSearch()}`;
    return recCard() + search + `<div class="ck">${CHECK_ORDER.map(sec).join('')}</div>`;
  }
  // two matches with the same amount and close dates: shown as a pair, right way round or swapped
  const swapPartner = (t, l) => l.find((o) => o !== t && o.amt === t.amt && gapDays(o.date, t.date) <= 10);
  function swapCards(l) {
    const done = new Set();
    return l.map((t) => {
      if (done.has(t.id)) return '';
      const o = swapPartner(t, l.filter((x) => !done.has(x.id)));
      done.add(t.id); if (o) done.add(o.id);
      // each half opens like any other row: manual vs bank, then Keep Separate or edit
      const pr = (x) => {
        const open = UI.ckOpen === x.id;
        return `<button class="ck-pr" data-action="chk-peek" data-id="${x.id}" aria-expanded="${open}" title="${open ? 'Show less' : 'Show the details'}"><span class="ck-p">${esc(x.payee || 'No payee')}</span><span class="ck-bk"><small>Bank</small>${esc(tidyPayee(x.match.bank))}</span><b>${esc(money(Math.abs(x.amt)))}</b></button>
          ${open ? `<div class="ck-more ck-pmore">${chkCompare(x, 'swap')}<div class="ck-btns"><button class="btn sm" data-action="unmatch" data-id="${x.id}">Keep Separate</button><button class="btn sm ck-pen" data-action="chk-open" data-id="${x.id}" aria-label="Edit" title="Edit">${PEN}</button></div></div>` : ''}`;
      };
      return `<div class="ck-list ck-pair">${pr(t)}${o ? pr(o) : ''}
        <div class="ck-btns">${o ? `<button class="btn sm primary" data-action="chk-pair-ok" data-a="${t.id}" data-b="${o.id}">${ICON.tick} Right Way Round</button><button class="btn sm" data-action="chk-swap" data-a="${t.id}" data-b="${o.id}">&#8644; ${t.match.swapped ? 'Swap Back' : 'Swap Them'}</button>` : `<button class="btn sm primary" data-action="approve" data-id="${t.id}">${ICON.tick} Match</button>`}</div></div>`;
    }).join('');
  }
  // the opened row: what was entered and what the bank says, one line each
  function chkCompare(t, k) {
    const m = t.match, p = (m && m.prev) || {};
    const row = (lbl, name, sub, amt) => `<div class="ck-cr"><span class="ck-cl">${lbl}</span><span class="ck-cn">${name}<small>${esc(sub)}</small></span><b>${esc(money(Math.abs(amt)))}</b></div>`;
    const typedRow = (x, i) => row(i ? '' : 'Manual', `${esc(x.payee || t.payee || 'No payee')}${x.memo ? ` · <i>${esc(x.memo)}</i>` : ''}`, dateLabel(x.date), x.amt);
    let html = '';
    if (m && m.fix) html += `<p class="ck-why">This matched the bank at ${esc(money(Math.abs(t.amt)))} when you last reconciled. Since then it was edited to ${esc(money(Math.abs(p.amt)))} in YNABB.</p>` + row('Edited to', esc(t.payee || ''), dateLabel(t.date), p.amt);
    else if (m && m.kind === 'update') html += row('Pending', `<span class="mono">${esc(p.bank || '')}</span>`, dateLabel(t.date), p.amt != null ? p.amt : t.amt);
    else if (m) html += ('amt' in p ? [{ payee: t.payee, memo: p.memo, date: p.date, amt: p.amt }].concat(p.absorbed || []) : [t]).map(typedRow).join('');
    else if (t.memo) html += `<p class="ck-why"><i>${esc(t.memo)}</i></p>`;
    html += row('Bank', `<span class="mono">${esc((m ? m.bank : t.bank) || 'No bank description')}</span>`, dateLabel(m ? m.date : t.date), t.amt);
    if (m && m.how === 'parts') html += `<p class="ck-why">The rest of it came in as its own line.</p>`;
    return html;
  }
  // the opened row's buttons, in words; editing is the pencil
  function chkButtons(t, k) {
    const edit = `<button class="btn sm ck-pen" data-action="chk-open" data-id="${t.id}" aria-label="Edit" title="Edit">${PEN}</button>`;
    const keep = `<button class="btn sm" data-action="unmatch" data-id="${t.id}">Keep Separate</button>`;
    const yes = (label) => `<button class="btn sm primary" data-action="approve" data-id="${t.id}">${ICON.tick} ${esc(label)}</button>`;
    if (k === 'fix') return yes(`Put Back ${money(Math.abs(t.amt))}`) + edit;
    if (!t.match) return yes('Looks Right') + edit;
    const label = { amount: `Match · Use Bank's ${money(Math.abs(t.amt))}`, date: `Match · Use Bank's Date (${dateLabel(t.date)})`, joined: `Match as One ${money(Math.abs(t.amt))}`, update: 'Same Purchase' }[k] || 'Match';
    return yes(label) + keep + edit;
  }
  const catLabel = (t) => (t.transfer ? `Transfer ${t.amt < 0 ? 'to' : 'from'} ${acctName(t.transfer)}` : t.splits && t.splits.length ? `Split: ${t.splits.map((p) => (p.cat ? catName(p.cat) : 'Uncategorized')).join(', ')}` : t.cat === INCOME ? 'Ready to Assign' : t.cat ? catName(t.cat) : '');
  // past transactions, to see with your own eyes what a shop was called and categorised as before
  function pastList(list, more) {
    if (!list.length) return '<p class="ck-past-none">Nothing found.</p>';
    return list.map((x) => `<div class="ck-past-r"><span class="ck-p">${esc(x.payee || tidyPayee(x.bank) || 'No payee')}</span><b class="${x.amt > 0 ? 'pos' : ''}">${txAmt(x.amt)}</b>
      <span class="ck-c${catLabel(x) ? '' : ' none'}">${esc(catLabel(x) || 'Uncategorized')} · ${esc(dateLabel(x.date))}</span>${x.bank ? `<small class="mono">${esc(x.bank)}</small>` : ''}</div>`).join('') + (more ? `<p class="ck-past-none">${more}</p>` : '');
  }
  const pastTx = () => { const w = new Set(recWaiting().map((x) => x.id)); return D.tx.filter((x) => !w.has(x.id)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); };
  function pastSearch() {
    const words = fold(UI.ckQ).split(' ').filter(Boolean);
    if (!words.length) return '';
    const hits = pastTx().filter((x) => { const h = fold(`${x.payee} ${x.bank} ${x.memo}`); return words.every((w) => h.includes(w)); });
    return `<div class="ck-past">${pastList(hits.slice(0, 10), hits.length > 10 ? `Showing the latest 10 of ${hits.length}.` : '')}</div>`;
  }
  function chkRow(t) {
    const [k, line] = checkOf(t);
    const cat = catLabel(t);
    const name = esc(t.payee || tidyPayee(t.bank) || 'No payee');
    // a row that needs a category: tap anywhere on it to choose one (the list slides up on a phone)
    if (k === 'nocat') return `<div class="ck-row nocat" data-row="${t.id}">
        <div class="ck-main"><span class="ck-l1"><span class="ck-p">${name}</span><span class="ck-a ${t.amt > 0 ? 'pos' : ''}">${txAmt(t.amt)}</span></span>
          <span class="ck-c none">Choose a Category · ${esc(dateLabel(t.date))}</span>${t.bank ? `<span class="ck-b mono">${esc(t.bank)}</span>` : ''}</div>
        <select class="ck-catsel" data-ck-cat="${t.id}" aria-label="Choose a Category">${catOptions('', { blankLabel: 'Choose a Category', forTx: true, acct: t.acct })}</select>
      </div>`;
    const open = UI.ckOpen === t.id;
    // the amount is said in the line underneath when that's what differs
    const amtUp = !['amount', 'fix', 'joined'].includes(k);
    return `<div class="ck-row${open ? ' open' : ''}" data-row="${t.id}">
        <button class="ck-main" data-action="chk-peek" data-id="${t.id}" aria-expanded="${open}" title="${open ? 'Show less' : 'Show the details'}">
          <span class="ck-l1"><span class="ck-p">${name}</span>${amtUp ? `<span class="ck-a ${t.amt > 0 ? 'pos' : ''}">${txAmt(t.amt)}</span>` : ''}</span>
          <span class="ck-c">${esc(cat || 'Uncategorized')}${k === 'date' ? '' : ` · ${esc(dateLabel(t.date))}`}</span>
          ${k === 'match' || k === 'new' ? '' : `<span class="ck-d">${esc(line)}</span>`}
        </button>
        <div class="ck-side"><button class="ck-tick" data-action="approve" data-id="${t.id}" aria-label="${esc(CHECK_HINT[k][1] || 'Approve')}" title="${esc(CHECK_HINT[k][1] || 'Approve')}">${ICON.tick}</button></div>
        ${open ? `<div class="ck-more">${chkCompare(t, k)}<div class="ck-btns">${chkButtons(t, k)}</div></div>` : ''}
      </div>`;
  }
  // a possible double in the checklist: one row for the pair, tick to merge, open it to see both
  function dblRow(p) {
    const key = `dbl:${p.a.id}:${p.b.id}`, open = UI.ckOpen === key;
    const can = !((p.a.pair || p.b.pair) && !xferPair(p.a, p.b));
    const xf = xferPair(p.a, p.b), name = esc((xf && xf[1].payee) || p.a.payee || p.b.payee || tidyPayee(p.a.bank || p.b.bank) || 'No payee');
    const who = (t) => (t.ik ? 'Bank' : 'Manual'), when = `${who(p.b)} ${dateLabel(p.b.date)} → ${who(p.a)} ${dateLabel(p.a.date)}`;
    const half = (t) => `<div class="ck-cr"><span class="ck-cl">${t.ik ? 'Bank' : 'Manual'}</span><span class="ck-cn">${esc(t.payee || 'No payee')} · ${esc(catLabel(t) || 'Uncategorized')}${t.memo ? ` · <i>${esc(t.memo)}</i>` : ''}<small>${esc(dateLabel(t.date))}${t.cleared === 'r' ? ' · reconciled' : ''}</small>${t.bank ? `<small class="mono">${esc(t.bank)}</small>` : ''}</span><b>${esc(money(Math.abs(t.amt)))}</b></div>`;
    const why = p.both ? `Both came from bank files ${p.day ? `and say ${dateLabel(p.day)}` : 'with the same words'}, and that explains how far out it is: the bank sent the same line twice.`
      : p.exact ? `Both bank descriptions say ${dateLabel(p.day)}.` : p.same ? "The bank descriptions are a day apart. That happens when a pending line becomes the final one." : '';
    const keep = `<button class="btn sm" data-action="dbl-not" data-a="${p.a.id}" data-b="${p.b.id}">Not the Same</button>`;
    return `<div class="ck-row${open ? ' open' : ''}">
        <button class="ck-main" data-action="chk-peek" data-id="${key}" aria-expanded="${open}" title="${open ? 'Show less' : 'Show both'}">
          <span class="ck-l1"><span class="ck-p">${name}</span><span class="ck-a ${p.a.amt > 0 ? 'pos' : ''}">${txAmt(p.a.amt)}</span></span>
          <span class="ck-c">${esc(catLabel(p.a) || catLabel(p.b) || 'Uncategorized')}</span>
          <span class="ck-d">${esc(when)}</span>
        </button>
        <div class="ck-side">${can ? `<button class="ck-tick" data-action="dbl-merge" data-a="${p.a.id}" data-b="${p.b.id}" aria-label="Match them as one" title="Match them as one">${ICON.tick}</button>` : ''}</div>
        ${open ? `<div class="ck-more">${half(p.a)}${half(p.b)}${why ? `<p class="ck-why">${esc(why)}</p>` : ''}<p class="ck-why">${xf ? "Matching keeps your transfer and adds the bank's details." : can ? `Matching keeps ${p.a.ik ? "the bank's copy" : 'one'} and adds the category, note and payee from the other.` : 'One is a transfer, so delete the extra one by hand if they are the same.'}</p>
          <div class="ck-btns">${can ? `<button class="btn sm primary" data-action="dbl-merge" data-a="${p.a.id}" data-b="${p.b.id}">${ICON.tick} Match</button>` : ''}${keep}</div></div>` : ''}
      </div>`;
  }
  // ---------- why reconcile doesn't match ----------
  // Compares what was typed by hand with the bank's own lines, and explains the gap one plain item at a time.
  // Nothing changes until a button is pressed; each fix is one ⌘Z step.
  const gapDays = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const shiftDay = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
  const flatText = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  // a typed payee whose first real word shows up in the bank line ("Brownes Bakery" in "V1234 03/10 BROWNES BAKERY")
  function sameShop(t, b) {
    const w = String(t.payee || '').toLowerCase().split(/[^a-z0-9]+/).find((x) => x.length >= 3 && !/^(the|and|for|from|with|pay|nab|transfer)$/.test(x));
    return !!w && flatText((b.bank || '') + ' ' + (b.payee || '')).includes(w.slice(0, 6));
  }
  // the amount the bank gave a line when it was imported (it's part of the import key)
  const ikAmt = (t) => { const p = String(t.ik || '').split('|'); return p.length >= 5 && p[1] !== 'f' && /^-?\d+$/.test(p[2]) ? Number(p[2]) : null; };
  // two or three of the list that add up to exactly the amount
  function sumOf(list, amt) {
    const n = Math.min(list.length, 25);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      if (list[a].amt + list[b].amt === amt) return [list[a], list[b]];
      for (let c = b + 1; c < n; c++) if (list[a].amt + list[b].amt + list[c].amt === amt) return [list[a], list[b], list[c]];
    }
    return null;
  }
  function recDiff() {
    const r = UI.rec, acct = r.acct, cut = recCutoff(), skip = UI.recSkip || {};
    const rows = ((S.items('bankrows')[acct] || {}).rows || []).map((x) => { const [d, a, ...rest] = x.split('|'); return { d, amt: Number(a), desc: rest.join(' ') }; }).filter((x) => x.d <= cut);
    const start = rows.length ? rows[0].d : null;
    const mine = D.tx.filter((t) => t.acct === acct);
    const items = [], used = new Set(), done = new Set();
    const add = (kind, ts, bs, extra) => { items.push(Object.assign({ kind, ts, bs }, extra || {})); ts.forEach((t) => done.add(t.id)); bs.forEach((b) => used.add(b.id)); };
    // changed in YNABB after it came from the bank
    for (const t of mine) {
      const was = ikAmt(t);
      if (was != null && was !== t.amt && !skip[t.id]) add('edited', [t], [], { was });
    }
    // a pending hold the bank file no longer shows
    if (start) for (const t of mine) {
      if (!t.ik || !E.isPending(t.bank) || t.date < start || t.date >= cut || done.has(t.id) || skip[t.id]) continue;
      if (rows.some((x) => x.amt === t.amt && /^POS\b/i.test(x.desc) && gapDays(x.d, t.date) <= 2)) continue;
      const w = flatText(tidyPayee(t.bank)).slice(0, 6);
      const fin = mine.find((b) => b !== t && b.ik && !E.isPending(b.bank) && b.date >= t.date && gapDays(b.date, t.date) <= 14 && w.length >= 4 && flatText(b.bank).includes(w));
      add('hold', [t], [], { fin });
    }
    if (!start) return { items, start, cut, future: mine.filter((t) => t.date > cut) };
    // typed by hand, not reconciled; and the bank's own lines they could be
    const typed = mine.filter((t) => !t.ik && t.cleared !== 'r' && !done.has(t.id) && t.date >= shiftDay(start, -10) && !/^(starting balance|reconciliation adjustment)$/i.test(t.payee || ''));
    const bank = mine.filter((b) => b.ik && !done.has(b.id) && b.date >= shiftDay(start, -10) && b.date <= cut);
    const ok = (t) => !done.has(t.id) && !skip[t.id];
    // "Not the same" rules out just that pairing
    const free = (b, t) => !used.has(b.id) && !(t && skip[t.id + '|' + b.id]);
    // the same amount: counted twice. far: the date typed wrong (1 Nov for 1 Oct, 2025 for 2026), which only
    // pairs with a line not reconciled yet: pay and bills repeat, and last fortnight's pay is not this one
    const sameAmt = (far) => {
      for (const t of typed) {
        if (!ok(t)) continue;
        let best = null, sc = 1e9;
        for (const b of bank) {
          if (!free(b, t) || b.amt !== t.amt || b.pair) continue;
          const g = gapDays(t.date, b.date), sim = sameShop(t, b);
          if (far ? !(sim && b.cleared !== 'r' && (g <= 62 || Math.abs(g - 365) <= 3)) : g > 10) continue;
          const v = g - (sim ? 20 : 0) + (b.match ? 30 : 0); // a line already matched to another entry comes last
          if (v < sc) { best = b; sc = v; }
        }
        if (best) add(t.pair ? 'transfer' : 'same', [t], [best]);
      }
    };
    // 1. the same amount within ten days
    sameAmt(false);
    // 2. one order the bank took in parts, or several entries the bank took in one go
    for (const t of typed) {
      if (!ok(t) || t.pair) continue;
      const hit = sumOf(bank.filter((b) => free(b, t) && !b.pair && Math.sign(b.amt) === Math.sign(t.amt) && gapDays(t.date, b.date) <= 7 && sameShop(t, b)), t.amt);
      if (hit) add('parts', [t], hit.sort((x, y) => (x.date < y.date ? -1 : 1)));
    }
    for (const b of bank) {
      if (!free(b) || b.pair) continue;
      const hit = sumOf(typed.filter((t) => ok(t) && free(b, t) && !t.pair && Math.sign(b.amt) === Math.sign(t.amt) && gapDays(t.date, b.date) <= 3 && sameShop(t, b)), b.amt);
      if (hit) add('joined', hit, [b]);
    }
    // 3. a transfer typed with a different amount
    for (const t of typed) {
      if (!ok(t) || !t.pair) continue;
      // the bank line says it's a transfer, or names the other account ("Savings")
      const other = flatText((D.accounts[t.transfer] || {}).name).replace(/^nab/, '');
      const says = (x) => /transfer|online|tfr/i.test(x.bank || '') || (other.length >= 4 && flatText(x.bank).includes(other));
      const b = bank.find((x) => free(x, t) && !x.pair && Math.sign(x.amt) === Math.sign(t.amt) && gapDays(t.date, x.date) <= 3 && says(x));
      if (b) add('transfer', [t], [b]);
    }
    // 4. the same shop around the same day, with a different amount (a typo, a tip, a fuel hold, a pay rise)
    for (const t of typed) {
      if (!ok(t) || t.pair) continue;
      let best = null, sc = 1e9;
      for (const b of bank) {
        if (!free(b, t) || b.pair || Math.sign(b.amt) !== Math.sign(t.amt) || !sameShop(t, b)) continue;
        const g = gapDays(t.date, b.date), ratio = Math.abs(b.amt / t.amt);
        if (g > 7 || ratio < 0.4 || ratio > 2.5) continue;
        if (g < sc) { best = b; sc = g; }
      }
      if (best) add('amount', [t], [best]);
    }
    // 5. the same amount with the date typed wrong
    sameAmt(true);
    // 6. typed, inside the bank file's dates, with nothing at the bank
    for (const t of typed) if (ok(t) && t.date >= start && t.date <= cut) add('extra', [t], []);
    // what each one adds to the gap (only days the bank balance covers count)
    const cnt = (t) => (t.date <= cut ? t.amt : 0);
    items.forEach((it) => { it.effect = it.kind === 'edited' ? cnt(it.ts[0]) - (it.ts[0].date <= cut ? it.was : 0) : it.ts.reduce((n, t) => n + cnt(t), 0); });
    const inItems = new Set(items.flatMap((it) => it.ts.map((t) => t.id)));
    return { items, start, cut, future: mine.filter((t) => t.date > cut && !inItems.has(t.id)) };
  }
  // what a fix changes: { puts, removes }
  function recFixPlan(it) {
    const [t] = it.ts, approvedIf = (k) => (k.cat || (k.splits && k.splits.length) || k.transfer ? Object.assign(k, { approved: true }) : k);
    if (it.kind === 'edited') return t.splits && t.splits.length ? null : { puts: [Object.assign({}, t, { amt: it.was })], removes: [] };
    if (it.kind === 'hold') return { puts: [], removes: [t] };
    // a transfer goes from both accounts, or the other side is left behind on its own
    if (it.kind === 'extra') return { puts: [], removes: [t].concat(t.pair && D.txById[t.pair] ? [D.txById[t.pair]] : []) };
    if (it.kind === 'same' || it.kind === 'amount') return { puts: [approvedIf(carryInto(it.bs[0], t))], removes: [t] };
    if (it.kind === 'parts') return { puts: it.bs.map((b) => approvedIf(carryInto(b, Object.assign({}, t, { splits: null })))), removes: [t] };
    if (it.kind === 'transfer') {
      const b = it.bs[0], p = D.txById[t.pair];
      const k = Object.assign(carryInto(b, Object.assign({}, t, { cat: null })), { payee: t.payee || b.payee, transfer: t.transfer, pair: p ? p.id : null, cat: null, splits: null, approved: true }); // your transfer's name, not the bank's
      return { puts: p ? [k, Object.assign({}, p, { amt: -b.amt, pair: b.id, date: b.date })] : [k], removes: [t] };
    }
    if (it.kind === 'joined') {
      const b = it.bs[0], cats = [...new Set(it.ts.map((x) => x.cat || null))];
      const k = Object.assign({}, b, { payee: it.ts[0].payee || b.payee, memo: [b.memo].concat(it.ts.map((x) => x.memo)).filter(Boolean).join(' · ') || null });
      if (cats.length === 1 && cats[0]) Object.assign(k, { cat: cats[0], splits: null });
      else if (it.ts.every((x) => x.cat)) Object.assign(k, { cat: null, splits: it.ts.map((x) => ({ cat: x.cat, amt: x.amt, memo: x.memo || undefined })) });
      return { puts: [approvedIf(k)], removes: it.ts };
    }
    return null;
  }
  async function recFix(list) {
    const puts = {}, removes = {};
    let n = 0;
    for (const it of list) {
      const p = recFixPlan(it);
      if (!p) continue;
      n++;
      p.puts.forEach((x) => (puts[x.id] = x));
      p.removes.forEach((x) => (removes[x.id] = x));
    }
    if (!n) return;
    S.newStep(); await putTxs(Object.values(puts), Object.values(removes)); S.newStep();
    const { diff } = recState();
    const word = list.every((it) => it.kind === 'extra') ? 'Deleted' : 'Fixed';
    toast(`${n === 1 ? word : `${word} ${n}`}. ${diff ? `Still out by ${money(Math.abs(diff))}.` : 'It matches the bank now.'}`, { label: 'Undo', fn: () => undoRedo(false) });
    render();
  }
  // would deleting the entries with no bank transaction make it match? All of them, or exactly one mix of them
  function extraFit(items) {
    const ex = items.map((it, i) => (it.kind === 'extra' ? i : -1)).filter((i) => i >= 0), none = { html: '', mark: null };
    if (!ex.length) return none;
    const { diff } = recState(), eff = ex.map((i) => items[i].effect), n = ex.length;
    const all = eff.reduce((a, b) => a + b, 0), left = diff + all;
    const btn = (is, label) => `<button class="btn sm danger" data-action="rd-fix-many" data-is="${is.join(',')}">${ICON.cross} ${label}</button>`;
    const line = (cls, text, b) => ({ html: `<div class="ck-fit ${cls}"><span>${text}</span>${b || ''}</div>` });
    if (!left) return Object.assign(line('ok', `Deleting ${n === 1 ? 'it' : `all ${n}`} makes YNABB match the bank.`, btn(ex, n === 1 ? 'Delete It' : `Delete All ${n}`)), { mark: null });
    // up to 16 is quick to try every mix of; only say so when there's just one mix that works
    if (n > 1 && n <= 16) {
      let hit = null, hits = 0;
      for (let m = 1; m < (1 << n) - 1 && hits < 2; m++) {
        let sum = 0;
        for (let j = 0; j < n; j++) if (m & (1 << j)) sum += eff[j];
        if (diff + sum === 0) { hits++; hit = m; }
      }
      if (hits === 1) {
        const is = ex.filter((_, j) => hit & (1 << j)), c = is.length;
        return Object.assign(line('ok', `Deleting ${c === 1 ? 'the one marked' : `the ${c} marked`} makes YNABB match the bank.`, btn(is, c === 1 ? 'Delete It' : `Delete These ${c}`)), { mark: new Set(is) });
      }
      if (hits > 1) return Object.assign(line('', `Some of these add up to the gap in more than one way, so check them one by one.`), { mark: null });
    }
    // the other headings' fixes change the total too: say whether doing everything gets there
    const every = diff + items.reduce((a, it) => a + (it.kind === 'edited' && it.ts[0].splits && it.ts[0].splits.length ? 0 : it.effect), 0);
    // different amounts come first: once they're sorted, this line says whether deleting these closes the gap
    const amtLeft = items.some((it) => RD_SEC[it.kind] === 'amount');
    const also = amtLeft ? 'Sort out the Different Amounts above first. This updates as you go.' : every ? `Even with everything on this list fixed, it would be out by ${money(Math.abs(every))}.` : 'Fixing the rest of this list as well makes it match.';
    return Object.assign(line(every ? '' : 'ok', `Deleting ${n === 1 ? 'it' : `all ${n}`} leaves it out by ${money(Math.abs(left))}. ${also}`), { mark: null });
  }
  // which checklist heading each kind of mismatch goes under
  const RD_SEC = { same: 'double', amount: 'amount', transfer: 'amount', parts: 'parts', joined: 'joined', edited: 'fix', hold: 'hold', extra: 'extra' };
  // a mismatch as a checklist row: the tick does the fix, open it to see both sides and the other choice
  function rdRow(it, i, mark) {
    const [t] = it.ts, b = it.bs[0], mm = (x) => money(Math.abs(x)), key = `rd:${it.ts.concat(it.bs).map((x) => x.id).join(':')}`, open = UI.ckOpen === key;
    const fix = !(it.kind === 'edited' && t.splits && t.splits.length), del = it.kind === 'extra';
    const bd = b ? dateLabel(b.date) : '', ba = b ? mm(b.amt) : ''; // not every kind has a bank line
    const line = {
      same: `Manual ${dateLabel(t.date)} → Bank ${bd}`,
      amount: `Manual ${mm(t.amt)} → Bank ${ba}`,
      transfer: `Transfer: Manual ${mm(t.amt)} → Bank ${ba}`,
      parts: `Manual ${mm(t.amt)} · Bank charged it in parts`,
      joined: `Manual ${it.ts.map((x) => mm(x.amt)).join(' + ')} → Bank ${ba} in one payment`,
      edited: `Edited ${mm(t.amt)} → Bank ${mm(it.was)}`,
      hold: it.fin ? `Pending hold · final charge ${mm(it.fin.amt)}` : "Pending hold the bank's let go of",
      extra: 'No matching bank transaction found',
    }[it.kind];
    const half = (lbl, x, amt) => `<div class="ck-cr"><span class="ck-cl">${lbl}</span><span class="ck-cn">${esc(x.payee || tidyPayee(x.bank) || 'No payee')}${x.memo ? ` · <i>${esc(x.memo)}</i>` : ''}<small>${esc(dateLabel(x.date))}${E.isPending(x.bank) ? ' · pending' : ''}</small>${x.bank ? `<small class="mono">${esc(x.bank)}</small>` : ''}</span><b>${esc(mm(amt != null ? amt : x.amt))}</b></div>`;
    const sides = it.kind === 'hold' ? half('Bank hold', t) + (it.fin ? half('Final', it.fin) : '')
      : it.kind === 'edited' ? half('Bank', t, it.was) + half('YNABB', t)
      : it.ts.map((x) => half('Manual', x)).join('') + it.bs.map((x) => half('Bank', x)).join('');
    const yes = { same: 'Match', hold: 'Remove the Hold', extra: 'Delete' }[it.kind] || `Use the Bank's`;
    const no = { hold: 'Keep It', edited: 'Leave It', extra: 'Keep It' }[it.kind] || 'Not the Same';
    const tickAct = fix ? 'rd-fix' : 'rd-skip', tickLbl = fix ? yes : no;
    const amtUp = !['amount', 'transfer', 'edited', 'joined'].includes(it.kind);
    return `<div class="ck-row${open ? ' open' : ''}">
        <button class="ck-main" data-action="chk-peek" data-id="${key}" aria-expanded="${open}" title="${open ? 'Show less' : 'Show the details'}">
          <span class="ck-l1"><span class="ck-p">${esc(t.payee || tidyPayee(t.bank) || 'No payee')}</span>${amtUp ? `<span class="ck-a ${t.amt > 0 ? 'pos' : ''}">${txAmt(t.amt)}</span>` : ''}</span>
          <span class="ck-c">${esc(catLabel(t) || 'Uncategorized')}${it.kind === 'same' ? '' : ` · ${esc(dateLabel(t.date))}`}</span>
          ${del ? (mark && mark.has(i) ? `<span class="ck-d ck-fitd">${mark.size === 1 ? 'Deleting this makes it match' : 'Deleting this helps it match'}</span>` : '') : `<span class="ck-d">${esc(line)}</span>`}
        </button>
        <div class="ck-side"><button class="ck-tick${del ? ' ck-del' : ''}" data-action="${tickAct}" data-i="${i}" aria-label="${esc(tickLbl)}" title="${esc(tickLbl)}">${del ? ICON.cross : ICON.tick}</button></div>
        ${open ? `<div class="ck-more">${sides}<div class="ck-btns">${del ? `<button class="btn sm danger" data-action="rd-fix" data-i="${i}">${ICON.cross} Delete</button><button class="btn sm" data-action="rd-skip" data-i="${i}">Keep It</button>` : fix ? `<button class="btn sm primary" data-action="rd-fix" data-i="${i}">${ICON.tick} ${esc(yes)}</button><button class="btn sm" data-action="rd-skip" data-i="${i}">${esc(no)}</button>` : `<button class="btn sm primary" data-action="rd-skip" data-i="${i}">${ICON.tick} ${esc(no)}</button>`}</div></div>` : ''}
      </div>`;
  }

  async function recFinish(adjust) {
    const r = UI.rec, a = D.accounts[r.acct];
    const cut = recCutoff();
    const list = D.tx.filter((t) => t.acct === r.acct && t.cleared !== 'r' && t.date <= cut).map((t) => Object.assign({}, t, { cleared: 'r' }));
    if (adjust) list.push({ id: S.uid(), acct: r.acct, date: cut, payee: 'Reconciliation adjustment', cat: INCOME, amt: adjust, cleared: 'r', memo: 'Added to make the balance match the bank', by: myId() });
    S.newStep(); await putTxs(list); S.newStep();
    await putAcct(Object.assign({}, a, { reconciledAt: cut, reconciledBalance: r.bank }));
    UI.recSkip = null;
    UI.rec = null; saveUI();
    UI.only = null; UI.f = Object.assign(NO_FILTERS(), { acct: a.id }); // stay on the account just reconciled
    toast(`${a.name} is reconciled ✓`); render();
  }
  // a tracking account's new value: the gap is gains or losses, so it goes in as one adjustment, like YNAB.
  // Everything up to today is locked in, as there's no bank file to match it against.
  async function updateValue(acct, value) {
    const a = D.accounts[acct], cut = E.todayISO();
    const mine = D.tx.filter((t) => t.acct === acct && t.date <= cut), gap = value - mine.reduce((s, t) => s + t.amt, 0);
    const list = mine.filter((t) => t.cleared !== 'r').map((t) => Object.assign({}, t, { cleared: 'r' }));
    if (gap) list.push({ id: S.uid(), acct, date: cut, payee: 'Reconciliation adjustment', cat: null, amt: gap, cleared: 'r', memo: 'Change in value', by: myId() });
    S.newStep(); await putTxs(list); S.newStep();
    await putAcct(Object.assign({}, a, { reconciledAt: cut, reconciledBalance: value }));
    UI.rec = null; UI.only = null; UI.f = Object.assign(NO_FILTERS(), { acct }); UI.view = 'tx'; saveUI();
    toast(gap ? `${a.name} is now ${money(value)}: ${gap > 0 ? 'up' : 'down'} ${money(Math.abs(gap))}.` : `${a.name} is still ${money(value)}.`, { label: 'Undo', fn: () => undoRedo(false) });
    render();
  }
  // start reconciling an account against the bank's balance; from = the bank file's date it was read from
  function startRec(acct, bank, from) {
    UI.rec = { acct, bank, from: from || null }; UI.recAll = false; UI.only = null; UI.recSkip = null;
    UI.f = Object.assign(NO_FILTERS(), { acct }); UI.q = ''; UI.showFilters = false; UI.view = 'tx'; saveUI(); render(); window.scrollTo(0, 0);
  }
  // the account the import & reconcile panel starts on: the one being shown, or the last one used
  function flowAcct(id) {
    const ok = (x) => x && D.accounts[x] && !D.accounts[x].closed;
    return ok(id) ? id : ok(UI.f.acct) ? UI.f.acct : ok(UI.lastImport) ? UI.lastImport : undefined;
  }
  function viewTx() {
    if (UI.rec && D.accounts[UI.rec.acct]) return recView();
    const list = filteredTx();
    const total = list.reduce((s, t) => s + t.amt, 0);
    const f = UI.f;
    const activeFilters = Object.values(f).filter(Boolean).length;
    const review = f.status === 'review';
    const reviewable = review ? list.filter((t) => t.approved === false && !t.match && (t.cat || (t.splits && t.splits.length) || t.transfer || isTrack(t.acct))).length : 0;
    const updates = review ? list.filter((t) => t.match && t.match.kind === 'update').length : 0;
    const matches = review ? list.filter((t) => t.match && t.match.kind !== 'update').length : 0;
    const shown = list.slice(0, UI.limit);
    // a phone groups the list under date headings, so rows don't each repeat their date
    const byDay = isPhone() && UI.sort.k === 'date';
    REC_FLAGS = UI.rec && D.accounts[UI.rec.acct] ? recFlags(UI.rec.acct) : UI.bc ? bcFlags() : {};
    // nothing left to check in this filtered view: go back to the full list
    if (UI.only && !list.some((t) => (UI.onlyWhat === 'double' ? twinIds(t.id) : REC_FLAGS[t.id]))) {
      UI.only = null;
      setTimeout(() => toast(UI.onlyWhat === 'double' ? 'No possible doubles left there. Back to the full list.' : 'Nothing left to check there. Back to the full list.'), 0);
      return viewTx();
    }
    const toReview = review ? 0 : D.tx.filter((t) => t.approved === false).length;
    // showing just the uncategorised ones and none are left: say so and go back to the full list
    if (f.cat === '_none' && !list.length && !UI.q && !UI.only) {
      UI.f = Object.assign({}, f, { cat: '' }); saveUI();
      setTimeout(() => toast('Everything has a category ✓'), 0);
      return viewTx();
    }
    // a strip at the top while anything still needs a category (the reconcile card has its own while reconciling)
    const uncat = UI.rec || f.cat === '_none' ? 0 : D.tx.filter(isUncat).length;
    // one strip for what's still to do, each part a button that shows just those
    const todo = [];
    if (toReview && !UI.rec) todo.push(`<button class="chip" data-action="goto-review"><b>${toReview}</b> to review</button>`);
    if (uncat) todo.push(`<button class="chip" data-action="goto-uncat"><b>${uncat}</b> ${uncat === 1 ? 'needs' : 'need'} a category</button>`);
    const uncatBar = todo.length ? `<div class="todo-bar"><span>Still to do</span>${todo.join('')}</div>` : '';
    // the line under the search only when there's something to say: a filter, a search, or review buttons
    const nPicked = UI.sel ? 1 + (UI.multi || []).length : 0;
    // Select mode says what to do until two are picked; then the selection bar takes over
    // on a phone it always shows, as it holds the Select button
    const sumBits = activeFilters || UI.q || UI.only || matches || updates || (review && reviewable) || isPhone();
    const chips = UI.only ? `<button class="chip fchip" data-action="clear-only" title="Back to the full list">${UI.onlyWhat === 'balance' ? 'Could explain the difference' : 'Possible doubles'} only <span aria-hidden="true">×</span></button>` : filterChips();
    // a phone gets the chips on their own line, so the count and Select sit level underneath
    const phoneChips = isPhone() && chips ? `<div class="tx-fchips">${chips}</div>` : '';
    const selBtns = isPhone()
      ? (UI.pick ? `${list.length > 1 ? `<button class="btn sm" data-action="select-all">All ${list.length}</button>` : ''}<button class="btn sm primary" data-action="pick-mode">Done</button>` : '<button class="btn sm" data-action="pick-mode">Select</button>')
      : list.length > 1 && (activeFilters || UI.q || UI.only) ? `<button class="btn sm" data-action="select-all" title="${MAC ? '⌘' : 'Ctrl+'}A">Select all ${list.length}</button>` : '';
    return `${acctBalanceHead()}${uncatBar}
      <div class="tx-tools">
        <div class="tools-l">
          <button class="btn sm primary" data-action="add-tx" aria-label="Add a transaction">${ICON.plus}<span class="add-lbl"> Add</span></button>
          <div class="filt-wrap">
          <button class="btn sm ${UI.showFilters || activeFilters ? 'on' : ''}" data-action="toggle-filters" aria-expanded="${UI.showFilters}">Filters${activeFilters ? ` <b class="count">${activeFilters}</b>` : ''} ${ICON.down}</button>
      ${UI.showFilters ? `<div class="filters pop" role="dialog" aria-label="Filters">
            ${isPhone() ? `<div class="field"><span class="lbl">Each row shows</span><div class="seg-ctl tl-ctl" role="group" aria-label="Each row shows"><button data-action="tx-line" data-v="payee" aria-pressed="${txLine() === 'payee'}">Payee</button><button data-action="tx-line" data-v="note" aria-pressed="${txLine() === 'note'}">Note</button></div></div>` : ''}
            <div class="field"><label for="f-acct">Account</label><select id="f-acct" data-filter="acct" data-live="0"><option value="">All accounts</option>${Object.values(D.accounts).map((a) => `<option value="${a.id}" ${f.acct === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="f-cat">Category</label><select id="f-cat" data-filter="cat" data-live="0"><option value="">All categories</option><option value="_none" ${f.cat === '_none' ? 'selected' : ''}>Uncategorized</option><option value="${INCOME}" ${f.cat === INCOME ? 'selected' : ''}>Ready to Assign (income)</option>${D.tree.order.map((id) => `<option value="${id}" ${f.cat === id ? 'selected' : ''}>${esc(D.tree.path[id].join(' › '))}</option>`).join('')}</select></div>
            <div class="field"><label for="f-from">From</label><input id="f-from" type="date" data-filter="from" data-live="0" value="${f.from}"></div>
            <div class="field"><label for="f-to">To</label><input id="f-to" type="date" data-filter="to" data-live="0" value="${f.to}"></div>
            <div class="field"><label for="f-min">Amount from</label><input id="f-min" class="cents" inputmode="numeric" autocomplete="off" data-filter="min" data-live="0" value="${esc(f.min)}" placeholder="0.00"></div>
            <div class="field"><label for="f-max">Amount to</label><input id="f-max" class="cents" inputmode="numeric" autocomplete="off" data-filter="max" data-live="0" value="${esc(f.max)}" placeholder="Any"></div>
            <div class="field"><label for="f-status">Show</label><select id="f-status" data-filter="status" data-live="0">
              ${[['', 'Everything'], ['review', 'Needs review'], ['uncleared', 'Not yet cleared by the bank'], ['receipt', 'Has a receipt'], ['noreceipt', 'No receipt']].map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field end"><button class="btn sm" data-action="clear-filters">Clear all</button><button class="btn sm primary" data-action="toggle-filters">Done</button></div>
          </div>` : ''}
          </div>
        </div>
        <div class="search"><span aria-hidden="true">${ICON.search}</span><input id="txq" type="search" data-live="0" placeholder="${isPhone() ? 'Search' : 'Search payee, bank description, note, amount, date, category'}" value="${esc(UI.q)}" aria-label="Search transactions"></div>
      </div>
      ${phoneChips}${sumBits ? `<div class="tx-sum">
        <div class="ts-l">
          ${isPhone() ? '' : chips}
          <span class="ts-count${activeFilters || UI.q || UI.only || UI.pick ? '' : ' plain'}">${UI.pick && isPhone() ? (nPicked > 1 ? `<b>${nPicked} selected</b> · ${signed(picked().reduce((n, x) => n + D.txById[x].amt, 0))}` : nPicked ? 'Tap another one to go with it' : 'Tap the transactions to select them') : UI.only ? (UI.onlyWhat === 'balance' ? 'Hover over a red-underlined amount to see why it could explain the difference.' : list.length > 1 ? `${list.length} transactions with the same amount as another within a few days. If any are the same purchase, delete the extra.` : 'Only one left, so no double-up here now.') : activeFilters || UI.q ? `Showing ${list.length} of ${D.tx.length} &middot; totalling <b class="${total > 0 ? 'pos' : ''}">${signed(total)}</b>` : `${list.length} ${list.length === 1 ? 'transaction' : 'transactions'}`}</span>
        </div>
        <div class="ts-r">
          ${matches ? `<span class="hint">${matches} matched ${matches === 1 ? 'transaction needs' : 'transactions need'} approving one by one</span>` : ''}
          ${updates ? `<button class="btn sm" data-action="approve-updates">Approve ${updates} description ${updates === 1 ? 'update' : 'updates'}</button>` : ''}
          ${review && reviewable ? `<button class="btn sm primary" data-action="approve-all">Approve ${reviewable} with a category</button>` : ''}
          ${selBtns}
        </div>
      </div>` : ''}
      <div class="txl${byDay ? ' by-day' : ''} ${UI.rec || (UI.f.acct && D.accounts[UI.f.acct]) || Object.keys(D.accounts).length < 2 ? 'one-acct' : ''}" role="list">
        ${shown.length ? txHeader() : ''}
        ${multiBar()}${shown.map((t, i) => (byDay && (i === 0 || shown[i - 1].date !== t.date) ? `<div class="tx-day" role="presentation">${esc(dateLabel(t.date))}</div>` : '') + txRow(t) + bcMark(t)).join('') || `<p class="empty-note">${D.tx.length ? 'No transactions match.' : 'No transactions yet. Add one, or import a file from your bank.'}</p>`}
      </div>
      ${list.length > shown.length ? `<div class="row-btns center"><button class="btn" data-action="more-tx">Show more (${list.length - shown.length} left)</button></div>` : ''}`;
  }

  // needs a category: not a transfer, split or tracking entry, and none chosen
  const isUncat = (t) => !t.cat && !(t.splits && t.splits.length) && !(t.transfer && !trkXfer(t)) && !isTrack(t.acct);
  function txCatLabel(t) {
    if (t.transfer) {
      const x = `${isDebt(t.transfer) && t.amt < 0 ? 'Payment to' : isDebt(t.acct) && t.amt > 0 ? 'Payment from' : t.amt < 0 ? 'Transfer to' : 'Transfer from'} ${esc(acctName(t.transfer))}`;
      return trkXfer(t) ? `<span class="tcat ${t.cat ? 'xfer' : 'none'}">${x} · ${t.cat ? esc(catName(t.cat)) : 'Uncategorized'}</span>` : `<span class="tcat xfer">${x}</span>`;
    }
    if (t.splits && t.splits.length) return `<span class="tcat">Split: ${t.splits.map((p) => esc(p.cat ? catName(p.cat) : 'Uncategorized')).join(', ')}</span>`;
    if (!t.cat) return isTrack(t.acct) ? '<span class="tcat faint">Tracking</span>' : '<span class="tcat none">Uncategorized</span>';
    if (t.cat === START) return '<span class="tcat faint">Starting balance owed</span>';
    if (D.debt[t.acct] && t.cat === D.debt[t.acct]) return '<span class="tcat faint">Interest or fees</span>';
    return `<span class="tcat ${t.cat === INCOME ? 'inc' : ''}">${esc(catName(t.cat))}</span>`;
  }
  const isPhone = () => document.documentElement.dataset.layout === 'phone';
  // a transaction line turned into boxes you can edit in place
  function txEditRow(t) {
    const d = UI.editDraft || {};
    const v = (k, def) => (k in d ? d[k] : def);
    if (!d.splits && t.splits && t.splits.length && !('cat' in d)) d.splits = t.splits.map((p) => ({ cat: p.cat || '', amt: box(Math.abs(p.amt)), memo: p.memo || '' }));
    const acct = v('acct', t.acct);
    const amtNow = E.parseMoney(String(v('amt', box(t.amt)))) || t.amt;
    const curCat = d.splits ? '__split' : v('cat', t.transfer ? 'xfer:' + t.transfer : (t.cat || ''));
    const others = Object.values(D.accounts).filter((a) => a.id !== acct && !a.closed);
    const xcatBox = curCat.indexOf('xfer:') === 0 && isTrack(curCat.slice(5)) && !isTrack(acct);
    let opts = isTrack(acct) ? `<option value="">No category (tracking account)</option>` : catOptions(curCat.indexOf('xfer:') === 0 || curCat === '__split' ? '' : curCat, { blankLabel: 'Uncategorized', forTx: true, acct });
    if (others.length) opts += `<optgroup label="Transfer between your accounts">${others.map((a) => `<option value="xfer:${a.id}" ${curCat === 'xfer:' + a.id ? 'selected' : ''}>Transfer ${amtNow < 0 ? 'to' : 'from'} ${esc(a.name)}</option>`).join('')}</optgroup>`;
    if (!isTrack(acct)) opts += `<option value="__split" ${curCat === '__split' ? 'selected' : ''}>${d.splits ? 'Split' : 'Split between categories…'}</option>`;
    const receipt = 'receipt' in d ? d.receipt : t.receipt, receiptType = 'receipt' in d ? d.receiptType : t.receiptType;
    const openAccts = Object.values(D.accounts).filter((a) => !a.closed || a.id === t.acct);
    return `<div class="txr editing" role="listitem" data-edit="${t.id}">
      <div class="t-side t-lead">${t.match ? `<button class="ic ic-match" data-action="approve" data-id="${t.id}" title="Same purchase: approve" aria-label="Approve match">${t.match.kind === 'update' ? ICON.redo : ICON.link}</button><button class="ic ic-unlink" data-action="unmatch" data-id="${t.id}" title="${t.match.kind === 'update' ? 'Different purchases: keep both' : 'Different: split them'}" aria-label="Split them">${ICON.unlink}</button>` : t.approved === false ? `<button class="ic ic-approve" data-action="approve" data-id="${t.id}" title="Approve" aria-label="Approve">${ICON.tick}</button>` : ''}</div>
      <div class="tx-main tx-edit">
        <span class="t-date ie-datewrap"><input id="ie-date" type="text" inputmode="numeric" autocomplete="off" value="${esc(shortDate(v('date', t.date)))}" placeholder="dd/mm/yy" aria-label="Date (dd/mm/yy)"><button type="button" class="ie-cal" data-action="ie-cal" tabindex="-1" aria-label="Pick a date" title="Pick a date"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button><input type="date" id="ie-date-pick" class="ie-pick" tabindex="-1" aria-hidden="true" value="${esc(isoOr(v('date', t.date), t.date))}"></span>
        <input id="ie-payee" class="t-payee" data-payee="1" autocomplete="off" value="${esc(v('payee', t.payee || ''))}" placeholder="Payee" aria-label="Payee">
        <select id="ie-cat" class="t-cat" aria-label="Category">${opts}</select>
        <span class="t-ac">${esc(acctName(acct))}</span>
        <textarea id="ie-bank" class="t-bank" rows="1" placeholder="Bank description" aria-label="Bank description">${esc(v('bank', t.bank || ''))}</textarea>
        <input id="ie-memo" class="t-memo" autocomplete="off" value="${esc(v('memo', t.memo || ''))}" placeholder="Note" aria-label="Note">
        <input id="ie-amt" class="t-amt cents" inputmode="numeric" autocomplete="off" value="${esc(v('amt', box(t.amt)))}" aria-label="Amount (minus for money out)">
        <div class="ie-extra">
          ${xcatBox ? `<label class="ie-x">${amtNow < 0 ? 'Paid from' : 'Goes to'} <select id="ie-xcat" aria-label="${amtNow < 0 ? 'Paid from category' : 'Goes to category'}">${catOptions(v('xcat', t.cat || ''), { blankLabel: 'Uncategorized', forTx: true, acct })}</select></label>` : ''}
          ${openAccts.length > 1 ? `<label class="ie-x">Account <select id="ie-acct" aria-label="Account">${openAccts.map((a) => `<option value="${a.id}" ${a.id === acct ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
          ${receipt ? `<span class="ie-x">${ICON.receipt}<button class="linkish" data-action="ie-rcpt-view">Receipt</button><button class="linkish" data-action="ie-rcpt-rm" title="Remove the receipt">Remove</button></span>`
            : S.assets ? `<label class="ie-x linkish" for="ie-rfile">${ICON.receipt} Add receipt</label><input type="file" id="ie-rfile" accept="image/*,application/pdf" hidden>` : ''}
          ${receipt && receiptType ? '' : ''}
        </div>
        <div class="ie-btns">
          <button class="ib ib-save" data-action="ie-save" title="Save (Enter)" aria-label="Save">${ICON.tick}</button>
          <button class="ib" data-action="ie-cancel" title="Cancel (Esc)" aria-label="Cancel">&times;</button>
          <button class="ib ib-del ${UI.delAsk === t.id ? 'ask' : ''}" data-action="ie-delete" title="${UI.delAsk === t.id ? 'Click again to delete' : 'Delete'}${t.pair ? ' (and its matching transfer)' : ''}" aria-label="Delete">${ICON.trash}</button>
        </div>
      </div>
      <div class="t-clr"></div>
      ${d.splits ? `<div class="ie-splits">
        ${d.splits.map((p, i) => `<div class="ie-sp">
          <select id="ie-sp-cat-${i}" aria-label="Split ${i + 1} category">${catOptions(p.cat || '', { blankLabel: 'Uncategorized', forTx: true })}</select>
          <input id="ie-sp-amt-${i}" class="cents" inputmode="numeric" autocomplete="off" value="${esc(p.amt || '')}" placeholder="0.00" aria-label="Split ${i + 1} amount">
          <input id="ie-sp-memo-${i}" autocomplete="off" value="${esc(p.memo || '')}" placeholder="Note" aria-label="Split ${i + 1} note">
          <button class="ic" data-action="ie-sp-rm" data-i="${i}" title="Remove this line" aria-label="Remove split ${i + 1}">&times;</button>
        </div>`).join('')}
        <div class="ie-sp-foot"><button class="linkish" data-action="ie-sp-add">${ICON.plus} Add line</button><button class="linkish" data-action="ie-sp-stop">Stop splitting</button><span id="ie-sp-left" class="hint">${splitLeftText(d, amtNow)}</span></div>
      </div>` : ''}
      ${t.match ? matchCompare(t) : ''}
    </div>`;
  }
  function splitLeftText(d, amt) {
    const total = Math.abs(amt || 0), used = (d.splits || []).reduce((s, p) => s + Math.abs(E.parseMoney(String(p.amt || '')) || 0), 0);
    return total === used ? 'Splits add up.' : `${money(Math.abs(total - used))} ${total > used ? 'left to split' : 'too much'}`;
  }
  async function ieDelete() { return deleteAsk(UI.editTx); }
  // first press asks, second press deletes (Delete key or the Delete button)
  async function deleteAsk(id) {
    const t = D.txById[id];
    if (!t) return;
    if (UI.delAsk !== id) { UI.delAsk = id; render(); toast(UI.editTx === id ? `Click the bin again to delete ${t.payee || 'this transaction'} ${txAmt(t.amt)}.` : `Press Delete again to delete ${t.payee || 'this transaction'} ${txAmt(t.amt)}. Esc to keep it.`); return; }
    const next = rowIds()[rowIds().indexOf(id) + 1] || rowIds()[rowIds().indexOf(id) - 1] || null;
    const rm = [t];
    if (t.pair && D.txById[t.pair]) rm.push(D.txById[t.pair]);
    if (UI.editTx === id) { UI.editTx = null; UI.editDraft = null; }
    UI.delAsk = null; UI.sel = next;
    await putTxs([], rm);
    toast(`Deleted ${t.payee || 'transaction'} ${txAmt(t.amt)}. Press ${MAC ? '⌘' : 'Ctrl+'}Z to undo.`); render();
  }
  const rowIds = () => Array.from(document.querySelectorAll('.txl .txr[data-row]')).map((e) => e.dataset.row);
  // dates in the edit row are written dd/mm/yy so the whole date fits
  const shortDate = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(2, 4)}` : String(x || ''));
  // "5/6", "05/06/26", "5-6-2026" → ISO; a missing year uses the year it had; null when it isn't a real date
  function parseShortDate(x, was) {
    x = String(x || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
    const m = x.match(/^(\d{1,2})[\/.\- ](\d{1,2})(?:[\/.\- ](\d{2}|\d{4}))?$/);
    if (!m) return null;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(String(was || E.todayISO()).slice(0, 4));
    const iso = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    const dt = new Date(iso + 'T00:00:00Z');
    return Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(m[1]) || dt.getUTCMonth() + 1 !== Number(m[2]) ? null : iso;
  }
  const isoOr = (x, fallback) => parseShortDate(x, fallback) || fallback;
  // explicit: the person pressed Save (or Enter on the last box), not just clicked somewhere else
  async function saveInline(explicit) {
    const id = UI.editTx, d = UI.editDraft || {};
    UI.editTx = null; UI.editDraft = null;
    const orig = D.txById[id];
    if (!orig) return;
    const keep = (msg) => { UI.editTx = id; UI.editDraft = d; toast(msg); return false; };
    const t = Object.assign({}, orig);
    if (d.date) { const iso = parseShortDate(d.date, orig.date); if (!iso) return keep('That date doesn\'t look right. Type it as dd/mm/yy, like 05/06/26.'); t.date = iso; }
    if ('payee' in d) t.payee = d.payee.trim();
    if ('memo' in d) t.memo = d.memo.trim() || null;
    if ('bank' in d) t.bank = d.bank.trim() || null;
    if (d.acct) t.acct = d.acct;
    if ('amt' in d) {
      const raw = String(d.amt).trim(), a = E.parseMoney(raw);
      if (Number.isNaN(a) || !a) return keep('Enter an amount, like -45.20 for money out.');
      // typing just a number keeps it as money out or in, like before; a + or - sign sets it
      t.amt = /^[+-]/.test(raw) ? a : Math.abs(a) * (orig.amt < 0 ? -1 : 1);
    }
    if (d.splits) {
      const sign = t.amt < 0 ? -1 : 1;
      const lines = d.splits.map((p) => ({ cat: p.cat || null, amt: sign * Math.abs(E.parseMoney(String(p.amt || '')) || 0), memo: (p.memo || '').trim() || null })).filter((p) => p.amt || p.cat);
      if (lines.length < 2) { t.splits = null; t.transfer = null; t.cat = lines[0] ? lines[0].cat : null; }
      else {
        const sum = lines.reduce((s, p) => s + p.amt, 0);
        if (sum !== t.amt) return keep(`The splits add up to ${money(Math.abs(sum))}, not ${money(Math.abs(t.amt))}.`);
        t.splits = lines; t.cat = null; t.transfer = null;
      }
    } else if ('cat' in d) {
      t.splits = null;
      if (d.cat.indexOf('xfer:') === 0) { t.transfer = d.cat.slice(5); t.cat = null; } else { t.transfer = null; t.cat = d.cat || null; }
    }
    if (trkXfer(t)) t.cat = 'xcat' in d ? d.xcat || null : t.cat || orig.cat || null;
    if (t.transfer && t.transfer === t.acct) return keep('A transfer needs two different accounts.');
    if ('receipt' in d) { t.receipt = d.receipt || null; t.receiptType = d.receiptType || null; }
    // an imported transaction waiting for approval is approved once it's saved with a job (a category, split or transfer)
    const hasJob = t.cat || (t.splits && t.splits.length) || t.transfer || isTrack(t.acct);
    const approveNow = orig.approved === false && !orig.match && hasJob && (explicit || 'cat' in d || !!d.splits);
    if (approveNow) t.approved = null;
    const same = (k) => JSON.stringify(t[k] == null ? null : t[k]) === JSON.stringify(orig[k] == null ? null : orig[k]);
    if (['date', 'payee', 'memo', 'bank', 'cat', 'amt', 'acct', 'transfer', 'splits', 'receipt', 'approved'].every(same)) return true;
    await commitTx(orig, t);
    toast(approveNow ? 'Saved and approved' : 'Saved');
    return true;
  }
  // save an edited transaction, keeping the other side of a transfer in step
  async function commitTx(orig, t) {
    const writes = [t], removes = [];
    if (E.monthOf(orig.date) !== E.monthOf(t.date)) removes.push(orig);
    const oldPair = orig.pair ? D.txById[orig.pair] : null;
    if (t.transfer) {
      const p = oldPair && oldPair.acct === t.transfer ? Object.assign({}, oldPair) : { id: S.uid(), cleared: 'u', by: myId() };
      if (oldPair && oldPair.acct !== t.transfer) removes.push(oldPair);
      if (oldPair && p.id === oldPair.id && E.monthOf(oldPair.date) !== E.monthOf(t.date)) removes.push(oldPair);
      Object.assign(p, { acct: t.transfer, date: t.date, amt: -t.amt, transfer: t.acct, pair: t.id, cat: pairCat(t, p), splits: null, payee: t.payee || null, memo: t.memo || null });
      t.pair = p.id;
      writes.push(p);
    } else {
      if (oldPair) removes.push(oldPair);
      t.pair = null;
    }
    if (t.bank && t.cat && t.payee && !t.transfer && (t.cat === INCOME || D.tree.isLeaf(t.cat))) {
      const key = E.descKey(t.bank), rule = D.rules[key];
      if (key && (!rule || rule.payee !== t.payee || rule.cat !== t.cat)) guard(S.write('meta', 'rules', { items: { [key]: Object.assign({}, rule && !rule.kind ? rule : {}, { payee: t.payee, cat: t.cat }) } }));
    }
    try { localStorage.setItem('zeroline-last-acct', t.acct); } catch (e) { /* ignore */ }
    await putTxs(writes, removes.filter((r) => !writes.some((w) => w.id === r.id && E.monthOf(w.date) === E.monthOf(r.date))));
  }
  async function startInline(id) {
    if (UI.editTx && UI.editTx !== id) { const ok = await saveInline(); if (ok === false) { render(); return; } D = snapshot(); }
    UI.editTx = id; UI.editDraft = {};
    render();
    const f = $('#ie-payee'); if (f) { f.focus(); f.select(); }
  }

  function txHeader() {
    const col = (k, label, cls) => `<button class="th ${cls || ''} ${UI.sort.k === k ? 'on' : ''}" data-action="tx-sort" data-k="${k}" aria-label="Sort by ${label}">${label}<i>${UI.sort.k === k ? (UI.sort.dir > 0 ? '▲' : '▼') : ''}</i></button>`;
    return `<div class="tx-hdr" role="presentation"><div class="t-side"></div><div class="tx-hcols">${col('date', 'Date', 't-date')}${col('payee', 'Payee', 't-payee')}${col('cat', 'Category', 't-cat')}${col('acct', 'Account', 't-ac')}<span class="th-desc">${col('memo', 'Note', 't-memo')}<span class="th-sep">·</span>${col('bank', 'Bank description', 't-bank')}</span>${col('amt', 'Amount', 't-amt')}</div><div class="t-clr"></div></div>`;
  }
  // in the list, money out has no minus sign; money in is green with a plus
  const txAmt = (a) => (a > 0 ? signed(a) : money(-a));
  let REC_FLAGS = {};
  const twinIds = (id) => { const f = (REC_FLAGS[id] || []).find((x) => x[2]); return f ? f[2].join(',') : ''; };
  function txRow(t) {
    if (UI.editTx === t.id && !isPhone()) return txEditRow(t);
    const cl = t.cleared === 'r' ? `<span class="clr r" title="Reconciled">${ICON.lock}</span>` : `<button class="clr ${t.cleared === 'c' ? 'c' : 'u'}" data-action="toggle-clear" data-id="${t.id}" aria-label="${t.cleared === 'c' ? 'Cleared. Mark as not cleared' : 'Not cleared. Mark as cleared'}" title="${t.cleared === 'c' ? 'Cleared by the bank' : 'Not yet cleared'}">C</button>`;
    return `<div class="txr${UI.peekTx === t.id ? ' open' : ''}${t.match ? ' matched' : t.approved === false ? ' review' : ''}${isUncat(t) ? ' nocat' : ''}${REC_FLAGS[t.id] ? ' rflagged' : ''}${UI.sel === t.id || (UI.multi || []).includes(t.id) ? ' selected' : ''}${UI.delAsk === t.id && UI.editTx !== t.id ? ' del-ask' : ''}" role="listitem" data-row="${t.id}">
      <div class="t-side">${t.match ? `<button class="ic ic-match" data-action="${isPhone() ? 'approve' : 'open-tx'}" data-id="${t.id}" title="${isPhone() ? 'Approve' : t.match.kind === 'update' ? 'Bank description updated. Click to compare and approve' : 'Matched to a bank line. Click to compare and approve'}" aria-label="${t.match.kind === 'update' ? 'Updated' : 'Matched'}">${t.match.kind === 'update' ? ICON.redo : ICON.link}</button>` : t.approved === false ? `<button class="ic ic-approve" data-action="approve" data-id="${t.id}" title="Approve" aria-label="Approve">${ICON.tick}</button>` : ''}</div>
      <button class="tx-main" data-action="${isPhone() ? (UI.pick ? 'pick-tx' : 'tx-peek') : 'sel-tx'}" data-id="${t.id}" title="Click again or press Enter to edit">
        <span class="t-date">${esc(dateLabel(t.date))}</span>
        <span class="t-payee" title="${esc(t.payee || '')}">${esc(t.payee || (t.transfer ? 'Transfer' : t.bank) || 'No payee')}${t.receipt ? `<i class="ricon" title="Has a receipt">${ICON.receipt}</i>` : ''}</span>
        <span class="t-cat" title="${esc(t.transfer ? 'Transfer' : t.splits && t.splits.length ? 'Split' : t.cat ? catPath(t.cat) : 'Uncategorized')}">${txCatLabel(t)}<span class="t-acct">${esc(acctName(t.acct))}</span></span>
        <span class="t-ac" title="${esc(acctName(t.acct))}">${esc(acctName(t.acct))}</span>
        <span class="t-desc" title="${esc([t.memo, t.bank].filter(Boolean).join(' · '))}">${t.memo ? `<i class="d-memo">${esc(t.memo)}</i>` : ''}${t.memo && t.bank ? '<span class="d-sep"> · </span>' : ''}${t.bank ? `<span class="d-bank">${esc(t.bank)}</span>` : ''}${checkOf(t) ? `<span class="d-mnote">${esc(checkOf(t)[1])}</span>` : ''}</span>
        ${checkOf(t) ? `<span class="t-chk c-${checkOf(t)[0]}">${esc(checkOf(t)[1])}</span>` : ''}
        <span class="t-amt ${t.amt > 0 ? 'pos' : ''}${REC_FLAGS[t.id] ? ' flagamt' : ''}"${REC_FLAGS[t.id] ? ` title="${esc(REC_FLAGS[t.id].map(([sh, lo]) => sh + ' ' + lo).join('\n'))}"` : ''}${twinIds(t.id) ? ` data-action="show-twins" data-ids="${twinIds(t.id)}"` : ''}>${txAmt(t.amt)}</span>
      </button>
      <div class="t-clr">${cl}</div>
      <button class="tx-pen" data-action="open-tx" data-id="${t.id}" aria-label="Edit this transaction" title="Edit"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.6l2.8 2.8L7.2 15.6 3.8 16.2l.6-3.4 9.2-9.2z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M11.8 5.4l2.8 2.8" stroke="currentColor" stroke-width="1.6"/></svg></button>
    </div>`;
  }
  // what there is to check on a transaction waiting for approval: [group, one short line], or null
  function checkOf(t) {
    const m = t.match, p = (m && m.prev) || {}, mm = (x) => money(Math.abs(x));
    if (m && m.fix) return ['fix', `Edited ${mm(p.amt)} → Bank ${mm(t.amt)}`];
    if (m && m.kind === 'update') return p.amt != null && p.amt !== t.amt ? ['amount', `Pending ${mm(p.amt)} → Bank ${mm(t.amt)}`] : ['update', 'Was pending, now gone through'];
    if (m && p.absorbed && p.absorbed.length) return ['joined', `Manual ${[p.amt].concat(p.absorbed.map((x) => x.amt)).map(mm).join(' + ')} → Bank ${mm(t.amt)} in one payment`];
    if (m && m.how === 'parts') return ['parts', `Manual ${mm(p.amt)} · Bank charged it in parts`];
    if (m && 'date' in p && p.date !== t.date) return ['date', `Manual ${dateLabel(p.date)} → Bank ${dateLabel(t.date)}`];
    if (m && 'amt' in p && p.amt !== t.amt) return ['amount', `Manual ${mm(p.amt)} → Bank ${mm(t.amt)}`];
    // two entries with the same amount on close dates, and the bank lines don't name them: it had to guess
    if (m && !m.how && !t.transfer && D.tx.some((o) => o !== t && o.acct === t.acct && o.match && !o.match.kind && !o.match.how && o.amt === t.amt && gapDays(o.date, t.date) <= 10
      && !(sameShop(t, { bank: m.bank }) && sameShop(o, { bank: o.match.bank })))) return ['swap', `Bank says ${tidyPayee(m.bank)}`];
    if (m) return ['match', 'Perfect match'];
    if (t.approved !== false) return null;
    return t.cat || (t.splits && t.splits.length) || t.transfer || isTrack(t.acct) ? ['new', 'New from the bank'] : ['nocat', 'Needs a category'];
  }


  // side by side: what was already in YNABB, and what the bank file says
  function matchCompare(t) {
    const m = t.match, upd = m.kind === 'update', p = m.prev || {};
    // a likely match keeps what you typed in prev (amount, date, category, note), and any entries it joined
    const was = !upd && 'amt' in p;
    const youDate = was ? p.date : t.date, bankDate = m.date || t.date;
    const diffDate = youDate !== bankDate;
    const catOf = (x) => (x.transfer ? 'Transfer' : x.splits && x.splits.length ? 'Split' : x.cat ? catName(x.cat) : 'Uncategorized');
    const oldAmt = (upd || was) && p.amt != null ? p.amt : t.amt, joined = was ? [Object.assign({}, t, { date: p.date, amt: p.amt, cat: p.cat, splits: p.splits, memo: p.memo })].concat(p.absorbed || []) : null;
    const typedAmt = joined ? joined.reduce((n, x) => n + x.amt, 0) : oldAmt, diffAmt = typedAmt !== t.amt;
    const row = (label, date, what, posted, cls, amt, dd, da) => `<div class="mc-row ${cls}"><span class="mc-who">${label}</span><span class="mc-date ${dd ? 'mc-diff' : ''}">${esc(dateLabel(date))}${posted ? `<small>bank posted ${esc(dateLabel(posted))}</small>` : ''}</span><span class="mc-what">${what}</span><span class="mc-amt ${amt > 0 ? 'pos' : ''} ${da ? 'mc-diff' : ''}">${txAmt(amt)}</span></div>`;
    const typedRow = (x, i) => row(i ? '' : 'You typed', x.date, `<b>${esc(x.payee || 'No payee')}</b> · ${esc(catOf(x))}${x.memo ? ` · <i>${esc(x.memo)}</i>` : ''}`, '', 'you', x.amt, diffDate, diffAmt);
    const q = m.fix ? 'Put back the bank\'s amount? It had been changed in YNABB.' : upd ? 'Is the bank\'s new line the same purchase as the one imported earlier?' : 'Is this bank line the same as the transaction you typed in?';
    return `<div class="mcmp">
        <div class="mc-q">${q}${diffDate ? ' <b class="mc-diff">The dates are different.</b>' : ''}${joined && joined.length > 1 ? ' <b class="mc-diff">The bank took them in one go.</b>' : diffAmt ? ` <b class="mc-diff">The amount is ${esc(money(Math.abs(t.amt - typedAmt)))} different.</b>` : ''}</div>
        ${m.fix ? row('YNABB had', t.date, `<b>${esc(t.payee || 'No payee')}</b>`, '', 'you', oldAmt, false, true)
          : upd ? row('Imported earlier', youDate, `<span class="mono">${esc(p.bank || '')}</span>`, '', 'you', oldAmt, diffDate, diffAmt)
          : joined ? joined.map(typedRow).join('')
          : typedRow(t, 0)}
        ${row(upd && !m.fix ? 'Bank now says' : 'Bank file says', bankDate, `<span class="mono">${esc(m.bank || '')}</span>`, m.posted && m.posted !== bankDate ? m.posted : '', 'bank', t.amt, diffDate, diffAmt)}
      </div>`;
  }

  // transaction editor
  function openTx(t) {
    const isNew = !t;
    const acctIds = Object.keys(D.accounts).filter((k) => !D.accounts[k].closed);
    if (isNew && !acctIds.length) { toast('Add an account first.'); UI.view = 'accounts'; saveUI(); render(); return; }
    const lastAcct = (() => { try { return localStorage.getItem('zeroline-last-acct'); } catch (e) { return null; } })();
    t = t ? Object.assign({}, t) : { id: S.uid(), acct: (UI.f.acct && D.accounts[UI.f.acct]) ? UI.f.acct : (lastAcct && D.accounts[lastAcct] ? lastAcct : acctIds[0]), date: E.todayISO(), payee: '', cat: null, amt: 0, bank: '', memo: '', cleared: 'u', by: myId() };
    const orig = isNew ? null : D.txById[t.id];
    let splits = t.splits && t.splits.length ? t.splits.map((p) => Object.assign({}, p)) : null;
    let dir = t.amt > 0 ? 'in' : 'out';
    let receipt = t.receipt || null, receiptType = t.receiptType || null;
    const reconciled = t.cleared === 'r';
    // the rarely-used bits stay tucked away until asked for
    let noteOpen = !!t.memo, bankOpen = false;
    const canSplitBank = () => !t.match && t.ik && t.bank && !isNew;

    const catSel = () => {
      let opts = isTrack(t.acct) ? `<option value="">No category (tracking account)</option>` : catOptions(t.transfer ? 'xfer:' + t.transfer : (t.cat || ''), { blankLabel: 'Uncategorized', forTx: true, acct: t.acct });
      const others = Object.values(D.accounts).filter((a) => a.id !== t.acct && !a.closed);
      if (others.length) opts += `<optgroup label="Transfer between your accounts">${others.map((a) => `<option value="xfer:${a.id}" ${t.transfer === a.id ? 'selected' : ''}>Transfer ${dir === 'out' ? 'to' : 'from'} ${esc(a.name)}</option>`).join('')}</optgroup>`;
      return opts;
    };
    const splitRows = () => splits.map((p, i) => `<div class="split" data-i="${i}">
        <select id="sp-cat-${i}" aria-label="Split ${i + 1} category">${catOptions(p.cat || '', { blankLabel: 'Uncategorized', forTx: true })}</select>
        <input id="sp-amt-${i}" class="cents" inputmode="numeric" autocomplete="off" value="${p.amt ? box(Math.abs(p.amt)) : ''}" placeholder="0.00" aria-label="Split ${i + 1} amount">
        <input id="sp-memo-${i}" value="${esc(p.memo || '')}" placeholder="Note" aria-label="Split ${i + 1} note">
        <button class="icon-btn" data-saction="rm-split" data-i="${i}" aria-label="Remove split ${i + 1}">×</button>
      </div>`).join('');

    // as little text as possible: the values explain themselves, so most labels live in aria-label only
    const body = () => `
      ${reconciled ? '<p class="hint">Reconciled. Changing the amount or account will unbalance the account.</p>' : ''}
      ${t.match ? (() => {
        // the same words as the reconcile list: what was there → what the bank says
        const [k, line] = checkOf(t);
        const yes = { fix: `Put Back ${money(Math.abs(t.amt))}`, update: 'Same Purchase' }[k] || 'Match';
        const no = k === 'fix' ? `Keep ${money(Math.abs(t.match.prev.amt))}` : 'Keep Separate';
        return `<div class="warn-box tx-mbox"><b>${esc(CHECK_HEAD[k] || 'Matched')}</b>${k === 'match' || k === 'new' ? '' : `<span>${esc(line)}</span>`}
          <div class="row-btns"><button class="btn sm primary" data-saction="approve-match">${ICON.tick} ${esc(yes)}</button><button class="btn sm" data-saction="unmatch">${esc(no)}</button></div></div>`;
      })()
        : t.approved === false ? '<p class="hint warn">Imported from your bank. Check the payee and category, then approve it.</p>' : ''}
      <div class="tx-hero"><span class="tx-sign ${dir}">${dir === 'out' ? '−' : '+'}$</span><input id="tx-amt" class="cents" inputmode="numeric" autocomplete="off" value="${t.amt ? box(Math.abs(t.amt)) : ''}" placeholder="0.00" aria-label="Amount">
        <span class="dir seg-ctl" role="group" aria-label="Money out or in"><button data-saction="dir" data-v="out" aria-pressed="${dir === 'out'}">Out</button><button data-saction="dir" data-v="in" aria-pressed="${dir === 'in'}">In</button></span></div>
      <div class="tx-chips"><input id="tx-date" type="date" value="${t.date}" aria-label="Date">
        <select id="tx-acct" aria-label="Account">${Object.values(D.accounts).filter((a) => !a.closed || a.id === t.acct).map((a) => `<option value="${a.id}" ${a.id === t.acct ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div class="field tx-who"><input id="tx-payee" data-payee="1" autocomplete="off" value="${esc(t.payee || '')}" aria-label="Payee" ${isPhone() ? 'readonly placeholder="Payee (tap to choose)"' : 'placeholder="Payee"'}>
        ${bankOpen ? `<input id="tx-bank" class="tx-bankin" autocomplete="off" value="${esc(t.bank || '')}" placeholder="Bank description" aria-label="Bank description">`
          : t.bank ? `<button class="tx-bankcap" data-saction="edit-bank" title="Bank description. Tap to edit">${esc(t.bank)}</button>`
          : '<button class="linkish tx-bankadd" data-saction="edit-bank">Add a bank description</button>'}</div>
      ${splits ? `<div class="field"><span class="lbl">Split between categories</span><div id="splits">${splitRows()}</div>
          <div class="row-btns"><button class="btn sm" data-saction="add-split">${ICON.plus} Add line</button><button class="btn sm" data-saction="unsplit">Stop splitting</button><span id="split-left" class="hint"></span></div></div>`
        : `<div class="field tx-catrow"><select id="tx-cat" aria-label="Category">${catSel()}</select><button class="linkish" data-saction="split">Split</button></div>`}
      ${!splits && trkXfer(t) ? `<div class="field"><label for="tx-xcat">${dir === 'out' ? 'Paid from category' : 'Goes to category'}</label><select id="tx-xcat">${catOptions(t.cat || '', { blankLabel: 'Uncategorized', forTx: true, acct: t.acct })}</select></div>` : ''}
      ${t.posted ? `<p class="fine">Bank processed it ${esc(dateLabel(t.posted))}.</p>` : ''}
      ${noteOpen ? `<div class="field"><textarea id="tx-memo" rows="${isPhone() ? 1 : 2}" placeholder="Note" aria-label="Note">${esc(t.memo || '')}</textarea></div>` : ''}
      <div class="tx-foot">
        ${noteOpen ? '' : `<button class="chip" data-saction="note">${ICON.plus} Note</button>`}
        <div id="rcpt">${receiptBox()}</div>
        <label class="chip"><input type="checkbox" id="tx-clear" ${t.cleared === 'c' || t.cleared === 'r' ? 'checked' : ''} ${reconciled ? 'disabled' : ''}> Cleared</label></div>
      ${canSplitBank() ? '<button class="linkish tx-splitoff" data-saction="split-bank">Wrong match? Split the bank line off</button>' : ''}
      <p class="fine" id="tx-by"></p>`;
    const receiptBox = () => {
      if (receipt) {
        const src = '/_blob/' + receipt;
        const img = !receiptType || receiptType.indexOf('image/') === 0;
        return `<div class="rbox">${img ? `<button class="rthumb" data-saction="view-receipt"><img src="${src}" alt="Receipt"></button>` : `<button class="btn sm" data-saction="view-receipt">${ICON.receipt} Open receipt (PDF)</button>`}
          <div class="row-btns"><label class="btn sm" for="rfile">Replace</label><button class="btn sm" data-saction="rm-receipt">Remove</button></div>
          <input type="file" id="rfile" accept="image/*,application/pdf" hidden></div>`;
      }
      if (!S.assets) return '';
      return `<label class="chip" for="rfile">${ICON.receipt} Receipt</label><input type="file" id="rfile" accept="image/*,application/pdf" hidden><span id="rstat" class="hint"></span>`;
    };
    const readForm = () => {
      t.amt = E.parseMoney($('#tx-amt').value);
      if (dir === 'out') t.amt = -Math.abs(t.amt); else t.amt = Math.abs(t.amt);
      t.date = $('#tx-date').value || t.date;
      t.payee = $('#tx-payee').value.trim();
      t.acct = $('#tx-acct').value;
      if ($('#tx-bank')) t.bank = $('#tx-bank').value.trim();
      if ($('#tx-memo')) t.memo = $('#tx-memo').value.trim();
      if (splits) {
        splits = splits.map((p, i) => ({ cat: $('#sp-cat-' + i).value || null, amt: (dir === 'out' ? -1 : 1) * Math.abs(E.parseMoney($('#sp-amt-' + i).value) || 0), memo: $('#sp-memo-' + i).value.trim() || null }));
      } else if ($('#tx-cat')) {
        const v = $('#tx-cat').value;
        if (v.indexOf('xfer:') === 0) { t.transfer = v.slice(5); t.cat = trkXfer(t) ? ($('#tx-xcat') ? $('#tx-xcat').value || null : t.cat) : null; } else { t.transfer = null; t.cat = v || null; }
      }
    };
    const paint = () => {
      setSheetBody(body());
      if (splits) splitLeft();
      if (t.by && S.user) S.user.profiles([t.by]).then((ps) => { const el = $('#tx-by'); if (el && ps[t.by]) el.textContent = 'Added by ' + (ps[t.by].isMe ? 'you' : (ps[t.by].name || 'someone with access')); }).catch(() => {});
    };
    const splitLeft = () => {
      const total = Math.abs(E.parseMoney($('#tx-amt').value) || 0);
      const used = splits.reduce((s, p, i) => s + Math.abs(E.parseMoney(($('#sp-amt-' + i) || {}).value) || 0), 0);
      const el = $('#split-left');
      if (el) { el.textContent = total === used ? 'Splits add up.' : `${money(total - used)} ${total > used ? 'left to split' : 'too much'}`; el.className = 'hint ' + (total === used ? '' : 'warn'); }
    };

    openSheet({
      title: isNew ? 'New transaction' : 'Transaction',
      body: '',
      foot: `<button class="btn primary" data-saction="save">Save</button>
        ${t.approved === false ? '<button class="btn" data-saction="save-approve">Save & approve</button>' : ''}
        <span class="tx-fr">        ${isNew ? '' : `<button class="icon-btn danger" data-saction="delete" aria-label="Delete" title="Delete">${ICON.trash}</button>`}</span>`,
    });
    paint();
    if (isNew) setTimeout(() => $('#tx-amt') && $('#tx-amt').focus(), 60);

    const save = async (approve) => {
      readForm();
      if (!t.amt) { toast('Enter an amount.'); return; }
      if (t.transfer && t.transfer === t.acct) { toast('A transfer needs two different accounts.'); return; }
      if (splits) {
        const sum = splits.reduce((s, p) => s + p.amt, 0);
        if (sum !== t.amt) { toast(`The splits add up to ${money(Math.abs(sum))}, not ${money(Math.abs(t.amt))}.`); return; }
        t.splits = splits; t.cat = null; t.transfer = null;
      } else t.splits = null;
      t.cleared = reconciled ? 'r' : ($('#tx-clear').checked ? 'c' : 'u');
      t.receipt = receipt; t.receiptType = receiptType;
      if (approve) t.approved = null;
      const writes = [t], removes = [];
      if (orig && E.monthOf(orig.date) !== E.monthOf(t.date)) removes.push(orig);
      // keep the other side of a transfer in step
      const oldPair = orig && orig.pair ? D.txById[orig.pair] : null;
      if (t.transfer) {
        const p = oldPair && oldPair.acct === t.transfer ? Object.assign({}, oldPair) : { id: S.uid(), cleared: 'u', by: myId() };
        if (oldPair && oldPair.acct !== t.transfer) removes.push(oldPair);
        if (p.date && E.monthOf(p.date) !== E.monthOf(t.date) && oldPair) removes.push(oldPair);
        Object.assign(p, { acct: t.transfer, date: t.date, amt: -t.amt, transfer: t.acct, pair: t.id, cat: pairCat(t, p), splits: null, payee: t.payee || null, memo: t.memo || null });
        t.pair = p.id;
        writes.push(p);
      } else {
        if (oldPair) removes.push(oldPair);
        t.pair = null;
      }
      // learn payee + category from imported bank descriptions
      if (t.bank && t.cat && t.payee && !t.transfer) {
        const key = E.descKey(t.bank);
        const rule = D.rules[key];
        if (key && (!rule || rule.payee !== t.payee || rule.cat !== t.cat)) guard(S.write('meta', 'rules', { items: { [key]: Object.assign({}, rule && !rule.kind ? rule : {}, { payee: t.payee, cat: t.cat }) } }));
      }
      try { localStorage.setItem('zeroline-last-acct', t.acct); } catch (e) { /* ignore */ }
      await putTxs(writes, removes.filter((r) => !writes.some((w) => w.id === r.id && E.monthOf(w.date) === E.monthOf(r.date))));
      closeSheet();
      toast(isNew ? 'Transaction added' : 'Saved');
      render();
    };

    sheet.actions = {
      save: () => save(false),
      'save-approve': () => save(true),
      dir: (el) => { readForm(); dir = el.dataset.v; t.amt = dir === 'out' ? -Math.abs(t.amt) : Math.abs(t.amt); paint(); },
      split: () => { readForm(); splits = [{ cat: t.cat, amt: t.amt, memo: null }, { cat: null, amt: 0, memo: null }]; t.transfer = null; paint(); },
      unsplit: () => { readForm(); t.cat = splits[0] ? splits[0].cat : null; splits = null; paint(); },
      'add-split': () => { readForm(); splits.push({ cat: null, amt: 0, memo: null }); paint(); },
      'rm-split': (el) => { readForm(); splits.splice(Number(el.dataset.i), 1); if (splits.length < 2) { t.cat = splits[0] ? splits[0].cat : null; splits = null; } paint(); },
      note: () => { readForm(); noteOpen = true; paint(); $('#tx-memo').focus(); },
      'edit-bank': () => { readForm(); bankOpen = true; paint(); $('#tx-bank').focus(); },
      'rm-receipt': () => { readForm(); receipt = null; receiptType = null; paint(); },
      'view-receipt': () => openLightbox('/_blob/' + receipt, receiptType),
      delete: () => {
        setSheetFoot(`<span class="hint bad">Delete this transaction${t.pair ? ' and its matching transfer' : ''}?</span><button class="btn danger" data-saction="delete-yes">Delete</button><button class="btn" data-saction="delete-no">Keep</button>`);
      },
      'delete-no': () => openTx(D.txById[t.id]),
      'approve-match': async () => { await approve([t.id]); closeSheet(); toast('Match approved'); render(); },
      unmatch: async () => { await unmatch(t.id); closeSheet(); render(); },
      'split-bank': async () => { await unmatch(t.id); closeSheet(); render(); },
      'delete-yes': async () => {
        const rm = [orig];
        if (orig.pair && D.txById[orig.pair]) rm.push(D.txById[orig.pair]);
        await putTxs([], rm);
        closeSheet(); toast('Transaction deleted'); render();
      },
    };
    sheet.onInput = (el) => { if (splits && /^(sp-amt|tx-amt)/.test(el.id)) splitLeft(); };
    sheet.onChange = async (el) => {
      if (el.id === 'tx-payee' && !t.cat && !splits && $('#tx-cat') && !$('#tx-cat').value) {
        // fill the category this payee used last time
        const pc = payeeCat(el.value);
        if (pc) $('#tx-cat').value = pc;
      }
      if (el.id === 'tx-acct' || el.id === 'tx-cat') { readForm(); paint(); }
      if (el.id === 'rfile' && el.files && el.files[0]) {
        readForm();
        const stat = $('#rstat');
        if (stat) stat.textContent = 'Uploading…';
        try {
          const { blob, type } = await prepareReceipt(el.files[0]);
          const res = await S.assets.upload(blob, { type });
          receipt = res.id; receiptType = type;
          paint();
          toast('Receipt attached. Save to keep it.');
        } catch (e) {
          const msg = { too_large: 'That file is too big (over 20 MB).', unsupported_type: 'Use a photo (JPEG, PNG) or a PDF.', quota_or_state: 'Receipt storage is full.', rate_limited: 'Too many uploads at once. Try again in a moment.' }[e && e.code] || 'The receipt could not be uploaded. Try again.';
          if ($('#rstat')) $('#rstat').textContent = msg; else toast(msg);
        }
      }
    };
  }

  async function prepareReceipt(file) {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    const isImg = /^image\//.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    if (file.type === 'application/pdf') return { blob: file, type: 'application/pdf' };
    if (isImg && (file.size > 1.5e6 || ok.indexOf(file.type) < 0)) {
      try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
        cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
        if (blob) return { blob, type: 'image/jpeg' };
      } catch (e) { /* fall through */ }
    }
    if (ok.indexOf(file.type) >= 0) return { blob: file, type: file.type };
    throw { code: 'unsupported_type' };
  }

  // PDFs show inside YNABB too: a link out of the home-screen app leaves no way back
  function openLightbox(src, type) {
    const lb = $('#lightbox');
    const pdf = type && type.indexOf('image/') !== 0;
    lb.innerHTML = `<button class="lb-close" data-action="close-lb" aria-label="Close receipt">×</button>${pdf ? `<iframe class="lb-pdf" src="${src}" title="Receipt"></iframe>` : `<img src="${src}" alt="Receipt">`}`;
    lb.hidden = false;
  }

  async function toggleClear(id) {
    const t = D.txById[id];
    if (!t || t.cleared === 'r') return;
    await putTxs([Object.assign({}, t, { cleared: t.cleared === 'c' ? 'u' : 'c' })]);
  }
  // put the user's own entry back as it was, and add the bank's transaction separately
  async function unmatch(id) {
    const t = D.txById[id];
    if (!t) return;
    const m = t.match || { bank: t.bank, date: t.date, ik: t.ik, prev: { bank: null, ik: null, cleared: 'u', approved: null } };
    const restored = Object.assign({}, t, { bank: m.prev.bank, ik: m.prev.ik, cleared: m.prev.cleared, approved: m.prev.approved, match: null });
    if (m.kind === 'update') Object.assign(restored, { iks: m.prev.iks || null, posted: m.prev.posted || null, amt: m.prev.amt != null ? m.prev.amt : t.amt });
    // the bank's amount put back over one changed in YNABB: saying no just keeps YNABB's
    if (m.fix) { await putTxs([Object.assign(restored, { bank: t.bank, ik: t.ik })]); toast(`Kept ${money(Math.abs(m.prev.amt))}.`); return; }
    // a likely match: your amount, date, category and note come back, and anything it joined or changed
    const back = [];
    if (m.kind !== 'update') ['amt', 'date', 'splits', 'cat', 'memo'].forEach((k) => { if (k in m.prev) restored[k] = m.prev[k]; });
    const p = m.prev.pairAmt != null && t.pair && D.txById[t.pair];
    if (p) back.push(Object.assign({}, p, { amt: m.prev.pairAmt }));
    (m.prev.absorbed || []).forEach((x) => { if (!D.txById[x.id]) back.push(x); });
    const rule = ruleFor(m.bank, m.amt != null ? m.amt : t.amt, t.acct, m.date || t.date);
    const useRule = !!rule;
    const bankTx = {
      id: S.uid(), acct: t.acct, date: m.date, posted: m.posted || null, amt: m.amt != null ? m.amt : t.amt, bank: m.bank, memo: useRule && rule.memo ? rule.memo : null,
      payee: useRule && rule.payee ? rule.payee : tidyPayee(m.bank), cat: useRule ? rule.cat || null : null,
      cleared: 'c', approved: false, ik: m.ik, by: myId(),
    };
    // you've said these two are different purchases, so never flag them as a double-up
    restored.notWith = (t.notWith || []).concat(bankTx.id);
    bankTx.notWith = [t.id];
    await putTxs([restored, bankTx].concat(back));
    toast(m.kind === 'update' ? 'Kept separate. The earlier transaction is back as it was, and this one is listed on its own.' : 'Unmatched. Your entry is back as it was, and the bank transaction is listed separately.');
  }

  async function approve(ids) {
    const list = ids.map((id) => D.txById[id]).filter(Boolean).map((t) => Object.assign({}, t, { approved: null, match: null }));
    if (list.length) await putTxs(list);
    if (list.length > 1) toast(`Approved ${list.length} transactions`);
  }

  // ---------- import ----------
  // After the sure matches: pair what's left with entries typed by hand that are probably the same thing.
  // Each becomes a match waiting for approval (Needs review), so nothing is final until you say so.
  // r.how says what was different; r.copyFrom marks the other parts of an order the bank took in parts.
  function likelyLinks(rows, existing) {
    const claimed = new Set(rows.map((r) => r.matchId || r.updateId).filter(Boolean));
    const byIk = {}; existing.forEach((t) => { if (t.ik) byIk[t.ik] = t; });
    // a line already imported whose amount was changed in YNABB since: put the bank's amount back
    for (const r of rows) {
      const t = r.status === 'dupe' && byIk[r.ik];
      if (t && t.amt !== r.amt && !(t.splits && t.splits.length) && !t.pair && !claimed.has(t.id)) Object.assign(r, { status: 'update', updateId: t.id, amtFrom: t.amt, fix: true });
    }
    const typed = existing.filter((t) => !t.ik && t.cleared !== 'r' && !claimed.has(t.id) && !/^(starting balance|reconciliation adjustment)$/i.test(t.payee || ''));
    const news = rows.filter((r) => r.status === 'new');
    const taken = new Set(), usedR = new Set();
    const bv = (r) => ({ bank: r.desc, payee: r.payee || '' });
    const okT = (t) => !taken.has(t.id), okR = (r) => !usedR.has(r), sgn = (a, b) => Math.sign(a) === Math.sign(b);
    const plain = (t) => !t.pair && !(t.splits && t.splits.length);
    const link = (r, t, how) => { Object.assign(r, { status: 'match', matchId: t.id, how }); usedR.add(r); taken.add(t.id); };
    // the same amount up to ten days apart (a bill paid days after its due date), or with the date typed wrong
    const sameAmt = (far) => {
      for (const t of typed) {
        if (!okT(t)) continue;
        let best = null, sc = 1e9;
        for (const r of news) {
          if (!okR(r) || r.amt !== t.amt) continue;
          const g = gapDays(t.date, r.date), sim = sameShop(t, bv(r));
          if (far ? !(sim && g > 10 && (g <= 62 || Math.abs(g - 365) <= 3)) : g > 10) continue;
          const v = g - (sim ? 20 : 0);
          if (v < sc) { best = r; sc = v; }
        }
        if (best) link(best, t, { kind: far ? 'date' : 'same' });
      }
    };
    sameAmt(false);
    // one order the bank took in parts
    for (const t of typed) {
      if (!okT(t) || !plain(t)) continue;
      const hit = sumOf(news.filter((r) => okR(r) && sgn(r.amt, t.amt) && gapDays(t.date, r.date) <= 7 && sameShop(t, bv(r))), t.amt);
      if (!hit) continue;
      hit.sort((a, b) => (a.date < b.date ? -1 : 1));
      link(hit[0], t, { kind: 'parts', n: hit.length });
      hit.slice(1).forEach((r) => { r.copyFrom = t.id; usedR.add(r); });
    }
    // several entries the bank took in one go
    for (const r of news) {
      if (!okR(r)) continue;
      const hit = sumOf(typed.filter((t) => okT(t) && plain(t) && sgn(r.amt, t.amt) && gapDays(t.date, r.date) <= 3 && sameShop(t, bv(r))), r.amt);
      if (!hit) continue;
      link(r, hit[0], { kind: 'joined', ids: hit.map((t) => t.id) });
      hit.forEach((t) => taken.add(t.id));
    }
    // a transfer typed with a different amount: the bank line says it's a transfer, or names the other account
    for (const t of typed) {
      if (!okT(t) || !t.pair) continue;
      const other = flatText((D.accounts[t.transfer] || {}).name).replace(/^nab/, '');
      const says = (x) => /transfer|online|tfr/i.test(x) || (other.length >= 4 && flatText(x).includes(other));
      const r = news.find((x) => okR(x) && sgn(x.amt, t.amt) && gapDays(t.date, x.date) <= 3 && says(x.desc));
      if (r) link(r, t, { kind: 'amount' });
    }
    // the same shop around the same day with a different amount: a typo, a tip, a fuel hold, a pay rise
    for (const t of typed) {
      if (!okT(t) || !plain(t)) continue;
      let best = null, sc = 1e9;
      for (const r of news) {
        if (!okR(r) || !sgn(r.amt, t.amt) || !sameShop(t, bv(r))) continue;
        const g = gapDays(t.date, r.date), ratio = Math.abs(r.amt / t.amt);
        if (g <= 7 && ratio >= 0.4 && ratio <= 2.5 && g < sc) { best = r; sc = g; }
      }
      if (best) link(best, t, { kind: 'amount' });
    }
    sameAmt(true);
  }
  // one short line on what was different about a likely match
  function howNote(h, t, r) {
    const m = (x) => money(Math.abs(x));
    if (h.kind === 'amount') return `You typed ${m(t.amt)}. The bank's ${m(r.amt)} is used.`;
    if (h.kind === 'date') return `You dated it ${dateLabel(t.date)}. The bank's ${dateLabel(r.date)} is used.`;
    if (h.kind === 'same') { const g = Math.round(gapDays(t.date, r.date)); return g ? `Your date and the bank's are ${g} ${g === 1 ? 'day' : 'days'} apart.` : ''; }
    if (h.kind === 'parts') return `You typed ${m(t.amt)}. The bank took it in ${h.n} parts.`;
    if (h.kind === 'joined') return `You typed ${h.ids.length} entries (${h.ids.map((x) => m((D.txById[x] || {}).amt || 0)).join(' + ')}). The bank took them in one go.`;
    return '';
  }
  // Import & reconcile: one place to bring in a bank file and check the balance, or just type the balance.
  // mode: 'import' or 'rec'; note: a line shown at the top (e.g. after an import with no balance in the file)
  function openImport(acctPreset, mode, note) {
    const accts = Object.values(D.accounts).filter((a) => !a.closed);
    if (!accts.length) { toast('Add an account first.'); UI.view = 'accounts'; saveUI(); render(); return; }
    const st = { step: 1, acct: flowAcct(acctPreset) || accts[0].id, mode: mode || 'import', note: note || '', rows: null, header: null, map: {}, flip: false, datefmt: 'dmy', classified: null, include: {} };
    const isTrk = () => D.accounts[st.acct].type === 'tracking';
    // with nothing ticked the button still goes on to the balance check
    const importFoot = () => {
      const k = Object.values(st.include).filter(Boolean).length, g = st.goneSel ? st.goneSel.size : 0;
      return `<button class="btn" data-saction="back">Back</button><button class="btn primary" data-saction="go">${k ? `Import ${k}` : g ? 'Remove' : 'Check the balance'}${g ? `${k ? ' and remove' : ''} ${g} released` : ''}</button>`;
    };
    const paint = () => {
      let html = '';
      if (st.step === 1) {
        const mode = isTrk() ? 'rec' : st.mode, url = S.settings().bankUrl || '';
        const bb = S.items('bankbal')[st.acct] || {}, last = Object.keys(bb).sort().pop(), v = last != null ? (isDebt(st.acct) ? -bb[last] : bb[last]) : null;
        html = `${st.note ? `<p class="im-note">${st.note}</p>` : ''}
          ${accts.length > 1 ? `<div class="field"><label for="im-acct">Account</label><select id="im-acct">${accts.map((a) => `<option value="${a.id}" ${a.id === st.acct ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
          ${isTrk() ? '' : `<div class="seg-ctl im-mode" role="group" aria-label="What to do"><button data-saction="mode" data-v="import" aria-pressed="${mode === 'import'}">Import from my bank</button><button data-saction="mode" data-v="rec" aria-pressed="${mode === 'rec'}">Just reconcile</button></div>`}
          ${mode === 'import' ? `<ol class="im-steps">
            <li><b>Download a CSV from your bank.</b> In NAB Internet Banking, open the account, choose Export and pick CSV.
              ${url ? `<div class="row-btns"><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open my bank &#8599;</a><button class="linkish" data-saction="edit-url">Change</button></div>`
                : `<div class="field im-url"><label for="im-url">Your bank's login page, to open it from here (optional)</label><div class="im-url-row"><input id="im-url" type="url" inputmode="url" autocomplete="off" placeholder="https://ib.nab.com.au" value="${esc(st.urlDraft || '')}"><button class="btn sm" data-saction="save-url">Save</button></div></div>`}</li>
            <li><b>Choose the file you downloaded.</b> YNABB skips what it already has, matches what you typed, then checks the balance.
              <div class="row-btns"><button class="btn primary" data-saction="pick">Choose bank file</button><input type="file" id="im-file" accept=".csv,.ofx,.qfx,.qif,.txt,text/csv" hidden></div></li>
          </ol>
          <p class="fine">To undo an import, see Settings › Bank imports.</p>`
          : `<div class="field narrow"><label for="rec-bank">${isDebt(st.acct) ? 'Amount owing' : isTrk() ? "What it's worth now" : "Bank's current balance"}</label><input id="rec-bank" class="cents" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${v != null && !isTrk() ? box(v) : ''}"></div>
          ${v != null && !isTrk() ? `<p class="hint">Filled in from your last bank file (end of ${esc(dateLabel(last))}). Check it matches your banking app.</p>` : ''}
          ${isTrk() ? '<p class="hint">The difference goes in as one adjustment: your gains or losses since last time. Money you put in or took out should be a transfer first.</p>' : '<p class="hint">Use the balance in your banking app. If there are pending purchases, use the <b>available</b> balance.</p>'}
          <div class="row-btns"><button class="btn primary" data-saction="rec">${isTrk() ? 'Save' : 'Start reconciling'}</button></div>`}`;
      } else if (st.step === 2) {
        const cols = st.rows[0].map((_, i) => i);
        const name = (i) => (st.header ? st.header[i] || `Column ${i + 1}` : `Column ${i + 1}`);
        const sel = (k, label, optional) => `<div class="field"><label for="map-${k}">${label}</label><select id="map-${k}" data-map="${k}"><option value="">${optional ? '(none)' : 'Choose a column'}</option>${cols.map((i) => `<option value="${i}" ${st.map[k] === i ? 'selected' : ''}>${esc(name(i))} · e.g. ${esc((st.rows[0][i] || '').slice(0, 24))}</option>`).join('')}</select></div>`;
        const parsed = parseRows(st).slice(0, 4);
        html = `<p>Tell the app which column is which. It remembers this for ${esc(D.accounts[st.acct].name)} next time.</p>
          <div class="grid2">${sel('date', 'Date')}${sel('desc', 'Description')}${sel('amt', 'Amount (one column)', true)}${sel('debit', 'Or: money out column', true)}${sel('credit', 'And: money in column', true)}${sel('payee', 'Merchant name (optional, used as the payee)', true)}${sel('bal', 'Balance (optional, lets the app check it matches the bank)', true)}
          <div class="field"><label for="im-datefmt">Date order</label><select id="im-datefmt"><option value="dmy" ${st.datefmt === 'dmy' ? 'selected' : ''}>Day/Month/Year</option><option value="mdy" ${st.datefmt === 'mdy' ? 'selected' : ''}>Month/Day/Year</option></select></div></div>
          <label class="check"><input type="checkbox" id="im-flip" ${st.flip ? 'checked' : ''}> Flip signs (use if spending shows as positive numbers)</label>
          <h3>Preview</h3>
          <div class="table-wrap"><table class="ptable"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>
          ${parsed.map((r) => `<tr><td>${r.date ? esc(dateLabel(r.date)) : '<span class="bad">Unreadable</span>'}</td><td>${esc(r.desc)}</td><td class="num ${r.amt > 0 ? 'pos' : ''}">${Number.isNaN(r.amt) ? '<span class="bad">?</span>' : signed(r.amt)}</td></tr>`).join('')}
          </tbody></table></div>`;
      } else if (st.step === 3) {
        const c = st.classified;
        const n = { new: 0, match: 0, dupe: 0, update: 0, early: 0 };
        c.forEach((r) => n[r.status]++);
        const keep = $('#im-dupes'), keepEarly = $('#im-early');
        if (keep) st.dupesOpen = keep.open;
        if (keepEarly) st.earlyOpen = keepEarly.open;
        // one bank line: tick, a readable name and amount, then the date and the bank's wording, then anything worth knowing
        const row = (r, i) => {
          const t = D.txById[r.matchId || r.updateId] || null;
          const name = r.status === 'match' && t ? t.payee || 'Your entry' : r.rule && r.rule.payee ? r.rule.payee : r.payee || tidyPayee(r.desc);
          const cat = r.status === 'new' && r.rule && r.rule.cat ? catName(r.rule.cat) : r.status === 'match' && t && t.cat ? catName(t.cat) : '';
          const note = r.copyFrom ? `Part of your “${esc((D.txById[r.copyFrom] || {}).payee || '')}” entry`
            : r.status === 'update' && r.fix ? `Changed to ${esc(money(Math.abs(r.amtFrom)))} in YNABB. This puts the bank's amount back.`
            : r.status === 'update' && t ? `Was pending as “${esc(t.payee || t.bank)}”${r.amtFrom != null ? `. Amount now ${esc(money(Math.abs(r.amt)))}, was ${esc(money(Math.abs(r.amtFrom)))}` : ''}.`
            : r.status === 'match' && t && r.how && howNote(r.how, t, r) ? esc(howNote(r.how, t, r))
            : r.status === 'match' && t && t.date !== r.date ? `You dated it ${esc(dateLabel(t.date))}.` : '';
          return `<label class="im-row ${r.status}"><input type="checkbox" data-inc="${i}" ${st.include[i] ? 'checked' : ''} aria-label="Include ${esc(name)}">
            <span class="im-main"><span class="im-top"><b>${esc(name)}</b><span class="im-amt ${r.amt > 0 ? 'pos' : ''}">${signed(r.amt)}</span></span>
            <span class="im-bank">${cat ? `<span class="im-cat">${esc(cat)}</span>` : ''}<span>${esc(dateLabel(r.date))} · ${esc(r.desc)}</span></span>${note ? `<span class="im-why">${note}</span>` : ''}</span></label>`;
        };
        const group = (want) => c.map((r, i) => (want(r) ? row(r, i) : '')).join('');
        const check = group((r) => r.status === 'match' || r.status === 'update');
        const fresh = group((r) => r.status === 'new');
        const todo = n.new + n.match + n.update;
        const stat = (num, label, cls) => `<div class="im-stat ${cls}${num ? '' : ' zero'}"><b>${num}</b><span>${label}</span></div>`;
        html = `<div class="im-head ${todo ? '' : 'done'}">${todo
            ? `<b>${todo} to bring in</b><span>Untick anything you don't want. Then import and check the balance.</span>`
            : `<b>&#10003; You're up to date</b><span>All ${c.length} in this file are already in YNABB. Next, check the balance.</span>`}</div>
          <div class="im-stats">${stat(n.new, 'New', 'new')}${stat(n.match + n.update, 'Matched', 'match')}${stat(n.dupe, 'Already in', 'dupe')}</div>
          ${check ? `<h3 class="im-h">Matched to what you entered <small>You'll approve these after</small></h3><div class="im-list">${check}</div>` : ''}
          ${fresh ? `<h3 class="im-h">New</h3><div class="im-list">${fresh}</div>` : ''}
          ${st.gone && st.gone.length ? `<div class="warn-box gone-box"><b>${st.gone.length === 1 ? 'A pending charge is' : `${st.gone.length} pending charges are`} no longer in the bank file.</b> ${st.gone.length === 1 ? 'It was' : 'They were'} imported while pending, but this file covers ${st.gone.length === 1 ? 'its date' : 'their dates'} and doesn't include ${st.gone.length === 1 ? 'it' : 'them'}, cleared or pending. That usually means the bank released a hold (a hotel, a hire car, a fuel pre-authorisation). Ticked ones are removed when you import.
            <ul class="rc-list">${st.gone.map((t) => `<li><label class="check"><input type="checkbox" data-gone="${t.id}" ${st.goneSel.has(t.id) ? 'checked' : ''}><span>${esc(dateLabel(t.date))}</span><span>${esc(t.payee || '')} <small class="muted">${esc(t.bank || '')}${t.cleared === 'r' ? ' · reconciled' : ''}</small></span><b class="${t.amt > 0 ? 'pos' : ''}">${txAmt(t.amt)}</b></label></li>`).join('')}</ul></div>` : ''}
          ${n.dupe ? `<details class="im-more" id="im-dupes" ${st.dupesOpen ? 'open' : ''}><summary>${n.dupe} already in YNABB <small>skipped</small></summary><div class="im-list">${group((r) => r.status === 'dupe')}</div></details>` : ''}
          ${n.early ? `<details class="im-more" id="im-early" ${st.earlyOpen ? 'open' : ''}><summary>${n.early} already in the starting balance <small>skipped</small></summary><p class="hint">${esc(acctName(st.acct))}'s starting balance on ${esc(dateLabel(st.startDate))} already includes ${n.early === 1 ? 'it' : 'them'}${c.some((r) => r.sameDay) ? ": the bank's balance after them matches it exactly" : ''}.</p><div class="im-list">${group((r) => r.status === 'early')}</div></details>` : ''}
          ${st.rows ? `<p class="fine im-file">${esc(st.file || 'Your file')} · ${c.length} lines · <button class="linkish" data-saction="cols">Columns look wrong?</button></p>` : ''}`;
      }
      setSheetBody(html);
      setSheetFoot(st.step === 1 ? '' : st.step === 2
        ? '<button class="btn" data-saction="back">Back</button><button class="btn primary" data-saction="check">Next</button>'
        : importFoot());
    };
    openSheet({ title: isTrk() ? 'Update balance' : 'Import & reconcile', body: '', wide: true });
    paint();
    const classify = (rows) => {
      // the date the purchase was made (from the description), keeping the bank's date for duplicate checks
      rows = rows.map((r) => { const d = E.dateFromDesc(r.desc, r.date, st.datefmt); return Object.assign({}, r, { posted: r.date, date: d || r.date }); });
      const existing = D.tx.filter((t) => t.acct === st.acct);
      st.classified = E.classifyImport(st.acct, rows, existing);
      likelyLinks(st.classified, existing);
      st.classified = st.classified.map((r) => {
        if (r.status === 'new' && !r.copyFrom) { const rule = ruleFor(r.desc, r.amt, st.acct, r.date); if (rule && (rule.payee || rule.cat || rule.memo || rule.alt)) r.rule = rule; }
        return r;
      });
      // rules that take turns: go through the new lines oldest first, each one after the last that matched
      const turns = st.classified.map((r, i) => ({ r, i })).filter((x) => x.r.rule && x.r.rule.alt);
      if (turns.length) {
        const newestFirst = rows.length > 1 && (rows[0].posted || rows[0].date) > (rows[rows.length - 1].posted || rows[rows.length - 1].date);
        const asTx = (r, i) => ({ id: '_' + i, date: r.date, posted: r.posted, amt: r.amt, bal: Number.isFinite(r.bal) ? r.bal : null, bank: r.desc, _i: i });
        turns.sort((x, y) => bankOrder(asTx(x.r, x.i), asTx(y.r, y.i)) || (newestFirst ? y.i - x.i : x.i - y.i));
        const done = [];
        for (const { r, i } of turns) {
          const rl = r.rule.rule, me = asTx(r, i);
          const prior = existing.filter((t) => !t.transfer && ruleHits(rl, bankText(t), t) && bankOrder(t, me) <= 0 && bankDate(t) <= bankDate(me))
            .concat(done.filter((d) => d.key === rl.key).map((d) => d.t));
          const o = altPick(rl, prior);
          r.rule = Object.assign({}, r.rule, { payee: o.payee || null, cat: okCat(o.cat) ? o.cat || null : null, memo: o.memo || null, turn: true });
          done.push({ key: rl.key, t: Object.assign(me, { payee: o.payee, cat: o.cat }) });
        }
      }
      // lines from before the account's starting balance are already counted in it
      const sb = existing.filter((t) => /^starting balance$/i.test(t.payee || '')).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      st.startDate = sb ? sb.date : null;
      if (st.startDate) st.classified.forEach((r) => { if (r.status === 'new' && (r.posted || r.date) < st.startDate) r.status = 'early'; });
      // the starting balance is often typed from the bank app late on its own date, so some of that day's lines are already in it.
      // The bank's running balance says which: the line that left exactly the starting balance, and those before it that day.
      if (sb) {
        const ok = st.classified.map((r, i) => ({ r, i, date: r.posted || r.date, amt: r.amt, bal: r.bal })).filter((x) => Number.isFinite(x.bal) && !Number.isNaN(x.amt));
        const chron = ok.length && newestFirst(ok) ? ok.slice().reverse() : ok;
        const day = chron.filter((x) => x.date === st.startDate);
        let upTo = -1;
        day.forEach((x, k) => { if (x.bal === sb.amt) upTo = k; });
        day.slice(0, upTo + 1).forEach((x) => { if (x.r.status === 'new') { x.r.status = 'early'; x.r.sameDay = true; } });
      }
      st.include = {};
      st.classified.forEach((r, i) => (st.include[i] = r.status !== 'dupe' && r.status !== 'early'));
      // pending charges imported before, dated inside this file's dates, that the bank no longer shows (a released hold)
      const posted = rows.map((r) => r.posted || r.date).filter(Boolean).sort();
      const from = posted[0], to = posted[posted.length - 1];
      const iks = new Set(st.classified.map((r) => r.ik)), updated = new Set(st.classified.filter((r) => r.updateId || r.matchId).map((r) => r.updateId || r.matchId));
      // only holds YNABB itself imported while pending: never anything brought over from YNAB or entered by hand
      st.gone = from ? existing.filter((t) => t.ik && t.bank && E.isPending(t.bank) && !t.match && t.date >= from && t.date < to && !updated.has(t.id)
        && !iks.has(t.ik) && !(t.iks || []).some((k) => iks.has(k))).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
      st.goneSel = new Set(st.gone.map((t) => t.id));
      st.step = 3; paint();
    };
    sheet.onChange = async (el) => {
      if (el.dataset.gone) { if (el.checked) st.goneSel.add(el.dataset.gone); else st.goneSel.delete(el.dataset.gone); paint(); return; }
      if (el.id === 'im-acct') { st.acct = el.value; UI.lastImport = el.value; saveUI(); paint(); }
      if (el.id === 'im-file' && el.files[0]) await loadFile(el.files[0]);
      if (el.dataset.map) { st.map[el.dataset.map] = el.value === '' ? undefined : Number(el.value); paint(); }
      if (el.id === 'im-flip') { st.flip = el.checked; paint(); }
      if (el.id === 'im-datefmt') { st.datefmt = el.value; paint(); }
      if (el.dataset.inc) { st.include[el.dataset.inc] = el.checked; setSheetFoot(importFoot()); }
    };
    const loadFile = async (file) => {
      st.file = file.name;
      const text = await file.text();
      if (/<OFX>|<STMTTRN>/i.test(text) || /^!Type:/im.test(text)) {
        const rows = /^!Type:/im.test(text) ? E.parseQIF(text) : E.parseOFX(text);
        if (!rows.length) { toast('No transactions found in that file.'); return; }
        classify(rows);
        return;
      }
      const rows = E.parseCSV(text);
      if (!rows.length) { toast('That file looks empty.'); return; }
      const first = rows[0];
      const looksHeader = first.every((v) => !E.parseDate(v, 'dmy') && Number.isNaN(Number(String(v).replace(/[$,\s]/g, ''))) || v === '');
      st.header = looksHeader ? first : null;
      st.rows = looksHeader ? rows.slice(1) : rows;
      if (!st.rows.length) { toast('That file has no transactions.'); return; }
      const saved = D.accounts[st.acct].csvMap;
      if (saved && saved.cols === st.rows[0].length) { st.map = Object.assign({}, saved.map); st.flip = !!saved.flip; st.datefmt = saved.datefmt || 'dmy'; }
      else guessMap(st);
      // when every row reads cleanly, go straight on; the columns can still be changed from the next step
      const m = st.map, test = m.date != null && m.desc != null && (m.amt != null || m.debit != null || m.credit != null) ? parseRows(st) : [];
      if (test.length && test.every((r) => r.date && !Number.isNaN(r.amt))) { st.autoCols = true; await sheet.actions.check(); return; }
      st.step = 2; paint();
    };
    const saveUrl = () => {
      let u = ($('#im-url') && $('#im-url').value || '').trim();
      if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
      if (u && !/^https:\/\/[^\s/]+\.[^\s]+/i.test(u)) { toast("That doesn't look like a web address."); return; }
      if (!u) { toast("Type your bank's login page first."); return; }
      guard(S.write('meta', 'settings', { bankUrl: u })); st.urlDraft = ''; paint();
    };
    sheet.onEnter = () => {
      const id = document.activeElement && document.activeElement.id;
      if (id === 'rec-bank') sheet.actions.rec();
      if (id === 'im-url') saveUrl();
    };
    sheet.actions = {
      mode: (el) => { st.mode = el.dataset.v; st.note = ''; paint(); if (st.mode === 'rec') setTimeout(() => $('#rec-bank') && $('#rec-bank').focus(), 30); },
      'save-url': saveUrl,
      'edit-url': () => { st.urlDraft = S.settings().bankUrl || ''; guard(S.write('meta', 'settings', { bankUrl: null })); paint(); },
      // Chrome on a computer can open the file chooser straight in Downloads; elsewhere the normal chooser
      pick: async () => {
        if (window.showOpenFilePicker) {
          try {
            const [h] = await window.showOpenFilePicker({ startIn: 'downloads', id: 'bank-file', types: [{ description: 'Bank file', accept: { 'text/plain': ['.csv', '.ofx', '.qfx', '.qif', '.txt'] } }] });
            await loadFile(await h.getFile());
          } catch (e) { if (e.name !== 'AbortError') $('#im-file').click(); }
        } else $('#im-file').click();
      },
      rec: () => {
        const raw = ($('#rec-bank') && $('#rec-bank').value || '').trim(), v = E.parseMoney(raw);
        if (!raw || Number.isNaN(v)) { toast(isTrk() ? "Type what it's worth now." : "Type the bank's current balance."); $('#rec-bank') && $('#rec-bank').focus(); return; }
        UI.lastImport = st.acct;
        if (isTrk()) { closeSheet(); updateValue(st.acct, v); return; }
        closeSheet(); startRec(st.acct, isDebt(st.acct) ? -Math.abs(v) : v);
      },
      back: () => { st.step = st.step === 3 && st.rows && !st.autoCols ? 2 : 1; paint(); },
      cols: () => { st.autoCols = false; st.step = 2; paint(); },
      check: async () => {
        if (st.map.date == null || st.map.desc == null || (st.map.amt == null && st.map.debit == null && st.map.credit == null)) { toast('Choose the date, description and amount columns.'); return; }
        const rows = parseRows(st);
        st.days = st.map.bal != null ? dayBalances(rows) : null; st.parsedRows = rows;
        const bad = rows.filter((r) => !r.date || Number.isNaN(r.amt)).length;
        if (bad === rows.length) { toast('None of the rows could be read. Check the columns and date order.'); return; }
        await putAcct(Object.assign({}, D.accounts[st.acct], { csvMap: { cols: st.rows[0].length, map: st.map, flip: st.flip, datefmt: st.datefmt } }));
        classify(rows.filter((r) => r.date && !Number.isNaN(r.amt)));
        if (bad) toast(`${bad} unreadable rows were left out.`);
      },
      go: async () => {
        const add = [], upd = [], side = [], absorbed = [];
        st.classified.forEach((r, i) => {
          if (!st.include[i]) return;
          if (r.status === 'update') {
            const t = D.txById[r.updateId];
            upd.push(Object.assign({}, t, {
              bank: r.desc, ik: r.ik, iks: r.fix ? t.iks || null : (t.iks || []).concat(t.ik ? [t.ik] : []), amt: r.amt, bal: Number.isFinite(r.bal) ? r.bal : t.bal || null,
              posted: r.posted !== r.date ? r.posted : null, cleared: t.cleared === 'r' ? 'r' : 'c', approved: false,
              match: { kind: 'update', fix: r.fix || undefined, bank: r.desc, date: r.date, posted: r.posted !== r.date ? r.posted : null, ik: r.ik, amt: r.amt,
                prev: { bank: t.bank || null, ik: t.ik || null, iks: t.iks || null, posted: t.posted || null, cleared: t.cleared || 'u', approved: t.approved === false ? false : null, amt: t.amt } },
            }));
            return;
          }
          if (r.status === 'match') {
            const t = D.txById[r.matchId], h = r.how;
            // kept so the match can be undone exactly
            const prev = { bank: t.bank || null, ik: t.ik || null, cleared: t.cleared || 'u', approved: t.approved === false ? false : null };
            const more = {};
            if (h) {
              // a likely match takes the bank's amount and, if the date was typed wrong, its date
              Object.assign(prev, { amt: t.amt, date: t.date, splits: t.splits || null, cat: t.cat || null, memo: t.memo || null });
              more.amt = r.amt;
              if (h.kind === 'date') more.date = r.date;
              if (h.kind === 'joined') {
                const ts = h.ids.map((x) => D.txById[x]).filter(Boolean), cats = [...new Set(ts.map((x) => x.cat || null))];
                more.memo = ts.map((x) => x.memo).filter(Boolean).join(' · ') || null;
                if (cats.length === 1) Object.assign(more, { cat: cats[0], splits: null });
                else if (ts.every((x) => x.cat)) Object.assign(more, { cat: null, splits: ts.map((x) => ({ cat: x.cat, amt: x.amt, memo: x.memo || undefined })) });
                prev.absorbed = ts.slice(1);
                absorbed.push(...ts.slice(1));
              }
              const p = t.pair && D.txById[t.pair];
              if (p && r.amt !== t.amt) { side.push(Object.assign({}, p, { amt: -r.amt })); prev.pairAmt = p.amt; }
            }
            upd.push(Object.assign({}, t, more, {
              bank: r.desc, ik: r.ik, cleared: t.cleared === 'r' ? 'r' : 'c', approved: false, bal: Number.isFinite(r.bal) ? r.bal : t.bal || null,
              match: { bank: r.desc, date: r.date, posted: r.posted !== r.date ? r.posted : null, ik: r.ik, how: h ? h.kind : undefined, note: h ? howNote(h, t, r) : undefined, prev },
            }));
          } else if (r.copyFrom && D.txById[r.copyFrom]) {
            // the rest of an order the bank took in parts: it takes the details of the entry you typed
            const t = D.txById[r.copyFrom];
            add.push({
              id: S.uid(), acct: st.acct, date: r.date, posted: r.posted !== r.date ? r.posted : null, amt: r.amt, bank: r.desc, payee: t.payee || tidyPayee(r.desc), cat: t.cat || null,
              memo: t.memo || null, cleared: 'c', approved: false, ik: r.ik, by: myId(), bal: Number.isFinite(r.bal) ? r.bal : null,
            });
          } else {
            add.push({
              id: S.uid(), acct: st.acct, date: r.date, posted: r.posted !== r.date ? r.posted : null, amt: r.amt, bank: r.desc,
              payee: r.rule && r.rule.payee ? r.rule.payee : (r.payee || tidyPayee(r.desc)), cat: r.rule ? r.rule.cat || null : null,
              memo: r.rule && r.rule.memo ? r.rule.memo : null, cleared: 'c', approved: false, ik: r.status === 'dupe' ? r.ik + '|' + S.uid() : r.ik, by: myId(), bal: Number.isFinite(r.bal) ? r.bal : null,
            });
          }
        });
        const batch = S.uid();
        add.forEach((t) => (t.imp = batch));
        const changed = {};
        for (const t of upd.concat(side)) {
          const o = D.txById[t.id];
          changed[t.id] = { bank: o.bank || null, ik: o.ik || null, iks: o.iks || null, posted: o.posted || null, cleared: o.cleared || 'u', approved: o.approved === false ? false : null, match: o.match || null, amt: o.amt,
            date: o.date, cat: o.cat || null, splits: o.splits || null, memo: o.memo || null };
        }
        upd.forEach((t) => (t.impd = true)); // touched by a recorded import (not an "earlier import")
        const gone = (st.gone || []).filter((t) => st.goneSel.has(t.id) && D.txById[t.id]).map((t) => D.txById[t.id]).concat(absorbed);
        // the page updates straight away; saving carries on in the background (the header shows when it's done)
        putTxs(add.concat(upd, side), gone, saveBar(`Importing ${add.length + upd.length} transactions`));
        if (st.days) saveDayBalances(st.acct, st.days, st.parsedRows);
        // keep the 15 most recent imports undoable
        const old = Object.values(S.items('imports')).sort((a, b) => b.ts - a.ts).slice(14);
        const items = { [batch]: { id: batch, ts: Date.now(), acct: st.acct, file: st.file || 'bank file', added: add.map((t) => t.id), changed, removed: gone.length ? gone : null, by: myId() } };
        old.forEach((b) => (items[b.id] = null));
        guard(S.write('meta', 'imports', { items }));
        closeSheet();
        UI.lastImport = st.acct;
        const auto = add.filter((t) => t.cat).length;
        const nUpd = upd.filter((t) => t.match && t.match.kind === 'update').length, nMatch = upd.length - nUpd;
        const said = `Imported ${add.length}${auto ? ` (${auto} categorized from past choices)` : ''}${nMatch ? `. ${nMatch} matched to your ${nMatch === 1 ? 'entry' : 'entries'}` : ''}${nUpd ? `. ${nUpd} bank ${nUpd === 1 ? 'description' : 'descriptions'} updated` : ''}${nMatch || nUpd ? ', waiting for you to approve' : ''}${gone.length > absorbed.length ? `. Removed ${gone.length - absorbed.length} released pending ${gone.length - absorbed.length === 1 ? 'charge' : 'charges'}` : ''}.`;
        // straight on to reconciling, against the newest balance in the file
        const last = st.days ? Object.keys(st.days).sort().pop() : null;
        if (last == null) { render(); openImport(st.acct, 'rec', `${esc(said)} Now type the bank's balance to check it matches.`); return; }
        startRec(st.acct, st.days[last], last);
        const { diff } = recState();
        const n = recWaiting().length;
        toast(`${said} ${diff ? `YNABB is ${money(Math.abs(diff))} ${diff < 0 ? 'over' : 'under'} the bank.` : n ? `It adds up. ${n} to check.` : 'It matches the bank.'}`);
      },
    };
  }
  // ---------- undoing an import ----------
  function legacyImportGroups() {
    // imports made before batches were recorded: group bank-imported transactions by account and time
    const groups = {};
    for (const t of D.tx) {
      if (!t.ik || t.imp || t.impd) continue;
      const k = t.acct + '|' + Math.round((t.ts || 0) / 10000);
      (groups[k] = groups[k] || { acct: t.acct, ts: t.ts || 0, ids: [] }).ids.push(t.id);
    }
    return Object.entries(groups).map(([k, g]) => Object.assign({ key: k }, g)).sort((a, b) => b.ts - a.ts);
  }
  function importsListHTML() {
    const when = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const batches = Object.values(S.items('imports')).sort((a, b) => b.ts - a.ts);
    const legacy = legacyImportGroups();
    if (!batches.length && !legacy.length) return '';
    let html = '<h3>Recent imports</h3><ul class="imp-list">';
    html += batches.map((b) => {
      const nAdd = (b.added || []).filter((id) => D.txById[id]).length, nCh = Object.keys(b.changed || {}).length;
      return `<li><span><b>${esc(b.file)}</b> · ${esc(acctName(b.acct))} · ${esc(when(b.ts))}<br><small class="muted">${nAdd} added${nCh ? `, ${nCh} matched or updated` : ''}</small></span><button class="btn xs" data-action="undo-import" data-id="${b.id}">Undo</button></li>`;
    }).join('');
    html += legacy.map((g) => `<li><span><b>Earlier import</b> · ${esc(acctName(g.acct))} · ${g.ts ? esc(when(g.ts)) : 'unknown time'}<br><small class="muted">${g.ids.length} ${g.ids.length === 1 ? 'transaction' : 'transactions'}</small></span><button class="btn xs" data-action="legacy-import" data-key="${esc(g.key)}">Review & remove</button></li>`).join('');
    return html + '</ul>';
  }
  function openUndoImport(id) {
    const b = S.items('imports')[id];
    if (!b) return;
    const added = (b.added || []).map((x) => D.txById[x]).filter(Boolean);
    const changed = Object.keys(b.changed || {}).filter((x) => D.txById[x]);
    const edited = added.filter((t) => (t.ts || 0) > b.ts + 5000).length;
    openSheet({
      title: 'Undo import',
      body: `<p>This removes the <b>${added.length}</b> ${added.length === 1 ? 'transaction' : 'transactions'} added from <b>${esc(b.file)}</b> into ${esc(acctName(b.acct))}${changed.length ? `, and puts the <b>${changed.length}</b> ${changed.length === 1 ? 'transaction' : 'transactions'} it matched or updated back exactly as they were before` : ''}${(b.removed || []).length ? `. The <b>${b.removed.length}</b> released pending ${b.removed.length === 1 ? 'charge it removed comes' : 'charges it removed come'} back too` : ''}.</p>
        ${edited ? `<p class="hint warn">You've changed ${edited} of the added transactions since importing. They'll be removed too.</p>` : ''}
        <p class="hint">You can import the file again afterwards.</p>`,
      foot: '<button class="btn danger" data-saction="yes">Undo this import</button><button class="btn" data-saction="no">Cancel</button>',
    });
    sheet.actions = {
      no: closeSheet,
      yes: async () => {
        const removes = [];
        for (const t of added) { removes.push(t); if (t.pair && D.txById[t.pair]) removes.push(D.txById[t.pair]); }
        const restores = changed.map((x) => Object.assign({}, D.txById[x], b.changed[x]));
        (b.removed || []).forEach((t) => { if (!D.txById[t.id]) restores.push(t); }); // released holds it removed come back
        await putTxs(restores, removes);
        await guard(S.write('meta', 'imports', { items: { [id]: null } }));
        closeSheet(); toast(`Import undone: removed ${added.length}${restores.length ? `, restored ${restores.length}` : ''}.`); render();
      },
    };
  }
  function openLegacyImport(key) {
    const g = legacyImportGroups().find((x) => x.key === key);
    if (!g) return;
    const list = g.ids.map((x) => D.txById[x]).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));
    const chosen = new Set(list.map((t) => t.id));
    openSheet({
      title: 'Remove an earlier import',
      wide: true,
      body: `<p>These transactions came from one bank import into ${esc(acctName(g.acct))}. This import happened before full undo was available, so any of <b>your own entries</b> that it matched are in this list too. <b>Untick those</b> to keep them.</p>
        <ul class="rc-list">${list.map((t) => `<li><label class="check"><input type="checkbox" data-pick="${t.id}" checked><span>${esc(dateLabel(t.date))}</span><span>${esc(t.payee || '')} <small class="muted">${esc(t.bank || '')}</small></span><b class="${t.amt > 0 ? 'pos' : ''}">${signed(t.amt)}</b></label></li>`).join('')}</ul>`,
      foot: `<button class="btn danger" data-saction="yes" id="legacy-go">Remove ${list.length} ${list.length === 1 ? 'transaction' : 'transactions'}</button><button class="btn" data-saction="no">Cancel</button>`,
    });
    sheet.onChange = (el) => {
      if (!el.dataset.pick) return;
      if (el.checked) chosen.add(el.dataset.pick); else chosen.delete(el.dataset.pick);
      $('#legacy-go').textContent = `Remove ${chosen.size} ${chosen.size === 1 ? 'transaction' : 'transactions'}`;
    };
    sheet.actions = {
      no: closeSheet,
      yes: async () => {
        const removes = [];
        for (const x of chosen) { const t = D.txById[x]; if (!t) continue; removes.push(t); if (t.pair && D.txById[t.pair]) removes.push(D.txById[t.pair]); }
        await putTxs([], removes);
        closeSheet(); toast(`Removed ${removes.length} transactions.`); render();
      },
    };
  }

  function guessMap(st) {
    const h = (st.header || []).map((x) => String(x).toLowerCase());
    const find = (re) => { const i = h.findIndex((x) => re.test(x)); return i >= 0 ? i : undefined; };
    st.map = {
      date: find(/date|posted/),
      desc: find(/transaction details|desc|narrat|detail|memo|particular|reference|transaction$/),
      amt: find(/^amount|amount$|^value$|amount \(/),
      debit: find(/debit|withdraw|money out|paid out|spent/),
      credit: find(/credit|deposit|money in|paid in|received/),
      payee: find(/merchant name|^merchant$|^payee$/),
      bal: find(/balance/),
    };
    const sample = st.rows.slice(0, 30);
    const ncol = sample[0].length;
    if (st.map.date == null) for (let i = 0; i < ncol; i++) if (sample.every((r) => E.parseDate(r[i], 'dmy'))) { st.map.date = i; break; }
    if (st.map.amt == null && st.map.debit == null) for (let i = 0; i < ncol; i++) if (i !== st.map.date && sample.every((r) => !Number.isNaN(parseAmount(r[i])) && r[i] !== '')) { st.map.amt = i; break; }
    if (st.map.desc == null) {
      let best = -1, len = 0;
      for (let i = 0; i < ncol; i++) { if (i === st.map.date || i === st.map.amt) continue; const l = sample.reduce((s, r) => s + String(r[i] || '').length, 0); if (l > len) { len = l; best = i; } }
      if (best >= 0) st.map.desc = best;
    }
    if (st.map.amt != null) { st.map.debit = undefined; st.map.credit = undefined; }
    st.datefmt = (st.map.date != null && E.guessDateFormat(st.rows.map((r) => r[st.map.date]))) || 'dmy';
  }
  function parseAmount(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return 0;
    let neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /\bDR\b/i.test(s);
    if (/\bCR\b/i.test(s)) neg = false;
    const n = Number(s.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n) || s.replace(/[^0-9]/g, '') === '') return NaN;
    return Math.round(n * 100) * (neg ? -1 : 1);
  }
  function parseRows(st) {
    const m = st.map;
    return st.rows.map((r) => {
      let amt;
      if (m.amt != null) amt = parseAmount(r[m.amt]);
      else {
        const d = m.debit != null ? parseAmount(r[m.debit]) : 0, c = m.credit != null ? parseAmount(r[m.credit]) : 0;
        amt = (Number.isNaN(c) ? 0 : Math.abs(c)) - (Number.isNaN(d) ? 0 : Math.abs(d));
        if (Number.isNaN(d) && Number.isNaN(c)) amt = NaN;
      }
      if (st.flip && !Number.isNaN(amt)) amt = -amt;
      let bal = m.bal != null && String(r[m.bal] || '').trim() !== '' ? parseAmount(r[m.bal]) : NaN;
      if (st.flip && !Number.isNaN(bal)) bal = -bal;
      return { date: E.parseDate(r[m.date], st.datefmt), desc: String(r[m.desc] || '').trim(), amt, bal, payee: m.payee != null ? String(r[m.payee] || '').trim() : '' };
    });
  }

  // ---------- checking against the bank's own balances ----------
  // A bank file with a balance column says what the bank held at the end of each day. Keeping those lets the
  // app find the exact days where its balance and the bank's stopped agreeing.
  function dayBalances(rows) {
    const ok = rows.filter((r) => r.date && !Number.isNaN(r.amt) && Number.isFinite(r.bal));
    if (!ok.length) return null;
    const chron = newestFirst(ok) ? ok.slice().reverse() : ok;
    const out = {};
    chron.forEach((r) => (out[r.date] = r.bal)); // the last one each day is the end-of-day balance
    return out;
  }
  // files list newest first or oldest first: whichever way each balance follows from the one before
  function newestFirst(ok) {
    let newest = 0, oldest = 0;
    for (let i = 0; i + 1 < ok.length; i++) {
      if (ok[i].bal === ok[i + 1].bal + ok[i].amt) newest++;
      if (ok[i + 1].bal === ok[i].bal + ok[i + 1].amt) oldest++;
    }
    return newest === oldest ? ok[0].date > ok[ok.length - 1].date : newest > oldest;
  }
  async function saveDayBalances(acct, days, rows) {
    if (!days || !Object.keys(days).length) return;
    const merged = Object.assign({}, S.items('bankbal')[acct] || {}, days);
    await guard(S.write('meta', 'bankbal', { items: { [acct]: merged } }));
    // a short copy of each bank line (date, amount, first words) so the check can say which ones differ
    const ok = (rows || []).filter((r) => r.date && !Number.isNaN(r.amt));
    if (!ok.length) return;
    const lo = ok.reduce((m, r) => (r.date < m ? r.date : m), ok[0].date), hi = ok.reduce((m, r) => (r.date > m ? r.date : m), ok[0].date);
    const kept = ((S.items('bankrows')[acct] || {}).rows || []).filter((x) => x.slice(0, 10) < lo || x.slice(0, 10) > hi);
    const add = ok.map((r) => `${r.date}|${r.amt}|${String(r.desc || '').replace(/[|\s]+/g, ' ').trim().slice(0, 30)}`);
    await guard(S.write('meta', 'bankrows', { items: { [acct]: { rows: kept.concat(add).sort() } } }));
  }
  const bankDate = (t) => (t.match && t.match.posted) || t.posted || (t.match && t.match.date) || t.date;
  const dayGap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  // a card hold YNABB imported while pending ("POS …"), not yet taken by the bank; YNAB's pending-text entries are real
  const isHold = (t) => !!t.ik && t.cleared !== 'r' && E.isPending(t.bank);
  function balanceCheck(acct) {
    const bank = S.items('bankbal')[acct] || {};
    // before an account's first entry (its starting balance) YNABB knows nothing, so those days can't be compared
    const firstDate = D.tx.reduce((m, t) => (t.acct === acct && (!m || t.date < m) ? t.date : m), '');
    const dates = Object.keys(bank).filter((d) => firstDate && d >= firstDate).sort();
    if (!dates.length) return null;
    // only what the bank can see: not uncleared entries, not pending card holds
    const txs = D.tx.filter((t) => t.acct === acct && t.cleared !== 'u' && !isHold(t)).map((t) => ({ t, d: bankDate(t) })).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    let i = 0, run = 0;
    const days = dates.map((d) => { while (i < txs.length && txs[i].d <= d) run += txs[i++].t.amt; return { d, bank: bank[d], ours: run, diff: run - bank[d] }; });
    const dayOf = {}; days.forEach((x) => (dayOf[x.d] = x));
    // the gap wobbles while a purchase is dated differently here and at the bank; only a gap that stays put matters
    const runs = [];
    for (const x of days) { const l = runs[runs.length - 1]; if (l && l.diff === x.diff) l.end = x.d; else runs.push({ diff: x.diff, start: x.d, end: x.d }); }
    const stable = [];
    runs.forEach((r, k) => {
      const next = runs[k + 1], span = next ? (Date.parse(next.start) - Date.parse(r.start)) / 864e5 : Infinity;
      if (span < 5) return;
      const l = stable[stable.length - 1];
      if (l && l.diff === r.diff) l.end = r.end; else stable.push(Object.assign({}, r));
    });
    // problems that sorted themselves out don't matter: start from the last time it matched the bank exactly
    let z = -1;
    stable.forEach((r, k) => { if (r.diff === 0) z = k; });
    const matchedUntil = z >= 0 ? stable[z].end : null;
    if (z > 0) stable.splice(0, z);
    const upto = matchedUntil ? txs.filter((x) => x.d <= matchedUntil) : [];
    const lastTx = upto.length ? upto[upto.length - 1].t : null;
    // line by line: pair each bank line with a YNABB transaction of the same amount within 10 days
    const brows = ((S.items('bankrows')[acct] || {}).rows || []).map((x) => { const [d, a, ...r] = x.split('|'); return { d, amt: Number(a), desc: r.join(' ') }; }).filter((r) => r.d >= dates[0]);
    let onlyBank = [], onlyOurs = [];
    if (brows.length) {
      const byAmt = {};
      txs.forEach((x) => { if (x.d >= brows[0].d && x.d <= brows[brows.length - 1].d) (byAmt[x.t.amt] = byAmt[x.t.amt] || []).push(x); });
      const used = new Set();
      for (const r of brows) {
        // the copy imported from the bank wins over one entered by hand, then the closest date
        let best = null, bs = 1e9;
        for (const x of byAmt[r.amt] || []) { if (used.has(x.t.id)) continue; const g = dayGap(x.d, r.d), sc = g + (x.t.ik ? 0 : 20); if (g <= 10 && sc < bs) { best = x; bs = sc; } }
        if (best) used.add(best.t.id); else onlyBank.push(r);
      }
      onlyOurs = Object.values(byAmt).flat().filter((x) => !used.has(x.t.id));
    }
    const shop = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0] || '';
    const steps = [];
    if (stable.length && stable[0].diff) steps.push({ before: true, from: null, to: stable[0].start, change: stable[0].diff });
    for (let k = 1; k < stable.length; k++) steps.push({ from: stable[k - 1].end, to: stable[k].start, change: stable[k].diff - stable[k - 1].diff });
    steps.forEach((p) => {
      p.ids = [];
      if (p.before) return;
      p.lo = new Date(Date.parse(p.from) - 7 * 864e5).toISOString().slice(0, 10); // purchases can show here up to a week before the bank takes them
      p.a = dayOf[p.from]; p.b = dayOf[p.to];
      p.txs = txs.filter((x) => x.d > p.from && x.d <= p.to).map((x) => x.t);
      if (brows.length) {
        const ours = onlyOurs.filter((x) => x.d > p.from && x.d <= p.to).map((x) => x.t), theirs = onlyBank.filter((r) => r.d > p.from && r.d <= p.to);
        // the same shopping with a different amount here and at the bank
        p.differ = [];
        for (const t of ours.slice()) {
          const r = theirs.find((r) => shop(r.desc.replace(/^(V\d+|EFTPOS|POS)\s+[\d/:\s]*/i, '')) === shop(t.payee) && dayGap(r.d, bankDate(t)) <= 10 && Math.sign(r.amt) === Math.sign(t.amt));
          if (r) { p.differ.push({ t, r }); ours.splice(ours.indexOf(t), 1); theirs.splice(theirs.indexOf(r), 1); }
        }
        p.ours = ours; p.theirs = theirs;
        const net = ours.reduce((s, t) => s + t.amt, 0) - theirs.reduce((s, r) => s + r.amt, 0) + p.differ.reduce((s, x) => s + x.t.amt - x.r.amt, 0);
        p.explained = net === p.change;
        p.ids = ours.map((t) => t.id).concat(p.differ.map((x) => x.t.id));
      } else {
        // no bank lines kept: look for one, two or three transactions that add up to exactly the gap
        const L = p.txs, n = L.length;
        const find = () => {
          for (let a = 0; a < n; a++) if (L[a].amt === p.change) return [L[a]];
          for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (L[a].amt + L[b].amt === p.change) return [L[a], L[b]];
          if (n <= 80) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) if (L[a].amt + L[b].amt + L[c].amt === p.change) return [L[a], L[b], L[c]];
          return null;
        };
        p.combo = find();
        p.ids = (p.combo || []).map((t) => t.id);
      }
    });
    return { days, steps, matchedUntil, lastTx, hasRows: !!brows.length, last: days[days.length - 1], first: days[0], settled: stable[stable.length - 1] };
  }
  function bcFlags() {
    const res = UI.bc ? balanceCheck(UI.bc.acct) : null;
    const out = {};
    if (res) res.steps.forEach((p, k) => { if (UI.bc.step == null || UI.bc.step === k) p.ids.forEach((id) => (out[id] = [['Check', 'Likely part of why YNABB and the bank stopped matching']])); });
    return out;
  }
  function bcSince(acct) {
    const res = balanceCheck(acct);
    return res && res.lastTx ? res.lastTx.date : '';
  }
  function openBankCheck(acct) {
    acct = acct && D.accounts[acct] ? acct : UI.f.acct && D.accounts[UI.f.acct] ? UI.f.acct : (Object.values(D.accounts).find((a) => !a.closed && a.type !== 'tracking') || {}).id;
    if (!acct) { toast('Add an account first.'); return; }
    UI.bc = { acct, step: null };
    UI.view = 'tx'; UI.only = null; UI.q = ''; UI.f = Object.assign(NO_FILTERS(), { acct, from: bcSince(acct) }); UI.sel = null;
    saveUI(); render(); window.scrollTo(0, 0);
  }
  async function bcLoadFile(acct, file) {
    const rows = E.parseCSV(await file.text());
    const first = rows[0] || [];
    const st = { header: first.every((v) => !E.parseDate(v, 'dmy') && Number.isNaN(Number(String(v).replace(/[$,\s]/g, ''))) || v === '') ? first : null };
    st.rows = st.header ? rows.slice(1) : rows;
    if (!st.rows.length) { toast('That file has no transactions.'); return; }
    const saved = D.accounts[acct].csvMap;
    if (saved && saved.cols === st.rows[0].length && saved.map.bal != null) { st.map = Object.assign({}, saved.map); st.flip = !!saved.flip; st.datefmt = saved.datefmt || 'dmy'; }
    else { guessMap(st); if (saved && saved.cols === st.rows[0].length) st.flip = !!saved.flip; }
    if (st.map.bal == null) { toast("That file doesn't have a balance column, so there's nothing to compare."); return; }
    const parsed = parseRows(st), days = dayBalances(parsed);
    if (!days) { toast("Couldn't read the balances in that file."); return; }
    await saveDayBalances(acct, days, parsed);
    D = snapshot();
    UI.bc.step = null; UI.f.to = ''; UI.f.from = bcSince(acct);
    toast(`Read ${parsed.length} bank lines.`);
    render();
  }
  function bcPanel() {
    const acct = UI.bc.acct, a = D.accounts[acct];
    if (!a) return '';
    const res = balanceCheck(acct);
    const x = '<button class="rb-x" data-action="bc-close" aria-label="Close" title="Close">&times;</button>';
    const fileIn = '<input type="file" id="bc-file" accept=".csv,.txt,text/csv" hidden>';
    if (!res) return `<div class="bc-panel"><header><b>Check ${esc(a.name)} against the bank</b>${x}</header>
      <p>Choose a CSV file from your bank. It isn't imported: the app compares the bank's balance each day, and each bank line, with its own, to show exactly where they stopped agreeing. In NAB, open the account, choose Export and pick CSV, going back to before you think things went wrong.</p>
      <p><label class="btn sm primary" for="bc-file">Choose a bank file</label>${fileIn}</p></div>`;
    const L = res.last, steps = res.steps;
    const lineT = (t, note) => `<li><button class="bc-line" data-action="bc-go" data-id="${t.id}" data-q="${esc(bcKey(t.payee || tidyPayee(t.bank || '')))}" title="Find every ${esc(t.payee || '')} in ${esc(a.name)}"><span class="d">${esc(dateLabel(t.date))}</span><span class="p">${esc(t.payee || t.bank || '')}${note ? ` <small>${note}</small>` : ''}</span><b>${signed(t.amt)}</b></button></li>`;
    const lineB = (r) => `<li class="bc-row"><button class="bc-line" data-action="bc-go" data-q="${esc(bcKey(tidyPayee(r.desc)))}" title="Search YNABB for this"><span class="d">${esc(dateLabel(r.d))}</span><span class="p">${esc(r.desc)}</span><b>${signed(r.amt)}</b></button><button class="btn xs primary" data-action="bc-add" data-d="${r.d}" data-amt="${r.amt}" data-desc="${esc(r.desc)}" title="Add this bank line to YNABB">Add to YNABB</button></li>`;
    if (UI.bc.find != null) return `<div class="bc-panel bc-mini"><b>Checking ${esc(a.name)} against the bank</b><span>Showing every transaction matching <b>&ldquo;${esc(UI.q)}&rdquo;</b>. Look for the same purchase twice.</span><button class="btn sm primary" data-action="bc-back">&larr; Back to the differences</button>${x}</div>`;
    let html = `<div class="bc-panel"><header><b>Checking ${esc(a.name)} against the bank</b>${x}</header>`;
    if (!steps.length && !L.diff) {
      const done = a.reconciledAt && a.reconciledAt >= L.d;
      html += `<div class="bc-ok"><b>Matches the bank &#10003;</b><span>From ${esc(dateLabel(res.first.d))} to ${esc(dateLabel(L.d))}, ${esc(a.name)} matches the bank's balance.</span>
        ${done ? `<span>Reconciled to ${esc(dateLabel(L.d))}.</span>` : `<span><button class="btn primary" data-action="bc-lock">Lock it in</button> marks everything up to ${esc(dateLabel(L.d))} as reconciled.</span>`}</div>`;
    } else {
      html += `<div class="bc-top">
        <div class="bc-now ${L.diff ? 'bad' : ''}"><small>On ${esc(dateLabel(L.d))}</small><b>${L.diff ? `Out by ${money(Math.abs(L.diff))}` : 'Matches now'}</b><span>Bank ${money(L.bank)} · YNABB ${money(L.ours)}</span></div>
        ${res.lastTx ? `<div class="bc-last"><small>Last time everything matched</small><b>${esc(dateLabel(res.matchedUntil))}</b><span>Both had ${money(dayOfBal(res))}, straight after <button class="linkish" data-action="bc-go" data-id="${res.lastTx.id}">${esc(res.lastTx.payee || 'this')} ${signed(res.lastTx.amt)}</button></span></div>` : ''}
      </div>`;
      const fixable = steps.filter((p) => p.explained).length;
      if (fixable) html += `<div class="bc-fixall"><span>${fixable === steps.length ? `YNABB found the cause of every difference.` : `YNABB found the cause of ${fixable} of the ${steps.length} differences.`} Check the list below, then:</span><button class="btn primary" data-action="bc-fix" data-k="">Fix ${fixable === 1 ? 'it' : `all ${fixable}`}</button></div>`;
      html += `<h4 class="bc-h">${res.lastTx ? `What changed since ${esc(dateLabel(res.matchedUntil))}` : 'What changed'}</h4><ol class="bc-steps">`;
      html += steps.map((p, k) => {
        const more = p.change > 0, amt = money(Math.abs(p.change));
        if (p.before) return `<li class="bc-card"><header><span class="when">Before ${esc(dateLabel(p.to))}</span><b class="${more ? 'pos' : 'neg'}">${more ? '+' : '&minus;'}${amt}</b></header><p>It was already out on the first day of your bank file. Add a bank file that goes back further, or check the starting balance.</p></li>`;
        const bk = p.b.bank - p.a.bank, us = p.b.ours - p.a.ours;
        let body = `<p class="bc-nums">Over these days the bank's balance changed by <b>${signed(bk)}</b> but YNABB's changed by <b>${signed(us)}</b>, so YNABB ${more ? 'gained' : 'lost'} <b>${amt}</b> more than it should have.</p>`;
        if (res.hasRows) {
          const why = (t) => { const o = bcKeeper(t, res); return o ? `${t.ik ? '' : 'entered by hand, '}${o.amt === t.amt ? `also here on ${esc(dateLabel(o.date))}: probably counted twice` : `the bank's copy on ${esc(dateLabel(o.date))} is ${esc(signed(o.amt))}: probably the same purchase`}${(t.memo || '').replace(/\s*\uD83D\uDD39.*$/, '').trim() ? '. Its note moves across' : ''}` : t.ik ? '' : 'entered by hand'; };
          if (p.ours.length) body += `<div class="bc-grp"><span class="tag ours">In YNABB, not at the bank</span><ul>${p.ours.map((t) => lineT(t, why(t))).join('')}</ul></div>`;
          if (p.theirs.length) body += `<div class="bc-grp"><span class="tag bank">At the bank, missing from YNABB</span><ul>${p.theirs.map(lineB).join('')}</ul></div>`;
          if (p.differ.length) body += `<div class="bc-grp"><span class="tag diff">Different amount</span><ul>${p.differ.map(({ t, r }) => lineT(t, `bank says ${esc(signed(r.amt))}`)).join('')}</ul></div>`;
          body += p.explained ? `<p class="bc-yes">&#10003; Fixing ${p.ids.length + p.theirs.length === 1 ? 'this' : 'these'} closes the whole ${amt}.</p>`
            : p.ours.length || p.theirs.length || p.differ.length ? '<p class="hint">These are the differences found here, though they don\'t add up to the whole amount. Show these days and compare with your statement.</p>'
              : '<p class="hint">Every line matches here, so the difference is probably a date: something dated just outside these days. Show these days and compare with your statement.</p>';
        } else if (p.combo) {
          body += `<div class="bc-grp"><span class="tag ours">${p.combo.length === 1 ? 'Exactly the same amount' : `These ${p.combo.length} add up to exactly ${amt}`}</span><ul>${p.combo.map((t) => lineT(t, t.ik ? 'from the bank' : 'entered by hand')).join('')}</ul></div>
            <p class="hint">${more ? 'Money in YNABB the bank never got?' : 'Spending in YNABB the bank never took, or counted twice?'} Check ${p.combo.length === 1 ? 'it' : 'them'} against your statement.</p>`;
        } else body += `<p class="hint">Couldn't pin down which ones. Add your bank file again (below) so YNABB can compare line by line.</p>`;
        const on = UI.bc.step === k;
        return `<li class="bc-card${on ? ' on' : ''}"><header><span class="when">${esc(dateLabel(p.from))} &ndash; ${esc(dateLabel(p.to))}</span><b class="${more ? 'pos' : 'neg'}">${more ? '+' : '&minus;'}${amt}</b>
          <button class="btn xs${on ? ' on' : ''}" data-action="bc-step" data-k="${on ? '' : k}">${on ? 'Show all since it matched' : `Show these days (${p.txs.length})`}</button></header>${body}</li>`;
      }).join('') + '</ol>';
    }
    html += `<footer>${res.hasRows ? '' : '<b>Tip:</b> add the bank file again to see exactly which lines differ. '}<label class="linkish" for="bc-file">Add a bank file</label>${fileIn}</footer></div>`;
    return html;
  }
  // the copy that stays when t goes: the same amount within 45 days (bank copies first), or the same shop within a week at a slightly different amount
  function bcKeeper(t, res, claimed) {
    // each extra copy goes with one other copy: once one is taken, the next extra looks elsewhere
    if (!res.keep) {
      res.keep = {};
      const taken = new Set();
      res.steps.forEach((q) => (q.ours || []).forEach((x) => { const k = findKeeper(x, res, taken); if (k) { taken.add(k.id); res.keep[x.id] = k; } }));
    }
    return res.keep[t.id] || null;
  }
  function findKeeper(t, res, taken) {
    const extra = (x) => res.steps.some((q) => (q.ours || []).includes(x));
    const when = dateOff(t) || t.date; // the date in its bank text, when its own date is wrong
    const span = descDate(t) ? 7 : 14; // a written date is exact; without one, the bank can take up to two weeks
    const pool = D.tx.filter((x) => x.id !== t.id && x.acct === t.acct && !extra(x) && !taken.has(x.id) && dayGap(x.date, when) <= span)
      .sort((a, b) => (b.ik ? 1 : 0) - (a.ik ? 1 : 0) || dayGap(a.date, when) - dayGap(b.date, when));
    const key = bcKey(t.payee || tidyPayee(t.bank || ''));
    return pool.find((x) => x.amt === t.amt)
      || (key ? pool.find((x) => Math.sign(x.amt) === Math.sign(t.amt) && Math.abs(x.amt - t.amt) <= Math.max(100, Math.abs(t.amt) * 0.1) && bcKey(x.payee || tidyPayee(x.bank || '')) === key) : null) || null;
  }
  // one click: delete what the bank never had (keeping its category on the other copy), add what YNABB is missing, correct amounts
  async function bcFix(acct, which) {
    const res = balanceCheck(acct);
    if (!res) return;
    const list = res.steps.filter((p, k) => !p.before && p.explained && (which == null || which === k));
    const adds = [], ups = {}, removes = [];
    for (const p of list) {
      for (const t of p.ours) {
        const o = bcKeeper(t, res);
        if (o) {
          const k = carryInto(ups[o.id] || o, t);
          ups[o.id] = k;
        }
        removes.push(t);
      }
      for (const r of p.theirs) {
        const rule = ruleFor(r.desc, r.amt, acct, r.d);
        adds.push({ id: S.uid(), acct, date: r.d, amt: r.amt, bank: r.desc, payee: rule && rule.payee ? rule.payee : tidyPayee(r.desc), cat: rule ? rule.cat || null : null, memo: rule && rule.memo ? rule.memo : null, cleared: 'c', approved: false, by: myId() });
      }
      for (const { t, r } of p.differ) if (!(t.splits && t.splits.length)) ups[t.id] = Object.assign({}, ups[t.id] || t, { amt: r.amt });
    }
    if (!adds.length && !removes.length && !Object.keys(ups).length) return;
    S.newStep();
    await putTxs(adds.concat(Object.values(ups)), removes);
    S.newStep();
    D = snapshot(); UI.bc.step = null; UI.f.to = ''; UI.f.from = bcSince(acct);
    toast(`Fixed: ${removes.length ? `removed ${removes.length}` : ''}${removes.length && adds.length ? ', ' : ''}${adds.length ? `added ${adds.length} (waiting in Needs review)` : ''}${Object.keys(ups).length ? `${removes.length || adds.length ? ', ' : ''}updated ${Object.keys(ups).length}` : ''}. ${MAC ? '⌘Z' : 'Ctrl+Z'} to undo.`);
    render();
  }
  // everything matches: mark it all reconciled up to the bank's last day
  async function bcLock(acct, quiet) {
    const res = balanceCheck(acct);
    if (!res || res.last.diff) return false;
    const L = res.last, a = D.accounts[acct];
    const list = D.tx.filter((t) => t.acct === acct && t.cleared !== 'r' && t.cleared !== 'u' && !isHold(t) && bankDate(t) <= L.d).map((t) => Object.assign({}, t, { cleared: 'r' }));
    if (list.length) await putTxs(list);
    await putAcct(Object.assign({}, a, { reconciledAt: L.d, reconciledBalance: L.bank }));
    if (!quiet) { UI.bc = null; UI.f.from = ''; UI.f.to = ''; toast(`${a.name} reconciled to ${dateLabel(L.d)}: ${money(L.bank)}, same as the bank.`); render(); }
    return true;
  }
  // the word to search for to see every copy of a purchase: "kmart", "woolworths", "need" (You Need A Budget)
  function bcKey(text) {
    const stop = /^(the|and|for|pty|ltd|online|card|purchase|eftpos|visa|debit|payment|transfer|griffith)$/;
    const words = String(text || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
    return words.find((w) => w.length >= 4 && !stop.test(w)) || words.find((w) => w.length >= 3 && !stop.test(w)) || words[0] || '';
  }
  const dayOfBal = (res) => { const d = res.days.find((x) => x.d === res.matchedUntil); return d ? d.bank : 0; };
  function bcMark(t) {
    if (!UI.bc || UI.bc.step != null) return '';
    const res = balanceCheck(UI.bc.acct);
    if (!res || !res.lastTx || res.lastTx.id !== t.id) return '';
    return `<div class="bc-mark">&#10003; YNABB and the bank last matched exactly here: both ${money(dayOfBal(res))} at the end of ${esc(dateLabel(res.matchedUntil))}</div>`;
  }
  function tidyPayee(desc) {
    // NAB starts card lines with the card code and date ("V1234 21/08 BOOST PREPAID…"), or "POS"/"EFTPOS" and a time
    const words = cleanDesc(desc).replace(/\b[A-Za-z]*\d[A-Za-z\d]*\b/g, ' ').replace(/\b(card|purchase|pos|eftpos|visa|debit|tap|pay|online|value date|xx+\d*)\b/gi, ' ').replace(/[^A-Za-z&' ]+/g, ' ').trim().split(/\s+/).slice(0, 3);
    return words.map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ').trim() || String(desc || '').slice(0, 30);
  }

  // ---------- accounts ----------
  const ATYPES = { checking: 'Everyday / checking', savings: 'Savings', cash: 'Cash', credit: 'Credit card', bnpl: 'Buy now, pay later (Afterpay, Zip)', loan: 'Loan (car, personal, mortgage) or line of credit', other: 'Other', tracking: 'Tracking (investments, super, crypto)' };
  const ASHORT = { credit: 'Credit card', bnpl: 'Buy now, pay later', loan: 'Loan', tracking: 'Tracking' };
  const owingOf = (id) => Math.max(0, -((D.bal[id] || {}).balance || 0));
  const payAvail = (id) => (D.debt[id] && D.month.rows[D.debt[id]] ? D.month.rows[D.debt[id]].available : 0);

  // every card and loan gets a payment category in a "Debt payments" group at the top of the budget.
  // Saving an account re-renders, and the render's own check can start this too: both share one job, or each would add one.
  const payCatJobs = {};
  function ensurePayCat(a) {
    return payCatJobs[a.id] || (payCatJobs[a.id] = makePayCat(a).finally(() => delete payCatJobs[a.id]));
  }
  async function makePayCat(a) {
    D = snapshot();
    const cats = Object.values(D.cats);
    let cat = cats.find((c) => c.debtFor === a.id);
    if (cat) {
      if (cat.name !== a.name || cat.hidden) await putCat(Object.assign({}, cat, { name: a.name, hidden: false }));
      return cat.id;
    }
    let group = cats.find((c) => !c.parent && cats.some((k) => k.parent === c.id && k.debtFor));
    if (!group) {
      group = { id: S.uid(), name: 'Debt payments', parent: null, order: cats.filter((c) => !c.parent).reduce((m, c) => Math.min(m, c.order || 0), 1) - 1, hidden: false, target: null, note: 'Money set aside to pay your credit cards and loans. Spending on a card moves here by itself.', kind: 'save' };
      await putCat(group);
    }
    const sib = cats.filter((c) => c.parent === group.id);
    const id = S.uid();
    await putCat({ id, name: a.name, parent: group.id, order: sib.reduce((m, c) => Math.max(m, c.order || 0), 0) + 1, hidden: false, target: a.type !== 'credit' && a.payment > 0 ? payTarget(a) : null, note: '', debtFor: a.id });
    return id;
  }

  function viewAccounts() {
    const accts = Object.values(D.accounts).sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0) || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
    const balOf = (a) => (D.bal[a.id] ? D.bal[a.id].balance : 0);
    const cash = accts.filter((a) => a.type !== 'tracking' && !DEBT_TYPES[a.type]), debts = accts.filter((a) => DEBT_TYPES[a.type]), track = accts.filter((a) => a.type === 'tracking');
    const tot = (l) => l.filter((a) => !a.closed).reduce((s, a) => s + balOf(a), 0);
    const cTotal = tot(cash), dTotal = tot(debts), tTotal = tot(track), owingAll = Math.max(0, -dTotal);
    const recd = (a) => (a.reconciledAt ? `${a.type === 'tracking' ? 'updated' : 'reconciled'} ${esc(dateLabel(a.reconciledAt))}` : a.type === 'tracking' ? 'not updated yet' : 'never reconciled');
    const more = (a) => `<button class="icon-btn ar-more" data-acct-more="${a.id}" aria-label="More for ${esc(a.name)}" title="More">&hellip;</button>`;
    const nameBtn = (a) => `<button class="ar-name" data-action="acct-tx" data-id="${a.id}" title="Show its transactions">${esc(a.name)}</button>`;
    const cashRow = (a) => {
      const b = D.bal[a.id] || { balance: 0, uncleared: 0, unclearedCount: 0, review: 0 };
      const meta = [esc(ATYPES[a.type] ? ATYPES[a.type].split(' (')[0] : 'Account'), recd(a)];
      if (b.unclearedCount) meta.push(`${b.unclearedCount} not cleared`);
      return `<div class="ar${a.closed ? ' closed' : ''}" data-acct="${a.id}">
        <span class="ar-ic">${acctIcon(a)}</span>
        <div class="ar-main">${nameBtn(a)}<span class="ar-meta">${meta.join(' · ')}${a.closed ? ' · closed' : ''}${b.review ? ` · <b class="warn">${b.review} to review</b>` : ''}</span></div>
        <div class="ar-amt ${b.balance < 0 ? 'neg' : ''}">${money(b.balance)}</div>
        <div class="ar-act"><button class="btn xs" data-action="reconcile" data-id="${a.id}">${a.type === 'tracking' ? 'Update' : 'Import &amp; reconcile'}</button>${more(a)}</div>
      </div>`;
    };
    const debtRow = (a) => {
      const b = D.bal[a.id] || { balance: 0, review: 0 };
      const owing = Math.max(0, -b.balance), ready = payAvail(a.id);
      const pc = D.debt[a.id], ti = pc && D.month.rows[pc] ? D.month.rows[pc].target : null;
      const meta = [esc(ASHORT[a.type])];
      if (a.rate) meta.push(`${a.rate}%`); else if (a.type === 'bnpl') meta.push('no interest');
      if (a.payment) meta.push(paySay(a));
      if (a.minPay != null && a.minPay !== a.payment) meta.push(`min ${money(a.minPay)}`);
      if (a.limit) meta.push(`${money(Math.max(0, a.limit - owing))} credit left`);
      // the bar: a card is covered when everything owed has money waiting; a loan when this month's repayment is
      let pct, say, ok;
      if (!owing) { pct = 1; say = 'Nothing owed'; ok = true; }
      else if (a.type === 'credit' || !ti) { pct = Math.min(1, Math.max(0, ready) / owing); ok = ready >= owing; say = ok ? 'Ready to pay it all' : `${money(Math.max(0, ready))} ready to pay`; }
      else { const need = ti.need || 0; pct = need ? Math.min(1, Math.max(0, need - ti.under) / need) : 1; ok = ti.under === 0; say = ok ? `This month's ${money(need)} is covered` : `${money(ti.under)} more needed for this month`; }
      return `<div class="ar debt${a.closed ? ' closed' : ''}" data-acct="${a.id}">
        <span class="ar-ic">${acctIcon(a)}</span>
        <div class="ar-main">${nameBtn(a)}<span class="ar-meta">${meta.join(' · ')}${b.review ? ` · <b class="warn">${b.review} to review</b>` : ''}</span>
          <div class="ar-bar" title="${esc(say)}"><i style="width:${Math.round(pct * 100)}%" class="${ok ? 'ok' : ''}"></i></div><span class="ar-say ${ok ? 'ok' : ''}">${say}</span></div>
        <div class="ar-amt owe">${owing ? `<small>owing</small>${money(owing)}` : b.balance > 0 ? `<small>in credit</small>${money(b.balance)}` : 'Paid off'}</div>
        <div class="ar-act"><button class="btn xs" data-action="payoff" data-id="${a.id}">Payoff plan</button><button class="btn xs" data-action="reconcile" data-id="${a.id}">Import &amp; reconcile</button>${more(a)}</div>
      </div>`;
    };
    const tile = (label, amt, cls) => `<div class="at-tile ${cls || ''}"><span>${label}</span><b>${money(amt)}</b></div>`;
    const tiles = [tile(debts.length || track.length ? 'Cash' : 'All accounts', cTotal, 'cash')];
    if (debts.length) tiles.push(tile('Owing', owingAll, 'owe'));
    if (track.length) tiles.push(tile('Tracking', tTotal, 'trk'));
    if (debts.length || track.length) tiles.push(tile('Net worth', cTotal + dTotal + tTotal, cTotal + dTotal + tTotal < 0 ? 'nw neg' : 'nw'));
    const panel = (cls, title, right, rows, note) => `<section class="ap ${cls}"><header class="ap-h"><h2>${title}</h2>${note ? `<span class="hint">${note}</span>` : ''}<span class="ap-r">${right}</span></header><div class="ap-rows">${rows}</div></section>`;
    return `<div class="acc-top"><div class="at-tiles">${tiles.join('')}</div><button class="btn primary" data-action="add-acct">${ICON.plus} Add account</button></div>
      ${accts.length ? '' : '<p class="empty-note">Add the accounts you budget from: everyday, savings, credit cards, cash. Each starting balance goes into Ready to Assign.</p>'}
      ${cash.length ? panel('ap-cash', 'Bank accounts and cash', `<b>${money(cTotal)}</b>`, cash.map(cashRow).join('')) : ''}
      ${debts.length ? panel('ap-debt', 'Credit cards and loans', `<b>${money(owingAll)}</b> owing`, debts.map(debtRow).join(''), debts.length > 1 ? '<button class="linkish" data-action="debt-plan">Which to pay off first?</button>' : '') : ''}
      ${track.length ? panel('ap-trk', 'Tracking', `<b>${money(tTotal)}</b>`, track.map(cashRow).join(''), 'Balances only, not part of the budget') : ''}`;
  }

  function openAcct(id) {
    const a = id ? Object.assign({}, D.accounts[id]) : { id: S.uid(), name: '', type: 'checking', closed: false };
    const isNew = !id;
    const hasTx = !isNew && D.tx.some((t) => t.acct === id);
    const oldType = a.type;
    openSheet({
      title: isNew ? 'Add account' : 'Account',
      body: `<div class="field"><label for="ac-name">Name</label><input id="ac-name" value="${esc(a.name)}" placeholder="e.g. Joint everyday, Visa, Car loan" autocomplete="off"></div>
        <div class="field"><label for="ac-type">Type</label><select id="ac-type">${Object.keys(ATYPES).map((k) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${ATYPES[k]}</option>`).join('')}</select></div>
        ${isNew ? `<div class="grid2"><div class="field"><label for="ac-bal" id="ac-bal-l">Balance today</label><input id="ac-bal" class="cents" inputmode="numeric" autocomplete="off" placeholder="0.00"></div><div class="field"><label for="ac-date">As of</label><input id="ac-date" type="date" value="${E.todayISO()}"></div></div>
          <p class="hint" id="ac-hint"></p>` : ''}
        <div id="ac-debt">
          <div class="grid2">
            <div class="field"><label for="ac-pay">Repayment</label><input id="ac-pay" class="cents" inputmode="numeric" autocomplete="off" placeholder="optional" value="${a.payment ? box(a.payment) : ''}"></div>
            <div class="field" id="ac-every-f"><label for="ac-every">How often</label><select id="ac-every"><option value="m">Each month</option>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${a.payDay === d ? 'selected' : ''}>Every ${WEEKDAYS[d]}</option>`).join('')}</select></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="ac-rate">Interest rate (% a year)</label><input id="ac-rate" inputmode="decimal" placeholder="e.g. 19.99" value="${a.rate || ''}"></div>
            <div class="field"><label for="ac-min">Minimum payment each month</label><input id="ac-min" class="cents" inputmode="numeric" autocomplete="off" placeholder="${a.type === 'credit' ? 'from your statement' : 'same as the repayment'}" value="${a.minPay != null ? box(a.minPay) : ''}"></div>
          </div>
          <div class="grid2">
            <div class="field" id="ac-limit-f"><label for="ac-limit">Credit limit</label><input id="ac-limit" class="cents" inputmode="numeric" autocomplete="off" placeholder="optional" value="${a.limit ? box(a.limit) : ''}"></div>
          </div>
          <p class="hint">The minimum payment counts as a need in "Where this month's budget is going". Anything extra counts as freedom. For a loan, leave it blank to use the repayment. The repayment becomes the target for its payment category, so the budget asks for it each week or month.</p>
        </div>
        ${!isNew ? `<label class="check"><input type="checkbox" id="ac-closed" ${a.closed ? 'checked' : ''}> Closed (hide from lists, keep its history)</label>` : ''}`,
      foot: `<button class="btn primary" data-saction="save">${isNew ? 'Add account' : 'Save'}</button>${!isNew && !hasTx ? '<button class="btn danger" data-saction="delete">Delete</button>' : ''}`,
    });
    const sync = () => {
      const t = $('#ac-type').value, dbt = !!DEBT_TYPES[t];
      $('#ac-debt').hidden = !dbt;
      $('#ac-limit-f').hidden = t !== 'credit';
      $('#ac-every-f').hidden = t === 'credit';
      if (isNew) {
        $('#ac-bal-l').textContent = dbt ? 'Amount owing today' : t === 'tracking' ? 'Value today' : 'Balance today';
        $('#ac-hint').textContent = dbt ? 'What you owe, as a positive number. It doesn\'t come out of Ready to Assign. A payment category is added to your budget to pay it off.'
          : t === 'tracking' ? 'A tracking account\'s balance stays out of the budget.' : 'This money becomes Ready to Assign.';
      }
    };
    sync();
    $('#ac-type').addEventListener('change', sync);
    setTimeout(() => $('#ac-name') && isNew && $('#ac-name').focus(), 50);
    sheet.actions = {
      save: async () => {
        a.name = $('#ac-name').value.trim();
        if (!a.name) { toast('Give the account a name.'); return; }
        a.type = $('#ac-type').value;
        const dbt = !!DEBT_TYPES[a.type];
        if (dbt) {
          const rate = parseFloat(($('#ac-rate').value || '').replace(/[^0-9.]/g, ''));
          a.rate = rate > 0 ? Math.round(rate * 100) / 100 : null;
          const pay = E.parseMoney($('#ac-pay').value); a.payment = pay > 0 ? pay : null;
          const ev = $('#ac-every').value; a.payDay = a.type !== 'credit' && ev !== 'm' ? Number(ev) : null;
          const lim = a.type === 'credit' ? E.parseMoney($('#ac-limit').value) : 0; a.limit = lim > 0 ? lim : null;
          const mn = ($('#ac-min').value || '').trim(); a.minPay = mn ? Math.max(0, E.parseMoney(mn) || 0) : null;
        }
        if (!isNew) a.closed = $('#ac-closed').checked;
        if (isNew) a.order = Object.keys(D.accounts).length + 1;
        const was = isNew ? null : Object.assign({}, D.accounts[a.id]);
        await putAcct(a);
        if (dbt) {
          const pc = await ensurePayCat(a);
          // a target that followed the old repayment (or none at all) follows the new one, weekly or monthly
          D = snapshot();
          const ct = D.cats[pc] && D.cats[pc].target;
          const followed = !ct || (was && was.payment && ((ct.type === 'monthly' && ct.amount === was.payment) || (ct.type === 'weekly' && ct.amount === was.payment)));
          const changed = !was || was.payment !== a.payment || (was.payDay == null ? null : was.payDay) !== a.payDay;
          if (!isNew && a.type !== 'credit' && a.payment > 0 && followed && changed) await putCat(Object.assign({}, D.cats[pc], { target: payTarget(a) }));
        }
        else if (!isNew && DEBT_TYPES[oldType]) {
          // no longer a debt: its payment category becomes an ordinary category
          const c = Object.values(D.cats).find((k) => k.debtFor === a.id);
          if (c) await putCat(Object.assign({}, c, { debtFor: null }));
        }
        if (isNew) {
          let bal = E.parseMoney($('#ac-bal').value);
          if (dbt) bal = -Math.abs(bal);
          if (bal) await putTxs([{ id: S.uid(), acct: a.id, date: $('#ac-date').value || E.todayISO(), payee: 'Starting balance', cat: a.type === 'tracking' ? null : dbt ? START : INCOME, amt: bal, cleared: 'c', by: myId() }]);
        }
        closeSheet(); toast(isNew ? (dbt ? `Added ${a.name}, with a payment category in your budget` : `Added ${a.name}`) : 'Saved'); render();
      },
      delete: async () => {
        await guard(S.write('meta', 'accounts', { items: { [a.id]: null } }));
        const c = Object.values(D.cats).find((k) => k.debtFor === a.id);
        if (c) await putCat(Object.assign({}, c, { debtFor: null }));
        closeSheet(); toast('Account deleted'); render();
      },
    };
  }

  // ---------- paying off debt ----------
  // month by month: interest added, then the repayment. Returns months to clear it and the interest paid.
  function payoff(balance, ratePct, pay) {
    const r = (ratePct || 0) / 100 / 12;
    let b = balance, n = 0, interest = 0;
    if (b <= 0) return { months: 0, interest: 0 };
    if (pay <= Math.round(b * r)) return { never: true };
    while (b > 0 && n < 1200) { const i = Math.round(b * r); interest += i; b = b + i - pay; n++; }
    return { months: n, interest };
  }
  const whenFrom = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
  const howLong = (n) => { const y = Math.floor(n / 12), m = n % 12; return [y ? `${y} ${y === 1 ? 'year' : 'years'}` : '', m ? `${m} ${m === 1 ? 'month' : 'months'}` : ''].filter(Boolean).join(' ') || 'less than a month'; };

  function openPayoff(id) {
    const a = D.accounts[id];
    if (!a) return;
    const owing = owingOf(id), payCat = D.debt[id], card = a.type === 'credit';
    const tgt = payCat && D.cats[payCat].target && D.cats[payCat].target.type === 'monthly' ? D.cats[payCat].target.amount : 0;
    const often = card ? '' : `<div class="field"><label for="po-every">How often</label><select id="po-every"><option value="m">Each month</option>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${payWeekly(a) && a.payDay === d ? 'selected' : ''}>Every ${WEEKDAYS[d]}</option>`).join('')}</select></div>`;
    openSheet({
      title: 'Payoff plan: ' + a.name,
      body: `<p>You owe <b>${money(owing)}</b>${payCat ? `, and <b>${money(payAvail(id))}</b> is ready to pay it in the ${esc(D.cats[payCat].name)} payment category` : ''}.</p>
        <div class="grid2">
          <div class="field"><label for="po-pay">Repayment</label><input id="po-pay" class="cents" inputmode="numeric" autocomplete="off" value="${box(a.payment || tgt || Math.max(2500, Math.round(owing * 0.03)))}"></div>
          ${often}
        </div>
        <div class="grid2">
          <div class="field"><label for="po-rate">Interest rate (% a year)</label><input id="po-rate" inputmode="decimal" value="${a.rate || ''}" placeholder="e.g. 19.99"></div>
          <div class="field"><label for="po-extra" id="po-extra-l">Extra each month, to see what it saves</label><input id="po-extra" class="cents" inputmode="numeric" autocomplete="off" value="0"></div>
        </div>
        <div id="po-out"></div>
        ${card ? '<p class="fine">Using the card for everyday spending is fine: that spending moves into the payment category by itself, so pay the card from there. This plan is for the balance you already carry.</p>' : ''}`,
      foot: `${payCat ? '<button class="btn primary" data-saction="target" id="po-tgt">Make it the target</button>' : ''}<button class="btn" data-saction="save">Save repayment</button>`,
    });
    // a weekly plan is typed in weeks; the payoff sums are monthly, and a month has 52/12 weeks on average
    const read = () => {
      const rate = parseFloat(($('#po-rate').value || '').replace(/[^0-9.]/g, '')) || 0;
      const pay = E.parseMoney($('#po-pay').value) || 0, extra = E.parseMoney($('#po-extra').value) || 0;
      const ev = $('#po-every') ? $('#po-every').value : 'm', day = ev === 'm' ? null : Number(ev);
      return { rate, pay, extra, day, per: day == null ? 'month' : 'week', k: day == null ? 1 : 52 / 12 };
    };
    const show = () => {
      const { rate, pay, extra, day, per, k } = read();
      $('#po-extra-l').textContent = `Extra each ${per}, to see what it saves`;
      if ($('#po-tgt')) $('#po-tgt').textContent = day == null ? 'Make it the monthly target' : `Make it the target: every ${WEEKDAYS[day]}`;
      if (!owing) { $('#po-out').innerHTML = '<p class="ok-line">Nothing owed.</p>'; return; }
      const base = payoff(owing, rate, Math.round(pay * k));
      let html;
      if (base.never) html = `<div class="warn-box">At ${money(pay)} a ${per} it never gets paid off: the interest (${money(Math.round(owing * rate / 1200))} a month) is more than the repayment.</div>`;
      else html = `<div class="po-res"><div><span>Debt-free</span><b>${whenFrom(base.months)}</b><small>${howLong(base.months)}</small></div><div><span>Interest you'd pay</span><b>${money(base.interest)}</b></div></div>`;
      if (extra > 0) {
        const more = payoff(owing, rate, Math.round((pay + extra) * k));
        if (!more.never) html += `<p class="po-save">Paying <b>${money(extra)} more</b> a ${per} (${money(pay + extra)}): debt-free in <b>${whenFrom(more.months)}</b>${base.never ? '' : `, <b>${howLong(base.months - more.months)} sooner</b>, saving <b>${money(base.interest - more.interest)}</b> in interest`}.</p>`;
      }
      if (!rate) html += '<p class="fine">Add the interest rate for a true picture. Afterpay and Zip charge no interest, only late fees.</p>';
      $('#po-out').innerHTML = html;
    };
    show();
    sheet.onInput = show;
    const keep = ({ rate, pay, day }) => putAcct(Object.assign({}, D.accounts[id], { rate: rate || null, payment: pay || null }, card ? {} : { payDay: day }));
    sheet.actions = {
      save: async () => { await keep(read()); toast('Saved'); closeSheet(); render(); },
      target: async () => {
        const r = read(), amount = r.pay + r.extra;
        if (!(amount > 0)) { toast('Enter a repayment amount.'); return; }
        await keep(r);
        await putCat(Object.assign({}, D.cats[payCat], { target: r.day == null ? { type: 'monthly', amount } : { type: 'weekly', amount, day: r.day } }));
        toast(`${D.cats[payCat].name} now asks for ${money(amount)} ${r.day == null ? 'each month' : `every ${WEEKDAYS[r.day]}`}`); closeSheet(); render();
      },
    };
  }

  // more than one debt: the two usual orders, side by side
  function openDebtPlan() {
    const ds = Object.values(D.accounts).filter((a) => DEBT_TYPES[a.type] && !a.closed && owingOf(a.id) > 0);
    const row = (a, i) => `<li><b>${i + 1}. ${esc(a.name)}</b><span>${money(owingOf(a.id))} owing${a.rate ? ` · ${a.rate}%` : a.type === 'bnpl' ? ' · no interest' : ' · rate not set'}</span></li>`;
    const aval = ds.slice().sort((a, b) => (b.rate || 0) - (a.rate || 0) || owingOf(a.id) - owingOf(b.id));
    const snow = ds.slice().sort((a, b) => owingOf(a.id) - owingOf(b.id));
    openSheet({
      title: 'Which debt to pay off first?',
      wide: true,
      body: `<p>Keep paying at least the minimum on every debt. Put anything extra on one debt at a time, and when it's gone, roll its repayment onto the next.</p>
        <div class="grid2 debt-orders">
          <div><h3>Highest interest first</h3><p class="fine">Saves the most money.</p><ol class="debt-list">${aval.map(row).join('')}</ol></div>
          <div><h3>Smallest balance first</h3><p class="fine">Quick wins that keep you going.</p><ol class="debt-list">${snow.map(row).join('')}</ol></div>
        </div>
        ${ds.some((a) => !a.rate && a.type !== 'bnpl') ? '<p class="hint">Add each interest rate (click the account name) so the first list is right.</p>' : ''}`,
    });
  }

  // Reconcile: every transaction in the account should add up to what the bank shows.
  // ---------- settings ----------
  // grouped cards of one-line rows: icon and label on the left, the control on the right
  const SET_IC = {
    cur: '<path d="M10 3v14M13.5 6.5c-.6-1-1.9-1.6-3.5-1.6-2 0-3.4 1-3.4 2.5 0 3.4 7 1.8 7 5.2 0 1.6-1.5 2.6-3.6 2.6-1.7 0-3.1-.7-3.7-1.8"/>',
    layout: '<rect x="2.5" y="4" width="11" height="9" rx="1.5"/><path d="M6 16h4"/><rect x="14.5" y="7" width="3.5" height="9" rx="1"/>',
    guide: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 114 1.6c-.9.6-1.8 1.1-1.8 2.3M10 14.2v.1"/>',
    bank: '<path d="M3 8l7-4.5L17 8M4.5 8.5v6M8.2 8.5v6M11.8 8.5v6M15.5 8.5v6M3 16.5h14"/>',
    payee: '<path d="M3.5 4.5h7l6 6-6 6-7-7z"/><circle cx="7" cy="8" r="1.2"/>',
    down: '<path d="M10 3v10M6 9.5l4 4 4-4M4 16.5h12"/>',
    sheet: '<rect x="3.5" y="3" width="13" height="14" rx="1.5"/><path d="M3.5 8h13M3.5 12.5h13M8.5 8v9"/>',
    up: '<path d="M10 13.5V3.5M6 7l4-4 4 4M4 16.5h12"/>',
    ynab: '<path d="M4 10h11M11 6l4 4-4 4"/><path d="M4 4v12"/>',
    share: '<circle cx="7" cy="7.5" r="2.5"/><circle cx="14" cy="8.5" r="2"/><path d="M2.5 16c.6-2.6 2.3-4 4.5-4s3.9 1.4 4.5 4M11.5 12.6c.7-.4 1.5-.6 2.5-.6 1.8 0 3 1.1 3.5 3"/>',
  };
  const setIc = (k) => `<span class="set-ic" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SET_IC[k]}</svg></span>`;
  // a row that is the whole button: label, a short line under it, and an arrow
  const setGo = (ic, label, sub, attrs, tag = 'button') => `<${tag} class="set-row go" ${attrs}>${setIc(ic)}<span class="set-t">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="set-arr" aria-hidden="true">${ICON.right}</span></${tag}>`;
  function viewSettings() {
    const cur = S.settings().currency || guessCurrency();
    const opts = (list, on) => list.map(([v, l]) => `<option value="${v}" ${on === v ? 'selected' : ''}>${l}</option>`).join('');
    const who = S.account || {};
    const you = S.mode === 'server' ? `<div class="set-card set-you">
        <span class="set-av" aria-hidden="true">${esc((who.name || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="set-t"><b>${esc(who.name)}</b>${who.budget ? `<small>${esc(who.budget.name)} budget</small>` : ''}</span>
        <span class="set-btns"><a class="btn sm" href="/account">${who.admin ? 'Account and admin' : 'Account'}</a><button class="btn sm" data-action="sign-out">Sign out</button></span>
      </div>` : `<div class="set-card"><div class="set-row">${setIc('share')}<span class="set-t">Share with your partner<small>In claude.ai, share this page and invite them as an Editor. ${S.mode === 'cloud' ? 'Syncing now.' : 'Saving in this browser only.'}</small></span></div></div>`;
    return `<section class="set"><div class="set-col">
      ${you}
      <h2>Display</h2>
      <div class="set-card">
        <label class="set-row" for="set-cur">${setIc('cur')}<span class="set-t">Currency</span><select id="set-cur" data-live="0">${opts(['AUD', 'NZD', 'USD', 'CAD', 'GBP', 'EUR', 'SGD', 'ZAR', 'INR'].map((c) => [c, c]), cur)}</select></label>
        <label class="set-row" for="set-layout">${setIc('layout')}<span class="set-t">Layout<small>Just this device</small></span><select id="set-layout" data-live="0">${opts([['auto', `Automatic (${detectedLayout() === 'phone' ? 'phone' : 'computer'})`], ['desktop', 'Computer'], ['phone', 'Phone']], layoutPref())}</select></label>
      </div>
      <h2>Help</h2>
      <div class="set-card">${setGo('guide', 'Guide and lessons', 'How budgeting works and how to use YNABB', 'data-action="guide"')}</div>
    </div><div class="set-col">
      <h2>Bank</h2>
      <div class="set-card">
        <label class="set-row" for="set-bankurl">${setIc('bank')}<span class="set-t">Bank login page<small>Adds an Open my bank button when importing</small></span></label>
        <div class="set-in"><input id="set-bankurl" type="url" inputmode="url" autocomplete="off" data-live="0" placeholder="https://ib.nab.com.au" value="${esc(S.settings().bankUrl || '')}"></div>
        ${setGo('payee', 'Payees and rules', 'Rename, merge and tidy bank descriptions', 'data-action="payees"')}
        <div class="set-imps">${importsListHTML() || '<h3>Recent imports</h3><p class="hint">No imports yet.</p>'}</div>
      </div>
      <h2>Backup and moving</h2>
      <div class="set-card">
        ${setGo('down', 'Download backup', 'Everything, as one .json file', 'data-action="export-json"')}
        ${setGo('sheet', 'Download transactions', 'A .csv for spreadsheets', 'data-action="export-csv"')}
        ${setGo('up', 'Restore from backup', 'Replaces the whole budget, after a check', 'for="restore-file"', 'label')}<input type="file" id="restore-file" accept=".json,application/json" hidden data-live="0">
        ${setGo('ynab', 'Move from YNAB', 'In YNAB: budget name › Export budget, then pick the .zip', 'for="ynab-file"', 'label')}<input type="file" id="ynab-file" accept=".zip,.csv,application/zip,text/csv" multiple hidden data-live="0">
      </div>
    </div>
    ${S.mode === 'server' && who.version ? `<p class="set-ver">YNABB ${esc(who.version)}</p>` : ''}
    </section>`;
  }

  async function exportJSON() {
    const data = JSON.stringify({ app: 'zero-line', version: 1, exportedAt: new Date().toISOString(), data: S.data }, null, 1);
    await offerFile('ynabb-backup-' + E.todayISO() + '.json', data);
  }
  async function exportCSV() {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Date', 'Account', 'Payee', 'Category', 'Amount', 'Bank description', 'Note', 'Cleared', 'Receipt'].join(',')];
    for (const t of D.tx.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) {
      const cat = t.transfer ? 'Transfer: ' + acctName(t.transfer) : t.splits && t.splits.length ? t.splits.map((p) => (p.cat ? catPath(p.cat) : 'Uncategorized') + ' ' + plain(p.amt)).join('; ') : t.cat ? catPath(t.cat) : '';
      lines.push([t.date, acctName(t.acct), t.payee, cat, plain(t.amt), t.bank, t.memo, { u: 'no', c: 'yes', r: 'reconciled' }[t.cleared || 'u'], t.receipt ? 'yes' : ''].map(q).join(','));
    }
    await offerFile('ynabb-transactions-' + E.todayISO() + '.csv', lines.join('\n'));
  }
  async function offerFile(name, data) {
    if (S.downloads) {
      try { await S.downloads.save({ filename: name, data }); toast('Saved ' + name); }
      catch (e) { if (e && e.code !== 'declined') toast('The file could not be saved here.'); }
      return;
    }
    openSheet({ title: 'Copy your backup', body: `<p>Downloads aren't available in this view. Copy this text into a file named ${esc(name)}.</p><textarea class="mono" rows="12" readonly>${esc(data)}</textarea>` });
  }
  // swap the whole budget for d, document by document
  async function replaceAll(d, onStep) {
    const jobs = [];
    for (const coll of ['meta', 'months', 'tx']) {
      const ids = new Set(Object.keys(S.data[coll] || {}).concat(Object.keys(d[coll] || {})));
      for (const docId of ids) jobs.push([coll, docId]);
    }
    let i = 0;
    for (const [coll, docId] of jobs) {
      let body = (d[coll] || {})[docId];
      if (!body) body = coll === 'tx' ? { t: {} } : coll === 'months' ? { assigned: {}, moves: {} } : coll === 'meta' && docId !== 'settings' ? { items: {} } : {};
      await S.replace(coll, docId, body);
      if (onStep) onStep(++i, jobs.length);
    }
  }

  // ---------- move from YNAB ----------
  // read the files inside a zip (stored or deflated) with the browser's own decompressor
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), out = [];
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const raw = u8.slice(start, start + size);
      let bytes = raw;
      if (method === 8) bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else if (method !== 0) continue;
      out.push({ name, text: dec.decode(bytes) });
    }
    return out;
  }
  async function openYnab(files) {
    let texts = [];
    try {
      for (const f of files) {
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip') texts = texts.concat(await unzip(await f.arrayBuffer()));
        else texts.push({ name: f.name, text: await f.text() });
      }
    } catch (e) { toast('That zip file could not be opened. Try unzipping it and choosing the two CSV files inside.'); return; }
    const plan = texts.find((x) => YNAB.kindOf(x.text) === 'plan'), reg = texts.find((x) => YNAB.kindOf(x.text) === 'register');
    if (!reg) { toast('No YNAB register found. Choose the zip from YNAB\'s Export budget, or its Register CSV.'); return; }
    let res;
    try { res = YNAB.convert(plan ? plan.text : '', reg.text, { uid: S.uid }); } catch (e) { toast('That export could not be read.'); return; }
    const r = res.report, chk = r.check;
    const accts = Object.values(res.accounts);
    const tgtIds = Object.keys(res.targets).sort((a, b) => {
      const ca = res.cats[a], cb = res.cats[b];
      return (res.cats[ca.parent].order - res.cats[cb.parent].order) || (ca.order - cb.order);
    });
    const have = D.tx.length + Object.keys(D.cats).length;
    const dl = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const ml = (m) => monthLabel(m);
    const body = `<p>From <b>${esc(reg.name.replace(/^.*\//, '').replace(/ - Register\.csv$/i, ''))}</b>. Nothing changes until you press the button at the bottom.</p>
      <div class="ynab-sum">
        <div><b>${r.txCount}</b><span>transactions, ${dl(r.from)} to ${dl(r.to)}${r.splits ? `, ${r.splits} split` : ''}${r.transfers ? `, ${r.transfers} transfers` : ''}</span></div>
        <div><b>${r.categories}</b><span>categories in ${r.groups} groups</span></div>
        <div><b>${chk.months}</b><span>months in your plan${r.firstMonth ? `, ${ml(r.firstMonth)} to ${ml(r.lastMonth)}` : ''}</span></div>
      </div>
      ${plan ? (chk.mismatched.length
        ? `<div class="warn-box">${chk.mismatched.length} category balances don't match YNAB exactly, for example ${esc(chk.mismatched[0].cat)} in ${ml(chk.mismatched[0].month)}: YNAB ${money(chk.mismatched[0].ynab)}, here ${money(chk.mismatched[0].zero)}.</div>`
        : `<p class="ok-line">${ICON.tick} Checked: every category's available amount matches YNAB in all ${chk.months} months.</p>`)
        : '<div class="warn-box">No Plan (budget) file was found, so only accounts, categories and transactions come across, not what you assigned each month.</div>'}
      ${r.covered ? `<p class="hint">YNAB cleared overspending at the end of each month and took it from Ready to Assign. YNABB keeps overspending in the category, so ${r.covered === 1 ? 'that 1 time is' : `those ${r.covered} times are`} brought in as money moved from Ready to Assign the next month. The totals come out the same.</p>` : ''}
      ${chk.uncategorized ? `<p class="hint warn">${chk.uncategorized} transactions in YNAB had no category (${money(Math.abs(chk.uncategorizedAmt))}). They come across uncategorized for you to sort out.</p>` : ''}

      <h3>Accounts</h3>
      <div class="ynab-tbl">${accts.map((a) => `<div class="ynab-row"><span>${esc(a.name)}</span><select data-yacct="${a.id}" aria-label="Type of ${esc(a.name)}">${Object.keys(ATYPES).map((k) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${esc(ATYPES[k])}</option>`).join('')}</select><b class="num">${money(res.balances[a.id] || 0)}</b></div>`).join('')}</div>
      <p class="fine">Accounts with no categorized transactions were set as tracking accounts, like in YNAB. Check the balances match YNAB.</p>

      <h3>Targets: add this much every month</h3>
      <p class="fine">YNAB's export doesn't include targets, so these come from what you usually assigned over your last ${Object.values(res.targets)[0] ? Object.values(res.targets)[0].of : 6} months. Change any amount or untick ones you don't want.</p>
      <label class="check"><input type="checkbox" id="yt-all" checked> All</label>
      <div class="ynab-tbl">${tgtIds.map((id) => `<div class="ynab-row tgt"><label class="check"><input type="checkbox" data-ytgt="${id}" checked><span>${esc(res.cats[id].name)}</span></label><span class="fine">${res.targets[id].times > 1 ? `${res.targets[id].times} of ${res.targets[id].of} months` : 'last month'}</span><input class="num cents" inputmode="numeric" autocomplete="off" data-yamt="${id}" value="${box(res.targets[id].amount)}" aria-label="Monthly target for ${esc(res.cats[id].name)}"></div>`).join('')}</div>

      <h3>Replace this budget</h3>
      <p>${have ? '<b>This replaces everything in YNABB</b> (categories, accounts, transactions and assigning) for you and your partner.' : 'This fills your empty budget.'} Your currency and layout settings stay. Learned payees and bank-import history are cleared.</p>
      ${have ? '<div class="row-btns"><button class="btn sm" data-saction="backup">Download a backup of the current budget first</button></div>' : ''}`;
    openSheet({ title: 'Move from YNAB', body, wide: true, foot: `<button class="btn ${have ? 'danger' : 'primary'}" data-saction="go">${have ? 'Replace my budget with this YNAB budget' : 'Bring in my YNAB budget'}</button><button class="btn" data-saction="no">Cancel</button>` });
    $('#yt-all').addEventListener('change', (ev) => document.querySelectorAll('[data-ytgt]').forEach((c) => { c.checked = ev.target.checked; }));
    sheet.actions = {
      no: closeSheet,
      backup: exportJSON,
      go: async () => {
        const d = res.data;
        document.querySelectorAll('[data-yacct]').forEach((sel) => { d.meta.accounts.items[sel.dataset.yacct].type = sel.value; });
        for (const id in d.meta.cats.items) d.meta.cats.items[id] = full(CAT_KEYS, d.meta.cats.items[id]);
        for (const id of tgtIds) {
          const on = $(`[data-ytgt="${id}"]`).checked, amt = E.parseMoney($(`[data-yamt="${id}"]`).value);
          if (on && amt > 0) d.meta.cats.items[id].target = fullTarget({ type: 'monthly', amount: amt });
        }
        for (const m in d.tx) for (const id in d.tx[m].t) d.tx[m].t[id] = full(TX_KEYS, d.tx[m].t[id]);
        d.meta.rules = { items: {} };
        d.meta.imports = { items: {} };
        if (S.data.meta.settings) d.meta.settings = S.data.meta.settings;
        setSheetFoot('<span class="hint" id="ynab-prog">Bringing in your budget…</span>');
        try {
          await replaceAll(d, (i, n) => { const el = $('#ynab-prog'); if (el) el.textContent = `Bringing in your budget… ${Math.round(i / n * 100)}%`; });
        } catch (e) { toast('Something went wrong part way. Try again, or restore your backup.'); return; }
        closeSheet();
        UI.month = E.monthOf(E.todayISO()); UI.view = 'budget'; UI.f = NO_FILTERS(); UI.q = ''; UI.only = null; UI.rec = null; UI.editTx = null; UI.sel = null;
        saveUI(); render(); window.scrollTo(0, 0);
        toast(`Brought in ${r.txCount} transactions, ${accts.length} accounts and ${r.categories} categories from YNAB`);
      },
    };
  }

  async function restore(file) {
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch (e) { toast('That file is not a YNABB backup.'); return; }
    if (!parsed || parsed.app !== 'zero-line' || !parsed.data) { toast('That file is not a YNABB backup.'); return; }
    openSheet({
      title: 'Restore from backup',
      body: `<p>This replaces the whole budget with the backup from ${esc(new Date(parsed.exportedAt).toLocaleString())}. Your partner sees the change too. Anything added since that backup is lost.</p>`,
      foot: '<button class="btn danger" data-saction="yes">Replace budget</button><button class="btn" data-saction="no">Cancel</button>',
    });
    sheet.actions = {
      no: closeSheet,
      yes: async () => {
        setSheetFoot('<span class="hint">Restoring…</span>');
        await replaceAll(parsed.data);
        closeSheet(); toast('Budget restored'); render();
      },
    };
  }

  // ---------- sheet plumbing ----------
  let sheet = null;
  function openSheet(o) {
    const root = $('#sheet');
    root.innerHTML = `<div class="sheet-back" data-action="close-sheet"></div>
      <div class="sheet${o.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <header class="sheet-h"><h2 id="sheet-title">${esc(o.title)}</h2><button class="icon-btn" data-action="close-sheet" aria-label="Close">×</button></header>
        <div class="sheet-b">${o.body || ''}</div>
        <footer class="sheet-f"${o.foot ? '' : ' hidden'}>${o.foot || ''}</footer>
      </div>`;
    root.hidden = false;
    document.documentElement.classList.add('noscroll');
    sheet = { actions: {}, refresh: o.refresh || null, onInput: null, onChange: null, onEnter: null };
  }
  function setSheetBody(html) { const b = $('#sheet .sheet-b'); if (b) b.innerHTML = html; }
  function setSheetFoot(html) { const f = $('#sheet .sheet-f'); if (f) { f.innerHTML = html; f.hidden = !html; } }
  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheet').innerHTML = '';
    document.documentElement.classList.remove('noscroll');
    sheet = null;
    if (pending) render();
  }

  // ---------- events ----------
  const actions = {
    nav: (el) => {
      if (el.dataset.nav === 'tx' && UI.view !== 'tx') { UI.only = null; UI.f = defaultFilters(); UI.q = ''; UI.limit = 150; UI.editTx = null; }
      UI.view = el.dataset.nav; saveUI(); render(); window.scrollTo(0, 0);
    },
    // the transactions behind a category's Spent this month (a group includes its subcategories)
    spent: (el) => {
      const m = UI.month, end = E.addMonths(m, 1) + '-01';
      const last = new Date(Date.parse(end) - 864e5).toISOString().slice(0, 10);
      UI.view = 'tx'; UI.only = null; UI.rec = null; UI.editTx = null; UI.sel = null; UI.multi = null; UI.q = '';
      // a card's payment category: its Spent is the spending on that card, so show the card's transactions
      const card = Object.keys(D.debt || {}).find((a) => D.debt[a] === el.dataset.id && D.accounts[a]);
      UI.f = Object.assign(NO_FILTERS(), card ? { acct: card } : { cat: el.dataset.id }, { from: m + '-01', to: last }); UI.showFilters = false;
      saveUI(); render(); window.scrollTo(0, 0);
    },
    'prev-month': () => { UI.month = E.addMonths(UI.month, -1); render(); },
    'next-month': () => { UI.month = E.addMonths(UI.month, 1); render(); },
    'this-month': () => { UI.month = E.monthOf(E.todayISO()); render(); },
    starter: addStarter,
    'add-group': () => promptNewCat(null),
    'add-sub': (el) => promptNewCat(el.dataset.id),
    'edit-cats': () => { UI.editCats = !UI.editCats; render(); },
    'toggle-hidden': () => { UI.showHidden = !UI.showHidden; render(); },
    'cat-up': (el) => moveCat(el.dataset.id, -1),
    'cat-down': (el) => moveCat(el.dataset.id, 1),
    toggle: (el) => { const id = el.dataset.id; if (UI.collapsed[id]) delete UI.collapsed[id]; else UI.collapsed[id] = 1; saveUI(); render(); },
    'collapse-all': () => {
      if (Object.keys(UI.collapsed).length) UI.collapsed = {};
      else D.tree.order.forEach((id) => { if (!D.tree.isLeaf(id)) UI.collapsed[id] = 1; });
      saveUI(); render();
    },
    bfilter: (el) => { UI.budgetFilter = el.dataset.v; UI.view = 'budget'; render(); },
    cat: (el) => (isPhone() && el.closest('.brow') && !UI.editCats ? toggleCatRow(el.dataset.id) : openCat(el.dataset.id)),
    'cat-edit': (el) => openCat(el.dataset.id),
    move: (el) => openMove(el.dataset.id),
    'auto-assign': autoAssign,
    'goto-review': () => { UI.view = 'tx'; UI.f = { acct: '', cat: '', from: '', to: '', min: '', max: '', status: 'review' }; UI.showFilters = false; saveUI(); render(); },
    'goto-uncat': () => { UI.view = 'tx'; UI.f = { acct: '', cat: '_none', from: '', to: '', min: '', max: '', status: '' }; UI.showFilters = false; saveUI(); render(); },
    'toggle-filters': () => { UI.showFilters = !UI.showFilters; render(); },
    'clear-one': (el) => { UI.f = Object.assign({}, UI.f, { [el.dataset.k]: '' }); UI.limit = 150; render(); },
    'clear-filters': () => { UI.f = NO_FILTERS(); UI.q = ''; UI.only = null; render(); },
    'add-tx': () => openTx(null),
    'open-tx': (el) => (isPhone() ? openTx(D.txById[el.dataset.id]) : startInline(el.dataset.id)),
    // first click selects a row, a click on the selected row edits it
    'sel-tx': async (el, ev) => { const id = el.dataset.id;
      UI.multiDel = false;
      if (ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey) && UI.editTx) { const ok = await saveInline(); if (ok === false) { render(); return; } UI.editTx = null; UI.editDraft = null; fresh(); }
      if (ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey) && !UI.sel) { UI.sel = id; UI.multi = []; UI.delAsk = null; render(); return; }
      // shift: everything between the first one picked and this one
      if (ev && ev.shiftKey) {
        const ids = rowIds(), a = ids.indexOf(UI.sel), b = ids.indexOf(id);
        if (a >= 0 && b >= 0) { UI.multi = ids.slice(Math.min(a, b), Math.max(a, b) + 1).filter((x) => x !== UI.sel); UI.delAsk = null; render(); return; }
      }
      // ⌘ or Ctrl: add or take out just this one
      if (ev && (ev.metaKey || ev.ctrlKey || ev.shiftKey)) {
        const m = (UI.multi || []).slice(), i = m.indexOf(id);
        if (id === UI.sel) { if (!m.length) return; UI.sel = m.shift(); }
        else if (i >= 0) m.splice(i, 1); else m.push(id);
        UI.multi = m; UI.delAsk = null; render(); return;
      }
      UI.multi = null;
      if (UI.sel === id && !UI.editTx) { UI.delAsk = null; startInline(id); return; } if (UI.editTx && UI.editTx !== id) { const ok = await saveInline(); if (ok === false) { render(); return; } } UI.sel = id; UI.delAsk = null; render(); },
    'ie-save': async () => { await saveInline(true); render(); },
    'ie-cancel': () => { UI.editTx = null; UI.editDraft = null; render(); },
    'ie-delete': () => ieDelete(),
    'ie-sp-add': () => { const d = UI.editDraft; if (!d || !d.splits) return; d.splits.push({ cat: '', amt: '', memo: '' }); d._dirty = true; render(); const n = $('#ie-sp-cat-' + (d.splits.length - 1)); if (n) n.focus(); },
    'ie-sp-rm': (el) => { const d = UI.editDraft; if (!d || !d.splits) return; d.splits.splice(Number(el.dataset.i), 1); d._dirty = true; if (d.splits.length < 2) { d.cat = d.splits[0] ? d.splits[0].cat : ''; d.splits = null; } render(); },
    'ie-sp-stop': () => { const d = UI.editDraft; if (!d || !d.splits) return; d.cat = d.splits[0] ? d.splits[0].cat : ''; d.splits = null; d._dirty = true; render(); },
    'ie-rcpt-view': () => { const t = D.txById[UI.editTx], d = UI.editDraft || {}; const r = 'receipt' in d ? d.receipt : t && t.receipt; if (r) openLightbox('/_blob/' + r, 'receipt' in d ? d.receiptType : t && t.receiptType); },
    'ie-rcpt-rm': () => { const d = UI.editDraft; if (!d) return; d.receipt = null; d.receiptType = null; d._dirty = true; render(); },
    'toggle-clear': (el) => toggleClear(el.dataset.id),
    approve: async (el) => {
      const id = el.dataset.id, t = D.txById[id], rec = UI.rec;
      if (UI.editTx === id) { await saveInline(); fresh(); }
      S.newStep(); await approve([id]); S.newStep();
      render();
      if (t && !(rec && !UI.rec)) toast(`Approved ${t.payee || 'it'}.`, { label: 'Undo', fn: () => undoRedo(false) });
    },
    'approve-all': () => approve(filteredTx().filter((t) => t.approved === false && !t.match && (t.cat || (t.splits && t.splits.length) || t.transfer || isTrack(t.acct))).map((t) => t.id)),
    unmatch: async (el) => { const id = el.dataset.id; if (UI.editTx === id) { await saveInline(); fresh(); } await unmatch(id); render(); },
    'undo-import': (el) => openUndoImport(el.dataset.id),
    'legacy-import': (el) => openLegacyImport(el.dataset.key),
    'approve-updates': () => approve(filteredTx().filter((t) => t.match && t.match.kind === 'update').map((t) => t.id)),
    'more-tx': () => { UI.limit += 200; render(); },
    // phone: a tap opens a transaction in place to show more; the pencil opens the full edit
    'tx-peek': (el) => {
      const id = el.dataset.id;
      UI.peekTx = UI.peekTx === id ? null : id;
      document.querySelectorAll('.txr.open').forEach((r) => r.classList.remove('open'));
      const r = UI.peekTx && document.querySelector(`.txr[data-row="${UI.peekTx}"]`);
      if (r) r.classList.add('open');
    },
    'tx-line': (el) => { try { localStorage.setItem('zeroline-txline', el.dataset.v); } catch (e) { /* ignore */ } document.documentElement.dataset.txline = el.dataset.v; render(); },
    import: (el) => openImport(el.dataset.id),
    'add-acct': () => openAcct(null),
    'edit-acct': (el) => openAcct(el.dataset.id),
    payoff: (el) => openPayoff(el.dataset.id),
    payees: () => openPayees(),
    'debt-plan': openDebtPlan,
    'acct-tx': (el) => { UI.view = 'tx'; UI.f = Object.assign(defaultFilters(), { acct: el.dataset.id }); UI.showFilters = false; saveUI(); render(); },
    reconcile: (el) => openImport(el.dataset.id),
    'rec-flow': () => openImport(),
    'ie-cal': () => { const p = $('#ie-date-pick'); if (!p) return; p.value = isoOr($('#ie-date').value, p.value); try { p.showPicker(); } catch (e) { p.focus(); p.click(); } },
    'multi-edit': () => { UI.mbEdit = !UI.mbEdit; render(); },
    'multi-clear': () => { UI.multi = null; if (UI.pick) UI.sel = null; render(); },
    'pick-mode': () => { UI.pick = !UI.pick; UI.sel = null; UI.multi = null; UI.peekTx = null; UI.multiDel = false; render(); },
    // Select mode on a phone: each tap adds or takes out one row
    'pick-tx': (el) => {
      const id = el.dataset.id, m = (UI.multi || []).slice(), i = m.indexOf(id);
      if (!UI.sel) UI.sel = id;
      else if (id === UI.sel) UI.sel = m.shift() || null;
      else if (i >= 0) m.splice(i, 1); else m.push(id);
      UI.multi = m; UI.delAsk = null; UI.multiDel = false; render();
    },
    'select-all': () => selectAll(),
    'multi-payee': () => {
      const v = ($('#mb-payee') ? $('#mb-payee').value : '').trim();
      if (!v) { toast('Type the payee first.'); const f = $('#mb-payee'); if (f) f.focus(); return; }
      multiChange((t) => (t.transfer ? null : Object.assign(t, { payee: v })), 'payee');
    },
    'multi-note': (el) => {
      const v = ($('#mb-note') ? $('#mb-note').value : '').trim(), add = el.dataset.how === 'add';
      if (!v && add) { toast('Type the note first.'); const f = $('#mb-note'); if (f) f.focus(); return; }
      multiChange((t) => {
        // a note brought over from YNAB that holds the bank's wording moves into the bank description first
        if (!t.bank && bankText(t)) { t.bank = bankText(t); t.memo = null; }
        t.memo = add && t.memo ? `${t.memo} ${v}` : v || null;
        return t;
      }, 'note');
    },
    'multi-del': () => { UI.multiDel = true; render(); },
    'multi-del-no': () => { UI.multiDel = false; render(); },
    'multi-del-yes': async () => {
      const rm = [];
      for (const id of picked()) { const t = D.txById[id]; rm.push(t); if (t.pair && D.txById[t.pair] && !rm.includes(D.txById[t.pair])) rm.push(D.txById[t.pair]); }
      const n = picked().length;
      UI.multi = null; UI.sel = null; UI.multiDel = false;
      S.newStep(); await putTxs([], rm.filter((t, i) => rm.indexOf(t) === i)); S.newStep();
      toast(`Deleted ${n} transactions. ${MAC ? '⌘Z' : 'Ctrl+Z'} to undo.`); render();
    },
    'multi-approve': async () => {
      const ids = picked().filter((x) => D.txById[x].match || D.txById[x].approved === false);
      if (!ids.length) return;
      UI.multi = null; S.newStep(); await approve(ids); S.newStep();
      if (ids.length === 1) toast('Approved'); render();
    },
    'multi-merge': async () => {
      const ids = picked(); if (ids.length !== 2) return;
      const [k, d] = keeperOf(D.txById[ids[0]], D.txById[ids[1]]);
      if (mergeProblem(k, d)) return;
      const x = xferPair(k, d);
      UI.multi = null; UI.sel = k.id; await (x ? mergeXfer(x[0], x[1]) : mergePair(k.id, d.id));
    },
    'dbl-open': () => { UI.dbl = true; UI.bc = null; render(); window.scrollTo(0, 0); },
    'dbl-close': () => { UI.dbl = false; render(); },
    'dbl-see': (el) => { const id = el.dataset.id, t = D.txById[id]; if (!t) return; UI.q = ''; UI.only = null; if ((UI.f.from && t.date < UI.f.from) || (UI.f.to && t.date > UI.f.to)) { UI.f.from = ''; UI.f.to = ''; } if (UI.rec && t.cleared === 'r') UI.recAll = true; UI.sel = id; render(); setTimeout(() => { const r = document.querySelector(`.txr[data-row="${id}"]`); if (r) r.scrollIntoView({ block: 'center' }); }, 40); },
    'dbl-merge': (el) => { const x = xferPair(D.txById[el.dataset.a], D.txById[el.dataset.b]); return x ? mergeXfer(x[0], x[1]) : mergePair(el.dataset.a, el.dataset.b); },
    'dbl-not': (el) => notDouble(el.dataset.a, el.dataset.b),
    'chk-open': (el) => openTx(D.txById[el.dataset.id]),
    'chk-pair-ok': async (el) => {
      const ids = [el.dataset.a, el.dataset.b], rec = UI.rec;
      S.newStep(); await approve(ids); S.newStep(); render();
      if (!(rec && !UI.rec)) toast('Both matched.', { label: 'Undo', fn: () => undoRedo(false) });
    },
    // two matches that crossed (two $60 purchases): each keeps your details and takes the other's bank line
    'chk-swap': async (el) => {
      const a = D.txById[el.dataset.a], b = D.txById[el.dataset.b];
      if (!a || !b || !a.match || !b.match) return;
      const na = Object.assign({}, a), nb = Object.assign({}, b);
      ['bank', 'ik', 'posted', 'bal'].forEach((x) => { na[x] = b[x] == null ? null : b[x]; nb[x] = a[x] == null ? null : a[x]; });
      // the bank halves trade places but both stay matched, so the card shows the new way round to approve
      const bankSide = (m) => ({ bank: m.bank, date: m.date, posted: m.posted, ik: m.ik });
      na.match = Object.assign({}, a.match, bankSide(b.match), { swapped: !a.match.swapped });
      nb.match = Object.assign({}, b.match, bankSide(a.match), { swapped: !b.match.swapped });
      S.newStep(); await putTxs([na, nb]); S.newStep();
      UI.ckOpen = null; render();
      toast('Swapped. Check them, then tick Right Way Round.', { label: 'Undo', fn: () => undoRedo(false) });
    },
    // the search for past transactions is a quiet link until wanted
    'ck-find': () => { UI.ckFind = !UI.ckFind; if (!UI.ckFind) UI.ckQ = ''; render(); const q = $('#ckq'); if (q) q.focus(); },
    'ck-info': (el) => { UI.ckInfo = Object.assign({}, UI.ckInfo, { [el.dataset.k]: !(UI.ckInfo && UI.ckInfo[el.dataset.k]) }); render(); },
    'chk-peek': (el) => { UI.ckOpen = UI.ckOpen === el.dataset.id ? null : el.dataset.id; render(); },
    // approve a whole section at once (perfect matches, or new lines already given a category): one undo step
    'chk-all': async (el) => {
      const ids = recWaiting().filter((t) => checkOf(t)[0] === el.dataset.k).map((t) => t.id), rec = UI.rec;
      S.newStep(); await approve(ids); S.newStep();
      render();
      if (!(rec && !UI.rec)) toast(`Approved ${ids.length}.`, { label: 'Undo', fn: () => undoRedo(false) });
    },
    'rec-show': (el) => { UI.only = el.dataset.ids.split(','); UI.onlyWhat = el.dataset.what; UI.editTx = null; render(); },
    'show-twins': () => { UI.dbl = true; UI.bc = null; UI.editTx = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    'clear-only': () => { UI.only = null; render(); },
    'acct-pick': (el) => { if (UI.bc) UI.bc = el.dataset.id ? { acct: el.dataset.id, step: null } : null; UI.f = Object.assign({}, UI.f, { acct: el.dataset.id, from: UI.bc ? bcSince(el.dataset.id) : UI.f.from, to: UI.bc ? '' : UI.f.to }); UI.only = null; UI.limit = 150; UI.editTx = null; UI.sel = null; saveUI(); render(); },
    'tx-sort': (el) => { const k = el.dataset.k; UI.sort = UI.sort.k === k ? { k, dir: -UI.sort.dir } : { k, dir: k === 'date' || k === 'amt' ? -1 : 1 }; render(); },
    'bank-check': () => { const a = UI.rec && UI.rec.acct; UI.rec = null; openBankCheck(a); },
    'bc-close': () => { if (UI.bc && UI.bc.find != null) UI.q = ''; UI.bc = null; UI.f.from = ''; UI.f.to = ''; render(); },
    'bc-step': (el) => {
      const k = el.dataset.k === '' ? null : Number(el.dataset.k), res = balanceCheck(UI.bc.acct), p = k != null && res ? res.steps[k] : null;
      UI.bc.step = p && UI.bc.step !== k ? k : null;
      UI.f.acct = UI.bc.acct; UI.f.from = UI.bc.step != null ? p.lo : bcSince(UI.bc.acct); UI.f.to = UI.bc.step != null ? p.to : ''; UI.sel = null; render();
    },
    'bc-fix': (el) => bcFix(UI.bc.acct, el.dataset.k === '' ? null : Number(el.dataset.k)),
    'bc-lock': () => bcLock(UI.bc.acct),
    'bc-add': async (el) => {
      const acct = UI.bc.acct, desc = el.dataset.desc, rule = ruleFor(desc, Number(el.dataset.amt), acct, el.dataset.d);
      const t = { id: S.uid(), acct, date: el.dataset.d, amt: Number(el.dataset.amt), bank: desc, payee: rule && rule.payee ? rule.payee : tidyPayee(desc), cat: rule ? rule.cat || null : null, memo: rule && rule.memo ? rule.memo : null, cleared: 'c', approved: false, by: myId() };
      S.newStep(); await putTxs([t]); S.newStep();
      toast(`Added ${t.payee} ${signed(t.amt)} on ${dateLabel(t.date)}${t.cat ? '' : '. Give it a category in Needs review'}. ${MAC ? '⌘Z' : 'Ctrl+Z'} to undo.`);
      render();
    },
    'bc-back': () => { UI.bc.find = null; UI.q = ''; UI.sel = null; UI.f.from = bcSince(UI.bc.acct); UI.f.to = ''; UI.bc.step = null; render(); window.scrollTo(0, 0); },
    'bc-go': (el) => { const id = el.dataset.id || null, tt = D.txById[id];
      if (!el.dataset.q) { if (tt && ((UI.f.from && tt.date < UI.f.from) || (UI.f.to && tt.date > UI.f.to))) { UI.f.from = ''; UI.f.to = ''; UI.bc.step = null; } }
      else { UI.bc.find = el.dataset.q; UI.q = UI.bc.find; UI.f.from = ''; UI.f.to = ''; } UI.f.acct = UI.bc.acct; UI.limit = 150; UI.sel = id; render(); if (!id) { window.scrollTo(0, 0); return; } setTimeout(() => { const r = document.querySelector(`.txr[data-row="${id}"]`); if (r) r.scrollIntoView({ block: 'center' }); }, 40); },
    'rec-stop': () => { UI.dbl = false; UI.rec = null; UI.only = null; UI.recSkip = null; saveUI(); render(); },
    'rd-fix-many': (el) => { const l = el.dataset.is.split(',').map((i) => (UI.recItems || [])[+i]).filter(Boolean); if (l.length) recFix(l); },
    'rd-fix': (el) => { const it = (UI.recItems || [])[+el.dataset.i]; if (it) recFix([it]); },
    // "Not the same" / "Keep it": stop suggesting this one while reconciling
    'rd-skip': (el) => {
      const it = (UI.recItems || [])[+el.dataset.i];
      if (!it) return;
      UI.recSkip = UI.recSkip || {};
      if (it.bs.length) it.ts.forEach((t) => it.bs.forEach((b) => (UI.recSkip[t.id + '|' + b.id] = true)));
      else it.ts.forEach((t) => (UI.recSkip[t.id] = true));
      render();
    },
    'rec-flow-import': () => openImport(UI.rec && UI.rec.acct, 'import'),
    'rec-finish': () => recFinish(0),
    'rec-adjust': () => recFinish(recState().diff),
    'export-json': exportJSON,
    'sign-out': async () => { await fetch('/api/logout', { method: 'POST', headers: { 'X-Requested-With': 'ynabb' } }).catch(() => {}); location.href = '/login'; },
    'export-csv': exportCSV,
    'rm-rule': (el) => guard(S.write('meta', 'rules', { items: { [el.dataset.k]: null } })),
    'close-sheet': closeSheet,
    'link-toggle': async (el) => {
      const c = D.cats[el.dataset.id], on = c.linked !== false, g = D.cats[c.parent].name;
      await putCat(Object.assign({}, c, { linked: !on }));
      toast(on ? `${c.name} is unlinked. Changes to it now come from Ready to Assign.` : `${c.name} is linked. Changes to it now move money within ${g}.`);
    },
    'toast-act': () => { const fn = toastFn; toastFn = null; $('#toast').hidden = true; if (fn) fn(); },
    'tgt-toggle': () => {
      SHOW.tgt = !SHOW.tgt;
      document.documentElement.dataset.tgt = SHOW.tgt ? 'on' : 'off';
      render();
    },
    'split-basis': (el) => { try { localStorage.setItem('zeroline-split-basis', el.dataset.v); } catch (e) { /* ignore */ } render(); },
    'split-goals': openSplitGoals,
    'kind-filter': (el) => { UI.budgetFilter = 'kind:' + el.dataset.k; render(); },
    'tag-mode': () => { UI.editCats = true; UI.budgetFilter = 'kind:none'; render(); },
    'kind-cycle': async (el) => {
      const c = D.cats[el.dataset.id], order = [null, 'need', 'want', 'save'];
      const next = order[(order.indexOf(c.kind || null) + 1) % order.length];
      await putCat(Object.assign({}, c, { kind: next }));
    },
    'pct-toggle': () => {
      SHOW.pct = !SHOW.pct;
      document.documentElement.dataset.pct = SHOW.pct ? 'on' : 'off';
      render();
    },
    'bar-cycle': () => {
      const v = BAR_NEXT[barPref()] || 'thick';
      try { localStorage.setItem('zeroline-bar', v); } catch (e) { /* ignore */ }
      document.documentElement.dataset.bar = v;
      render();
    },
    guide: () => { if (window.ZLGuide) window.ZLGuide.open(); },
    'layout-toggle': () => setLayout(document.documentElement.dataset.layout === 'phone' ? 'desktop' : 'phone'),
    'close-lb': () => { $('#lightbox').hidden = true; $('#lightbox').innerHTML = ''; },
  };

  // clicking away from a row you're editing: no changes = cancel; changes = flash Save and stay put
  function editDirty() {
    const t = D.txById[UI.editTx], d = UI.editDraft || {};
    if (!t) return false;
    const orig = { date: t.date, payee: t.payee || '', cat: t.cat || '', amt: box(t.amt), bank: t.bank || '', memo: t.memo || '' };
    if (d._dirty || (d.acct && d.acct !== t.acct)) return true;
    if ('cat' in d && d.cat !== (t.transfer ? 'xfer:' + t.transfer : (t.cat || ''))) return true;
    if ('xcat' in d && d.xcat !== (t.cat || '')) return true;
    return Object.keys(d).some((k) => k in orig && k !== 'cat' && String(d[k]).trim() !== String(orig[k]).trim());
  }
  document.addEventListener('click', (ev) => {
    if (!UI.editTx || isPhone()) return;
    const t = ev.target;
    if (!t.closest || t.closest('.txr.editing') || t.closest('#sheet') || t.closest('#toast') || t.closest('#lightbox') || t.closest('.cbx-pop') || t.closest('.ctx-menu')) return;
    if (!document.querySelector('.txr.editing')) return;
    if (editDirty()) {
      ev.preventDefault(); ev.stopPropagation();
      const b = document.querySelector('.txr.editing [data-action="ie-save"]');
      if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
      toast('Save your changes (Enter) or cancel them (Esc) first.');
      return;
    }
    UI.sel = UI.editTx; UI.editTx = null; UI.editDraft = null; UI.delAsk = null; // nothing changed: same as Esc
    render();
  }, true);

  // always act on the latest numbers, even if the screen hasn't refreshed yet
  const fresh = () => { if (S.ready()) D = snapshot(); };
  document.addEventListener('click', (ev) => {
    if (UI.showFilters && !ev.target.closest('.filt-wrap') && !ev.target.closest('#sheet') && !ev.target.closest('.cbx-pop')) { UI.showFilters = false; render(); }
    if (ev.target.closest('[data-saction],[data-action]')) fresh();
    const s = ev.target.closest('[data-saction]');
    if (s && sheet && $('#sheet').contains(s)) {
      if (s.tagName === 'INPUT' && s.type === 'radio') { /* handled on change */ }
      else { ev.preventDefault(); const fn = sheet.actions[s.dataset.saction]; if (fn) fn(s, ev); return; }
    }
    const a = ev.target.closest('[data-action]');
    // phone: a tap anywhere on a category opens or closes its details
    const br = !a && isPhone() && UI.view === 'budget' && !UI.editCats && ev.target.closest('.brow[data-cat]');
    if (br && !ev.target.closest('input, select, textarea, label')) { toggleCatRow(br.dataset.cat); return; }
    if (!a) {
      // a click anywhere else on a row (the icon or C columns, the gaps) selects it too
      const row = !isPhone() && ev.target.closest('.txl .txr[data-row]:not(.editing)');
      if (row) actions['sel-tx'](row.querySelector('.tx-main'), ev);
      else if (UI.sel && !UI.editTx && !ev.target.closest('.txl, #sheet, .ctx-menu, .cbx-pop, #zl-guide, #multi-bar, input, select, textarea, label, button, a')) { UI.sel = null; UI.multi = null; UI.delAsk = null; render(); }
      return;
    }
    if (a.tagName === 'INPUT') return; // checkboxes handled on change
    const fn = actions[a.dataset.action];
    if (fn) { ev.preventDefault(); fn(a, ev); }
  });
  document.addEventListener('mousedown', (ev) => { if ((ev.shiftKey || ev.metaKey) && ev.target.closest('.txl .txr')) ev.preventDefault(); });
  // pull down from the top to reload: the home-screen app has no refresh button
  (function pullToRefresh() {
    const standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!standalone) return;
    const ind = document.createElement('div');
    ind.id = 'ptr'; ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML = '<svg viewBox="0 0 20 20"><path d="M10 4v10M5.5 9.5L10 14l4.5-4.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Pull to refresh</span>';
    document.body.appendChild(ind);
    const GO = 80;
    let y0 = null, pull = 0;
    const show = (d) => {
      ind.style.transform = `translate(-50%, ${Math.min(d, GO + 30) - 50}px)`;
      ind.style.opacity = Math.min(1, d / 40);
      ind.classList.toggle('ready', d >= GO);
      ind.querySelector('span').textContent = d >= GO ? 'Let go to refresh' : 'Pull to refresh';
    };
    const reset = () => { y0 = null; pull = 0; ind.style.transition = 'transform .2s, opacity .2s'; show(0); setTimeout(() => { ind.style.transition = ''; }, 200); };
    document.addEventListener('touchstart', (ev) => {
      // only from the very top of the page, and not inside a sheet, menu or the guide
      if (window.scrollY > 0 || ev.touches.length !== 1 || ev.target.closest('#sheet:not([hidden]), .ctx-menu, .cbx-pop, #zl-guide, #lightbox')) return;
      y0 = ev.touches[0].clientY; pull = 0;
    }, { passive: true });
    document.addEventListener('touchmove', (ev) => {
      if (y0 == null) return;
      pull = (ev.touches[0].clientY - y0) * 0.6;
      if (pull <= 0 || window.scrollY > 0) { if (pull < 0) reset(); return; }
      show(pull);
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (y0 == null) return;
      const go = pull >= GO;
      reset();
      if (!go) return;
      // never throw away changes that are still on their way to the server
      if (Object.values(S._queue || {}).some((q) => q.busy)) { toast('Still saving. Try again in a moment.'); return; }
      ind.classList.add('ready'); show(GO); ind.querySelector('span').textContent = 'Refreshing';
      location.reload();
    });
  })();
  // phone budget: once Ready to Assign scrolls up under the header, the header gets a line in its colour
  function rtaLine() {
    const top = $('.top'), box = $('.rta');
    if (!top) return;
    const on = !!(isPhone() && UI.view === 'budget' && box && box.getBoundingClientRect().bottom <= top.getBoundingClientRect().bottom + 5); // 5: the line's height, so the box's edge hands over to it seamlessly
    if (on) document.documentElement.style.setProperty('--rta-c', getComputedStyle(box).backgroundColor);
    top.classList.toggle('rta-gone', on);
  }
  window.addEventListener('scroll', rtaLine, { passive: true });
  // still saving: ask before the page closes
  window.addEventListener('beforeunload', (ev) => { if (Object.values(S._queue || {}).some((q) => q.busy)) { ev.preventDefault(); ev.returnValue = ''; } });
  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    fresh();
    if (el.id === 'mb-cat' && el.value) {
      const c = el.value;
      await multiChange((t) => {
        if (t.transfer || (t.splits && t.splits.length)) return null;
        t.cat = c;
        if (t.bank && t.payee && (c === INCOME || D.tree.isLeaf(c))) { const key = E.descKey(t.bank), r = D.rules[key]; if (key && (!r || r.payee !== t.payee || r.cat !== c)) guard(S.write('meta', 'rules', { items: { [key]: Object.assign({}, r && !r.kind ? r : {}, { payee: t.payee, cat: c }) } })); }
        return t;
      }, 'category');
      return;
    }
    if (el.id === 'bc-file' && UI.bc) { if (el.files[0]) await bcLoadFile(UI.bc.acct, el.files[0]); return; }
    if (UI.editDraft && el.id === 'ie-date-pick') { if (el.value) { UI.editDraft.date = el.value; $('#ie-date').value = shortDate(el.value); } return; }
    if (UI.editDraft && el.id && el.id.indexOf('ie-') === 0) {
      UI.editDraft[el.id.slice(3)] = el.value;
      // a familiar payee fills in the category it had last time
      if (el.id === 'ie-payee' && !UI.editDraft.cat && $('#ie-cat') && !$('#ie-cat').value) {
        const last = D.tx.filter((x) => x.payee === el.value && x.cat && (x.cat === INCOME || D.tree.isLeaf(x.cat))).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        if (last) { $('#ie-cat').value = last.cat; UI.editDraft.cat = last.cat; }
      }
      return;
    }
    if (sheet && $('#sheet').contains(el)) {
      if (el.dataset.saction && sheet.actions[el.dataset.saction]) sheet.actions[el.dataset.saction](el);
      if (sheet && sheet.onChange) sheet.onChange(el);
      return;
    }
    // save just after the cursor lands in the next box, so the refresh can put it back there
    if (el.classList.contains('asg')) { const id = el.dataset.id; setTimeout(() => { fresh(); setAssigned(id, el); }, 0); return; }
    if (el.dataset.filter) { UI.f[el.dataset.filter] = el.value; UI.limit = 150; render(); return; }
    if (el.id === 'rec-all') { UI.recAll = el.checked; render(); return; }
    if (el.id === 'rec-bank-live' && UI.rec) { const v = E.parseMoney(el.value); if (el.value.trim() && !Number.isNaN(v)) { UI.rec.bank = isDebt(UI.rec.acct) ? -Math.abs(v) : v; saveUI(); } render(); return; }
    if (el.id === 'showhidden') { UI.showHidden = el.checked; render(); return; }
    if (el.id === 'set-layout') { setLayout(el.value); return; }
    if (el.id === 'ah-acct') { actions['acct-pick']({ dataset: { id: el.value } }); return; }
    if (el.id === 'split-basis') { try { localStorage.setItem('zeroline-split-basis', el.value); } catch (e) { /* ignore */ } render(); return; }
    if (el.dataset.ckCat) {
      const t = D.txById[el.dataset.ckCat];
      if (!t || !el.value) return;
      const x = el.value.startsWith('xfer:') ? null : el.value;
      if (!x) { openTx(t); return; } // a transfer needs the other account: use the full editor
      S.newStep(); await putTxs([Object.assign({}, t, { cat: x, approved: null, match: null })]); S.newStep();
      render(); toast(`${t.payee || 'It'} → ${catName(x)}.`, { label: 'Undo', fn: () => undoRedo(false) });
      return;
    }
    if (el.id === 'set-bankurl') {
      let u = el.value.trim();
      if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
      if (u && !/^https:\/\/[^\s/]+\.[^\s]+/i.test(u)) { toast("That doesn't look like a web address."); return; }
      guard(S.write('meta', 'settings', { bankUrl: u || null })); toast(u ? 'Bank login page saved.' : 'Bank login page removed.'); return;
    }
    if (el.id === 'set-cur') { guard(S.write('meta', 'settings', { currency: el.value })); return; }
    if (el.id === 'restore-file' && el.files[0]) { restore(el.files[0]); el.value = ''; }
    if (el.id === 'ynab-file' && el.files.length) { openYnab([...el.files]); el.value = ''; }
    if (el.id === 'ie-rfile' && el.files && el.files[0] && UI.editDraft) {
      const d = UI.editDraft, file = el.files[0];
      toast('Uploading receipt…');
      try {
        const { blob, type } = await prepareReceipt(file);
        const res = await S.assets.upload(blob, { type });
        d.receipt = res.id; d.receiptType = type; d._dirty = true;
        render(); toast('Receipt attached. Save to keep it.');
      } catch (e) {
        toast({ too_large: 'That file is too big (over 20 MB).', unsupported_type: 'Use a photo (JPEG, PNG) or a PDF.', quota_or_state: 'Receipt storage is full.', rate_limited: 'Too many uploads at once. Try again in a moment.' }[e && e.code] || 'The receipt could not be uploaded. Try again.');
      }
    }
  });
  let qTimer;
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (UI.editDraft && el.id && el.id.indexOf('ie-') === 0) {
      const d = UI.editDraft, sp = el.id.match(/^ie-sp-(cat|amt|memo)-(\d+)$/);
      if (sp) {
        d.splits[Number(sp[2])][sp[1]] = el.value; d._dirty = true;
        const left = $('#ie-sp-left'); if (left) left.textContent = splitLeftText(d, E.parseMoney(String('amt' in d ? d.amt : box(D.txById[UI.editTx].amt))));
        return;
      }
      if (el.id === 'ie-rfile') return;
      d[el.id.slice(3)] = el.value;
      if (el.id === 'ie-cat') {
        if (el.value === '__split' && !d.splits) {
          const t = D.txById[UI.editTx], amt = Math.abs(E.parseMoney(String('amt' in d ? d.amt : box(t.amt))) || 0);
          const first = (d.cat && d.cat !== '__split' && d.cat.indexOf('xfer:') !== 0) ? d.cat : (t.cat || '');
          d.splits = [{ cat: first, amt: box(amt), memo: '' }, { cat: '', amt: '', memo: '' }]; d._dirty = true;
          render(); const n = $('#ie-sp-cat-1'); if (n) n.focus();
        } else if (el.value !== '__split' && d.splits) { d.splits = null; render(); }
      }
      if (el.id === 'ie-acct' || el.id === 'ie-cat') render();
      if (el.id === 'ie-amt' && d.splits) { const left = $('#ie-sp-left'); if (left) left.textContent = splitLeftText(d, E.parseMoney(el.value)); }
      return;
    }
    if (sheet && $('#sheet').contains(el)) { if (sheet.onInput) sheet.onInput(el); return; }
    if (el.id === 'ckq') { UI.ckQ = el.value; clearTimeout(qTimer); qTimer = setTimeout(render, 180); return; }
    if (el.id === 'txq') {
      UI.q = el.value; UI.limit = 150;
      clearTimeout(qTimer);
      qTimer = setTimeout(render, 180);
    }
  });
  // an emptied search for past transactions folds back into its link
  document.addEventListener('focusout', (ev) => { if (ev.target.id === 'ckq' && !ev.target.value.trim()) setTimeout(() => { if (UI.ckFind && !(UI.ckQ || '').trim()) { UI.ckFind = false; UI.ckQ = ''; render(); } }, 150); });
  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (!el.classList) return;
    if (el.classList.contains('cents') && kpOn()) { kpOpen(el); return; }
    if (el.classList.contains('asg') || el.classList.contains('cents')) setTimeout(() => el.select(), 0);
  });
  // each click, edit or key press starts a new undo step
  ['click', 'change', 'keydown'].forEach((t) => document.addEventListener(t, () => S.newStep(), true));
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  // edit boxes in the order they sit on screen: date, payee, category, note, bank description, amount
  const IE_ORDER = ['ie-date', 'ie-payee', 'ie-cat', 'ie-memo', 'ie-bank', 'ie-amt'];
  function describeStep(g) {
    const colls = new Set(g.map((w) => (w.coll === 'meta' ? w.id : w.coll)));
    if (colls.has('tx')) return 'transaction change';
    if (colls.has('cats')) return 'category change';
    if (colls.has('accounts')) return 'account change';
    if (colls.has('months')) return 'budget change';
    return 'change';
  }
  function undoRedo(redo) {
    const g = redo ? S.redo() : S.undo();
    if (!g) { toast(redo ? 'Nothing to redo' : 'Nothing to undo'); return; }
    toast(`${redo ? 'Redid' : 'Undid'} ${describeStep(g)}. ${redo ? (MAC ? '⌘Z' : 'Ctrl+Z') + ' to undo' : (MAC ? '⌘⇧Z' : 'Ctrl+Y') + ' to redo'}.`);
    render();
  }
  document.addEventListener('keydown', (ev) => {
    if (sheet && sheet.onKey && !$('#sheet').hidden && sheet.onKey(ev)) { ev.preventDefault(); return; }
    const mod = MAC ? ev.metaKey : ev.ctrlKey;
    const k = ev.key.toLowerCase();
    if (mod && !ev.altKey && (k === 'z' || k === 'y')) {
      const t = ev.target;
      const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) && !/checkbox|radio|file/.test(t.type);
      // inside a box you've typed in, leave the normal text undo alone
      if (typing && !(t.classList.contains('asg') && t.value === t.defaultValue)) return;
      ev.preventDefault();
      if (typing) t.blur();
      undoRedo(k === 'y' || ev.shiftKey);
      return;
    }
    if (ev.key === 'Enter' && ev.target.id === 'rec-bank-live') { ev.preventDefault(); ev.target.blur(); return; }
    // the transaction list: Enter edits, Delete twice deletes, arrows move, Esc clears
    if (UI.view === 'tx' && !isPhone() && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && (ev.key === 'a' || ev.key === 'A') && !(sheet && !$('#sheet').hidden) && !/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName) && !UI.editTx) { ev.preventDefault(); selectAll(); return; }
    if (UI.view === 'tx' && picked().length > 1 && !/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName) && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      if (ev.key === 'a' || ev.key === 'A') { ev.preventDefault(); actions['multi-approve'](); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); UI.multi = null; UI.multiDel = false; render(); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); UI.multiDel = true; render(); return; }
    }
    if (ev.key === 'Enter' && (ev.target.id === 'mb-payee' || ev.target.id === 'mb-note')) { ev.preventDefault(); if (ev.target.id === 'mb-payee') actions['multi-payee'](); else actions['multi-note']({ dataset: { how: 'set' } }); return; }
    if (UI.view === 'tx' && !isPhone() && !(sheet && !$('#sheet').hidden) && !/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName) && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      const ids = rowIds();
      if (UI.sel && !ids.includes(UI.sel)) UI.sel = null;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!ids.length || UI.editTx) return;
        ev.preventDefault();
        const i = ids.indexOf(UI.sel), n = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + (ev.key === 'ArrowDown' ? 1 : -1)))];
        UI.sel = n; UI.delAsk = null; render();
        const r = document.querySelector(`.txr[data-row="${n}"]`); if (r) { r.scrollIntoView({ block: 'nearest' }); const b = r.querySelector('.tx-main'); if (b) b.focus({ preventScroll: true }); }
        return;
      }
      if (UI.sel && !UI.editTx) {
        if (ev.key === 'Enter') { ev.preventDefault(); startInline(UI.sel); return; }
        if (ev.key === 'a' || ev.key === 'A') { const t = D.txById[UI.sel]; if (t && (t.match || t.approved === false)) { ev.preventDefault(); fresh(); approve([t.id]).then(render); } return; }
        if (ev.key === 'u' || ev.key === 'U') { const t = D.txById[UI.sel]; if (t && t.match) { ev.preventDefault(); fresh(); unmatch(t.id).then(render); } return; }
        if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteAsk(UI.sel); return; }
        if (ev.key === 'Escape') { ev.preventDefault(); if (UI.delAsk) UI.delAsk = null; else UI.sel = null; render(); return; }
      }
    }
    if (UI.editTx && ev.target.closest && ev.target.closest('.txr.editing')) {
      if (ev.altKey && (ev.code === 'KeyA' || ev.code === 'KeyU')) {
        const t = D.txById[UI.editTx];
        ev.preventDefault();
        if (t && ev.code === 'KeyA' && (t.match || t.approved === false)) actions.approve({ dataset: { id: t.id } });
        if (t && ev.code === 'KeyU' && t.match) actions.unmatch({ dataset: { id: t.id } });
        return;
      }
      if (ev.key === 'Enter' && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) {
        ev.preventDefault();
        const order = IE_ORDER.map((x) => document.getElementById(x)).filter(Boolean);
        const i = order.indexOf(ev.target);
        if (i >= 0 && i < order.length - 1) { const n = order[i + 1]; n.focus(); if (n.select) n.select(); return; } // Enter: next box
        const id = UI.editTx; ev.target.blur(); setTimeout(async () => { await saveInline(true); UI.sel = id; render(); }, 0); return; // last box: save
      }
      if (ev.key === 'Escape') { ev.preventDefault(); UI.sel = UI.editTx; UI.editTx = null; UI.editDraft = null; UI.delAsk = null; render(); return; }
      // Tab moves through the boxes in order (Macs otherwise skip the category list)
      if (ev.key === 'Tab' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const order = IE_ORDER.map((x) => document.getElementById(x)).filter(Boolean);
        const i = order.indexOf(ev.target);
        if (i >= 0) { ev.preventDefault(); const n = order[(i + (ev.shiftKey ? -1 : 1) + order.length) % order.length]; n.focus(); if (n.select) n.select(); }
        return;
      }
    }
    if (ev.key === 'Escape') {
      if (UI.showFilters && !sheet) { UI.showFilters = false; render(); return; }
      if (!$('#lightbox').hidden) { actions['close-lb'](); return; }
      if (sheet) { closeSheet(); return; }
    }
    if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('asg')) { ev.target.blur(); return; }
    if (ev.key === 'Tab' && !ev.altKey && !ev.metaKey && !ev.ctrlKey && ev.target.classList && ev.target.classList.contains('asg')) {
      const boxes = $$('#view .asg');
      const next = boxes[boxes.indexOf(ev.target) + (ev.shiftKey ? -1 : 1)];
      if (next) { ev.preventDefault(); next.focus(); }
      return;
    }
    if (ev.key === 'Enter' && sheet && sheet.onEnter && ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox') { ev.preventDefault(); ev.target.dispatchEvent(new Event('change', { bubbles: true })); sheet.onEnter(); }
  });

  // ---------- money boxes only take numbers ----------
  const MONEY_OK = /^[0-9.,+\-*/()$\s]*$/;
  document.addEventListener('beforeinput', (ev) => {
    const el = ev.target;
    if (el.tagName !== 'INPUT' || el.inputMode !== 'decimal') return;
    if (ev.data && !MONEY_OK.test(ev.data)) ev.preventDefault();
  }, true);
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.tagName !== 'INPUT' || el.inputMode !== 'decimal' || MONEY_OK.test(el.value)) return;
    el.value = el.value.replace(/[^0-9.,+\-*/()$\s]/g, ''); // pasted text with letters in it
  }, true);

  // ---------- money boxes: type the amount, and do sums ----------
  // Typed as written, dot and all (12.5 is $12.50); an amount stops at two places after the dot. After × or ÷ it's a
  // plain count (25×3). Leaving the box works out any sum and tidies it to 12.50. On a phone or tablet our own
  // number pad replaces the system keyboard.
  const centsFmt = (c, neg) => (neg ? '-' : '') + commas((c / 100).toFixed(2));
  const CALC_OP = /([+−×÷])/;
  const isSum = (s) => /[+\-−×÷*/]/.test(String(s).trim().slice(1));
  const calcValue = (s) => E.parseMoney(String(s).replace(/[+\-−×÷*/\s]+$/, ''));
  const calcTerms = (s) => {
    s = String(s || '').replace(/[\s,$]/g, '').replace(/\*/g, '×').replace(/\//g, '÷');
    const neg = s[0] === '-' || s[0] === '−';
    const p = (neg ? s.slice(1) : s).replace(/-/g, '−').split(CALC_OP), terms = [{ op: '', v: p[0] }];
    for (let i = 1; i < p.length; i += 2) terms.push({ op: p[i], v: p[i + 1] });
    return { neg, terms };
  };
  // one key press: a digit, '.', + − × ÷, '±', '⌫', or 'neg' (a typed minus, which starts a negative amount)
  const calcKey = (s, k, fresh) => {
    let x = calcTerms(s);
    if (fresh) {
      if (k === '⌫') return '';
      if (k === 'neg') return '-';
      if (/^[\d.]$/.test(k)) x = { neg: x.neg, terms: [{ op: '', v: '' }] }; // typing over the amount keeps its sign
    }
    const last = x.terms[x.terms.length - 1], count = last.op === '×' || last.op === '÷', only = x.terms.length === 1;
    if (k === 'neg') k = only && !last.v ? '±' : '−';
    if (/^\d$/.test(k)) {
      if (last.v.replace('.', '').length >= 11 || (!count && /\.\d\d$/.test(last.v))) return null; // cents stop at two places
      last.v = (last.v === '0' ? '' : last.v) + k;
    } else if (k === '.') {
      if (last.v.includes('.')) return null;
      last.v = (last.v || '0') + '.';
    } else if (k === '⌫') {
      if (!last.v) { if (!only) x.terms.pop(); else if (x.neg) x.neg = false; else return null; }
      else last.v = last.v.slice(0, -1);
    } else if (CALC_OP.test(k)) {
      if (last.v) x.terms.push({ op: k, v: '' });
      else if (!only) last.op = k; // change your mind about the sign
      else if (k === '−') x.neg = !x.neg;
      else if (k === '+') x.neg = false;
      else return null;
    } else if (k === '±') {
      const v = calcValue(s);
      if (only) x.neg = !x.neg;
      else if (!Number.isNaN(v)) x = { neg: v > 0, terms: [{ op: '', v: (Math.abs(v) / 100).toFixed(2) }] };
    } else return null;
    return (x.neg ? '-' : '') + x.terms.map((t) => t.op + (t.op === '×' || t.op === '÷' ? t.v : commas(t.v))).join(''); // a count after × or ÷ has no commas
  };
  const calcSet = (el, out) => {
    el.value = out;
    try { el.setSelectionRange(out.length, out.length); } catch (e) { /* not focused */ }
    el.scrollLeft = el.scrollWidth; // a long sum shows its newest end
    el.centsDirty = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    kpPaint();
  };
  const calcPress = (el, k) => {
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    const out = calcKey(el.value, k, el.value !== '' && (all || el.kpFresh));
    if (out == null) return;
    el.kpFresh = false; el.classList.remove('kp-fresh');
    calcSet(el, out);
  };
  const KEY_AS = { '-': 'neg', '−': 'neg', '*': '×', x: '×', X: '×', '/': '÷' };
  document.addEventListener('beforeinput', (ev) => {
    const el = ev.target;
    if (el.tagName !== 'INPUT' || !el.classList.contains('cents')) return;
    const t = ev.inputType;
    if (t === 'historyUndo' || t === 'historyRedo') return;
    ev.preventDefault();
    if (t === 'insertFromPaste' || t === 'insertFromDrop') {
      const txt = (ev.dataTransfer && ev.dataTransfer.getData('text/plain')) || ev.data || '', v = E.parseMoney(txt);
      if (txt.trim() && !Number.isNaN(v)) calcSet(el, centsFmt(Math.abs(v), v < 0));
    } else if (t.indexOf('delete') === 0) calcPress(el, '⌫');
    else if (t.indexOf('insert') === 0) for (const ch of ev.data || '') calcPress(el, KEY_AS[ch] || ch);
  }, true);
  // the browser skips its own 'change' when the script typed the text, so send it on leaving the box;
  // either way, a sum is worked out before anything else reads the box
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    el.centsDirty = false;
    if (!el.classList || !el.classList.contains('cents')) return;
    if (el.value.trim() === '-') el.value = '';
    else if (el.value.trim()) { const v = calcValue(el.value); if (!Number.isNaN(v)) el.value = centsFmt(Math.abs(v), v < 0); } // 12.5 → 12.50
  }, true);
  document.addEventListener('focusout', (ev) => {
    const el = ev.target;
    if (el.centsDirty) { el.centsDirty = false; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, true);

  // ---------- the number pad (phones and tablets) ----------
  // Taps on the pad never take the focus, so the box keeps its cursor and the system keyboard stays away.
  const kpOn = () => matchMedia('(pointer: coarse)').matches;
  let kp = null, kpEl = null;
  const KP_KEYS = [['7'], ['8'], ['9'], ['÷', 'Divide'], ['4'], ['5'], ['6'], ['×', 'Times'], ['1'], ['2'], ['3'], ['−', 'Minus'], ['.', 'Dot'], ['0'], ['⌫', 'Delete'], ['+', 'Plus']];
  function kpPaint() {
    if (!kp || kp.hidden || !kpEl) return;
    const v = isSum(kpEl.value) ? calcValue(kpEl.value) : NaN;
    $('.kp-sum', kp).textContent = Number.isNaN(v) ? '' : '= ' + money(v);
  }
  function kpOpen(el) {
    if (!kp) {
      kp = document.createElement('div');
      kp.id = 'kp'; kp.hidden = true;
      kp.setAttribute('role', 'group'); kp.setAttribute('aria-label', 'Number pad');
      kp.innerHTML = `<div class="kp-top"><span class="kp-sum" aria-live="polite"></span><span class="kp-acts"><button type="button" class="kp-pm" data-k="±" aria-label="Money in or out" title="Money in or out">±</button><button type="button" class="kp-done" data-k="done">Done</button></span></div>
        <div class="kp-keys">${KP_KEYS.map(([k, l]) => `<button type="button" data-k="${k}"${/[÷×−+±⌫]/.test(k) ? ' class="kp-op"' : ''}${l ? ` aria-label="${l}"` : ''}>${k}</button>`).join('')}</div>`;
      ['pointerdown', 'mousedown'].forEach((t) => kp.addEventListener(t, (e) => e.preventDefault()));
      kp.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b || !kpEl) return;
        if (b.dataset.k === 'done') kpEl.blur(); else calcPress(kpEl, b.dataset.k);
      });
      document.body.appendChild(kp);
    }
    kpEl = el;
    el.inputMode = 'none';
    el.kpFresh = el.value !== '';
    el.classList.toggle('kp-fresh', el.kpFresh);
    kp.hidden = false;
    document.documentElement.classList.add('kp-open');
    document.documentElement.style.setProperty('--kp-h', kp.offsetHeight + 'px');
    kpPaint();
    requestAnimationFrame(() => { const r = el.getBoundingClientRect(); if (r.bottom > innerHeight - kp.offsetHeight - 8 || r.top < 0) el.scrollIntoView({ block: 'center' }); });
  }
  // set before the tap focuses the box, so the phone never starts to open its own keyboard
  document.addEventListener('touchstart', (ev) => { const el = ev.target; if (el.classList && el.classList.contains('cents')) el.inputMode = 'none'; }, { capture: true, passive: true });
  document.addEventListener('focusout', (ev) => {
    const el = ev.target;
    if (!el.classList || !el.classList.contains('cents')) return;
    el.kpFresh = false; el.classList.remove('kp-fresh');
    setTimeout(() => {
      const a = document.activeElement;
      if (!kp || (a && a.classList && a.classList.contains('cents'))) return;
      kp.hidden = true; kpEl = null;
      document.documentElement.classList.remove('kp-open');
    }, 0);
  });

  // ---------- searchable drop-downs (computer layout) ----------
  // The page's own <select> stays as the box you see; only its pop-up list is replaced.
  let cbx = null;
  const zoomOf = () => parseFloat(getComputedStyle(document.body).zoom) || 1;
  function closeCombo() { if (cbx) { cbx.pop.remove(); cbx = null; } }
  function openCombo(sel, q) {
    closeCombo();
    const items = [];
    for (const node of sel.children) {
      if (node.tagName === 'OPTGROUP') for (const o of node.children) items.push({ v: o.value, t: o.textContent, g: node.label, dis: o.disabled });
      else if (node.tagName === 'OPTION') items.push({ v: node.value, t: node.textContent, g: '', dis: node.disabled });
    }
    const pop = document.createElement('div');
    pop.className = 'cbx-pop';
    pop.innerHTML = '<input class="cbx-q" type="text" placeholder="Search…" autocomplete="off" aria-label="Search the list"><div class="cbx-list" role="listbox"></div>';
    document.body.appendChild(pop);
    const z = zoomOf(), r = sel.getBoundingClientRect();
    const w = Math.max(r.width / z, 240);
    pop.style.width = w + 'px';
    pop.style.left = Math.min(r.left / z, (innerWidth / z) - w - 8) + 'px';
    const below = (innerHeight - r.bottom) / z;
    if (below < 300 && r.top / z > below) { pop.style.bottom = ((innerHeight - r.top) / z + 4) + 'px'; } else { pop.style.top = (r.bottom / z + 4) + 'px'; }
    const input = pop.querySelector('.cbx-q'), list = pop.querySelector('.cbx-list');
    cbx = { sel, pop, items, shown: [], hi: 0 };
    const paint = () => {
      const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      cbx.shown = items.filter((it) => !it.dis && words.every((wd) => (it.t + ' ' + it.g).toLowerCase().includes(wd)));
      let html = '', lastG = null;
      cbx.shown.forEach((it, i) => {
        if (it.g !== lastG) { if (it.g) html += `<div class="cbx-g">${esc(it.g)}</div>`; lastG = it.g; }
        html += `<div class="cbx-o${i === cbx.hi ? ' hi' : ''}${it.v === sel.value ? ' cur' : ''}" data-i="${i}" role="option">${esc(it.t)}</div>`;
      });
      list.innerHTML = html || '<div class="cbx-none">Nothing matches</div>';
      const h = list.querySelector('.hi'); if (h) h.scrollIntoView({ block: 'nearest' });
    };
    input.value = q || '';
    const cur = items.filter((it) => !it.dis).findIndex((it) => it.v === sel.value);
    cbx.hi = q ? 0 : Math.max(0, cur);
    paint();
    input.focus();
    input.addEventListener('input', () => { cbx.hi = 0; paint(); });
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); cbx.hi = Math.max(0, Math.min(cbx.shown.length - 1, cbx.hi + (ev.key === 'ArrowDown' ? 1 : -1))); paint(); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); const it = cbx.shown[cbx.hi]; if (it) chooseCombo(it.v); else { closeCombo(); sel.focus(); } }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeCombo(); sel.focus(); }
    });
    pop.addEventListener('mousedown', (ev) => { if (ev.target !== input) ev.preventDefault(); });
    pop.addEventListener('mousemove', (ev) => { const o = ev.target.closest('.cbx-o'); if (o && +o.dataset.i !== cbx.hi) { cbx.hi = +o.dataset.i; list.querySelectorAll('.cbx-o').forEach((e) => e.classList.toggle('hi', +e.dataset.i === cbx.hi)); } });
    pop.addEventListener('click', (ev) => { const o = ev.target.closest('.cbx-o'); if (o) chooseCombo(cbx.shown[+o.dataset.i].v); });
  }
  function chooseCombo(v) {
    const sel = cbx.sel;
    closeCombo();
    sel.focus();
    if (sel.value !== v) {
      sel.value = v;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  const comboOK = (sel) => sel && !isPhone() && !sel.multiple && !sel.disabled && !sel.dataset.native;
  document.addEventListener('mousedown', (ev) => {
    if (cbx && !(ev.target.closest && ev.target.closest('.cbx-pop'))) closeCombo();
    const sel = ev.target.closest && ev.target.closest('select');
    if (!comboOK(sel) || ev.button !== 0) return;
    ev.preventDefault();
    sel.focus();
    openCombo(sel, '');
  }, true);
  document.addEventListener('keydown', (ev) => {
    const sel = ev.target;
    if (sel.tagName !== 'SELECT' || !comboOK(sel) || ev.metaKey || ev.ctrlKey) return;
    // typing a letter, Space, or the arrow keys opens the searchable list (Enter and Tab keep moving between boxes)
    if (ev.key === ' ' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || (ev.key.length === 1 && !ev.altKey)) {
      ev.preventDefault(); ev.stopPropagation();
      openCombo(sel, ev.key.length === 1 && ev.key !== ' ' ? ev.key : '');
    }
  }, true);
  addEventListener('resize', closeCombo);
  addEventListener('scroll', (ev) => { if (cbx && !(ev.target.closest && ev.target.closest('.cbx-pop'))) closeCombo(); }, true);

  // ---------- payee search (any box marked data-payee) ----------
  // Typing searches the payees you already have, so you pick the same name each time instead of a near-copy.
  // A name that's not on the list is kept as a new payee only when you choose that line (or just carry on typing).
  let pyx = null, pyxQuiet = false;
  const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function typoGap(a, b) { // letters you'd change to turn one into the other (gives up past 3)
    if (Math.abs(a.length - b.length) > 2) return 9;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (Math.min(...cur) > 3) return 9;
      prev = cur;
    }
    return prev[b.length];
  }
  // each payee once, busiest first, with how many transactions use it
  function payeeChoices() {
    const count = {};
    for (const t of D.tx) if (t.payee) count[t.payee] = (count[t.payee] || 0) + 1;
    // payees made in Manage payees count too, even before they have a transaction
    const prefs = payeePrefs(), made = myRules().filter((r) => r.byPayee && r.payee).map((r) => r.payee).concat(Object.keys(prefs));
    return Array.from(new Set(payeeNames().concat(made.filter((n) => !(prefs[n] && prefs[n].hidden))))).filter((n) => !/^(starting balance|reconciliation adjustment)$/i.test(n))
      .map((name) => ({ name, f: fold(name), n: count[name] || 0 })).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
  }
  // what you typed against your payees: ones containing it, likely typos, and whether it's already there
  function payeeMatches(all, typed) {
    const q = fold(typed), words = q.split(' ').filter(Boolean);
    if (!q) return { q, found: all.slice(0, 200), near: [], exact: null };
    const score = (n) => (n.f === q ? 0 : n.f.indexOf(q) === 0 ? 1 : (' ' + n.f).indexOf(' ' + words[0]) >= 0 ? 2 : 3);
    const found = all.filter((n) => words.every((w) => n.f.includes(w))).sort((a, b) => score(a) - score(b) || b.n - a.n).slice(0, 60);
    const near = q.length < 4 ? [] : all.filter((n) => !found.includes(n) && Math.min(typoGap(q, n.f), typoGap(q, n.f.slice(0, q.length)), typoGap(q, n.f.slice(0, q.length + 1))) <= (q.length < 7 ? 1 : 2)).sort((a, b) => b.n - a.n).slice(0, 3);
    return { q, found, near, exact: all.find((n) => n.f === q) || null };
  }
  const usedTag = (n) => (n ? `<small title="Used ${n} time${n === 1 ? '' : 's'}">${n}</small>` : '');

  // computer: a list drops down under the box as you type
  function closePayee() { if (pyx) { pyx.pop.remove(); pyx = null; } }
  function placePayee() {
    if (!pyx) return;
    if (!document.body.contains(pyx.el)) { closePayee(); return; }
    const z = zoomOf(), r = pyx.el.getBoundingClientRect(), below = (innerHeight - r.bottom) / z;
    const w = Math.max(r.width / z, 240);
    pyx.pop.style.width = w + 'px';
    pyx.pop.style.left = Math.max(8, Math.min(r.left / z, (innerWidth / z) - w - 8)) + 'px';
    pyx.pop.style.top = pyx.pop.style.bottom = '';
    const up = below < 220 && r.top / z > below;
    if (up) pyx.pop.style.bottom = (innerHeight / z - r.top / z + 4) + 'px'; else pyx.pop.style.top = (r.bottom / z + 4) + 'px';
    pyx.pop.style.maxHeight = Math.max(140, Math.min(320, (up ? r.top / z : below) - 12)) + 'px';
  }
  function paintPayee() {
    const { el, list } = pyx, typed = el.value.trim(), { q, found, near, exact } = payeeMatches(pyx.names, typed);
    pyx.opts = found.map((n) => ({ v: n.name, n: n.n })).concat(near.map((n) => ({ v: n.name, n: n.n, near: true })));
    if (typed && !exact) pyx.opts.push({ v: typed, add: true });
    if (pyx.hi == null || pyx.hi >= pyx.opts.length) pyx.hi = !q ? -1 : exact ? pyx.opts.findIndex((o) => o.v === exact.name) : found.length ? 0 : pyx.opts.length - 1;
    let html = !q && found.length ? '<div class="cbx-g">Your payees</div>' : '';
    pyx.opts.forEach((o, i) => {
      if (o.near && (i === 0 || !pyx.opts[i - 1].near)) html += '<div class="cbx-g">Did you mean</div>';
      const cls = `cbx-o${i === pyx.hi ? ' hi' : ''}${o.add ? ' pyx-add' : ''}`;
      html += o.add ? `<div class="${cls}" data-i="${i}" role="option">+ New payee “${esc(o.v)}”</div>` : `<div class="${cls}" data-i="${i}" role="option"><span>${esc(o.v)}</span>${usedTag(o.n)}</div>`;
    });
    list.innerHTML = html || '<div class="cbx-none">No payees yet. Type a name to add one.</div>';
    const h = list.querySelector('.hi'); if (h) h.scrollIntoView({ block: 'nearest' });
  }
  function openPayee(el) {
    if (isPhone() || (pyx && pyx.el === el)) return;
    closePayee(); closeCombo();
    const pop = document.createElement('div');
    pop.className = 'cbx-pop pyx-pop';
    // the side sheet would close to show the manager, so only offer it where nothing typed gets lost
    pop.innerHTML = '<div class="cbx-list" role="listbox"></div>' + (el.closest('#sheet') ? '' : '<button class="linkish pyx-manage" data-pyx="manage">Manage payees</button>');
    document.body.appendChild(pop);
    pyx = { el, pop, list: pop.querySelector('.cbx-list'), names: payeeChoices(), opts: [], hi: null };
    paintPayee(); placePayee();
    pop.addEventListener('pointerdown', (ev) => ev.preventDefault()); // keep the cursor in the box
    pop.addEventListener('mousemove', (ev) => { const o = ev.target.closest('.cbx-o'); if (o && +o.dataset.i !== pyx.hi) { pyx.hi = +o.dataset.i; pyx.list.querySelectorAll('.cbx-o').forEach((e) => e.classList.toggle('hi', +e.dataset.i === pyx.hi)); } });
    pop.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-pyx=manage]')) { closePayee(); openPayees(); return; }
      const o = ev.target.closest('.cbx-o'); if (o) choosePayee(pyx.opts[+o.dataset.i]);
    });
  }
  function setPayee(el, v) {
    if (el.value === v) return;
    el.value = v;
    pyxQuiet = true; // the list has done its job, so don't pop it open again
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    pyxQuiet = false;
  }
  function choosePayee(o) {
    const el = pyx.el;
    closePayee();
    if (!o) return;
    el.focus();
    setPayee(el, o.v);
  }

  // phone: tapping the box opens a full-screen search; you tap a payee or tap Add new, nothing is filled in for you
  let pym = null;
  function closePayeeScreen() { if (pym) { pym.wrap.remove(); pym = null; } }
  function fitPayeeScreen() { // keep it in the part of the screen the keyboard leaves
    if (!pym || !window.visualViewport) return;
    const z = zoomOf();
    pym.wrap.style.top = (visualViewport.offsetTop / z) + 'px';
    pym.wrap.style.height = (visualViewport.height / z) + 'px';
  }
  function paintPayeeScreen() {
    const typed = pym.q.value.trim(), { q, found, near, exact } = payeeMatches(pym.names, typed), cur = pym.el.value;
    const row = (n, cls) => `<button class="pym-o${n.name === cur ? ' cur' : ''}${cls || ''}" data-v="${esc(n.name)}"><span>${esc(n.name)}</span>${n.name === cur ? '<b>&#10003;</b>' : usedTag(n.n)}</button>`;
    let html = '';
    if (typed && !exact) html += `<button class="pym-o pym-add" data-add="1"><span>+ Add “${esc(typed)}” as a new payee</span></button>`;
    if (near.length) html += `<div class="pym-g">${found.length ? 'Or did you mean' : 'Did you mean'}</div>` + near.map((n) => row(n)).join('');
    if (found.length) html += `<div class="pym-g">${q ? 'Your payees that match' : 'Your payees'}</div>` + found.map((n) => row(n)).join('');
    if (!html) html = '<p class="pym-none">No payees yet. Type a name to add one.</p>';
    if (q && !found.length && !near.length) html += '<p class="pym-none">None of your payees match.</p>';
    pym.list.innerHTML = html;
    pym.list.scrollTop = 0;
  }
  function openPayeeScreen(el) {
    closePayeeScreen(); closePayee();
    const wrap = document.createElement('div');
    wrap.className = 'pym';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', 'Choose a payee');
    wrap.innerHTML = `<div class="pym-top"><input class="pym-q" type="search" placeholder="Search or type a new payee" autocomplete="off" autocapitalize="words" enterkeyhint="done" aria-label="Search payees"><button class="linkish" data-pym="cancel">Cancel</button></div>
      <div class="pym-list"></div>
      ${el.value ? '<div class="pym-foot"><button class="linkish" data-pym="clear">Clear the payee</button></div>' : ''}`;
    document.body.appendChild(wrap);
    pym = { el, wrap, q: wrap.querySelector('.pym-q'), list: wrap.querySelector('.pym-list'), names: payeeChoices() };
    fitPayeeScreen(); paintPayeeScreen();
    pym.q.focus(); // in the same tap, so the phone's keyboard comes up
    const pick = (v) => { closePayeeScreen(); setPayee(el, v); };
    pym.q.addEventListener('input', paintPayeeScreen);
    pym.q.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); closePayeeScreen(); }
      if (ev.key === 'Enter') { // only an exact name is taken without a tap
        ev.preventDefault();
        const ex = payeeMatches(pym.names, pym.q.value).exact;
        if (ex) pick(ex.name); else pym.q.blur();
      }
    });
    wrap.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.pym === 'cancel') closePayeeScreen();
      else if (b.dataset.pym === 'clear') pick('');
      else if (b.dataset.add) pick(pym.q.value.trim());
      else if (b.dataset.v != null) pick(b.dataset.v);
    });
  }
  if (window.visualViewport) for (const e of ['resize', 'scroll']) { visualViewport.addEventListener(e, fitPayeeScreen); visualViewport.addEventListener(e, () => fitPick()); }

  const isPayeeBox = (el) => el && el.tagName === 'INPUT' && el.dataset && el.dataset.payee;
  document.addEventListener('click', (ev) => { if (isPayeeBox(ev.target) && isPhone()) { ev.preventDefault(); ev.target.blur(); openPayeeScreen(ev.target); } }, true);
  document.addEventListener('focusin', (ev) => { if (isPayeeBox(ev.target)) openPayee(ev.target); else if (pyx && !pyx.pop.contains(ev.target)) closePayee(); });
  document.addEventListener('input', (ev) => { if (isPayeeBox(ev.target) && !pyxQuiet && !isPhone()) { if (!pyx || pyx.el !== ev.target) openPayee(ev.target); pyx.hi = null; paintPayee(); placePayee(); } }, true);
  document.addEventListener('focusout', (ev) => {
    const el = ev.target;
    if (!isPayeeBox(el)) return;
    if (pyx && pyx.el === el) closePayee();
    // "woolworths" typed by hand becomes the "Woolworths" you already have
    const same = el.value.trim() && payeeNames().find((n) => n !== el.value && n.toLowerCase() === el.value.trim().toLowerCase());
    if (same) { el.value = same; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, true);
  document.addEventListener('pointerdown', (ev) => {
    if (pyx && ev.target !== pyx.el && !pyx.pop.contains(ev.target)) closePayee();
    if (!pyx && isPayeeBox(ev.target) && document.activeElement === ev.target) openPayee(ev.target); // clicking the box again brings the list back
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (!isPayeeBox(ev.target)) return;
    if (!pyx) { if (ev.key === 'ArrowDown') { ev.preventDefault(); openPayee(ev.target); } return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault(); ev.stopPropagation();
      pyx.hi = Math.max(0, Math.min(pyx.opts.length - 1, (pyx.hi || 0) + (ev.key === 'ArrowDown' ? 1 : -1))); paintPayee();
    } else if (ev.key === 'Enter' && pyx.opts.length && ev.target.value.trim()) {
      // Enter takes the highlighted line; press it again to carry on (save, next box)
      ev.preventDefault(); ev.stopPropagation(); choosePayee(pyx.opts[pyx.hi]);
    } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePayee(); }
    else if (ev.key === 'Tab') closePayee();
  }, true);
  addEventListener('resize', placePayee);
  addEventListener('scroll', (ev) => { if (pyx && !pyx.pop.contains(ev.target)) placePayee(); }, true);

  // ---------- phone drop-downs (every <select> in the phone layout) ----------
  // The phone's own wheel is small and cuts long category names, so these open a list that slides up from the bottom:
  // big rows, categories under their group, what's available beside each, and a search box once the list is long.
  let pk = null;
  function fitPick() { // sit above the keyboard: iPhone leaves the page full height and slides the keyboard over it
    if (!pk || !window.visualViewport) return;
    const z = zoomOf();
    pk.wrap.style.top = (visualViewport.offsetTop / z) + 'px';
    pk.wrap.style.height = (visualViewport.height / z) + 'px';
  }
  function closePick() {
    if (!pk) return;
    const w = pk.wrap; pk = null;
    w.classList.remove('on');
    setTimeout(() => w.remove(), 180);
  }
  // choosing a category from the reconcile list: say which purchase it's for
  function pickTx(sel) {
    const t = sel.dataset.ckCat && D.txById[sel.dataset.ckCat];
    if (!t) return '';
    return `<div class="pk-tx"><span class="pk-tx1"><b>${esc(t.payee || tidyPayee(t.bank) || 'No payee')}</b><b class="${t.amt > 0 ? 'pos' : ''}">${txAmt(t.amt)}</b></span>
      <small>${esc(dateLabel(t.date))}${t.memo ? ` · ${esc(t.memo)}` : ''}</small>${t.bank ? `<small class="mono">${esc(t.bank)}</small>` : ''}</div>`;
  }
  function openPick(sel) {
    closePick(); closePayee(); closeCombo();
    const items = [];
    for (const node of sel.children) {
      if (node.tagName === 'OPTGROUP') for (const o of node.children) items.push({ v: o.value, t: o.textContent, g: node.label, dis: o.disabled });
      else if (node.tagName === 'OPTION') items.push({ v: node.value, t: node.textContent, g: '', dis: node.disabled });
    }
    // "Bills › Power" shows as Power under a Bills heading; an amount on the end ("· $20.00") moves to the right
    for (const it of items) {
      const m = it.t.match(/^(.*) · (\S*\d.*)$/);
      if (m) { it.tail = m[2]; it.t = m[1]; }
      const p = it.t.split(' › ');
      if (!it.g && p.length > 1) { it.name = p.pop(); it.g = p.join(' › '); } else it.name = it.t;
    }
    // categories show what's available and accounts their balance, whichever list they're in
    const note = (it) => {
      const v = it.v;
      if (v && D.cats[v] && D.month.rows[v]) { const r = D.month.rows[v]; return `<span class="pill st-${r.status}">${money(r.available)}</span>`; }
      if (v && D.accounts[v] && D.bal[v]) return `<small>${money(D.bal[v].balance || 0)}</small>`;
      if (it.tail) return `<small>${esc(it.tail)}</small>`;
      return '';
    };
    const field = sel.closest('.field'), lbl = (sel.id && document.querySelector(`label[for="${sel.id}"]`)) || sel.closest('label') || (field && field.querySelector('label, .lbl'));
    const title = sel.getAttribute('aria-label') || (lbl && Array.from(lbl.childNodes).filter((n) => n !== sel && !(n.contains && n.contains(sel))).map((n) => n.textContent).join('').trim()) || 'Choose';
    const wrap = document.createElement('div');
    wrap.className = 'pk';
    wrap.innerHTML = `<div class="pk-back" data-pk="cancel"></div>
      <div class="pk-sheet${items.length > 12 ? ' has-s' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="pk-top"><b>${esc(title)}</b><button class="linkish" data-pk="cancel">Cancel</button></div>
        ${pickTx(sel)}
        ${items.length > 12 ? '<div class="pk-s"><input class="pym-q" type="search" placeholder="Search" autocomplete="off" enterkeyhint="search" aria-label="Search the list"></div>' : ''}
        <div class="pk-list" role="listbox"></div>
      </div>`;
    document.body.appendChild(wrap);
    pk = { sel, wrap, list: wrap.querySelector('.pk-list'), q: wrap.querySelector('.pk-s input') };
    const paint = () => {
      const words = pk.q ? fold(pk.q.value).split(' ').filter(Boolean) : [];
      let html = '', lastG = null;
      for (const it of items) {
        if (it.dis || !words.every((w) => fold(it.t + ' ' + it.g).includes(w))) continue;
        if (it.g !== lastG) { if (it.g) html += `<div class="pym-g">${esc(it.g)}</div>`; lastG = it.g; }
        const cur = it.v === sel.value;
        html += `<button class="pym-o${cur ? ' cur' : ''}${it.g ? ' in-g' : ''}" data-v="${esc(it.v)}" role="option" aria-selected="${cur}"><span>${esc(it.name)}</span><i>${note(it)}${cur ? '<b>&#10003;</b>' : ''}</i></button>`;
      }
      pk.list.innerHTML = html || '<p class="pym-none">Nothing matches.</p>';
    };
    fitPick(); paint();
    const cur = pk.list.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
    requestAnimationFrame(() => wrap.classList.add('on'));
    if (pk.q) {
      pk.q.addEventListener('input', () => { paint(); pk.list.scrollTop = 0; });
      pk.q.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); closePick(); }
        if (ev.key === 'Enter') { ev.preventDefault(); pk.q.blur(); } // just drops the keyboard to see the list
      });
    }
    wrap.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pk], [data-v]'); if (!b) return;
      if (b.dataset.pk === 'cancel') { closePick(); return; }
      const v = b.dataset.v;
      closePick();
      if (sel.value !== v) {
        sel.value = v;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
  const pickOK = (sel) => sel && isPhone() && !sel.multiple && !sel.disabled;
  // a tap (not a scroll) on the box opens ours instead of the phone's wheel
  let pkTouch = null;
  document.addEventListener('touchstart', (ev) => { const t = ev.touches[0]; pkTouch = ev.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null; }, { capture: true, passive: true });
  document.addEventListener('touchend', (ev) => {
    const sel = ev.target.closest && ev.target.closest('select');
    if (!pickOK(sel) || !pkTouch || !ev.cancelable) return;
    const t = ev.changedTouches[0];
    if (Math.abs(t.clientX - pkTouch.x) > 10 || Math.abs(t.clientY - pkTouch.y) > 10) return;
    ev.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // put the keyboard away
    openPick(sel);
  }, true);
  // a computer window narrow enough for the phone layout gets the same list
  document.addEventListener('mousedown', (ev) => {
    const sel = ev.target.closest && ev.target.closest('select');
    if (!pickOK(sel) || ev.button !== 0) return;
    ev.preventDefault();
    openPick(sel);
  }, true);
  document.addEventListener('keydown', (ev) => { if (pk && ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePick(); } }, true);

  // ---------- right-click menus ----------
  let ctx = null;
  function closeCtx() { if (ctx) { ctx.remove(); ctx = null; } }
  // items: [key, label, shortcut, run, cls] or ['sep'] or ['head', label]
  function showCtx(ev, items) {
    items = items.filter(Boolean).filter((it, i, a) => it[0] !== 'sep' || (i > 0 && i < a.length - 1 && a[i - 1][0] !== 'sep'));
    if (!items.length) return;
    closeCtx();
    ctx = document.createElement('div');
    ctx.className = 'ctx-menu'; ctx.setAttribute('role', 'menu');
    ctx.innerHTML = items.map((it, i) => it[0] === 'sep' ? '<div class="ctx-sep"></div>' : it[0] === 'head' ? `<div class="ctx-head">${esc(it[1])}</div>` : `<button role="menuitem" data-i="${i}" class="${it[4] || ''}"><span>${it[1]}</span><kbd>${it[2] || ''}</kbd></button>`).join('');
    document.body.appendChild(ctx);
    const z = zoomOf(), w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.max(6, Math.min(ev.clientX / z, innerWidth / z - w - 6)) + 'px';
    ctx.style.top = Math.max(6, Math.min(ev.clientY / z, innerHeight / z - h - 6)) + 'px';
    ctx.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const run = items[Number(b.dataset.i)][3];
      closeCtx(); fresh();
      if (run) await run();
    });
  }
  const go = (view, extra) => () => { if (extra) extra(); UI.view = view; saveUI(); render(); window.scrollTo(0, 0); };
  const PAGES = [['budget', 'Budget'], ['tx', 'Transactions'], ['accounts', 'Accounts'], ['settings', 'Settings']];
  const goItems = () => [['sep'], ['head', 'Go to']].concat(PAGES.filter(([k]) => k !== UI.view).map(([k, l]) => ['nav', l, '', () => actions.nav({ dataset: { nav: k } })]));
  const showCatTx = (id) => go('tx', () => { UI.only = null; UI.rec = null; UI.editTx = null; UI.f = Object.assign(NO_FILTERS(), { cat: id }); UI.q = ''; UI.showFilters = false; });

  function txMenu(id) {
    const t = D.txById[id];
    if (!t) return null;
    if (UI.editTx) { UI.editTx = null; UI.editDraft = null; }
    const pk = picked();
    if (pk.length >= 2 && pk.includes(id)) {
      const ok = pk.length === 2 && !mergeProblem(D.txById[pk[0]], D.txById[pk[1]]);
      const nOk = pk.filter((x) => D.txById[x].match || D.txById[x].approved === false).length;
      return [['head', `${pk.length} selected`], nOk ? ['approve', `Approve ${nOk}`, 'A', () => actions['multi-approve']()] : null, ok ? ['merge', 'Merge these two into one', '', () => actions['multi-merge']()] : null, ['clear', 'Clear the selection', '', () => actions['multi-clear']()]];
    }
    UI.multi = null; UI.sel = id; UI.delAsk = null; render();
    const twins = twinIds(id);
    return [
      ['edit', 'Edit', 'Enter', () => startInline(id)],
      t.match ? ['approve', t.match.kind === 'update' ? 'Approve the update' : 'Approve the match', 'A', async () => { await approve([id]); render(); }] : t.approved === false ? ['approve', 'Approve', 'A', async () => { await approve([id]); render(); }] : null,
      t.match ? ['unmatch', t.match.kind === 'update' ? 'Different purchases: keep both' : 'Unlink (split them)', 'U', async () => { await unmatch(id); render(); }] : null,
      twins ? ['twins', 'Show possible doubles', '', () => { UI.dbl = true; UI.bc = null; render(); window.scrollTo(0, 0); }] : null,
      t.cleared !== 'r' ? ['clear', t.cleared === 'c' ? 'Mark as not cleared' : 'Mark as cleared', '', () => toggleClear(id)] : null,
      t.receipt ? ['receipt', 'View receipt', '', () => openLightbox('/_blob/' + t.receipt, t.receiptType)] : null,
      t.cat && D.cats[t.cat] ? ['cat', 'Show all in ' + esc(catName(t.cat)), '', showCatTx(t.cat)] : null,
      t.payee ? ['payee', `Manage payee &ldquo;${esc(t.payee)}&rdquo;`, '', () => openPayees({ tab: 'payees', payee: t.payee })] : null,
      bankText(t) ? ['rule', 'Make a rule from this&hellip;', '', () => openPayees({ tab: 'rules', prefill: { text: cleanDesc(bankText(t)).split(' ').slice(0, 3).join(' '), payee: t.payee || '', cat: t.cat && okCat(t.cat) && t.cat !== START ? t.cat : '' } })] : null,
      ['sep'],
      ['delete', 'Delete', 'Del', async () => { UI.delAsk = id; await deleteAsk(id); }, 'bad'],
    ];
  }

  function catMenu(id, own) {
    const c = D.cats[id];
    if (!c) return null;
    if (own) return [['move', 'Move money', '', () => openMove(id)]];
    const leaf = D.tree.isLeaf(id), pot = D.tree.isPot(id);
    const r = leaf ? D.month.rows[id] : D.month.roll[id];
    const tgt = leaf ? r.target : pot ? D.month.roll[id].target : null;
    const under = tgt && tgt.under > 0 ? tgt.under : 0;
    const avail = r.available;
    const fund = async (amt) => {
      const map = { [id]: D.month.rows[id].assigned + amt };
      const src = D.tree.source(id);
      if (src) map[src] = D.month.rows[src].assigned - amt;
      await putAssigned(UI.month, map);
    };
    const mine = c.kind || null, kinds = [[null, c.parent ? 'Same as group' : 'Not tagged']].concat(KINDS.map(([k, , l]) => [k, l]));
    return [
      ['head', esc(c.name)],
      ['open', 'Details and target', '', () => openCat(id)],
      leaf || pot ? ['move', avail < 0 ? 'Cover the overspending' : 'Move money', '', () => openMove(id)] : null,
      under ? ['fund', `Fund the target (${money(under)})`, '', async () => { await fund(under); toast(`Assigned ${money(under)} to ${c.name}`); }] : null,
      leaf && avail < 0 && !under ? ['cover', `Assign ${money(-avail)} to cover it`, '', async () => { await fund(-avail); toast(`Assigned ${money(-avail)} to ${c.name}`); }] : null,
      ['tx', 'Show its transactions', '', showCatTx(id)],
      !leaf ? ['toggle', UI.collapsed[id] ? 'Expand' : 'Collapse', '', () => actions.toggle({ dataset: { id } })] : null,
      ['sep'],
      payAcct(id) ? ['head', 'Type: minimum is a need, extra is savings'] : ['head', 'Type']].concat(payAcct(id) ? [] : kinds.map(([k, l]) => ['kind', `<i class="ctx-ck">${mine === k ? '&#10003;' : ''}</i>` + esc(l), '', () => putCat(Object.assign({}, D.cats[id], { kind: k }))])).concat([
      ['sep'],
      payAcct(id) ? ['acct', 'Open ' + esc(payAcct(id).name) + ' account', '', () => actions['acct-tx']({ dataset: { id: payAcct(id).id } })] : ['sub', 'Add subcategory', '', () => promptNewCat(id)],
      payAcct(id) ? ['plan', 'Payoff plan', '', () => openPayoff(payAcct(id).id)] : null,
      ['up', 'Move up', '', () => moveCat(id, -1)],
      ['down', 'Move down', '', () => moveCat(id, 1)],
      payAcct(id) ? null : ['hide', c.hidden ? 'Unhide' : 'Hide', '', async () => { await putCat(Object.assign({}, D.cats[id], { hidden: !c.hidden })); toast(c.hidden ? 'Category shown' : 'Category hidden. Its money still counts.'); }],
      leaf && !payAcct(id) ? ['delete', 'Delete&hellip;', '', () => deleteCat(id), 'bad'] : null,
    ]);
  }

  function acctMenu(id) {
    const a = D.accounts[id];
    if (!a) return null;
    return [
      ['head', esc(a.name)],
      ['tx', 'Transactions', '', () => actions['acct-tx']({ dataset: { id } })],
      ['rec', a.type === 'tracking' ? 'Update balance' : 'Import &amp; reconcile', '', () => openImport(id)],
      DEBT_TYPES[a.type] ? ['plan', 'Payoff plan', '', () => openPayoff(id)] : null,
      ['sep'],
      ['edit', 'Edit account', '', () => openAcct(id)],
    ];
  }

  function pageMenu() {
    const v = UI.view;
    if (v === 'budget') {
      const plan = E.planAutoAssign(D.month);
      return [
        Object.keys(plan.changes).length ? ['fund', `Fund all targets${plan.rtaUsed ? ` (${money(plan.rtaUsed)})` : ''}`, '', autoAssign] : null,
        ['prev', 'Previous month', '', () => actions['prev-month']()],
        ['next', 'Next month', '', () => actions['next-month']()],
        UI.month !== E.monthOf(E.todayISO()) ? ['now', 'This month', '', () => actions['this-month']()] : null,
        ['sep'],
        ['all', Object.keys(UI.collapsed).length ? 'Expand all groups' : 'Collapse all groups', '', () => actions['collapse-all']()],
        ['edit', UI.editCats ? 'Done editing categories' : 'Edit categories', '', () => actions['edit-cats']()],
        ['add', 'Add top-level category', '', () => promptNewCat(null)],
      ].concat(goItems());
    }
    if (v === 'tx') {
      const filtered = UI.only || UI.q || Object.values(UI.f).some(Boolean);
      return [
        ['add', 'Add transaction', '', () => openTx(null)],
        UI.rec ? ['stop', 'Stop reconciling', '', () => actions['rec-stop']()] : ['rec', 'Import &amp; reconcile', '', () => openImport()],
        filtered ? ['clear', 'Clear filters', '', () => actions['clear-filters']()] : null,
        ['payees', 'Payees and rules', '', () => openPayees()],
      ].concat(goItems());
    }
    if (v === 'accounts') return [['add', 'Add account', '', () => openAcct(null)]].concat(goItems());
    return goItems().slice(1);
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-acct-more]');
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    const r = b.getBoundingClientRect(), z = zoomOf();
    showCtx({ clientX: (r.right - 4) * z, clientY: (r.bottom + 2) * z }, acctMenu(b.dataset.acctMore));
  }, true);
  document.addEventListener('contextmenu', (ev) => {
    const tg = ev.target;
    // keep the normal menu for typing, selected text, sheets and the phone layout
    if (isPhone() || !tg.closest || tg.closest('input, textarea, select, [contenteditable], #sheet, #lightbox, .cbx-pop') || String(getSelection()).trim()) { closeCtx(); return; }
    if (tg.closest('.ctx-menu')) { ev.preventDefault(); return; }
    let items = null;
    const row = tg.closest('.txl .txr[data-row]');
    const brow = tg.closest('.brow[data-cat]');
    const acc = tg.closest('.acc[data-acct], .ar[data-acct]');
    if (row && row.classList.contains('editing')) { closeCtx(); return; }
    if (row) items = txMenu(row.dataset.row);
    else if (brow) items = catMenu(brow.dataset.cat, !!brow.dataset.own);
    else if (acc) items = acctMenu(acc.dataset.acct);
    if (!items) items = pageMenu();
    ev.preventDefault();
    showCtx(ev, items);
  });
  document.addEventListener('mousedown', (ev) => { if (ctx && !ctx.contains(ev.target)) closeCtx(); }, true);
  document.addEventListener('keydown', (ev) => { if (ctx && ev.key === 'Escape') { ev.stopPropagation(); closeCtx(); } }, true);
  addEventListener('scroll', closeCtx, true);
  addEventListener('blur', () => { closeCtx(); closeCombo(); });

  // ---------- payees and rules ----------
  // rules live in meta/rules: learned ones keyed by the bank description; ones you make are 'r:<id>' {kind:'rule'};
  // payee settings are 'p:<name>' {kind:'payee', name, cat, hidden}
  const cleanDesc = (d) => String(d || '').replace(/^\s*(pos|eftpos|v\d{3,5})\s+/i, '').replace(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s+(\d{1,2}:\d{2}\s*)?/, '').replace(/\s+/g, ' ').trim();
  const myRules = () => Object.entries(D.rules).filter(([k, r]) => r && r.kind === 'rule').map(([k, r]) => Object.assign({ key: k }, r)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const learnedRules = () => Object.entries(D.rules).filter(([k, r]) => r && !r.kind);
  const payeePrefs = () => { const o = {}; for (const [k, r] of Object.entries(D.rules)) if (r && r.kind === 'payee') o[r.name] = Object.assign({ key: k }, r); return o; };
  // a rule's bank descriptions (any one of them matches); older rules had just one
  const ruleTexts = (r) => (r.texts && r.texts.length ? r.texts : [{ match: r.match || 'contains', text: r.text || '' }]).filter((x) => x.text && x.text.trim());
  function textHits(m, desc) {
    const t = m.text.toLowerCase().trim(), d = String(desc).toLowerCase(), c = cleanDesc(desc).toLowerCase();
    if (m.match === 'starts') return c.startsWith(t) || d.startsWith(t);
    if (m.match === 'is') return c === t || d.trim() === t;
    return d.includes(t);
  }
  // tx: {amt, acct} when known, for the money, amount and account conditions
  function ruleHits(rule, desc, tx) {
    if (!desc) return false;
    // "does not contain" lines rule a description out; the others are any one of them, or all
    const all = ruleTexts(rule), texts = all.filter((m) => m.match !== 'not');
    if (!texts.length || !(rule.all ? texts.every((m) => textHits(m, desc)) : texts.some((m) => textHits(m, desc)))) return false;
    if (all.some((m) => m.match === 'not' && String(desc).toLowerCase().includes(m.text.toLowerCase().trim()))) return false;
    const amt = tx && tx.amt != null ? tx.amt : null;
    if (rule.dir && (amt == null || (rule.dir === 'out' ? amt >= 0 : amt <= 0))) return false;
    if (rule.amtIs != null && (amt == null || Math.abs(amt) !== rule.amtIs)) return false;
    if (rule.amtMin != null && (amt == null || Math.abs(amt) < rule.amtMin)) return false;
    if (rule.amtMax != null && (amt == null || Math.abs(amt) > rule.amtMax)) return false;
    if (rule.acct && (!tx || tx.acct !== rule.acct)) return false;
    if (rule.days && rule.days.length && !rule.days.includes(dayOf(desc, tx && tx.date))) return false;
    return true;
  }
  // the day of the month for a rule: from the date in the bank description ("V1234 23/09 …" is the 23rd), else the transaction's date
  function dayOf(desc, date) {
    const dm = E.dayMonth(desc);
    if (dm) return +dm.split('/')[0];
    return date ? +String(date).slice(8, 10) : null;
  }
  const nth = (d) => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');
  // how many "only if" conditions a rule has: the most specific matching rule wins
  const ruleDetail = (r) => (r.dir ? 1 : 0) + (r.amtIs != null || r.amtMin != null || r.amtMax != null ? 1 : 0) + (r.acct ? 1 : 0) + (r.days && r.days.length ? 1 : 0) + (r.all ? 1 : 0) + (ruleTexts(r).some((m) => m.match === 'not') ? 1 : 0);
  // two transactions on one day: which came first, from the bank's balance after each (saved on import)
  function bankOrder(a, b) {
    const da = bankDate(a), db = bankDate(b);
    if (da !== db) return da < db ? -1 : 1;
    if (a.bal != null && b.bal != null) { if (b.bal - b.amt === a.bal) return -1; if (a.bal - a.amt === b.bal) return 1; }
    return 0;
  }
  // which of an alternating rule's fill-ins a transaction got (by payee, then category), or -1
  const altIndex = (alt, t) => alt.findIndex((o) => (o.payee ? t.payee === o.payee : true) && (o.cat ? t.cat === o.cat : true) && (o.payee || o.cat));
  // an alternating rule gives the next fill-in after the one the previous matching transaction got
  function altPick(rule, prior) {
    const alt = rule.alt, sorted = prior.slice().sort(bankOrder);
    if (!sorted.length) return alt[0];
    // the last day's transactions, in case their order on that day isn't known
    const lastDay = bankDate(sorted[sorted.length - 1]), day = sorted.filter((t) => bankDate(t) === lastDay);
    const known = day.length === 1 || day.every((t) => t.bal != null);
    if (known) return alt[(altIndex(alt, sorted[sorted.length - 1]) + 1) % alt.length];
    const got = new Set(day.map((t) => altIndex(alt, t)).filter((i) => i >= 0));
    if (got.size === alt.length) return alt[0]; // a whole round that day: start again
    return alt[(Math.max(-1, ...got) + 1) % alt.length];
  }
  // a rule in a sentence, for the list
  function ruleSummary(r) {
    const when = ruleTexts(r).filter((m) => m.match !== 'not').map((m) => `${m.match === 'starts' ? 'starts with ' : m.match === 'is' ? 'is exactly ' : ''}<b>${esc(m.text)}</b>`).join(r.all ? ' and ' : ' or ')
      + ruleTexts(r).filter((m) => m.match === 'not').map((m) => ` but not <b>${esc(m.text)}</b>`).join('');
    const extra = [];
    if (r.dir) extra.push(r.dir === 'out' ? 'spending only' : 'income only');
    if (r.amtIs != null) extra.push(money(r.amtIs));
    else if (r.amtMin != null || r.amtMax != null) extra.push(r.amtMin != null && r.amtMax != null ? `${money(r.amtMin)} to ${money(r.amtMax)}` : r.amtMin != null ? `${money(r.amtMin)} or more` : `up to ${money(r.amtMax)}`);
    if (r.acct && D.accounts[r.acct]) extra.push(esc(acctName(r.acct)));
    if (r.days && r.days.length) extra.push('on the ' + r.days.map(nth).join(' or '));
    const fill = (o) => [o.payee ? `<b>${esc(o.payee)}</b>` : '', o.cat ? esc(o.cat === INCOME ? 'Ready to Assign' : catName(o.cat)) : '', o.memo ? `<i>${esc(o.memo)}</i>` : ''].filter(Boolean).join(' · ');
    const then = r.alt && r.alt.length > 1 ? `takes turns: ${r.alt.map(fill).join(' <span class="muted">then</span> ')}` : fill(r);
    return `${when}${extra.length ? ` <span class="muted">(${extra.join(', ')})</span>` : ''} → ${then || 'nothing yet'}`;
  }

  // the bank's wording for a transaction: its bank text, or a note brought over from YNAB that starts with 🔹
  const bankText = (t) => t.bank || (/^\uD83D\uDD39/.test(t.memo || '') ? t.memo.replace(/^\uD83D\uDD39\s*/, '') : '');
  const okCat = (c) => !c || c === INCOME || (D.cats[c] && D.tree.isLeaf(c));
  // your own rules first, then what the app has learned
  function ruleFor(desc, amt, acct, date) {
    const l = D.rules[E.descKey(desc)];
    for (const r of myRules().sort((a, b) => ruleDetail(b) - ruleDetail(a))) if (ruleHits(r, desc, { amt, acct, date })) {
      // a rule that only names the payee still gets a category: the payee's own, or what was learned for this wording
      const pc = r.payee && payeePrefs()[r.payee] ? payeePrefs()[r.payee].cat : null;
      const cat = r.cat || pc || (l && !l.kind ? l.cat : null) || null;
      if (r.alt && r.alt.length > 1) return { payee: null, cat: null, memo: null, mine: true, key: r.key, alt: r.alt, rule: r };
      return { payee: r.payee || null, cat: okCat(cat) ? cat : null, memo: r.memo || null, mine: true };
    }
    return l && !l.kind && okCat(l.cat) ? l : null;
  }
  // a payee's chosen category, or the one it used last
  function payeeCat(name) {
    const pref = payeePrefs()[name];
    if (pref && pref.cat && okCat(pref.cat)) return pref.cat;
    const last = D.tx.filter((x) => x.payee === name && x.cat && x.cat !== START && okCat(x.cat)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return last ? last.cat : null;
  }
  const payeeNames = () => { const hid = payeePrefs(); return Array.from(new Set(D.tx.map((x) => x.payee).filter(Boolean))).filter((p) => !(hid[p] && hid[p].hidden)).sort(); };

  function payeeStats() {
    const m = {};
    for (const t of D.tx) {
      if (!t.payee || t.transfer || t.cat === START) continue;
      const o = m[t.payee] = m[t.payee] || { name: t.payee, n: 0, last: '', cats: {} };
      o.n++; if (t.date > o.last) o.last = t.date;
      if (t.cat && okCat(t.cat)) o.cats[t.cat] = (o.cats[t.cat] || 0) + 1;
    }
    return Object.values(m);
  }

  // descriptions linked to a payee live in one rule per payee ({byPayee: true})
  const payeeRule = (name) => myRules().find((r) => r.byPayee && r.payee === name) || null;
  async function renamePayee(from, to) {
    const merging = D.tx.some((t) => t.payee === to);
    const changed = D.tx.filter((t) => t.payee === from).map((t) => Object.assign({}, t, { payee: to }));
    await putTxs(changed);
    // learned rules, rules and payee settings follow the new name; two payees' description lists join up
    const items = {}, into = payeeRule(to);
    for (const [k, r] of Object.entries(D.rules)) {
      if (r && !r.kind && r.payee === from) items[k] = Object.assign({}, r, { payee: to });
      if (r && r.kind === 'rule' && r.payee === from) {
        if (r.byPayee && into) { items[into.key] = Object.assign({}, D.rules[into.key], { texts: ruleTexts(D.rules[into.key]).concat(ruleTexts(r)) }); items[k] = null; }
        else items[k] = Object.assign({}, r, { payee: to });
      }
      if (r && r.kind === 'payee' && r.name === from) items[k] = merging ? null : Object.assign({}, r, { name: to });
    }
    if (Object.keys(items).length) await guard(S.write('meta', 'rules', { items }));
    return { merging, n: changed.length };
  }
  // add words to a payee's list, and give matching transactions you already have that payee
  async function linkToPayee(name, text) {
    text = String(text || '').trim().toUpperCase();
    if (!name || !text) return 0;
    const r = payeeRule(name), m = { match: 'contains', text };
    const texts = (r ? ruleTexts(r) : []).filter((x) => x.text.toUpperCase() !== text).concat([m]);
    const key = r ? r.key : 'r:' + S.uid();
    await guard(S.write('meta', 'rules', { items: { [key]: Object.assign({ kind: 'rule', byPayee: true, payee: name, cat: null, memo: null, order: Date.now() }, r ? D.rules[key] : {}, { texts, match: texts[0].match, text: texts[0].text }) } }));
    const pc = payeePrefs()[name] ? payeePrefs()[name].cat : null;
    const changed = D.tx.filter((t) => !t.transfer && t.payee !== name && textHits(m, bankText(t))).map((t) => Object.assign({}, t, { payee: name }, pc && !t.cat && !(t.splits && t.splits.length) ? { cat: pc } : {}));
    if (changed.length) await putTxs(changed);
    return changed.length;
  }
  async function unlinkFromPayee(name, text) {
    const r = payeeRule(name);
    if (!r) return;
    const texts = ruleTexts(r).filter((x) => x.text !== text);
    await guard(S.write('meta', 'rules', { items: { [r.key]: texts.length ? Object.assign({}, D.rules[r.key], { texts, match: texts[0].match, text: texts[0].text }) : null } }));
  }
  // the rule's fill-in line and its preview share the Transactions page's columns
  const RF_HEAD = '<div class="rf-row rf-head" aria-hidden="true"><span>Date</span><span>Payee</span><span>Category</span><span>Note</span><span>Bank description</span><span class="rf-amt">Amount</span></div>';
  function openPayees(opt) {
    opt = opt || {};
    // opened for one payee: show it (and any look-alikes) with its matches open
    let tab = opt.tab || 'payees', q = opt.payee ? bcKey(opt.payee) || opt.payee : '', editing = null, editLearned = null, open = opt.payee || null, adding = false, picked = opt.payee ? [opt.payee] : [], delAsk = false, form = opt.prefill ? Object.assign({ match: 'contains', text: '', payee: '', cat: '', past: true }, opt.prefill) : null;
    const prefs = () => payeePrefs();
    // what to do with the selected payees
    function pickBar(stats) {
      if (!picked.length) return '';
      const n = (name) => (stats.find((p) => p.name === name) || { n: 0 }).n, txs = picked.reduce((a, x) => a + n(x), 0);
      if (delAsk) return `<div class="pm-bar bad"><span>Delete ${picked.length === 1 ? `<b>${esc(picked[0])}</b>` : `${picked.length} payees`}? ${txs ? `${txs} ${txs === 1 ? 'transaction keeps' : 'transactions keep'} their amounts and categories, but the payee name is cleared.` : ''}</span><button class="btn sm danger" data-saction="pr-delete">Delete</button><button class="btn sm" data-saction="pr-keep">Cancel</button></div>`;
      if (picked.length === 1) return `<div class="pm-bar"><span><b>${esc(picked[0])}</b> selected. Shift-click another to merge them, or press Delete to remove it.</span><button class="btn sm" data-saction="pr-delask">Delete</button><button class="btn sm" data-saction="pr-clear">Clear</button></div>`;
      const into = picked.slice().sort((a, b) => n(b) - n(a))[0];
      return `<div class="pm-bar"><span><b>${picked.length} payees</b> selected. Merge them into</span><select id="pr-into" data-native="1">${picked.map((x) => `<option value="${esc(x)}" ${x === into ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><button class="btn sm primary" data-saction="pr-merge">Merge</button><button class="btn sm" data-saction="pr-delask">Delete</button><button class="btn sm" data-saction="pr-clear">Clear</button></div>`;
    }
    async function deletePayees(names) {
      const set = new Set(names);
      await putTxs(D.tx.filter((t) => set.has(t.payee)).map((t) => Object.assign({}, t, { payee: '' })));
      const items = {};
      for (const [k, r] of Object.entries(D.rules)) {
        if (!r) continue;
        if (r.kind === 'payee' && set.has(r.name)) items[k] = null;
        if (r.kind === 'rule' && r.byPayee && set.has(r.payee)) items[k] = null;
        if (!r.kind && set.has(r.payee)) items[k] = null;
      }
      if (Object.keys(items).length) await guard(S.write('meta', 'rules', { items }));
    }
    function matchBox(name, stats) {
      const r = payeeRule(name), texts = r ? ruleTexts(r) : [];
      const key = bcKey(name), sugg = key && !texts.some((x) => x.text.toLowerCase() === key) ? key.toUpperCase() : '';
      // other payees that look like this one ("Kmart Griffith" beside "Kmart")
      const alike = key ? stats.filter((p) => p.name !== name && p.n && bcKey(p.name) === key) : [];
      return `<div class="pm-box">
        <span>When a bank description contains any of these, call it <b>${esc(name)}</b>:</span>
        <div class="pm-chips">${texts.map((x) => `<span class="pm-chip">${esc(x.text)}<button data-saction="pm-del" data-n="${esc(name)}" data-t="${esc(x.text)}" aria-label="Remove ${esc(x.text)}" title="Remove">&times;</button></span>`).join('') || '<span class="hint">None yet.</span>'}
          ${sugg ? `<button class="pm-chip pm-sugg" data-saction="pm-add" data-n="${esc(name)}" data-t="${esc(sugg)}" title="Add it">+ ${esc(sugg)}</button>` : ''}</div>
        <div class="pm-add"><input id="pm-text" placeholder="Add words, e.g. ${esc(sugg || 'AMPOL')}" autocomplete="off" data-live="0"><button class="btn sm primary" data-saction="pm-add" data-n="${esc(name)}">Add</button></div>
        ${alike.length ? `<div class="pm-alike"><span>These look like the same payee:</span>${alike.map((p) => `<button class="pm-chip pm-merge" data-saction="pm-merge" data-from="${esc(p.name)}" data-n="${esc(name)}" title="Rename its ${p.n} ${p.n === 1 ? 'transaction' : 'transactions'} to ${esc(name)}">${esc(p.name)} <small>(${p.n})</small> &rarr; merge</button>`).join('')}</div>` : ''}
        <p class="fine">Adding words also renames matching transactions you already have. Future imports use them too.</p>
      </div>`;
    }
    const paint = () => {
      D = snapshot();
      let html = `<div class="seg-ctl pr-tabs" role="tablist"><button data-saction="tab" data-v="payees" aria-pressed="${tab === 'payees'}">Payees</button><button data-saction="tab" data-v="rules" aria-pressed="${tab === 'rules'}">Rules</button></div>`;
      if (tab === 'payees') {
        const pf = prefs();
        const stats = payeeStats();
        myRules().filter((r) => r.byPayee && r.payee && !stats.some((p) => p.name === r.payee)).forEach((r) => stats.push({ name: r.payee, n: 0, last: '', cats: {} }));
        const list = stats.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
        const vFix = D.tx.filter((t) => /^V\s+\S/.test(t.payee || '') && /^V\d{3,5}\b/i.test(bankText(t)));
        const vNames = new Set(vFix.map((t) => t.payee));
        if (vNames.size) html += `<div class="pr-fix"><span><b>${vNames.size} ${vNames.size === 1 ? 'payee starts' : 'payees start'} with a stray "V"</b> from the bank's card code, like "${esc([...vNames][0])}".</span><button class="btn sm primary" data-saction="fix-v">Remove the V</button></div>`;
        html += `<p class="hint">Rename a payee and every transaction with that name changes. Rename it to a name that already exists to merge the two. A chosen category fills in whenever you type that payee.</p>
          <div class="pr-top"><input id="pr-q" class="pr-search" placeholder="Search ${stats.length} payees" value="${esc(q)}" autocomplete="off" data-live="0"><button class="btn sm" data-saction="pm-new">${ICON.plus} New payee</button></div>
          ${adding ? `<div class="pm-box pm-new"><b>New payee</b><div class="pm-add"><input id="pm-name" placeholder="Name, e.g. Fuel Station" autocomplete="off" data-live="0"><input id="pm-first" placeholder="Bank description contains, e.g. AMPOL" autocomplete="off" data-live="0"><button class="btn sm primary" data-saction="pm-create">Add payee</button><button class="btn sm" data-saction="pm-cancel">Cancel</button></div><p class="fine">You can add more descriptions (BP, WOOLWORTHS PETROL…) once it's made.</p></div>` : ''}
          ${pickBar(stats)}
          <div class="pr-list">${list.map((p) => {
            const pr = pf[p.name] || {}, top = Object.entries(p.cats).sort((a, b) => b[1] - a[1])[0];
            if (editing === p.name) return `<div class="pr-row editing"><input id="pr-name" value="${esc(p.name)}" list="pr-names" autocomplete="off"><datalist id="pr-names">${payeeNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist><span class="pr-btns"><button class="btn xs primary" data-saction="rename" data-n="${esc(p.name)}">Save</button><button class="btn xs" data-saction="cancel">Cancel</button></span></div>`;
            return `<div class="pr-row${pr.hidden ? ' hid' : ''}${picked.includes(p.name) ? ' sel' : ''}">
              <div class="pr-name" data-saction="pr-sel" data-n="${esc(p.name)}" title="Click to select. Shift-click to select more."><b>${esc(p.name)}</b><small>${p.n} ${p.n === 1 ? 'transaction' : 'transactions'} · last ${esc(dateLabel(p.last))}${pr.hidden ? ' · hidden from suggestions' : ''}</small></div>
              <select class="pr-cat" data-pcat="${esc(p.name)}" aria-label="Category for ${esc(p.name)}"><option value="">${top ? 'Last used: ' + esc(catName(top[0])) : 'No default category'}</option>${catOptions(pr.cat || '', { blank: false, forTx: true }).replace(/ selected/g, '').replace(`value="${pr.cat}"`, `value="${pr.cat}" selected`)}</select>
              <span class="pr-btns">
                <button class="btn xs" data-saction="edit" data-n="${esc(p.name)}">Rename</button>
                <button class="btn xs" data-saction="hide" data-n="${esc(p.name)}" title="${pr.hidden ? 'Suggest it again when typing' : 'Stop suggesting it when typing'}">${pr.hidden ? 'Unhide' : 'Hide'}</button>
                <button class="btn xs" data-saction="show" data-n="${esc(p.name)}">View</button>
                <button class="btn xs${open === p.name ? ' on' : ''}" data-saction="pm-open" data-n="${esc(p.name)}" title="Bank descriptions that become ${esc(p.name)}">Matches${payeeRule(p.name) ? ` (${ruleTexts(payeeRule(p.name)).length})` : ''}</button>
              </span>
            </div>${open === p.name ? matchBox(p.name, stats) : ''}`;
          }).join('') || '<p class="hint">No payees match.</p>'}</div>`;
      } else {
        const rules = myRules();
        const f = form;
        const matches = f ? formMatches() : [];
        html += `<p class="hint">A rule fills in the payee, category and note for you whenever a matching transaction comes in from the bank. Your rules win over anything the app has learned.</p>`;
        const mOpts = (v) => ['contains', 'starts', 'is', 'not'].map((k) => `<option value="${k}" ${v === k ? 'selected' : ''}>${{ contains: 'contains', starts: 'starts with', is: 'is exactly', not: 'does not contain' }[k]}</option>`).join('');
        html += f ? `<div class="pr-form">
            <div class="rf-sec"><h4>Match the bank description</h4>
              ${f.texts.filter((m) => m.match !== 'not').length > 1 ? `<div class="rf-joiner">It has to contain <select id="rf-all" data-native="1"><option value="">any one of these</option><option value="all" ${f.all ? 'selected' : ''}>all of these</option></select></div>` : ''}
              ${f.texts.map((m, i) => `<div class="rf-when"><span class="rf-or">${m.match === 'not' ? (i ? 'but' : '') : i ? (f.all ? 'and' : 'or') : ''}</span><select data-rfm="${i}" data-native="1" aria-label="How it matches">${mOpts(m.match)}</select><input data-rft="${i}" value="${esc(m.text)}" placeholder="e.g. BOOST PREPAID" autocomplete="off" data-live="0" aria-label="Words from the bank description">${f.texts.length > 1 ? `<button class="icon-btn" data-saction="rf-del" data-i="${i}" aria-label="Remove this one" title="Remove">&times;</button>` : '<span></span>'}</div>`).join('')}
              <button class="linkish" data-saction="rf-add">+ Add another</button>
            </div>
            <div class="rf-sec"><h4>Only if <span class="hint">(optional)</span></h4>
              <div class="rf-conds">
                <label><span>Type</span><select id="rf-dir" data-native="1"><option value="">spending or income</option><option value="out" ${f.dir === 'out' ? 'selected' : ''}>spending</option><option value="in" ${f.dir === 'in' ? 'selected' : ''}>income</option></select></label>
                <label><span>Amount</span><span class="rf-amtbox"><select id="rf-amode" data-native="1"><option value="">any amount</option><option value="is" ${f.amode === 'is' ? 'selected' : ''}>is exactly</option><option value="range" ${f.amode === 'range' ? 'selected' : ''}>is between</option></select>
                  ${f.amode === 'is' ? `<input id="rf-a1" class="cents" inputmode="numeric" autocomplete="off" value="${esc(f.a1 || '')}" placeholder="39.00" data-live="0">` : f.amode === 'range' ? `<input id="rf-a1" class="cents" inputmode="numeric" autocomplete="off" value="${esc(f.a1 || '')}" placeholder="from" data-live="0"><input id="rf-a2" class="cents" inputmode="numeric" autocomplete="off" value="${esc(f.a2 || '')}" placeholder="to" data-live="0">` : ''}</span></label>
                <label><span>Account</span><select id="rf-acct" data-native="1"><option value="">any account</option>${Object.values(D.accounts).filter((a) => !a.closed && a.type !== 'tracking').map((a) => `<option value="${a.id}" ${f.acct === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
                <label title="The date written in the bank description, like the 23 in &ldquo;V1234 23/09 &hellip;&rdquo;. If it hasn't got one, the transaction's own date."><span>Day of the month</span><span class="rf-amtbox"><select id="rf-dmode" data-native="1"><option value="">any day</option><option value="on" ${f.dmode === 'on' ? 'selected' : ''}>is the</option></select>
                  ${f.dmode === 'on' ? `<input id="rf-days" inputmode="numeric" value="${esc(f.days || '')}" placeholder="23" data-live="0" aria-label="Day of the month, or several with commas">` : ''}</span></label>
              </div>
            </div>
            <div class="rf-sec"><h4>Fill in${f.alt ? ' <span class="hint">(taking turns, in this order)</span>' : ''}</h4>
              <div class="rf-table">${RF_HEAD}
                ${(f.alt || [f]).map((o, i) => `<div class="rf-row rf-fill">
                  <span class="rf-fixed" title="The rule keeps each transaction's own date">${f.alt ? `${['1st', '2nd', '3rd', '4th', '5th', '6th'][i] || i + 1 + 'th'} time` : 'date'}</span>
                  <input data-rfp="${i}" value="${esc(o.payee || '')}" list="rf-names" placeholder="Leave as it is" autocomplete="off" data-live="0" aria-label="Payee">
                  <select data-rfc="${i}" aria-label="Category"><option value="">Leave as it is</option>${catOptions(o.cat || '', { blank: false, forTx: true })}</select>
                  <input data-rfn="${i}" value="${esc(o.memo || '')}" placeholder="Leave as it is" autocomplete="off" data-live="0" aria-label="Note">
                  <span class="rf-fixed" title="The bank's own description stays">from the bank</span>
                  ${f.alt && f.alt.length > 2 ? `<button class="icon-btn rf-amt" data-saction="rf-alt-del" data-i="${i}" aria-label="Remove this turn" title="Remove">&times;</button>` : '<span class="rf-fixed rf-amt" title="The rule keeps each transaction\'s own amount">amount</span>'}
                </div>`).join('')}
              </div><datalist id="rf-names">${payeeNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
              ${f.alt ? `<p class="rf-turns"><button class="linkish" data-saction="rf-alt-add">+ Add another turn</button> · <button class="linkish" data-saction="rf-alt-off">Stop taking turns</button></p>
                <p class="fine">Each match gets the next line after whichever the last matching transaction got, so two on the same day split between you, and fixing one puts the next back in step.</p>`
                : '<p class="rf-turns"><button class="linkish" data-saction="rf-alt-on">Take turns between two or more fill-ins</button> <span class="hint">for things like two people\'s splurge money or phones</span></p>'}
            </div>
            <div class="rf-sec" id="rf-preview">${rfPreview(matches)}</div>
            <label class="check"><input type="checkbox" id="rf-past" ${f.past ? 'checked' : ''}> Update these ones too</label>
            <p class="fine">They get the new payee. A category or note is only added where there isn't one already.</p>
            <div class="row-btns"><button class="btn primary" data-saction="save-rule">${f.key ? 'Save rule' : 'Add rule'}</button><button class="btn" data-saction="cancel-rule">Cancel</button></div>
          </div>` : `<div class="row-btns"><button class="btn primary" data-saction="new-rule">${ICON.plus} New rule</button></div>`;
        html += rules.length ? `<h3>Your rules</h3><ul class="pr-rules">${rules.map((r) => `<li><span>${ruleSummary(r)}</span><span class="pr-btns"><button class="btn xs" data-saction="edit-rule" data-k="${esc(r.key)}">Edit</button><button class="btn xs" data-saction="del-rule" data-k="${esc(r.key)}">Delete</button></span></li>`).join('')}</ul>` : '';
        const learned = learnedRules();
        html += learned.length ? `<h3>Learned by the app <small class="hint">from transactions you've categorised</small></h3><ul class="pr-rules learned">${learned.sort((a, b) => (a[1].payee || '').localeCompare(b[1].payee || '')).map(([k, r]) => editLearned === k
          ? `<li class="pr-edit"><span class="rk">${esc(k)}</span>
              <span class="pr-edit-f"><input id="lr-payee" value="${esc(r.payee || '')}" list="lr-names" placeholder="Payee" aria-label="Payee" autocomplete="off" data-live="0"><datalist id="lr-names">${payeeNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
              <select id="lr-cat" aria-label="Category"><option value="">No category</option>${catOptions(r.cat || '', { blank: false, forTx: true })}</select><input id="lr-memo" value="${esc(r.memo || '')}" placeholder="Note (optional)" aria-label="Note" autocomplete="off" data-live="0"></span>
              <span class="pr-btns"><button class="btn xs primary" data-saction="save-learned" data-k="${esc(k)}">Save</button><button class="btn xs" data-saction="cancel-learned">Cancel</button><button class="btn xs" data-saction="to-rule" data-k="${esc(k)}" title="Make it a rule you control, matching more than this exact wording">Make it my rule</button></span></li>`
          : `<li><span><span class="rk">${esc(k)}</span> → <b>${esc(r.payee || '')}</b>${r.cat ? ` in ${esc(r.cat === INCOME ? 'Ready to Assign' : catName(r.cat))}` : ''}${r.memo ? `, note <i>${esc(r.memo)}</i>` : ''}</span><span class="pr-btns"><button class="btn xs" data-saction="edit-learned" data-k="${esc(k)}">Edit</button><button class="btn xs" data-saction="forget" data-k="${esc(k)}">Forget</button></span></li>`).join('')}</ul>` : '';
      }
      setSheetBody(html);
      if (tab === 'rules' && form) { const t = $('[data-rft="0"]'); if (t && !t.value) t.focus(); }
    };
    const readForm = () => {
      if (!form || !$('.pr-form')) return;
      document.querySelectorAll('[data-rft]').forEach((el) => { const i = Number(el.dataset.rft); form.texts[i] = { match: ($(`[data-rfm="${i}"]`) || {}).value || 'contains', text: el.value }; });
      form.all = !!($('#rf-all') && $('#rf-all').value === 'all');
      form.dir = $('#rf-dir').value; form.amode = $('#rf-amode').value; form.a1 = $('#rf-a1') ? $('#rf-a1').value : form.a1; form.a2 = $('#rf-a2') ? $('#rf-a2').value : form.a2; form.acct = $('#rf-acct').value;
      form.dmode = $('#rf-dmode').value; form.days = $('#rf-days') ? $('#rf-days').value : form.days;
      const fills = Array.from(document.querySelectorAll('[data-rfp]')).map((el) => { const i = el.dataset.rfp; return { payee: el.value, cat: ($(`[data-rfc="${i}"]`) || {}).value || '', memo: ($(`[data-rfn="${i}"]`) || {}).value || '' }; });
      if (form.alt) form.alt = fills; else if (fills[0]) { form.payee = fills[0].payee; form.cat = fills[0].cat; form.memo = fills[0].memo; }
      form.past = $('#rf-past').checked;
    };
    // the form as a rule, for matching and saving
    const formRule = () => {
      const r = { texts: form.texts.map((m) => ({ match: m.match, text: m.text.trim() })).filter((m) => m.text), all: form.all && form.texts.length > 1 ? true : null, dir: form.dir || null, acct: form.acct || null, amtIs: null, amtMin: null, amtMax: null };
      const p = (x) => { const n = E.parseMoney(String(x || '')); return x && String(x).trim() && Number.isFinite(n) ? Math.abs(n) : null; };
      if (form.amode === 'is') r.amtIs = p(form.a1);
      if (form.amode === 'range') { r.amtMin = p(form.a1); r.amtMax = p(form.a2); }
      const days = form.dmode === 'on' ? Array.from(new Set(String(form.days || '').split(/[^\d]+/).map(Number).filter((d) => d >= 1 && d <= 31))).sort((a, b) => a - b) : [];
      r.days = days.length ? days : null;
      return r;
    };
    function formMatches() { const r = formRule(); return r.texts.length ? D.tx.filter((t) => !t.transfer && ruleHits(r, bankText(t), t)).sort((a, b) => (a.date < b.date ? 1 : -1)) : []; }
    function rfPreview(list) {
      if (!form.texts.some((m) => m.text.trim())) return '<p class="hint">Type part of a bank description to see which transactions it matches.</p>';
      if (!list.length) return '<p class="hint">None of your transactions match yet. It will still work on future imports.</p>';
      const catOf = (t) => (t.cat === INCOME ? 'Ready to Assign' : t.cat ? catName(t.cat) : t.splits && t.splits.length ? 'Split' : '');
      return `<h4>Matches ${list.length} of your transactions</h4><div class="rf-table">${RF_HEAD}${list.slice(0, 8).map((t) => `<div class="rf-row">
        <span class="rf-d">${esc(dateLabel(t.date))}</span><span class="rf-p">${esc(t.payee || '')}</span><span class="rf-c${catOf(t) ? '' : ' none'}">${esc(catOf(t) || 'Uncategorized')}</span><span class="rf-n">${esc(t.memo || '')}</span><span class="rf-bank">${esc(bankText(t))}</span><b class="rf-amt ${t.amt > 0 ? 'pos' : ''}">${signed(t.amt)}</b></div>`).join('')}</div>${list.length > 8 ? `<p class="fine">and ${list.length - 8} more</p>` : ''}`;
    }
    const newForm = (o) => Object.assign({ texts: [{ match: 'contains', text: '' }], dir: '', amode: '', a1: '', a2: '', acct: '', dmode: '', days: '', payee: '', cat: '', memo: '', past: true }, o || {});
    // an existing rule, opened in the form
    const ruleToForm = (r, key) => newForm({ key, order: r.order, all: !!r.all, alt: r.alt && r.alt.length > 1 ? r.alt.map((o) => ({ payee: o.payee || '', cat: o.cat || '', memo: o.memo || '' })) : null, texts: ruleTexts(r).map((m) => ({ match: m.match, text: m.text })), dir: r.dir || '', acct: r.acct || '', amode: r.amtIs != null ? 'is' : r.amtMin != null || r.amtMax != null ? 'range' : '', a1: r.amtIs != null ? box(r.amtIs) : r.amtMin != null ? box(r.amtMin) : '', a2: r.amtMax != null ? box(r.amtMax) : '', dmode: r.days && r.days.length ? 'on' : '', days: r.days && r.days.length ? r.days.join(', ') : '', payee: r.payee || '', cat: r.cat || '', memo: r.memo || '', past: false });
    if (form && !form.texts) form = newForm({ texts: [{ match: form.match || 'contains', text: form.text || '' }], payee: form.payee || '', cat: form.cat || '', memo: form.memo || '' });
    openSheet({ title: 'Payees and rules', body: '', wide: true, refresh: () => { if (!editing && !(form && document.activeElement && document.activeElement.closest('.pr-form'))) paint(); } });
    paint();
    if (opt.payee) setTimeout(() => { const r = document.querySelector('#sheet .pr-row.sel'); if (r) r.scrollIntoView({ block: 'nearest' }); }, 30);
    sheet.onKey = (ev) => {
      if (tab !== 'payees' || !picked.length || /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return false;
      if (ev.key === 'Delete' || ev.key === 'Backspace') { if (delAsk) sheet.actions['pr-delete'](); else { delAsk = true; paint(); } return true; }
      if (ev.key === 'Escape') { picked = []; delAsk = false; paint(); return true; }
      return false;
    };
    sheet.onInput = (el) => {
      if (el.id === 'pr-q') { q = el.value; const pos = el.selectionStart; paint(); const n = $('#pr-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
      if (el.closest && el.closest('.pr-form')) { readForm(); const pv = $('#rf-preview'); if (pv) pv.innerHTML = rfPreview(formMatches()); }
    };
    sheet.onChange = async (el) => {
      if (el.dataset.pcat != null) {
        const name = el.dataset.pcat, pr = prefs()[name];
        const key = pr ? pr.key : 'p:' + S.uid();
        await guard(S.write('meta', 'rules', { items: { [key]: { kind: 'payee', name, cat: el.value || null, hidden: pr ? !!pr.hidden : false } } }));
        toast(el.value ? `${name} now fills in ${catName(el.value)}` : `${name} uses its last category`);
      }
      if (el.closest && el.closest('.pr-form')) {
        readForm();
        if (el.id === 'rf-amode') { paint(); const a = $('#rf-a1'); if (a) a.focus(); return; }
        if (el.id === 'rf-all' || el.dataset.rfm != null) { paint(); return; }
        if (el.id === 'rf-dmode') { paint(); const a = $('#rf-days'); if (a) a.focus(); return; }
        const pv = $('#rf-preview'); if (pv) pv.innerHTML = rfPreview(formMatches());
      }
    };
    sheet.actions = {
      tab: (el) => { tab = el.dataset.v; editing = null; paint(); },
      'fix-v': async () => {
        const fix = D.tx.filter((t) => /^V\s+\S/.test(t.payee || '') && /^V\d{3,5}\b/i.test(bankText(t)));
        const names = new Set(fix.map((t) => t.payee));
        await putTxs(fix.map((t) => Object.assign({}, t, { payee: t.payee.replace(/^V\s+/, '') })));
        const items = {};
        for (const [k, r] of Object.entries(D.rules)) if (r && !r.kind && /^V\s+\S/.test(r.payee || '')) items[k] = Object.assign({}, r, { payee: r.payee.replace(/^V\s+/, '') });
        if (Object.keys(items).length) await guard(S.write('meta', 'rules', { items }));
        toast(`Tidied ${names.size} ${names.size === 1 ? 'payee' : 'payees'} (${fix.length} ${fix.length === 1 ? 'transaction' : 'transactions'})`);
        paint();
      },
      'pr-sel': (el, ev) => {
        const name = el.dataset.n; delAsk = false;
        if (ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey)) { const i = picked.indexOf(name); if (i >= 0) picked.splice(i, 1); else picked.push(name); }
        else picked = picked.length === 1 && picked[0] === name ? [] : [name];
        paint();
      },
      'pr-clear': () => { picked = []; delAsk = false; paint(); },
      'pr-delask': () => { delAsk = true; paint(); },
      'pr-keep': () => { delAsk = false; paint(); },
      'pr-delete': async () => { const names = picked.slice(); picked = []; delAsk = false; if (names.includes(open)) open = null; await deletePayees(names); D = snapshot(); toast(`Deleted ${names.length === 1 ? names[0] : `${names.length} payees`}. ${MAC ? '⌘Z' : 'Ctrl+Z'} to undo.`); paint(); },
      'pr-merge': async () => {
        const into = $('#pr-into').value, from = picked.filter((x) => x !== into);
        let n = 0;
        for (const f of from) { n += (await renamePayee(f, into)).n; D = snapshot(); }
        picked = [into]; delAsk = false;
        toast(`Merged ${from.length} ${from.length === 1 ? 'payee' : 'payees'} into ${into} (${n} ${n === 1 ? 'transaction' : 'transactions'}).`);
        paint();
      },
      'pm-open': (el) => { open = open === el.dataset.n ? null : el.dataset.n; adding = false; paint(); const t = $('#pm-text'); if (t) t.focus(); },
      'pm-new': () => { adding = !adding; open = null; paint(); const n = $('#pm-name'); if (n) n.focus(); },
      'pm-cancel': () => { adding = false; paint(); },
      'pm-create': async () => {
        const name = ($('#pm-name').value || '').trim(), text = ($('#pm-first').value || '').trim();
        if (!name) { toast('Give the payee a name.'); $('#pm-name').focus(); return; }
        if (!text) { toast('Add some words from the bank description, like AMPOL.'); $('#pm-first').focus(); return; }
        const n = await linkToPayee(name, text);
        adding = false; open = name; D = snapshot();
        toast(`${name} added${n ? `, and ${n} ${n === 1 ? 'transaction' : 'transactions'} renamed` : ''}.`);
        paint(); const t = $('#pm-text'); if (t) t.focus();
      },
      'pm-add': async (el) => {
        const name = el.dataset.n, text = el.dataset.t || ($('#pm-text') ? $('#pm-text').value : '');
        if (!String(text).trim()) { toast('Type some words from the bank description.'); return; }
        const n = await linkToPayee(name, text); D = snapshot();
        toast(`${String(text).trim().toUpperCase()} now becomes ${name}${n ? `. Renamed ${n} existing ${n === 1 ? 'transaction' : 'transactions'}` : ''}.`);
        paint(); const t = $('#pm-text'); if (t) t.focus();
      },
      'pm-del': async (el) => { await unlinkFromPayee(el.dataset.n, el.dataset.t); paint(); },
      'pm-merge': async (el) => { const r = await renamePayee(el.dataset.from, el.dataset.n); D = snapshot(); toast(`Merged ${el.dataset.from} into ${el.dataset.n} (${r.n} ${r.n === 1 ? 'transaction' : 'transactions'}).`); paint(); },
      edit: (el) => { editing = el.dataset.n; paint(); const n = $('#pr-name'); if (n) { n.focus(); n.select(); } },
      cancel: () => { editing = null; paint(); },
      rename: async (el) => {
        const from = el.dataset.n, to = ($('#pr-name').value || '').trim();
        editing = null;
        if (!to || to === from) { paint(); return; }
        const r = await renamePayee(from, to);
        if (open === from) open = to;
        toast(r.merging ? `Merged ${from} into ${to} (${r.n} ${r.n === 1 ? 'transaction' : 'transactions'})` : `Renamed ${r.n} ${r.n === 1 ? 'transaction' : 'transactions'} to ${to}`);
        paint();
      },
      hide: async (el) => {
        const name = el.dataset.n, pr = prefs()[name];
        await guard(S.write('meta', 'rules', { items: { [pr ? pr.key : 'p:' + S.uid()]: { kind: 'payee', name, cat: pr ? pr.cat || null : null, hidden: !(pr && pr.hidden) } } }));
        paint();
      },
      show: (el) => { closeSheet(); UI.view = 'tx'; UI.only = null; UI.rec = null; UI.f = NO_FILTERS(); UI.q = el.dataset.n; saveUI(); render(); window.scrollTo(0, 0); },
      'new-rule': () => { editLearned = null; form = newForm(); paint(); },
      'edit-rule': (el) => { form = ruleToForm(D.rules[el.dataset.k], el.dataset.k); paint(); },
      'rf-alt-on': () => { readForm(); form.alt = [{ payee: form.payee, cat: form.cat, memo: form.memo }, { payee: '', cat: '', memo: '' }]; paint(); const n = $('[data-rfp="1"]'); if (n) n.focus(); },
      'rf-alt-off': () => { readForm(); const a = form.alt[0] || {}; form.alt = null; form.payee = a.payee || ''; form.cat = a.cat || ''; form.memo = a.memo || ''; paint(); },
      'rf-alt-add': () => { readForm(); form.alt.push({ payee: '', cat: '', memo: '' }); paint(); },
      'rf-alt-del': (el) => { readForm(); form.alt.splice(Number(el.dataset.i), 1); paint(); },
      'rf-add': () => { readForm(); form.texts.push({ match: 'contains', text: '' }); paint(); const n = $(`[data-rft="${form.texts.length - 1}"]`); if (n) n.focus(); },
      'rf-del': (el) => { readForm(); form.texts.splice(Number(el.dataset.i), 1); paint(); },
      'cancel-rule': () => { form = null; paint(); },
      'del-rule': async (el) => { await guard(S.write('meta', 'rules', { items: { [el.dataset.k]: null } })); toast('Rule deleted'); paint(); },
      'edit-learned': (el) => { editLearned = el.dataset.k; paint(); const n = $('#lr-payee'); if (n) n.focus(); },
      'cancel-learned': () => { editLearned = null; paint(); },
      'save-learned': async (el) => {
        const k = el.dataset.k, payee = ($('#lr-payee').value || '').trim(), cat = $('#lr-cat').value || null, memo = ($('#lr-memo').value || '').trim() || null;
        if (!payee && !cat) { toast('Give it a payee, a category, or both. Or use Forget to remove it.'); return; }
        editLearned = null;
        await guard(S.write('meta', 'rules', { items: { [k]: Object.assign({}, D.rules[k], { payee, cat, memo }) } }));
        toast('Saved. The next import uses it.');
        paint();
      },
      'to-rule': (el) => {
        const k = el.dataset.k, r = D.rules[k];
        editLearned = null;
        form = newForm({ texts: [{ match: 'contains', text: k.toUpperCase() }], payee: ($('#lr-payee') && $('#lr-payee').value) || r.payee || '', cat: ($('#lr-cat') && $('#lr-cat').value) || r.cat || '', memo: ($('#lr-memo') && $('#lr-memo').value) || r.memo || '', fromLearned: k });
        paint(); const t = $('[data-rft="0"]'); if (t) { t.focus(); t.select(); }
      },
      forget: async (el) => { await guard(S.write('meta', 'rules', { items: { [el.dataset.k]: null } })); paint(); },
      'save-rule': async () => {
        readForm();
        const fr = formRule();
        if (!fr.texts.some((m) => m.match !== 'not')) { toast(fr.texts.length ? 'Add at least one line that the description contains, as well as what it doesn\'t.' : 'Type some words from the bank description, like BOOST PREPAID.'); const t = $('[data-rft="0"]'); if (t) t.focus(); return; }
        const alt = form.alt ? form.alt.map((o) => ({ payee: (o.payee || '').trim() || null, cat: o.cat || null, memo: (o.memo || '').trim() || null })) : null;
        if (alt && alt.filter((o) => o.payee || o.cat).length < alt.length) { toast('Give each turn a payee or a category, so the next one can tell whose turn it is.'); return; }
        if (!alt && !form.payee.trim() && !form.cat && !(form.memo || '').trim()) { toast('Choose a payee name, a category or a note.'); return; }
        if (form.amode && fr.amtIs == null && fr.amtMin == null && fr.amtMax == null) { toast('Type the amount, or set Amount back to any amount.'); return; }
        if (form.dmode && !fr.days) { toast('Type the day of the month, like 23, or set it back to any day.'); return; }
        const key = form.key || 'r:' + S.uid();
        // text and match stay filled for anything reading the first description
        const rule = Object.assign({ kind: 'rule', match: fr.texts[0].match, text: fr.texts[0].text }, fr, alt ? { payee: null, cat: null, memo: null, alt } : { payee: form.payee.trim() || null, cat: form.cat || null, memo: (form.memo || '').trim() || null, alt: null }, { order: form.order || Date.now() });
        await guard(S.write('meta', 'rules', { items: Object.assign({ [key]: rule }, form.fromLearned ? { [form.fromLearned]: null } : {}) }));
        let n = 0;
        if (form.past && rule.alt) {
          // taking turns: oldest first; ones already given a turn stay as they are and set the next turn
          const list = D.tx.filter((t) => !t.transfer && ruleHits(rule, bankText(t), t)).sort(bankOrder), seen = [], changed = [];
          for (const t of list) {
            if (altIndex(rule.alt, t) >= 0) { seen.push(t); continue; }
            const o = altPick(rule, seen), u = Object.assign({}, t);
            if (o.payee) u.payee = o.payee;
            if (o.cat && !(t.splits && t.splits.length)) u.cat = o.cat;
            if (o.memo && !t.memo) u.memo = o.memo;
            changed.push(u); seen.push(u);
          }
          n = changed.length;
          if (n) await putTxs(changed);
        } else if (form.past) {
          const changed = D.tx.filter((t) => !t.transfer && ruleHits(rule, bankText(t), t)).map((t) => {
            const u = Object.assign({}, t);
            if (rule.payee) u.payee = rule.payee;
            if (rule.cat && !t.cat && !(t.splits && t.splits.length)) u.cat = rule.cat;
            if (rule.memo && !t.memo) u.memo = rule.memo;
            return u;
          }).filter((u) => u.payee !== D.txById[u.id].payee || u.cat !== D.txById[u.id].cat || u.memo !== D.txById[u.id].memo);
          n = changed.length;
          if (n) await putTxs(changed);
        }
        form = null;
        toast(n ? `Rule saved, and ${n} existing ${n === 1 ? 'transaction' : 'transactions'} tidied` : 'Rule saved. It applies from your next import.');
        paint();
      },
    };
  }

  // ---------- what the step-by-step guide (guide.js) can do ----------
  window.ZL = {
    data: () => { D = snapshot(); return D; },
    money, plain, esc, E, S, INCOME, START, DEBT_TYPES,
    month: () => UI.month,
    go(view) { UI.view = view; UI.only = null; UI.editTx = null; if (view === 'tx') { UI.f = NO_FILTERS(); UI.q = ''; UI.rec = null; } UI.month = E.monthOf(E.todayISO()); saveUI(); render(); window.scrollTo(0, 0); },
    render: () => render(),
    toast,
    async addAccount({ name, type, amount }) {
      const a = { id: S.uid(), name, type, closed: false, order: Object.keys(D.accounts).length + 1 };
      await putAcct(a);
      const dbt = !!DEBT_TYPES[type];
      if (dbt) await ensurePayCat(a);
      const bal = dbt ? -Math.abs(amount || 0) : amount || 0;
      if (bal) await putTxs([{ id: S.uid(), acct: a.id, date: E.todayISO(), payee: 'Starting balance', cat: type === 'tracking' ? null : dbt ? START : INCOME, amt: bal, cleared: 'c', by: myId() }]);
      D = snapshot();
      return a.id;
    },
    async removeAccount(id) {
      const txs = D.tx.filter((t) => t.acct === id);
      if (txs.length) await putTxs([], txs);
      await guard(S.write('meta', 'accounts', { items: { [id]: null } }));
      const c = Object.values(D.cats).find((k) => k.debtFor === id);
      if (c) await guard(S.write('meta', 'cats', { items: { [c.id]: null } }));
      D = snapshot();
    },
    // groups: [{name, kind, order, cats: [names]}]; reuses any group or category with the same name
    async addCategories(groups) {
      D = snapshot();
      const cats = Object.values(D.cats), items = {}, out = {};
      for (const g of groups) {
        if (!g.cats.length) continue;
        let gid = (cats.find((c) => !c.parent && c.name.toLowerCase() === g.name.toLowerCase()) || {}).id;
        if (!gid) { gid = S.uid(); items[gid] = full(CAT_KEYS, { id: gid, name: g.name, parent: null, order: g.order, hidden: false, target: null, note: '', kind: g.kind }); }
        let n = cats.filter((c) => c.parent === gid).length;
        for (const name of g.cats) {
          const have = cats.find((c) => c.parent === gid && c.name.toLowerCase() === name.toLowerCase());
          if (have) { out[name] = have.id; continue; }
          const id = S.uid();
          items[id] = full(CAT_KEYS, { id, name, parent: gid, order: ++n, hidden: false, target: null, note: '' });
          out[name] = id;
        }
      }
      if (Object.keys(items).length) await guard(S.write('meta', 'cats', { items }));
      D = snapshot();
      return out;
    },
    async setMonthly(catId, amount) {
      const c = D.cats[catId];
      if (!c) return;
      await putCat(Object.assign({}, c, { target: amount > 0 ? { type: 'monthly', amount } : null }));
    },
    async setTarget(catId, target) {
      const c = D.cats[catId];
      if (!c) return;
      await putCat(Object.assign({}, c, { target }));
    },
    async setDebtPayment(acctId, amount, isMin) {
      const a = D.accounts[acctId];
      if (!a) return;
      await putAcct(Object.assign({}, a, a.type === 'credit' ? { minPay: amount || null } : { payment: amount || null, payDay: null }));
      D = snapshot();
      const pc = D.debt[acctId];
      if (pc && amount > 0) await putCat(Object.assign({}, D.cats[pc], { target: { type: 'monthly', amount } }));
      D = snapshot();
    },
    plan: () => { D = snapshot(); return E.planAutoAssign(D.month); },
    async fundTargets() { D = snapshot(); await autoAssign(); D = snapshot(); },
    async assign(catId, amount) {
      D = snapshot();
      await putAssigned(UI.month, { [catId]: D.month.rows[catId].assigned + amount });
      D = snapshot();
    },
    async startFresh() {
      const keep = S.data.meta.settings || {};
      await replaceAll({ meta: { cats: { items: {} }, accounts: { items: {} }, rules: { items: {} }, imports: { items: {} }, settings: keep }, months: {}, tx: {} });
      D = snapshot();
    },
    backup: () => exportJSON(),
  };

  // ---------- start ----------
  S.onChange((why) => {
    if (why === 'status') { renderChrome(); return; }
    render();
  });
  renderChrome();
  render();
  S.init();
})();
