$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This test requires Windows DPAPI.' }

foreach ($file in @('../scripts/production-secrets.ps1', '../scripts/backup-production.ps1')) {
  $path = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $file))
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { throw "PowerShell parse error in $path`: $($errors[0].Message)" }
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testDirectory = Join-Path $tempRoot ('lumiq-vault-test-' + [guid]::NewGuid().ToString('N'))
$testFile = Join-Path $testDirectory 'vault.clixml'
$probe = 'synthetic-dpapi-vault-probe-not-a-credential'
$secure = ConvertTo-SecureString $probe -AsPlainText -Force

try {
  New-Item -ItemType Directory -Path $testDirectory | Out-Null
  @{ TEST = $secure } | Export-Clixml -LiteralPath $testFile
  $serialized = Get-Content -LiteralPath $testFile -Raw
  if ($serialized.Contains($probe)) { throw 'Serialized vault contains the plaintext probe.' }

  $loaded = Import-Clixml -LiteralPath $testFile
  if ($loaded.TEST -isnot [Security.SecureString]) { throw 'Serialized value did not reload as SecureString.' }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($loaded.TEST)
  try { $roundTrip = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $loaded.TEST.Dispose()
  }
  if ($roundTrip -ne $probe) { throw 'DPAPI round-trip failed under the current Windows user.' }
  Write-Output 'PowerShell syntax and DPAPI round-trip passed; no plaintext probe was stored.'
} finally {
  $secure.Dispose()
  $resolvedDirectory = [IO.Path]::GetFullPath($testDirectory)
  if (-not $resolvedDirectory.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing cleanup outside the system temporary directory.'
  }
  if (Test-Path -LiteralPath $testFile) { Remove-Item -LiteralPath $testFile -Force }
  if (Test-Path -LiteralPath $testDirectory) { Remove-Item -LiteralPath $testDirectory -Force }
}
