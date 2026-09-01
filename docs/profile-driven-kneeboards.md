# Profile-driven kneeboards

Aircraft repositories keep their DCS `.diff.lua` profiles as binding data and add a JSON composition file. DCS-Common parses the profiles, validates every referenced joystick key, and supplies the DCS binding name as the default kneeboard label. A short `label` override is allowed when the DCS name is too long for the hardware diagram.

Each configured device renders as **one locator page**. Callout type on that diagram is forced to 16px (13px when stacked modifier variants share a callout) so the page is readable in DCS and VR without companion `*-BINDINGS-*` list pages. The old list pages remain available only when a consumer passes `includeReadableBindings: true` into `renderSharedHardwarePages`.

When a page uses `controls`, any page-level `labels` map must be **ID-keyed** (callout id → text). An ordered `labels` **array** is only valid on pages **without** `controls`; the loader rejects `controls` + array labels with `profile-driven controls require ID-keyed labels`. Prefer ID-keyed `labels` and/or per-control `"label"` for profile-driven pages.

```json
{
  "schemaVersion": 1,
  "aircraft": "F-14B(U)",
  "profiles": {
    "pto2": "src/Config/Input/F-14BU/joystick/WINCTRL CarrierAce PTO 2 {GUID}.diff.lua"
  },
  "pages": [
    {
      "file": "05-PTO2",
      "deviceId": "winctrl-pto2",
      "title": "WINCTRL CARRIERACE PTO2",
      "controls": {
        "pto2-button-35": { "profile": "pto2", "key": "JOY_BTN35", "label": "Gear up" }
      }
    }
  ]
}
```

Control IDs come from the shared hardware catalog. Profile aliases and paths belong to the consuming repository. A build fails when a profile is missing, a joystick key is unbound or ambiguous, or a control ID is not present on the selected shared device.

## Generic MOZA AB9 profiles

A generic `MOZA AB9 FFB Flight Base {GUID}.diff.lua` filename identifies the AB9 interface, but not the attached grip. Do not infer the grip from the aircraft name or binding inventory.

When scaffolding a consumer, pass a consumer-owned `--map` JSON file that maps the exact filename or GUID-stripped stem to:

- `moza-ab9-warthog-grip` for the F-16C/Viper-style grip;
- `moza-ab9-hornet-grip` for the F/A-18C Hornet grip.

The chosen alias is retained as the generated page `deviceId` and resolves to the canonical grip Lua, draw.io, and SVG assets. Without an override, a bare AB9 filename resolves to `moza-ab9`, whose catalog contains only the base pitch and roll axes. The separately connected VKB F-14 controller uses `vkb-f14-gunfighter`.

MOZA profiles may expose the cardinal POV directions as `JOY_BTN_POV1_U/R/D/L`, while the canonical Hornet and Warthog/Viper catalogs use `JOY_POV1_U/R/D/L`. During scaffold callout lookup, the two MOZA composite aliases translate only those verified keys to the canonical catalog keys. Generated `controls` retain the original `JOY_BTN_POV1_*` values so binding resolution still targets the native DCS profile. Other device identities are not normalized.

