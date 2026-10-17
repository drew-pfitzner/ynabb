// Backup tests: run with `npm test`. Uses throwaway folders for the data, the A6 copies and "iCloud".
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sqlite = require('node:sqlite');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ynabb-backup-test-'));
const dirs = { data: path.join(root, 'data'), local: path.join(root, 'backups'), offsite: path.join(root, 'icloud') };
fs.mkdirSync(dirs.offsite, { recursive: true });
const KEY = crypto.randomBytes(32).toString('base64');
Object.assign(process.env, { DATA_DIR: dirs.data, BACKUP_DIR: dirs.local, OFFSITE_DIR: dirs.offsite, BACKUP_KEY: KEY, COOKIE_SECURE: '0', ADMIN_USERNAME: 'drew', ADMIN_PASSWORD: 'correct horse battery' });
const { bootstrap, db, backups } = require('../server.js');
const { decrypt, keyFrom } = require('../backup.js');
const key = keyFrom(KEY);
const daily = (d) => fs.readdirSync(path.join(d, 'daily')).filter((f) => /\.(ynabb|yabbbak)$/.test(f)).sort();

before(async () => {
  await bootstrap();
  const b = db.prepare('SELECT id FROM budgets').get().id;
  db.prepare('INSERT INTO docs VALUES (?, ?, ?, ?, ?)').run(b, 'tx', '2026-10', JSON.stringify({ t: { a: { payee: 'Woolworths Secret Payee', amt: -1234 } } }), Date.now());
  db.prepare('INSERT INTO docs VALUES (?, ?, ?, ?, ?)').run(b, 'meta', 'cats', JSON.stringify({ items: {} }), Date.now());
  fs.writeFileSync(path.join(dirs.data, 'blobs', 'r1'), Buffer.from('fake jpeg receipt bytes'));
  db.prepare('INSERT INTO blobs VALUES (?, ?, ?, ?, ?, ?)').run('r1', b, 'image/jpeg', 23, null, Date.now());
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('a backup lands on the A6 and in iCloud, encrypted', async () => {
  await backups.run('backup');
  const [name] = daily(dirs.local);
  assert.match(name, /^ynabb-\d{8}-\d{6}\.ynabb$/);
  assert.deepEqual(daily(dirs.offsite), [name]);
  const file = fs.readFileSync(path.join(dirs.local, 'daily', name));
  assert.ok(!file.includes('SQLite format'), 'not readable as a database');
  assert.ok(!file.includes('Woolworths'), 'no budget text visible');
  assert.ok(fs.readFileSync(path.join(dirs.offsite, 'daily', name)).equals(file));
  assert.equal(backups.status().backup.state, 'ok');
  assert.deepEqual(fs.readdirSync(dirs.data).filter((f) => f.includes('.tmp')), [], 'no temporary files left behind');
});

test('the backup opens to the real database with the key', () => {
  const [name] = daily(dirs.offsite);
  const out = path.join(root, 'restored.sqlite');
  fs.writeFileSync(out, zlib.gunzipSync(decrypt(key, fs.readFileSync(path.join(dirs.offsite, 'daily', name)))));
  const copy = new sqlite.DatabaseSync(out, { readOnly: true });
  const row = copy.prepare("SELECT body FROM docs WHERE coll = 'tx'").get();
  assert.match(row.body, /Woolworths Secret Payee/);
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  copy.close();
});

test('a wrong key cannot open a backup', () => {
  const [name] = daily(dirs.local);
  assert.throws(() => decrypt(crypto.randomBytes(32), fs.readFileSync(path.join(dirs.local, 'daily', name))));
});

test('receipts are copied once, encrypted, to both places', () => {
  for (const d of [dirs.local, dirs.offsite]) {
    const f = fs.readFileSync(path.join(d, 'blobs', 'r1.ynabb'));
    assert.ok(!f.includes('fake jpeg'));
    assert.equal(decrypt(key, f).toString(), 'fake jpeg receipt bytes');
  }
});

test('the restore check passes on a good backup', async () => {
  const r = await backups.run('drill');
  assert.equal(r.ok, 1, r.note);
  assert.match(r.note, /2 documents, 1 logins, 1 receipts/);
  assert.equal(backups.status().drill.state, 'ok');
});

test('old copies are rotated by count, and nothing else is touched', async () => {
  for (const d of [dirs.local, dirs.offsite]) {
    for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(d, 'daily', `ynabb-2020${String(Math.ceil(i / 28)).padStart(2, '0')}${String(i).padStart(2, '0')}-000000.ynabb`), 'old');
    fs.writeFileSync(path.join(d, 'daily', 'my-notes.txt'), 'keep me');
    fs.writeFileSync(path.join(d, 'daily', 'yabb-20190101-000000.yabbbak'), 'from before the rename');
  }
  await backups.run('backup');
  for (const d of [dirs.local, dirs.offsite]) {
    const left = daily(d);
    assert.equal(left.length, 14, d);
    assert.ok(left[left.length - 1].startsWith('ynabb-' + new Date().getFullYear()), 'newest kept');
    assert.ok(fs.existsSync(path.join(d, 'daily', 'my-notes.txt')));
    assert.ok(!fs.existsSync(path.join(d, 'daily', 'yabb-20190101-000000.yabbbak')), 'old-name copies rotate out too');
  }
});

test('if iCloud is missing, the backup still saves locally and says so', async () => {
  fs.renameSync(dirs.offsite, dirs.offsite + '-away');
  try {
    await new Promise((r) => setTimeout(r, 1100)); // a new file name needs a new second
    await backups.run('backup');
    const s = backups.status().backup;
    assert.equal(s.state, 'local-only');
    assert.match(s.note, /not copied to iCloud/);
  } finally { fs.renameSync(dirs.offsite + '-away', dirs.offsite); }
});

test('a damaged backup fails the restore check', async () => {
  const name = daily(dirs.local).pop();
  const f = path.join(dirs.local, 'daily', name);
  const good = fs.readFileSync(f);
  const bad = Buffer.from(good); bad[bad.length - 5] ^= 0xff;
  fs.writeFileSync(f, bad);
  try {
    await assert.rejects(backups.run('drill'));
    assert.equal(backups.status().drill.state, 'failed');
  } finally { fs.writeFileSync(f, good); }
});

test('the decrypt tool works on its own, on any computer', () => {
  const name = daily(dirs.local).pop();
  const out = path.join(root, 'cli.sqlite');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'backup.js'), 'decrypt', path.join(dirs.local, 'daily', name), out], { env: { BACKUP_KEY: KEY, PATH: process.env.PATH } });
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(fs.readFileSync(out).subarray(0, 15).toString(), 'SQLite format 3');
});

