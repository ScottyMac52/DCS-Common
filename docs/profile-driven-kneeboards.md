# Profile-driven kneeboards

Aircraft repositories keep their DCS `.diff.lua` profiles as binding data and add a JSON composition file. DCS-Common parses the profiles, validates every referenced joystick key, and supplies the DCS binding name as the default kneeboard label. A short `label` override is allowed when the DCS name is too long for the hardware diagram.

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

## Modifier layers (overview)

Set `modifiersFile` to import native DCS modifier declarations and map stable consumer aliases through `modifiers`. A page may define `layers`; each layer resolves the same physical controls using an exact modifier chord and becomes a deterministic output page.

```json
{
  "modifiersFile": "src/Config/Input/modifiers.lua",
  "modifiers": {
    "S3": { "nativeName": "AVA_F16_S3", "deviceId": "ava-base-f16c", "mode": "hold" }
  },
  "pages": [{
    "file": "02-LEFT-MFD",
    "deviceId": "tm-mfd",
    "layers": [
      { "id": "base", "controls": { "mfd-osb-t1": { "profile": "left", "key": "JOY_BTN1" } } },
      { "id": "s3", "file": "03-S3-LEFT-MFD", "modifiers": ["S3"], "controls": { "mfd-osb-t1": { "profile": "left", "key": "JOY_BTN1" } } }
    ]
  }]
}
```

Modifier order is canonicalized, while exact chord membership is preserved. A one-modifier binding is distinct from an unmodified binding and from a two-modifier chord. Native `switch = false` modifiers are reported as `hold`; switched modifiers are reported as `toggle` so consumers can render accurate legends.

---

## Operator workflow: implement a modifier end-to-end

Use this procedure after you create or change a modifier in DCS and want consumer profiles and kneeboard layers to match.

**Worked example:** Thrustmaster Warthog **JOY_BTN3** as a **toggle mode switch**. While the mode is armed, selected **TM MFD OSBs and rockers** resolve to alternate DCS commands.

### Phase 1 — Declare the modifier in DCS

1. In DCS **Controls**, open **Modifiers** (module or UI layer as appropriate).
2. Add a modifier on the physical control:
   - Device: exact DCS device name / GUID (e.g. Joystick - HOTAS Warthog)
   - Key: `JOY_BTN3`
   - **Switch = On** for toggle (press engages, press again disengages). **Switch = Off** for hold-to-use.
3. Give it a stable native name, e.g. `WH_MODE`. This string becomes the reformer name in `.diff.lua`.
4. Let DCS write `Saved Games/.../Config/Input/<ModuleOrUiLayer>/modifiers.lua`.

Expected native shape (simplified):

```lua
local modifiers = {
  ["WH_MODE"] = {
    ["device"] = "Joystick - HOTAS Warthog {GUID}",
    ["key"] = "JOY_BTN3",
    ["switch"] = true,  -- toggle
  },
}
return modifiers
```

Rules enforced when Common imports the file:

- Each modifier requires `device`, `key`, and `switch`
- Names are unique case-insensitively
- Two modifiers cannot share the same device + key

### Phase 2 — Bind base and alternate functions in DCS

1. On the target device profile (e.g. `F16 MFD 1 {GUID}.diff.lua`), bind **unmodified** OSB/rocker commands as usual.
2. For each alternate function, bind the **same physical key** with the **WH_MODE** reformer active (toggle engaged in the controls UI when assigning).
3. Export / copy the resulting `.diff.lua` into the consumer under `src/Config/Input/...`.

Illustrative same-key bindings:

| Physical | Reformers | Example DCS command name |
| --- | --- | --- |
| `JOY_BTN1` | _(none)_ | Left MFD OSB 1 |
| `JOY_BTN1` | `WH_MODE` | Markpoint shortcut |
| `JOY_BTN25` | _(none)_ | BRT up |
| `JOY_BTN25` | `WH_MODE` | Alternate rocker function |

Chord membership is exact: unmodified ≠ `WH_MODE` ≠ `WH_MODE + OTHER`.

### Phase 3 — Version modifiers in the consumer repository

1. Copy the DCS `modifiers.lua` into the consumer, for example:
   - `src/Config/Input/<AircraftOrUiLayer>/modifiers.lua`
2. Commit the updated `.diff.lua` profiles that contain the reformer chords.
3. When `modifiersFile` is set, do **not** invent reformer names in JSON that are missing from `modifiers.lua` — the catalog requires a native match.
4. If the OvGME package is the pilot’s source of truth for modifiers (not only kneeboard generation), ship the same `modifiers.lua` on the path DCS expects under `Config/Input/...`.

### Phase 4 — Wire aliases and layers in `config/kneeboard.json`

```json
{
  "schemaVersion": 1,
  "aircraft": "F-16C_50",
  "modifiersFile": "src/Config/Input/F-16C_50/modifiers.lua",
  "modifiers": {
    "MODE": {
      "nativeName": "WH_MODE",
      "deviceId": "tm-warthog-grip",
      "mode": "toggle",
      "label": "Warthog BTN3 mode"
    }
  },
  "profiles": {
    "leftMfd": "src/Config/Input/F-16C_50/joystick/F16 MFD 1 {GUID}.diff.lua"
  },
  "pages": [
    {
      "file": "02-LEFT-MFD",
      "deviceId": "tm-mfd",
      "title": "COUGAR MFD 1 • LEFT MFD",
      "layers": [
        {
          "id": "base",
          "controls": {
            "mfd-osb-t1": { "profile": "leftMfd", "key": "JOY_BTN1" },
            "mfd-rocker-brt-up": { "profile": "leftMfd", "key": "JOY_BTN25" }
          }
        },
        {
          "id": "mode",
          "file": "02-LEFT-MFD-MODE",
          "title": "COUGAR MFD 1 • MODE LAYER",
          "kicker": "WH_MODE TOGGLE ACTIVE • WARTHOG BTN3",
          "modifiers": ["MODE"],
          "controls": {
            "mfd-osb-t1": { "profile": "leftMfd", "key": "JOY_BTN1" },
            "mfd-rocker-brt-up": { "profile": "leftMfd", "key": "JOY_BTN25" }
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
- Control IDs must exist on the shared device (`tm-mfd` catalog). Labels default to the DCS binding name unless `label` is set.
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
