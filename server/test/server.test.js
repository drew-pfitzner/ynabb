// Server tests: run with `node --test server/test/` from the repo root. Uses a throwaway data folder.
'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ynabb-test-'));
// TRUST_PROXY lets a test pretend to be another address with X-Forwarded-For
Object.assign(process.env, { DATA_DIR: dir, COOKIE_SECURE: '0', TRUST_PROXY: '1', ADMIN_USERNAME: 'drew', ADMIN_PASSWORD: 'correct horse battery', ADMIN_NAME: 'Drew' });
const { server, bootstrap, db, ipFails, loginFails, sweep } = require('../server.js');
let base;

before(async () => {
  await bootstrap();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { server.close(); server.closeAllConnections(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { ipFails.clear(); loginFails.clear(); });

// a tiny browser: keeps its cookie and sends the header our pages send
function browser() {
  let cookie = '';
  const call = async (method, url, body, extra = {}) => {
    const headers = Object.assign({ 'X-Requested-With': 'ynabb' }, cookie ? { Cookie: cookie } : {}, extra);
    if (body !== undefined && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body), redirect: 'manual' });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  return { call, get cookie() { return cookie; }, login: (username, password) => call('POST', '/api/login', { username, password }) };
}
// read live-update events until `until` returns true
function listen(cookie, until) {
  return new Promise((ok, no) => {
    const events = [];
    const req = http.get(base + '/api/events', { headers: { Cookie: cookie } }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /event: (\w+)/.exec(block), data = /data: (.*)/.exec(block);
          if (ev && data) events.push({ type: ev[1], data: JSON.parse(data[1]) });
          if (until(events)) { req.destroy(); ok(events); }
        }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') no(e); });
    setTimeout(() => { req.destroy(); no(new Error('timed out waiting for events')); }, 3000);
  });
}

// open a live-update connection; resolves once the snapshot arrives, with a promise for when the server closes it
function openStream(cookie) {
  return new Promise((ok, no) => {
    const req = http.get(base + '/api/events', { headers: { Cookie: cookie } }, (res) => {
      let closed = false;
      const ended = new Promise((done) => res.on('end', () => { closed = true; done(); }));
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        if (buf.includes('event: snapshot')) ok({ ended, get closed() { return closed; }, stop: () => req.destroy() });
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') no(e); });
  });
}
const within = (p, ms = 2000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('still open')), ms))]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('health check works without signing in', async () => {
  const r = await browser().call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('signed-out visitors are sent to the login page and kept out of the API', async () => {
  const b = browser();
  const page = await b.call('GET', '/');
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/login');
  assert.equal((await b.call('GET', '/api/data')).status, 401);
  assert.equal((await b.call('GET', '/app.js')).status, 303);
  assert.equal((await b.call('GET', '/login')).status, 200);
});

test('security headers are on every page', async () => {
  const r = await browser().call('GET', '/login');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('a wrong password is refused and written to the sign-in log', async () => {
  const r = await browser().login('drew', 'nope nope nope');
  assert.equal(r.status, 401);
  assert.match(r.json.error, /don't match/);
  const row = db.prepare('SELECT * FROM signins ORDER BY seq DESC LIMIT 1').get();
  assert.equal(row.ok, 0);
  assert.equal(row.username, 'drew');
});

test('unknown usernames get the same answer as wrong passwords', async () => {
  const r = await browser().login('nobody', 'nope nope nope');
  assert.equal(r.status, 401);
  assert.match(r.json.error, /don't match/);
});

test('signing in gives a cookie that only scripts on the page cannot read', async () => {
  const b = browser();
  const r = await b.login('drew', 'correct horse battery');
  assert.equal(r.status, 200);
  const set = r.headers.get('set-cookie');
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  const me = await b.call('GET', '/api/me');
  assert.equal(me.json.name, 'Drew');
  assert.equal(me.json.admin, true);
  assert.equal(me.json.budget.name, 'Family');
  const page = await b.call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>YNABB<\/title>/);
});

test('changes without our header are blocked (no cross-site requests)', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  const r = await b.call('PATCH', '/api/doc/meta/settings', { currency: 'AUD' }, { 'X-Requested-With': '' });
  assert.equal(r.status, 403);
  const r2 = await b.call('PATCH', '/api/doc/meta/settings', { currency: 'AUD' }, { Origin: 'https://evil.example' });
  assert.equal(r2.status, 403);
});

test('patches merge like store.js: objects merge, null removes, everything is logged', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  await b.call('PATCH', '/api/doc/tx/2026-09', { t: { a: { id: 'a', amt: -500 }, b: { id: 'b', amt: -700 } } });
  await b.call('PATCH', '/api/doc/tx/2026-09', { t: { a: { memo: 'lunch' }, b: null } });
  const data = (await b.call('GET', '/api/data')).json;
  assert.deepEqual(data.tx['2026-09'], { t: { a: { id: 'a', amt: -500, memo: 'lunch' } } });
  const n = db.prepare("SELECT COUNT(*) n FROM changes WHERE coll = 'tx' AND id = '2026-09'").get().n;
  assert.equal(n, 2);
});

test('two people editing the same month at once both keep their change', async () => {
  const a = browser(), b = browser();
  await a.login('drew', 'correct horse battery');
  await b.login('drew', 'correct horse battery');
  await Promise.all([
    a.call('PATCH', '/api/doc/tx/2026-08', { t: { x: { id: 'x', amt: 100 } } }),
    b.call('PATCH', '/api/doc/tx/2026-08', { t: { y: { id: 'y', amt: 200 } } }),
  ]);
  const t = (await a.call('GET', '/api/data')).json.tx['2026-08'].t;
  assert.deepEqual(Object.keys(t).sort(), ['x', 'y']);
});

test('a restore (PUT) replaces the document and keeps the old copy in the log', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  await b.call('PATCH', '/api/doc/months/2026-07', { assigned: { food: 1000 } });
  await b.call('PUT', '/api/doc/months/2026-07', { assigned: { rent: 2000 }, moves: {} });
  const doc = (await b.call('GET', '/api/data')).json.months['2026-07'];
  assert.deepEqual(doc, { assigned: { rent: 2000 }, moves: {} });
  const row = db.prepare("SELECT before FROM changes WHERE op = 'put' AND id = '2026-07'").get();
  assert.deepEqual(JSON.parse(row.before), { assigned: { food: 1000 } });
});

test('bad document names are refused', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  assert.equal((await b.call('PATCH', '/api/doc/users/x', { a: 1 })).status, 400);
  assert.equal((await b.call('PATCH', '/api/doc/meta/..%2f..', { a: 1 })).status, 404);
  assert.equal((await b.call('PATCH', '/api/doc/meta/settings', [1, 2])).status, 400);
});

test('live updates: the whole budget first, then each change', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  const got = listen(b.cookie, (ev) => ev.some((e) => e.type === 'doc'));
  await new Promise((r) => setTimeout(r, 100));
  await b.call('PATCH', '/api/doc/meta/settings', { theme: 'dark' });
  const events = await got;
  assert.equal(events[0].type, 'snapshot');
  assert.ok(events[0].data.tx);
  const doc = events.find((e) => e.type === 'doc');
  assert.equal(doc.data.coll, 'meta');
  assert.equal(doc.data.doc.theme, 'dark');
});

test('files outside the app folder cannot be reached', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  for (const p of ['/../server/server.js', '/%2e%2e/server/server.js', '/..%2fserver%2fserver.js']) {
    const r = await b.call('GET', p);
    assert.notEqual(r.status, 200, p);
  }
});