See [Consumer repository setup](consumer-repository-setup.md#generic-moza-ab9-grip-selection) for copyable CLI and WPF instructions.

## TM MFD side categories

TM MFD pages can replace the fixed directional words in the center display with optional functional categories for each five-button side. These values are presentation metadata: they do not represent DCS commands or physical controls and do not affect binding counts, modifiers, or UI Layer applicability.

```json
{
  "file": "02-TM-MFD-1",
  "deviceId": "tm-mfd",
  "deviceInstance": "MFD1",
  "categoryLabels": {
    "top": "Jester Steerpoints",
    "right": "Jester Radar",
    "bottom": "Radar Range",
    "left": "Target Management"
  }
}
```

Only `top`, `right`, `bottom`, and `left` are accepted. Missing or blank values render blank. A modifier layer may override selected sides; unspecified sides inherit the page values and an explicit empty string clears an inherited category.

```json
{
  "id": "shifted",
  "categoryLabels": { "top": "VR and View Controls" },
  "controls": {}
}
```

For the F-14B(U), a useful MFD 1 top category is **Jester Steerpoints**, grouping Set SP 1, Set SP 2, Set SP 3, Set FP, and Set IP.

## Modifier layers (overview)

Set `modifiersFile` to import native DCS modifier declarations and map stable consumer aliases through `modifiers`. A page may define `layers`; each layer resolves the same physical controls using an exact modifier chord and becomes a deterministic output page.

```json
{
  "modifiersFile": "src/Config/Input/modifiers.lua",
  "modifiers": {
    "S3": { "nativeName": "AVA_F16_S3", "deviceId": "tm-warthog-grip", "mode": "hold" }
  },
  "pages": [
    {
      "file": "03-LEFT-MFD",
      "deviceId": "tm-mfd",
      "layers": [
        { "id": "base", "controls": { "mfd-osb-t1": { "profile": "left", "key": "JOY_BTN1" } } },
        { "id": "s3", "file": "03-S3-LEFT-MFD", "modifiers": ["S3"], "controls": { "mfd-osb-t1": { "profile": "left", "key": "JOY_BTN1" } } }
      ]
    }
  ]
}
```

See the operator procedure below for hold vs toggle, exact-chord rules, and a full Warthog BTN3 worked example.

## Modifier layers and operator workflow

### Phase 1 — Declare the modifier in DCS

1. In DCS **Controls**, open **Modifiers** (module or UI layer as appropriate).
2. Add a modifier on the physical control:
   - **Hold** (`switch = false`): chord active only while pressed.
   - **Toggle** (`switch = true`): press to arm, press to disarm.
3. Export the module input folder (or UI layer) so `modifiers.lua` and the relevant `.diff.lua` files are on disk.

### Phase 2 — Wire the consumer JSON

1. Point `modifiersFile` at the versioned `modifiers.lua`.
2. Map a stable alias under `modifiers` (`nativeName` must match DCS).
3. Set `mode` to `hold` or `toggle` to match DCS `switch`.

### Phase 3 — Bind alternate functions with the reformer

1. In DCS, assign base (no reformer) commands on the shared physical keys.
2. For each alternate function, bind the **same physical key** with the **WH_MODE** reformer active (toggle engaged in the controls UI when assigning).
3. Re-export profiles so `added` entries carry the reformer list.

### Phase 4 — Layer the kneeboard page

```json
{
  "modifiersFile": "src/Config/Input/F-16C_50/modifiers.lua",
  "modifiers": {
    "MODE": {
      "nativeName": "WH_MODE",
      "deviceId": "tm-warthog-grip",
      "mode": "toggle",
      "label": "Warthog BTN3 mode"
    }
  },
  "pages": [
    {
      "file": "02-LEFT-MFD",
      "deviceId": "tm-mfd",
      "layers": [
        {
          "id": "base",
          "controls": {
            "mfd-osb-t1": { "profile": "left", "key": "JOY_BTN1" }
          }
        },
        {
          "id": "mode",
          "file": "02-LEFT-MFD-MODE",
          "title": "LEFT MFD • MODE TOGGLE ACTIVE",
          "modifiers": ["MODE"],
          "controls": {
            "mfd-osb-t1": { "profile": "left", "key": "JOY_BTN1" }
          }
        }
      ]
    }
  ]
}
```

Notes:

- Alias id (`MODE`) is stable for the consumer; `nativeName` must match the DCS modifier name (`WH_MODE`).
- Declaring `"mode": "toggle"` must agree with `switch = true` in `modifiers.lua` or the load fails.
- Each layer becomes its own output page: base keeps `02-LEFT-MFD`; mode layer uses `02-LEFT-MFD-MODE`.
- Control IDs must exist on the shared device (`tm-mfd` catalog). Labels default to the DCS binding name unless `label` is set (or an ID-keyed `labels` entry overrides the same callout).
- Optional: set `modifiers` on an individual control reference when that control’s chord differs from the layer default.

### Phase 5 — Rebuild and validate

1. Point `DCS_COMMON_ROOT` at a current DCS-Common checkout (or rely on CI `.dcs-common`).
2. Run `npm run build:kneeboard` in the consumer (unified single script).
3. Run `npm run test:kneeboard` — profile-driven resolution must find **exactly one** binding per control + chord.
4. Package / release as usual.
5. In OpenKneeboard, both the base and mode-layer pages should appear so the pilot can see alternate legends when the toggle is armed.

### Phase 6 — In-cockpit checklist

- [ ] Press Warthog BTN3 once: mode engages (DCS toggle modifier).
- [ ] Unmodified OSB/rocker presses fire base commands when mode is off.
- [ ] With mode on, the same OSB/rocker presses fire the reformer-bound commands.
- [ ] Press BTN3 again: mode disengages.
- [ ] Kneeboard mode page legends match the reformer bindings (not the base names).

---

## Hold vs toggle

| DCS `switch` | Common `mode` | Pilot feel | Kneeboard implication |
| --- | --- | --- | --- |
| `false` | `hold` | Must hold the button while using secondaries | Layer title/kicker should say **HELD** |
| `true` | `toggle` | Press to arm, press to disarm | Layer title/kicker should say **TOGGLE ACTIVE** |

Hold is common for grip/throttle chord buttons (e.g. AVA S3, VKB BTN7). Toggle fits dedicated mode switches such as Warthog BTN3 in the worked example above.

---

## Exact-chord rules

- Reformer lists are **sorted and de-duplicated** for comparison (canonicalized order).
- **Membership is exact:** `[]`, `["WH_MODE"]`, and `["WH_MODE", "S3"]` are three different chords.
- Layer `modifiers: ["MODE"]` resolves alias → native name, then matches only profile `added` entries whose `reformers` equal that chord.
- A control may override the layer chord with its own `modifiers` array.

---

## Failure modes

| Symptom | Typical cause |
| --- | --- |
| `modifier X references undeclared native modifier` | `nativeName` missing from `modifiersFile` |
| `modifier X is hold in modifiers.lua, not toggle` | JSON `mode` disagrees with DCS `switch` |
| `modifier X requires a native declaration or device, key, and hold/toggle mode` | Incomplete alias and no import |
| `duplicate modifier name` / `use the same physical input` | Invalid `modifiers.lua` |
| `resolves to 0 bindings` | Profile has no `added` entry for that key + chord |
| `resolves to 2 bindings` | Ambiguous commands for the same key + chord; set `command` on the control reference |
| Control ID not on device | Wrong callout id for `deviceId` |

---

## Non-goals

- DCS-Common does not change how DCS evaluates modifiers; it only parses and validates them for kneeboard generation.
- Profiles remain pilot-exported source of truth; Common does not auto-generate `.diff.lua` from JSON.
- OpenKneeboard pages are **static** layers. There is no live HID-driven page switch; the pilot selects the matching reference page when the mode is armed.

---

## Fixture example

A minimal toggle-layer fixture lives under [`examples/modifiers-toggle-layer/`](../examples/modifiers-toggle-layer/). It mirrors the unit-test pattern with a native `modifiers.lua`, a profile containing base and `WH_MODE` chords, and a layered `kneeboard.json`.
