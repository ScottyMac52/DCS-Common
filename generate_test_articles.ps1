[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'tmp\mock-consumer')
)

$ErrorActionPreference = 'Stop'

$commonRoot = $PSScriptRoot
$generator = Join-Path $commonRoot 'scripts\generate-test-articles.mjs'
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)

if (-not (Test-Path -LiteralPath $generator -PathType Leaf)) {
    throw "Mock generator was not found: $generator"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required but node was not found on PATH.'
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

Write-Host "Generating test kneeboards in $outputRoot"
& node $generator $outputRoot $commonRoot

if ($LASTEXITCODE -ne 0) {
    throw "Mock generator failed with exit code $LASTEXITCODE."
}

$kneeboardConfig = Join-Path $outputRoot 'config\kneeboard.json'
$profileDirectory = Join-Path $outputRoot 'src\Config\Input\Test\joystick'
$kneeboardDirectory = Join-Path $outputRoot 'kneeboard\Test'

if (-not (Test-Path -LiteralPath $kneeboardConfig -PathType Leaf)) {
    throw "Expected kneeboard configuration was not generated: $kneeboardConfig"
}

if (-not (Test-Path -LiteralPath $profileDirectory -PathType Container)) {
    throw "Expected mock profile directory was not generated: $profileDirectory"
}

if (-not (Test-Path -LiteralPath $kneeboardDirectory -PathType Container)) {
    throw "Expected kneeboard output directory was not generated: $kneeboardDirectory"
}

$profileCount = @(Get-ChildItem -LiteralPath $profileDirectory -Filter '*.diff.lua' -File).Count
$kneeboardCount = @(Get-ChildItem -LiteralPath $kneeboardDirectory -Filter '*.png' -File).Count

Write-Host 'Test articles generated successfully.'
Write-Host "Kneeboard configuration: $kneeboardConfig"
Write-Host "Mock profiles: $profileCount in $profileDirectory"
Write-Host "Kneeboard PNGs: $kneeboardCount in $kneeboardDirectory"
