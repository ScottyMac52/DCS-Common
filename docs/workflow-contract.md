# Shared workflow contract

This repository hosts reusable GitHub Actions workflows for DCS component repositories.

## Required downstream repository conventions

A repository that consumes these workflows should provide:

- a Node.js-based build/test toolchain with npm scripts for kneeboard generation and validation
- a single kneeboard generator at `scripts/build-kneeboard.mjs` that imports Common helpers directly (`shared-hardware-consumer.mjs`, `profile-driven-kneeboard.mjs`, and when needed `kneeboard-renderer.mjs`)
- a versioning script at `scripts/version.mjs` when release automation is used
- package build and test scripts that accept a `-Version` argument:
  - `scripts/Build-OvGME.ps1`
  - `scripts/Test-Package.ps1` (covers both OVGME package and complete-release validation)
  - `scripts/Build-Release.ps1` when full release packaging is enabled
- optional AutoHotKey validation at `scripts/Test-AutoHotKey.ps1`
- optional repository-specific validation through `extra-validation-command`
- a repository-specific artifact name and artifact path for upload

Do **not** require:

- `scripts/apply-shared-hardware.mjs` (obsolete two-step path)
- `scripts/Test-Release.ps1` (use `Test-Package.ps1` for both workflow inputs)

## Reusable workflow inputs

The build and release workflows accept repository-specific inputs for:

- package scripts and validation scripts
- kneeboard build/test commands
- optional Lua parsing and AutoHotKey validation
- independent complete-release build and validation switches
- repository-specific validation and release-note preparation commands
- release notes path and kneeboard path globs for regeneration commits

These inputs keep the shared workflows flexible while preserving a consistent build and release contract across repositories.

## Shared kneeboard generation contract

Consumer repositories adopt the Common rendering pipeline:

- `scripts/shared-hardware-consumer.mjs` — shared device diagrams and provenance footers
- `scripts/profile-driven-kneeboard.mjs` — profile binding resolution and control labels
- `scripts/kneeboard-renderer.mjs` — summary/text pages when the consumer defines `summaryPages`

The consumer owns page order, titles, labels, and packaging. DCS-Common owns geometry, callout IDs, product images, and rendering helpers. Generated SVG/PNG output is committed in the consumer and must be deterministic.
