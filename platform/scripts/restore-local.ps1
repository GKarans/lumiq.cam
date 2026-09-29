param([string]$BackupPath)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$expectedProjectRef = 'sprzlvywzpeyuzbsyplz'
$targetBucket = 'lumiq-restore-drill-20260925'
$r2Endpoint = 'https://af664043db99694ff5a6ac88a7e7dc4d.r2.cloudflarestorage.com'
$backupRoot = Join-Path $env:LOCALAPPDATA 'Lumiq\backups'
if ([string]::IsNullOrWhiteSpace($BackupPath)) {
  $BackupPath = Join-Path $backupRoot 'lumiq-restore-drill-20260925-221255'
}

$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
$resolvedBackupRoot = (Resolve-Path -LiteralPath $backupRoot).Path.TrimEnd('\') + '\'
if (-not $resolvedBackup.StartsWith($resolvedBackupRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Restore is restricted to verified backups under '$backupRoot'."
}

$toolCandidates = @()
if ($env:LOCALAPPDATA) { $toolCandidates += Join-Path $env:LOCALAPPDATA 'Lumiq\postgresql17\bin' }
if ($env:USERPROFILE) { $toolCandidates += Join-Path $env:USERPROFILE 'AppData\Local\Lumiq\postgresql17\bin' }
if ($env:ProgramFiles) { $toolCandidates += Join-Path $env:ProgramFiles 'PostgreSQL\17\bin' }
$pathRestore = Get-Command pg_restore.exe -ErrorAction SilentlyContinue
if ($pathRestore) { $toolCandidates += Split-Path -Parent $pathRestore.Source }
$toolPath = $null
foreach ($candidate in $toolCandidates) {
  if (Test-Path -LiteralPath (Join-Path $candidate 'pg_restore.exe')) {
    $toolPath = $candidate
    break
  }
}
if (-not $toolPath) {
  $checked = if ($toolCandidates.Count) { $toolCandidates -join '; ' } else { 'PostgreSQL 17 client tool paths were not found' }
  throw "PostgreSQL 17 pg_restore.exe was not found. Checked: $checked."
}
$restoreVersion = (& (Join-Path $toolPath 'pg_restore.exe') --version | Out-String).Trim()
if ($restoreVersion -notmatch '^pg_restore \(PostgreSQL\) 17\.') {
  throw "PostgreSQL 17 client tools are required. Found: '$restoreVersion'."
}

$confirmation = Read-Host "Type ONLY '$expectedProjectRef' to confirm the empty restore target"
if ($confirmation -cne $expectedProjectRef) { throw 'Restore target confirmation did not match; no restore was run.' }

$environmentNames = @(
  'PLATFORM_DATABASE_URL',
  'PLATFORM_R2_BUCKET',
  'PLATFORM_R2_ENDPOINT',
  'PLATFORM_R2_ACCESS_KEY_ID',
  'PLATFORM_R2_SECRET_ACCESS_KEY',
  'PLATFORM_RESTORE_TARGET_REF',
  'PLATFORM_RESTORE_DRILL',
  'PLATFORM_RESTORE_ALLOW_PARTIAL',
  'PLATFORM_RUNTIME_PASSWORD'
)

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

$previousPath = $env:PATH
Push-Location $repoRoot
try {
  $env:PATH = "$toolPath;$env:PATH"
  & npm.cmd run backup:verify -- $resolvedBackup
  if ($LASTEXITCODE -ne 0) { throw 'Backup verification failed; restore was not started.' }

  Set-MaskedProcessValue 'PLATFORM_DATABASE_URL' 'TARGET Supabase Session Pooler URL (5432)'
  $env:PLATFORM_RESTORE_TARGET_REF = $expectedProjectRef
  $env:PLATFORM_RESTORE_DRILL = 'EMPTY-ISOLATED-TARGET'
  $env:PLATFORM_R2_BUCKET = $targetBucket
  $env:PLATFORM_R2_ENDPOINT = $r2Endpoint
  Set-MaskedProcessValue 'PLATFORM_R2_ACCESS_KEY_ID' 'Target-bucket Object Read & Write access key ID'
  Set-MaskedProcessValue 'PLATFORM_R2_SECRET_ACCESS_KEY' 'Target-bucket Object Read & Write secret key'
  Set-MaskedProcessValue 'PLATFORM_RUNTIME_PASSWORD' 'New lumiq_restore_runtime password (32+ URL-safe characters)'
  $partialConfirmation = Read-Host "If retrying this partial drill restore, type ONLY 'RESET PARTIAL $expectedProjectRef'; otherwise press Enter"
  if ($partialConfirmation -ceq "RESET PARTIAL $expectedProjectRef") {
    $env:PLATFORM_RESTORE_ALLOW_PARTIAL = '1'
  }

  Write-Host "Restoring only to Supabase project '$expectedProjectRef' and R2 bucket '$targetBucket'."
  & npm.cmd run restore:drill -- $resolvedBackup
  if ($LASTEXITCODE -ne 0) { throw 'Restore drill failed. Do not use this target until the cause is reviewed.' }
} finally {
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $env:PATH = $previousPath
  Pop-Location
}