let sisterPw;
test('the admin can make a second budget and a login for it', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  const nb = await b.call('POST', '/api/admin/budgets', { name: "Sister's budget" });
  assert.equal(nb.status, 200);
  const nu = await b.call('POST', '/api/admin/users', { name: 'Sis', username: 'Sis', budget_id: nb.json.id });
  assert.equal(nu.status, 200);
  assert.equal(nu.json.username, 'sis');
  assert.match(nu.json.password, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  sisterPw = nu.json.password;
  const dup = await b.call('POST', '/api/admin/users', { name: 'Sis 2', username: 'sis', budget_id: nb.json.id });
  assert.equal(dup.status, 400);
});

test('budgets are kept apart', async () => {
  const s = browser();
  assert.equal((await s.login('sis', sisterPw)).status, 200);
  const me = (await s.call('GET', '/api/me')).json;
  assert.equal(me.budget.name, "Sister's budget");
  assert.equal(me.admin, false);
  const data = (await s.call('GET', '/api/data')).json;
  assert.deepEqual(data, { meta: {}, months: {}, tx: {} });
  await s.call('PATCH', '/api/doc/meta/settings', { mine: true });
  const d = browser();
  await d.login('drew', 'correct horse battery');
  const family = (await d.call('GET', '/api/data')).json;
  assert.equal(family.meta.settings.mine, undefined);
  // and she can't use the admin tools
  assert.equal((await s.call('GET', '/api/admin/overview')).status, 403);
  assert.equal((await s.call('POST', '/api/admin/budgets', { name: 'x' })).status, 403);
  // people list shows her budget's people and the admin, nobody else
  const ppl = (await s.call('GET', '/api/people')).json;
  assert.deepEqual(Object.values(ppl).map((p) => p.name).sort(), ['Drew', 'Sis']);
});

