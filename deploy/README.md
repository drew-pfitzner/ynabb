# Running YNABB on the A6

The A6 runs two containers from `docker-compose.yml`:

- **`ynabb-tailscale`** joins the tailnet as `ynabb`, tagged `tag:yabb` (the tag keeps the app's first name, YABB, because the tailnet policy is written for it). It publishes **https://ynabb.tail8c1464.ts.net** to the internet with Tailscale Funnel, so nobody needs the Tailscale app.
- **`ynabb-app`** is the app. It shares the Tailscale container's network, so it has no ports open on the home network.

`tag:yabb` has no access to the rest of the tailnet. If YNABB were ever broken into, it still couldn't reach the A6, FarmOS or Home Assistant.

## Where things live on the A6

| What | Where |
|---|---|
| Code | `C:\YNABB`, a clone of this repo |
| Secrets | `C:\YNABB\.env`: `TS_AUTHKEY` (first start only). Never in git. |
| Budget data | Docker volume `ynabb_ynabb-data`: `ynabb.sqlite` and `blobs/` (receipts) |
| Tailscale identity | Docker volume `ynabb_tailscale-state` |

## One-time Tailscale setup (admin console)

1. **DNS:** check that **HTTPS Certificates** is enabled.
2. **Access controls:** the policy needs three things:
   - `"tagOwners": {"tag:yabb": ["autogroup:admin"]}`
   - `"nodeAttrs": [{"target": ["tag:yabb"], "attr": ["funnel"]}]`
   - Rules that let people reach devices use `"src": ["autogroup:member"]`, not `"*"`. With `"*"`, tagged devices like YNABB could reach everything.
3. **Keys:** generate an auth key with **Pre-approved** on, **Reusable** off and **Tags** set to `tag:yabb`. Put it in `C:\YNABB\.env` as `TS_AUTHKEY=...`. It's used once, on first start. After that the identity lives in the `tailscale-state` volume, and tagged devices don't expire.

## Commands (run in `C:\YNABB`)

```bat
docker compose ps                                   :: status
docker compose logs --tail 50 ynabb tailscale        :: logs
docker compose up -d --build                        :: start, or rebuild after a code change
docker compose exec ynabb node server/server.js add-admin <username> <Name>   :: first admin (prints a password)
docker compose exec ynabb node server/server.js reset-password <username>      :: emergency
```

Updates install themselves (below). Never edit files in `C:\YNABB` by hand: auto-deploy refuses to update over a hand edit.

## Updates (auto-deploy)

The scheduled task **"YNABB Auto Deploy"** runs `deploy\auto-deploy.ps1` every 2 minutes. When GitHub's `main` has moved on, it:

1. backs up the budget (see Backups below). If the app is running but the backup fails, it stops there, leaves the old version running, logs why and tries again every 30 minutes;
2. fast-forwards `C:\YNABB` to it (and refuses if someone edited files by hand);
3. rebuilds with `docker compose up -d --build`;
4. waits for the app to answer with the new version;
5. if it doesn't, rolls back to the previous version and skips the broken one until a newer one arrives.

`C:\YNABB\deploy.log` has the history. The admin page (Updates) shows the live version and whether the last update worked.

So **to ship a change, merge it into `main` on GitHub.** It's live within about 3 minutes. To undo a change, revert it on GitHub, and that installs the same way.

Install or reinstall the task (from a prompt on the A6):

```bat
schtasks /Create /TN "YNABB Auto Deploy" /SC MINUTE /MO 2 /F /TR "conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\YNABB\deploy\auto-deploy.ps1"
```

It runs as `drewp` while signed in, which the A6 always is (auto-login).

## Power cuts

These containers use the same recovery chain as FarmOS (`restart: unless-stopped`, Docker Desktop starts on sign-in, Windows auto-login, BIOS restore on AC power). They come back by themselves.

## Backups

Built into the server (`server/backup.js`). Nothing to schedule in Windows.

- **Every night at 2am** (or as soon as the A6 is back on, if it was off), YNABB takes a consistent copy of the database. It encrypts the copy with `BACKUP_KEY` and saves it to `C:\YNABB-backups`, then copies it to iCloud at `C:\Users\drewp\iCloudDrive\JARVIS\Family\YNABB`.
- **Kept:** 14 daily, 8 weekly and 12 monthly copies, deleted by count only. A weekly copy is made whenever the newest one is 7 or more days old, and a monthly one whenever this month doesn't have one yet, so a day when the A6 was off doesn't leave a gap. Each receipt is copied once to `blobs/` and never deleted.
- **Before each update**, auto-deploy runs `docker exec ynabb-app node server/server.js backup-now`. That's the same encrypted backup, saved to `deploy/` (last 10 kept, apart from the nightly ones) and copied to iCloud. No backup, no update (unless the app is down, when the update may be the fix).
- **Once a week**, the newest copy is opened and compared with the live database.
- **Status:** `/account` → Backups shows **OK**, **Not in iCloud**, **Failed** or **Not running**. "Not running" means nothing has worked for 36 hours (7+ days for the restore check), and it's the one to act on.

**`BACKUP_KEY` lives only in `C:\YNABB\.env` and the password manager.** Without it, no backup can be opened.

### Restore after losing the A6

1. Set up a box with Docker, clone the repo to `C:\YNABB`, and recreate `.env` (`BACKUP_KEY` from the password manager, and the two paths).
2. Decrypt the newest backup from iCloud: `BACKUP_KEY=... node server/backup.js decrypt <file>.ynabb ynabb.sqlite`
3. Put it in place before first start:
   - `docker compose create ynabb`
   - `docker cp ynabb.sqlite ynabb-app:/data/ynabb.sqlite`
4. Receipts: decrypt each `blobs/<id>.ynabb` the same way into `/data/blobs/<id>` (same name, no extension).
5. `docker compose up -d`. You'll need a new Tailscale auth key, because the Tailscale identity isn't in the backup.
