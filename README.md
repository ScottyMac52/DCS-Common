# DCS-Common

This repository now hosts a shared kneeboard rendering pipeline for DCS component repos.

## Shared kneeboard renderer

Consumer repositories can define a config object with:

- an asset map for local or embedded image sources
- a list of summary and hardware pages
- per-page metadata, callouts, notes, and image layers

The shared renderer in scripts/kneeboard-renderer.mjs renders deterministic SVG output and optional PNG output from that contract.

Use the example config in examples/f14b-config.mjs and the render script in scripts/render-kneeboard-example.mjs to validate the flow locally.