test('receipts: right types only, and only the budget that owns one can see it', async () => {
  const d = browser();
  await d.login('drew', 'correct horse battery');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const bad = await d.call('POST', '/api/blob', png, { 'Content-Type': 'image/svg+xml' });
  assert.equal(bad.status, 415);
  assert.equal(bad.json.code, 'unsupported_type');
  const up = await d.call('POST', '/api/blob', png, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 200);
  const got = await d.call('GET', '/_blob/' + up.json.id);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  const s = browser();
  await s.login('sis', sisterPw);
  assert.equal((await s.call('GET', '/_blob/' + up.json.id)).status, 404);
  // only the admin may choose an id (for moving receipts across)
  assert.equal((await s.call('POST', '/api/blob?id=abc', png, { 'Content-Type': 'image/png' })).status, 400);
  assert.equal((await d.call('POST', '/api/blob?id=old-receipt-1', png, { 'Content-Type': 'image/png' })).json.id, 'old-receipt-1');
});

test('the admin can open another budget and switch back', async () => {
  const d = browser();
  await d.login('drew', 'correct horse battery');
  const o = (await d.call('GET', '/api/admin/overview')).json;
  const sis = o.budgets.find((b) => b.name === "Sister's budget");
  await d.call('POST', '/api/admin/switch', { budget_id: sis.id });
  assert.equal((await d.call('GET', '/api/data')).json.meta.settings.mine, true);
  const fam = o.budgets.find((b) => b.name === 'Family');
  await d.call('POST', '/api/admin/switch', { budget_id: fam.id });
  assert.equal((await d.call('GET', '/api/data')).json.meta.settings.mine, undefined);
});

test('five wrong passwords lock a login, even against the right one', async () => {
  const s = browser();
  for (let i = 0; i < 5; i++) assert.equal((await s.login('sis', 'wrong wrong wrong')).status, 401);
  ipFails.clear();
  const r = await s.login('sis', sisterPw);
  assert.equal(r.status, 429);
  assert.match(r.json.error, /locked/);
  // the admin can unlock it
  const d = browser();
  await d.login('drew', 'correct horse battery');
  const u = (await d.call('GET', '/api/admin/overview')).json.users.find((x) => x.username === 'sis');
  await d.call('PATCH', '/api/admin/users/' + u.id, { unlock: true });
  assert.equal((await s.login('sis', sisterPw)).status, 200);
});

