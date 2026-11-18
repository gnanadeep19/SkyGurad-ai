$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localDir = Join-Path $projectRoot 'data/postgres-local'
$binDir = Join-Path $localDir 'pgsql/bin'
$cluster = Join-Path $localDir 'cluster'
$backupDir = Join-Path $localDir 'backups'
$envFile = Join-Path $projectRoot '.env.skyguard.local'
$pwFile = Join-Path $localDir 'bootstrap-password.tmp'
$port = 55432
if ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name -like '*\CodexSandboxOffline') { throw 'Run this setup script from your normal Windows terminal; PostgreSQL cannot start under the sandbox account.' }
if (-not (Test-Path -LiteralPath (Join-Path $binDir 'initdb.exe'))) { throw 'Verified PostgreSQL binaries were not found in data/postgres-local/pgsql.' }
if ((Test-Path -LiteralPath $envFile) -or (Test-Path -LiteralPath $cluster) -or (Test-Path -LiteralPath $backupDir) -or (Test-Path -LiteralPath $pwFile)) { throw 'Existing local database configuration found. Nothing was overwritten.' }
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $port)
try { $listener.Start() } catch { throw "Local port $port is already in use. Nothing was changed." } finally { $listener.Stop() }
$bytes = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$secret = ([System.BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
function New-PrivateFile([string]$file, [string]$content) {
  $stream = [System.IO.File]::Open($file, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $stream.Dispose()
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $file '/inheritance:r' '/grant:r' "*${sid}:(F)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict database credential file permissions.' }
  [System.IO.File]::WriteAllText($file,$content,[System.Text.Encoding]::ASCII)
}
try {
  New-PrivateFile $pwFile $secret
  New-PrivateFile $envFile "DATABASE_URL=postgresql://skyguard:$secret@127.0.0.1:$port/skyguard`n"
  & (Join-Path $binDir 'initdb.exe') '-D' $cluster '-U' 'skyguard' '--encoding=UTF8' '--auth=scram-sha-256' "--pwfile=$pwFile" '--locale=C'
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed. Existing files were left in place for inspection.' }
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $cluster '/inheritance:r' '/grant:r' "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict database cluster permissions.' }
  New-Item -ItemType Directory -Path $backupDir | Out-Null
  & icacls.exe $backupDir '/inheritance:r' '/grant:r' "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict database backup permissions.' }
  Add-Content -LiteralPath (Join-Path $cluster 'postgresql.conf') -Encoding ASCII -Value "`nlisten_addresses = '127.0.0.1'`nport = $port"
  & (Join-Path $binDir 'pg_ctl.exe') '-D' $cluster '-l' (Join-Path $localDir 'postgres.log') '-w' 'start'
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL could not start. Existing files were left in place for inspection.' }
  $env:PGPASSWORD = $secret
  & (Join-Path $binDir 'createdb.exe') '-h' '127.0.0.1' '-p' "$port" '-U' 'skyguard' 'skyguard'
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL started, but the application database could not be created.' }
  Write-Output "Local PostgreSQL is running on 127.0.0.1:$port. Credentials are stored in the ignored project-local configuration."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $pwFile) { Remove-Item -LiteralPath $pwFile -Force }
}
