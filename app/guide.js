/* YNABB: a gentle step-by-step guide. Teaches the idea, sets up the budget, then shows how to use it.
   Written for someone who's never budgeted and doesn't like numbers: one idea per screen, tapping not typing, the app does the maths. */
(function () {
  'use strict';
  const KEY = 'zeroline-guide';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const Z = () => window.ZL;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c) => Z().money(c);
  const whole = (c) => money(c).replace(/\.00$/, ''); // $100 rather than $100.00 in the lessons
  const parse = (v) => { const n = Z().E.parseMoney(String(v || '')); return Number.isNaN(n) ? 0 : Math.abs(n); };

  // ---------- remembered progress (on this device) ----------
  let st = load();
  function load() {
    try { return Object.assign({ i: 0, seen: {}, cats: null, amts: {}, freq: {}, debt: {}, debtFreq: {}, due: {} }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return { i: 0, seen: {}, cats: null, amts: {}, freq: {}, debt: {}, debtFreq: {}, due: {} }; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* fine */ } }

  // ---------- the plan she picks from ----------
  const GROUPS = [
    { key: 'bills', name: 'Bills', kind: 'need', order: 1, freq: 'month', say: 'The ones that come every month or so.',
      items: [['Rent', 1], ['Electricity', 1], ['Gas', 0], ['Water', 0], ['Internet', 1], ['Phone', 1], ['Car insurance', 1], ['Health insurance', 0], ['Home & contents insurance', 0], ['Streaming & subscriptions', 1]] },
    { key: 'every', name: 'Everyday', kind: 'need', order: 2, freq: 'week', say: 'The things you buy all the time.',
      items: [['Groceries', 1], ['Fuel', 1], ['Kids', 0], ['Pets', 0], ['Chemist & doctor', 1], ['Household stuff', 1]] },
    { key: 'year', name: 'Big non-monthly expenses', kind: 'need', order: 3, freq: 'year', say: 'The ones that sneak up on you.',
      items: [['Car rego', 1], ['Car servicing', 1], ['Christmas', 1], ['Birthdays & gifts', 1], ['School costs', 0], ['Holidays', 0]] },
    { key: 'fun', name: 'Fun', kind: 'want', order: 4, freq: 'month', say: 'Yes, fun is allowed. It\'s part of the plan.',
      items: [['Eating out & takeaway', 1], ['Clothes', 1], ['Hobbies', 0], ['My fun money', 1], ['Partner\'s fun money', 0]] },
    { key: 'save', name: 'Savings', kind: 'save', order: 5, freq: 'month', say: 'Money for future you.',
      items: [['Emergency fund', 1], ['Saving for something special', 0]] },
  ];
  const FREQ = [['week', 'Once a week', 52 / 12], ['fortnight', 'Once a fortnight', 26 / 12], ['month', 'Once a month', 1], ['quarter', 'Every 3 months', 1 / 3], ['year', 'Once a year', 1 / 12]];
  const perMonth = (cents, f) => Math.ceil(cents * (FREQ.find((x) => x[0] === f) || FREQ[2])[2]);
  // custom: the next date it's due, and how many months until it comes round again (0 = just once).
  // a bill on "the first Monday" is near enough every month, so months are all we need
  const EVERY = [[1, 'Every month'], [2, 'Every 2 months'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Every year'], [0, 'Just once']];
  const monthsTo = (iso) => { const n = new Date(), [y, m] = iso.split('-').map(Number); return Math.max(1, (y - n.getFullYear()) * 12 + m - (n.getMonth() + 1) + 1); };
  const customPM = (cents, d) => (!d || !d.due ? cents : Math.ceil(cents / ((d.every | 0) || monthsTo(d.due))));

  const ACCT_TYPES = [
    ['checking', 'Everyday bank account', 'Everyday account', 'has'],
    ['savings', 'Savings account', 'Savings', 'has'],
    ['cash', 'Cash in my wallet', 'Cash', 'has'],
    ['credit', 'Credit card', 'Credit card', 'owe'],
    ['bnpl', 'Afterpay or Zip', 'Afterpay', 'owe'],
    ['loan', 'Car or personal loan', 'Car loan', 'owe'],
    ['mortgage', 'Home loan', 'Home loan', 'owe'],
    ['ato', 'Money owed to the ATO', 'ATO payment plan', 'owe'],
    ['tracking', 'Super or investments', 'Super', 'track'],
  ];

  function chosen() {
    if (!st.cats) {
      st.cats = {};
      const hasHomeLoan = Object.values(Z().data().accounts).some((a) => a.type === 'loan' && /home|mortgage/i.test(a.name));
      for (const g of GROUPS) st.cats[g.key] = g.items.filter(([n, on]) => on && !(n === 'Rent' && hasHomeLoan)).map(([n]) => n);
      // the things she said she'd love become savings goals
      const fromDreams = (st.dreams || []).map((k) => (DREAMS.find((x) => x[0] === k) || [])[2]).filter(Boolean);
      if (st.dreamOwn) fromDreams.push(st.dreamOwn);
      for (const n of fromDreams) if (!st.cats.save.includes(n)) st.cats.save.push(n);
    }
    return st.cats;
  }
  const catIdByName = (name) => { const c = Object.values(Z().data().cats).find((k) => k.name === name && !k.debtFor); return c ? c.id : null; };

  // ---------- small pieces ----------
  const big = (t) => `<p class="g-big">${t}</p>`;
  const p = (t) => `<p>${t}</p>`;
  const soft = (t) => `<p class="g-soft">${t}</p>`;
  const tip = (t) => `<div class="g-tip"><b>Good to know</b>${t}</div>`;
  const ok = (t) => `<div class="g-ok" role="status">${t}</div>`;
  // a handwritten sticky note, for the one line worth remembering
  const note = (t) => `<div class="g-note-wrap"><div class="g-note">${t}</div></div>`;
  // little line icons, drawn in whatever colour they sit in
  const ICONS = {
    house: 'M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5.5h4V20',
    cart: 'M3 4h2.2l2.3 10.5h10.3L20 7.5H6.2M9.5 19.5h.01M17 19.5h.01',
    cal: 'M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v5M15.5 3.5v5M8 14h2M14 14h2M8 17h2',
    umbrella: 'M3 12.5a9 9 0 0 1 18 0zM12 12.5v5.5a2 2 0 0 1-4 0M12 3.5v0',
    plus: 'M12 5v14M5 12h14',
    download: 'M12 4v11M7 10.5l5 5 5-5M5 19.5h14',
    env: 'M3.5 6.5h17v11h-17zM4 7l8 6 8-6',
    alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17v.01',
    tick: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.3l2.7 2.7L16 9.7',
    cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6.5 10v4M17.5 10v4',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
    star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  };
  const icon = (k) => `<svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k]}"/></svg>`;
  // each chapter, and each envelope, has its own soft colour
  const CH_TONE = ['sage', 'butter', 'sky', 'blush', 'lilac', 'peach'];
  const TONE = { Mortgage: 'blush', Rent: 'blush', Food: 'sage', Bills: 'butter', Fun: 'sky', Takeaway: 'peach', Holiday: 'lilac', 'Car rego': 'lilac', Christmas: 'sage', Birthdays: 'peach', Visa: 'sky', 'Car loan': 'blush', Savings: 'sage', 'Next month': 'butter' };
  const freqSel = (id, cur, custom) => `<select class="g-freq" data-freq="${esc(id)}" data-native="1" aria-label="How often">${FREQ.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}${custom ? `<option value="custom" ${cur === 'custom' ? 'selected' : ''}>Custom…</option>` : ''}</select>`;
  const amtHead = '<div class="g-amt g-amt-h" aria-hidden="true"><span></span><small>How much</small><small>How often</small></div>';

  // ---------- the steps ----------
  // ch: which chapter. when(): show this step at all. body(): what's on the card. bind(card): make it work.
  // next(): runs when moving on; return false to stay.
  const CH = ['The envelopes', 'Bigger picture', 'In YNABB', 'Your money', 'Your plan', 'Using it'];
  const S = [];
  const step = (o) => S.push(o);

  // ---------- envelope pictures: little animations do the explaining ----------
  // an envelope with a label written on it, and (optionally) what's inside underneath
  // an Aussie polymer note: its own colour, a clear window, a portrait and the number in the corner
  const note$ = (v) => `<svg class="gnote n${v}" viewBox="0 0 40 22"><rect class="nb" x=".75" y=".75" width="38.5" height="20.5" rx="2.5"/><path class="nl" d="M13 17.5q2.5-2 5 0t5 0 5 0 5 0"/><rect class="nw" x="3.5" y="4" width="6.5" height="14" rx="3.2"/><circle class="np" cx="23.5" cy="9.5" r="4.6"/><text x="36.5" y="8">${v}</text></svg>`;
  const NOTES = [50, 20, 10, 100, 5];
  let noteN = 0;
  const nextNote = () => NOTES[noteN++ % NOTES.length];
  const env = (label, amt, cls) => `<div class="ge t-${TONE[label] || 'peach'} ${label.length > 9 ? 'long' : ''} ${cls || ''}"><i class="ge-cash">${note$(NOTES[label.length % 5])}${note$(NOTES[(label.length + 2) % 5])}</i><svg viewBox="0 0 64 42"><rect class="ge-b" x="1.5" y="1.5" width="61" height="39" rx="5"/><path class="ge-f" d="M2 5.5Q2 2 5.5 2H58.5Q62 2 62 5.5L32 23.5Z"/><circle class="ge-s" cx="32" cy="22.5" r="3.4"/></svg><span class="ge-l">${label}</span>${amt != null ? `<b class="ge-a">${amt}</b>` : ''}</div>`;
  // how much cash peeks out: 'full' (two notes), 'one'. 'fill' makes them appear at --ci,
  // 'less' takes one away at --co, so the notes always match the amount written on it
  // put something at x (a % across) and y (px down) in a picture
  const at = (x, y, html, style) => `<div class="gs-at" style="--x:${x}%;--y:${y}px;${style || ''}">${html}</div>`;
  // a bank note flying from one spot to another, after a delay
  const fly = (sx, sy, ex, ey, d, t, cls, v) => `<i class="gn ${cls || ''}" style="--sx:${sx}%;--sy:${sy}px;--ex:${ex}%;--ey:${ey}px;--d:${d}s;--t:${t || 1.1}s">${note$(v || nextNote())}</i>`;
  // something that appears after a delay (and, with "out", disappears again later)
  const show = (d, html, out) => `<span class="gs-show" style="--d:${d}s${out != null ? `;--o:${out}s` : ''}"${out != null ? ' data-out' : ''}>${html}</span>`;
  const DOODLES = '<svg class="gs-sp" viewBox="0 0 20 20"><path d="M10 2v5M10 13v5M2 10h5M13 10h5"/></svg><svg class="gs-sp two" viewBox="0 0 20 20"><path d="M10 2v5M10 13v5M2 10h5M13 10h5"/></svg>';
  const pic = (h, inner, still) => `<div class="gs" style="--h:${h + 16}px" aria-hidden="true">${DOODLES}${inner}</div>` + (still ? '' : '<button class="g-replay" data-replay>↻ Play again</button>');
  const XS = [12.5, 37.5, 62.5, 87.5];

  // ---- the envelopes: every idea taught with cash and envelopes first, YNABB comes later ----
  step({ id: 'hello', ch: 0, title: 'Budgeting is simpler than you think', nextLabel: 'Show me',
    body: () => pic(110, XS.map((x, i) => at(x, 34, env(['Mortgage', 'Food', 'Bills', 'Fun'][i], null, 'full bob'))).join(''), true) +
      big('It all comes down to envelopes. Let me show you.') });

  step({ id: 'gran', ch: 0, title: 'Meet Lizzy. It\'s payday.',
    // pay cheque, to the bank, to cash. sharing it out is the next page's picture
    body: () => {
      const bank = '<svg class="gs-bank" viewBox="0 0 48 44"><path d="M4 14L24 3l20 11z"/><path d="M9 17v17M19 17v17M29 17v17M39 17v17"/><rect x="3" y="35" width="42" height="5" rx="1"/></svg>';
      return pic(110,
        at(18, 18, show(0.2, '<div class="gs-chq"><small>Pay to</small><b>Elizabeth</b><em>$1,000</em></div>') + '<b class="gs-stamp sm" style="--d:2s">Cashed</b>') +
        at(35, 36, show(1, '<i class="gs-arrow">→</i>')) +
        at(50, 16, show(1.3, bank + '<small class="gs-cap">Bank</small>')) +
        at(65, 36, show(2.4, '<i class="gs-arrow">→</i>')) +
        at(82, 14, show(2.7, '<div class="gs-cash">' + note$(20) + note$(100) + note$(50) + '<span>$1,000 cash</span></div>'))) +
        p('It\'s 1970, and Elizabeth (Lizzy to her friends) has just been handed her pay cheque. She takes it straight to the bank and cashes it.') +
        p('Then she shares out the cash into labelled envelopes, <b>one for each thing she\'ll need.</b>');
    } });

  // the money on the table counts down as each envelope gets its share.
  // envelopes with nothing for them go last, and shake to show they're empty
  const share = (fill) => {
    const got = fill.filter(([, v]) => v);
    const lands = got.map((_, i) => i * 0.9 + 1.3); // when each envelope's amount shows
    const left = [got.reduce((a, [, v]) => a + v, 0)];
    got.forEach(([, v], k) => left.push(left[k] - v));
    const zero = got.length < fill.length ? '$0' : '$0 ✓', late = lands[lands.length - 1] + 0.6;
    const counter = left.map((v, k) => show(k ? lands[k - 1] : 0, v ? '$' + v.toLocaleString() : zero, k < got.length ? lands[k] - 0.15 : null)).join('');
    return pic(178,
      at(50, 0, `<div class="gs-table"><small>On the table</small><b>${counter}</b></div>`) +
      got.map((_, i) => fly(50, 30, XS[i], 112, i * 0.9) + fly(50, 30, XS[i], 112, i * 0.9 + 0.25)).join('') +
      fill.map(([n, v], i) => at(XS[i], 104, env(n, show(v ? lands[i] : late, '$' + v), v ? 'fill' : 'shake'), v ? `--ci:${lands[i]}s` : `--sd:${late}s`)).join(''));
  };
  step({ id: 'fill', ch: 0, title: 'Lizzy gives every dollar a job',
    body: () => share([['Mortgage', 450], ['Food', 250], ['Bills', 100], ['Fun', 200]]) +
      p('When Lizzy shares out her pay, she makes sure <b>every dollar has a job</b> straight away. Mortgage, food, bills, fun. None of it is left lying around to get lost, or spent on things she didn\'t really want.') +
      '<p class="g-sub">Why it matters</p>' +
      p('Money without a job slips away so easily. $20 here, $30 there, and before you know it, it\'s gone. You can\'t be sure what you spent it on, or if it\'s what you really wanted.') });

  // zero-based budgeting as one sum, and the thing people get wrong about the $0
  step({ id: 'formula', ch: 0, title: 'It\'s really that simple!',
    body: () => `<div class="g-formula" aria-label="Money in, minus what goes in envelopes, equals zero">
        <div class="gf t-sage" style="--d:.2s"><small>Money in</small><b>$1,000</b></div><i style="--d:.9s">−</i>
        <div class="gf t-butter" style="--d:1.2s"><small>Put in envelopes</small><b>${[450, 700, 800, 1000].map((v, k) => show(1.4 + k * 0.5, '$' + v.toLocaleString(), k < 3 ? 1.85 + k * 0.5 : null)).join('')}</b></div><i style="--d:3.3s">=</i>
        <div class="gf zero" style="--d:3.6s"><b>$0</b><small>without a job</small></div></div><button class="g-replay" data-replay>↻ Play again</button>` +
      p('This is called <b>zero-based budgeting</b>.') +
      p('It doesn\'t mean your bank account should be at $0. It means <b>every dollar in your bank account is sitting in an envelope</b>, waiting to do its job.') });

  step({ id: 'notyet', ch: 0, title: 'You can only spend money you\'ve already got',
    body: () => share([['Mortgage', 450], ['Food', 250], ['Bills', 100], ['Fun', 0]]) +
      p('Lizzy can\'t fill an envelope with money she doesn\'t have yet. So she fills <b>the most important ones first</b>, then waits until her next payday.') });

  step({ id: 'know', ch: 0, title: 'Know where your money goes',
    body: () => pic(122,
      at(28, 30, env('Food', show(0, '$250', 1.2) + show(1.3, '$180'), 'full less'), '--co:1.3s') +
      fly(28, 40, 76, 48, 0.2, 1.1) +
      at(76, 16, '<div class="gs-rcpt"><b>Receipt</b><span>Groceries</span><span>Total <em>$70</em></span></div>')) +
      p('Every time Lizzy spends, it comes out of an envelope. So she always knows <b>how much is left to spend</b>, and <b>what she\'s been spending it on</b>.') +
      p('When the Food envelope is empty, Lizzy cooks with what\'s already at home. There\'s no more food money until next payday.') });

  // a little goes in each envelope every month, so each one is full when its bill comes.
  // the calendar's pages peel off one month at a time, and each month drops a note in
  const RARE = [['Car rego', '$900'], ['Christmas', '$600'], ['Birthdays', '$240']];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const peel = (i) => i * 0.32 + 0.5;
  step({ id: 'true', ch: 0, title: 'Plan for the big, irregular spending',
    body: () => pic(168,
      at(50, 0, `<div class="gs-cal"><i></i><div>${MONTHS.map((m, i) => `<b style="--d:${peel(i)}s;z-index:${12 - i}">${m}${i === 11 ? '<small>Bills due</small>' : ''}</b>`).join('')}</div></div>`) +
      MONTHS.slice(0, 11).map((_, i) => fly(50, 24, 20 + (i % 3) * 30, 98, peel(i), 0.9)).join('') +
      RARE.map(([n, v], i) => at(20 + i * 30, 96, env(n, show(peel(11) + 0.3, v + ' ✓'), 'full grow'))).join('')) +
      p('Rego, Christmas, birthdays, home maintenance. They\'re not surprises, just bills and costs that don\'t come every month.') +
      p('The trick: <b>divide the cost by the number of months until it\'s due</b>. Rego is $900 a year, so its envelope gets $75 every month. When it\'s time to pay, the money\'s right there waiting.') });

  step({ id: 'roll', ch: 0, title: 'Roll with the punches',
    body: () => pic(122,
      at(26, 30, env('Food', show(0, '$0', 1.4) + show(1.5, '$5 ✓'), 'one fill'), '--ci:1.4s') +
      fly(74, 40, 26, 40, 0.3, 1.2, 'arc', 5) +
      at(74, 30, env('Fun', show(0, '$200', 1.4) + show(1.5, '$195'), 'full less'), '--co:1.4s')) +
      p('Life happens. Lizzy is at the shops and sees a cream bun she just has to have, but her Food envelope is empty. Instead of saying no, she takes a little from her Fun envelope and enjoys the cream bun today.') +
      note('Changing the plan isn\'t failing. When every dollar has a job, you get to decide where to make the sacrifice, and fit the plan to real life.') });

  // ---- the bigger picture ----
  // the same four groups she'll pick envelopes from later (Bills, Everyday, Big non-monthly expenses, Savings)
  const KINDS = [
    ['sage', 'house', 'Bills', 'Much the same each month', 'Mortgage, electricity, phone'],
    ['butter', 'cart', 'Everyday', 'Changes week to week', 'Food, fuel, chemist'],
    ['sky', 'cal', 'Big non-monthly', 'Known or estimated, just not monthly', 'Rego, Christmas, gifts'],
    ['blush', 'umbrella', 'Surprises', 'Can\'t see them coming', 'Your emergency fund'],
  ];
  step({ id: 'kinds', ch: 1, title: 'Four kinds of envelope',
    body: () => `<div class="g-kinds">${KINDS.map(([t, ic, n, say, eg]) => `<div class="g-kind t-${t}"><span class="g-kind-ic">${icon(ic)}</span><b>${n}</b><span>${say}</span><small>${eg}</small></div>`).join('')}</div>` +
      p('Big non-monthly expenses get <b>a little every month</b>. Surprises come out of a <b>cushion you build up</b>.') +
      p('Cover all four, and very little can catch you out.') });

  step({ id: 'choose', ch: 1, title: 'Choose what matters most',
    body: () => pic(122,
      at(26, 30, env('Takeaway', show(0, '$120', 1.4) + show(1.5, '$60'), 'full less'), '--co:1.5s') +
      [0, 1].map((i) => fly(26, 40, 74, 40, 0.3 + i * 0.4, 1.2, 'arc')).join('') +
      at(74, 30, env('Holiday', show(0, '$0', 1.8) + show(1.9, '$60'), 'one fill'), '--ci:1.9s')) +
      p('Each dollar can only do one job. Spend a bit less on takeaway, and that money can go towards a holiday.') +
      p('Small trade-offs let you <b>say yes to what you love most</b>.') });

  const DREAMS = [['holiday', 'A holiday', 'Holiday'], ['calm', 'Less stress about bills', null], ['debt', 'Paying off what I owe', null], ['cushion', 'A safety cushion', 'Emergency fund'], ['treats', 'Treats without guilt', 'Treats'], ['house', 'A house deposit', 'House deposit'], ['car', 'A better car', 'New car'], ['kids', 'Things for the kids', 'Kids\' extras']];
  // paid in bits: each bit of pay goes to the next most important envelope, and fun gets what's left
  const BITS = [['1st pay', 450, [['Mortgage', 450]]], ['2nd pay', 350, [['Food', 250], ['Bills', 100]]], ['3rd pay', 120, [['Fun', 120]]]];
  step({ id: 'uneven', ch: 1, title: 'Paid in bits? Fill the essentials first',
    body: () => {
      let out = '', i = 0;
      BITS.forEach(([say, v, to], b) => {
        const d = b * 1.9, last = b === BITS.length - 1;
        out += at(50, 0, show(d, `<div class="gs-table"><small>${say}</small><b>$${v}</b></div>`, last ? null : d + 1.7));
        to.forEach(([n, a], k) => {
          const go = d + 0.4 + k * 0.3, land = go + 0.8;
          out += fly(50, 30, XS[i], 112, go, 1) + fly(50, 30, XS[i], 112, go + 0.2, 1);
          out += at(XS[i], 104, env(n, show(land, '$' + a), 'fill'), `--ci:${land}s`);
          i++;
        });
      });
      return pic(178, out) +
        p('Mortgage, food and bills come first. <b>Everything else gets what\'s left.</b>');
    } });

  step({ id: 'short', ch: 1, title: 'When there isn\'t enough to go around',
    body: () => `<ul class="g-wins"><li>Put fun and savings on hold for now.</li><li>If you\'ll need to ask for help, ask as soon as you know, so everyone can make a plan.</li><li>Try not to cover the gap with credit cards or loans.</li></ul>` +
      note('Seeing that you\'re short is scary, but it\'s far less scary than not knowing.') });

  // extra goes on the loan until it's paid off, then the same money starts filling savings
  step({ id: 'freedom', ch: 1, title: 'Work towards freedom',
    body: () => pic(160,
      at(50, 0, '<div class="gs-cash">' + note$(20) + note$(50) + note$(10) + '<span>Extra</span></div>') +
      [0, 0.5, 1].map((d) => fly(50, 24, 26, 92, d, 1)).join('') +
      at(26, 84, env('Car loan', show(0, '$300 owed', 0.75) + show(0.85, '$200 owed', 1.25) + show(1.35, '$100 owed', 1.75) + show(1.85, '$0'))) +
      at(26, 46, '<b class="gs-stamp" style="--d:2.1s">Paid off!</b>') +
      [2.6, 3.1, 3.6].map((d) => fly(50, 24, 74, 92, d, 1)).join('') +
      at(74, 84, env('Savings', show(0, '$0', 3.35) + show(3.45, '$100', 3.85) + show(3.95, '$200', 4.35) + show(4.45, '$300'), 'fill'), '--ci:3.35s')) +
      p('Always pay the minimum on each debt, then put any extra money on <b>one at a time</b>.') +
      p('Once that debt is gone, your extra money moves to the next one, then to <b>saving and investing for future you</b>.') });

  // this month on the left, next month on the right, each under its own calendar page
  const monthName = (k) => MONTHS[(new Date().getMonth() + k) % 12];
  step({ id: 'ahead', ch: 1, title: 'Get a month ahead',
    body: () => pic(176,
      [25, 75].map((x, k) => at(x, 0, `<div class="gs-cal still"><i></i><div><b>${monthName(k)}</b></div></div>`) + at(x, 72, `<small class="gs-cap">${k ? 'Next month' : 'This month'}</small>`)).join('') +
      [13, 37].map((x, i) => at(x, 96, env(['Mortgage', 'Food'][i], '✓', 'full'))).join('') +
      [63, 87].map((x, i) => fly(50, -18, x, 104, i * 0.6 + 0.3, 1)).join('') +
      [63, 87].map((x, i) => at(x, 96, env(['Mortgage', 'Food'][i], show(i * 0.6 + 1.1, '✓'), 'full fill'), `--ci:${i * 0.6 + 1.1}s`)).join('')) +
      p('After paying your debts, if you have some spare, you could even start filling envelopes for <b>next month\'s expenses</b>.') +
      p('Bit by bit you\'ll build a buffer. If money starts coming in slower, you have time to make a plan, knowing next month is covered. And the lead-up to payday <b>stops being so stressful</b>.') });

  // a surprise could go anywhere, and wherever she puts it is right
  step({ id: 'bonus', ch: 1, title: 'Your call',
    body: () => pic(160,
      at(50, 0, '<div class="gs-cash">' + note$(100) + note$(100) + note$(100) + '<span>Surprise $300</span></div>') +
      [26, 50, 74].map((x, i) => fly(50, 24, x, 92, i * 0.9 + 0.4, 1)).join('') +
      ['Car loan', 'Next month', 'Holiday'].map((n, i) => at([26, 50, 74][i], 84, env(n, show(i * 0.9 + 1.2, '$300?'), 'one fill'), `--ci:${i * 0.9 + 1.2}s`)).join('')) +
      p('Lizzy gets a surprise $300. Extra on the car loan? Next month\'s bills? The holiday?') +
      p('<b>Any of them is right.</b> It\'s her money, and she decides what matters most.') });

  // ---- in YNABB ----
  step({ id: 'cat', ch: 2, title: 'YNABB is just like the envelopes',
    body: () => pic(128,
      at(24, 8, '<small class="gs-cap">Envelope</small>') + at(75, 8, '<small class="gs-cap">In YNABB</small>') +
      [0, 1, 2].map((i) => fly(24, -20, 24, 52, i * 0.45, 1)).join('') +
      at(24, 36, env('Food', show(1.9, '$250'), 'full fill'), '--ci:1.9s') +
      at(50, 42, '<b class="gs-eq">=</b>') +
      at(75, 50, `<div class="gs-row"><span>Food</span>${show(1.9, '<b class="pill st-pos">$250</b>')}<div class="gs-bar"><i></i></div></div>`)) +
      p('Each envelope is a <b>category</b>, and the green bubble shows what\'s inside. No cash needed.') });

  step({ id: 'rta', ch: 2, title: 'Cash from your pay cheque is now Ready to Assign',
    body: () => pic(118,
      at(24, 22, show(0, '<div class="gs-cash">' + note$(20) + note$(100) + note$(50) + '</div>', 2.2) + '<small class="gs-cap">Your pay</small>') +
      [0, 1, 2].map((i) => fly(24, 30, 24, 110, 1.2 + i * 0.25, 0.9)).join('') +
      at(50, 34, '<b class="gs-eq">=</b>') +
      at(75, 30, `<div class="gs-rta"><small>Ready to Assign</small><b>${show(0, '$1,000', 2.2)}${show(2.3, '$0 ✓')}</b></div>`)) +
      p('New pay lands in <b>Ready to Assign</b>. Share it out into your envelopes until it reads <b>$0</b>.') });

  step({ id: 'recap', ch: 2, title: 'YNABB terms',
    body: () => `<div class="g-map">${[['Envelope', 'Category'], ['Cash from your pay cheque', 'Ready to Assign'], ['The amount written on the envelope', 'Target']]
      .map(([a, b]) => `<div><span>${a}</span><i>→</i><b>${b}</b></div>`).join('')}</div>` +
      p('Now let\'s set up <b>your</b> envelopes.') });

  // ---- your money ----
  const hasStuff = () => { const d = Z().data(); return Object.keys(d.accounts).length > 0 || Object.keys(d.cats).length > 0; };
  // decided once, when the guide is first opened, so adding accounts later doesn't bring this back
  step({ id: 'fresh', ch: 3, title: 'There\'s already something in here', when: () => (st.hadStuff == null ? (st.hadStuff = hasStuff()) : st.hadStuff) && !st.freshDone,
    body: () => p('This budget already has some accounts or categories in it.') +
      `<div class="g-choices col"><button class="g-choice ${st.fresh === 'keep' ? 'on' : ''}" data-fresh="keep">Keep it, and add to it</button><button class="g-choice ${st.fresh === 'clear' ? 'on' : ''}" data-fresh="clear">Start with a clean, empty budget</button></div>` +
      (st.fresh === 'clear' ? `<div class="g-hm">This removes everything in this budget, for everyone who uses it. <button class="g-link" data-act="backup">Download a copy first</button> if you might want it back.<div class="g-row"><button class="g-btn danger" data-act="clear">Yes, empty it and start fresh</button></div></div>` : ''),
    bind: (card) => {
      $$('[data-fresh]', card).forEach((b) => b.addEventListener('click', () => { st.fresh = b.dataset.fresh; save(); draw(); }));
      const bk = $('[data-act="backup"]', card); if (bk) bk.addEventListener('click', () => Z().backup());
      const cl = $('[data-act="clear"]', card);
      if (cl) cl.addEventListener('click', async () => { cl.disabled = true; cl.textContent = 'Emptying\u2026'; await Z().startFresh(); st.freshDone = true; st.cats = null; st.at = 'accts'; save(); draw(true); });
    },
    canNext: () => st.fresh === 'keep' });

  step({ id: 'accts', ch: 3, title: 'Where does your money live?',
    body: () => {
      const d = Z().data();
      const list = Object.values(d.accounts).filter((a) => !a.closed);
      const t = ACCT_TYPES.find((x) => x[0] === st.atype);
      return p('Add each bank account, and anything you owe. <b>Close enough is fine.</b>') +
        (list.length ? `<ul class="g-accts">${list.map((a) => { const b = (d.bal[a.id] || {}).balance || 0, owe = Z().DEBT_TYPES[a.type]; return `<li><span>${esc(a.name)}</span><b class="${owe ? 'owe' : ''}">${owe ? 'owe ' + money(-b) : money(b)}</b><button class="g-x" data-rm="${a.id}" aria-label="Remove ${esc(a.name)}" title="Remove">\u00D7</button></li>`; }).join('')}</ul>` : '') +
        `<div class="g-add">
          <p class="g-q">${list.length ? 'Anything else?' : 'What\'s the first one?'}</p>
          <div class="g-choices">${ACCT_TYPES.map(([k, l]) => `<button class="g-choice sm ${st.atype === k ? 'on' : ''}" data-atype="${k}">${l}</button>`).join('')}</div>
          ${t ? `<div class="g-form">
            <label>What do you call it?<input id="g-aname" value="${esc(st.aname || t[2])}" autocomplete="off"></label>
            <label>${t[3] === 'owe' ? 'How much do you owe on it?' : t[3] === 'track' ? 'Roughly how much is in it?' : 'How much is in it right now?'}<span class="g-money"><i>$</i><input id="g-aamt" class="cents" inputmode="numeric" placeholder="0.00" autocomplete="off"></span></label>
            <button class="g-btn" data-act="addacct">Add it</button>
            ${t[3] === 'track' ? soft('Kept separate. Not for spending.') : t[3] === 'owe' ? soft('We\'ll make a plan to pay it down.') : ''}
          </div>` : ''}
        </div>`;
    },
    bind: (card) => {
      $$('[data-atype]', card).forEach((b) => b.addEventListener('click', () => { st.atype = b.dataset.atype; st.aname = ''; save(); draw(); setTimeout(() => { const n = $('#g-aamt'); if (n) n.focus(); }, 30); }));
      $$('[data-rm]', card).forEach((b) => b.addEventListener('click', async () => { await Z().removeAccount(b.dataset.rm); draw(); }));
      const add = $('[data-act="addacct"]', card);
      const doAdd = async () => {
        const t = ACCT_TYPES.find((x) => x[0] === st.atype);
        const name = ($('#g-aname').value || '').trim() || t[2];
        const amt = parse($('#g-aamt').value);
        add.disabled = true;
        const type = t[0] === 'mortgage' || t[0] === 'ato' ? 'loan' : t[0];
        await Z().addAccount({ name, type, amount: amt });
        st.atype = null; st.aname = ''; save(); draw();
        Z().toast(`Added ${name}`);
      };
      if (add) add.addEventListener('click', doAdd);
      const amt = $('#g-aamt', card); if (amt) amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      const nm = $('#g-aname', card); if (nm) nm.addEventListener('input', () => { st.aname = nm.value; save(); });
    },
    canNext: () => Object.keys(Z().data().accounts).length > 0, needMsg: 'Add at least one account first. Your everyday bank account is a good start.' });

  step({ id: 'total', ch: 3, title: 'Here\'s where you\'re starting',
    body: () => {
      const d = Z().data(), accts = Object.values(d.accounts);
      const has = accts.filter((a) => a.type !== 'tracking' && !Z().DEBT_TYPES[a.type]).reduce((s, a) => s + ((d.bal[a.id] || {}).balance || 0), 0);
      const owe = accts.filter((a) => Z().DEBT_TYPES[a.type]).reduce((s, a) => s - ((d.bal[a.id] || {}).balance || 0), 0);
      return `<div class="g-stat"><span>Money you can plan with</span><b>${money(has)}</b></div>` +
        (owe > 0 ? `<div class="g-stat owe"><span>What you owe</span><b>${money(owe)}</b></div>` + p('That\'s okay. Knowing the number is the hard part, and it\'s done.') : '') +
        p('Next, let\'s set up your envelopes.');
    } });

  // ---- your plan ----
  const CAT_KINDS = [['need', 'Needs', 'The things you can\'t go without', 'sage'], ['want', 'Wants', 'Nice to have, and part of the plan', 'sky'], ['save', 'Freedom', 'Money for future you', 'lilac']];
  step({ id: 'cats', ch: 4, title: 'Which envelopes do you need?',
    body: () => {
      const c = chosen();
      const grp = (g) => `<div class="g-group"><h3>${g.name} <small>${g.say}</small></h3><div class="g-choices">${g.items.map(([n]) => `<button class="g-choice sm ${c[g.key].includes(n) ? 'on' : ''}" data-cat="${g.key}" data-n="${esc(n)}">${c[g.key].includes(n) ? '\u2713 ' : ''}${esc(n)}</button>`).join('')}${c[g.key].filter((n) => !g.items.some(([x]) => x === n)).map((n) => `<button class="g-choice sm on" data-cat="${g.key}" data-n="${esc(n)}">\u2713 ${esc(n)}</button>`).join('')}<span class="g-own"><input data-own="${g.key}" placeholder="+ add your own" aria-label="Add your own to ${g.name}"></span></div></div>`;
      return p('Every envelope is a <b>need</b>, a <b>want</b>, or <b>freedom</b>: money for future you. Tap the ones that fit your life. <b>You can change them any time.</b>') +
        CAT_KINDS.map(([k, name, say, tone]) => `<section class="g-kindset t-${tone}"><h3 class="g-kindh">${name} <small>${say}</small></h3>${GROUPS.filter((g) => g.kind === k).map(grp).join('')}</section>`).join('');
    },
    bind: (card) => {
      $$('[data-cat]', card).forEach((b) => b.addEventListener('click', () => {
        const l = chosen()[b.dataset.cat], n = b.dataset.n, i = l.indexOf(n);
        if (i >= 0) l.splice(i, 1); else l.push(n);
        save(); draw();
      }));
      $$('[data-own]', card).forEach((inp) => inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !inp.value.trim()) return;
        e.preventDefault();
        const l = chosen()[inp.dataset.own], n = inp.value.trim();
        if (!l.includes(n)) l.push(n);
        save(); draw();
        const again = $(`[data-own="${inp.dataset.own}"]`); if (again) again.focus();
      }));
    },
    next: async () => {
      // anything typed in an "add your own" box counts too
      $$('[data-own]').forEach((inp) => { const n = inp.value.trim(); if (n && !chosen()[inp.dataset.own].includes(n)) chosen()[inp.dataset.own].push(n); });
      save();
      await Z().addCategories(GROUPS.map((g) => ({ name: g.name, kind: g.kind, order: g.order, cats: chosen()[g.key] })));
    } });

  // one screen of amounts per group, so it's never a wall of boxes
  const AMT_SAY = {
    bills: ['What do your bills cost?', 'A rough guess is fine.'],
    every: ['And the everyday things?', 'A normal week or month. Guess away.'],
    year: ['The once-a-year ones', 'Roughly what each costs a year. We\'ll split it into monthly bits.'],
    fun: ['How much for fun?', 'This money is yours to enjoy, guilt-free.'],
    save: ['Saving for future you', 'Even $20 a month counts.'],
  };
  // what one row works out to each month, said underneath it
  const pmSay = (k, g) => {
    const f = st.freq[k] || g.freq, v = parse(st.amts[k]);
    if (f === 'custom') { const d = st.due[k]; return !d || !d.due ? 'Pick the date it\'s next due.' : v ? `\u2248 ${money(customPM(v, d))} a month${d.every ? '' : ' until it\'s due'}` : ''; }
    return v && f !== 'month' ? `\u2248 ${money(perMonth(v, f))} a month` : '';
  };
  for (const g of GROUPS) {
    step({ id: 'amt-' + g.key, ch: 4, title: AMT_SAY[g.key][0], when: () => chosen()[g.key].length > 0,
      body: () => {
        const rows = chosen()[g.key].map((n) => {
          const k = g.key + ':' + n, f = st.freq[k] || g.freq, v = st.amts[k] || '', d = st.due[k] || {};
          const custom = f === 'custom' ? `<div class="g-custom"><label>Next due<input type="date" data-due="${esc(k)}" value="${esc(d.due || '')}"></label><label>Then<select data-every="${esc(k)}" data-native="1">${EVERY.map(([e, l]) => `<option value="${e}" ${(d.every == null ? 1 : d.every) === e ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>` : '';
          return `<div class="g-amt"><span class="g-amt-n">${esc(n)}</span><span class="g-money"><i>$</i><input data-amt="${esc(k)}" class="cents" inputmode="numeric" placeholder="0.00" value="${esc(v)}" autocomplete="off" aria-label="${esc(n)} amount"></span>${freqSel(k, f, true)}${custom}<span class="g-pm-out" data-out="${esc(k)}">${pmSay(k, g)}</span></div>`;
        }).join('');
        return soft(AMT_SAY[g.key][1]) + `<div class="g-amts">${amtHead}${rows}</div>` + soft('Leave any blank if you don\'t know yet.');
      },
      bind: (card) => {
        const upd = (k) => { const o = $(`[data-out="${CSS.escape(k)}"]`, card); if (o) o.textContent = pmSay(k, g); };
        const due = (k) => st.due[k] || (st.due[k] = { every: 1 });
        $$('[data-amt]', card).forEach((i) => i.addEventListener('input', () => { st.amts[i.dataset.amt] = i.value; save(); upd(i.dataset.amt); }));
        // picking or leaving Custom shows or hides its date boxes
        $$('[data-freq]', card).forEach((s) => s.addEventListener('change', () => { const was = st.freq[s.dataset.freq]; st.freq[s.dataset.freq] = s.value; save(); if (was === 'custom' || s.value === 'custom') draw(); else upd(s.dataset.freq); }));
        $$('[data-due]', card).forEach((i) => i.addEventListener('change', () => { due(i.dataset.due).due = i.value; save(); upd(i.dataset.due); }));
        $$('[data-every]', card).forEach((s) => s.addEventListener('change', () => { due(s.dataset.every).every = Number(s.value); save(); upd(s.dataset.every); }));
      },
      next: async () => {
        for (const n of chosen()[g.key]) {
          const k = g.key + ':' + n, v = parse(st.amts[k]), id = catIdByName(n), f = st.freq[k] || g.freq, d = st.due[k];
          if (!id || !v) continue;
          // a custom due date becomes a "payment due on a date" target, so the money's there by then
          if (f === 'custom' && d && d.due) await Z().setTarget(id, { type: 'due', amount: v, due: d.due, every: d.every == null ? 1 : d.every });
          else await Z().setMonthly(id, f === 'custom' ? v : perMonth(v, f));
        }
      } });
  }

  const debts = () => Object.values(Z().data().accounts).filter((a) => Z().DEBT_TYPES[a.type] && !a.closed);
  step({ id: 'debts', ch: 4, title: 'Paying what you owe', when: () => debts().length > 0,
    body: () => p('How much do you pay on each? For a card, use the <b>minimum</b> on your statement.') +
      `<div class="g-amts">${amtHead}${debts().map((a) => {
        const f = st.debtFreq[a.id] || (a.type === 'bnpl' ? 'fortnight' : 'month'), v = st.debt[a.id] || '';
        const m = parse(v) ? perMonth(parse(v), f) : 0;
        return `<div class="g-amt"><span class="g-amt-n">${esc(a.name)}</span><span class="g-money"><i>$</i><input data-debt="${a.id}" class="cents" inputmode="numeric" placeholder="0.00" value="${esc(v)}" autocomplete="off" aria-label="${esc(a.name)} payment"></span>${freqSel('d:' + a.id, f)}<span class="g-pm-out" data-dout="${a.id}">${m && f !== 'month' ? `\u2248 ${money(m)} a month` : ''}</span></div>`;
      }).join('')}</div>` + soft('These envelopes always get filled first.'),
    bind: (card) => {
      const upd = (id) => { const f = st.debtFreq[id] || 'month', v = parse(st.debt[id]); const o = $(`[data-dout="${id}"]`, card); if (o) o.textContent = v && f !== 'month' ? `\u2248 ${money(perMonth(v, f))} a month` : ''; };
      $$('[data-debt]', card).forEach((i) => i.addEventListener('input', () => { st.debt[i.dataset.debt] = i.value; save(); upd(i.dataset.debt); }));
      $$('[data-freq^="d:"]', card).forEach((s) => s.addEventListener('change', () => { const id = s.dataset.freq.slice(2); st.debtFreq[id] = s.value; save(); upd(id); }));
    },
    next: async () => {
      for (const a of debts()) {
        const v = parse(st.debt[a.id]);
        if (v) await Z().setDebtPayment(a.id, perMonth(v, st.debtFreq[a.id] || (a.type === 'bnpl' ? 'fortnight' : 'month')));
      }
    } });

  step({ id: 'assign', ch: 4, title: 'Time to fill your envelopes',
    body: () => {
      const d = Z().data(), m = d.month, plan = Z().plan();
      if (st.assigned) {
        const left = m.rta, still = m.underTotal;
        const ef = catIdByName('Emergency fund');
        return ok('Done! Your envelopes are filled.') +
          (still > 0 ? p(`You\'re <b>${money(still)}</b> short for now, which is really common. The important envelopes were filled first, and the rest can wait for payday.`) : '') +
          (left > 0 ? p(`<b>${money(left)}</b> is still on the table. Lovely!`) + `<div class="g-choices col">${ef ? `<button class="g-choice" data-act="toef">Put it in my Emergency fund</button>` : ''}<button class="g-choice" data-act="keep">Leave it for now. I\'ll decide later.</button></div>` : '') +
          (left === 0 && still === 0 ? p('Every envelope is full. Great place to be.') : '');
      }
      return `<div class="g-stat"><span>On the table</span><b>${money(m.rta)}</b></div>` +
        p(`Your envelopes need <b>${money(m.underTotal)}</b> this month. Tap below and YNABB fills them for you, most important first.`) +
        `<div class="g-row"><button class="g-btn big" data-act="fund" ${plan && Object.keys(plan.changes).length ? '' : 'disabled'}>Fill my envelopes</button></div>` +
        (m.rta <= 0 ? soft('There\'s nothing on the table right now. Come back to this step on payday.') : '');
    },
    bind: (card) => {
      const f = $('[data-act="fund"]', card);
      if (f) f.addEventListener('click', async () => { f.disabled = true; await Z().fundTargets(); st.assigned = true; save(); draw(); });
      const ef = $('[data-act="toef"]', card);
      if (ef) ef.addEventListener('click', async () => { const id = catIdByName('Emergency fund'); await Z().assign(id, Z().data().month.rta); Z().toast('Added to your Emergency fund'); draw(); });
      const k = $('[data-act="keep"]', card); if (k) k.addEventListener('click', () => go(1));
    } });

  step({ id: 'planned', ic: 'star', ch: 4, title: 'Your envelopes are ready',
    body: () => big('That was the hardest part, and it\'s done.') +
      p('Your budget is set up. You can see it any time on the <b>Budget</b> page.') +
      p('Last up: what to do each week. It\'s quick, promise.') +
      `<div class="g-row"><button class="g-link" data-act="peek">Have a look at my budget first</button></div>`,
    bind: (card) => { const b = $('[data-act="peek"]', card); if (b) b.addEventListener('click', () => showMe('budget', '.bud', 'This is your budget. Each line is an envelope.')); } });

  // ---- using it ----
  step({ id: 'u-spend', ic: 'plus', ch: 5, title: 'Keep YNABB up to date',
    body: () => p('Bring in your spending from the bank, or tap <b>Add</b>. YNABB takes it out of the right envelope.') +
      `<div class="g-row"><button class="g-btn ghost" data-show="add">Show me Add</button></div>`,
    show: { add: ['tx', '[data-action="add-tx"]', 'Tap Add to put in something you\'ve bought.'] } });

  step({ id: 'import', ic: 'download', ch: 5, title: 'Bringing in from your bank',
    body: () => `<ol class="g-steps"><li>In your bank, find <b>Export</b> or <b>Download transactions</b>.</li><li>Choose <b>CSV</b> or <b>QIF</b>.</li><li>In YNABB, tap <b>Import &amp; reconcile</b> on the Transactions page.</li></ol>` +
      soft('YNABB skips anything it already has.') +
      `<div class="g-row"><button class="g-btn ghost" data-show="imp">Show me where</button></div>`,
    show: { imp: ['tx', '[data-action="rec-flow"]', 'Import & reconcile is here.'] } });

  step({ id: 'review', ic: 'env', ch: 5, title: 'Pop each one in its envelope',
    body: () => p('New spending waits for you. Tap it and choose its envelope.') +
      soft('YNABB learns as you go, so Woolies soon lands in Groceries on its own.') });

  step({ id: 'red', ic: 'alert', ch: 5, title: 'Red means an envelope\'s empty',
    body: () => p('Tap the red amount and move money across from another envelope, just like before.') +
      `<div class="g-row"><button class="g-btn ghost" data-show="avail">Show me where</button></div>`,
    show: { avail: ['budget', '.bud-head span:last-child', 'This column is what\'s in each envelope. Tap an amount to move money.'] } });

  step({ id: 'match', ic: 'tick', ch: 5, title: 'Check it matches your bank',
    body: () => p('Every week or two, tap <b>Import &amp; reconcile</b>. Bring in your bank file and YNABB checks it matches, or just type your bank balance.') +
      `<div class="g-row"><button class="g-btn ghost" data-show="rec">Show me where</button></div>`,
    show: { rec: ['tx', '[data-action="rec-flow"]', 'Import & reconcile is here.'] } });

  step({ id: 'payday', ic: 'cash', ch: 5, title: 'On payday, fill your envelopes',
    body: () => p('Your pay waits in <b>Ready to Assign</b> at the top of the Budget page. Tap <b>Fund targets</b> and YNABB fills your envelopes for you.') +
      `<div class="g-row"><button class="g-btn ghost" data-show="rta">Show me where</button></div>`,
    show: { rta: ['budget', '.rta, .rta-banner, [class*="rta"]', 'Ready to Assign: money waiting for an envelope.'] } });

  step({ id: 'forward', ic: 'arrow', ch: 5, title: 'Got spare? Start on next month',
    body: () => p('Use the arrow at the top to go to <b>next month</b>, then tap <b>Fund targets</b>.') +
      `<div class="g-row"><button class="g-btn ghost" data-show="fwd">Show me where</button></div>`,
    show: { fwd: ['budget', '[data-action="next-month"]', 'This arrow goes to next month.'] } });

  step({ id: 'routine', ic: 'clock', ch: 5, title: 'Twice a week, about 10 minutes', nextLabel: 'Finish',
    body: () => `<ol class="g-check"><li><b>Bring in</b> your spending</li><li><b>Pop each one</b> in its envelope</li><li><b>Fix any red</b> by moving money</li><li><b>Payday:</b> fill your envelopes</li></ol>` +
      dreamsLine() + note('You\'ve got this ♡') + soft('You can come back to this guide any time from the Guide button.') });

  function dreamsLine() {
    const names = (st.dreams || []).map((k) => (DREAMS.find((x) => x[0] === k) || [])[1]).filter(Boolean);
    if (st.dreamOwn) names.push(st.dreamOwn);
    return names.length ? `<div class="g-tip"><b>You\'re on your way to</b>${names.map(esc).join(' \u00B7 ')}</div>` : '';
  }

  // ---------- drawing ----------
  let root = null;
  const visible = () => S.filter((s) => !s.when || s.when());
  // the place is kept by the step's name, so steps appearing or disappearing never move you
  function cur() {
    const v = visible();
    let s = v.find((x) => x.id === st.at);
    if (!s) { const all = S.findIndex((x) => x.id === st.at); s = all >= 0 ? (S.slice(all).find((x) => v.includes(x)) || v[v.length - 1]) : v[0]; }
    st.at = s.id;
    return s;
  }
  function go(d) {
    const v = visible(), at = v.indexOf(cur());
    st.at = v[Math.max(0, Math.min(v.length - 1, at + d))].id;
    save(); draw(true);
  }
  function jumpTo(ch) {
    const s = visible().find((x) => x.ch === ch);
    if (s) { st.at = s.id; save(); draw(true); }
  }
  function draw(top) {
    if (!root) return;
    const v = visible(), s = cur(), at = v.indexOf(s);
    const chs = CH.map((n, i) => {
      const steps = v.filter((x) => x.ch === i);
      const done = steps.length && v.indexOf(steps[steps.length - 1]) < at;
      return `<button class="g-ch t-${CH_TONE[i]} ${s.ch === i ? 'on' : ''} ${done ? 'done' : ''}" data-ch="${i}" title="${n}"><i>${done ? '\u2713' : i + 1}</i>${n}</button>`;
    }).join('');
    const inCh = v.filter((x) => x.ch === s.ch), pos = inCh.indexOf(s);
    root.className = 'ch-' + CH_TONE[s.ch];
    root.innerHTML = `<div class="g-top">
        <div class="g-brand">YNABB guide</div>
        <nav class="g-chs" aria-label="Chapters">${chs}</nav>
        <button class="g-close" data-act="close" title="Close. Your place is saved." aria-label="Close the guide">Close</button>
      </div>
      <div class="g-wrap"><article class="g-card" aria-live="polite">
        <div class="g-head">
          ${at > 0 ? '<button class="g-back" data-act="back">← Back</button>' : ''}
          <div class="g-dots" aria-hidden="true">${inCh.map((x, i) => `<i class="${i < pos ? 'done' : i === pos ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        ${s.ic ? `<span class="g-badge">${icon(s.ic)}</span>` : ''}<div class="g-kick">${CH[s.ch]}</div>
        <h2><span class="g-hl">${s.title}</span></h2>
        <div class="g-body">${s.body()}</div>
        <div class="g-need" hidden></div>
        <div class="g-foot">
          <button class="g-btn big" data-act="next">${s.nextLabel || 'Next'}</button>
        </div>
      </article></div>`;
    const card = $('.g-card', root);
    // when a step opens with a picture, eyes land on the picture first, so the title goes under it
    const first = $('.g-body', card).firstElementChild;
    if (first && first.matches('.gs, .g-formula, .g-kinds')) {
      const after = first.nextElementSibling && first.nextElementSibling.matches('.g-replay') ? first.nextElementSibling : first;
      const h = $('h2', card); h.classList.add('below'); after.after(h);
    }
    if (s.bind) s.bind(card);
    // replay a picture by swapping in a fresh copy, which restarts its animations
    $$('[data-replay]', card).forEach((b) => b.addEventListener('click', () => { const g = b.previousElementSibling; g.replaceWith(g.cloneNode(true)); }));
    $$('[data-show]', card).forEach((b) => b.addEventListener('click', () => { const [view, sel, text] = s.show[b.dataset.show]; showMe(view, sel, text); }));
    const chOn = $('.g-ch.on', root), chs2 = $('.g-chs', root); // keep this chapter in view when the names scroll sideways
    if (chOn && chs2.scrollWidth > chs2.clientWidth) chs2.scrollLeft = chOn.offsetLeft - chs2.offsetLeft - (chs2.clientWidth - chOn.offsetWidth) / 2;
    $$('[data-ch]', root).forEach((b) => b.addEventListener('click', () => jumpTo(Number(b.dataset.ch))));
    $('[data-act="close"]', root).addEventListener('click', close);
    const back = $('[data-act="back"]', root); if (back) back.addEventListener('click', () => go(-1));
    $('[data-act="next"]', root).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (s.canNext && !s.canNext()) { const n = $('.g-need', root); n.textContent = s.needMsg || 'Choose one to carry on.'; n.hidden = false; return; }
      if (s.next) { btn.disabled = true; btn.textContent = 'Saving\u2026'; try { if (await s.next() === false) { btn.disabled = false; return; } } catch (err) { btn.disabled = false; btn.textContent = s.nextLabel || 'Next'; Z().toast('Something didn\'t save. Try again.'); return; } }
      st.seen[s.id] = 1;
      if (at === v.length - 1) { st.finished = true; st.at = null; st.hadStuff = null; save(); close(); Z().go('budget'); Z().toast('All set up. Nice work!'); return; }
      go(1);
    });
    if (top) { root.scrollTop = 0; const h = $('h2', root); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  }

  function open() {
    clearSpot();
    if (!root) {
      root = document.createElement('div');
      root.id = 'zl-guide';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'YNABB guide');
      document.body.appendChild(root);
    }
    root.hidden = false;
    document.documentElement.classList.add('noscroll');
    draw(true);
  }
  function close() {
    if (root) root.hidden = true;
    document.documentElement.classList.remove('noscroll');
    Z().render();
  }

  // ---------- "show me": point at the real thing ----------
  let spot = null;
  function clearSpot() {
    if (!spot) return;
    spot.el && spot.el.classList.remove('zl-spot');
    spot.bar.remove();
    spot = null;
  }
  function showMe(view, sel, text) {
    close();
    Z().go(view);
    setTimeout(() => {
      clearSpot();
      const el = sel.split(',').map((x) => $(x.trim())).find(Boolean);
      const bar = document.createElement('div');
      bar.className = 'zl-spotbar';
      bar.innerHTML = `<span>${esc(text)}</span><button class="g-btn" data-act="back">Back to the guide</button>`;
      document.body.appendChild(bar);
      spot = { el, bar };
      if (el) { el.classList.add('zl-spot'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      bar.querySelector('button').addEventListener('click', open);
    }, 120);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root && !root.hidden) { e.stopPropagation(); close(); }
  }, true);

  window.ZLGuide = { open, close };

  // ---------- looks ----------
  const css = document.createElement('style');
  css.textContent = `
/* soft pastel tones, one per chapter and envelope; each pairs a fill (--t) with a readable ink (--ti) */
#zl-guide { --g-sage: #DDE8D3; --g-sage-i: #46633A; --g-butter: #F7E6B4; --g-butter-i: #7E5B0E; --g-sky: #D7E6F1; --g-sky-i: #2C5878;
  --g-blush: #F5D9D2; --g-blush-i: #94402F; --g-lilac: #E6DDF0; --g-lilac-i: #5E4782; --g-peach: #F8DFC7; --g-peach-i: #8F4E1C;
  --g-dot: rgba(23, 59, 72, .09); --hand: "Caveat", "Bradley Hand", cursive; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) #zl-guide { --g-sage: #2A3824; --g-sage-i: #B7D59C; --g-butter: #3B3119; --g-butter-i: #EFCF77;
  --g-sky: #1F3141; --g-sky-i: #9FC6E6; --g-blush: #3E2521; --g-blush-i: #F1A999; --g-lilac: #2E2840; --g-lilac-i: #C7B6E6; --g-peach: #3F2C1C; --g-peach-i: #F2B57F; --g-dot: rgba(241, 238, 232, .06); } }
:root[data-theme="dark"] #zl-guide { --g-sage: #2A3824; --g-sage-i: #B7D59C; --g-butter: #3B3119; --g-butter-i: #EFCF77;
  --g-sky: #1F3141; --g-sky-i: #9FC6E6; --g-blush: #3E2521; --g-blush-i: #F1A999; --g-lilac: #2E2840; --g-lilac-i: #C7B6E6; --g-peach: #3F2C1C; --g-peach-i: #F2B57F; --g-dot: rgba(241, 238, 232, .06); }
.t-sage, .ch-sage { --t: var(--g-sage); --ti: var(--g-sage-i); }
.t-butter, .ch-butter { --t: var(--g-butter); --ti: var(--g-butter-i); }
.t-sky, .ch-sky { --t: var(--g-sky); --ti: var(--g-sky-i); }
.t-blush, .ch-blush { --t: var(--g-blush); --ti: var(--g-blush-i); }
.t-lilac, .ch-lilac { --t: var(--g-lilac); --ti: var(--g-lilac-i); }
.t-peach, .ch-peach { --t: var(--g-peach); --ti: var(--g-peach-i); }
/* the chapter's own colour, kept apart from the envelopes' --t inside it */
#zl-guide[class] { --c: var(--t); --ci: var(--ti); }
#zl-guide { position: fixed; inset: 0; z-index: 150; background: var(--bg) radial-gradient(var(--g-dot) 1.2px, transparent 1.6px) 0 0 / 20px 20px; overflow-y: auto; color: var(--ink); font-size: 16.5px; line-height: 1.55; }
#zl-guide[hidden] { display: none; }
.g-top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: calc(10px + env(safe-area-inset-top, 0px)) 18px 10px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); }
.g-brand { font: 700 15px var(--display); }
.g-chs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; justify-content: center; }
.g-ch { display: inline-flex; align-items: center; gap: 7px; border: 0; background: none; font: 600 13px var(--ui); color: var(--muted); padding: 4px 12px 4px 4px; border-radius: 99px; cursor: pointer; }
.g-ch i { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--t); color: var(--ti); font: 700 12px var(--ui); font-style: normal; }
.g-ch:hover { color: var(--ink); }
.g-ch.on { background: var(--t); color: var(--ti); }
.g-ch.on i { background: var(--ti); color: var(--t); }
.g-ch.done { color: var(--ink); }
/* narrower screens: just the numbered badges, with this chapter's name written out */
@media (max-width: 1000px) { .g-ch:not(.on) { font-size: 0; gap: 0; padding: 4px; } }
.g-close { border: 1px solid var(--line); background: var(--surface); border-radius: 99px; padding: 5px 14px; font: 600 13px var(--ui); color: var(--ink); cursor: pointer; }
.g-wrap { padding: 28px 16px calc(40px + env(safe-area-inset-bottom, 0px)); }
.g-card { max-width: 680px; margin: 0 auto; background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 26px 30px 22px; box-shadow: 0 1px 0 var(--line), 0 14px 40px rgba(23, 59, 72, .09); }
.g-kick { margin-top: 14px; font: 700 12px var(--ui); text-transform: uppercase; letter-spacing: .12em; color: var(--ci); }
.g-card h2 { font: 700 27px/1.25 var(--display); letter-spacing: -.01em; margin: 4px 0 16px; outline: none; }
/* a highlighter swipe behind the title, in the chapter's colour */
.g-hl { background: linear-gradient(100deg, transparent 0 1%, var(--c) 2% 97%, transparent 99%) 0 88% / 100% 46% no-repeat; padding: 0 6px; margin: 0 -6px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.g-card h2.below { margin: 6px 0 10px; }
.g-kick + .g-body { margin-top: 10px; }
.g-dots { display: flex; gap: 6px; }
.g-dots i { width: 22px; height: 5px; border-radius: 3px; background: var(--line); }
.g-dots i.done { background: color-mix(in srgb, var(--ci) 40%, var(--line)); }
.g-dots i.on { background: var(--ci); }
.g-body p { margin: 0 0 12px; }
.g-big { font: 600 19px/1.4 var(--display); }
.g-soft { color: var(--muted); font-size: 15px; }
.g-tip { background: var(--accent-soft); border-radius: 12px; padding: 12px 14px; margin: 12px 0; font-size: 15px; }
.g-tip b { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--accent); margin-bottom: 2px; }
.g-ok { background: var(--good-soft); color: var(--ink); border-radius: 12px; padding: 12px 14px; margin: 12px 0; border-left: 4px solid var(--good); }
.g-hm { background: var(--warn-soft); border-radius: 12px; padding: 12px 14px; margin: 12px 0; border-left: 4px solid var(--need); }
.g-choices { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; align-items: center; }
.g-choices.col { flex-direction: column; align-items: stretch; }
.g-choice { border: 1.5px solid var(--line); background: var(--surface); border-radius: 12px; padding: 10px 16px; font: 600 15px var(--ui); color: var(--ink); cursor: pointer; text-align: left; }
.g-choice small { font-weight: 400; color: var(--muted); margin-left: 4px; }
.g-choice.sm { padding: 7px 12px; font-size: 14px; border-radius: 99px; }
.g-choice:hover { border-color: var(--ci); }
.g-choice.on { border-color: var(--ci); background: color-mix(in srgb, var(--c) 60%, var(--surface)); }
.g-btn { border: 0; background: var(--accent); color: var(--accent-ink); border-radius: 12px; padding: 10px 18px; font: 700 15px var(--ui); cursor: pointer; }
.g-btn.big { padding: 12px 26px; font-size: 16px; }
.g-btn.ghost { background: var(--surface); color: var(--accent); border: 1.5px solid var(--accent); }
.g-btn.danger { background: var(--bad); color: var(--on-bad); }
.g-btn:disabled { opacity: .5; cursor: default; }
.g-link { border: 0; background: none; color: var(--accent); font: 600 15px var(--ui); text-decoration: underline; cursor: pointer; padding: 0; }
.g-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
.g-foot { clear: both; display: flex; justify-content: flex-end; align-items: center; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line); }
.g-head { display: flex; align-items: center; gap: 14px; min-height: 24px; }
.g-back { border: 0; background: none; font: 600 14px var(--ui); color: var(--muted); cursor: pointer; padding: 2px 0; }
.g-back:hover { color: var(--ink); }
.g-need { background: var(--warn-soft); border-radius: 10px; padding: 8px 12px; margin-top: 12px; font-size: 15px; }
/* numbered steps and checklists: a coloured badge, then the words */
.g-steps, .g-check { list-style: none; padding: 0; margin: 6px 0 14px; display: grid; gap: 8px; counter-reset: g; }
.g-steps li, .g-check li { counter-increment: g; position: relative; padding: 12px 14px 12px 54px; background: color-mix(in srgb, var(--c) 45%, var(--surface)); border-radius: 12px; }
.g-steps li::before, .g-check li::before { content: counter(g); position: absolute; left: 12px; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--ci); color: var(--surface); font: 700 14px var(--display); }
.g-check li::before { content: '\u2713'; }
.g-sub { margin: 16px 0 6px !important; font: 700 12px var(--ui); text-transform: uppercase; letter-spacing: .12em; color: var(--ci); }
.g-cards { display: grid; gap: 6px; margin: 6px 0 16px; }
.g-choice.meh { border-color: var(--need); background: var(--warn-soft); }
.g-map { display: grid; gap: 6px; margin: 6px 0 16px; }
.g-map div { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; background: color-mix(in srgb, var(--c) 40%, var(--surface)); border-radius: 12px; padding: 10px 14px; }
.g-map i { font-style: normal; color: var(--ci); font-weight: 700; }
.g-map b { justify-self: start; background: var(--surface); color: var(--ci); border-radius: 99px; padding: 2px 12px; }
.g-wins { list-style: none; padding: 0; margin: 8px 0 14px; display: grid; gap: 6px; }
.g-wins li { padding: 9px 14px 9px 36px; background: var(--good-soft); border-radius: 10px; position: relative; }
.g-wins li::before { content: '\u2713'; position: absolute; left: 14px; color: var(--good); font-weight: 700; }
.g-cards > div { display: flex; gap: 12px; align-items: center; background: var(--surface-2); border-radius: 12px; padding: 9px 14px; font-weight: 600; }
.g-stat { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; background: var(--good-soft); border-radius: 12px; padding: 14px 16px; margin: 8px 0; }
.g-stat b { font: 700 26px var(--display); }
.g-stat.owe { background: var(--goal-soft); }
.g-stat.owe b { color: var(--goal); }
.g-accts { list-style: none; padding: 0; margin: 4px 0 14px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.g-accts li { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-top: 1px solid var(--line); }
.g-accts li:first-child { border-top: 0; }
.g-accts li span { flex: 1; font-weight: 600; }
.g-accts li b.owe { color: var(--goal); }
.g-x { border: 0; background: none; color: var(--muted); font-size: 20px; cursor: pointer; width: 30px; height: 30px; border-radius: 50%; }
.g-x:hover { background: var(--surface-2); }
.g-add { background: var(--surface-2); border-radius: 14px; padding: 12px 14px; }
.g-q { font-weight: 700; margin: 0 0 4px !important; }
.g-form { display: grid; gap: 10px; margin-top: 6px; }
.g-form label { display: grid; gap: 4px; font-weight: 600; font-size: 15px; }
.g-form input, .g-money input { font: 16px var(--ui); padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); width: 100%; box-sizing: border-box; }
.g-form input:focus, .g-money input:focus { border-color: var(--accent); outline: none; }
.g-form .g-btn { justify-self: start; }
.g-money { position: relative; display: block; }
.g-money i { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); font-style: normal; color: var(--muted); }
.g-money input { padding-left: 24px; }
.g-group { margin: 14px 0 6px; }
.g-group h3 { font-size: 16px; margin: 0 0 2px; }
.g-group h3 small { font-weight: 400; color: var(--muted); font-size: 14px; margin-left: 6px; }
.g-own input { border: 1.5px dashed var(--line); border-radius: 99px; padding: 7px 12px; font: 14px var(--ui); background: none; color: var(--ink); width: 150px; }
.g-own input:focus { border-color: var(--accent); outline: none; border-style: solid; }
.g-amts { display: grid; gap: 8px; margin: 10px 0; }
.g-amt { display: grid; grid-template-columns: minmax(0, 1.3fr) 120px 150px; gap: 8px; align-items: center; }
.g-amt-n { font-weight: 600; }
.g-amt .g-pm-out { grid-column: 2 / -1; font-size: 13px; color: var(--muted); margin-top: -4px; }
.g-amt .g-pm-out:empty { display: none; }
.g-amt-h small { font: 700 11px var(--ui); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.g-amts .g-amt-h { margin-bottom: -4px; }
.g-custom { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 8px 12px; }
.g-custom label { display: grid; gap: 3px; font: 600 12px var(--ui); color: var(--muted); }
.g-custom input, .g-custom select { font: 15px var(--ui); padding: 8px 10px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); }
.g-kindset { margin: 18px 0 8px; padding: 4px 16px 10px; border-radius: 16px; background: color-mix(in srgb, var(--t) 45%, var(--surface)); }
.g-kindh { margin: 10px 0 0; font: 700 21px var(--display); color: var(--ti); text-transform: none; letter-spacing: 0; }
.g-kindh small { font: 400 14px var(--ui); color: var(--muted); margin-left: 6px; text-transform: none; letter-spacing: 0; }
.g-freq { font: 15px var(--ui); padding: 9px 10px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); }
/* envelope pictures */
.gs { position: relative; height: var(--h); background: color-mix(in srgb, var(--c) 55%, var(--surface)) radial-gradient(var(--g-dot) 1.2px, transparent 1.6px) 0 0 / 16px 16px; border-radius: 16px; overflow: hidden; margin: 4px 0 2px; }
.gs-at { position: absolute; left: var(--x); top: calc(var(--y) + 16px); transform: translateX(-50%); white-space: nowrap; text-align: center; }
.ge { position: relative; width: 68px; display: inline-block; text-align: center; }
.ge svg { display: block; width: 68px; height: 45px; }
.ge svg { position: relative; z-index: 1; filter: drop-shadow(0 3px 3px rgba(23, 59, 72, .12)); }
.ge-b { fill: var(--t); stroke: color-mix(in srgb, var(--ti) 55%, transparent); stroke-width: 1.5; }
.ge-f { fill: color-mix(in srgb, var(--ti) 18%, var(--t)); stroke: color-mix(in srgb, var(--ti) 55%, transparent); stroke-width: 1.5; stroke-linejoin: round; }
.ge-s { fill: color-mix(in srgb, var(--ti) 80%, transparent); }
.ge.t-blush { rotate: -3deg; } .ge.t-butter { rotate: 2deg; } .ge.t-sky { rotate: -1.5deg; } .ge.t-lilac { rotate: 2.5deg; }
/* cash peeking out of a full envelope (a few notes, stacked) */
.ge-cash { display: none; position: absolute; z-index: 0; left: 12px; right: 12px; top: -10px; height: 22px; }
.ge-cash .gnote { position: absolute; width: 36px; height: 20px; }
.ge-cash .gnote:first-child { left: 0; top: 2px; transform: rotate(-8deg); }
.ge-cash .gnote:last-child { right: 0; top: 0; transform: rotate(6deg); }
.ge.full .ge-cash { display: block; }
.ge.grow .ge-cash { animation: ge-grow 3.4s ease-out .6s both; }
/* note colours, like the real ones */
.gnote { display: block; overflow: visible; }
.gnote .nb { fill: var(--nf); stroke: var(--nd); stroke-width: 1; }
.gnote .nw { fill: rgba(255, 255, 255, .6); stroke: color-mix(in srgb, var(--nd) 50%, transparent); stroke-width: .8; }
.gnote .np { fill: color-mix(in srgb, var(--nd) 30%, transparent); }
.gnote .nl { fill: none; stroke: color-mix(in srgb, var(--nd) 45%, transparent); stroke-width: .9; }
.gnote text { font: 800 6.5px var(--ui); fill: var(--nd); text-anchor: end; }
.n5 { --nf: #F0B9D6; --nd: #9A3E73; } .n10 { --nf: #A9CBEE; --nd: #2D5C94; } .n20 { --nf: #F2AE8C; --nd: #A84724; }
.n50 { --nf: #F4D978; --nd: #8C6810; } .n100 { --nf: #9FD3AF; --nd: #2B7046; }
@keyframes ge-grow { from { transform: translateY(14px) rotate(-4deg); } to { transform: translateY(-4px) rotate(-4deg); } }
.ge.bob { animation: ge-bob 3.2s ease-in-out infinite; }
.gs-at:nth-of-type(2n) .ge.bob { animation-delay: -1.1s; }
.gs-at:nth-of-type(3n) .ge.bob { animation-delay: -2.2s; }
@keyframes ge-bob { 50% { transform: translateY(-6px); } }
.ge.shake { animation: ge-shake .45s ease-in-out var(--sd, 0s) 3; }
@keyframes ge-shake { 25% { transform: translateX(-5px) rotate(-4deg); } 75% { transform: translateX(5px) rotate(4deg); } }
.ge-l { position: absolute; z-index: 2; left: 0; right: 0; top: 25px; font: 700 15px/1 var(--hand); color: var(--ti); overflow: hidden; text-overflow: ellipsis; padding: 0 4px; }
.ge-a { display: grid; justify-items: center; margin-top: 3px; min-height: 20px; font: 700 15px var(--display); color: var(--ink); }
.ge-a > * { grid-area: 1 / 1; }
.ge.long .ge-l { font-size: 13px; }
.ge.mini { width: 34px; flex: none; }
.ge.mini svg { width: 34px; height: 23px; }
.neg { color: var(--bad); }
.gn { position: absolute; z-index: 3; left: var(--sx); top: calc(var(--sy) + 16px); width: 36px; height: 20px; margin-left: -18px; filter: drop-shadow(0 2px 2px rgba(23, 59, 72, .18)); text-align: center; font-style: normal; opacity: 0; animation: gs-fly var(--t) ease-in-out var(--d) both; }
.gn.arc { animation-name: gs-arc; }
/* notes flutter as they fly */
@keyframes gs-fly { 0% { left: var(--sx); top: calc(var(--sy) + 16px); opacity: 0; transform: rotate(-20deg); } 12% { opacity: 1; } 45% { transform: rotate(12deg); } 75% { left: var(--ex); top: calc(var(--ey) + 16px); opacity: 1; transform: rotate(-3deg); } 100% { left: var(--ex); top: calc(var(--ey) + 16px); opacity: 0; } }
@keyframes gs-arc { 0% { left: var(--sx); top: calc(var(--sy) + 16px); opacity: 0; transform: rotate(-25deg); } 12% { opacity: 1; } 40% { left: calc((var(--sx) + var(--ex)) / 2); top: calc(var(--sy) - 18px); transform: rotate(15deg); } 75% { left: var(--ex); top: calc(var(--ey) + 16px); opacity: 1; transform: rotate(-4deg); } 100% { left: var(--ex); top: calc(var(--ey) + 16px); opacity: 0; } }
.gs-show { opacity: 0; animation: gs-in .4s ease var(--d) forwards; }
.gs-show[data-out] { animation: gs-in .3s ease var(--d) forwards, gs-out .3s ease var(--o) forwards; }
@keyframes gs-in { to { opacity: 1; } }
@keyframes gs-out { from { opacity: 1; } to { opacity: 0; } }
.gs-cash { position: relative; width: 64px; height: 50px; }
.gs-cash .gnote { position: absolute; left: 4px; width: 56px; height: 31px; filter: drop-shadow(0 2px 2px rgba(23, 59, 72, .15)); }
.gs-cash .gnote:nth-child(1) { top: -2px; transform: rotate(-10deg); }
.gs-cash .gnote:nth-child(2) { top: 2px; transform: rotate(6deg); }
.gs-cash .gnote:nth-child(3) { top: 6px; }
.gs-cash span { position: absolute; left: 50%; top: 38px; transform: translateX(-50%); font: 700 12px var(--ui); color: var(--muted); }
.gs-eq { font: 700 40px/1 var(--display); color: var(--muted); }
.gs-row { width: 132px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px 9px; display: grid; grid-template-columns: 1fr auto; gap: 7px 6px; align-items: center; text-align: left; font-weight: 600; font-size: 14px; }
.gs-row .pill { min-width: 0; font-size: 13px; }
.gs-row .gs-bar { grid-column: 1 / -1; }
.gs-bar { height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; }
.gs-bar i { display: block; height: 100%; width: var(--f, 0); border-radius: 3px; background: var(--good); animation: gs-w 1s ease var(--d, 1.9s) forwards; }

@keyframes gs-w { from { width: var(--f, 0); } to { width: var(--w, 100%); } }
.gs-table { display: grid; justify-items: center; gap: 0; width: 132px; padding: 6px 0; border-radius: 12px; background: var(--surface); box-shadow: 0 3px 8px rgba(23, 59, 72, .08); }
.gs-table small { font: 700 11px var(--ui); text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.gs-table b { display: grid; font: 700 22px var(--display); color: var(--ink); }
.gs-table b > * { grid-area: 1 / 1; }
.gs-rta { display: grid; justify-items: center; gap: 2px; width: 132px; padding: 8px 0; border-radius: 12px; background: var(--good-soft); color: var(--good); }
.gs-rta small { font: 700 11px var(--ui); text-transform: uppercase; letter-spacing: .05em; }
.gs-rta b { display: grid; font: 700 22px var(--display); }
.gs-rta b > * { grid-area: 1 / 1; }

.gs-shop { display: grid; justify-items: center; gap: 4px; }
.gs-shop small { font-size: 12px; color: var(--muted); }
.gs-ic { font-size: 30px; line-height: 1; }
.gs-cal { width: 78px; }
.gs-cal > i { display: block; height: 12px; border-radius: 6px 6px 0 0; background: var(--g-blush-i); }
.gs-cal > div { position: relative; height: 52px; }
.gs-cal b { position: absolute; inset: 0; display: grid; place-content: center; line-height: 1; border-radius: 0 0 6px 6px; background: var(--surface); box-shadow: 0 3px 6px rgba(23, 59, 72, .12); font: 700 24px var(--hand); color: var(--ink); transform-origin: top right; animation: gs-peel .55s ease-in var(--d) forwards; }
.gs-cal b:last-child { animation: none; }
.gs-cal.still { width: 70px; }
.gs-cal.still > div { height: 44px; }
.gs-cal small { font: 700 9px var(--ui); text-transform: uppercase; letter-spacing: .04em; color: var(--g-blush-i); }
@keyframes gs-peel { 35% { transform: rotate(-10deg); } 100% { transform: rotate(-40deg) translate(-26px, -10px); opacity: 0; } }
/* one note shows in the envelope once it lands */
.ge.one .ge-cash, .ge.fill .ge-cash, .ge.less .ge-cash { display: block; }
.ge.one .ge-cash .gnote:last-child { display: none; }
.ge.one .ge-cash .gnote:first-child { left: 7px; }
.ge.fill .ge-cash { opacity: 0; animation: gs-in .3s ease var(--ci, 0s) forwards; }
.ge.less .ge-cash .gnote:last-child { animation: gs-out .3s ease var(--co, 0s) forwards; }
.gs-cap { font: 700 11px var(--ui); text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
.g-replay { display: block; margin: 0 0 10px auto; border: 0; background: none; color: var(--muted); font: 600 13px var(--ui); cursor: pointer; padding: 2px 0; }
.g-replay:hover { color: var(--accent); }
/* picture doodles: twinkling sparkles and a sprig */
.gs-sp { position: absolute; fill: none; stroke: color-mix(in srgb, var(--ci) 60%, transparent); stroke-width: 1.8; stroke-linecap: round; pointer-events: none; }
.gs-sp { top: 10px; right: 14px; width: 16px; height: 16px; animation: gs-twinkle 2.6s ease-in-out infinite; }
.gs-sp.two { top: auto; bottom: 14px; right: 40px; width: 10px; height: 10px; animation-delay: -1.3s; }
@keyframes gs-twinkle { 50% { transform: scale(.55) rotate(45deg); opacity: .5; } }
/* a receipt that prints, a little bank card, a rubber stamp */
.gs-rcpt { display: grid; gap: 3px; width: 92px; padding: 8px 10px 12px; background: var(--surface); text-align: left; font: 600 11px/1.2 var(--ui); color: var(--muted); box-shadow: 0 3px 8px rgba(23, 59, 72, .12); animation: gs-print 1s steps(6) 1.2s both;
  -webkit-mask: linear-gradient(#000 0 0) top / 100% calc(100% - 5px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 10px 5px repeat-x;
          mask: linear-gradient(#000 0 0) top / 100% calc(100% - 5px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 10px 5px repeat-x; }
.gs-rcpt b { font: 700 13px var(--hand); color: var(--ink); text-align: center; border-bottom: 1px dashed var(--line); padding-bottom: 3px; }
.gs-rcpt span:last-child { border-top: 1px dashed var(--line); padding-top: 3px; color: var(--ink); display: flex; justify-content: space-between; }
.gs-rcpt em { font-style: normal; }
@keyframes gs-print { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }


@keyframes gs-tap { 50% { transform: translateY(5px) scale(.94); } }
.gs-stamp { display: inline-block; padding: 2px 10px; border: 2.5px solid var(--good); border-radius: 6px; color: var(--good); font: 700 20px var(--hand); background: color-mix(in srgb, var(--surface) 80%, transparent); animation: gs-stamp .35s cubic-bezier(.2, 1.6, .5, 1) var(--d) both; }
@keyframes gs-stamp { from { opacity: 0; transform: rotate(-10deg) scale(2.2); } to { opacity: 1; transform: rotate(-10deg) scale(1); } }
/* a big icon in the chapter's colour, for the steps without a picture */
.g-badge { float: right; display: grid; place-items: center; width: 64px; height: 64px; margin: 6px 0 8px 14px; border-radius: 50%; background: var(--c); color: var(--ci); }
.g-badge .g-icon { width: 30px; height: 30px; stroke-width: 1.7; }
/* sticky note */
.g-note-wrap { text-align: center; margin: 16px 0 6px; }
.g-note { position: relative; display: inline-block; max-width: 92%; padding: 12px 20px 10px; background: var(--g-butter); color: var(--g-butter-i); font: 700 23px/1.15 var(--hand); transform: rotate(-1.5deg); border-radius: 3px; box-shadow: 0 6px 14px rgba(23, 59, 72, .1); }
.g-note::before { content: ''; position: absolute; top: -9px; left: 50%; width: 64px; height: 18px; margin-left: -32px; background: color-mix(in srgb, var(--surface) 60%, transparent); border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); transform: rotate(2deg); }

/* money in - envelopes = $0 */
.g-formula { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 6px 0 16px; padding: 18px 10px; border-radius: 16px; background: color-mix(in srgb, var(--c) 40%, var(--surface)); }
.g-formula > i { font: 700 30px var(--display); font-style: normal; color: var(--muted); }
.gf { display: grid; place-items: center; align-content: center; gap: 2px; width: 108px; height: 108px; border-radius: 50%; background: var(--t); color: var(--ti); text-align: center; }
.gf b { font: 700 22px var(--display); }
.gf small { font: 700 11px/1.2 var(--ui); text-transform: uppercase; letter-spacing: .05em; padding: 0 10px; }
.gf.zero { background: var(--ink); color: var(--bg); box-shadow: 0 0 0 5px var(--surface), 0 0 0 7px var(--ink); }
.gf.zero b { font-size: 30px; }
/* the sum builds itself: each part pops in, the envelopes add up, then the $0 lands */
.g-formula > * { animation: gf-pop .45s cubic-bezier(.2, 1.5, .5, 1) var(--d) both; }
.gf.t-butter b { display: grid; } .gf.t-butter b > * { grid-area: 1 / 1; }
@keyframes gf-pop { from { opacity: 0; transform: scale(.4); } }
.gs-chq { display: grid; justify-items: start; width: 92px; padding: 6px 9px 7px; border-radius: 4px; background: var(--surface); border-left: 4px solid var(--g-sky); box-shadow: 0 3px 8px rgba(23, 59, 72, .12); text-align: left; rotate: -3deg; }
.gs-chq small { font: 700 9px var(--ui); text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.gs-chq b { font: 700 17px/1.1 var(--hand); color: var(--ink); }
.gs-chq em { align-self: end; justify-self: end; font: 700 13px var(--ui); font-style: normal; color: var(--ink); border-top: 1px dashed var(--line); padding-top: 2px; }
.gs-stamp.sm { position: absolute; left: 50px; top: 50px; font-size: 15px; padding: 0 6px; border-width: 2px; }
.gs-arrow { font: 700 28px var(--hand); font-style: normal; color: var(--muted); }
.gs-bank { display: block; width: 56px; height: 52px; fill: var(--g-lilac); stroke: var(--g-lilac-i); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
/* the four kinds of envelope */
.g-kinds { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 6px 0 16px; }
.g-kind { display: grid; gap: 2px; padding: 14px; border-radius: 16px; background: var(--t); color: var(--ink); }
.g-kind b { font: 700 18px var(--display); color: var(--ti); }
.g-kind span { font-size: 14.5px; }
.g-kind small { font-size: 13px; color: var(--muted); }
.g-kind-ic { display: grid; place-items: center; width: 40px; height: 40px; margin-bottom: 4px; border-radius: 50%; background: var(--surface); color: var(--ti); }
.g-icon { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: reduce) { .gs *, .g-formula * { animation-duration: .01s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; } .g-replay { display: none; } }
@media (max-width: 560px) {
  .g-card { padding: 20px 18px 18px; border-radius: 14px; }
  .g-card h2 { font-size: 23px; }
  .g-formula { gap: 6px; }
  .g-formula > i { font-size: 22px; }
  .gf { width: 84px; height: 84px; }
  .gf b { font-size: 17px; }
  .gf.zero b { font-size: 24px; }
  .gf small { font-size: 9.5px; padding: 0 6px; }
  .g-kind { padding: 12px; }
  .g-amt { grid-template-columns: 1fr 1fr; }
  .g-amt-n { grid-column: 1 / -1; }
  .g-amt-h span { display: none; }
  .g-custom { grid-column: 1 / -1; }
  .g-brand { display: none; }
  .g-top { flex-wrap: nowrap; }
  .g-chs { justify-content: flex-start; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .g-chs::-webkit-scrollbar { display: none; }
  .g-ch { white-space: nowrap; flex: none; }
}
.zl-spot { position: relative; z-index: 5; outline: 3px solid var(--accent) !important; outline-offset: 4px; border-radius: 10px; animation: zl-pulse 1.6s ease-in-out infinite; }
@keyframes zl-pulse { 0%, 100% { outline-color: var(--accent); } 50% { outline-color: color-mix(in srgb, var(--accent) 30%, transparent); } }
.zl-spotbar { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 140; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; justify-content: center; max-width: min(640px, calc(100vw - 32px)); background: var(--ink); color: var(--bg); padding: 12px 14px 12px 18px; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25); font-size: 15px; }
@media (prefers-reduced-motion: reduce) { .zl-spot { animation: none; } }
`;
  document.head.appendChild(css);
})();
