param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('save-backup', 'save-runtime', 'create-production-safe-runtime', 'copy-production-safe-runtime', 'create-production-session-key', 'save-production-email', 'provision-production-safe-runtime', 'rotate-production-safe-runtime', 'apply-production-migrations', 'save-recovery-r2', 'check-recovery-r2', 'save-recovery', 'save-recovery-db-password', 'create-recovery-db-password', 'create-recovery-runtime', 'run-recovery-restore', 'apply-recovery-migrations', 'save-restore-drill', 'save-restore-drill-r2', 'create-restore-drill-runtime', 'audit-restore-drill-migrations', 'apply-restore-drill-migrations', 'apply-restore-drill-runtime', 'apply-production-runtime', 'show', 'run-backup', 'check-production-backup', 'set-candidate-session-secret', 'set-candidate-email-secret', 'set-production-session-secret', 'set-production-email-secret', 'run-runtime-check', 'run-safe-runtime-check', 'run-safe-runtime-bootstrap-check')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This vault uses Windows DPAPI and must run under the same Windows user account that saved it.' }

$vaultDirectory = Join-Path $env:APPDATA 'Lumiq'
$vaultPath = Join-Path $vaultDirectory 'production-secrets.clixml'
$backupNames = @(
  'LUMIQ_PRODUCTION_DB_PASSWORD',
  'LUMIQ_PRODUCTION_PHOTOS_R2_ACCESS_KEY_ID',
  'LUMIQ_PRODUCTION_PHOTOS_R2_SECRET_ACCESS_KEY',
  'LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID',
  'LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY'
)
$runtimeName = 'LUMIQ_PRODUCTION_RUNTIME_PASSWORD'
$productionSafeRuntimeName = 'LUMIQ_PRODUCTION_SAFE_RUNTIME_PASSWORD'
$productionSessionKeyName = 'LUMIQ_PRODUCTION_SESSION_ENCRYPTION_KEY'
$productionEmailKeyName = 'LUMIQ_PRODUCTION_EMAIL_KEY'
$recoveryR2Names = @('LUMIQ_RECOVERY_R2_ACCESS_KEY_ID', 'LUMIQ_RECOVERY_R2_SECRET_ACCESS_KEY')
$restoreDrillNames = @('LUMIQ_RESTORE_DRILL_DB_PASSWORD', 'LUMIQ_RESTORE_DRILL_RUNTIME_PASSWORD')
$restoreDrillR2Names = @('LUMIQ_RESTORE_DRILL_R2_ACCESS_KEY_ID', 'LUMIQ_RESTORE_DRILL_R2_SECRET_ACCESS_KEY')
$restoreDrillSafeRuntimeName = 'LUMIQ_RESTORE_DRILL_SAFE_RUNTIME_PASSWORD'
$recoveryDbPasswordName = 'LUMIQ_RECOVERY_DB_PASSWORD'
$recoveryRuntimeName = 'LUMIQ_RECOVERY_RUNTIME_PASSWORD'
$recoveryNames = @(
  'LUMIQ_RECOVERY_DB_PASSWORD',
  'LUMIQ_RECOVERY_R2_ACCESS_KEY_ID',
  'LUMIQ_RECOVERY_R2_SECRET_ACCESS_KEY',
  'LUMIQ_RECOVERY_RUNTIME_PASSWORD'
)

function Read-Vault {
  if (-not (Test-Path -LiteralPath $vaultPath)) { return @{} }
  $loaded = Import-Clixml -LiteralPath $vaultPath
  if ($loaded -isnot [System.Collections.IDictionary]) { throw 'The encrypted Lumiq credential file has an invalid format.' }
  return $loaded
}

function Save-Vault([System.Collections.IDictionary]$Vault) {
  New-Item -ItemType Directory -Path $vaultDirectory -Force | Out-Null
  $temporaryPath = "$vaultPath.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    $Vault | Export-Clixml -LiteralPath $temporaryPath -Depth 4
    Move-Item -LiteralPath $temporaryPath -Destination $vaultPath -Force
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
  }
}

