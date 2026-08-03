# DCS-Common

This repository now hosts a shared kneeboard rendering pipeline for DCS component repos.

## Requirements

- Node.js 22
- npm

## Local validation

```bash
npm ci
npm test
```

To regenerate and validate the shared hardware catalog:

```bash
npm run build:shared-hardware
npm run test:shared-hardware
```

## Shared kneeboard renderer

Consumer repositories can define a config object with:

- an asset map for local or embedded image sources
- a list of summary and hardware pages
- per-page metadata, callouts, notes, and image layers

The shared renderer in scripts/kneeboard-renderer.mjs renders deterministic SVG output and optional PNG output from that contract.

Use the example config in examples/f14b-config.mjs and the render script in scripts/render-kneeboard-example.mjs to validate the flow locally.

## Shared hardware catalog

The shared hardware catalog lives under assets/shared/hardware and is indexed by assets/shared/hardware/manifest.json.

Each entry contains:

- an id for downstream lookup
- a label for the hardware family
- an SVG template that preserves the underlying control image/diagram as the base layer
- a Lua stub that downstream repos can extend when wiring bindings

Downstream repositories should consume these shared templates instead of recreating the same control images and placeholder hotspots locally. The shared assets are designed to be imported into the consumer repo as a base layer, then aligned to the repo-specific button and label positions as needed.

Example consumer pattern:

```js
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('assets/shared/hardware/manifest.json', 'utf8'));
const template = manifest.devices.find((device) => device.id === 'vkb-f14-gunfighter');
console.log(template?.svg);
```
