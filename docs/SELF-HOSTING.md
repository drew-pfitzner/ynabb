# Self-hosting plan

> **Step 2 is built:** `server/server.js` (see `server/README.md`), and `store.js` has a `server` backend that uses it. The notes below are kept as the reasoning behind it.

## What ties YNABB to claude.ai today

Only `store.js` talks to the platform, through `window.claude.use(name)`:

| Capability | Used for | Used in | Without it |
|---|---|---|---|
| `db` | All budget data: three collections of JSON documents, live updates through `onSnapshot`, writes through `get`/`set`/`update` | `store.js` | Falls back to **local mode** (localStorage, one browser only) |
| `assets` | Receipt photos and PDFs: `assets.upload(blob)` gives an id, shown from `/_blob/<id>` | `app.js` (`S.assets`) | The "Add receipt" button is hidden |
| `downloads` | Saving backup JSON and CSV files | `app.js` `offerFile()` | Shows the text in a box to copy |
| `user` | `me()` (whose change it was, the `by` field) and `profiles(ids)` to show "Added by …"; `can('data.write')` | `store.js`, `app.js` | Names aren't shown |

Everything else is plain static files. Google Fonts load from fonts.googleapis.com; download and serve them locally if you want no outside calls.

## Step 1: run it as static files (works today)

Serve the `app/` folder from any web server: `python3 -m http.server`, nginx, Caddy, a NAS, GitHub Pages and so on. The app runs in local mode, saving to that browser only. Restore a backup from the live app to bring the real budget in. This is good enough for one person on one computer, but not for sharing with Drew or using on a phone.

## Step 2: add a small backend

Add a third backend to `store.js` (it was designed for this; see the comment at its top) and keep the rest of the app unchanged. The backend needs:

1. **Load everything:** `GET /api/data` returns `{meta: {...}, months: {...}, tx: {...}}`. The data is small: a whole year is a few MB at most.
2. **Patch a document:** `PATCH /api/doc/:coll/:id` with a JSON body applied as an RFC 7386 JSON Merge Patch. Nested objects merge, and `null` deletes a key. This is exactly what `Store.write` does locally (`deepMerge` plus `stripNulls`).
   - **Merge on the server**, not by sending whole documents. Two people editing transactions in the same month write the same `tx/YYYY-MM` document, and whole-document saves would lose one person's change.
3. **Replace a document:** `PUT /api/doc/:coll/:id`. YNABB's own server also has `PUT /api/budget`, which restore uses to swap the whole budget at once (see `server/README.md`).
4. **Live updates:** `GET /api/events` as Server-Sent Events, sending `{coll, id, doc}` after every change. In `store.js`, apply it the same way the `onSnapshot` handler does: keep local queued edits on top.
5. **Receipts:**
   - `POST /api/blob` stores the file and returns `{id}`.
   - `GET /_blob/:id` serves it.
   - Make `Store.assets = {upload: async (blob) => ({id})}` so `app.js` works unchanged.
6. **Who's who:** let a reverse proxy handle login (Cloudflare Access, Tailscale or Caddy basic auth) and pass a user header. `GET /api/me` returns `{id, name}`. Provide `Store.user = {me, profiles, can}` with the same shapes app.js uses: `profiles(ids)` resolves `{[id]: {name, isMe}}`.
7. **Downloads:** no server needed. Set `Store.downloads = {save: ({filename, data}) => ...}` using a Blob and `<a download>`.

### Suggested stacks (pick one)

- **A tiny Node, Deno or Bun server with SQLite** (about 150 lines). One table `docs(coll, id, json, updated_at)`, a folder for blobs, and the endpoints above. Easiest to understand and back up. Run it in Docker on a home server or NAS. The owner already runs Home Assistant, so a small always-on box may exist.
- **PocketBase** (a single binary with a database, realtime, file storage and logins). Store each document as a record `{coll, docId, data(json)}`. Do the merge-patch in a PocketBase hook so it happens on the server.
- **Supabase or Firebase** if you'd rather not run a server. Note: Firestore's `update()` doesn't deep-merge nested maps the same way, so implement the merge yourself in a transaction.

### Things to get right

- **Security:** it's family financial data. Use HTTPS only, require login, never expose the API unauthenticated, and back up the SQLite file or database nightly.
- **Keep optimistic writes:** `Store.write` updates the screen immediately and queues the network write per document. Keep that, along with the retry on `unavailable` and the error messages.
- **Offline:** on YNABB's server, unsent patches already keep retrying and are kept in localStorage, so they survive a reload.
- **Moving the data:**
  - Download a backup from the live claude.ai app and restore it into the new host.
  - Receipts aren't in the backup. If they matter, a Claude Code session can list them with the Artifact tool's `list_assets` and save them with `read_asset` on the real artifact, then upload them to the new blob store, keeping the ids so `tx.receipt` still points at them.
- **Test both directions:** make edits in two browsers at once and confirm both land, including two edits to the same month.
- **Remove the platform code:** once self-hosted, delete the claude.ai `db` branch in `store.js`, and the "open it from its claude.ai link" messages in `app.js` (search for `claude.ai`).
