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
