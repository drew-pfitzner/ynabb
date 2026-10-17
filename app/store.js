/* Zero Line storage. One interface, three backends:
   - server: YNABB's own server (server/server.js): logins, live sync between devices and people
   - cloud: the claude.ai artifact database (while the app still runs there)
   - local: this browser only (opened from plain files, e.g. python3 -m http.server)

   Layout (collections → documents):
     meta/cats      {items: {catId: cat}}
     meta/accounts  {items: {acctId: account}}
     meta/rules     {items: {key: {payee, cat}}}
     meta/settings  {currency, ...}
     months/<YYYY-MM> {assigned: {catId: cents}, moves: {id: move}}
     tx/<YYYY-MM>     {t: {txId: tx}}
   Deleted map entries are written as null. */
(function (root) {
  'use strict';
  const COLLS = ['meta', 'months', 'tx'];
  const LOCAL_KEY = 'zeroline-local-v1';

  const Store = {
    mode: 'loading', // 'server' | 'cloud' | 'local'
    data: { meta: {}, months: {}, tx: {} },
    loaded: { meta: false, months: false, tx: false },
    status: 'idle', // 'idle' | 'saving' | 'error'
    error: null,
    db: null,
    assets: null,
    downloads: null,
    user: null,
    me: null,
    canWrite: true,
    _listeners: [],
    _queue: {},
    _exists: {},
  };

  Store.onChange = (fn) => Store._listeners.push(fn);
  const emit = (why) => Store._listeners.forEach((fn) => fn(why));

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function deepMerge(target, patch) {
    const out = isObj(target) ? Object.assign({}, target) : {};
    for (const k in patch) {
      const v = patch[k];
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : (isObj(v) ? deepMerge({}, v) : v);
    }
    return out;
  }
  Store.deepMerge = deepMerge;
  function stripNulls(o) {
    if (!isObj(o)) return o;
    const out = {};
    for (const k in o) if (o[k] !== null && o[k] !== undefined) out[k] = isObj(o[k]) ? stripNulls(o[k]) : o[k];
    return out;
  }

  // ---------- init ----------
  Store.init = async function () {
    let db = null;
    try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
    if (!db) {
      const me = await serverMe();
      if (me === 'signed-out') { location.href = '/login'; return; }
      return me ? initServer(me) : initLocal();
    }
    Store.db = db;
    Store.mode = 'cloud';
    try { Store.user = await window.claude.use('user'); } catch (e) { Store.user = null; }
    if (Store.user) {
      try { Store.me = await Store.user.me(); } catch (e) { /* stays null */ }
      try { const w = await Store.user.can('data.write'); if (w === false) Store.canWrite = false; } catch (e) { /* keep */ }
    }
    window.claude.use('assets').then((a) => { Store.assets = a; emit('caps'); }).catch(() => {});
    window.claude.use('downloads').then((d) => { Store.downloads = d; emit('caps'); }).catch(() => {});
    for (const c of COLLS) {
      db.collection(c).onSnapshot((snap) => {
        const next = {};
        for (const d of snap.docs) { next[d.id] = d.data(); Store._exists[c + '/' + d.id] = true; }
        // keep local edits that haven't reached the server yet
        for (const path in Store._queue) {
          const q = Store._queue[path];
          if (!path.startsWith(c + '/')) continue;
          const id = path.slice(c.length + 1);
          if (q.inflight) next[id] = deepMerge(next[id], q.inflight);
          if (q.patch) next[id] = deepMerge(next[id], q.patch);
        }
        Store.data[c] = next;
        Store.loaded[c] = true;
        emit('remote');
      }, (err) => {
        Store.status = 'error';
        Store.error = err && err.code === 'revoked' ? 'Access to this budget changed. Reload to continue.' : 'Lost the connection to your budget. Reload to reconnect.';
        emit('error');
      });
    }
    emit('mode');
  };

  // ---------- YNABB server ----------
  const LOST = 'Lost the connection to YNABB. Trying again…';
  async function api(method, url, body, headers) {
    let r;
    try {
      r = await fetch(url, {
        method, credentials: 'same-origin',
        headers: Object.assign({ 'X-Requested-With': 'ynabb' }, body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}, headers),
        body: body === undefined || body instanceof Blob ? body : JSON.stringify(body),
      });
    } catch (e) { throw { code: 'unavailable' }; }
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const code = r.status === 401 ? 'revoked' : r.status === 413 ? (url === '/api/blob' ? 'too_large' : 'invalid_argument')
      : r.status === 429 ? 'resource_exhausted' : r.status >= 500 ? 'unavailable' : (j.code || 'failed');
    throw { code, message: j.error };
  }
  // the signed-in person, 'signed-out', or null when there's no YNABB server (plain files)
  async function serverMe() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (r.status === 401) return 'signed-out';
      if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  // a document as the server has it, with this browser's unsent edits on top
  function withQueued(coll, id, doc) {
    const q = Store._queue[coll + '/' + id];
    if (q && q.inflight) doc = deepMerge(doc, q.inflight);
    if (q && q.patch) doc = deepMerge(doc, q.patch);
    return doc;
  }
  // Edits not yet saved are also kept in this browser, so a weak signal, a reload or a sign-out doesn't lose them.
  let unsentKey = null;
  function saveUnsent() {
    if (!unsentKey) return;
    const out = {};
    for (const path in Store._queue) {
      const q = Store._queue[path];
      const p = q.inflight && q.patch ? deepMerge(q.inflight, q.patch) : q.inflight || q.patch;
      if (p) out[path] = p;
    }
    try { if (Object.keys(out).length) localStorage.setItem(unsentKey, JSON.stringify(out)); else localStorage.removeItem(unsentKey); } catch (e) { /* storage blocked */ }
  }
  // a reconnect or the device coming back online retries straight away instead of waiting out the pause
  let wakers = [];
  const wakeRetries = () => { const w = wakers; wakers = []; w.forEach((f) => f()); };
  const pause = (ms) => new Promise((r) => { const t = setTimeout(done, ms); function done() { clearTimeout(t); wakers = wakers.filter((f) => f !== done); r(); } wakers.push(done); });
  if (typeof window !== 'undefined') window.addEventListener('online', wakeRetries);

  function initServer(me) {
    Store.mode = 'server';
    Store.account = me;
    Store.me = { id: me.id, name: me.name };
    unsentKey = 'ynabb-unsent-v1:' + me.id;
    // edits left over from last time (page closed or signed out before they saved) are sent again
    try {
      const left = JSON.parse(localStorage.getItem(unsentKey) || 'null');
      for (const path in left || {}) {
        const cut = path.indexOf('/'), coll = path.slice(0, cut), id = path.slice(cut + 1);
        if (!COLLS.includes(coll) || !isObj(left[path])) continue;
        const q = Store._queue[path] = { patch: left[path], busy: null };
        q.busy = flush(coll, id, q).catch(() => {});
      }
    } catch (e) { /* nothing usable saved */ }
    let people = null;
    Store.user = {
      me: async () => Store.me,
      can: async () => true,
      profiles: async (ids) => {
        people = people || api('GET', '/api/people').catch(() => ({}));
        const all = await people, out = {};
        for (const id of ids) if (all[id]) out[id] = { name: all[id].name, isMe: id === Store.me.id };
        return out;
      },
    };
    Store.assets = { upload: (blob, opts) => api('POST', '/api/blob', blob, { 'Content-Type': (opts && opts.type) || blob.type }) };
    Store.downloads = {
      save: async ({ filename, data }) => {
        const url = URL.createObjectURL(new Blob([data], { type: /\.json$/.test(filename) ? 'application/json' : 'text/csv' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
    };
    const es = new EventSource('/api/events');
    // the whole budget arrives first (and again after every reconnect), then each change as it happens
    es.addEventListener('snapshot', (e) => {
      const all = JSON.parse(e.data);
      for (const c of COLLS) {
        const next = {};
        for (const id in all[c] || {}) next[id] = all[c][id];
        for (const path in Store._queue) if (path.startsWith(c + '/')) { const id = path.slice(c.length + 1); next[id] = withQueued(c, id, next[id]); }
        Store.data[c] = next;
        Store.loaded[c] = true;
      }
      if (Store.error === LOST) { Store.status = 'idle'; Store.error = null; }
      wakeRetries();
      emit('remote');
    });
    es.addEventListener('doc', (e) => {
      const { coll, id, doc } = JSON.parse(e.data);
      if (!Store.data[coll]) return;
      Store.data[coll][id] = withQueued(coll, id, doc);
      emit('remote');
    });
    es.onerror = async () => {
      const still = await serverMe();
      if (still === 'signed-out') {
        es.close();
        Store.status = 'error'; Store.error = 'You have been signed out. Reload the page to sign in again.';
      } else { Store.status = 'error'; Store.error = LOST; }
      emit('error');
    };
    emit('caps');
    emit('mode');
  }

  function initLocal() {
    Store.mode = 'local';
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) Store.data = Object.assign({ meta: {}, months: {}, tx: {} }, JSON.parse(raw));
    } catch (e) { /* storage blocked: run in memory */ }
    COLLS.forEach((c) => (Store.loaded[c] = true));
    emit('mode');
  }
  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(Store.data)); } catch (e) { /* in-memory only */ }
  }

  Store.ready = () => COLLS.every((c) => Store.loaded[c]);

  // ---------- undo / redo ----------
  // Every write records how to reverse itself. Writes caused by one click, edit or key press form one step.
  Store.undoStack = [];
  Store.redoStack = [];
  let group = null, capture = null;
  Store.newStep = () => { group = null; };
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  function inverseOf(old, patch) {
    const inv = {};
    for (const k in patch) {
      const pv = patch[k], ov = isObj(old) ? old[k] : undefined;
      inv[k] = isObj(pv) && isObj(ov) ? inverseOf(ov, pv) : clone(ov);
    }
    return inv;
  }
  function remember(coll, id, patch) {
    const step = { coll, id, patch: inverseOf(Store.data[coll][id], patch) };
    if (capture) { capture.push(step); return; }
    if (!group) {
      group = [];
      Store.undoStack.push(group);
      if (Store.undoStack.length > 100) Store.undoStack.shift();
    }
    Store.redoStack = [];
    group.push(step);
  }
  function replay(from, to) {
    const g = from.pop();
    if (!g) return null;
    capture = [];
    for (const w of g.slice().reverse()) Store.write(w.coll, w.id, w.patch);
    to.push(capture);
    capture = null;
    group = null;
    return g;
  }
  Store.undo = () => replay(Store.undoStack, Store.redoStack);
  Store.redo = () => replay(Store.redoStack, Store.undoStack);

  // ---------- writes ----------
  // patch merges into the document; nested objects merge, null removes an entry.
  Store.write = function (coll, id, patch) {
    remember(coll, id, patch);
    Store.data[coll][id] = deepMerge(Store.data[coll][id], patch); // optimistic
    if (Store.mode === 'local') { saveLocal(); emit('local'); return Promise.resolve(); }
    emit('local');
    const path = coll + '/' + id;
    const q = Store._queue[path] = Store._queue[path] || { patch: null, busy: null };
    q.patch = q.patch ? deepMerge(q.patch, patch) : patch;
    saveUnsent();
    if (!q.busy) q.busy = flush(coll, id, q);
    return q.busy;
  };

  async function flush(coll, id, q) {
    const path = coll + '/' + id;
    Store.status = 'saving'; emit('status');
    while (q.patch) {
      const p = q.patch; q.patch = null; q.inflight = p;
      for (let tries = 0; ; tries++) {
        try {
          await writeOne(coll, id, p);
          q.inflight = null;
          saveUnsent();
          break;
        } catch (e) {
          // No connection: keep the change and keep trying, slower each time (up to 30s), until it saves.
          // It stays on screen and in this browser meanwhile, and leaving the page still warns.
          if (e && e.code === 'unavailable') {
            if (tries >= 1) { Store.status = 'error'; Store.error = Store.mode === 'server' ? LOST : errorText(e); emit('status'); }
            await pause(Math.min(30000, 800 * 2 ** tries) * (1 + Math.random() / 2));
            continue;
          }
          // The server turned it down. A sign-out keeps it in this browser for after signing back in; anything else would fail again.
          Store.status = 'error';
          Store.error = errorText(e);
          if (e && e.code === 'revoked') { q.patch = q.patch ? deepMerge(p, q.patch) : p; q.inflight = null; }
          else { q.inflight = null; saveUnsent(); }
          q.busy = null;
          emit('status');
          throw e;
        }
      }
    }
    q.busy = null; q.inflight = null;
    if (!Object.values(Store._queue).some((x) => x.busy)) { Store.status = 'idle'; if (Store.error === LOST) Store.error = null; }
    emit('status');
  }

  async function writeOne(coll, id, patch) {
    if (Store.mode === 'server') return api('PATCH', '/api/doc/' + coll + '/' + encodeURIComponent(id), patch);
    const ref = Store.db.collection(coll).doc(id);
    const key = coll + '/' + id;
    if (!Store._exists[key]) {
      const snap = await ref.get();
      if (snap.exists) Store._exists[key] = true;
      else { await ref.set(stripNulls(patch)); Store._exists[key] = true; return; }
    }
    await ref.update(patch);
  }

  function errorText(e) {
    const c = e && e.code;
    if (c === 'invalid_argument') return Store.canWrite ? 'A change could not be saved. If this keeps happening, this month may have too many transactions for one record.' : 'You have view-only access, so changes are not saved.';
    if (c === 'quota_exceeded') return 'The budget database is full. Export a backup and remove old data.';
    if (c === 'resource_exhausted') return 'Saving too quickly. Wait a moment and try again.';
    if (c === 'revoked') return Store.mode === 'server' ? 'You have been signed out. Reload the page to sign in again.' : 'Access to this budget changed. Reload to continue.';
    return 'A change could not be saved. Check your connection and try again.';
  }

  // Replace the whole budget (restore, start fresh, move from YNAB). On YNABB's server it goes in one request: the server
  // keeps a safety copy of what was there and swaps everything at once. Edits still waiting to save belong to the old budget.
  Store.replaceAll = async function (d, why, onStep) {
    if (Store.mode === 'server') {
      const r = await api('PUT', '/api/budget', { why, docs: d });
      Store.undoStack = []; Store.redoStack = []; group = null;
      Store._queue = {}; saveUnsent();
      for (const c of COLLS) Store.data[c] = Object.assign({}, d[c]);
      if (Store.account && r.safety) Store.account.safety = r.safety;
      emit('local');
      return r;
    }
    let i = 0, n = 0;
    for (const c in d) n += Object.keys(d[c]).length;
    for (const c in d) for (const id in d[c]) { await Store.replace(c, id, d[c][id]); if (onStep) onStep(++i, n); }
  };

  // Put the budget back to how it was at a time (YNABB's server only). Without go, just what would change.
  // The new budget arrives as a fresh snapshot on the live connection, like a restore on another device.
  Store.rewind = async (ts, go) => {
    if (!go) return api('GET', '/api/rewind?ts=' + ts);
    const r = await api('POST', '/api/rewind', { ts });
    Store.undoStack = []; Store.redoStack = []; group = null;
    if (Store.account && r.safety) Store.account.safety = r.safety;
    return r;
  };

  // Replace a whole document.
  Store.replace = async function (coll, id, body) {
    Store.undoStack = []; Store.redoStack = []; group = null;
    Store.data[coll][id] = body;
    if (Store.mode === 'local') { saveLocal(); emit('local'); return; }
    emit('local');
    if (Store.mode === 'server') { await api('PUT', '/api/doc/' + coll + '/' + encodeURIComponent(id), body); return; }
    await Store.db.collection(coll).doc(id).set(stripNulls(body));
    Store._exists[coll + '/' + id] = true;
  };

  // ---------- reads ----------
  Store.items = (metaId) => {
    const doc = Store.data.meta[metaId];
    const out = {};
    if (doc && doc.items) for (const k in doc.items) if (doc.items[k]) out[k] = doc.items[k];
    return out;
  };
  Store.settings = () => Store.data.meta.settings || {};
  Store.allTx = () => {
    const out = [];
    for (const m in Store.data.tx) {
      const t = (Store.data.tx[m] || {}).t || {};
      for (const k in t) if (t[k]) out.push(t[k]);
    }
    return out;
  };
  Store.assignedByMonth = () => {
    const out = {};
    for (const m in Store.data.months) {
      const a = (Store.data.months[m] || {}).assigned || {};
      const row = {};
      for (const k in a) if (a[k]) row[k] = a[k];
      out[m] = row;
    }
    return out;
  };
  Store.moves = (m) => {
    const mv = ((Store.data.months[m] || {}).moves) || {};
    return Object.values(mv).filter(Boolean).sort((a, b) => b.ts - a.ts);
  };

  Store.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  root.Store = Store;
})(this);