test('too many wrong passwords from one address makes it wait', async () => {
  const b = browser();
  for (let i = 0; i < 10; i++) await b.login('nobody' + i, 'wrong wrong wrong');
  const r = await b.login('drew', 'correct horse battery');
  assert.equal(r.status, 429);
});

test('turning a login off signs that person out straight away', async () => {
  const s = browser();
  await s.login('sis', sisterPw);
  const d = browser();
  await d.login('drew', 'correct horse battery');
  const u = (await d.call('GET', '/api/admin/overview')).json.users.find((x) => x.username === 'sis');
  await d.call('PATCH', '/api/admin/users/' + u.id, { disabled: true });
  assert.equal((await s.call('GET', '/api/data')).status, 401);
  assert.equal((await s.login('sis', sisterPw)).status, 401);
  // and the admin can't turn themselves off
  const me = (await d.call('GET', '/api/me')).json;
  assert.equal((await d.call('PATCH', '/api/admin/users/' + me.id, { disabled: true })).status, 400);
  await d.call('PATCH', '/api/admin/users/' + u.id, { disabled: false });
});

test('a new password from the admin replaces the old one', async () => {
  const d = browser();
  await d.login('drew', 'correct horse battery');
  const u = (await d.call('GET', '/api/admin/overview')).json.users.find((x) => x.username === 'sis');
  const r = await d.call('POST', `/api/admin/users/${u.id}/reset`);
  assert.equal((await browser().login('sis', sisterPw)).status, 401);
  assert.equal((await browser().login('sis', r.json.password)).status, 200);
  sisterPw = r.json.password;
});

test('changing your own password signs out your other devices', async () => {
  const phone = browser(), laptop = browser();
  await phone.login('sis', sisterPw);
  await laptop.login('sis', sisterPw);
  assert.equal((await laptop.call('POST', '/api/password', { current: 'wrong', next: 'a brand new password' })).status, 400);
  assert.equal((await laptop.call('POST', '/api/password', { current: sisterPw, next: 'short' })).status, 400);
  assert.equal((await laptop.call('POST', '/api/password', { current: sisterPw, next: 'a brand new password' })).status, 200);
  assert.equal((await laptop.call('GET', '/api/me')).status, 200);
  assert.equal((await phone.call('GET', '/api/me')).status, 401);
});

test('signing out ends the session', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  await b.call('POST', '/api/logout');
  assert.equal((await b.call('GET', '/api/me')).status, 401);
});

