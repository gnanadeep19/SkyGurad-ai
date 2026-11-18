$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localDir = Join-Path $projectRoot 'data/postgres-local'
$cluster = Join-Path $localDir 'cluster'
$pgCtl = Join-Path $localDir 'pgsql/bin/pg_ctl.exe'
if (-not (Test-Path -LiteralPath $cluster) -or -not (Test-Path -LiteralPath $pgCtl)) { throw 'Project-local PostgreSQL is not configured.' }
& $pgCtl '-D' $cluster 'status' 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Output 'Project-local PostgreSQL is already running.'; exit 0 }
& $pgCtl '-D' $cluster '-l' (Join-Path $localDir 'postgres.log') '-w' 'start'
if ($LASTEXITCODE -ne 0) { throw 'Unable to start project-local PostgreSQL.' }
