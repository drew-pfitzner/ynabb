# YNABB server

One file (`server.js`), no npm packages: Node 22.13 or newer, using its built-in SQLite. It serves the app from `../app`, plus:

- **Logins** with scrypt-hashed passwords and session cookies (HttpOnly, SameSite; Secure in production).
  - Five wrong passwords for a login from one address lock that login on that address for 15 minutes (the real person elsewhere can still sign in). Ten from one address, for any logins, make that address wait 15 minutes. These counts are kept in memory, so a restart clears them.
  - Sessions end after 14 days unused or 90 days total. Expired ones are cleared every minute (and at start-up), and a device that signs out, changes password or expires has its live-update connection closed.
- **Separate budgets.** Each person belongs to one budget. Admins can open any budget from `/account`.
- **The document API** `store.js` uses: `GET /api/events` (the whole budget, then live changes), `PATCH`/`PUT /api/doc/:coll/:id`, and receipts at `POST /api/blob` and `GET /_blob/:id`.
- **A change log.** Every write goes into the `changes` table and is never deleted. A replace (restore) also keeps the document it replaced.
- **`/account`** for everyone (password, sign out), with the admin tools (budgets, people, sign-in log) for admins.

## Run it on your computer

```sh
npm run add-admin -- drew Drew   # first time only: prints a password
npm run dev                      # http://127.0.0.1:8080
npm test                         # the server tests
```

Data goes in `data/` (gitignored): `ynabb.sqlite` plus `blobs/` for receipts. Delete the folder to start again.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT`, `HOST` | `8080`, `127.0.0.1` | Where it listens. |
| `DATA_DIR` | `./data` | The database and receipts. **This is the folder to back up.** |
| `COOKIE_SECURE` | on | Set `0` only for plain-http testing on your own computer. |
| `TRUST_PROXY` | off | Set `1` behind Tailscale, so sign-in logs and limits see the visitor's real address. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME` | | On first start with no logins, creates the super admin and a "Family" budget. |
| `APP_VERSION` | `dev` | Shown on the account page, so you can see which version is live. |

Emergency only (needs a shell on the server): `node server/server.js reset-password <username>`.
