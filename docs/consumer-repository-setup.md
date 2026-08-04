# DCS-Common consumer repository setup

This is the complete contract for a new aircraft, UI-layer, or component repository that consumes DCS-Common. A conforming consumer owns DCS bindings, labels, page order, packaging, and releases. DCS-Common owns reusable workflows, shared hardware identities, draw.io sources, exported SVG geometry, product images, callout IDs, anchors, connectors, and rendering helpers.

## 1. Decide the DCS identities first

Record these values before creating files. They are independent and must not be inferred from the repository or display name.

| Value | Example | Used by |
| --- | --- | --- |
| Repository name | `DCS-F-16C-Components` | GitHub and artifact naming |
| Display name | `F-16C Block 50` | Documentation and kneeboard titles |
| DCS input module ID | `F-16C_50` | `Config/Input/<module>` |
| DCS kneeboard ID | `F-16C_50` | `KNEEBOARD/<module>` |
| Saved Games root | `%USERPROFILE%\Saved Games\DCS` | OVGME configuration root |

Use the module IDs that DCS actually reads. A repository named for an aircraft can still require a different module directory. If the input and kneeboard IDs differ, declare both and test both install paths. The OVGME archive must be relative to the documented Saved Games root: its package container starts with `Config/` and `KNEEBOARD/`; it must not contain an extra `Saved Games/DCS` directory.

Users of `DCS.openbeta`, a named DCS instance, or a relocated Saved Games directory must point OVGME at that exact active root. The consumer README and package README must say which root was tested.

## 2. Create the repository layout

Use this minimum layout, omitting only genuinely unused optional files:

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
  apply-shared-hardware.mjs
  build-kneeboard.mjs
  test-kneeboard.mjs
  version.mjs
  Build-OvGME.ps1
  Test-Package.ps1
  Build-Release.ps1
  Test-Release.ps1
src/Config/Input/<input-module-id>/joystick/
  <device name> {GUID}.diff.lua
LICENSE
README.md
package.json
package-lock.json
```

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

Choose stable device IDs from [`assets/shared/hardware/manifest.json`](../assets/shared/hardware/manifest.json). Put aircraft functions, profile paths, titles, output filenames, page order, and short label overrides in `config/kneeboard.json`. DCS binding names are the default labels when profile-driven controls are used.

```json
{
  "schemaVersion": 1,
  "aircraft": "Example_Module",
  "profiles": {
    "panel": "src/Config/Input/Example_Module/joystick/Panel {GUID}.diff.lua"
  },
  "pages": [
    {
      "file": "02-PANEL",
      "deviceId": "winctrl-pto2",
      "title": "WINCTRL PTO2",
      "controls": {
        "pto2-button-35": {
          "profile": "panel",
          "key": "JOY_BTN35",
          "label": "Gear up"
        }
      }
    }
  ]
}
```

The consumer may supply only consumer-specific composition data. It must not copy or redefine shared draw.io files, SVGs, embedded product images, callout IDs, anchor coordinates, connector paths, or device geometry. Keep output filenames and page order stable after publication because OpenKneeboard and user documentation may depend on them.

See [Profile-driven kneeboards](profile-driven-kneeboards.md) for modifiers and layered pages.

## 5. Add the shared-hardware adapter

Automation checks out DCS-Common into `.dcs-common` and exports `DCS_COMMON_ROOT`. Use the environment variable first and `.dcs-common` as the local/automation fallback.

### One shared device

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commonRoot = resolve(process.env.DCS_COMMON_ROOT ?? join(root, '.dcs-common'));
const { renderSharedHardwareInstancesPage, renderSharedHardwarePage } = await import(
  pathToFileURL(join(commonRoot, 'scripts/shared-hardware-consumer.mjs'))
);
const { loadProfileDrivenConfig } = await import(
  pathToFileURL(join(commonRoot, 'scripts/profile-driven-kneeboard.mjs'))
);
const config = loadProfileDrivenConfig('config/kneeboard.json', { consumerRoot: root, commonRoot });
const svgDir = join(root, 'kneeboard/source');
const pngDir = join(root, 'kneeboard/Example_Module');
mkdirSync(svgDir, { recursive: true });
mkdirSync(pngDir, { recursive: true });

for (const [index, page] of config.pages.entries()) {
  const { svg } = renderSharedHardwarePage({
    ...page,
    commonRoot,
    provenance: { consumer: 'DCS-Example-Components', page: `${index + 1} / ${config.pages.length}` },
  });
  writeFileSync(join(svgDir, `${page.file}.svg`), svg);
  await sharp(Buffer.from(svg)).png().toFile(join(pngDir, `${page.file}.png`));
}
```

