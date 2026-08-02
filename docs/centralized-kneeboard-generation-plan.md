# Centralized kneeboard generation plan

## Summary

This work proposes moving the shared kneeboard image and SVG generation logic into DCS-Common so that consuming repos provide configuration rather than duplicate rendering logic.

## Goals

- Make DCS-Common the source of truth for shared control-layout rendering.
- Keep repo-specific content as configuration inputs to a common rendering pipeline.
- Preserve deterministic output and the existing build/release contract.

## Proposed approach

1. Introduce a reusable rendering contract in DCS-Common.
2. Define a templated input format that consumer repos can supply.
3. Keep the current package/build/test workflows intact while routing generation through the shared pipeline.
4. Document the contributor workflow for adding or modifying a layout.

## Acceptance criteria

- Shared generation code and supporting assets live in DCS-Common.
- Consumer repos can invoke the pipeline with repo-specific configuration.
- Existing validation and package flows continue to pass.
- The workflow is documented for future contributors.
