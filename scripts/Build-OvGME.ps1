[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$ModuleName,
    [Parameter(Mandatory=$true)][string]$KneeboardId,
    [Parameter(Mandatory=$true)][string]$PackagePrefix
)

$ErrorActionPreference = 'Stop'
$ConsumerRoot = (Get-Location).Path
$CommonRoot = if ($env:DCS_COMMON_ROOT) { $env:DCS_COMMON_ROOT } else { Join-Path $ConsumerRoot '.dcs-common' }
$UiLayerSource = Join-Path $CommonRoot 'assets/shared/ui-layer/input/UiLayer'
$UiLayerPackager = Join-Path $CommonRoot 'scripts/package-ui-layer-input.mjs'
if (-not (Test-Path $UiLayerSource)) { throw "Missing shared UI Layer input payload: $UiLayerSource" }
if (-not (Test-Path $UiLayerPackager)) { throw "Missing shared UI Layer packager: $UiLayerPackager" }
$PackageName = "$PackagePrefix-$Version"
$BuildRoot = Join-Path $ConsumerRoot '.build/ovgme'
$StageRoot = Join-Path $BuildRoot 'stage'
$Container = Join-Path $StageRoot $PackageName
$Dist = Join-Path $ConsumerRoot 'dist'
$Archive = Join-Path $Dist "$PackageName.zip"

Remove-Item $BuildRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item (Join-Path $Container "Config/Input/$ModuleName") -ItemType Directory -Force | Out-Null
New-Item (Join-Path $Container "KNEEBOARD/$KneeboardId") -ItemType Directory -Force | Out-Null
New-Item (Join-Path $StageRoot 'LICENSES') -ItemType Directory -Force | Out-Null
New-Item $Dist -ItemType Directory -Force | Out-Null

Copy-Item (Join-Path $ConsumerRoot "src/Config/Input/$ModuleName/joystick") (Join-Path $Container "Config/Input/$ModuleName/joystick") -Recurse
$ConsumerJoystick = Join-Path $ConsumerRoot "src/Config/Input/$ModuleName/joystick"
$UiLayerDestination = Join-Path $Container 'Config/Input/UiLayer'
& node $UiLayerPackager $CommonRoot $ConsumerJoystick $UiLayerDestination (Join-Path $ConsumerRoot 'config/kneeboard.json')
if ($LASTEXITCODE -ne 0) { throw "UI Layer packaging failed with exit code $LASTEXITCODE" }
Copy-Item (Join-Path $ConsumerRoot "kneeboard/$KneeboardId/*") (Join-Path $Container "KNEEBOARD/$KneeboardId")
Copy-Item (Join-Path $ConsumerRoot 'docs/THIRD-PARTY-ASSETS.md') (Join-Path $StageRoot 'THIRD-PARTY-ASSETS.md') -ErrorAction SilentlyContinue
Copy-Item (Join-Path $ConsumerRoot 'kneeboard/assets/source/licenses/*') (Join-Path $StageRoot 'LICENSES') -ErrorAction SilentlyContinue

$ReadmeTemplate = Get-Content (Join-Path $ConsumerRoot 'packaging/ovgme/README.TXT') -Raw
if (-not $ReadmeTemplate.Contains('{{VERSION}}')) { throw 'OVGME README.TXT does not contain the {{VERSION}} token.' }
$ReadmeTemplate.Replace('{{VERSION}}', $Version) | Set-Content (Join-Path $StageRoot 'README.TXT') -Encoding utf8
$Version | Set-Content (Join-Path $StageRoot 'VERSION.TXT') -Encoding utf8

Remove-Item $Archive -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $Container, (Join-Path $StageRoot 'README.TXT'), (Join-Path $StageRoot 'VERSION.TXT') -DestinationPath $Archive -CompressionLevel Optimal

Write-Host "Created $Archive"
