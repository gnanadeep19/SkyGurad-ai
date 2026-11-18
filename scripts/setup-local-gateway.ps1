$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$certDir = Join-Path $projectRoot 'data/gateway-local'
$key = Join-Path $certDir 'localhost-key.pem'
$certificate = Join-Path $certDir 'localhost-cert.pem'
if ((Test-Path -LiteralPath $key) -and (Test-Path -LiteralPath $certificate)) {
  & node (Join-Path $PSScriptRoot 'check-local-gateway-cert.mjs') $key $certificate
  if ($LASTEXITCODE -ne 0) { throw 'The existing local certificate or key is invalid or expired. Inspect the gateway directory before continuing.' }
  Write-Output 'Local test certificate already exists.'; exit 0
}
if ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $certificate)) { throw 'Only one certificate file exists. Inspect the local gateway directory before continuing.' }
$opensslCommand = Get-Command openssl -ErrorAction SilentlyContinue
$openssl = if ($opensslCommand) { $opensslCommand.Source } else { 'C:\Program Files\Git\usr\bin\openssl.exe' }
if (-not (Test-Path -LiteralPath $openssl)) { throw 'OpenSSL was not found. Install it or use a certificate from a trusted provider.' }
New-Item -ItemType Directory -Path $certDir -Force | Out-Null
$previousPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  & $openssl req -x509 -newkey rsa:2048 -nodes -keyout $key -out $certificate -days 30 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>$null
  $result = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousPreference }
if ($result -ne 0) { throw 'Unable to create local test certificate. Inspect the gateway directory before retrying.' }
Write-Output 'Created a self-signed certificate for local testing only.'
