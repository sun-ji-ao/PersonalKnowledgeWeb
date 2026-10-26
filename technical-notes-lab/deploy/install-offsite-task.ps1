param([switch]$UpdateExisting, [string]$Config = "$PSScriptRoot\offsite-backup.json")
$ErrorActionPreference = 'Stop'
$Config = (Resolve-Path -LiteralPath $Config -ErrorAction Stop).ProviderPath
$configuration = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$taskName = 'TechnicalNotes-OffsiteBackup'
$script = Join-Path $PSScriptRoot 'sync-offsite-backup.ps1'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and -not $UpdateExisting) {
    throw "Task already exists: $taskName. Inspect it before changing its configuration."
}
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Config `"$Config`"" -WorkingDirectory $PSScriptRoot
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$triggers = @((New-ScheduledTaskTrigger -Daily -At '20:00'), (New-ScheduledTaskTrigger -AtLogOn -User $user))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
if ($existing) {
    if ($existing.State -eq 'Running') { throw 'Backup task is running; wait for completion before updating it.' }
    if ($existing.Actions.Count -ne 1 -or -not $existing.Actions[0].Arguments.Contains($script)) {
        throw 'Existing task does not point to this backup script; no changes made.'
    }
    $history = Join-Path $configuration.destination 'task-history'
    New-Item -ItemType Directory -Force -Path $history | Out-Null
    $saved = Join-Path $history "TechnicalNotes-OffsiteBackup-$([guid]::NewGuid().ToString()).xml"
    Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $saved -Encoding Unicode
    # Preserve the existing principal and daily schedule; add login catch-up once.
    $triggers = @($existing.Triggers)
    if (-not ($triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })) {
        $triggers += New-ScheduledTaskTrigger -AtLogOn -User $user
    }
    $settings = $existing.Settings
    $settings.StartWhenAvailable = $true
    $settings.RestartCount = 3
    $settings.RestartInterval = 'PT15M'
    $settings.ExecutionTimeLimit = 'PT20M'
    Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings | Select-Object TaskName, State
} else {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Download and verify the latest technical-notes backup; retry failures and catch up at login; no automatic deletion.' | Select-Object TaskName, State
}
