[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$PackagePrefix,
    [Parameter(Mandatory=$true)][string]$BundlePrefix
)

$ErrorActionPreference = 'Stop'
$ConsumerRoot = (Get-Location).Path
$OvgmeName = "$PackagePrefix-$Version.zip"
$BundleName = "$BundlePrefix-$Version"
$Dist = Join-Path $ConsumerRoot 'dist'
$OvgmeArchive = Join-Path $Dist $OvgmeName
$BuildRoot = Join-Path $ConsumerRoot '.build/release'
$BundleRoot = Join-Path $BuildRoot $BundleName
$BundleArchive = Join-Path $Dist "$BundleName.zip"

if (-not (Test-Path $OvgmeArchive -PathType Leaf)) { throw "Missing OVGME archive: $OvgmeArchive." }

Remove-Item $BuildRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item (Join-Path $BundleRoot 'OVGME') -ItemType Directory -Force | Out-Null
New-Item (Join-Path $BundleRoot 'Documentation') -ItemType Directory -Force | Out-Null

Copy-Item $OvgmeArchive (Join-Path $BundleRoot 'OVGME')
Copy-Item (Join-Path $ConsumerRoot 'README.md') (Join-Path $BundleRoot 'Documentation/README.md') -ErrorAction SilentlyContinue
Copy-Item (Join-Path $ConsumerRoot 'docs/*') (Join-Path $BundleRoot 'Documentation') -Recurse -ErrorAction SilentlyContinue

$BundleChecksums = foreach ($File in (Get-ChildItem $BundleRoot -Recurse -File)) {
    $Hash = Get-FileHash $File.FullName -Algorithm SHA256
    $RelativePath = [IO.Path]::GetRelativePath($BundleRoot, $File.FullName).Replace('\', '/')
    "$($Hash.Hash.ToLowerInvariant())  $RelativePath"
}
$BundleChecksums | Set-Content (Join-Path $BundleRoot 'SHA256SUMS.txt') -Encoding utf8

Remove-Item $BundleArchive -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $BundleRoot -DestinationPath $BundleArchive -CompressionLevel Optimal

$ReleaseChecksums = Get-ChildItem (Join-Path $Dist '*.zip') | Sort-Object Name | ForEach-Object {
    $Hash = Get-FileHash $_.FullName -Algorithm SHA256
    "$($Hash.Hash.ToLowerInvariant())  $($_.Name)"
}
$ReleaseChecksums | Set-Content (Join-Path $Dist 'SHA256SUMS.txt') -Encoding utf8

Write-Host "Created $BundleArchive"