test('a box that missed 2am catches up on the next check', async () => {
  db.prepare("DELETE FROM backup_runs WHERE kind = 'backup'").run();
  await new Promise((r) => setTimeout(r, 1100));
  const before = daily(dirs.local).length;
  await backups.tick();
  assert.equal(backups.status().backup.state, 'ok');
  assert.ok(daily(dirs.local).length >= Math.min(before, 14));
  // and doesn't run again straight away
  const n = db.prepare("SELECT COUNT(*) n FROM backup_runs WHERE kind = 'backup'").get().n;
  await backups.tick();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM backup_runs WHERE kind = 'backup'").get().n, n);
});

// weekly and monthly copies: each test gets its own backup folder, with the same database
const Backups = require('../backup.js');
let n = 0;
const fresh = () => {
  const dir = path.join(root, 'tiers-' + ++n);
  return { dir, b: Backups.setup({ db, dataDir: dirs.data, blobDir: path.join(dirs.data, 'blobs'), env: { BACKUP_DIR: dir, BACKUP_KEY: KEY }, log: () => {} }) };
};
const daysAgo = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };
const nameOn = (d) => `ynabb-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-000000.ynabb`;
const seed = (dir, tier, names) => { fs.mkdirSync(path.join(dir, tier), { recursive: true }); for (const f of names) fs.writeFileSync(path.join(dir, tier, f), 'old'); };
const files = (dir, tier) => (fs.existsSync(path.join(dir, tier)) ? fs.readdirSync(path.join(dir, tier)).sort() : []);

