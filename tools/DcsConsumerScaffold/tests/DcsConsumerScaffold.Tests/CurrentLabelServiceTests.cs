using System.IO;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class CurrentLabelServiceTests
{
    [Fact]
    public void ApplyExistingRepository_PrefersCurrentLabelsAndFallsBackOnlyWhenMissing()
    {
        var destination = Directory.CreateTempSubdirectory("dcs-load-preview-labels-");
        try
        {
            var configDirectory = Directory.CreateDirectory(Path.Combine(destination.FullName, "config"));
            File.WriteAllText(Path.Combine(configDirectory.FullName, "kneeboard.json"), """
                {
                  "pages": [
                    {
                      "deviceId": "tm-mfd",
                      "deviceInstance": "MFD3",
                      "categoryLabels": {
                        "top": "Jester Steerpoints",
                        "right": "Jester Radar",
                        "bottom": "Radar Range",
                        "left": "Targets"
                      },
                      "controls": {
                        "mfd-osb-t1": {
                          "profile": "tm-mfd-3",
                          "key": "JOY_BTN1",
                          "command": "mfd-three",
                          "label": "Repository label"
                        },
                        "mfd-osb-t2": {
                          "profile": "tm-mfd-3",
                          "key": "JOY_BTN2",
                          "command": "blank-label",
                          "label": ""
                        }
                      }
                    }
                  ]
                }
                """);

            var mfd = new PreviewDevice
            {
                DeviceId = "tm-mfd",
                InstanceHint = "3",
                ProfileFile = "F16 MFD 3.diff.lua",
                ProfileKey = "tm-mfd-3",
            };
            var newDevice = new PreviewDevice
            {
                DeviceId = "future-device",
                ProfileFile = "Future Device.diff.lua",
                ProfileKey = "future-device",
            };
            var current = Row(mfd, "mfd-osb-t1", "JOY_BTN1", "mfd-three", "Shared OSB01");
            var intentionallyBlank = Row(mfd, "mfd-osb-t2", "JOY_BTN2", "blank-label", "Shared OSB02");
            var missing = Row(mfd, "mfd-osb-t3", "JOY_BTN3", "new-binding", "Shared OSB03");
            var newDeviceRow = Row(newDevice, "future-button", "JOY_BTN1", "future-command", "Shared future label");

            var result = new CurrentLabelService().ApplyExistingRepository(
                destination.FullName,
                [mfd, newDevice],
                [current, intentionallyBlank, missing, newDeviceRow]);

            Assert.Equal(2, result.CurrentCount);
            Assert.Equal(2, result.SharedHardwareCount);
            Assert.Equal("Repository label", current.Label);
            Assert.Equal("current", current.LabelSource);
            Assert.Equal(string.Empty, intentionallyBlank.Label);
            Assert.Equal("current", intentionallyBlank.LabelSource);
            Assert.Equal("Shared OSB03", missing.Label);
            Assert.Equal("device", missing.LabelSource);
            Assert.Equal("Shared future label", newDeviceRow.Label);
            Assert.Equal("device", newDeviceRow.LabelSource);
            Assert.Equal("Jester Steerpoints", mfd.CategoryTop);
            Assert.Equal("Jester Radar", mfd.CategoryRight);
            Assert.Equal("Radar Range", mfd.CategoryBottom);
            Assert.Equal("Targets", mfd.CategoryLeft);
        }
        finally
        {
            destination.Delete(recursive: true);
        }
    }

    [Fact]
    public void Apply_UsesTheSelectedInstanceCurrentLabelsAndSharedHardwareFallbacks()
    {
        var destination = Directory.CreateTempSubdirectory("dcs-current-labels-");
        try
        {
            var configDirectory = Directory.CreateDirectory(Path.Combine(destination.FullName, "config"));
            File.WriteAllText(Path.Combine(configDirectory.FullName, "kneeboard.json"), """
                {
                  "schemaVersion": 1,
                  "aircraft": "F-14B",
                  "pages": [
                    {
                      "deviceId": "tm-mfd",
                      "deviceInstance": "MFD1",
                      "controls": {
                        "mfd-osb-t1": {
                          "profile": "tm-mfd-1",
                          "key": "JOY_BTN1",
                          "command": "mfd-one",
                          "label": "MFD1 label"
                        }
                      }
                    },
                    {
                      "deviceId": "tm-mfd",
                      "deviceInstance": "MFD3",
                      "controls": {
                        "mfd-osb-t1": {
                          "profile": "tm-mfd-3",
                          "key": "JOY_BTN1",
                          "command": "mfd-three",
                          "label": "Current MFD3 label"
                        },
                        "mfd-osb-t2": {
                          "profile": "tm-mfd-3",
                          "key": "JOY_BTN2",
                          "command": "intentionally-blank",
                          "label": ""
                        }
                      }
                    }
                  ]
                }
                """);

            var device = new PreviewDevice
            {
                DeviceId = "tm-mfd",
                InstanceHint = "3",
                ProfileFile = "F16 MFD 3.diff.lua",
                ProfileKey = "tm-mfd-3",
            };
            var current = Row(device, "mfd-osb-t1", "JOY_BTN1", "mfd-three", "Shared OSB01");
            var blank = Row(device, "mfd-osb-t2", "JOY_BTN2", "intentionally-blank", "Shared OSB02");
            var fallback = Row(device, "mfd-osb-t3", "JOY_BTN3", "not-in-destination", "Shared OSB03");

            var result = new CurrentLabelService().Apply(destination.FullName, device, [current, blank, fallback]);

            Assert.Equal(2, result.CurrentCount);
            Assert.Equal(1, result.SharedHardwareCount);
            Assert.Equal("Current MFD3 label", current.Label);
            Assert.Equal("current", current.LabelSource);
            Assert.Equal(string.Empty, blank.Label);
            Assert.Equal("current", blank.LabelSource);
            Assert.Equal("Shared OSB03", fallback.Label);
            Assert.Equal("device", fallback.LabelSource);
        }
        finally
        {
            destination.Delete(recursive: true);
        }
    }

    [Fact]
    public void Apply_UsesProfileKeyWhenLegacyPagesHaveNoDeviceInstance()
    {
        var destination = Directory.CreateTempSubdirectory("dcs-current-legacy-");
        try
        {
            var configDirectory = Directory.CreateDirectory(Path.Combine(destination.FullName, "config"));
            File.WriteAllText(Path.Combine(configDirectory.FullName, "kneeboard.json"), """
                {
                  "schemaVersion": 1,
                  "aircraft": "F-14B",
                  "pages": [
                    {
                      "deviceId": "tm-mfd",
                      "controls": {
                        "mfd-osb-t1": {
                          "profile": "tm-mfd-2",
                          "key": "JOY_BTN1",
                          "command": "mfd-two",
                          "label": "Current MFD2 label"
                        }
                      }
                    },
                    {
                      "deviceId": "tm-mfd",
                      "controls": {
                        "mfd-osb-t1": {
                          "profile": "tm-mfd-3",
                          "key": "JOY_BTN1",
                          "command": "mfd-three",
                          "label": "Current MFD3 label"
                        }
                      }
                    }
                  ]
                }
                """);

            var device = new PreviewDevice
            {
                DeviceId = "tm-mfd",
                ProfileFile = "F16 MFD 3.diff.lua",
                ProfileKey = "tm-mfd-3",
            };
            var row = Row(device, "mfd-osb-t1", "JOY_BTN1", "mfd-three", "Shared OSB01");

            var result = new CurrentLabelService().Apply(destination.FullName, device, [row]);

            Assert.Equal(1, result.CurrentCount);
            Assert.Equal("Current MFD3 label", row.Label);
        }
        finally
        {
            destination.Delete(recursive: true);
        }
    }

    [Fact]
    public void Apply_UsesRepositoryLabelsWhenCommandsChangeButKeepsModifierLayersDistinct()
    {
        var destination = Directory.CreateTempSubdirectory("dcs-current-command-change-");
        try
        {
            var configDirectory = Directory.CreateDirectory(Path.Combine(destination.FullName, "config"));
            File.WriteAllText(Path.Combine(configDirectory.FullName, "kneeboard.json"), """
                {
                  "pages": [
                    {
                      "deviceId": "tm-mfd",
                      "deviceInstance": "MFD1",
                      "layers": [
                        {
                          "id": "base",
                          "controls": {
                            "mfd-osb-t1": {
                              "profile": "tm-mfd-1",
                              "key": "JOY_BTN1",
                              "command": "old-base-command",
                              "label": "Repository base label"
                            }
                          }
                        },
                        {
                          "id": "SHIFT",
                          "controls": {
                            "mfd-osb-t1": {
                              "profile": "tm-mfd-1",
                              "key": "JOY_BTN1",
                              "command": "old-shift-command",
                              "label": "Repository shifted label"
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
                """);

            var device = new PreviewDevice
            {
                DeviceId = "tm-mfd",
                InstanceHint = "1",
                ProfileFile = "F16 MFD 1.diff.lua",
                ProfileKey = "tm-mfd-1",
            };
            var baseRow = Row(device, "mfd-osb-t1", "JOY_BTN1", "new-base-command", "Shared OSB01");
            var shiftedRow = Row(device, "mfd-osb-t1", "JOY_BTN1", "new-shift-command", "Shared OSB01");
            shiftedRow.SemanticChord = "SHIFT";

            var result = new CurrentLabelService().Apply(destination.FullName, device, [baseRow, shiftedRow]);

            Assert.Equal(2, result.CurrentCount);
            Assert.Equal(0, result.SharedHardwareCount);
            Assert.Equal("Repository base label", baseRow.Label);
            Assert.Equal("Repository shifted label", shiftedRow.Label);
        }
        finally
        {
            destination.Delete(recursive: true);
        }
    }

    [Fact]
    public void Apply_DoesNotGuessWhenOnePhysicalBindingHasConflictingRepositoryLabels()
    {
        var destination = Directory.CreateTempSubdirectory("dcs-current-ambiguous-label-");
        try
        {
            var configDirectory = Directory.CreateDirectory(Path.Combine(destination.FullName, "config"));
            File.WriteAllText(Path.Combine(configDirectory.FullName, "kneeboard.json"), """
                {
                  "pages": [
                    {
                      "deviceId": "tm-mfd",
                      "deviceInstance": "MFD1",
                      "controls": {
                        "mfd-osb-t1": [
                          { "key": "JOY_BTN1", "command": "old-one", "label": "First label" },
                          { "key": "JOY_BTN1", "command": "old-two", "label": "Second label" }
                        ]
                      }
                    }
                  ]
                }
                """);

            var device = new PreviewDevice
            {
                DeviceId = "tm-mfd",
                InstanceHint = "1",
                ProfileFile = "F16 MFD 1.diff.lua",
                ProfileKey = "tm-mfd-1",
            };
            var row = Row(device, "mfd-osb-t1", "JOY_BTN1", "new-command", "Shared OSB01");

            var result = new CurrentLabelService().Apply(destination.FullName, device, [row]);

            Assert.Equal(0, result.CurrentCount);
            Assert.Equal(1, result.SharedHardwareCount);
            Assert.Equal("Shared OSB01", row.Label);
        }
        finally
        {
            destination.Delete(recursive: true);
        }
    }

    [Fact]
    public void ApplyUiLayer_UsesCanonicalOverlayForAliasAndFallsBackToSharedHardware()
    {
        var common = Directory.CreateTempSubdirectory("dcs-current-ui-layer-");
        try
        {
            var hardwareRoot = Directory.CreateDirectory(
                Path.Combine(common.FullName, "assets", "shared", "hardware"));
            var uiRoot = Directory.CreateDirectory(
                Path.Combine(common.FullName, "assets", "shared", "ui-layer"));
            File.WriteAllText(Path.Combine(hardwareRoot.FullName, "manifest.json"), """
                {
                  "devices": [
                    {
                      "id": "tm-warthog-grip",
                      "aliases": [ "ava-base-f16c" ]
                    }
                  ]
                }
                """);
            File.WriteAllText(Path.Combine(uiRoot.FullName, "functions.json"), """
                {
                  "functions": [
                    { "id": "vr-zoom", "command": "zoom-command", "label": "Curated VR Zoom" },
                    { "id": "blank-function", "command": "blank-command", "label": "" }
                  ]
                }
                """);
            File.WriteAllText(Path.Combine(uiRoot.FullName, "hardware-overlays.json"), """
                {
                  "devices": {
                    "tm-warthog-grip": {
                      "status": "template",
                      "bindings": {
                        "vr-zoom": "warthog-grip-cms-push",
                        "blank-function": "warthog-grip-cms-forward"
                      }
                    }
                  }
                }
                """);

            var device = new PreviewDevice
            {
                DeviceId = "ava-base-f16c",
                ProfileFile = "Ava Viper.diff.lua",
                ProfileKey = "ava-base-f16c",
            };
            var current = Row(device, "warthog-grip-cms-push", "JOY_BTN19", "zoom-command", "CMS push");
            var blank = Row(device, "warthog-grip-cms-forward", "JOY_BTN15", "blank-command", "CMS forward");
            var fallback = Row(device, "warthog-grip-trim-left", "JOY_BTN_POV1_L", "other-command", "Trim left");

            var result = new CurrentLabelService().ApplyUiLayer(
                common.FullName,
                device,
                [current, blank, fallback]);

            Assert.Equal(2, result.CurrentCount);
            Assert.Equal(1, result.SharedHardwareCount);
            Assert.Equal("Curated VR Zoom", current.Label);
            Assert.Equal("current", current.LabelSource);
            Assert.Equal(string.Empty, blank.Label);
            Assert.Equal("current", blank.LabelSource);
            Assert.Equal("Trim left", fallback.Label);
            Assert.Equal("device", fallback.LabelSource);
        }
        finally
        {
            common.Delete(recursive: true);
        }
    }

    [Fact]
    public void ApplyUiLayer_HonorsPhysicalInstanceScope()
    {
        var common = Directory.CreateTempSubdirectory("dcs-current-ui-instance-");
        try
        {
            var hardwareRoot = Directory.CreateDirectory(
                Path.Combine(common.FullName, "assets", "shared", "hardware"));
            var uiRoot = Directory.CreateDirectory(
                Path.Combine(common.FullName, "assets", "shared", "ui-layer"));
            File.WriteAllText(Path.Combine(hardwareRoot.FullName, "manifest.json"),
                """{ "devices": [ { "id": "tm-mfd" } ] }""");
            File.WriteAllText(Path.Combine(uiRoot.FullName, "functions.json"),
                """{ "functions": [ { "id": "vr-zoom", "command": "zoom-command", "label": "VR Zoom" } ] }""");
            File.WriteAllText(Path.Combine(uiRoot.FullName, "hardware-overlays.json"), """
                {
                  "devices": {
                    "tm-mfd": {
                      "appliesToInstances": [ "MFD3" ],
                      "bindings": { "vr-zoom": "mfd-osb-t1-shifted" }
                    }
                  }
                }
                """);

            var mfd1 = new PreviewDevice
            {
                DeviceId = "tm-mfd",
                InstanceHint = "1",
                ProfileFile = "MFD 1.diff.lua",
                ProfileKey = "tm-mfd-1",
            };
            var row = Row(mfd1, "mfd-osb-t1-shifted", "JOY_BTN1", "zoom-command", "OSB01");

            var result = new CurrentLabelService().ApplyUiLayer(common.FullName, mfd1, [row]);

            Assert.Equal(0, result.CurrentCount);
            Assert.Equal(1, result.SharedHardwareCount);
            Assert.Equal("OSB01", row.Label);
        }
        finally
        {
            common.Delete(recursive: true);
        }
    }

    private static PreviewRow Row(
        PreviewDevice device,
        string calloutId,
        string key,
        string command,
        string deviceLabel) => new()
        {
            ProfileFile = device.ProfileFile,
            ProfileKey = device.ProfileKey,
            DeviceId = device.DeviceId,
            CalloutId = calloutId,
            Key = key,
            Command = command,
            DefaultLabel = command,
            DeviceLabel = deviceLabel,
            Label = command,
        };
}
