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
13. **DCS Command Browser (first slice)** — import a versioned module command catalog after Load Preview, then search and filter it by DCS name, category, canonical binding key, type, and bound/unbound state
14. **Axis tuning** — select any assigned axis in the interactive device preview and choose **Tune axis…** to edit deadzone, X/Y saturation, curvature, inversion, and slider mode. Values are shown as DCS-style percentages and are written to the binding's native `filter` table when **Proceed** runs.

The selected grip is applied only to generic MOZA AB9 profiles and is preserved as the generated page `deviceId`. No JSON override file is required in the WPF importer; the preview grids show how each mapping and physical instance was resolved. Repeated devices automatically receive stable GUID-backed profile keys. Entering a role gives that physical instance a readable, GUID-associated alias in the generated consumer.

In consumer mode, selecting or pasting a profiles directory below `Config/Input/<module>` defaults **Display name**, **Input module ID**, and **Kneeboard ID** to the exact module-folder name. Each default remains independently editable; changing profiles later updates only blank or still-inferred values and preserves manual edits.

When the output directory is an existing consumer, repository-only devices are preserved by default. Their red **Unused** state means “not observed in this scaffold session,” not “delete.” Check **Remove** on a repository-only device to request explicit deletion. This protects disconnected and axis-only controllers such as the TPR rudder. The definitive UI Layer is maintained separately; module packaging emits only devices whose referenced module profiles contain effective added keys/buttons/POVs or axes.

Authoritative UI Layer previews render the selected Saved Games profiles directly and do not compose the shared UI Layer overlay back onto itself. Consumer previews continue to add the applicable shared overlay. In UI Layer mode, consumer-only identity/output fields are disabled, the source `modifiers.lua` and DCS-Common root are required, and **Proceed** remains disabled until all blocking preview errors (including unknown modifiers) are corrected.

Axis filters are first-class profile data. IPI preserves existing tuning when it merges repository assignments or moves an axis to a different DCS command. Tuning can be staged independently of a command change, appears in the selected-control panel, participates in Undo/Restore, and is validated before any destination file is written. Valid ranges match DCS storage: deadzone and saturation are 0–100%, curvature entries are -100–100%, and invert/slider are Boolean. IPI preserves DCS's sparse filter shape: only non-default tuning values are written, so an invert-only axis remains `{ ["invert"] = true }`. **DCS defaults** removes the binding's `filter` table.

Installer (tag `vX.X.X.X`): Inno Setup via shared-github-workflows. The installed EXE still expects **Node on PATH** and a DCS-Common checkout (`DCS_COMMON_ROOT` or browse).

## Reuse a scaffolding solution

The main importer can save its complete workspace as an indented, versioned `.dcs-scaffold.json` file. This includes the import target, paths, MOZA grip choice, consumer identities, device roles, semantic modifiers, and explicit repository-only removal requests.

- **Open…** validates a solution and populates the form without running Node or writing any repository.
- Select **Load Preview** to re-read the current DCS profiles and reconcile saved non-label decisions by their stable identifiers. Every consumer preview discards labels from the previous in-memory preview, then reloads binding labels and MFD side categories from the destination repository’s current `config/kneeboard.json`.
- Unmatched decisions are retained in the solution and reported instead of being guessed or discarded.
- **Save** atomically replaces the open solution; **Save As…** creates a separate solution.
- **Delete…** confirms the exact JSON path and deletes only that file. The current values remain in the importer as an unsaved workspace.
- Relative paths are interpreted from the solution file's directory. Absolute paths are recommended for machine-local solutions.
- Invalid JSON and unsupported schema versions leave the current workspace unchanged.

The solution file never contains binding labels or MFD side-category labels. Those values always come from the destination repository’s current `config/kneeboard.json` when **Load Preview** runs, keeping that file authoritative and preventing saved solutions from reviving stale or orphaned labels. Legacy solution files containing `labelOverrides` or `mfdCategories` are accepted, but those properties are ignored and removed the next time the solution is saved. The solution also never contains generated previews, generated consumer content, credentials, or any state from the **Definitive UI Layer Editor**.

## Synchronize labels by command

After **Load Preview**, the **Command labels** grid contains one row per distinct, non-empty exact DCS command string.

- The command list shows the DCS command ID, its human-readable command name, and the semantic modifier chord.
- Commands are synchronized independently per semantic modifier chord, so shifted and unshifted uses of the same DCS command can have different labels without becoming **Mixed**.
- **Bindings** shows how many physical rows use the command and modifier chord.
- **Synchronized** means every matching row currently has the same label.
- **Mixed** means one or more individual rows have a different label.
- Edit **Synchronized label** and press **Apply** to replace the label on every matching row across devices, instances, and keys for that command and semantic modifier chord.
- An empty value is applied as an intentional blank.
- The detailed binding grid remains editable. Changing one row affects only that row and changes its command group to **Mixed**.
- **Current** and **Use device** changes are reflected in the command group automatically.