test('passwords are stored as scrypt hashes, never as typed', () => {
  for (const u of db.prepare('SELECT pass FROM users').all()) assert.match(u.pass, /^scrypt\$/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE pass LIKE '%correct horse%'").get().n, 0);
});

test('a stranger hammering a login only locks it on their own address', async () => {
  const stranger = { 'X-Forwarded-For': '203.0.113.9' };
  const s = browser();
  for (let i = 0; i < 5; i++) assert.equal((await s.call('POST', '/api/login', { username: 'Drew', password: 'wrong wrong wrong' }, stranger)).status, 401);
  // even the right password is refused from the stranger's address...
  const r = await s.call('POST', '/api/login', { username: 'drew', password: 'correct horse battery' }, stranger);
  assert.equal(r.status, 429);
  assert.match(r.json.error, /locked/);
  // ...but Drew on his own device still gets in, and the admin page shows the login as locked
  const d = browser();
  assert.equal((await d.login('drew', 'correct horse battery')).status, 200);
  const me = (await d.call('GET', '/api/admin/overview')).json.users.find((x) => x.username === 'drew');
  assert.ok(me.locked_until > Date.now());
  // and Drew's own wrong passwords are counted separately from the stranger's
  for (let i = 0; i < 4; i++) await browser().login('drew', 'wrong wrong wrong');
  assert.equal((await browser().login('drew', 'correct horse battery')).status, 200);
});

test("signing out closes that device's live updates, not the other devices", async () => {
  const a = browser(), b = browser();
  await a.login('drew', 'correct horse battery');
  await b.login('drew', 'correct horse battery');
  const sa = await openStream(a.cookie), sb = await openStream(b.cookie);
  await a.call('POST', '/api/logout');
  await within(sa.ended);
  await pause(100);
  assert.equal(sb.closed, false);
  sb.stop();
});

test('a new password closes the live updates of the devices it signs out', async () => {
  const d = browser();
  await d.login('drew', 'correct horse battery');
  const fam = (await d.call('GET', '/api/me')).json.budget.id;
  let pw = (await d.call('POST', '/api/admin/users', { name: 'Kid', username: 'kid', budget_id: fam })).json.password;
  const phone = browser(), laptop = browser();
  await phone.login('kid', pw);
  await laptop.login('kid', pw);
  const sp = await openStream(phone.cookie), sl = await openStream(laptop.cookie);
  // changing it yourself closes the other device, keeps this one
  assert.equal((await laptop.call('POST', '/api/password', { current: pw, next: 'a brand new password' })).status, 200);
  await within(sp.ended);
  await pause(100);
  assert.equal(sl.closed, false);
  // the admin giving a new password closes every device
  const u = (await d.call('GET', '/api/admin/overview')).json.users.find((x) => x.username === 'kid');
  pw = (await d.call('POST', `/api/admin/users/${u.id}/reset`)).json.password;
  await within(sl.ended);
  assert.equal((await laptop.call('GET', '/api/me')).status, 401);
});

test('expired sessions are cleared from storage and their live updates closed', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  const st = await openStream(b.cookie);
  const keep = browser();
  await keep.login('drew', 'correct horse battery');
  const DAY = 864e5;
  const n = () => db.prepare('SELECT COUNT(*) n FROM sessions').get().n;
  // make the first session look 15 days unused, and add one past the 90-day limit
  const id = require('node:crypto').createHash('sha256').update(b.cookie.split('=')[1]).digest('base64url');
  db.prepare('UPDATE sessions SET seen_at = ? WHERE id = ?').run(Date.now() - 15 * DAY, id);
  const u = db.prepare("SELECT id FROM users WHERE username = 'drew'").get().id;
  db.prepare('INSERT INTO sessions VALUES (?, ?, NULL, ?, ?, NULL, NULL)').run('old-one', u, Date.now() - 91 * DAY, Date.now());
  const before = n();
  sweep();
  assert.equal(n(), before - 2);
  assert.equal(db.prepare("SELECT 1 FROM sessions WHERE id IN (?, 'old-one')").get(id), undefined);
  await within(st.ended);
  assert.equal((await b.call('GET', '/api/me')).status, 401);
  assert.equal((await keep.call('GET', '/api/me')).status, 200);
});

test('a mistyped address is "not found", not a server error', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  for (const p of ['/%', '/%E0%A4%A', '/no-such-page', '/nope/%zz']) {
    const r = await b.call('GET', p);
    assert.equal(r.status, 404, p);
    assert.match(r.text, /Not found/, p);
  }
  const api = await b.call('GET', '/api/%');
  assert.equal(api.status, 404);
  assert.equal(api.json.error, 'Not found.');
  // a garbled cookie just means signed out
  const r = await fetch(base + '/', { headers: { Cookie: 'ynabb=%E0%A4%A' }, redirect: 'manual' });
  assert.equal(r.status, 303);
});

