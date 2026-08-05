# Phase 0 decisions — DCS Input Profile Importer

Accepted **2026-08-05**. Authoritative product plan: [consumer-scaffold-wpf.md](consumer-scaffold-wpf.md) (when merged).

| Item | Decision |
| --- | --- |
| Architecture | Option A — WPF shell invokes Node `scripts/scaffold-consumer.mjs` |
| App location | `tools/DcsConsumerScaffold/` inside DCS-Common |
| Runtime packaging | **A2 — Require Node.js on PATH** (installer does not bundle Node) |
| Product name | **DCS Input Profile Importer** |
| Inno `app_publisher` | **Vyper Industries** |
| App version tags | **Four-part `vMAJOR.MINOR.PATCH.BUILD`** (shared-github-workflows) |

## Implementation order

1. **PR1 (this track):** `--preview-json` engine + `scaffold-device-map.json` + Node tests
2. WPF shell + preview UI + `scaffold-app.yml` CI
3. Engine write path + consumer templates
4. Inno installer + docs close-out
