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
