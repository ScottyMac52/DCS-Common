# F-14 autopilot mapping for the TM Warthog throttle

This design targets the F-14A, F-14B, and F-14B(U) pilot controls. It favors
useful in-flight functions on the unmodified Warthog autopilot panel and keeps
the VKB F-14 Gunfighter `JOY_BTN7` hold layer limited to distinct functions.

## Recommended mapping

| Hardware | Base function | `JOY_BTN7` held | Rationale |
| --- | --- | --- | --- |
| Warthog EAC ON (`JOY_BTN24`) | Autopilot engage / attitude hold | — | The maintained switch uses deterministic `On, else Off` behavior. |
| Warthog RDR ALT NORMAL (`JOY_BTN25`) | Altitude hold | — | The maintained switch uses deterministic `On, else Off` behavior. |
| Warthog AP ENGAGE (`JOY_BTN26`) | Heading hold toggle | — | The momentary button matches the one-shot heading toggle command. |
| Warthog AP SELECT UP (`JOY_BTN27`) | Ground track, else off | VEC/PCD, else off | Ground track is useful in DCS, while the Link 4 VEC/PCD function is not modeled. |
| Warthog AP SELECT DOWN (`JOY_BTN28`) | ACL, else off | — | The maintained position returns the cockpit selector to OFF when released. |
| VKB weapons release (`JOY_BTN3`) | Store release | A/P REF / NWS | Preserves the existing shifted A/P reference binding. |
| VKB paddle (`JOY_BTN6`) | Emergency autopilot disconnect | Catapult salute | The safety-critical disconnect is direct; the displaced salute remains available. |
| VKB NWS (`JOY_BTN7`) | Hold modifier | — | `switch = false`; it is active only while held. |

The ground-track command replaces VEC/PCD on the base `JOY_BTN27` position.
VEC/PCD remains available on the shifted position for cockpit completeness, but
Heatblur documents that Link 4 remote vector control is not modeled in DCS.

The same logical mapping is recommended for all three variants. The F-14B(U)
DFCS manual says it retained the AFCS autopilot and ACL functions, but its
autopilot chapter does not repeat the F-14A/B ground-track, VEC/PCD, or ACL
procedures.

## Command equivalence

These DCS actions are alternate interaction forms for the same cockpit
capability. A profile should select one form per physical control rather than
binding every form.

| Capability | Selected form | Forms intentionally not selected |
| --- | --- | --- |
| Autopilot engage | `Autopilot On, else Off` | explicit ON, explicit OFF, toggle |
| Altitude hold | `Altitude Hold On, else Off` | explicit ON, explicit OFF, toggle |
| Heading hold | `Autopilot Heading Toggle On` | maintained HDG position and generic toggle forms |
| Ground track | `Autopilot Heading GT, else Off` | explicit GT/OFF and toggle forms |
| Vector selector | `Autopilot Vector VEC/PCD, else Off` | explicit VEC/PCD/OFF and selector toggle forms |
| ACL selector | `Autopilot Vector ACL, else Off` | explicit ACL/OFF and selector toggle forms |
| A/P reference | `Autopilot Reference / Nosewheel Steering Toggle` | duplicate NWS forms |
| Emergency disconnect | `Autopilot Emergency Disconnect Paddle` | modified or indirect disconnect forms |

## DCS command/value table

The sample fixture in
`examples/f14-autopilot-mapping/profiles/proposed-f14-pilot.diff.lua` uses the
following cockpit actions.

| Action | Device | Press | Release | Interaction |
| --- | ---: | ---: | ---: | --- |
| Autopilot engage | 22 / 3040 | `1` | `-1` | maintained ON/OFF |
| Altitude hold | 22 / 3038 | `1` | `-1` | maintained ALT/OFF |
| Heading toggle | 22 / 3744 | `1` | none | momentary |
| Ground track | 22 / 3042 | `1` | `0` | maintained GT/OFF |
| VEC/PCD | 22 / 3039 | `-1` | `0` | maintained VEC/OFF |
| ACL | 22 / 3039 | `1` | `0` | maintained ACL/OFF |
| A/P REF / NWS | 57 / 3085 | `1` | `0` | momentary |
| Emergency disconnect paddle | 57 / 3086 | `1` | `0` | momentary |

The checked-in F-14B(U) consumer export directly confirms the engage, altitude,
heading-toggle, and A/P REF/NWS encodings. The selector, ground-track, and
emergency-paddle encodings follow the adjacent cockpit device commands and must
be confirmed against fresh DCS exports before this sample is promoted into a
consumer repository.

## Variant status

| Variant | Functional recommendation | Input-definition status |
| --- | --- | --- |
| F-14A | Use the canonical mapping above. | Fresh pilot export still required. |
| F-14B | Use the canonical mapping above. | Fresh pilot export still required. |
| F-14B(U) | Use the canonical mapping above. | Engage, altitude, heading, and A/P REF/NWS verified from the committed consumer export; remaining commands require a fresh export. |

Do not claim command-ID parity merely because the aircraft functions are
equivalent. Before consumer rollout, export each module's pilot controls and
compare command name, device ID, press value, and release value against the
table above. Any mismatch belongs in a variant-specific profile rather than
being normalized silently.

## In-sim validation

1. Engage autopilot with `JOY_BTN24`; releasing the maintained switch must turn
   it off without state drift.
2. Select altitude hold with `JOY_BTN25`, then accept the reference with
   `JOY_BTN7 + JOY_BTN3`.
3. Press `JOY_BTN26` repeatedly and verify it selects HDG and OFF only; it must
   not enter GT.
4. Move `JOY_BTN27` without a modifier, accept A/P REF, and verify wind-corrected
   ground track. Returning the switch to center must select OFF.
5. Hold VKB `JOY_BTN7`, move `JOY_BTN27`, and verify VEC/PCD is selected. Return
   the switch to center before releasing the modifier.
6. Move `JOY_BTN28`, verify ACL selection, and verify return-to-center selects
   OFF.
7. Press the unmodified VKB paddle and verify the autopilot disconnects
   immediately. Hold `JOY_BTN7` and press the paddle to verify catapult salute.
8. Generate the kneeboard and verify base and BTN7 labels appear independently
   on the shared `JOY_BTN27` and paddle callouts.

## Sources

- [Heatblur F-14A/B Flight Controls and AFCS](https://github.com/Heatblur-Simulations/f-14-manual/blob/master/src/f14ab/systems/flight_controls_gear/flight_controls.md)
- [Heatblur F-14B(U) DFCS](https://github.com/Heatblur-Simulations/f-14-manual/blob/master/src/f14bu/systems/dfcs/digital_flight_control_system.md)
- [DCS-F-14B-U-Components](https://github.com/ScottyMac52/DCS-F-14B-U-Components)
