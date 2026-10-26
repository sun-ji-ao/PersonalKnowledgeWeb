param([string]$Config = "$PSScriptRoot\offsite-backup.json")
$ErrorActionPreference = 'Stop'
try {
    $settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
    New-Item -ItemType Directory -Force -Path $settings.destination | Out-Null
    $log = Join-Path $settings.destination 'offsite-sync.log'
    Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) Starting offsite backup"
    # Windows PowerShell 5.1 treats native stderr as ErrorRecord objects. Do not
    # let a diagnostic abort the pipeline before capturing the native exit code.
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $node "$PSScriptRoot\..\scripts\backup-maintenance.mjs" sync $Config 2>&1 | Out-File -LiteralPath $log -Append -Encoding UTF8
        $result = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) ExitCode=$result"
    exit $result
} catch {
    if ($log) { Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) FAILED: $($_.Exception.Message)" }
    Write-Error $_ -ErrorAction Continue
    exit 1
}