test('a whole-budget replace keeps a safety copy and swaps everything at once', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  const nb = await b.call('POST', '/api/admin/budgets', { name: 'Replace test' });
  await b.call('POST', '/api/admin/switch', { budget_id: nb.json.id });
  await b.call('PATCH', '/api/doc/tx/2026-05', { t: { a: { id: 'a', amt: -500 } } });
  const r = await b.call('PUT', '/api/budget', { why: 'restore', docs: { tx: { '2026-05': { t: {} }, '2026-06': { t: { z: { id: 'z', amt: 9 } } } } } });
  assert.equal(r.status, 200);
  assert.equal(r.json.safety.why, 'restore');
  const data = (await b.call('GET', '/api/data')).json;
  assert.deepEqual(data.tx, { '2026-05': { t: {} }, '2026-06': { t: { z: { id: 'z', amt: 9 } } } });
  const copy = (await b.call('GET', '/api/safety-copy')).json;
  assert.equal(copy.app, 'zero-line');
  assert.deepEqual(copy.data.tx['2026-05'], { t: { a: { id: 'a', amt: -500 } } });
  // a bad document name refuses the lot, and nothing changes
  const bad = await b.call('PUT', '/api/budget', { docs: { tx: { '2026-07': { t: {} }, '../x': {} } } });
  assert.equal(bad.status, 400);
  assert.equal((await b.call('GET', '/api/data')).json.tx['2026-07'], undefined);
});

test('the admin can put a budget back to an earlier time, with a safety copy', async () => {
  const b = browser();
  await b.login('drew', 'correct horse battery');
  const nb = await b.call('POST', '/api/admin/budgets', { name: 'Rewind test' });
  const id = nb.json.id;
  await b.call('POST', '/api/admin/switch', { budget_id: id });
  const tick = () => new Promise((r) => setTimeout(r, 5));
  await b.call('PATCH', '/api/doc/tx/2026-09', { t: { a: { id: 'a', amt: -500 }, b: { id: 'b', amt: -700 } } });
  await b.call('PATCH', '/api/doc/meta/accounts', { items: { nab: { id: 'nab', name: 'NAB' } } });
  await tick();
  const then = Date.now();
  await tick();
  // after "3pm": one deleted, one edited, a new month
  await b.call('PATCH', '/api/doc/tx/2026-09', { t: { a: { memo: 'oops' }, b: null } });
  await b.call('PATCH', '/api/doc/tx/2026-10', { t: { c: { id: 'c', amt: -100 } } });
  const look = await b.call('GET', `/api/admin/budgets/${id}/rewind?ts=${then}`);
  assert.equal(look.status, 200);
  assert.deepEqual(look.json.then, { transactions: 2, total: -1200, accounts: 1, categories: 0 });
  assert.equal(look.json.now.transactions, 2);
  assert.equal(look.json.since[0].changes, 2);
  const go = await b.call('POST', `/api/admin/budgets/${id}/rewind`, { ts: then });
  assert.equal(go.status, 200);
  const data = (await b.call('GET', '/api/data')).json;
  assert.deepEqual(data.tx['2026-09'], { t: { a: { id: 'a', amt: -500 }, b: { id: 'b', amt: -700 } } });
  assert.deepEqual(data.tx['2026-10'], { t: {} });
  assert.deepEqual((await b.call('GET', '/api/safety-copy')).json.data.tx['2026-10'], { t: { c: { id: 'c', amt: -100 } } });
  // the put-back is itself in the history, so it can be undone the same way
  assert.equal((await b.call('GET', `/api/admin/budgets/${id}/rewind?ts=${Date.now()}`)).status, 200);
  // a record the history can't explain makes it refuse rather than guess
  db.prepare('INSERT INTO docs VALUES (?, ?, ?, ?, ?)').run(id, 'tx', '2020-01', '{"t":{}}', Date.now());
  const refused = await b.call('POST', `/api/admin/budgets/${id}/rewind`, { ts: then });
  assert.equal(refused.status, 409);
  assert.equal((await b.call('GET', `/api/admin/budgets/${id}/rewind?ts=${Date.now() + 60e3}`)).status, 400);
});
