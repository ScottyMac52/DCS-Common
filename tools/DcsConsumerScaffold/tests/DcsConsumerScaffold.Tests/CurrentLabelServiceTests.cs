using System.IO;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class CurrentLabelServiceTests
{
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
