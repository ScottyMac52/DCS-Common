# Definitive UI Layer

DCS-Common owns one complete, manually maintained UI Layer catalog. It is independent of connected controllers and is never rewritten by consumer scaffolding or module builds.

## Canonical files

The catalog lives under `assets/shared/ui-layer/input/UiLayer` and supports DCS `joystick`, `keyboard`, and `mouse` categories plus `modifiers.lua`. `functions.json` and `hardware-overlays.json` provide stable function and shared-hardware metadata.

The initial canonical snapshot contains five joystick profiles, one keyboard profile, 62 effective key/button inputs, and 11 modifiers. The canonical BTN3 modifier names are:

- `AVA_BASE_MODIFIER_BTN3`
- `MOZA_MODIFIER_BTN3`
- `VKB_F14_BTN7`

The former `TM_AVA_BASE_F16_MODIFIER` and `MOZA_F16_F18_BTN3` names are not compatibility aliases. Rename them in DCS before re-scaffolding consumers.

## Maintain the catalog

Open **Definitive UI Layer Editor…** from the DCS Input Profile Importer.

1. Select the DCS-Common root and choose **Load Canonical**.
2. Review the complete Profiles, Bindings, Modifiers, and Validation errors tabs. No controller needs to be connected.
3. To reconcile changes from DCS, select the Saved Games `Config\Input\UiLayer` folder and choose **Compare Import**.
4. Review each file. New and changed files default to **Add** or **Replace**. A canonical-only file defaults to **Keep** because absence is not deletion.
5. Choose **Remove** only for an intentional deletion.
6. Choose **Validate & Save Selected Actions**. The editor stages the full catalog, validates every Lua profile and modifier reference, and atomically replaces the canonical directory only after validation succeeds.

The editor reports a deterministic SHA-256 fingerprint for the complete catalog. A failed validation or write leaves the prior catalog in place.

The legacy **DCS-Common authoritative UI Layer** import target remains useful for binding previews and mapping review, but the definitive editor is the ownership boundary for canonical file changes.

## Module projection

Every consumer build calculates applicability from the module's final configured profile files. A device is applicable only when a referenced module profile has at least one effective `added` entry in `keyDiffs` or `axisDiffs`.

- Button, key, and POV additions qualify.
- Axis-only profiles qualify, so devices such as the TPR rudder are retained.
- Empty, removed-only, stale, unreferenced, and UI-Layer-catalog-only profiles do not qualify.
- A required modifier declaration can be packaged without generating a page for the modifier-provider device.
- Alternative MFD3 bindings are tailored to the selected VKB, MOZA, or AVA modifier family.

The kneeboard renderer and UI Layer packager share the same applicability resolver. Build output reports key and axis counts and the reason each configured profile was included or excluded. Module builds never mutate the definitive catalog.

## Validation

```bash
node scripts/manage-ui-layer-catalog.mjs inspect assets/shared/ui-layer/input/UiLayer
node --test test/ui-layer-catalog.test.mjs test/package-ui-layer-input.test.mjs test/profile-driven-kneeboard.test.mjs
```

The catalog test enforces the definitive snapshot, modifier migration, keyboard support, reconciliation behavior, and catalog-wide modifier closure.
