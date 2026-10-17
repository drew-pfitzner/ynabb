/* YNABB server: logins, separate budgets, the document API store.js talks to, live updates and receipts.
   No npm packages: Node's own http, crypto and sqlite. Run: node server/server.js
   Settings come from environment variables (see the README in this folder). */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const Backups = require('./backup.js');

const ENV = process.env;
const PORT = +ENV.PORT || 8080;
const HOST = ENV.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(ENV.DATA_DIR || path.join(__dirname, '..', 'data'));
const APP_DIR = path.resolve(ENV.APP_DIR || path.join(__dirname, '..', 'app'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const BLOB_DIR = path.join(DATA_DIR, 'blobs');
const SECURE = ENV.COOKIE_SECURE !== '0'; // turn off only for plain-http testing on this computer
const TRUST_PROXY = ENV.TRUST_PROXY === '1'; // behind Tailscale: read the visitor's address from X-Forwarded-For
const VERSION = (ENV.APP_VERSION || 'dev').trim();
const STARTED = Date.now();

const MIN = 60e3, DAY = 24 * 60 * MIN;
const SESSION_IDLE = 14 * DAY, SESSION_MAX = 90 * DAY;
// wrong passwords are counted per login *and* address, so a stranger can't lock the family out of their own devices
const USER_FAILS = 5, USER_LOCK = 15 * MIN; // wrong passwords for one login from one address before that pair locks, and for how long
const IP_FAILS = 10, IP_WINDOW = 15 * MIN; // wrong passwords from one address (any login) before it has to wait
const SWEEP_EVERY = MIN; // how often expired sessions and old wrong-password counts are cleared
const COLLS = ['meta', 'months', 'tx'];
const DOC_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const BLOB_ID = /^[A-Za-z0-9_-]{1,100}$/;
const BLOB_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const MAX_JSON = 20e6, MAX_BLOB = 20e6;
const COOKIE = SECURE ? '__Host-ynabb' : 'ynabb';

fs.mkdirSync(BLOB_DIR, { recursive: true });

// ---------- database ----------
// the app was called YABB until October 2026: carry its database file across once, with its journal
if (fs.existsSync(path.join(DATA_DIR, 'yabb.sqlite')) && !fs.existsSync(path.join(DATA_DIR, 'ynabb.sqlite'))) {
  for (const ext of ['-wal', '-shm', '']) {
    const from = path.join(DATA_DIR, 'yabb.sqlite' + ext);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(DATA_DIR, 'ynabb.sqlite' + ext));
  }
}
const db = new DatabaseSync(path.join(DATA_DIR, 'ynabb.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, pass TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0, budget_id TEXT REFERENCES budgets(id), disabled INTEGER NOT NULL DEFAULT 0,
    fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, budget_id TEXT,
    created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL, ip TEXT, agent TEXT);
  CREATE TABLE IF NOT EXISTS docs (
    budget_id TEXT NOT NULL, coll TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (budget_id, coll, id));
  -- every write, kept forever, so any change can be found and put back
  CREATE TABLE IF NOT EXISTS changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, budget_id TEXT NOT NULL, coll TEXT NOT NULL, id TEXT NOT NULL,
    op TEXT NOT NULL, body TEXT NOT NULL, before TEXT, user_id TEXT, ts INTEGER NOT NULL);
  -- the whole budget as it was just before a restore, start fresh or move from YNAB replaced it
  CREATE TABLE IF NOT EXISTS safety_copies (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, budget_id TEXT NOT NULL, why TEXT, body TEXT NOT NULL, user_id TEXT, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY, budget_id TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, user_id TEXT, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS signins (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, username TEXT, user_id TEXT, ip TEXT, agent TEXT,
    ok INTEGER NOT NULL, note TEXT);
`);
const q = (sql) => db.prepare(sql);
const backups = Backups.setup({ db, dataDir: DATA_DIR, blobDir: BLOB_DIR, log: (m) => console.log(new Date().toISOString(), m) });
const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

// ---------- merge patches (the same rules as store.js: objects merge, null removes) ----------
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(target, patch) {
  const out = isObj(target) ? Object.assign({}, target) : {};
  for (const k in patch) {
    const v = patch[k];
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : (isObj(v) ? deepMerge({}, v) : v);
  }
  return out;
}
function stripNulls(o) {
  if (!isObj(o)) return o;
  const out = {};
  for (const k in o) if (o[k] !== null && o[k] !== undefined) out[k] = isObj(o[k]) ? stripNulls(o[k]) : o[k];
  return out;
}

// ---------- passwords and ids ----------
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, SCRYPT, (e, k) => (e ? no(e) : ok(k))));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + salt.toString('base64') + '$' + (await scrypt(pw, salt)).toString('base64');
}
async function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  const got = await scrypt(String(pw), Buffer.from(salt || '', 'base64'));
  const want = Buffer.from(hash || '', 'base64');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}
const DUMMY_HASH = hashPassword(crypto.randomBytes(9).toString('hex')); // so unknown usernames take as long as known ones
const newId = () => crypto.randomBytes(9).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64url');
// readable generated passwords: 16 letters and digits without look-alikes (about 79 bits)
function newPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += (i && i % 4 === 0 ? '-' : '') + abc[crypto.randomInt(abc.length)];
  return s;
}
function passwordProblem(pw, username) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return "Don't use your username in your password.";
  return null;
}

// ---------- first run ----------
// With no users yet, ADMIN_USERNAME and ADMIN_PASSWORD create the super admin and a first budget.
async function bootstrap() {
  if (q('SELECT COUNT(*) n FROM users').get().n) return;
  const username = ENV.ADMIN_USERNAME, pw = ENV.ADMIN_PASSWORD;
  if (!username || !pw) { console.log('No logins yet. Set ADMIN_USERNAME and ADMIN_PASSWORD, or run: node server/server.js add-admin <username> <name>'); return; }
  const bad = passwordProblem(pw, username);
  if (bad) { console.error('ADMIN_PASSWORD: ' + bad); process.exit(1); }
  await createAdmin(username, ENV.ADMIN_NAME || username, pw);
  console.log('Created super admin "' + username + '".');
}
async function createAdmin(username, name, pw) {
  const now = Date.now(), bid = newId();
  const hash = await hashPassword(pw);
  tx(() => {
    if (!q('SELECT 1 FROM budgets LIMIT 1').get()) q('INSERT INTO budgets VALUES (?, ?, ?)').run(bid, ENV.FIRST_BUDGET_NAME || 'Family', now);
    const b = q('SELECT id FROM budgets ORDER BY created_at LIMIT 1').get();
    q('INSERT INTO users (id, username, name, pass, admin, budget_id, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(newId(), username, name, hash, b.id, now);
  });
}

// ---------- helpers ----------
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
if (SECURE) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000';

function send(res, status, body, headers) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, {
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, headers));
  res.end(data);
}
class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
const fail = (status, msg, code) => { throw new HttpError(status, msg, code); };

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
const agent = (req) => String(req.headers['user-agent'] || '').slice(0, 200);

function readBody(req, limit) {
  return new Promise((ok, no) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { no(new HttpError(413, 'That is too big to save.', 'too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', no);
  });
}
async function readJson(req) {
  const raw = await readBody(req, MAX_JSON);
  if (!raw.length) return null; // e.g. a button press with nothing to send
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) fail(415, 'Send JSON.');
  try { return JSON.parse(raw.toString('utf8')); } catch (e) { fail(400, 'That was not valid JSON.'); }
}

// ---------- sessions ----------
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // a garbled cookie just means "not signed in", not a server error
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* skip it */ }
  }
  return out;
}
function cookieHeader(value, maxAgeSec) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` + (SECURE ? '; Secure' : '');
}
function startSession(req, user) {
  const token = crypto.randomBytes(32).toString('base64url'), now = Date.now();
  q('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(sha(token), user.id, user.budget_id, now, now, clientIp(req), agent(req));
  return cookieHeader(token, SESSION_MAX / 1000);
}
// who is asking: {session, user, budgetId} or null
function whoIs(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = q('SELECT * FROM sessions WHERE id = ?').get(sha(token));
  if (!s) return null;
  const now = Date.now();
  if (now - s.seen_at > SESSION_IDLE || now - s.created_at > SESSION_MAX) { q('DELETE FROM sessions WHERE id = ?').run(s.id); return null; }
  const user = q('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!user || user.disabled) { q('DELETE FROM sessions WHERE id = ?').run(s.id); return null; }
  if (now - s.seen_at > MIN) q('UPDATE sessions SET seen_at = ? WHERE id = ?').run(now, s.id);
  // members only ever see their own budget; the admin can switch between them
  const budgetId = user.admin ? (s.budget_id || user.budget_id) : user.budget_id;
  return { session: s, user, budgetId };
}
// close live-update connections that match, so a signed-out device stops getting budget changes
function closeStreams(match) {
  for (const set of streams.values()) for (const res of set) if (match(res)) { set.delete(res); res.end(); }
}
// sign a person out everywhere, or everywhere but one session (theirs, after changing their own password)
function endSessionsFor(userId, keepSessionId) {
  q('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSessionId || '');
  closeStreams((res) => res.userId === userId && res.sessionId !== keepSessionId);
}
// clear expired sessions, and close any live connection whose session has gone (expired, or ended by the command line)
function sweep() {
  const now = Date.now();
  q('DELETE FROM sessions WHERE seen_at < ? OR created_at < ?').run(now - SESSION_IDLE, now - SESSION_MAX);
  const alive = q('SELECT 1 FROM sessions WHERE id = ?');
  closeStreams((res) => !alive.get(res.sessionId));
  for (const [ip, list] of ipFails) if (!list.some((t) => now - t < IP_WINDOW)) ipFails.delete(ip);
  for (const [key, f] of loginFails) if (f.until <= now && now - f.last > USER_LOCK) loginFails.delete(key);
}

// ---------- logins ----------
// kept in memory: a restart forgets them, which is fine for a family app
const ipFails = new Map(); // ip -> times of recent wrong passwords
const loginFails = new Map(); // 'username ip' -> { n: wrong passwords in a row, last: time of the last one, until: locked until }
const failKey = (username, ip) => username.toLowerCase() + ' ' + ip;
function ipBlocked(ip) {
  const now = Date.now();
  const list = (ipFails.get(ip) || []).filter((t) => now - t < IP_WINDOW);
  ipFails.set(ip, list);
  return list.length >= IP_FAILS;
}
// the admin unlocking a login, or giving it a new password, clears it on every address
function unlockLogin(username) {
  const prefix = username.toLowerCase() + ' ';
  for (const key of loginFails.keys()) if (key.startsWith(prefix)) loginFails.delete(key);
}
// for the admin page: the latest time any address is locked out of this login
function lockedUntil(username) {
  const prefix = username.toLowerCase() + ' ', now = Date.now();
  let until = 0;
  for (const [key, f] of loginFails) if (key.startsWith(prefix) && f.until > now) until = Math.max(until, f.until);
  return until;
}
function noteSignin(req, username, userId, ok, note) {
  q('INSERT INTO signins (ts, username, user_id, ip, agent, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(Date.now(), String(username || '').slice(0, 100), userId || null, clientIp(req), agent(req), ok ? 1 : 0, note || null);
}
async function login(req, res) {
  const body = await readJson(req);
  const username = String((body && body.username) || '').trim(), pw = String((body && body.password) || '');
  const ip = clientIp(req);
  const NOPE = "That username and password don't match.";
  if (ipBlocked(ip)) { noteSignin(req, username, null, false, 'address waiting'); fail(429, 'Too many wrong passwords. Wait 15 minutes and try again.'); }
  const user = username ? q('SELECT * FROM users WHERE username = ?').get(username) : null;
  const key = failKey(username, ip);
  const prev = loginFails.get(key);
  // only this login from this address is locked: the real person on their own device can still sign in
  if (prev && prev.until > Date.now()) { noteSignin(req, username, user && user.id, false, 'locked'); fail(429, 'This login is locked for a few minutes after too many wrong passwords.'); }
  const wrong = (note) => {
    const now = Date.now();
    ipFails.get(ip).push(now);
    // count wrong passwords in a row; a gap longer than the lock starts the count again
    const n = (prev && now - prev.last < USER_LOCK ? prev.n : 0) + 1;
    loginFails.set(key, n >= USER_FAILS ? { n: 0, last: now, until: now + USER_LOCK } : { n, last: now, until: 0 });
    noteSignin(req, username, user && user.id, false, note);
    fail(401, NOPE);
  };
  if (!user) { await checkPassword(pw, await DUMMY_HASH); wrong('no such user'); }
  if (!(await checkPassword(pw, user.pass))) wrong('wrong password');
  if (user.disabled) wrong('login turned off');
  loginFails.delete(key);
  noteSignin(req, username, user.id, true);
  send(res, 200, { ok: true }, { 'Set-Cookie': startSession(req, user) });
}
function logout(req, res, who) {
  if (who) {
    q('DELETE FROM sessions WHERE id = ?').run(who.session.id);
    closeStreams((r) => r.sessionId === who.session.id);
  }
  send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
}
async function changePassword(req, res, who) {
  const body = await readJson(req) || {};
  if (!(await checkPassword(String(body.current || ''), who.user.pass))) fail(400, 'Your current password is not right.');
  const bad = passwordProblem(body.next, who.user.username);
  if (bad) fail(400, bad);
  q('UPDATE users SET pass = ? WHERE id = ?').run(await hashPassword(body.next), who.user.id);
  // sign out everywhere else, keep this device signed in
  endSessionsFor(who.user.id, who.session.id);
  send(res, 200, { ok: true });
}

// ---------- budget documents ----------
const streams = new Map(); // budgetId -> Set of open live-update responses
function broadcast(budgetId, msg) {
  const set = streams.get(budgetId);
  if (!set) return;
  const line = 'event: doc\ndata: ' + JSON.stringify(msg) + '\n\n';
  for (const r of set) r.write(line);
}
function loadAll(budgetId) {
  const out = { meta: {}, months: {}, tx: {} };
  for (const row of q('SELECT coll, id, body FROM docs WHERE budget_id = ?').all(budgetId)) out[row.coll][row.id] = JSON.parse(row.body);
  return out;
}
function checkDocPath(coll, id) {
  if (!COLLS.includes(coll) || !DOC_ID.test(id)) fail(400, 'Unknown document.');
}
function writeDoc(who, coll, id, body, op) {
  checkDocPath(coll, id);
  if (!isObj(body)) fail(400, 'Send an object.', 'invalid_argument');
  const doc = tx(() => {
    const row = q('SELECT body FROM docs WHERE budget_id = ? AND coll = ? AND id = ?').get(who.budgetId, coll, id);
    const before = row ? JSON.parse(row.body) : null;
    const next = op === 'patch' ? stripNulls(deepMerge(before, body)) : stripNulls(body);
    const now = Date.now();
    q('INSERT INTO docs VALUES (?, ?, ?, ?, ?) ON CONFLICT (budget_id, coll, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
      .run(who.budgetId, coll, id, JSON.stringify(next), now);
    // a patch can be replayed from the one before it; a replace keeps what it replaced
    q('INSERT INTO changes (budget_id, coll, id, op, body, before, user_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(who.budgetId, coll, id, op, JSON.stringify(body), op === 'put' && row ? row.body : null, who.user.id, now);
    return next;
  });
  broadcast(who.budgetId, { coll, id, doc });
}
// Swap the whole budget at once: a safety copy of what's there first, then every document in one transaction,
// so a dropped connection can't leave half a budget. Open pages get the new budget as a fresh snapshot.
const SAFETY_KEEP = 10;
function replaceBudget(who, body) {
  const docs = body && body.docs;
  if (!isObj(docs)) fail(400, 'Send the whole budget.', 'invalid_argument');
  for (const coll in docs) {
    if (!isObj(docs[coll])) fail(400, 'Unknown document.');
    for (const id in docs[coll]) { checkDocPath(coll, id); if (!isObj(docs[coll][id])) fail(400, 'Send an object.', 'invalid_argument'); }
  }
  return replaceDocs(who.budgetId, who.user.id, docs, String(body.why || 'replace').slice(0, 40));
}
function replaceDocs(budgetId, userId, docs, why) {
  const ts = tx(() => {
    const now = Date.now();
    const old = loadAll(budgetId);
    q('INSERT INTO safety_copies (budget_id, why, body, user_id, ts) VALUES (?, ?, ?, ?, ?)').run(budgetId, why, JSON.stringify(old), userId, now);
    q('DELETE FROM safety_copies WHERE budget_id = ? AND seq NOT IN (SELECT seq FROM safety_copies WHERE budget_id = ? ORDER BY seq DESC LIMIT ?)').run(budgetId, budgetId, SAFETY_KEEP);
    for (const coll in docs) for (const id in docs[coll]) {
      const row = q('SELECT body FROM docs WHERE budget_id = ? AND coll = ? AND id = ?').get(budgetId, coll, id);
      const next = JSON.stringify(stripNulls(docs[coll][id]));
      q('INSERT INTO docs VALUES (?, ?, ?, ?, ?) ON CONFLICT (budget_id, coll, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
        .run(budgetId, coll, id, next, now);
      q('INSERT INTO changes (budget_id, coll, id, op, body, before, user_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(budgetId, coll, id, 'put', next, row ? row.body : null, userId, now);
    }
    return now;
  });
  const set = streams.get(budgetId);
  if (set) { const line = 'event: snapshot\ndata: ' + JSON.stringify(loadAll(budgetId)) + '\n\n'; for (const r of set) r.write(line); }
  return { ok: true, safety: { ts, why } };
}

// ---------- put the budget back to an earlier time ----------
// Every write is in `changes`, so replaying them in order up to a moment rebuilds the budget as it was then.
// The replay is only trusted when replaying everything gives exactly today's budget: proof the history is complete.
const canon = (v) => JSON.stringify(v, (k, x) => (isObj(x) ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x));
function replayTo(budgetId, until) {
  const out = { meta: {}, months: {}, tx: {} };
  for (const c of q('SELECT coll, id, op, body FROM changes WHERE budget_id = ? AND ts <= ? ORDER BY seq').all(budgetId, until)) {
    if (!out[c.coll]) continue;
    const body = JSON.parse(c.body);
    out[c.coll][c.id] = c.op === 'patch' ? stripNulls(deepMerge(out[c.coll][c.id], body)) : stripNulls(body);
  }
  return out;
}
const EMPTY_DOC = (coll, id) => (coll === 'tx' ? { t: {} } : coll === 'months' ? { assigned: {}, moves: {} } : id === 'settings' ? {} : { items: {} });
function budgetAt(budgetId, ts) {
  const now = loadAll(budgetId), full = replayTo(budgetId, Date.now() + 1);
  let gaps = 0;
  for (const coll of COLLS) for (const id of new Set(Object.keys(now[coll]).concat(Object.keys(full[coll])))) if (canon(now[coll][id]) !== canon(full[coll][id])) gaps++;
  if (gaps) fail(409, `The change history doesn't fully explain the budget as it is now (${gaps} records differ), so it can't be put back safely. Use a backup instead.`);
  const then = replayTo(budgetId, ts);
  // records made since then are emptied rather than deleted, the same as a restore
  for (const coll of COLLS) for (const id in now[coll]) if (!then[coll][id]) then[coll][id] = EMPTY_DOC(coll, id);
  return { now, then };
}
// a few plain numbers to compare: what the admin checks before putting it back
function budgetSummary(d) {
  const tx = [];
  for (const m in d.tx) for (const t of Object.values((d.tx[m] || {}).t || {})) if (t) tx.push(t);
  const live = (doc) => Object.values((doc && doc.items) || {}).filter((x) => x && !x.deleted);
  return { transactions: tx.length, total: tx.reduce((n, t) => n + (t.amt || 0), 0), accounts: live(d.meta.accounts).length, categories: live(d.meta.cats).length };
}
function rewindPreview(budgetId, ts) {
  const { now, then } = budgetAt(budgetId, ts);
  const since = q('SELECT c.user_id, u.name, COUNT(*) n, MIN(c.ts) first, MAX(c.ts) last FROM changes c LEFT JOIN users u ON u.id = c.user_id WHERE c.budget_id = ? AND c.ts > ? GROUP BY c.user_id').all(budgetId, ts);
  return { ts, then: budgetSummary(then), now: budgetSummary(now), since: since.map((r) => ({ name: r.name || 'someone', changes: r.n, first: r.first, last: r.last })) };
}
const lastSafety = (budgetId) => q('SELECT seq, ts, why FROM safety_copies WHERE budget_id = ? ORDER BY seq DESC LIMIT 1').get(budgetId) || null;
// the newest safety copy as an ordinary backup file, so Restore from backup can put it back
function safetyFile(res, who) {
  const row = q('SELECT * FROM safety_copies WHERE budget_id = ? ORDER BY seq DESC LIMIT 1').get(who.budgetId);
  if (!row) fail(404, 'There is no safety copy yet.');
  send(res, 200, { app: 'zero-line', version: 1, exportedAt: new Date(row.ts).toISOString(), safetyCopy: row.why, data: JSON.parse(row.body) });
}
function openStream(req, res, who) {
  res.writeHead(200, Object.assign({}, SECURITY_HEADERS, {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no',
  }));
  res.userId = who.user.id;
  res.sessionId = who.session.id;
  res.write('retry: 3000\nevent: snapshot\ndata: ' + JSON.stringify(loadAll(who.budgetId)) + '\n\n');
  if (!streams.has(who.budgetId)) streams.set(who.budgetId, new Set());
  streams.get(who.budgetId).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
  const done = () => { clearInterval(ping); const set = streams.get(who.budgetId); if (set) set.delete(res); };
  req.on('close', done);
  res.on('close', done);
}
function people(budgetId) {
  const out = {};
  for (const u of q('SELECT id, name FROM users WHERE budget_id = ? OR admin = 1').all(budgetId)) out[u.id] = { name: u.name };
  return out;
}
function meInfo(who) {
  const b = q('SELECT id, name FROM budgets WHERE id = ?').get(who.budgetId) || null;
  const sc = lastSafety(who.budgetId);
  return { id: who.user.id, name: who.user.name, username: who.user.username, admin: !!who.user.admin, budget: b, version: VERSION, safety: sc && { ts: sc.ts, why: sc.why } };
}

// ---------- receipts ----------
async function uploadBlob(req, res, who, url) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!BLOB_TYPES.includes(type)) fail(415, 'Use a photo (JPEG, PNG) or a PDF.', 'unsupported_type');
  const data = await readBody(req, MAX_BLOB);
  if (!data.length) fail(400, 'That file is empty.');
  // the admin can keep a receipt's old id when moving receipts across from claude.ai
  let id = url.searchParams.get('id');
  if (id && (!who.user.admin || !BLOB_ID.test(id) || q('SELECT 1 FROM blobs WHERE id = ?').get(id))) fail(400, 'That receipt id cannot be used.');
  id = id || newId();
  fs.writeFileSync(path.join(BLOB_DIR, id), data, { flag: 'wx' });
  q('INSERT INTO blobs VALUES (?, ?, ?, ?, ?, ?)').run(id, who.budgetId, type, data.length, who.user.id, Date.now());
  send(res, 200, { id });
}
function serveBlob(res, who, id) {
  const b = BLOB_ID.test(id) && q('SELECT * FROM blobs WHERE id = ? AND budget_id = ?').get(id, who.budgetId);
  if (!b) fail(404, 'Not found.');
  res.writeHead(200, Object.assign({}, SECURITY_HEADERS, {
    'Content-Type': b.type, 'Content-Length': b.size, 'Cache-Control': 'private, max-age=31536000, immutable',
    // receipts may be shown inside YNABB's own viewer (a PDF in a frame), never inside anyone else's page.
    // Chrome won't draw a sandboxed PDF, and only photos and PDFs are accepted, so only PDFs drop the sandbox.
    'Content-Security-Policy': `${b.type === 'application/pdf' ? '' : 'sandbox; '}default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'`,
    'X-Frame-Options': 'SAMEORIGIN', 'Content-Disposition': 'inline',
  }));
  fs.createReadStream(path.join(BLOB_DIR, b.id)).pipe(res);
}

// ---------- the admin's tools ----------
function needAdmin(who) { if (!who.user.admin) fail(403, 'Only the admin can do that.'); }
// written by deploy/auto-deploy.ps1 on the A6 after each update
function deployStatus() {
  try { return JSON.parse(fs.readFileSync(path.join(ENV.BACKUP_DIR || '', 'deploy-status.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}
function adminOverview(res) {
  send(res, 200, {
    budgets: q('SELECT b.id, b.name, b.created_at, (SELECT COUNT(*) FROM docs d WHERE d.budget_id = b.id) docs, (SELECT MAX(ts) FROM changes c WHERE c.budget_id = b.id) last_change FROM budgets b ORDER BY b.created_at').all(),
    users: q(`SELECT u.id, u.username, u.name, u.admin, u.budget_id, u.disabled, u.created_at,
      (SELECT MAX(ts) FROM signins s WHERE s.user_id = u.id AND s.ok = 1) last_signin FROM users u ORDER BY u.created_at`).all()
      .map((u) => Object.assign(u, { locked_until: lockedUntil(u.username) })),
    signins: q('SELECT ts, username, ip, agent, ok, note FROM signins ORDER BY seq DESC LIMIT 60').all(),
    backups: backups.status(),
    deploy: deployStatus(),
    version: VERSION,
    started: STARTED,
  });
}
async function adminAction(req, res, who, parts) {
  needAdmin(who);
  const body = req.method === 'GET' ? null : (await readJson(req)) || {};
  const [what, id, extra] = parts;
  const budgetOk = (bid) => q('SELECT 1 FROM budgets WHERE id = ?').get(bid) || fail(400, 'Choose a budget.');
  if (what === 'overview' && req.method === 'GET') return adminOverview(res);
  if (what === 'budgets' && !id && req.method === 'POST') {
    const name = String(body.name || '').trim().slice(0, 60) || fail(400, 'Give the budget a name.');
    const bid = newId();
    q('INSERT INTO budgets VALUES (?, ?, ?)').run(bid, name, Date.now());
    return send(res, 200, { id: bid });
  }
  if (what === 'budgets' && id && req.method === 'PATCH') {
    budgetOk(id);
    const name = String(body.name || '').trim().slice(0, 60) || fail(400, 'Give the budget a name.');
    q('UPDATE budgets SET name = ? WHERE id = ?').run(name, id);
    return send(res, 200, { ok: true });
  }
  // put a budget back to how it was at a time: GET shows what would change, POST does it (keeping a safety copy first)
  if (what === 'budgets' && id && extra === 'rewind') {
    budgetOk(id);
    const ts = Number(req.method === 'GET' ? new URL(req.url, 'http://x').searchParams.get('ts') : body.ts);
    if (!Number.isFinite(ts) || ts <= 0 || ts > Date.now()) fail(400, 'Choose a time in the past.');
    if (req.method === 'GET') return send(res, 200, rewindPreview(id, ts));
    if (req.method === 'POST') return send(res, 200, replaceDocs(id, who.user.id, budgetAt(id, ts).then, 'put back'));
  }
  if (what === 'backup-now' && req.method === 'POST') {
    try { await backups.run(body.kind === 'drill' ? 'drill' : 'backup'); } catch (e) { fail(400, e.message); }
    return send(res, 200, backups.status());
  }
  if (what === 'switch' && req.method === 'POST') {
    budgetOk(body.budget_id);
    q('UPDATE sessions SET budget_id = ? WHERE id = ?').run(body.budget_id, who.session.id);
    return send(res, 200, { ok: true });
  }
  if (what === 'users' && !id && req.method === 'POST') {
    const username = String(body.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(username)) fail(400, 'Usernames are 2 to 40 letters, numbers, dots or dashes.');
    if (q('SELECT 1 FROM users WHERE username = ?').get(username)) fail(400, 'That username is taken.');
    const name = String(body.name || '').trim().slice(0, 60) || fail(400, 'Add their name.');
    budgetOk(body.budget_id);
    const pw = newPassword();
    q('INSERT INTO users (id, username, name, pass, admin, budget_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), username, name, await hashPassword(pw), body.admin ? 1 : 0, body.budget_id, Date.now());
    return send(res, 200, { username, password: pw });
  }
  const user = id && q('SELECT * FROM users WHERE id = ?').get(id);
  if (what === 'users' && user && extra === 'reset' && req.method === 'POST') {
    const pw = newPassword();
    q('UPDATE users SET pass = ? WHERE id = ?').run(await hashPassword(pw), id);
    unlockLogin(user.username);
    // the admin resetting their own password keeps this device signed in, like changing it themselves
    endSessionsFor(id, id === who.user.id ? who.session.id : undefined);
    return send(res, 200, { password: pw });
  }
  if (what === 'users' && user && !extra && req.method === 'PATCH') {
    // the admin can't lock themselves out
    if (id === who.user.id && (body.disabled || body.admin === false)) fail(400, "You can't turn off your own admin login.");
    if ('budget_id' in body) budgetOk(body.budget_id);
    const next = {
      name: 'name' in body ? String(body.name || '').trim().slice(0, 60) || user.name : user.name,
      budget_id: 'budget_id' in body ? body.budget_id : user.budget_id,
      admin: 'admin' in body ? (body.admin ? 1 : 0) : user.admin,
      disabled: 'disabled' in body ? (body.disabled ? 1 : 0) : user.disabled,
    };
    if (body.unlock) unlockLogin(user.username);
    q('UPDATE users SET name = ?, budget_id = ?, admin = ?, disabled = ?, locked_until = 0 WHERE id = ?')
      .run(next.name, next.budget_id, next.admin, next.disabled, id);
    if (next.disabled || next.budget_id !== user.budget_id || next.admin !== user.admin) endSessionsFor(id);
    return send(res, 200, { ok: true });
  }
  fail(404, 'Not found.');
}

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveFile(req, res, dir, rel) {
  const file = path.join(dir, path.normalize('/' + rel).slice(1));
  if (!file.startsWith(dir + path.sep)) fail(404, 'Not found.');
  let st;
  try { st = fs.statSync(file); } catch (e) { fail(404, 'Not found.'); }
  if (!st.isFile()) fail(404, 'Not found.');
  const etag = '"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
  // always check for a newer copy, so a deploy shows up on the next reload
  const headers = Object.assign({}, SECURITY_HEADERS, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag });
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
  res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
const redirect = (res, to) => { res.writeHead(303, Object.assign({}, SECURITY_HEADERS, { Location: to, 'Cache-Control': 'no-store' })); res.end(); };

// ---------- routing ----------
// Changes must come from our own pages: a custom header can't be sent cross-site without permission we never give.
function checkSameSite(req) {
  if (req.headers['x-requested-with'] !== 'ynabb') fail(403, 'Blocked.');
  const origin = req.headers.origin;
  if (!origin) return;
  // behind Tailscale the public name can arrive as X-Forwarded-Host
  const hosts = [req.headers.host].concat(TRUST_PROXY ? String(req.headers['x-forwarded-host'] || '').split(',').map((h) => h.trim()) : []);
  let host = '';
  try { host = new URL(origin).host; } catch (e) { /* not a URL: blocked below */ }
  if (!hosts.includes(host)) fail(403, 'Blocked.');
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  let p;
  // a garbled web address (like a stray %) is simply not found, not a server error
  try { p = decodeURIComponent(url.pathname); } catch (e) { fail(404, 'Not found.'); }
  const m = req.method;
  if (p === '/api/health') return send(res, 200, { ok: true, version: VERSION });
  if (m !== 'GET' && m !== 'HEAD') checkSameSite(req);

  if (p === '/login' || p === '/login.html') return whoIs(req) ? redirect(res, '/') : serveFile(req, res, PUBLIC_DIR, 'login.html');
  if (p === '/api/login' && m === 'POST') return login(req, res);
  // the home-screen app's manifest and icons: phones fetch them before anyone signs in
  if (/^\/(login\.js|account\.js|server\.css|manifest\.webmanifest|apple-touch-icon\.png|icon-(192|512|maskable-512)\.png)$/.test(p)) return serveFile(req, res, PUBLIC_DIR, p.slice(1));

  const who = whoIs(req);
  if (p === '/api/logout' && m === 'POST') return logout(req, res, who);
  if (!who) {
    if (p.startsWith('/api/') || p.startsWith('/_blob/')) fail(401, 'Signed out.', 'revoked');
    return redirect(res, '/login');
  }

  if (p === '/api/me') return send(res, 200, meInfo(who));
  if (p === '/api/people') return send(res, 200, people(who.budgetId));
  if (p === '/api/data' && m === 'GET') return send(res, 200, loadAll(who.budgetId));
  if (p === '/api/events' && m === 'GET') return openStream(req, res, who);
  if (p === '/api/password' && m === 'POST') return changePassword(req, res, who);
  if (p === '/api/blob' && m === 'POST') return uploadBlob(req, res, who, url);
  if (p.startsWith('/_blob/') && m === 'GET') return serveBlob(res, who, p.slice(7));
  if (p === '/api/budget' && m === 'PUT') return send(res, 200, replaceBudget(who, await readJson(req)));
  if (p === '/api/safety-copy' && m === 'GET') return safetyFile(res, who);
  const doc = p.match(/^\/api\/doc\/([^/]+)\/([^/]+)$/);
  if (doc && (m === 'PATCH' || m === 'PUT')) {
    writeDoc(who, doc[1], doc[2], await readJson(req), m === 'PATCH' ? 'patch' : 'put');
    return send(res, 200, { ok: true });
  }
  if (p.startsWith('/api/admin/')) return adminAction(req, res, who, p.slice(11).split('/'));
  if (p.startsWith('/api/')) fail(404, 'Not found.');
  if (p === '/account') return serveFile(req, res, PUBLIC_DIR, 'account.html');
  if (m === 'GET' || m === 'HEAD') return serveFile(req, res, APP_DIR, p === '/' ? 'index.html' : p.slice(1));
  fail(405, 'Not allowed.');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!(e instanceof HttpError)) console.error(new Date().toISOString(), req.method, req.url, e);
    if (res.headersSent) return res.end();
    const status = e instanceof HttpError ? e.status : 500;
    // a mistyped page address gets a plain "not found" page; the API keeps answering in JSON
    if (status === 404 && !/^\/(api|_blob)\//.test(req.url)) return send(res, 404, 'Not found. Check the address, or go back to YNABB at /');
    send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message, code: e.code || null });
  });
});
server.requestTimeout = 120e3;

// ---------- command line ----------
// node server/server.js add-admin <username> <name>     make a super admin (prints a generated password)
// node server/server.js reset-password <username>       the rare day you need SSH
// node server/server.js backup-now                      a backup before an update (deploy/auto-deploy.ps1 runs it)
async function cli(args) {
  const [cmd, username, ...rest] = args;
  if (cmd === 'add-admin' && username) {
    const pw = newPassword();
    if (q('SELECT 1 FROM users').get()) {
      const bid = q('SELECT id FROM budgets ORDER BY created_at LIMIT 1').get().id;
      q('INSERT INTO users (id, username, name, pass, admin, budget_id, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(newId(), username.toLowerCase(), rest.join(' ') || username, await hashPassword(pw), bid, Date.now());
    } else await createAdmin(username.toLowerCase(), rest.join(' ') || username, pw);
    console.log(`Super admin "${username}" created. Password: ${pw}`);
  } else if (cmd === 'reset-password' && username) {
    const pw = newPassword();
    const r = q('UPDATE users SET pass = ?, fails = 0, locked_until = 0, disabled = 0 WHERE username = ?').run(await hashPassword(pw), username);
    if (!r.changes) { console.error('No such user.'); process.exit(1); }
    q('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
    // wrong-password locks live in the running server's memory; restarting it clears them
    console.log(`New password for "${username}": ${pw}`);
  } else if (cmd === 'backup-now') {
    // exits non-zero with the reason, so auto-deploy stops instead of updating without a backup
    try { await backups.run('deploy'); } catch (e) { console.error('Backup failed: ' + e.message); process.exit(1); }
  } else {
    console.error('Usage: server.js [add-admin <username> <name> | reset-password <username> | backup-now]');
    process.exit(1);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length) cli(args).then(() => process.exit(0));
  else bootstrap().then(() => server.listen(PORT, HOST, () => {
    console.log(`YNABB ${VERSION} on http://${HOST}:${PORT} (data in ${DATA_DIR})`);
    backups.start();
    sweep(); // clear sessions that expired while the server was off
    setInterval(sweep, SWEEP_EVERY).unref();
  }));
}
module.exports = { server, bootstrap, db, ipFails, loginFails, sweep, backups };
