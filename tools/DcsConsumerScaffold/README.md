# DCS Input Profile Importer (WPF)

Windows shell for the Option A scaffold flow. **Requires Node.js on PATH** and **.NET 10** SDK for local builds.

Publisher: **Vyper Industries** · TFM: `net10.0-windows` · Assembly: `DcsConsumerScaffold.exe`

## Capabilities

1. **Scaffolding solutions** — open, save, revise, and delete versioned JSON workspaces containing every normal importer input and reviewed decision
2. **Load Preview** — `scaffold-consumer.mjs --preview-json`
3. **Physical device roles** — review every GUID-distinct device and optionally name repeated instances (for example, `left-tank-control` and `right-tank-control`)
4. **MOZA AB9 configuration** — select standalone, F-16C Viper Grip, or F/A-18C/E/F Grip
5. **Semantic modifiers** — assign one semantic ID to alternative device-qualified physical modifiers without globally aliasing button numbers
6. **Editable labels** — initialize each label from the imported DCS Lua command name, show the DCS-Common `hardwareLabel` separately as **Device Label**, and edit, intentionally blank, or replace the label with the device label
7. **Command labels** — edit one label per exact DCS command and explicitly apply it to every matching device binding while retaining per-binding overrides
8. **Current and default labels** — Load Preview automatically imports labels for every device from an existing destination repository; undefined labels fall back to DCS-Common shared hardware. Use per-device **Current** to refresh repository labels or **Default** to restore the imported DCS label values.
9. **Per-device kneeboard preview** — render the selected physical instance through the production SVG/PNG pipeline in a modal viewer before writing the consumer repository
10. **Import target** — choose a normal consumer module or the authoritative DCS-Common UI Layer
11. **Proceed** — writes a consumer tree in consumer mode, or safely synchronizes only `assets/shared/ui-layer` in UI Layer mode
12. **Definitive UI Layer Editor** — load the complete canonical catalog without connected devices, inspect profiles/bindings/modifiers, reconcile an imported UiLayer folder with explicit per-file actions, validate, and save atomically

The selected grip is applied only to generic MOZA AB9 profiles and is preserved as the generated page `deviceId`. No JSON override file is required in the WPF importer; the preview grids show how each mapping and physical instance was resolved. Repeated devices automatically receive stable GUID-backed profile keys. Entering a role gives that physical instance a readable, GUID-associated alias in the generated consumer.

In consumer mode, selecting or pasting a profiles directory below `Config/Input/<module>` defaults **Display name**, **Input module ID**, and **Kneeboard ID** to the exact module-folder name. Each default remains independently editable; changing profiles later updates only blank or still-inferred values and preserves manual edits.

When the output directory is an existing consumer, repository-only devices are preserved by default. Their red **Unused** state means “not observed in this scaffold session,” not “delete.” Check **Remove** on a repository-only device to request explicit deletion. This protects disconnected and axis-only controllers such as the TPR rudder. The definitive UI Layer is maintained separately; module packaging emits only devices whose referenced module profiles contain effective added keys/buttons/POVs or axes.

Authoritative UI Layer previews render the selected Saved Games profiles directly and do not compose the shared UI Layer overlay back onto itself. Consumer previews continue to add the applicable shared overlay. In UI Layer mode, consumer-only identity/output fields are disabled, the source `modifiers.lua` and DCS-Common root are required, and **Proceed** remains disabled until all blocking preview errors (including unknown modifiers) are corrected.

Installer (tag `vX.X.X.X`): Inno Setup via shared-github-workflows. The installed EXE still expects **Node on PATH** and a DCS-Common checkout (`DCS_COMMON_ROOT` or browse).

## Reuse a scaffolding solution

The main importer can save its complete workspace as an indented, versioned `.dcs-scaffold.json` file. This includes the import target, paths, MOZA grip choice, consumer identities, device roles, semantic modifiers, binding-label overrides, MFD side categories, and explicit repository-only removal requests.

- **Open…** validates a solution and populates the form without running Node or writing any repository.
- Select **Load Preview** to re-read the current DCS profiles and reconcile saved decisions by their stable identifiers.
- Unmatched decisions are retained in the solution and reported instead of being guessed or discarded.
- **Save** atomically replaces the open solution; **Save As…** creates a separate solution.
- **Delete…** confirms the exact JSON path and deletes only that file. The current values remain in the importer as an unsaved workspace.
- Relative paths are interpreted from the solution file's directory. Absolute paths are recommended for machine-local solutions.
- Invalid JSON and unsupported schema versions leave the current workspace unchanged.

The solution file never contains generated previews, generated consumer content, credentials, or any state from the **Definitive UI Layer Editor**. A solution controls the normal preview/scaffold workflow only.

## Synchronize labels by command

After **Load Preview**, the **Command labels** grid contains one row per distinct, non-empty exact DCS command string.

- **Bindings** shows how many physical rows use the command.
- **Synchronized** means every matching row currently has the same label.
- **Mixed** means one or more individual rows have a different label.
- Edit **Synchronized label** and press **Apply** to replace the label on every matching row across devices, instances, keys, and modifier chords.
- An empty value is applied as an intentional blank.
- The detailed binding grid remains editable. Changing one row affects only that row and changes its command group to **Mixed**.
- **Current** and **Use device** changes are reflected in the command group automatically.

Grouping is a preview/editor feature only. Proceed still persists the existing row-level label overrides, so consumer and UI Layer JSON schemas are unchanged.

## Import the authoritative UI Layer

For definitive maintenance, prefer **Open Definitive UI Layer Editor…**. It loads the complete DCS-Common catalog independently of connected hardware and reconciles a Saved Games UiLayer folder through explicit Keep/Add/Replace/Remove decisions. Save validates a staged catalog and swaps it into place atomically.

Use this mode after changing the simulator-wide bindings under DCS Saved Games.

1. Set **Import target** to **DCS-Common authoritative UI Layer**.
2. Select `Saved Games/DCS/Config/Input/UiLayer/joystick` as **Profiles directory**.
3. Select the matching `Saved Games/DCS/Config/Input/UiLayer/modifiers.lua`.
4. Select the DCS-Common checkout as **DCS-Common root**.
5. Click **Load Preview**, resolve any unmapped devices or modifier errors, and review device previews. When the output directory is an existing consumer repository, its current labels are loaded automatically; only bindings without a current repository label fall back to the DCS-Common device label.
6. Click **Proceed** to synchronize the profiles and modifier file, preserve known function IDs and curated labels, add newly discovered functions, and update applicable hardware-overlay callouts.

UI Layer mode does not use **Output directory**, **Display name**, **Input module ID**, or **Kneeboard ID**, and it never scaffolds consumer files into the DCS-Common root. Existing overlay instance restrictions and exemptions are retained.

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
