# YNABB auto-deploy. The scheduled task "YNABB Auto Deploy" runs this every 2 minutes on the A6.
# If GitHub's main branch has moved on: back up the budget, fast-forward C:\YNABB, rebuild, check the new version is healthy,
# and roll back if it isn't. A version that failed is skipped until a newer one arrives.
# Nothing on GitHub can reach in here; the A6 only ever pulls.
param([string]$Repo = 'C:\YNABB', [string]$Branch = 'main')
$ErrorActionPreference = 'Continue'
Set-Location $Repo

# one run at a time
$mutex = New-Object System.Threading.Mutex($false, 'Global\YnabbAutoDeploy')
if (-not $mutex.WaitOne(0)) { exit 0 }

$log = Join-Path $Repo 'deploy.log'
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Encoding UTF8 $log }
# the admin page reads this file (BACKUP_DIR is mounted into the app)
$backupLine = Get-Content (Join-Path $Repo '.env') | Where-Object { $_ -match '^YNABB_BACKUP_PATH=' } | Select-Object -First 1
$statusFile = Join-Path ($(if ($backupLine) { $backupLine -replace '^YNABB_BACKUP_PATH=', '' } else { Join-Path $Repo 'backups' })) 'deploy-status.json'
function ReadStatus() { try { Get-Content $statusFile -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null } }
function Now() { [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
function WriteStatus($ok, $version, $note, $failed, $backupFailed = $null) {
  [ordered]@{ ok = $ok; version = $version; note = $note; failedCommit = $failed; backupFailedCommit = $backupFailed; ts = (Now) } |
    ConvertTo-Json | Set-Content -Encoding UTF8 $statusFile
}
function Short($sha) { $sha.Substring(0, 7) }

git fetch -q origin $Branch 2>$null
if ($LASTEXITCODE -ne 0) { exit 0 } # offline: try again next time
$old = (git rev-parse HEAD).Trim()
$new = (git rev-parse "origin/$Branch").Trim()
$onBranch = (git rev-parse --abbrev-ref HEAD).Trim() -eq $Branch
if ($old -eq $new -and $onBranch) { exit 0 }
$prev = ReadStatus
if ($prev -and $prev.failedCommit -eq $new) { exit 0 } # already failed once; wait for a fix
# the backup before this version failed: try again every 30 minutes, not every 2, so the log stays readable
if ($prev -and $prev.backupFailedCommit -eq $new -and ((Now) - $prev.ts) -lt 30 * 60 * 1000) { exit 0 }

Log "updating $(Short $old) -> $(Short $new)"
# back up the budget before anything changes, using the app's own backup (same encrypted files as the
# nightly, in BACKUP_DIR\deploy). It runs inside the live container, which has BACKUP_KEY and the data.
# No backup, no update: the code on disk is still the old version, so nothing has been touched yet.
$out = docker exec ynabb-app node server/server.js backup-now 2>&1
$backedUp = $LASTEXITCODE -eq 0
$out | ForEach-Object { Log "  $_" }
if (-not $backedUp) {
  $why = (($out | ForEach-Object { "$_".Trim() }) | Where-Object { $_ }) -join ' '
  if (-not $why) { $why = 'no reason given' }
  Log "FAILED: could not back up before updating, so YNABB stayed on $(Short $old). Will try again in 30 minutes."
  WriteStatus $false (Short $old) "Could not take a backup before updating, so YNABB stayed on $(Short $old): $why" $null $new
  exit 1
}
if (-not $onBranch) { git checkout -q $Branch 2>&1 | ForEach-Object { Log "  $_" } }
git merge --ff-only -q "origin/$Branch" 2>&1 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0 -or (git rev-parse HEAD).Trim() -ne $new) {
  Log 'FAILED: the code in C:\YNABB was changed by hand, so it cannot update. Undo the change (git status shows it).'
  WriteStatus $false (Short $old) 'The code on the A6 was changed by hand, so it could not update.' $new
  exit 1
}

function Build() {
  $env:APP_VERSION = Short (git rev-parse HEAD).Trim()
  docker compose up -d --build 2>&1 | ForEach-Object { Log "  $_" }
  return $LASTEXITCODE -eq 0
}
# healthy = the app answers with the version we just built
function Healthy($v) {
  for ($i = 0; $i -lt 40; $i++) {
    $h = docker exec ynabb-app wget -qO- http://127.0.0.1:8080/api/health 2>$null
    if ("$h" -match "`"version`":`"$v`"") { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

if ((Build) -and (Healthy (Short $new))) {
  Log "deployed $(Short $new)"
  WriteStatus $true (Short $new) $null $null
  exit 0
}
Log "FAILED: $(Short $new) did not start. Rolling back to $(Short $old)."
git reset -q --hard $old
$back = (Build) -and (Healthy (Short $old))
Log $(if ($back) { "rolled back to $(Short $old)" } else { 'ROLLBACK ALSO FAILED: YNABB may be down. Check: docker compose ps' })
WriteStatus $false (Short $old) "Version $(Short $new) would not start, so YNABB stayed on $(Short $old)." $new
exit 1
