# Shared UI Layer overlays

DCS-Common owns the authoritative UI Layer function catalog and the per-device overlay definitions used to combine simulator-wide functions with aircraft bindings on the same canonical hardware page.

## Files

- `functions.json` is the authoritative, device-independent UI Layer function list.
- `hardware-overlays.json` maps those functions to stable control IDs from each canonical shared hardware definition.
- `scripts/ui-layer-overlays.mjs` derives completed overlays and fill-in templates and merges UI Layer labels with aircraft labels.

The Draw.io source is never copied. Every overlay targets stable control IDs on the one canonical device definition under `assets/shared/hardware/drawio`.

Scaffolded consumers enable composition by default with top-level `"includeUiLayer": true`; individual pages may use `"includeUiLayer": false` only for an intentional exception. Re-scaffolding a module adopts the overlay contract and packages DCS-Common's canonical `Config/Input/UiLayer` payload alongside the module input payload.

## Overlay states

- `complete`: every current authoritative UI Layer function has a control assignment.
- `template`: assignments may be incomplete. Every missing function is derived automatically from `functions.json` and exposed with a null `controlId` by `buildUiLayerHardwareTemplate`.
- `exempt`: the device intentionally has no UI Layer overlay. The standalone MOZA AB9 base and TPR rudder are the initial exemptions.
- `not-applicable`: an overlay is defined for the shared hardware family but not for the current physical instance.

`appliesToInstances` limits an overlay to named physical instances. Scaffolded pages preserve the detected instance as `deviceInstance`; for example, the TM MFD overlay applies only when `deviceInstance` is `MFD3`.

Adding a function to `functions.json` automatically adds it to every incomplete template. Tests do not duplicate a fixed function list or compare full output snapshots. A completed overlay must map the new function before it may remain `complete`.

## Fill in a template

1. Open the existing canonical Draw.io definition only if the hardware geometry or anchors need correction.
2. Choose an existing stable callout/control ID for each unassigned function.
3. Add the function-to-control assignment under that device's `bindings` object in `hardware-overlays.json`.
4. When no functions remain unassigned, change the device status to `complete`.
5. Run `npm test` and visually inspect a consumer build containing aircraft and UI Layer labels.

Do not create another Draw.io, SVG, or hardware Lua definition for an overlay.
