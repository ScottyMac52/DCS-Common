# Toggle-layer modifier fixture

Minimal example of the operator workflow in [Profile-driven kneeboards](../../docs/profile-driven-kneeboards.md):

- `modifiers.lua` — native DCS toggle (`WH_MODE` on Warthog BTN3) and hold (`AVA_F16_S3`)
- `profiles/mfd.diff.lua` — same OSB/rocker keys with and without the `WH_MODE` reformer
- `kneeboard.json` — alias `MODE` → `WH_MODE`, base layer + mode layer pages

This is documentation and a load-test shape for `loadProfileDrivenConfig`. It is not a full aircraft consumer. Paths are relative to this directory; point `consumerRoot` here when experimenting from Common.
