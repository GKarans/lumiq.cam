$ErrorActionPreference = 'Stop'

$taskName = 'Lumiq Production Daily Backup'
$vaultRunner = Join-Path $PSScriptRoot 'production-secrets.ps1'
if (-not (Test-Path -LiteralPath $vaultRunner)) { throw 'The Production DPAPI backup runner is missing.' }

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  $expectedArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$vaultRunner`" run-backup"
  $actionMatches = $existing.Actions.Count -eq 1 -and
    $existing.Actions[0].Execute -eq (Join-Path $PSHOME 'powershell.exe') -and
    $existing.Actions[0].Arguments -eq $expectedArgs
  $triggerMatches = $existing.Triggers.Count -eq 1 -and $existing.Triggers[0].CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger'
  $principalMatches = $existing.Principal.UserId -eq [Security.Principal.WindowsIdentity]::GetCurrent().Name -and
    $existing.Principal.LogonType -eq 'InteractiveToken'
  if (-not ($actionMatches -and $triggerMatches -and $principalMatches)) {
    throw "A scheduled task named '$taskName' already exists with a different configuration; it was not changed."
  }
  Write-Output "The existing '$taskName' task is already configured for this user."
  exit 0
}

$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$vaultRunner`" run-backup"
$trigger = New-ScheduledTaskTrigger -Daily -At '2:30AM'
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Creates a read-only Lumiq Production database/Auth and photo R2 backup in the private EU backup bucket.' | Out-Null
Write-Output "Registered '$taskName' daily at 02:30 Riga time. It runs only while this Windows user is signed in; missed runs start when available."
