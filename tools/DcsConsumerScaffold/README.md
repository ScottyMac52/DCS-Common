# DCS Input Profile Importer (WPF)

Windows shell for the Option A scaffold flow. **Requires Node.js on PATH** and **.NET 10** SDK for local builds.

Publisher: **Vyper Industries** · TFM: `net10.0-windows`

## Capabilities

1. **Load Preview** — `scaffold-consumer.mjs --preview-json`
2. **Proceed** — writes a consumer tree (`--output-dir` + display name / input module / kneeboard IDs)

Installer (tag `vX.X.X.X`): Inno Setup via shared-github-workflows. The installed EXE still expects **Node on PATH** and a DCS-Common checkout (`DCS_COMMON_ROOT` or browse).

## Dev run

```powershell
cd tools/DcsConsumerScaffold
dotnet build
dotnet run --project src/DcsConsumerScaffold
```

## Tests

```powershell
dotnet test tools/DcsConsumerScaffold/DcsConsumerScaffold.sln -c Release
```

## Release tags

Use **four-part** tags only for this app, e.g. `v1.0.0.0`. OvGME consumer packages continue to use three-part `vMAJOR.MINOR.PATCH` tags in their own repos.