### Two instances of one device

Use one canonical device ID with separate instance IDs and labels. Do not duplicate the shared template.

```js
const { svg, instances } = renderSharedHardwareInstancesPage({
  commonRoot,
  title: 'DUAL THROTTLE QUADRANTS',
  provenance: { consumer: 'DCS-Example-Components', page: '3 / 4' },
  instances: [
    {
      instanceId: 'primary-quadrant',
      deviceId: 'logitech-throttle-quadrant',
      title: 'PRIMARY',
      labels: ['Mixture', 'Propeller RPM', 'Throttle'],
    },
    {
      instanceId: 'secondary-quadrant',
      deviceId: 'logitech-throttle-quadrant',
      title: 'SECONDARY',
      labels: ['Supercharger', 'Unbound', 'Unbound'],
    },
  ],
});
```

Consumer tests must assert the shared-device marker (`Shared DCS-Common device: <id>`) or the shared-instance marker and each expected instance ID.

## 6. Implement the build contract

Use Node.js 22, ES modules, a lockfile, and an explicit compatible `sharp` version range. The essential package metadata is:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "build:kneeboard": "node scripts/build-kneeboard.mjs && node scripts/apply-shared-hardware.mjs",
    "test:kneeboard": "node scripts/test-kneeboard.mjs",
    "test:versioning": "node scripts/test-versioning.mjs"
  },
  "devDependencies": {
    "sharp": "^0.34.5"
  }
}
```

The ordering is mandatory: generate consumer-owned base pages first, then replace or add shared-hardware pages through the adapter. Both stages read `PACKAGE_VERSION`; local builds may use a documented development fallback, while CI and releases provide it explicitly.

Commit every generated SVG under `kneeboard/source` and every 1200 × 1600 PNG under `kneeboard/<kneeboard-id>`. Generated pages must be deterministic and self-contained: no HTTP resources, filesystem-dependent links, timestamps, random IDs, or machine-specific paths.

`test-kneeboard.mjs` must, at minimum, verify:

- exact page count, filenames, and order
- SVG and PNG dimensions
- offline/self-contained SVG resources
- required visible labels and page numbers
- shared-device or shared-instance markers
- a second identical build produces identical hashes
- conditional pages agree with installed profiles

## 7. Build and validate the OVGME package

`Build-OvGME.ps1 -Version <version>` stages one named package container whose root contains:

```text
Config/Input/<input-module-id>/joystick/*.diff.lua
KNEEBOARD/<kneeboard-id>/*.png
```

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

Regenerate `dist/SHA256SUMS.txt` for every release ZIP. `Test-Release.ps1` must expand the complete bundle, assert its exact required file inventory, run optional component validators, and recompute every declared checksum.

Use `packaging/release/RELEASE-NOTES.md` as the default release notes path. Keep all artifact paths literal and synchronized across scripts and workflow callers.

## 9. Use tag-authoritative semantic versions

Release tags are authoritative and must match `vMAJOR.MINOR.PATCH`. `scripts/version.mjs` must support resolving an explicit version and calculating the next patch, minor, or major version. Build scripts receive the resolved value through `PACKAGE_VERSION` or `-Version`; they must not silently derive a different version from `package.json`.

The reusable release workflow calculates the next tag, regenerates and optionally commits kneeboard outputs, builds and validates packages, and targets the release at the final generated commit. Existing tags and releases are immutable.

## 10. Call the reusable GitHub workflows

Keep consumer workflows thin. The reusable workflows check out both repositories and export `DCS_COMMON_ROOT=${{ github.workspace }}/.dcs-common`.

### Pull-request and main build

```yaml
name: Build OVGME package
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    uses: ScottyMac52/DCS-Common/.github/workflows/build.yml@main
    with:
      package-version: 0.0.0-ci.${{ github.run_number }}
      install-lua-parser: true
      run-lua-parse: true
      run-release-validation: true
      package-script: scripts/Build-OvGME.ps1
      test-package-script: scripts/Test-Package.ps1
      build-release-script: scripts/Build-Release.ps1
      test-release-script: scripts/Test-Release.ps1
      artifact-name: Example-Release
      artifact-path: |
        dist/*.zip
        dist/SHA256SUMS.txt
```

Set `extra-validation-command` for repository-specific PowerShell validation and `run-autohotkey-tests: true` when applicable. Override build/test commands or `package-root` only when the repository layout requires it.

### Tagged release

```yaml
name: Create tagged OVGME release
on:
  workflow_dispatch:
    inputs:
      bump:
        description: Semantic version component to increment
        required: true
        default: patch
        type: choice
        options: [patch, minor, major]

permissions:
  contents: write

concurrency:
  group: ovgme-release
  cancel-in-progress: false

jobs:
  release:
    uses: ScottyMac52/DCS-Common/.github/workflows/release.yml@main
    with:
      bump: ${{ inputs.bump }}
      install-lua-parser: true
      run-lua-parse: true
      run-release-validation: true
      package-script: scripts/Build-OvGME.ps1
      test-package-script: scripts/Test-Package.ps1
      build-release-script: scripts/Build-Release.ps1
      test-release-script: scripts/Test-Release.ps1
      artifact-name: Example-Release-${{ inputs.bump }}-${{ github.run_number }}
      artifact-path: |
        dist/*.zip
        dist/SHA256SUMS.txt
      release-notes-path: packaging/release/RELEASE-NOTES.md
      kneeboard-paths: kneeboard/source kneeboard/Example_Module
      release-title-prefix: DCS Example Components
    secrets: inherit
```

The release workflow requires `contents: write` and serialized concurrency because it may commit regenerated kneeboard paths to `main` before creating the tag and GitHub Release. List every generated SVG and PNG directory in `kneeboard-paths`.

## 11. Known-good references

Use these repositories as implementation references, not as sources to copy shared geometry from:

- [DCS-F-16C-Components](https://github.com/ScottyMac52/DCS-F-16C-Components): aircraft profiles, profile-driven pages, OVGME, complete release, and reusable workflow callers
- [DCS-F-14B-U-Components](https://github.com/ScottyMac52/DCS-F-14B-U-Components): aircraft profiles and shared hardware pages
- [DCS-F4U-1D-Components](https://github.com/ScottyMac52/DCS-F4U-1D-Components): two instances of one canonical shared device
- [DCS-UI-Layer](https://github.com/ScottyMac52/DCS-UI-Layer): a global UI-layer kneeboard and Saved Games packaging

## 12. Verification checklist

Copy this checklist into the first pull request for a new consumer:

```markdown
- [ ] Record the exact input module ID, kneeboard ID, and tested Saved Games root.
- [ ] Run `npm ci`.
- [ ] Parse every `.lua` file and run profile/device/reserved-input validation.
- [ ] Set `DCS_COMMON_ROOT` or create the `.dcs-common` checkout.
- [ ] Set a test `PACKAGE_VERSION` and run `npm run build:kneeboard`.
- [ ] Run `npm run test:kneeboard` and confirm a deterministic rebuild.
- [ ] Run `npm run test:versioning`.
- [ ] Run `pwsh ./scripts/Build-OvGME.ps1 -Version 0.0.0-local`.
- [ ] Run `pwsh ./scripts/Test-Package.ps1 -Version 0.0.0-local`.
- [ ] Run `pwsh ./scripts/Build-Release.ps1 -Version 0.0.0-local`.
- [ ] Run `pwsh ./scripts/Test-Release.ps1 -Version 0.0.0-local`.
- [ ] Visually inspect every generated hardware page at normal kneeboard scale.
- [ ] Open a pull request and require reusable build CI to pass.
- [ ] Run one patch release end to end; verify regenerated assets, tag target, ZIP contents, checksums, and GitHub Release downloads.
```

A later DCS-Common draw.io or SVG change is incorporated when this consumer is rebuilt or re-released with the updated shared catalog. It does not rewrite an existing tag, package, or release.
