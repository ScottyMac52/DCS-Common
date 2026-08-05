# Project plan: Consumer scaffold (Option A) — WPF UI + Node engine + Inno Setup

**Status:** Planning only (no implementation PRs until this plan is accepted)  
**Related:** [#64 Scaffold / install tool](https://github.com/ScottyMac52/DCS-Common/issues/64)  
**Architecture choice:** **Option A** — WPF application is a shell; durable generation lives in a Node scaffold engine inside DCS-Common.  
**CI/CD:** [ScottyMac52/shared-github-workflows](https://github.com/ScottyMac52/shared-github-workflows) reusable `reusable-build-and-release.yml`, terminating in **Inno Setup** `setup.exe` on version tags.

---

## 1. Problem statement

Standing up a new aircraft (or UI-layer) consumer repo is manual: copy scripts/workflows, map DCS exports to shared `deviceId`s, hand-author `kneeboard.json`, package for OvGME. Operators need:

1. A **guided Windows UI** to select DCS exports and an output directory  
2. A **preview** of controllers and bindings (including modifier chords) before any files are written  
3. One **Proceed** action that materializes a contract-compliant consumer tree  
4. A **shippable installer** for that UI so the tool is not “clone Common and run node”

---

## 2. Goals and non-goals

### Goals

| ID | Goal |
| --- | --- |
| G1 | WPF app **lives in DCS-Common** (source of truth for UI + templates + engine) |
| G2 | **Option A:** UI never owns generation rules; it invokes the **Node scaffold engine** |
| G3 | Preview grid: devices, keys, commands, reformers/chords, hold/toggle, mapping status |
| G4 | Proceed writes a full OpenKneeboard + OvGME-oriented consumer layout per [consumer-repository-setup.md](../consumer-repository-setup.md) |
| G5 | CI for the WPF solution uses **shared-github-workflows** |
| G6 | Release path produces **self-contained win-x64 EXE + Inno Setup installer** attached to a GitHub Release |
| G7 | Existing Node kneeboard/shared-hardware CI in DCS-Common **continues to work** without false coupling |

### Non-goals (this program)

- Reimplementing Lua parse / chord resolution only in C# as the long-term engine  
- Auto-creating new shared hardware geometry for unknown controllers  
- Live OpenKneeboard HID page switching  
- GitHub API “create repo” automation (local output directory is enough)  
- Replacing DCS as binding source of truth  
- Changing OvGME consumer release workflows (`DCS-Common/.github/workflows/build.yml` for *aircraft* packages) beyond documentation cross-links  

---

## 3. Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  DCS-Consumer-Scaffold (WPF, WinExe)                        │
│  - Folder pickers (profiles, modifiers, output root)        │
│  - Metadata (module id, kneeboard id, display name)         │
│  - DataGrid preview + deviceId override map                 │
│  - Proceed → process spawn                                  │
└───────────────────────────┬─────────────────────────────────┘
                            │ args + JSON override file
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  scripts/scaffold-consumer.mjs  (Node engine)               │
│  - parseDcsDiffLua / parseDcsModifiersLua (existing)        │
│  - device map → deviceId                                    │
│  - draft kneeboard.json + layers                            │
│  - templates → scripts, workflows, packaging                │
│  - SCAFFOLD-REPORT.md                                       │
│  - stdout/stderr machine-readable summary for UI            │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
                   Target consumer repo tree
```

### Runtime dependency model

The installed app must run generation without requiring a global Node install on the pilot machine **or** must document Node as a prerequisite. **Decision for implementation (default recommendation):**

| Approach | Pros | Cons |
| --- | --- | --- |
| **A1. Bundle a private Node runtime + Common scripts** inside the installer payload | Zero Node prerequisite | Larger installer; version pin Node with app |
| **A2. Require Node 22 on PATH** and resolve `DCS_COMMON_ROOT` next to the app or via setting | Smaller; matches dev | Friction for pure pilots |
| **A3. Hybrid:** ship scripts under `{app}\scaffold\`; require Node only | Clear layout | Still needs Node |

**Plan default: A1** for the production Inno package (self-contained operator experience). Dev builds may use local repo Node. Document A2 as fallback for contributors.

Installer layout (illustrative):

```text
{app}/
  DcsConsumerScaffold.exe          # WPF single-file
  scaffold/
    node/                          # private runtime (optional A1)
    scripts/scaffold-consumer.mjs
    scripts/profile-driven-kneeboard.mjs
    … minimal script graph + templates/
    assets/shared/hardware/…       # catalogs needed for mapping
  templates/consumer/              # if not inside scripts graph
```

Exact file set for the embedded engine is an implementation deliverable (dependency closure from `scaffold-consumer.mjs`).

### Process contract (UI ↔ engine)

- CLI is the **API**. WPF builds an argv list; no second generator in C#.  
- Exit codes: `0` success, non-zero failure; UI surfaces stderr.  
- Optional `--preview-json <path>` writes structured preview for the grid without mutating the output tree (Phase 1).  
- Optional `--map <overrides.json>` for deviceId corrections from the UI.  
- Optional `--dry-run` for Proceed confirmation dialogs.

---

## 4. Repository layout (DCS-Common)

Proposed addition (names adjustable during spike):

```text
DCS-Common/
  docs/project-plans/consumer-scaffold-wpf.md    # this plan
  templates/consumer/                            # emitted consumer files
  assets/shared/hardware/scaffold-device-map.json
  scripts/scaffold-consumer.mjs                  # engine entry
  scripts/…                                      # existing parsers reused
  tools/
    DcsConsumerScaffold/                         # solution root
      DcsConsumerScaffold.sln                    # ONLY .sln in repo (see CI)
      src/
        DcsConsumerScaffold/                     # WPF WinExe
      tests/
        DcsConsumerScaffold.Tests/               # xUnit/NUnit
      installer/
        installer.iss                            # Inno script (checked in)
  .github/workflows/
    scaffold-app.yml                             # calls shared-github-workflows
    build.yml / main.yml / …                     # existing Node consumer/common CI unchanged
```

### Critical CI constraint

`shared-github-workflows` **fails if more than one `.sln` / `.slnx`** is discovered repo-wide. Therefore:

- **Exactly one** solution file for the scaffold app, **or**  
- Keep the solution outside automatic discovery (not supported today—workflow searches recursively).

**Plan rule:** DCS-Common hosts **one** .NET solution (`tools/DcsConsumerScaffold/DcsConsumerScaffold.sln`). No additional solutions without updating skip/discovery strategy in shared workflows.

Existing Node workflows must **path-filter** or ignore `tools/DcsConsumerScaffold/**` where appropriate so pure doc/script PRs are not forced through full WPF publish (optional optimization).

---

## 5. WPF application scope

### UI surfaces

1. **Inputs**
   - Profiles directory (`*.diff.lua`)
   - Optional `modifiers.lua` file
   - Output / consumer root directory
   - Input module ID, kneeboard ID, display name, package name stem
   - Path to embedded or external scaffold engine (advanced; default relative to app)
2. **Preview DataGrid** (read-only until overrides)
   - Device (filename / DCS name)
   - Mapped `deviceId` or Unmapped
   - Instance hint (e.g. MFD 1/2/3)
   - Key
   - Reformers (chord)
   - Modifier mode (hold/toggle) when known
   - Command id + DCS name
   - Callout id (if catalog match)
   - Status: OK | Unmapped device | No callout | Ambiguous
3. **Mapping overrides** for unmapped devices (dropdown of catalog `deviceId`s)
4. **Proceed** — confirm, run engine, show report path, optional “open folder”

### Stack

- .NET (align with shared workflow default **10.0.x** unless spike says otherwise)
- WPF + MVVM (no requirement for a heavy framework)
- `OutputType`: `WinExe` so shared workflow selects **Executable** build mode
- Target: `net10.0-windows` (or current LTS chosen in spike) with Windows TFM

### Tests

- ViewModel tests for preview row projection from sample JSON  
- Process-builder tests (argv construction)  
- No UI automation required for MVP  

---

## 6. Node scaffold engine scope

Aligned with [#64](https://github.com/ScottyMac52/DCS-Common/issues/64):

| Phase | Engine capability |
| --- | --- |
| E0 | `--preview-json` only: parse profiles + modifiers, emit rows + mapping suggestions |
| E1 | Write `src/Config/Input/...`, draft `kneeboard.json`, `SCAFFOLD-REPORT.md` |
| E2 | Emit templates: `package.json`, unified `build-kneeboard.mjs`, PowerShell packaging, workflows |
| E3 | Optional post-step: `npm run build:kneeboard` when Node + catalogs available |

Reuse:

- `parseDcsDiffLua`, `parseDcsModifiersLua`, catalog loaders  
- Modifier layer rules from [profile-driven-kneeboards.md](../profile-driven-kneeboards.md)

Never invent `deviceId` for unknown hardware; report instead.

---

## 7. CI/CD with shared-github-workflows

### Upstream capability (authoritative)

Repo: `ScottyMac52/shared-github-workflows`  
Workflow: `.github/workflows/reusable-build-and-release.yml`

Relevant inputs:

| Input | Plan usage |
| --- | --- |
| `dotnet_version` | `10.0.x` (match shared README samples) |
| `run_tests` / `run_coverage` | true on CI and release |
| `ci_mode` | true on branch pushes (tests only) |
| `run_build_release` | true on PR/main and tags |
| `create_release` | true on version **tags** |
| `enable_installer` | **true** on tag release job |
| `installer_iss_path` | `tools/DcsConsumerScaffold/installer/installer.iss` |
| `app_publisher` | e.g. `Scott McIntosh` / agreed publisher string |
| `skip_projects` | only if needed for helper projects |

Behavior already implemented upstream:

- `windows-latest`
- Discover single solution + single `WinExe`/`Exe` app project
- `dotnet publish` self-contained single-file `win-x64` → `./publish`
- Optional Inno via Chocolatey `innosetup` + `ISCC.exe`
- Artifacts: ZIP of publish output + `_setup/setup.exe`
- GitHub Release on tag push attaches ZIP + Setup.exe

**Version tags:** shared workflow expects **`vMAJOR.MINOR.PATCH.BUILD`** (four numeric parts), e.g. `v1.0.0.0`. This differs from three-part OvGME consumer tags (`v1.3.0`). Document separately; do not mix tag schemes on the same ref patterns without care.

### Planned caller workflow in DCS-Common

File: `.github/workflows/scaffold-app.yml` (name TBD)

```yaml
# Illustrative — final YAML is an implementation PR
name: Scaffold app CI / Build / Release

on:
  push:
    branches: ['**']
    paths:
      - 'tools/DcsConsumerScaffold/**'
      - 'scripts/scaffold-consumer.mjs'
      - 'templates/consumer/**'
      - 'assets/shared/hardware/scaffold-device-map.json'
      - '.github/workflows/scaffold-app.yml'
  pull_request:
    branches: [main]
    paths:
      - 'tools/DcsConsumerScaffold/**'
      - 'scripts/scaffold-consumer.mjs'
      - 'templates/consumer/**'
      - 'assets/shared/hardware/**'
  push:
    tags:
      - 'v*.*.*.*'   # four-part tags for the app
  workflow_dispatch:

jobs:
  ci:
    if: github.event_name == 'push' && !startsWith(github.ref, 'refs/tags/')
    uses: ScottyMac52/shared-github-workflows/.github/workflows/reusable-build-and-release.yml@main
    with:
      dotnet_version: '10.0.x'
      run_tests: true
      run_coverage: true
      run_build_release: false
      ci_mode: true
      create_release: false
    secrets: inherit

  build:
    if: github.event_name == 'pull_request' || (github.event_name == 'push' && github.ref == 'refs/heads/main')
    uses: ScottyMac52/shared-github-workflows/.github/workflows/reusable-build-and-release.yml@main
    with:
      dotnet_version: '10.0.x'
      run_tests: true
      run_coverage: true
      run_build_release: true
      ci_mode: false
      create_release: false
      enable_installer: false
    secrets: inherit

  release:
    if: startsWith(github.ref, 'refs/tags/')
    uses: ScottyMac52/shared-github-workflows/.github/workflows/reusable-build-and-release.yml@main
    with:
      dotnet_version: '10.0.x'
      run_tests: true
      run_coverage: true
      run_build_release: true
      ci_mode: false
      create_release: true
      enable_installer: true
      installer_iss_path: tools/DcsConsumerScaffold/installer/installer.iss
      app_publisher: 'Scott McIntosh'
    secrets: inherit
```

### Inno Setup requirements

- Check in `installer/installer.iss` (do not rely only on auto-generate—stable `AppId` GUID).
- `#define` AppName / AppVersion / AppPublisher compatible with workflow injection.
- `[Files]` must include **publish output and embedded scaffold payload** (engine scripts, catalogs, optional Node runtime)—not only the EXE. Shared workflow’s auto-iss only packs `{#PublishDir}\*`; therefore either:
  - **Publish step (app csproj)** copies `scaffold/` into the publish directory via MSBuild targets, **or**
  - Custom ISS lists additional `Source` lines from repo paths known at build time.

**Plan default:** MSBuild target `PublishScaffoldEngine` copies the engine closure into `$(PublishDir)/scaffold` so ISS stays simple and matches upstream `/DPublishDir=`.

### Dual-pipeline coexistence

| Pipeline | Trigger | Purpose |
| --- | --- | --- |
| Existing Node workflows | Common script/hardware changes | Kneeboard renderer, shared hardware, consumer contract tests |
| `scaffold-app.yml` | Tools/templates/engine paths + four-part tags | WPF app test, publish, Inno, GitHub Release |

Node unit tests for `scaffold-consumer.mjs` stay under `npm test` / existing Node CI.

---

## 8. Work phases and exit criteria

### Phase 0 — Plan acceptance (this document)

- [ ] Confirm Option A + WPF-in-Common + shared-workflows + Inno  
- [ ] Confirm tag scheme `vX.X.X.X` for the app  
- [ ] Confirm publisher string and app display name  
- [ ] Confirm runtime packaging default **A1** (bundle Node) vs A2  
- [ ] Confirm single-solution rule  

**Exit:** Plan merged; #64 updated with pointer here.

### Phase 1 — Preview engine + WPF shell (no full write)

- [ ] `scaffold-consumer.mjs --preview-json`  
- [ ] Device map seed JSON for known manifest devices  
- [ ] WPF solution: pickers + grid bound to preview JSON  
- [ ] Unit tests (Node + .NET)  
- [ ] `scaffold-app.yml` CI mode green on PR  

**Exit:** Operator can load real exports and see modifier-aware rows; no output tree yet.

### Phase 2 — Proceed writes consumer skeleton

- [ ] Engine writes Lua into `src/`, draft `kneeboard.json`, report  
- [ ] Templates for unified build script, package.json, PowerShell, workflows  
- [ ] WPF Proceed + error surfacing  
- [ ] Fixture-based integration test (golden tree subset)  

**Exit:** Generated tree matches structural contract; unmapped devices reported, not invented.

### Phase 3 — Installer-grade publish

- [ ] MSBuild copies engine closure into publish dir  
- [ ] Checked-in `installer.iss` with stable AppId  
- [ ] Tag pipeline: `enable_installer: true`, Release has ZIP + `setup.exe`  
- [ ] Smoke: install on clean VM/user profile, run preview on fixture  

**Exit:** Production install path works without a Common git clone.

### Phase 4 — Hardening and docs

- [ ] consumer-repository-setup: “preferred new repo path = Scaffold app”  
- [ ] README section for contributors (dev vs installed)  
- [ ] #64 acceptance criteria checked off or re-scoped  
- [ ] Optional: build:kneeboard invoke after Proceed  

---

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Second `.sln` breaks shared workflow discovery | One solution only under `tools/DcsConsumerScaffold/` |
| Four-part app tags vs three-part OvGME tags | Document; path-filter release job; never tag both schemes meaninglessly |
| Installer missing engine files | Publish target must copy scaffold closure; ISS smoke test |
| Private Node runtime size / license | Pin version; document; evaluate A2 if size unacceptable |
| Path with spaces / leading-space VKB filenames | Preserve byte-for-byte copy; test with F4U-style names |
| Engine/UI version skew | Single repo version; installer embeds matching scripts |
| Scope creep into perfect callouts | MVP allows partial pages; status column honest |

---

## 10. Decision log (to be filled)

| Date | Decision | Notes |
| --- | --- | --- |
| 2026-08-05 | Option A selected | WPF shell + Node engine |
| 2026-08-05 | WPF hosted in DCS-Common | Not a separate product repo |
| 2026-08-05 | CI via shared-github-workflows | Inno on tag with `enable_installer: true` |
| | Runtime A1 vs A2 | Pending plan acceptance |
| | App product name | Pending (e.g. DCS Consumer Scaffold) |
| | `app_publisher` string | Pending |

---

## 11. Implementation PR sequence (after plan approval)

Order intentionally serial to limit blast radius:

1. **Engine preview + device map + Node tests** (no WPF)  
2. **WPF shell + preview only + scaffold-app CI (no installer)**  
3. **Engine write path + templates**  
4. **Publish embedding + installer.iss + tag release dry-run**  
5. **Docs + #64 close-out**  

No implementation PR should merge without updating this plan’s decision log if it changes architecture.

---

## 12. References

- Issue #64 — scaffold product requirements and limitations  
- [consumer-repository-setup.md](../consumer-repository-setup.md)  
- [profile-driven-kneeboards.md](../profile-driven-kneeboards.md)  
- [workflow-contract.md](../workflow-contract.md) — *aircraft* reusable workflows (separate from app CI)  
- [shared-github-workflows README](https://github.com/ScottyMac52/shared-github-workflows) — .NET test/publish/Inno  
