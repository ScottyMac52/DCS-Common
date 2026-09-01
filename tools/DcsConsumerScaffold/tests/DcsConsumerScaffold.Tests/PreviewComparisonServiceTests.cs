using System.IO;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class PreviewComparisonServiceTests
{
    [Fact]
    public void Apply_ClassifiesSemanticChangesAndKeepsRepositoryOnlyDefinitionsVisible()
    {
        var repository = CreateRepository();
        try
        {
            var service = new PreviewComparisonService();
            var snapshot = service.Load(repository.FullName);
            var device = new PreviewDevice
            {
                ProfileKey = "mfd3",
                ProfileFile = "F16 MFD 3 {AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}.diff.lua",
                DeviceId = "tm-mfd",
                InstanceHint = "3",
                BindingCount = 1,
                CategoryTop = "Jester Steerpoints",
            };
            var row = Row("mfd3", "mfd-osb-t1", "JOY_BTN1", "command-one", "Repository label");
            var modifiers = new List<PreviewModifier>
            {
                new() { Name = "RAW_SHIFT", Device = "Stick", Key = "JOY_BTN3", Mode = "hold", SemanticModifier = "SHIFT" },
            };
            row.SemanticChord = "SHIFT";
            var group = new CommandLabelGroup { Command = "command-one" };
            group.Refresh([row]);
            var devices = new List<PreviewDevice> { device };
            var commands = new List<CommandLabelGroup> { group };

            service.Apply(snapshot, devices, modifiers, [row], commands);

            Assert.Equal(PreviewChangeState.Unchanged, device.ChangeState);
            Assert.Equal(PreviewChangeState.Unchanged, modifiers[0].ChangeState);
            Assert.Equal(PreviewChangeState.Unchanged, group.ChangeState);
            Assert.Contains(devices, item => item.IsRepositoryOnly && item.ProfileKey == "old-device" && item.ChangeState == PreviewChangeState.Unused);
            Assert.Contains(commands, item => item.IsRepositoryOnly && item.Command == "old-command" && item.ChangeState == PreviewChangeState.Unused);
        }
        finally
        {
            repository.Delete(recursive: true);
        }
    }

    [Fact]
    public void Apply_MarksMfdCategoryChangesOnThePhysicalInstance()
    {
        var repository = CreateRepository();
        try
        {
            var service = new PreviewComparisonService();
            var snapshot = service.Load(repository.FullName);
            var device = new PreviewDevice
            {
                ProfileKey = "mfd3",
                ProfileFile = "F16 MFD 3.diff.lua",
                DeviceId = "tm-mfd",
                InstanceHint = "3",
                BindingCount = 1,
                CategoryTop = "VR and Views",
            };
            var row = Row("mfd3", "mfd-osb-t1", "JOY_BTN1", "command-one", "Repository label");
            var group = new CommandLabelGroup { Command = "command-one" };
            group.Refresh([row]);

            service.Apply(snapshot, new List<PreviewDevice> { device }, new List<PreviewModifier>(), [row], new List<CommandLabelGroup> { group });

            Assert.Equal(PreviewChangeState.Changed, device.ChangeState);
            Assert.Contains("MFD side categories changed", device.ChangeReason);
        }
        finally
        {
            repository.Delete(recursive: true);
        }
    }

    [Fact]
    public void Apply_UsesNewChangedOutOfSyncAndNotComparedStatesWithCorrectPrecedence()
    {
        var service = new PreviewComparisonService();
        var newSnapshot = service.Load(Path.Combine(Path.GetTempPath(), $"new-repo-{Guid.NewGuid():N}"));
        var newDevice = new PreviewDevice { ProfileKey = "new", ProfileFile = "New.diff.lua", DeviceId = "new-device", BindingCount = 2 };
        var first = Row("new", "button-1", "JOY_BTN1", "new-command", "One");
        var second = Row("new", "button-2", "JOY_BTN2", "new-command", "Two");
        var mixed = new CommandLabelGroup { Command = "new-command" };
        mixed.Refresh([first, second]);
        var devices = new List<PreviewDevice> { newDevice };
        var commands = new List<CommandLabelGroup> { mixed };

        service.Apply(newSnapshot, devices, new List<PreviewModifier>(), [first, second], commands);

        Assert.Equal(PreviewChangeState.New, newDevice.ChangeState);
        Assert.Equal(PreviewChangeState.OutOfSync, mixed.ChangeState);
        Assert.Equal(PreviewChangeState.OutOfSync, first.ChangeState);

        var notCompared = new PreviewDevice { ProfileKey = "plain", BindingCount = 1 };
        service.Apply(service.Load(null), new List<PreviewDevice> { notCompared }, new List<PreviewModifier>(), [], new List<CommandLabelGroup>());
        Assert.Equal(PreviewChangeState.NotCompared, notCompared.ChangeState);
    }

    [Fact]
    public void Apply_DoesNotDuplicateExistingRepositoryDeviceWhenLoadedProfileHasNoBindings()
    {
        var repository = CreateRepository();
        try
        {
            var service = new PreviewComparisonService();
            var snapshot = service.Load(repository.FullName);
            var loadedDevice = new PreviewDevice
            {
                ProfileKey = "mfd3",
                ProfileFile = "F16 MFD 3 {AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}.diff.lua",
                DeviceId = "tm-mfd",
                InstanceHint = "3",
                BindingCount = 0,
            };
            var devices = new List<PreviewDevice> { loadedDevice };

            service.Apply(snapshot, devices, new List<PreviewModifier>(), [], new List<CommandLabelGroup>());

            Assert.Equal(PreviewChangeState.Unused, loadedDevice.ChangeState);
            Assert.Equal("Physical device has no effective loaded bindings.", loadedDevice.ChangeReason);
            Assert.Single(devices, device => device.ProfileKey == "mfd3");
            Assert.DoesNotContain(devices, device => device.ProfileKey == "mfd3" && device.IsRepositoryOnly);
        }
        finally
        {
            repository.Delete(recursive: true);
        }
    }

    private static DirectoryInfo CreateRepository()
    {
        var root = Directory.CreateTempSubdirectory("dcs-preview-comparison-");
        var config = Directory.CreateDirectory(Path.Combine(root.FullName, "config"));
        var input = Directory.CreateDirectory(Path.Combine(root.FullName, "src", "Config", "Input", "Test"));
        File.WriteAllText(Path.Combine(input.FullName, "modifiers.lua"), """
            local modifiers = {
              ["RAW_SHIFT"] = {
                ["device"] = "Stick",
                ["key"] = "JOY_BTN3",
                ["switch"] = false,
              },
            }
            return modifiers
            """);
        File.WriteAllText(Path.Combine(config.FullName, "kneeboard.json"), """
            {
              "profiles": {
                "mfd3": "src/Config/Input/Test/joystick/F16 MFD 3 {BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}.diff.lua",
                "old-device": "src/Config/Input/Test/joystick/Old Device.diff.lua"
              },
              "modifiersFile": "src/Config/Input/Test/modifiers.lua",
              "modifiers": {
                "SHIFT": { "nativeName": "RAW_SHIFT", "mode": "hold" }
              },
              "pages": [
                {
                  "deviceId": "tm-mfd",
                  "deviceInstance": "MFD3",
                  "categoryLabels": { "top": "Jester Steerpoints" },
                  "layers": [
                    {
                      "modifiers": ["SHIFT"],
                      "labels": { "mfd-osb-t1": "Repository label" },
                      "controls": {
                        "mfd-osb-t1": {
                          "profile": "mfd3", "key": "JOY_BTN1", "command": "command-one", "label": "Repository label"
                        }
                      }
                    }
                  ]
                },
                {
                  "deviceId": "old-hardware",
                  "labels": { "old-button": "Old" },
                  "controls": {
                    "old-button": { "profile": "old-device", "key": "JOY_BTN9", "command": "old-command", "label": "Old" }
                  }
                }
              ]
            }
            """);
        return root;
    }

    private static PreviewRow Row(string profile, string callout, string key, string command, string label) => new()
    {
        ProfileKey = profile,
        ProfileFile = $"{profile}.diff.lua",
        CalloutId = callout,
        Key = key,
        Command = command,
        DefaultLabel = label,
        DeviceLabel = label,
        Label = label,
    };
}
