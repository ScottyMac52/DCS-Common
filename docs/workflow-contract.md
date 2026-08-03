# Shared workflow contract

This repository hosts reusable GitHub Actions workflows for DCS component repositories.

## Required downstream repository conventions

A repository that consumes these workflows should provide:

- a Node.js-based build/test toolchain with npm scripts for kneeboard generation and validation
- a versioning script at scripts/version.mjs when release automation is used
- package build and test scripts that accept a `-Version` argument, for example:
  - scripts/Build-OvGME.ps1
  - scripts/Test-Package.ps1
- optional release scripts when full release validation is enabled:
  - scripts/Build-Release.ps1
  - scripts/Test-Release.ps1
- optional AutoHotKey validation at scripts/Test-AutoHotKey.ps1
- a repository-specific artifact name and artifact path for upload

## Reusable workflow inputs

The build and release workflows accept repository-specific inputs for:

- package scripts and validation scripts
- kneeboard build/test commands
- optional Lua parsing and AutoHotKey validation
- release notes path and kneeboard path globs for regeneration commits

These inputs keep the shared workflows flexible while preserving a consistent build and release contract across repositories.

## Shared kneeboard generation contract

Consumer repositories can also adopt the common rendering pipeline in scripts/kneeboard-renderer.mjs. The contract is intentionally simple:

- a config object defines the pages and page metadata
- assets are resolved from a repo-local asset map
- the renderer emits SVG pages and optional PNG pages to a target output directory

This keeps the visual layout logic in DCS-Common while letting each aircraft repository provide its own content and placement data.
