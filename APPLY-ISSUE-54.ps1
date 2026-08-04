$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest = Join-Path $RepoRoot 'assets/shared/hardware/manifest.json'
if (-not (Test-Path $Manifest)) {
    throw 'Extract this ZIP into the root of your DCS-Common repository before running this script.'
}

$SupersededImage = Join-Path $RepoRoot 'assets/shared/hardware/source/vkb-grip-clean.png'
if (Test-Path $SupersededImage) {
    Remove-Item -LiteralPath $SupersededImage -Force
    Write-Host 'Removed superseded source/vkb-grip-clean.png.'
}

Write-Host 'Issue #54 files are installed. Run npm test, then review and commit the changes.'
