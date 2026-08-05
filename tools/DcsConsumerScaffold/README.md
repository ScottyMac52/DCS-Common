# DCS Input Profile Importer (WPF)

Windows shell for the Option A scaffold flow. **Requires Node.js on PATH** and **.NET 10** SDK for local builds.

## Status

- **Preview only** — calls `scripts/scaffold-consumer.mjs --preview-json`
- Proceed / consumer tree write / Inno installer: later phases
- Target framework: `net10.0-windows`

## Dev run

```powershell
cd tools/DcsConsumerScaffold
dotnet build
dotnet run --project src/DcsConsumerScaffold
```

Optional: set `DCS_COMMON_ROOT` to the DCS-Common repo root if auto-discovery fails.

## Tests

```powershell
dotnet test tools/DcsConsumerScaffold/DcsConsumerScaffold.sln -c Release
```

## CI

`.github/workflows/scaffold-app.yml` uses [shared-github-workflows](https://github.com/ScottyMac52/shared-github-workflows) with `dotnet_version: 10.0.x` (`enable_installer: false` until Phase 4).
