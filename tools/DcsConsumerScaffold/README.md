# DCS Input Profile Importer (WPF)

Windows shell for the Option A scaffold flow. **Requires Node.js on PATH** and **.NET 10** SDK for local builds.

Publisher: **Vyper Industries** · TFM: `net10.0-windows` · Assembly: `DcsConsumerScaffold.exe`

## Capabilities

1. **Load Preview** — `scaffold-consumer.mjs --preview-json`
2. **Physical device roles** — review every GUID-distinct device and optionally name repeated instances (for example, `left-tank-control` and `right-tank-control`)
3. **MOZA AB9 configuration** — select standalone, F-16C Viper Grip, or F/A-18C/E/F Grip
4. **Semantic modifiers** — assign one semantic ID to alternative device-qualified physical modifiers without globally aliasing button numbers
5. **Editable labels** — initialize each label from the imported DCS Lua command name, show the DCS-Common `hardwareLabel` separately as **Device Label**, and edit, intentionally blank, or replace the label with the device label
6. **Current device labels** — import the selected device's labels from an existing destination repository, filling undefined labels from DCS-Common shared hardware
7. **Per-device kneeboard preview** — render the selected physical instance through the production SVG/PNG pipeline in a modal viewer before writing the consumer repository
8. **Proceed** — writes a consumer tree (`--output-dir` + display name / input module / kneeboard IDs)

The selected grip is applied only to generic MOZA AB9 profiles and is preserved as the generated page `deviceId`. No JSON override file is required in the WPF importer; the preview grids show how each mapping and physical instance was resolved. Repeated devices automatically receive stable GUID-backed profile keys. Entering a role gives that physical instance a readable, GUID-associated alias in the generated consumer.

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
