# DCS Input Profile Importer (WPF)

Windows shell for the Option A scaffold flow. **Requires Node.js on PATH** and **.NET 10** SDK for local builds.

Publisher: **Vyper Industries** · TFM: `net10.0-windows` · Assembly: `DcsConsumerScaffold.exe`

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

## Tag-based release (GitHub Release + setup.exe)

App versions use **four-part** tags only, e.g. `v1.0.0.0`. Consumer OvGME packages keep three-part `vMAJOR.MINOR.PATCH` tags in their own repos.

1. Ensure `main` is green for scaffold CI.
2. Create and push a tag on the release commit:

```bash
git checkout main
git pull
git tag -a v1.0.0.0 -m "DCS Input Profile Importer v1.0.0.0"
git push origin v1.0.0.0
```

3. Workflow **Scaffold app CI / Build / Release** → job **Full Build + Inno Release (Tag)** runs:
   - `dotnet` test + publish single-file win-x64 EXE
   - Inno Setup from `installer/installer.iss` (publisher **Vyper Industries**)
   - GitHub Release with `DcsConsumerScaffold_v1.0.0.0.zip` and `_setup/setup.exe`

Do **not** use three-part tags (`v1.0.0`) for this app — the shared workflow rejects them.
