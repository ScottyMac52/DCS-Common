using System.IO;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using DcsConsumerScaffold.ViewModels;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public class SharedDeviceAuthoringTests
{
    private sealed class TemporaryDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"ipi-device-{Guid.NewGuid():N}");
        public TemporaryDirectory() => Directory.CreateDirectory(Path);
        public void Dispose() => Directory.Delete(Path, true);
    }

    [Fact]
    public void MainEditorAddsUpdatesPersistsAndRemovesUnusedSharedDevice()
    {
        var model = new MainViewModel
        {
            ProfilesDir = "profiles",
            OutputDir = "output",
            DisplayName = "Test Jet",
            InputModuleId = "TestJet",
            KneeboardId = "TestJet",
        };
        var mfd = new IpiHardwareChoice { DeviceId = "tm-mfd", Label = "Thrustmaster MFD" };
        var device = model.AddSharedDevice(mfd, "F16 MFD 1 {GUID}.diff.lua", "1", "left");

        Assert.True(device.IsAuthored);
        Assert.Equal("tm-mfd-left", device.ProfileKey);
        Assert.Equal("left", device.Role);
        Assert.Equal("F16 MFD 1 {GUID}.diff.lua", Assert.Single(model.CaptureSolution().Decisions.AuthoredDevices!).ProfileFile);

        model.UpdateSharedDevice(device, mfd, "F16 MFD 2 {GUID}.diff.lua", "2", "right");
        Assert.Equal("tm-mfd-right", device.ProfileKey);
        Assert.Equal("right", device.Role);

        model.RemoveSharedDevice(device);
        Assert.Empty(model.Devices);
        Assert.Empty(model.CaptureSolution().Decisions.AuthoredDevices!);
    }

    [Fact]
    public void SharedDeviceEditorValidatesIdentityMigratesModifierAndBlocksUsedRemoval()
    {
        var model = new MainViewModel();
        var mfd = new IpiHardwareChoice { DeviceId = "tm-mfd", Label = "Thrustmaster MFD" };
        var device = model.AddSharedDevice(mfd, "F16 MFD 1.diff.lua", null, null);
        Assert.Throws<InvalidOperationException>(() => model.AddSharedDevice(mfd, "F16 MFD 1.diff.lua", "2", null));
        Assert.Throws<InvalidOperationException>(() => model.AddSharedDevice(mfd, "invalid.lua", "2", null));

        var modifier = model.AddModifier(device,
            new InteractiveControl { Key = "JOY_BTN1", HardwareLabel = "OSB01" }, "SHIFT", "hold", null);
        model.UpdateSharedDevice(device, mfd, "F16 MFD 3.diff.lua", "3", null);
        Assert.Equal("F16 MFD 3", modifier.Device);
        Assert.Throws<InvalidOperationException>(() => model.RemoveSharedDevice(device));

        model.RemoveModifier(modifier);
        model.RemoveSharedDevice(device);
        Assert.Empty(model.Devices);
    }

    [Fact]
    public void SolutionServiceRoundTripsAuthoredDevices()
    {
        using var temporary = new TemporaryDirectory();
        var path = Path.Combine(temporary.Path, "solution.json");
        var document = new ScaffoldSolutionDocument
        {
            Import = new ScaffoldSolutionImport
            {
                ProfilesDirectory = "profiles", OutputDirectory = "output", DisplayName = "Test",
                InputModuleId = "Test", KneeboardId = "Test",
            },
            Decisions = new ScaffoldSolutionDecisions
            {
                AuthoredDevices =
                [
                    new IpiAuthoredDeviceDefinition
                    {
                        DeviceId = "tm-mfd", ProfileFile = "F16 MFD 1.diff.lua", DeviceInstance = "1", Role = "left",
                    },
                ],
            },
        };
        var service = new ScaffoldSolutionService();
        service.Save(path, document);
        var loaded = service.Load(path);
        var device = Assert.Single(loaded.Decisions.AuthoredDevices!);
        Assert.Equal("tm-mfd", device.DeviceId);
        Assert.Equal("left", device.Role);
    }

    [Fact]
    public void SolutionServiceRejectsInvalidAuthoredDeviceDefinitions()
    {
        var document = new ScaffoldSolutionDocument
        {
            Import = new ScaffoldSolutionImport
            {
                ProfilesDirectory = "profiles", OutputDirectory = "output", DisplayName = "Test",
                InputModuleId = "Test", KneeboardId = "Test",
            },
            Decisions = new ScaffoldSolutionDecisions
            {
                AuthoredDevices = [new IpiAuthoredDeviceDefinition { DeviceId = "tm-mfd", ProfileFile = "folder/device.lua" }],
            },
        };

        Assert.Throws<InvalidDataException>(() => ScaffoldSolutionService.Validate(document));
    }
}
