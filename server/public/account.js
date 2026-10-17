// account page: your own password and sign-out, and for the admin, budgets, people and sign-ins
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (ts) => (ts ? new Date(ts).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never');
let me = null, data = null;

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: Object.assign({ 'X-Requested-With': 'ynabb' }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('Signed out.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'That did not work. Try again.');
  return j;
}
function say(el, text, good) {
  el.textContent = text;
  el.className = 'msg ' + (good ? 'good' : 'bad');
  el.hidden = false;
}
// a generated password, shown once in its own box
function showSecret(el, intro, pw) {
  el.className = 'msg good';
  el.innerHTML = `<p>${esc(intro)}</p><div class="secret">${esc(pw)}</div><p class="fine" style="margin:8px 0 0">Copy it now. It won't be shown again.</p>`;
  el.hidden = false;
}

async function load() {
  me = await api('GET', '/api/me');
  $('#who').innerHTML = `Signed in as <b>${esc(me.name)}</b> (${esc(me.username)})${me.budget ? ` · budget: <b>${esc(me.budget.name)}</b>` : ''}${me.admin ? ' · <span class="chip accent">admin</span>' : ''}`;
  if (!me.admin) return;
  data = await api('GET', '/api/admin/overview');
  $('#admin').hidden = false;
  $('#budgets').innerHTML = data.budgets.map((b) => `<tr class="${me.budget && me.budget.id === b.id ? 'current' : ''}">
    <td><b>${esc(b.name)}</b>${me.budget && me.budget.id === b.id ? ' <span class="chip accent">you are viewing this</span>' : ''}</td>
    <td>${b.docs ? when(b.last_change) : '<span class="muted">empty</span>'}</td>
    <td>${me.budget && me.budget.id === b.id ? '' : `<button class="btn small" data-open="${esc(b.id)}">Open</button>`}<button class="btn small" data-rename="${esc(b.id)}">Rename</button></td></tr>`).join('');
  $('#nu-budget').innerHTML = data.budgets.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  const rwPick = $('#rw-budget').value || (me.budget && me.budget.id);
  $('#rw-budget').innerHTML = data.budgets.map((b) => `<option value="${esc(b.id)}" ${b.id === rwPick ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  if (!$('#rw-when').value) $('#rw-when').value = localInput(Date.now() - 3600e3);
  $('#users').innerHTML = data.users.map((u) => {
    const locked = u.locked_until > Date.now();
    const chips = (u.admin ? ' <span class="chip accent">admin</span>' : '') + (u.disabled ? ' <span class="chip bad">turned off</span>' : '') + (locked ? ' <span class="chip bad">locked</span>' : '');
    const self = u.id === me.id;
    return `<tr><td><b>${esc(u.name)}</b>${chips}<div class="fine">${esc(u.username)}</div></td>
      <td><select data-budget="${esc(u.id)}" aria-label="Budget for ${esc(u.name)}">${data.budgets.map((b) => `<option value="${esc(b.id)}" ${b.id === u.budget_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></td>
      <td>${when(u.last_signin)}</td>
      <td><button class="btn small" data-reset="${esc(u.id)}">New password</button>${locked ? `<button class="btn small" data-unlock="${esc(u.id)}">Unlock</button>` : ''}${self ? '' : `<button class="btn small" data-toggle="${esc(u.id)}">${u.disabled ? 'Turn on' : 'Turn off'}</button>`}</td></tr>`;
  }).join('');
  $('#signins').innerHTML = data.signins.map((s) => `<tr><td>${when(s.ts)}</td><td>${esc(s.username)}</td>
    <td>${s.ok ? '<span class="chip good">signed in</span>' : `<span class="chip bad">${esc(s.note || 'failed')}</span>`}</td>
    <td class="fine">${esc(s.ip)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None yet.</td></tr>';
  $('#backups').innerHTML = backupRows(data.backups);
  const d = data.deploy;
  $('#deploy').innerHTML = `Running version <b>${esc(data.version)}</b>, started ${when(data.started)}.` +
    (d ? (d.ok ? ` <span class="chip good">last update OK</span> <span class="fine">${when(d.ts)}</span>`
      : ` <span class="chip bad">last update failed</span> <span class="fine">${when(d.ts)}: ${esc(d.note)}</span>`) : '');
}

// one row each for the nightly backup and the weekly restore check
function backupRows(b) {
  const chip = {
    ok: '<span class="chip good">OK</span>',
    'local-only': '<span class="chip bad">Not in iCloud</span>',
    failed: '<span class="chip bad">Failed</span>',
    stale: '<span class="chip bad">Not running</span>',
    never: '<span class="chip">Not run yet</span>',
    off: '<span class="chip bad">Off</span>',
  };
  const row = (label, r, every) => `<tr><td><b>${label}</b><div class="fine">${every}</div></td><td>${chip[r.state] || ''}</td>
    <td>${r.ts ? when(r.ts) : ''}${r.lastGood && r.lastGood !== r.ts ? `<div class="fine">last good ${when(r.lastGood)}</div>` : ''}</td>
    <td class="fine">${esc(r.note || (r.size ? Math.round(r.size / 1024) + ' KB' : ''))}</td></tr>`;
  return row('Nightly backup', b.backup, 'every night, 2am') + row('Restore check', b.drill, 'every week');
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-backup]');
  if (!btn) return;
  const m = $('#backup-msg');
  $$('button[data-backup]').forEach((x) => (x.disabled = true));
  m.className = 'msg'; m.textContent = btn.dataset.backup === 'drill' ? 'Testing a restore…' : 'Backing up…'; m.hidden = false;
  try {
    const s = await api('POST', '/api/admin/backup-now', { kind: btn.dataset.backup });
    $('#backups').innerHTML = backupRows(s);
    say(m, btn.dataset.backup === 'drill' ? 'The newest backup opened and checked out.' : 'Backed up.', true);
  } catch (err) { say(m, err.message); await load(); }
  $$('button[data-backup]').forEach((x) => (x.disabled = false));
});

// ---------- put a budget back ----------
// datetime-local wants the local time as "2026-10-17T15:00"
const localInput = (ts) => { const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };
const money = (c) => (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let rwLooked = null;
function rewindAsk() {
  const ts = new Date($('#rw-when').value).getTime();
  return { id: $('#rw-budget').value, ts, name: $('#rw-budget').selectedOptions[0].textContent };
}
$('#rewind').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = rewindAsk(), m = $('#rw-msg'), box = $('#rw-look');
  m.hidden = true; box.hidden = true; rwLooked = null;
  if (!(a.ts < Date.now())) { say(m, 'Choose a time in the past.'); return; }
  try {
    const r = await api('GET', `/api/admin/budgets/${a.id}/rewind?ts=${a.ts}`);
    const row = (label, k, f = (x) => x) => `<tr><td>${label}</td><td>${f(r.then[k])}</td><td>${f(r.now[k])}</td></tr>`;
    const who = r.since.map((p) => `${esc(p.name)} made ${p.changes} change${p.changes === 1 ? '' : 's'} (${p.first === p.last ? 'at ' + when(p.first) : when(p.first) + ' to ' + when(p.last)})`).join('; ');
    box.innerHTML = `<div class="tbl"><table><thead><tr><th></th><th>${esc(when(a.ts))}</th><th>Now</th></tr></thead><tbody>
      ${row('Transactions', 'transactions')}${row('Total of all transactions', 'total', money)}${row('Accounts', 'accounts')}${row('Categories', 'categories')}</tbody></table></div>
      <p style="margin-top:12px">${r.since.length ? `Since then: ${who}. All of it is undone.` : 'Nothing has changed since then.'}</p>
      ${r.then.transactions === 0 && r.now.transactions ? '<p class="msg bad">At that time this budget was empty. Putting it back empties it.</p>' : ''}
      ${r.since.length ? `<div class="row"><button class="btn primary" type="button" id="rw-go">Put ${esc(a.name)} back to ${esc(when(a.ts))}</button></div>` : ''}`;
    box.hidden = false;
    rwLooked = a;
  } catch (err) { say(m, err.message); }
});
// changing the budget or time means looking again before putting it back
['#rw-budget', '#rw-when'].forEach((s) => $(s).addEventListener('input', () => { $('#rw-look').hidden = true; rwLooked = null; }));
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#rw-go') || !rwLooked) return;
  const a = rwLooked, m = $('#rw-msg');
  if (!confirm(`Put ${a.name} back to ${when(a.ts)}? Everything done since then is undone for everyone. A copy of the budget as it is now is kept.`)) return;
  e.target.disabled = true;
  try {
    await api('POST', `/api/admin/budgets/${a.id}/rewind`, { ts: a.ts });
    $('#rw-look').hidden = true; rwLooked = null;
    say(m, `${a.name} is back to how it was at ${when(a.ts)}. Open devices update by themselves. To undo this, in the app go to Settings › Budget before the last put back, download it and restore it.`, true);
    await load();
  } catch (err) { say(m, err.message); e.target.disabled = false; }
});

$('#signout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  location.href = '/login';
});
$('#pw').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('#pw-msg');
  try {
    await api('POST', '/api/password', { current: $('#pw-cur').value, next: $('#pw-new').value });
    $('#pw').reset();
    say(m, 'Password changed.', true);
  } catch (err) { say(m, err.message); }
});
$('#add-budget').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('POST', '/api/admin/budgets', { name: $('#nb-name').value }); $('#nb-name').value = ''; await load(); } catch (err) { alert(err.message); }
});
$('#add-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#nu-name').value;
  try {
    const r = await api('POST', '/api/admin/users', { name, username: $('#nu-username').value, budget_id: $('#nu-budget').value, admin: $('#nu-admin').checked });
    $('#add-user').reset();
    await load();
    showSecret($('#user-msg'), `${name} can now sign in with username "${r.username}" and this password:`, r.password);
    $('#user-msg').scrollIntoView({ block: 'center' });
  } catch (err) { say($('#user-msg'), err.message); $('#user-msg').scrollIntoView({ block: 'center' }); }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-open], button[data-rename], button[data-reset], button[data-unlock], button[data-toggle]');
  if (!b) return;
  const m = $('#user-msg');
  try {
    if (b.dataset.open) { await api('POST', '/api/admin/switch', { budget_id: b.dataset.open }); location.href = '/'; return; }
    if (b.dataset.rename) {
      const cur = data.budgets.find((x) => x.id === b.dataset.rename);
      const name = prompt('New name for this budget', cur ? cur.name : '');
      if (name) { await api('PATCH', '/api/admin/budgets/' + b.dataset.rename, { name }); await load(); }
      return;
    }
    const u = data.users.find((x) => x.id === (b.dataset.reset || b.dataset.unlock || b.dataset.toggle));
    if (b.dataset.reset) {
      if (!confirm(`Make a new password for ${u.name}? Their old one stops working and they're signed out.`)) return;
      const r = await api('POST', `/api/admin/users/${u.id}/reset`);
      await load();
      showSecret(m, `New password for ${u.name} (${u.username}):`, r.password);
    } else if (b.dataset.unlock) {
      await api('PATCH', '/api/admin/users/' + u.id, { unlock: true }); await load();
    } else if (b.dataset.toggle) {
      if (!u.disabled && !confirm(`Turn off ${u.name}'s login? They're signed out straight away. Their budget isn't touched.`)) return;
      await api('PATCH', '/api/admin/users/' + u.id, { disabled: !u.disabled }); await load();
    }
  } catch (err) { say(m, err.message); }
});
document.addEventListener('change', async (e) => {
  const s = e.target.closest('select[data-budget]');
  if (!s) return;
  try { await api('PATCH', '/api/admin/users/' + s.dataset.budget, { budget_id: s.value }); await load(); } catch (err) { say($('#user-msg'), err.message); }
});
load().catch((err) => { $('#who').textContent = err.message; });
