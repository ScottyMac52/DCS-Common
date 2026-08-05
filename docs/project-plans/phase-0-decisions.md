# Phase 0 decisions — DCS Input Profile Importer

Accepted **2026-08-05**. Product plan: [consumer-scaffold-wpf.md](consumer-scaffold-wpf.md).

| Item | Decision |
| --- | --- |
| Architecture | Option A — WPF shell invokes Node `scripts/scaffold-consumer.mjs` |
| App location | `tools/DcsConsumerScaffold/` inside DCS-Common |
| Runtime packaging | **A2 — Require Node.js on PATH** |
| Product name | **DCS Input Profile Importer** |
| Inno `app_publisher` | **Vyper Industries** |
| App version tags | **Four-part `vMAJOR.MINOR.PATCH.BUILD`** |
| TFM | `net10.0-windows` |

## Delivery status

| Phase | Status |
| --- | --- |
| Preview engine + device map | Shipped (#66) |
| WPF preview shell + CI | Shipped (#67) |
| Write path + templates | Shipped (#68) |
| Proceed + Inno tag path | Shipped (#69); CI YAML/tuple fix (#70) |
| Docs as preferred path | Close-out PR |
