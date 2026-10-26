$ErrorActionPreference = 'Stop'
$evidenceRoot = $PSScriptRoot
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $evidenceRoot '../../..')).Path
$applicationRoot = Join-Path $workspaceRoot 'technical-notes-lab'
$sourceManifest = Get-Content -LiteralPath (Join-Path $evidenceRoot 'source-manifest.json') -Raw | ConvertFrom-Json
$protectedManifest = Get-Content -LiteralPath (Join-Path $evidenceRoot 'protected-manifest.json') -Raw | ConvertFrom-Json
$environmentRecord = Get-Content -LiteralPath (Join-Path $evidenceRoot 'environment.json') -Raw | ConvertFrom-Json
$zipPath = Join-Path $evidenceRoot 'source-baseline.zip'
if ((Get-FileHash -LiteralPath $zipPath).Hash -ne $environmentRecord.archiveSha256) { throw 'Source ZIP hash mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipArchive = [IO.Compression.ZipFile]::OpenRead($zipPath)
$syntaxCount = 0
try {
    foreach ($item in $sourceManifest) {
        $sourcePath = Join-Path $applicationRoot $item.path
        if ((Get-FileHash -LiteralPath $sourcePath).Hash -ne $item.sha256) { throw "Source changed: $($item.path)" }
        $entry = @($zipArchive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq $item.path })
        if ($entry.Count -ne 1) { throw "Missing or duplicate ZIP entry: $($item.path)" }
        $entryStream = $entry[0].Open()
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $entryHash = [BitConverter]::ToString($hasher.ComputeHash($entryStream)).Replace('-','') }
        finally { $entryStream.Dispose(); $hasher.Dispose() }
        if ($entryHash -ne $item.sha256) { throw "ZIP content mismatch: $($item.path)" }
        if ($item.path -match '\.(mjs|js)$') {
            & node --check $sourcePath
            if ($LASTEXITCODE -ne 0) { throw "Syntax failed: $($item.path)" }
            $syntaxCount++
        }
    }
    if (@($zipArchive.Entries | Where-Object { $_.Length -gt 0 }).Count -ne $sourceManifest.Count) { throw 'Unexpected ZIP files' }
} finally { $zipArchive.Dispose() }
foreach ($item in $protectedManifest) {
    if ((Get-FileHash -LiteralPath (Join-Path $workspaceRoot $item.path)).Hash -ne $item.sha256) { throw "Legacy source changed: $($item.path)" }
}
$actualLegacyCount = @(Get-ChildItem -LiteralPath (Join-Path $workspaceRoot 'bypassAV-study-main') -File -Recurse -Filter '*.md').Count
if ($actualLegacyCount -ne $protectedManifest.Count) { throw 'Legacy source count changed' }
Write-Output "PASS: $($sourceManifest.Count) application files unchanged; ZIP entries and archive SHA256 verified."
Write-Output "PASS: $syntaxCount JavaScript syntax checks."
Write-Output "PASS: $($protectedManifest.Count) original Markdown files unchanged; count reconciled."
Write-Output 'LIMIT: Running default SQLite database was not backed up or hashed. Existing tests use isolated temporary DATA_DIR.'
