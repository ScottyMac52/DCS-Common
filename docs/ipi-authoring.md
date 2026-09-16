# IPI repository authoring

The DCS Input Profile Importer (IPI) can author a consumer from a clean Git clone without using Saved Games as its source of truth.

## Blank-clone workflow

1. Open **Blank-clone / module authoring**.
2. Select the DCS-Common checkout and the empty consumer clone.
3. Enter the display name, DCS input module ID, and kneeboard ID.
4. Select a canonical device or composite device identity and give its first profile a native DCS `.diff.lua` filename.
5. Choose **Initialize repository and first profile**.
6. Return to the main window, load the created profile directory, and choose **Load Preview**.
7. Import the module's saved DCS HTML command catalog. Select commands and canonical physical controls, including base or created modifier chords, then Proceed.

Initialization creates a valid empty profile, `config/kneeboard.json`, and the normal build/package sources. A connected controller or pre-existing Saved Games profile is not required.

## Layer Manager

The module and definitive UI Layer authoring screens expose deliberate layer management. A modifier has a native name, physical DCS device, physical key, hold/toggle mode, optional semantic family, and optional canonical device ID.

Any number of modifiers may be defined and any combination may be selected as an assignment chord. Duplicate names and duplicate physical inputs are rejected. Normal command assignment selects existing modifiers; it never silently creates, renames, or removes one. Modifier and utilization saves are fingerprint-protected.

The main assignment screen also contains a modifier editor. Add selects an imported device and one of its DCS-Common shared controls, so the native device identity and physical key are derived rather than typed. Update can rename a modifier, change its hold/toggle mode, semantic family, or shared physical control. Renames migrate staged assignment chords. Remove is allowed only after every dependent assignment has been moved or cleared. All changes remain staged until **Proceed**, which writes the edited modifier set as the module's authoritative `modifiers.lua`.

The same screen contains a shared-hardware instance editor above **Physical device instances**. Choose a DCS-Common hardware definition, supply the native `.diff.lua` filename, and optionally give the instance a semantic instance or role. **Add** creates a valid empty profile backed by that shared control catalog, so controls can be assigned without first exporting the device from DCS. **Update** migrates the filename and instance references; changing the hardware type is allowed only while no assignments or modifiers depend on it. **Remove** is likewise blocked until dependent assignments and modifiers are cleared. These edits are staged in the solution and written only by **Proceed**.

## Generated consumer documentation

**Proceed** generates and refreshes the standard consumer documentation set alongside the scaffolded repository:

- `docs/INSTALLATION.md`
- `docs/CONTROL-MAPPINGS.md`
- `docs/devices/*-MAPPINGS.md`
- `docs/OPENKNEEBOARD-VAICOM.md`
- `docs/THIRD-PARTY-ASSETS.md`

The control-mapping index and individual device guides are derived from the final merged consumer inventory, not only the devices visible during the current import. They therefore include preserved physical instances, intentionally empty profiles, modifier layers, and non-default axis filters. Explicitly removed devices are deleted from the profile inventory and from IPI-owned device guides. The integration guide uses the same effective page expansion as the kneeboard builder, including summary pages and excluding configured profiles that do not produce output, so its file list matches the packaged PNG set. Re-running IPI deterministically refreshes these files and the README links to them.

## Definitive UI Layer authoring

The **Definitive UI Layer Editor** treats DCS-Common's shared hardware catalog as its physical-control API. Select a validated UI Layer command, canonical device, shared control, and an existing layer. IPI derives the native input key, `keyDiffs`/`axisDiffs` section, hardware label, and control identity. Moving or clearing starts from a selected authoritative binding, so its source key and chord are never retyped. Stage an upsert, move, clear, or relabel operation, then save the complete batch.

The destination is always `DCS-Common/assets/shared/ui-layer`. Save stages the catalog, validates command identities, physical controls, modifier closure, and the expected fingerprint, then atomically replaces the authoritative directory. Existing unknown command entries are preserved as warnings; IPI will not newly assign an unknown identity.

From a module assignment screen, **Edit in UI Layer…** routes to this authoritative workspace. Module context is informational and never changes ownership.

## Explicit module utilization

A module can save an exact `uiLayerUtilization` selection in `config/kneeboard.json`:

```json
{
  "uiLayerUtilization": {
    "mode": "explicit",
    "bindings": [
      {
        "deviceId": "tm-mfd",
        "deviceInstance": "MFD3",
        "functionId": "vr-zoom",
        "modifiers": ["AVA_BASE_MODIFIER_BTN3"]
      }
    ]
  }
}
```

The IPI module screen presents these entries as a checklist of existing definitive assignments. Checking a row copies its stable canonical device, optional instance, function, shared control, and exact native chord; authors do not reconstruct tuples or type keys. When the object is absent, existing consumers retain compatibility inference from their effective device profiles. Once present, it is authoritative—even an empty binding list means the module utilizes no UI Layer assignments.

The same selection filters kneeboard overlays and packaged DCS UI Layer profiles. Unselected functions, chords, profiles, and modifier declarations produce no module output. Device applicability still requires an effective module profile, and MFD instance restrictions remain enforced.

## Rebuild and rollback

Module data changes require kneeboard and OVGME package rebuilds. Authoritative UI Layer data changes require affected consumers to be re-scaffolded or rebuilt. A new IPI EXE is required only when IPI/DCS-Common code changes, not for later catalog-only edits.

Before replacing an active package: disable it in OVGME, update or re-scaffold and rebuild the consumer, rebuild the OVGME archive, then enable the new package. IPI does not operate OVGME or Git automatically.
