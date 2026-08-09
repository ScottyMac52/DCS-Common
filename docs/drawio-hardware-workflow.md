# Native draw.io hardware workflow

The native, uncompressed files under `assets/shared/hardware/drawio/` are the visual source of truth for image-backed shared hardware templates. The corresponding files under `assets/shared/hardware/svg/` are deterministic published outputs.

## Edit a template

1. Open the device's `.drawio` file in diagrams.net/draw.io.
2. Keep the canvas size unchanged.
3. Select and move label boxes, anchor dots, or connector edges as needed. Each connector is attached to a label cell and an anchor cell.
4. Put every anchor dot at the exact center of its physical button, switch position, or rocker half.
5. Save as an uncompressed XML `.drawio` file. Do not export or embed the old SVG as a background.
6. Run `npm run build:drawio-hardware` to regenerate the published SVGs.
7. Run `npm test` and visually inspect the changed SVG before committing both files.

The custom exporter intentionally supports the limited native cell vocabulary used by these templates. This keeps exports deterministic in CI without requiring the diagrams.net desktop application.

## Optional button-number watermarks

Callout label cells may carry a physical button number as a style attribute:

```
buttonNumber=12;
```

When present, the exporter can render a small, low-opacity watermark of that number inside the callout box (bottom-right corner).

Control is via `assets/shared/hardware/export-config.json`:

```json
{
  "includeButtonNumberWatermarks": false
}
```

- Default is `false` so published SVGs stay clean.
- Set to `true` (or pass `--watermarks` on the CLI) when you want the numbers visible for development or documentation.
- Labels without a `buttonNumber` attribute never show a watermark.

This feature is limited to the draw.io → SVG generation path. It does not affect runtime DCS UI or other layers.

## Add a source-backed device

Add an approved raster image under `assets/shared/hardware/source/`, create the initial SVG/control inventory, add a `drawio` path to the manifest entry, and run `npm run create:drawio-hardware`. The creation command refuses to overwrite existing native sources unless `--force` is supplied; do not use `--force` after manual layout work begins.

Record every externally sourced image and its product page in `assets/shared/hardware/SOURCES.md`. Manufacturer product images retain their original copyright and require maintainer approval before distribution.

## Modifier coloring contract (shared hardware)

Shared hardware templates use a **single base image**. Modifier state is never expressed by generating alternate full images.

Instead:

1. Callout **text color** indicates which modifier (if any) is active for that binding.
2. A small **legend table** in the lower-right of the kneeboard page documents the active color → modifier mapping.

### Locked color vocabulary

| Role | Color |
| --- | --- |
| Base (no modifier) | Black |
| Modifier 1 | Red |
| Modifier 2 | Orange |
| Modifier 3 | Blue |
| Modifier 4 | Green |
| Modifier 5 | Cyan |

Consumers must apply these colors in order. Do not invent additional colors without updating this contract and the shared documentation.

### Runtime support in the shared consumer

`scripts/shared-hardware-consumer.mjs` implements this contract:

- `MODIFIER_COLOR_CONTRACT` / `modifierColorAt(index)` — locked fills (index 0 = base).
- `loadSharedHardware(..., { labelColors })` — sets each callout `<text>` `fill` from the map.
- `renderSharedHardwarePage(..., { legend })` — draws a lower-right **SHIFT / MODIFIER** legend on the outer 1200×1600 page when entries are provided.
- `loadProfileDrivenConfig` (in `profile-driven-kneeboard.mjs`) assigns `labelColors` and `legend` per page from profile reformer chords and `config.modifiers` order.

Consumers that spread the page object into `renderSharedHardwarePage` (as F4U does) pick up coloring and the legend automatically once the kneeboard config declares modifiers and uses them on controls or layers.

This pattern was introduced with the WINCTRL PTO2 redesign (issue #87) and is the expected approach for future devices.