Grouping is a preview/editor feature only. Proceed still persists the existing row-level label overrides, so consumer and UI Layer JSON schemas are unchanged.

## Browse a module command catalog

In DCS Controls, select the module and choose **Generate HTML**. DCS writes one HTML file per displayed input device. After **Load Preview**, choose **Load DCS HTML…** under **DCS Commands**, select every generated HTML file for that module, and open them together.

The importer joins the files into one authoritative catalog, deduplicated by the exact DCS command hash. Repeated hashes must have the same DCS name and category in every device export. Each effective base or modified combo is retained with its device as provenance and binding-state evidence. The source fingerprint covers every selected file and is independent of selection order.

DCS-generated HTML is the only command-catalog extraction source. The importer does not inspect or execute installed `default.lua`, does not require an installation path, and does not use runtime `iCommand*` capture. The export does not include a DCS version, so the importer leaves that value unset instead of guessing it.

**Import catalog…** reloads a previously saved schemaVersion 1 catalog. The importer rejects a mismatched module ID, unsupported schema, duplicate canonical keys, missing identities, and unknown command types before replacing the current browser contents.

Choose **Save catalog…** from either assignment screen to save the complete loaded module catalog as schemaVersion 1 JSON. The saved file retains action fields, source provenance, effective device/combo assignments, and the source fingerprint, and can later be loaded directly with **Import catalog…**.

To change a physical binding, use the side-by-side assignment workspace: select an **Assignable** catalog command on the left, select a compatible button or axis control on the right, and choose **Stage selected replacement**. Step 2 automatically shows only controls matching the selected command type and can be filtered by **Bound/Unbound** state and chord (including no chord). Bound controls come from the selected `.diff.lua` profiles; unbound controls are derived from each resolved DCS-Common hardware catalog for the base layer and every loaded modifier. The selected row's chord is preserved in the staged assignment. **Proceed** may create a new binding only when that exact device, input, and chord was present in the validated hardware-catalog preview; stale or invented controls are rejected. The selected Saved Games source files are never modified.

Search includes the localized name, raw name, DCS category path, canonical binding key/control ID, and aliases. The category, button/axis, and bound/unbound filters can be combined. Bound state uses an exact, case-sensitive comparison with command identities in the loaded profile; display names are never used as identities.

Minimal schemaVersion 1 example:

```json
{
  "schemaVersion": 1,
  "dcsVersion": "2.9",
  "moduleId": "FA-18C_hornet",
  "locale": "en",
  "generatedAt": "2026-09-07T00:00:00Z",
  "sourceFingerprint": "user-generated",
  "commands": [
    {
      "bindingKey": "d3001pnilu3001cd1vd1vpnilvu0",
      "name": "Example command",
      "rawName": "Example command",
      "categoryPath": ["HOTAS"],
      "type": "button",
      "aliases": ["Example switch"],
      "actions": {
        "down": 3001,
        "up": 3001,
        "cockpitDeviceId": 1,
        "valueDown": 1.0,
        "valueUp": 0.0
      },
      "source": {
        "provider": "dcs-controls-html-export",
        "file": "DCS Generate HTML"
      }
    }
  ]
}
```

Catalog loading remains intentionally read-only. It establishes validated command identity and discovery without modifying live Saved Games profiles. Assigning catalog commands to physical controls requires a subsequent safe profile-rewrite slice that preserves every unrelated `.diff.lua` entry.

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

## Interactive controls preview

In consumer import mode, the device **Preview** button opens a command catalog, interactive hardware diagram, and selected-control editor. Search and filter by category, input type, availability, and bound/unbound state. Drag an assignable command onto an empty or occupied callout, confirm replacements, and edit the displayed label in the editor. Button and axis targets remain separate; search-only commands cannot be dragged.

Select a modifier layer or choose **New chord…** to combine one or more modifiers from the imported `modifiers.lua`. **Choose assignment chord…** keeps the selected physical input when switching to that chord. Assigning on a chord preserves the base binding. MFD base and shifted callouts are separate targets. The editor supports moving an existing assignment to another callout and right-click Assign, Clear, Restore, Edit label, and Reset label.

Colors distinguish unchanged, new, replaced, conflicting, and unassigned controls. **Rendered kneeboard…** includes pending assignments and label overrides. **Back** keeps edits staged; **Proceed** writes destination profiles and kneeboard configuration. UI Layer import retains its existing rendered preview. Pending command and label edits are session state and are not saved by the scaffolding solution file.

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