test('the first backup also starts the weekly and monthly copies, whatever the day', async () => {
  const { dir, b } = fresh();
  await b.run('backup');
  for (const t of ['daily', 'weekly', 'monthly']) assert.equal(files(dir, t).length, 1, t);
});

test('a missed Sunday or 1st is caught up on the next run', async () => {
  const { dir, b } = fresh();
  const lastMonth = new Date(); lastMonth.setDate(0); // the last day of last month
  seed(dir, 'weekly', [nameOn(daysAgo(8))]);
  seed(dir, 'monthly', [nameOn(lastMonth)]);
  await b.run('backup');
  assert.equal(files(dir, 'weekly').length, 2);
  assert.equal(files(dir, 'monthly').length, 2);
});

test('no extra weekly or monthly copy when a recent one is there', async () => {
  const { dir, b } = fresh();
  seed(dir, 'weekly', [nameOn(daysAgo(6))]);
  seed(dir, 'monthly', [nameOn(new Date())]); // earlier today, so this month already has one
  await b.run('backup');
  assert.deepEqual(files(dir, 'weekly'), [nameOn(daysAgo(6))]);
  assert.deepEqual(files(dir, 'monthly'), [nameOn(new Date())]);
  assert.equal(files(dir, 'daily').length, 1);
});

test('exactly 7 days on counts as due, so the weekly copy stays on the same weekday', async () => {
  const { dir, b } = fresh();
  seed(dir, 'weekly', [nameOn(daysAgo(7))]);
  await b.run('backup');
  assert.equal(files(dir, 'weekly').length, 2);
});

test('weekly and monthly copies still rotate by count', async () => {
  const { dir, b } = fresh();
  seed(dir, 'weekly', Array.from({ length: 8 }, (_, i) => nameOn(daysAgo(70 - i * 7))));
  seed(dir, 'monthly', Array.from({ length: 12 }, (_, i) => `ynabb-2019${String(i + 1).padStart(2, '0')}01-000000.ynabb`));
  await b.run('backup');
  assert.equal(files(dir, 'weekly').length, 8);
  assert.ok(!files(dir, 'weekly').includes(nameOn(daysAgo(70))), 'oldest weekly went');
  assert.equal(files(dir, 'monthly').length, 12);
  assert.ok(!files(dir, 'monthly').includes('ynabb-20190101-000000.ynabb'), 'oldest monthly went');
});

test('a pre-deploy backup goes in its own folder and does not count as the nightly', async () => {
  const { dir, b } = fresh();
  const nightly = () => db.prepare("SELECT COUNT(*) n FROM backup_runs WHERE kind = 'backup'").get().n;
  const before = nightly();
  seed(dir, 'deploy', Array.from({ length: 12 }, (_, i) => `ynabb-2020${String(i + 1).padStart(2, '0')}01-000000.ynabb`));
  const r = await b.run('deploy');
  assert.equal(r.kind, 'deploy-backup');
  assert.equal(nightly(), before);
  assert.equal(files(dir, 'daily').length, 0);
  assert.equal(files(dir, 'weekly').length, 0);
  const kept = files(dir, 'deploy');
  assert.equal(kept.length, 10);
  assert.equal(zlib.gunzipSync(decrypt(key, fs.readFileSync(path.join(dir, 'deploy', kept.pop())))).subarray(0, 15).toString(), 'SQLite format 3');
});

test('the backup-now command backs up, or fails loudly with the reason', () => {
  const server = path.join(__dirname, '..', 'server.js');
  const dir = path.join(root, 'cli-backups');
  const env = { PATH: process.env.PATH, DATA_DIR: dirs.data, BACKUP_DIR: dir, BACKUP_KEY: KEY };
  const ok = spawnSync(process.execPath, [server, 'backup-now'], { env });
  assert.equal(ok.status, 0, String(ok.stderr));
  assert.equal(files(dir, 'deploy').length, 1);
  const bad = spawnSync(process.execPath, [server, 'backup-now'], { env: { ...env, BACKUP_KEY: '' } });
  assert.equal(bad.status, 1);
  assert.match(String(bad.stderr), /Backup failed: BACKUP_KEY must be/);
});
