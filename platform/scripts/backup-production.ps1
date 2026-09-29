$ErrorActionPreference = 'Stop'

$toolCandidates = @()
if ($env:LOCALAPPDATA) { $toolCandidates += Join-Path $env:LOCALAPPDATA 'Lumiq\postgresql17\bin' }
if ($env:USERPROFILE) { $toolCandidates += Join-Path $env:USERPROFILE 'AppData\Local\Lumiq\postgresql17\bin' }
if ($env:ProgramFiles) { $toolCandidates += Join-Path $env:ProgramFiles 'PostgreSQL\17\bin' }
$pathDump = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
$pathRestore = Get-Command pg_restore.exe -ErrorAction SilentlyContinue
if ($pathDump -and $pathRestore -and (Split-Path -Parent $pathDump.Source) -eq (Split-Path -Parent $pathRestore.Source)) {
  $toolCandidates += Split-Path -Parent $pathDump.Source
}

$toolPath = $null
foreach ($candidate in $toolCandidates) {
  if ((Test-Path -LiteralPath (Join-Path $candidate 'pg_dump.exe')) -and
      (Test-Path -LiteralPath (Join-Path $candidate 'pg_restore.exe'))) {
    $toolPath = $candidate
    break
  }
}
if (-not $toolPath) { throw 'PostgreSQL 17 pg_dump and pg_restore are required. No database changes were made.' }
$dumpVersion = (& (Join-Path $toolPath 'pg_dump.exe') --version | Out-String).Trim()
$restoreVersion = (& (Join-Path $toolPath 'pg_restore.exe') --version | Out-String).Trim()
if ($dumpVersion -notmatch '^pg_dump \(PostgreSQL\) 17\.' -or $restoreVersion -notmatch '^pg_restore \(PostgreSQL\) 17\.') {
  throw "PostgreSQL 17 client tools are required. Found '$dumpVersion' and '$restoreVersion'."
}

function Set-MaskedProcessValue {
  param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$Prompt)
  $secureValue = Read-Host -Prompt $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    [Environment]::SetEnvironmentVariable($Name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secureValue.Dispose()
  }
}

$names = @(
  'LUMIQ_PRODUCTION_DB_PASSWORD',
  'LUMIQ_PRODUCTION_PHOTOS_R2_ACCESS_KEY_ID', 'LUMIQ_PRODUCTION_PHOTOS_R2_SECRET_ACCESS_KEY',
  'LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID', 'LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY'
)
$backupPath = Join-Path ([IO.Path]::GetTempPath()) ('lumiq-production-backup-' + [guid]::NewGuid().ToString())
$success = $false
try {
  if (-not $env:LUMIQ_PRODUCTION_DB_PASSWORD) { Set-MaskedProcessValue 'LUMIQ_PRODUCTION_DB_PASSWORD' 'Lumiq Production postgres admin password (hidden; backup only)' }
  if (-not $env:LUMIQ_PRODUCTION_PHOTOS_R2_ACCESS_KEY_ID) { Set-MaskedProcessValue 'LUMIQ_PRODUCTION_PHOTOS_R2_ACCESS_KEY_ID' 'Production photos read-only R2 access key ID (hidden)' }
  if (-not $env:LUMIQ_PRODUCTION_PHOTOS_R2_SECRET_ACCESS_KEY) { Set-MaskedProcessValue 'LUMIQ_PRODUCTION_PHOTOS_R2_SECRET_ACCESS_KEY' 'Production photos read-only R2 secret (hidden)' }
  if (-not $env:LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID) { Set-MaskedProcessValue 'LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID' 'Production backups read-write R2 access key ID (hidden)' }
  if (-not $env:LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY) { Set-MaskedProcessValue 'LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY' 'Production backups read-write R2 secret (hidden)' }
  foreach ($name in $names) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) { throw "Missing required credential '$name'. Run production-secrets.ps1 save-backup or enter it at the hidden prompt." }
  }
  $env:PATH = "$toolPath;$env:PATH"
  & node (Join-Path $PSScriptRoot 'backup-production.mjs') $backupPath
  if ($LASTEXITCODE -ne 0) { throw 'Production backup or remote checksum verification failed. No database schema was changed.' }
  $success = $true
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  if (-not $success -and (Test-Path -LiteralPath $backupPath)) {
    Write-Warning "Backup failed. Temporary production data remains at '$backupPath'; secure it and inspect the error before retrying."
  }
}
