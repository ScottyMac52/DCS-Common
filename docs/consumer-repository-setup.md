# DCS-Common consumer repository setup

This is the complete contract for a new aircraft, UI-layer, or component repository that consumes DCS-Common.

A conforming consumer owns DCS bindings, labels, page order, packaging, and releases.
DCS-Common owns reusable workflows, shared hardware identities, draw.io sources, exported SVG geometry, product images, callout IDs, anchors, connectors, and rendering helpers.

**Reference implementation:** [DCS-F-14B-U-Components](https://github.com/ScottyMac52/DCS-F-14B-U-Components). Prefer that pattern over older two-step consumers.

## 0. Preferred path: DCS Input Profile Importer

For a **new** consumer, prefer scaffolding instead of hand-copying files.

| Tool | Location |
| --- | --- |
| WPF app | [`tools/DcsConsumerScaffold/`](../tools/DcsConsumerScaffold/) — Load Preview, then **Proceed** |
| CLI engine | `node scripts/scaffold-consumer.mjs` |
| Device map | [`assets/shared/hardware/scaffold-device-map.json`](../assets/shared/hardware/scaffold-device-map.json) |
| Templates | [`templates/consumer/`](../templates/consumer/) |

**Requires Node.js on PATH.** Point the tool at your DCS-exported `joystick` folder (and optional `modifiers.lua`), set display name / input module ID / kneeboard ID, and write into an empty output directory.

```bash
node scripts/scaffold-consumer.mjs \
  --preview-json preview.json \
  --profiles-dir "$USERPROFILE/Saved Games/DCS.openbeta/Config/Input/<module>/joystick" \
  --modifiers "$USERPROFILE/Saved Games/DCS.openbeta/Config/Input/<module>/modifiers.lua"

node scripts/scaffold-consumer.mjs \
  --output-dir ./DCS-Example-Components \
  --profiles-dir "$USERPROFILE/Saved Games/DCS.openbeta/Config/Input/<module>/joystick" \
  --modifiers "$USERPROFILE/Saved Games/DCS.openbeta/Config/Input/<module>/modifiers.lua" \
  --display-name "Example" \
  --input-module-id ExampleModule \
  --kneeboard-id ExampleModule
```

Scaffold output is a **draft**: review `SCAFFOLD-REPORT.md` and `config/kneeboard.json`, fix any **UNMAPPED** devices (or re-run with `--map`), then complete sections 6–12 below (build, package, CI).

App releases use **four-part** tags (`v1.0.0.0`) and Inno Setup via [shared-github-workflows](https://github.com/ScottyMac52/shared-github-workflows). Consumer **package** tags remain `vMAJOR.MINOR.PATCH`.

## 1. Decide the DCS identities first

Record these values before creating files. They are independent and must not be inferred from the repository or display name.

| Value | Example | Used by |
| --- | --- | --- |
| Repository name | `DCS-F-14B-U-Components` | GitHub and artifact naming |
| Display name | `F-14B(U)` | Documentation and kneeboard titles |
| DCS input module ID | `F-14BU` | `Config/Input/<module>` |
| DCS kneeboard ID | `F-14BU` | `KNEEBOARD/<module>` |
| Saved Games root | `%USERPROFILE%\Saved Games\DCS.openbeta` | OVGME configuration root |

Use the module IDs that DCS actually reads. A repository named for an aircraft can still require a different module directory. If the input and kneeboard IDs differ, declare both and test both install paths. The OVGME archive must be relative to the documented Saved Games root: its package container starts with `Config/` and `KNEEBOARD/`; it must not contain an extra `Saved Games/DCS` directory.

Users of `DCS.openbeta`, a named DCS instance, or a relocated Saved Games directory must point OVGME at that exact active root. The consumer README and package README must say which root was tested.

## 2. Create the repository layout

Use this minimum layout (the scaffold tool produces most of it):

```text
.github/workflows/
  build.yml
  release.yml
config/
  kneeboard.json
docs/
kneeboard/
  <kneeboard-id>/             # committed 1200 × 1600 PNG pages
  source/                     # committed deterministic SVG pages
packaging/
  ovgme/README.TXT
  release/RELEASE-NOTES.md
scripts/
  build-kneeboard.mjs         # single unified generator (preferred)
  test-kneeboard.mjs
  test-versioning.mjs
  version.mjs
  Build-OvGME.ps1
  Test-Package.ps1
  Build-Release.ps1
src/Config/Input/<input-module-id>/joystick/
  <device name> {GUID}.diff.lua
LICENSE
README.md
package.json
package-lock.json
```

When using native DCS modifiers, also version:

```text
src/Config/Input/<input-module-id>/modifiers.lua
```

**Do not add these obsolete scripts:**

- `scripts/apply-shared-hardware.mjs` — deleted in the F-14 pattern. Shared hardware rendering is done inside `build-kneeboard.mjs`.
- `scripts/Test-Release.ps1` — not used. Point both workflow inputs at `Test-Package.ps1`.

Add third-party notices and source records for any consumer-owned assets. Do not copy anything from `DCS-Common/assets/shared/hardware/drawio`, `svg`, or `source` into this layout.

## 3. Preserve native DCS input profiles

Store canonical profiles under:

```text
src/Config/Input/<input-module-id>/joystick
```

Keep the GUID-qualified filename exported by DCS for every known physical device. Two independently enumerated devices require two files even when they are the same hardware model. Never merge MFD 1/2/3, dual quadrants, or similar duplicate instances into one profile merely because they share a product name.

Preserve the complete DCS data contract:

- command identifiers and names
- `added` and `removed` bindings
- axes, inversion, dead zones, saturation, and curves
- force-feedback settings
- modifier/reformer chords
- maintained positions and device-specific behavior

Validation must parse every Lua file, enforce the expected profile inventory, detect missing or ambiguous bindings, protect reserved inputs, and test behavior that is unique to each device. A syntactically valid but incomplete profile is not acceptable.

## 4. Define consumer-owned kneeboard data

Choose stable device IDs from [`assets/shared/hardware/manifest.json`](../assets/shared/hardware/manifest.json).

Put aircraft functions, profile paths, titles, output filenames, page order, and short label overrides in `config/kneeboard.json`.

The preferred structure (as used by F-14B-U) separates optional summary pages from hardware pages:

```json
{
  "schemaVersion": 1,
  "aircraft": "F-14B(U)",
  "profiles": {
    "pto2": "src/Config/Input/F-14BU/joystick/WINCTRL CarrierAce PTO 2 {GUID}.diff.lua"
  },
  "summaryPages": [
    {
      "type": "summary",
      "file": "01-VAICOM-OVERVIEW",
      "title": "VAICOM PRO + CONTROL OVERVIEW",
      "kicker": "VOICE-FIRST • PHYSICAL BACKUP",
      "items": [
        { "key": "TX1", "text": "VHF AM", "accent": "gold" }
      ]
    }
  ],
  "pages": [
    {
      "file": "05-PTO2",
      "deviceId": "winctrl-pto2",
      "title": "WINCTRL CARRIERACE PTO2",
      "kicker": "CARRIER, GEAR, FLAPS, LIGHTS AND REFUELING",
      "controls": {
        "pto2-button-35": {
          "profile": "pto2",
          "key": "JOY_BTN35",
          "label": "Gear up"
        }
      }
    }
  ]
}
```

Notes:

- `summaryPages` are consumer-owned text/layout pages rendered through `kneeboard-renderer.mjs`.
- `pages` with a `deviceId` are shared-hardware pages rendered through `shared-hardware-consumer.mjs`.
- Labels may be a map keyed by callout ID, an ordered array aligned to callout order, or profile-driven `controls` entries.
- Callout labels must describe **functions**, not physical button prefixes (`JOY_BTN12: ...` is rejected).
- Keep output filenames and page order stable after publication because OpenKneeboard and user documentation may depend on them.

### Modifiers and layered pages

When a physical control is a DCS modifier (hold or toggle) and other bindings use that reformer chord, wire `modifiersFile`, stable aliases under `modifiers`, and `pages[].layers` so each chord becomes its own kneeboard page.

**Full operator procedure** (DCS UI → export → aliases → layers → rebuild → cockpit checklist), hold vs toggle, exact-chord rules, failure modes, and a Warthog BTN3 toggle + TM MFD worked example:

→ **[Profile-driven kneeboards — Modifier layers and operator workflow](profile-driven-kneeboards.md)**

Minimal fixture: [`examples/modifiers-toggle-layer/`](../examples/modifiers-toggle-layer/).

If the package is the pilot’s source of truth for modifiers, ship `modifiers.lua` on the DCS `Config/Input/<module>/` path inside the OvGME archive—not only use it for kneeboard generation.

## 5. Unified kneeboard build (preferred pattern)

Automation checks out DCS-Common into `.dcs-common` and exports `DCS_COMMON_ROOT`. Prefer the environment variable; fall back to `.dcs-common`.

There is **one** build script. It imports Common helpers directly and generates every page in order. There is no separate apply/replace step. Scaffolded consumers already include a unified `scripts/build-kneeboard.mjs` from the templates.

See the F-14 reference and the template under `templates/consumer/build-kneeboard.mjs.tmpl` for the full loop (`summaryPages` + hardware pages + provenance).

`loadProfileDrivenConfig` expands `layers` into one page object per chord (including resolved labels from `.diff.lua`).

### Dual instances of one shared device

Use `renderSharedHardwareInstancesPage` when one page shows two copies of the same canonical device (for example dual Logitech throttle quadrants). Do not duplicate shared templates.

Consumer tests must assert the shared-device marker (`Shared DCS-Common device: <id>`) or the shared-instance marker and each expected instance ID.

### Legacy note

Older consumers still use a two-step `build-kneeboard.mjs && apply-shared-hardware.mjs` chain. That pattern is obsolete. New work and documentation must use the unified builder above.

## 6. Implement the build contract

Use Node.js 22, ES modules, a lockfile, and an explicit compatible `sharp` version range:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "build:kneeboard": "node scripts/build-kneeboard.mjs",
    "test:kneeboard": "node scripts/test-kneeboard.mjs",
    "test:versioning": "node scripts/test-versioning.mjs"
  },
  "devDependencies": {
    "sharp": "^0.34.5"
  }
}
```

There is no second apply step. `PACKAGE_VERSION` is read by provenance/footer helpers; local builds may fall back to `0.0.0-local`, while CI and releases provide it explicitly.

Commit every generated SVG under `kneeboard/source` and every 1200 × 1600 PNG under `kneeboard/<kneeboard-id>`. Generated pages must be deterministic and self-contained: no HTTP resources, filesystem-dependent links, timestamps, random IDs, or machine-specific paths.

`test-kneeboard.mjs` must, at minimum, verify:

- exact page count, filenames, and order
- SVG and PNG dimensions
- offline/self-contained SVG resources
- required visible labels and page numbers / footers
- shared-device or shared-instance markers
- a second identical build produces identical hashes
- conditional pages agree with installed profiles
- when modifiers are used, both base and layer output files exist with distinct labels for the same physical keys

## 7. Build and validate the OVGME package

`Build-OvGME.ps1 -Version <version>` stages one named package container whose root contains:

```text
Config/Input/<input-module-id>/joystick/*.diff.lua
KNEEBOARD/<kneeboard-id>/*.png
```

Include `Config/Input/<input-module-id>/modifiers.lua` when the consumer versions native modifiers for packaging.

Place `README.TXT` and `VERSION.TXT` beside that container in the archive. The README template should contain a required `{{VERSION}}` token. Produce the OVGME ZIP under `dist/` and record its SHA-256 in `dist/SHA256SUMS.txt`.

`Test-Package.ps1` must expand the archive into a clean directory and verify the exact module and kneeboard paths, expected profiles and pages, resolved version text, Lua structure, reserved inputs, device-specific validators, and checksum-bearing artifact names.

## 8. Build and validate the complete release

`Build-Release.ps1 -Version <version>` consumes the already validated OVGME ZIP and creates a versioned complete-release ZIP. Include, as applicable:

- the OVGME ZIP
- repository README and installation/control documentation
- `VERSION.TXT` or an equivalent authoritative version record
- licenses and third-party notices
- optional AutoHotKey or companion utilities
- an internal `SHA256SUMS.txt`

Regenerate `dist/SHA256SUMS.txt` for every release ZIP.

**Use one test script.** Point both `test-package-script` and `test-release-script` at `scripts/Test-Package.ps1`. That script validates the OVGME package **and** the complete release bundle (inventory, optional component validators, and checksums). Do not create or document a separate `Test-Release.ps1` for new consumers.

Use `packaging/release/RELEASE-NOTES.md` as the default release notes path. Keep all artifact paths literal and synchronized across scripts and workflow callers.

## 9. Use tag-authoritative semantic versions

Release tags are authoritative and must match `vMAJOR.MINOR.PATCH`. `scripts/version.mjs` must support resolving an explicit version and calculating the next patch, minor, or major version. Build scripts receive the resolved value through `PACKAGE_VERSION` or `-Version`; they must not silently derive a different version from `package.json`.

The reusable release workflow calculates the next tag, regenerates and optionally commits kneeboard outputs, builds and validates packages, and targets the release at the final generated commit. Existing tags and releases are immutable.

## 10. Call the reusable GitHub workflows

Keep consumer workflows thin. The reusable workflows check out both repositories and export `DCS_COMMON_ROOT=${{ github.workspace }}/.dcs-common`.

Scaffolded consumers already include thin `build.yml` / `release.yml` callers under `.github/workflows/`.

The release workflow requires `contents: write` and serialized concurrency because it may commit regenerated kneeboard paths to `main` before creating the tag and GitHub Release. List every generated SVG and PNG directory in `kneeboard-paths`.

## 11. Known-good references

Use these repositories as implementation references, not as sources to copy shared geometry from:

- [DCS-F-14B-U-Components](https://github.com/ScottyMac52/DCS-F-14B-U-Components): **preferred contract** — unified `build-kneeboard.mjs`, summary + hardware pages, single `Test-Package.ps1` for both package and release validation
- [DCS-F-16C-Components](https://github.com/ScottyMac52/DCS-F-16C-Components): aircraft profiles and profile-driven pages
- [DCS-F4U-1D-Components](https://github.com/ScottyMac52/DCS-F4U-1D-Components): two instances of one canonical shared device
- [DCS-UI-Layer](https://github.com/ScottyMac52/DCS-UI-Layer): a global UI-layer kneeboard and Saved Games packaging

## 12. Verification checklist

Copy this checklist into the first pull request for a new consumer:

```markdown
- [ ] Record the exact input module ID, kneeboard ID, and tested Saved Games root.
- [ ] Prefer scaffold (Importer / `scaffold-consumer.mjs`) then review SCAFFOLD-REPORT.md.
- [ ] Layout has no `apply-shared-hardware.mjs` and no `Test-Release.ps1`.
- [ ] `package.json` build:kneeboard is a single `node scripts/build-kneeboard.mjs`.
- [ ] Run `npm ci`.
- [ ] Parse every `.lua` file and run profile/device/reserved-input validation.
- [ ] Set `DCS_COMMON_ROOT` or create the `.dcs-common` checkout.
- [ ] Set a test `PACKAGE_VERSION` and run `npm run build:kneeboard`.
- [ ] Run `npm run test:kneeboard` and confirm a deterministic rebuild.
- [ ] Run `npm run test:versioning` (when present).
- [ ] Run `pwsh ./scripts/Build-OvGME.ps1 -Version 0.0.0-local`.
- [ ] Run `pwsh ./scripts/Test-Package.ps1 -Version 0.0.0-local`.
- [ ] Run `pwsh ./scripts/Build-Release.ps1 -Version 0.0.0-local`.
- [ ] Run `pwsh ./scripts/Test-Package.ps1 -Version 0.0.0-local` again to validate the complete bundle.
- [ ] Visually inspect every generated hardware page at normal kneeboard scale.
- [ ] Open a pull request and require reusable build CI to pass.
- [ ] Run one patch release end to end; verify regenerated assets, tag target, ZIP contents, checksums, and GitHub Release downloads.
```

If the consumer uses modifiers, also confirm:

```markdown
- [ ] `modifiers.lua` is versioned and referenced by `modifiersFile`.
- [ ] Hold vs toggle `mode` in JSON matches DCS `switch`.
- [ ] Base and layer output pages both generate with correct reformer-resolved labels.
- [ ] Optional: `modifiers.lua` is packaged under `Config/Input/<module>/` when it is pilot source of truth.
```

A later DCS-Common draw.io or SVG change is incorporated when this consumer is rebuilt or re-released with the updated shared catalog. It does not rewrite an existing tag, package, or release.