function Add-MaskedSecret([System.Collections.IDictionary]$Vault, [string]$Name) {
  $value = Read-Host -Prompt "$Name (hidden; saved with Windows DPAPI)" -AsSecureString
  if ($value.Length -eq 0) { $value.Dispose(); throw "Empty value for $Name; nothing was saved." }
  if ($Vault.Contains($Name) -and $Vault[$Name] -is [System.Security.SecureString]) { $Vault[$Name].Dispose() }
  $Vault[$Name] = $value
}

function New-RandomSecurePassword {
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  $value = [System.Security.SecureString]::new()
  for ($index = 0; $index -lt 48; $index++) {
    $value.AppendChar($alphabet[[System.Security.Cryptography.RandomNumberGenerator]::GetInt32($alphabet.Length)])
  }
  $value.MakeReadOnly()
  return $value
}

function Set-ProcessSecret([string]$Name, [System.Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    [Environment]::SetEnvironmentVariable($Name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Invoke-RuntimePasswordRotation([ValidateSet('restore-drill', 'production')][string]$Target) {
  $vault = Read-Vault
  if ($Target -eq 'restore-drill') {
    $adminName = 'LUMIQ_RESTORE_DRILL_DB_PASSWORD'
    $runtimeSecretName = 'LUMIQ_RESTORE_DRILL_RUNTIME_PASSWORD'
    $projectRef = 'sprzlvywzpeyuzbsyplz'
  } else {
    $adminName = 'LUMIQ_PRODUCTION_DB_PASSWORD'
    $runtimeSecretName = $runtimeName
    $projectRef = 'baqebydtinysosueksgr'
  }
  foreach ($name in @($adminName, $runtimeSecretName)) {
    if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$name'. Save the project admin and new runtime passwords first."
    }
  }
  Set-ProcessSecret 'LUMIQ_ROTATE_ADMIN_PASSWORD' $vault[$adminName]
  Set-ProcessSecret 'LUMIQ_ROTATE_RUNTIME_PASSWORD' $vault[$runtimeSecretName]
  $env:LUMIQ_ROTATE_TARGET = $Target
  $env:LUMIQ_ROTATE_PROJECT_REF = $projectRef
  try {
    & node (Join-Path $PSScriptRoot 'rotate-runtime-password.mjs')
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    foreach ($name in @('LUMIQ_ROTATE_ADMIN_PASSWORD', 'LUMIQ_ROTATE_RUNTIME_PASSWORD', 'LUMIQ_ROTATE_TARGET', 'LUMIQ_ROTATE_PROJECT_REF')) {
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
  }
}

switch ($Action) {
  'save-backup' {
    $vault = Read-Vault
    foreach ($name in $backupNames) { Add-MaskedSecret $vault $name }
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Saved encrypted Lumiq production backup credentials to $vaultPath"
  }
  'save-runtime' {
    $vault = Read-Vault
    Add-MaskedSecret $vault $runtimeName
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Saved encrypted Lumiq production runtime credential to $vaultPath"
  }
  'create-production-safe-runtime' {
    $vault = Read-Vault
    if ($vault.Contains($productionSafeRuntimeName) -and $vault[$productionSafeRuntimeName] -is [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'A separate Production safe-runtime password already exists in the DPAPI vault; refusing to replace it.'
    }
    $vault[$productionSafeRuntimeName] = New-RandomSecurePassword
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Generated and saved a unique Production safe-runtime password with Windows DPAPI as $productionSafeRuntimeName in $vaultPath"
  }
  'copy-production-safe-runtime' {
    $vault = Read-Vault
    if (-not $vault.Contains($productionSafeRuntimeName) -or $vault[$productionSafeRuntimeName] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$productionSafeRuntimeName'. Generate or save it first."
    }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($vault[$productionSafeRuntimeName])
    try {
      Set-Clipboard -Value ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
    Write-Output "Copied the Production safe-runtime password to the clipboard without printing it. Paste it into the matching Hyperdrive password field, save, then clear the clipboard."
  }
  'create-production-session-key' {
    $vault = Read-Vault
    if ($vault.Contains($productionSessionKeyName) -and $vault[$productionSessionKeyName] -is [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'A Production session-encryption key already exists in the DPAPI vault; refusing to replace it.'
    }
    $randomBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $hex = [Convert]::ToHexString($randomBytes).ToLowerInvariant()
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
    $key = [System.Security.SecureString]::new()
    foreach ($character in $hex.ToCharArray()) { $key.AppendChar($character) }
    $key.MakeReadOnly()
    $hex = $null
    $vault[$productionSessionKeyName] = $key
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Generated a unique 256-bit Production session-encryption key and saved it with Windows DPAPI as $productionSessionKeyName. The value was not printed."
  }
  'provision-production-safe-runtime' {
    $vault = Read-Vault
    foreach ($name in @('LUMIQ_PRODUCTION_DB_PASSWORD', $productionSafeRuntimeName)) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. Save Production DB and safe runtime credentials first."
      }
    }
    Set-ProcessSecret 'LUMIQ_PRODUCTION_DB_PASSWORD' $vault['LUMIQ_PRODUCTION_DB_PASSWORD']
    Set-ProcessSecret 'LUMIQ_PRODUCTION_SAFE_RUNTIME_PASSWORD' $vault[$productionSafeRuntimeName]
    try {
      & node (Join-Path $PSScriptRoot 'provision-production-safe-runtime.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in @('LUMIQ_PRODUCTION_DB_PASSWORD', 'LUMIQ_PRODUCTION_SAFE_RUNTIME_PASSWORD')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'rotate-production-safe-runtime' {
    $vault = Read-Vault
    $pendingName = 'LUMIQ_PRODUCTION_SAFE_RUNTIME_PASSWORD_PENDING'
    foreach ($name in @('LUMIQ_PRODUCTION_DB_PASSWORD', $pendingName)) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. The pending password is created by the guarded rotation workflow."
      }
    }
    Set-ProcessSecret 'LUMIQ_PRODUCTION_DB_PASSWORD' $vault['LUMIQ_PRODUCTION_DB_PASSWORD']
    Set-ProcessSecret $productionSafeRuntimeName $vault[$pendingName]
    try {
      & node (Join-Path $PSScriptRoot 'rotate-production-safe-runtime.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Safe runtime password rotation failed; pending credential remains encrypted in DPAPI.' }
      Set-ProcessSecret 'LUMIQ_PRODUCTION_RUNTIME_PASSWORD' $vault[$pendingName]
      $env:LUMIQ_PRODUCTION_RUNTIME_ROLE = 'lumiq_production_runtime'
      & node (Join-Path $PSScriptRoot 'verify-production-runtime.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Post-rotation safe runtime verification failed; pending credential remains encrypted in DPAPI.' }
      $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($vault[$pendingName])
      try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $wrangler = Join-Path $PSScriptRoot '..\..\node_modules\.bin\wrangler.cmd'
        & $wrangler hyperdrive update 287181f11f734b63844bcda5eb7fe90c --origin-host aws-0-eu-central-1.pooler.supabase.com --origin-port 5432 --database postgres --origin-scheme postgres --origin-user lumiq_production_runtime.baqebydtinysosueksgr --origin-password $password --caching-disabled --origin-connection-limit 60
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Hyperdrive update failed; pending credential remains encrypted in DPAPI.' }
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $password = $null
      }
      $vault[$productionSafeRuntimeName] = $vault[$pendingName]
      $vault.Remove($pendingName)
      Save-Vault $vault
      Write-Output 'Production safe runtime password rotated, verified, and stored with Windows DPAPI. The previous password is invalid.'
    } finally {
      foreach ($name in @('LUMIQ_PRODUCTION_DB_PASSWORD', $productionSafeRuntimeName, 'LUMIQ_PRODUCTION_RUNTIME_PASSWORD', 'LUMIQ_PRODUCTION_RUNTIME_ROLE')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
      }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'apply-production-migrations' {
    $vault = Read-Vault
    foreach ($name in @('LUMIQ_PRODUCTION_DB_PASSWORD', $productionSafeRuntimeName)) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. Save Production DB and safe runtime credentials first."
      }
    }
    $confirmation = Read-Host "Type ONLY 'baqebydtinysosueksgr' to confirm Production migrations"
    if ($confirmation -cne 'baqebydtinysosueksgr') {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'Production project confirmation did not match; no migration was run.'
    }
    Set-ProcessSecret 'LUMIQ_PRODUCTION_DB_PASSWORD' $vault['LUMIQ_PRODUCTION_DB_PASSWORD']
    Set-ProcessSecret $productionSafeRuntimeName $vault[$productionSafeRuntimeName]
    $env:LUMIQ_MIGRATION_TARGET = 'production'
    try {
      & node (Join-Path $PSScriptRoot 'apply-restore-drill-migrations.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Production migration failed; review the sanitized output before retrying.' }
    } finally {
      foreach ($name in @('LUMIQ_PRODUCTION_DB_PASSWORD', $productionSafeRuntimeName, 'LUMIQ_MIGRATION_TARGET')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'save-recovery-r2' {
    $vault = Read-Vault
    foreach ($name in $recoveryR2Names) { Add-MaskedSecret $vault $name }
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Saved encrypted Lumiq recovery R2 credentials to $vaultPath"
  }
  'check-recovery-r2' {
    $vault = Read-Vault
    foreach ($name in $recoveryR2Names) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. Run production-secrets.ps1 save-recovery-r2 first."
      }
      Set-ProcessSecret $name $vault[$name]
    }
    try {
      & node (Join-Path $PSScriptRoot 'check-recovery-r2.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in $recoveryR2Names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'save-recovery' {
    $vault = Read-Vault
    foreach ($name in $recoveryNames) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) { Add-MaskedSecret $vault $name }
    }
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Saved encrypted Lumiq recovery credentials to $vaultPath"
  }
  'create-recovery-runtime' {
    $vault = Read-Vault
    if ($vault.Contains($recoveryRuntimeName) -and $vault[$recoveryRuntimeName] -is [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'A Recovery runtime password already exists in the DPAPI vault; refusing to replace it.'
    }
    $vault[$recoveryRuntimeName] = New-RandomSecurePassword
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Generated and saved a unique Recovery runtime password with Windows DPAPI as $recoveryRuntimeName in $vaultPath"
  }
  'create-recovery-db-password' {
    $vault = Read-Vault
    if ($vault.Contains($recoveryDbPasswordName) -and $vault[$recoveryDbPasswordName] -is [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'A Recovery database password already exists in the DPAPI vault; refusing to replace it.'
    }
    $vault[$recoveryDbPasswordName] = New-RandomSecurePassword
    Save-Vault $vault
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($vault[$recoveryDbPasswordName])
    try {
      Set-Clipboard -Value ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
    Write-Output "Generated Recovery database password, saved it with Windows DPAPI as $recoveryDbPasswordName, and copied it to the clipboard for the Supabase password field. The password was not printed. Clear the clipboard after pasting."
  }
  'save-recovery-db-password' {
    $vault = Read-Vault
    Add-MaskedSecret $vault $recoveryDbPasswordName
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Saved the Recovery database password with Windows DPAPI as $recoveryDbPasswordName to $vaultPath. The password was not printed."
  }
  'run-recovery-restore' {
    $vault = Read-Vault
    $required = @('LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID', 'LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY', 'LUMIQ_RECOVERY_DB_PASSWORD', 'LUMIQ_RECOVERY_R2_ACCESS_KEY_ID', 'LUMIQ_RECOVERY_R2_SECRET_ACCESS_KEY', $recoveryRuntimeName)
    foreach ($name in $required) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. Save Recovery credentials and verify the Recovery R2 token first."
      }
    }
    $projectRef = Read-Host 'New Lumiq Production Recovery Supabase project reference'
    if ($projectRef -notmatch '^[a-z0-9]{20}$' -or @('baqebydtinysosueksgr', 'sprzlvywzpeyuzbsyplz', 'cpweowosocjuccjsyyic') -ccontains $projectRef) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'Recovery target must be a new Supabase project; Production, Restore Drill and closed-test references are forbidden.'
    }
    $confirmation = Read-Host "Type ONLY '$projectRef' to confirm the isolated Recovery target"
    if ($confirmation -cne $projectRef) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'Recovery project confirmation did not match; no restore was run.'
    }
    foreach ($name in $required) { Set-ProcessSecret $name $vault[$name] }
    $env:LUMIQ_RECOVERY_PROJECT_REF = $projectRef
    try {
      & node (Join-Path $PSScriptRoot 'restore-production-recovery.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Production Recovery restore failed; review the sanitized output before retrying.' }
    } finally {
      foreach ($name in $required) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      [Environment]::SetEnvironmentVariable('LUMIQ_RECOVERY_PROJECT_REF', $null, 'Process')
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'apply-recovery-migrations' {
    $vault = Read-Vault
    foreach ($name in @('LUMIQ_RECOVERY_DB_PASSWORD', $recoveryRuntimeName)) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. Save Recovery credentials and generate the Recovery runtime password first."
      }
    }
    $projectRef = Read-Host 'New Lumiq Production Recovery Supabase project reference'
    if ($projectRef -notmatch '^[a-z0-9]{20}$' -or @('baqebydtinysosueksgr', 'sprzlvywzpeyuzbsyplz', 'cpweowosocjuccjsyyic') -ccontains $projectRef) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'Recovery target must be a new Supabase project; Production, Restore Drill and closed-test references are forbidden.'
    }
    $confirmation = Read-Host "Type ONLY '$projectRef' to confirm Recovery migration target"
    if ($confirmation -cne $projectRef) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'Recovery project confirmation did not match; no migration was run.'
    }
    Set-ProcessSecret 'LUMIQ_RECOVERY_DB_PASSWORD' $vault['LUMIQ_RECOVERY_DB_PASSWORD']
    Set-ProcessSecret $recoveryRuntimeName $vault[$recoveryRuntimeName]
    $env:LUMIQ_MIGRATION_TARGET = 'recovery'
    $env:LUMIQ_RECOVERY_PROJECT_REF = $projectRef
    try {
      & node (Join-Path $PSScriptRoot 'apply-restore-drill-migrations.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Recovery migration failed; review the sanitized output before retrying.' }
    } finally {
      foreach ($name in @('LUMIQ_RECOVERY_DB_PASSWORD', $recoveryRuntimeName, 'LUMIQ_MIGRATION_TARGET', 'LUMIQ_RECOVERY_PROJECT_REF')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'save-restore-drill' {
    $vault = Read-Vault
    foreach ($name in $restoreDrillNames) { Add-MaskedSecret $vault $name }
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Saved encrypted Lumiq Restore Drill credentials to $vaultPath"
  }
  'save-restore-drill-r2' {
    $vault = Read-Vault
    foreach ($name in $restoreDrillR2Names) { Add-MaskedSecret $vault $name }
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Saved encrypted Lumiq Restore Drill R2 credentials to $vaultPath"
  }
  'create-restore-drill-runtime' {
    $vault = Read-Vault
    if ($vault.Contains($restoreDrillSafeRuntimeName) -and $vault[$restoreDrillSafeRuntimeName] -is [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw 'A safe Restore Drill runtime password already exists in the DPAPI vault; refusing to replace it.'
    }
    $vault[$restoreDrillSafeRuntimeName] = New-RandomSecurePassword
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Generated and saved a unique Restore Drill runtime password with Windows DPAPI as $restoreDrillSafeRuntimeName in $vaultPath"
  }
  'audit-restore-drill-migrations' {
    $vault = Read-Vault
    $name = 'LUMIQ_RESTORE_DRILL_DB_PASSWORD'
    if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$name'. Run production-secrets.ps1 save-restore-drill first."
    }
    Set-ProcessSecret 'LUMIQ_RESTORE_DRILL_DB_PASSWORD' $vault[$name]
    try {
      & node (Join-Path $PSScriptRoot 'audit-restore-drill-migrations.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      [Environment]::SetEnvironmentVariable('LUMIQ_RESTORE_DRILL_DB_PASSWORD', $null, 'Process')
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'apply-restore-drill-migrations' {
    $vault = Read-Vault
    $names = @('LUMIQ_RESTORE_DRILL_DB_PASSWORD', $restoreDrillSafeRuntimeName)
    foreach ($name in $names) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. Run production-secrets.ps1 save-restore-drill first."
      }
    }
    foreach ($name in $names) {
      Set-ProcessSecret $name $vault[$name]
    }
    try {
      & node (Join-Path $PSScriptRoot 'apply-restore-drill-migrations.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'apply-restore-drill-runtime' { Invoke-RuntimePasswordRotation 'restore-drill' }
  'apply-production-runtime' { Invoke-RuntimePasswordRotation 'production' }
  'show' {
    $vault = Read-Vault
    if ($vault.Count -eq 0) { Write-Output 'No Lumiq production credentials are saved.' }
    else { $vault.Keys | Sort-Object }
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
  }
  'run-backup' {
    $vault = Read-Vault
    foreach ($name in $backupNames) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. Run production-secrets.ps1 save-backup first."
      }
      Set-ProcessSecret $name $vault[$name]
    }
    try {
      & (Join-Path $PSScriptRoot 'backup-production.ps1')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in $backupNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'check-production-backup' {
    $vault = Read-Vault
    foreach ($name in @('LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID', 'LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY')) {
      if (-not $vault.Contains($name) -or $vault[$name] -isnot [System.Security.SecureString]) {
        foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
        throw "Missing encrypted credential '$name'. Run production-secrets.ps1 save-backup first."
      }
      Set-ProcessSecret $name $vault[$name]
    }
    try {
      & node (Join-Path $PSScriptRoot 'check-production-backup.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in @('LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID', 'LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'save-production-email' {
    $vault = Read-Vault
    Add-MaskedSecret $vault $productionEmailKeyName
    Save-Vault $vault
    foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    Write-Output "Saved encrypted Lumiq production email credential to $vaultPath"
  }
  'set-candidate-session-secret' {
    $vault = Read-Vault
    if (-not $vault.Contains($productionSessionKeyName) -or $vault[$productionSessionKeyName] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$productionSessionKeyName'. Run create-production-session-key first."
    }
    Set-ProcessSecret $productionSessionKeyName $vault[$productionSessionKeyName]
    $env:LUMIQ_PRODUCTION_WORKER_SECRET_BINDING = 'PLATFORM_SESSION_ENCRYPTION_KEY'
    $env:LUMIQ_PRODUCTION_WORKER_NAME = 'lumiq-production-candidate'
    try {
      & node (Join-Path $PSScriptRoot 'put-production-worker-secret.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in @($productionSessionKeyName, 'LUMIQ_PRODUCTION_WORKER_SECRET_BINDING', 'LUMIQ_PRODUCTION_WORKER_NAME')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'set-candidate-email-secret' {
    $vault = Read-Vault
    if (-not $vault.Contains($productionEmailKeyName) -or $vault[$productionEmailKeyName] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$productionEmailKeyName'. Run save-production-email first."
    }
    Set-ProcessSecret $productionEmailKeyName $vault[$productionEmailKeyName]
    $env:LUMIQ_PRODUCTION_WORKER_SECRET_BINDING = 'PLATFORM_EMAIL_KEY'
    $env:LUMIQ_PRODUCTION_WORKER_NAME = 'lumiq-production-candidate'
    try {
      & node (Join-Path $PSScriptRoot 'put-production-worker-secret.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in @($productionEmailKeyName, 'LUMIQ_PRODUCTION_WORKER_SECRET_BINDING', 'LUMIQ_PRODUCTION_WORKER_NAME')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'set-production-session-secret' {
    $vault = Read-Vault
    if (-not $vault.Contains($productionSessionKeyName) -or $vault[$productionSessionKeyName] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$productionSessionKeyName'. Run create-production-session-key first."
    }
    Set-ProcessSecret $productionSessionKeyName $vault[$productionSessionKeyName]
    $env:LUMIQ_PRODUCTION_WORKER_SECRET_BINDING = 'PLATFORM_SESSION_ENCRYPTION_KEY'
    $env:LUMIQ_PRODUCTION_WORKER_NAME = 'lumiq-production'
    try {
      & node (Join-Path $PSScriptRoot 'put-production-worker-secret.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in @($productionSessionKeyName, 'LUMIQ_PRODUCTION_WORKER_SECRET_BINDING', 'LUMIQ_PRODUCTION_WORKER_NAME')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'set-production-email-secret' {
    $vault = Read-Vault
    if (-not $vault.Contains($productionEmailKeyName) -or $vault[$productionEmailKeyName] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$productionEmailKeyName'. Run save-production-email first."
    }
    Set-ProcessSecret $productionEmailKeyName $vault[$productionEmailKeyName]
    $env:LUMIQ_PRODUCTION_WORKER_SECRET_BINDING = 'PLATFORM_EMAIL_KEY'
    $env:LUMIQ_PRODUCTION_WORKER_NAME = 'lumiq-production'
    try {
      & node (Join-Path $PSScriptRoot 'put-production-worker-secret.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in @($productionEmailKeyName, 'LUMIQ_PRODUCTION_WORKER_SECRET_BINDING', 'LUMIQ_PRODUCTION_WORKER_NAME')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'run-runtime-check' {
    $vault = Read-Vault
    if (-not $vault.Contains($runtimeName) -or $vault[$runtimeName] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$runtimeName'. Run production-secrets.ps1 save-runtime first."
    }
    Set-ProcessSecret $runtimeName $vault[$runtimeName]
    try {
      & node (Join-Path $PSScriptRoot 'verify-production-runtime.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      [Environment]::SetEnvironmentVariable($runtimeName, $null, 'Process')
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'run-safe-runtime-check' {
    $vault = Read-Vault
    if (-not $vault.Contains($productionSafeRuntimeName) -or $vault[$productionSafeRuntimeName] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$productionSafeRuntimeName'. Run production-secrets.ps1 create-production-safe-runtime first."
    }
    Set-ProcessSecret 'LUMIQ_PRODUCTION_RUNTIME_PASSWORD' $vault[$productionSafeRuntimeName]
    $env:LUMIQ_PRODUCTION_RUNTIME_ROLE = 'lumiq_production_runtime'
    try {
      & node (Join-Path $PSScriptRoot 'verify-production-runtime.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in @('LUMIQ_PRODUCTION_RUNTIME_PASSWORD', 'LUMIQ_PRODUCTION_RUNTIME_ROLE')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
      }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
  'run-safe-runtime-bootstrap-check' {
    $vault = Read-Vault
    if (-not $vault.Contains($productionSafeRuntimeName) -or $vault[$productionSafeRuntimeName] -isnot [System.Security.SecureString]) {
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
      throw "Missing encrypted credential '$productionSafeRuntimeName'. Run production-secrets.ps1 create-production-safe-runtime first."
    }
    Set-ProcessSecret 'LUMIQ_PRODUCTION_RUNTIME_PASSWORD' $vault[$productionSafeRuntimeName]
    $env:LUMIQ_PRODUCTION_RUNTIME_ROLE = 'lumiq_production_runtime'
    $env:LUMIQ_PRODUCTION_RUNTIME_PHASE = 'bootstrap'
    try {
      & node (Join-Path $PSScriptRoot 'verify-production-runtime.mjs')
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      foreach ($name in @('LUMIQ_PRODUCTION_RUNTIME_PASSWORD', 'LUMIQ_PRODUCTION_RUNTIME_ROLE', 'LUMIQ_PRODUCTION_RUNTIME_PHASE')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
      }
      foreach ($value in $vault.Values) { if ($value -is [System.Security.SecureString]) { $value.Dispose() } }
    }
  }
}
