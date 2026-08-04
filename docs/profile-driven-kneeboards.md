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

## Modifier layers

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
