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

## Definitive UI Layer authoring

The **Definitive UI Layer Editor** includes a searchable assignment workspace. Select a validated UI Layer command, authoritative profile or new supported profile, canonical device, physical key, and exact chord. Stage an upsert, move, clear, or relabel operation, then save the complete batch.

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

Each entry selects one canonical device, optional instance, UI function, and exact native chord. When the object is absent, existing consumers retain compatibility inference from their effective device profiles. Once present, it is authoritative—even an empty binding list means the module utilizes no UI Layer assignments.

The same selection filters kneeboard overlays and packaged DCS UI Layer profiles. Unselected functions, chords, profiles, and modifier declarations produce no module output. Device applicability still requires an effective module profile, and MFD instance restrictions remain enforced.

## Rebuild and rollback

Module data changes require kneeboard and OVGME package rebuilds. Authoritative UI Layer data changes require affected consumers to be re-scaffolded or rebuilt. A new IPI EXE is required only when IPI/DCS-Common code changes, not for later catalog-only edits.

Before replacing an active package: disable it in OVGME, update or re-scaffold and rebuild the consumer, rebuild the OVGME archive, then enable the new package. IPI does not operate OVGME or Git automatically.
