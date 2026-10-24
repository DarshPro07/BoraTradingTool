# docs/plans/cloud-clock: make the key that seals the cloud clock's ledger.
# Writes LEDGER_KEY to .env.local (gitignored) and copies it to the clipboard. It never prints the key.
# Then paste it on GitHub: the repository > Settings > Secrets and variables > Actions >
# New repository secret, name LEDGER_KEY. Afterwards copy something else to clear the clipboard.
$ErrorActionPreference = 'Stop'
$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env.local'
if ((Test-Path $envFile) -and (Select-String -Path $envFile -Pattern '^LEDGER_KEY=' -Quiet)) {
  'LEDGER_KEY is already in .env.local. Nothing changed.'
  exit 1
}
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = [Convert]::ToBase64String($bytes)
Add-Content -Path $envFile -Value "LEDGER_KEY=$key"
Set-Clipboard -Value $key
'LEDGER_KEY written to .env.local and copied to the clipboard.'
'Paste it on GitHub: Settings > Secrets and variables > Actions > New repository secret, name LEDGER_KEY.'
