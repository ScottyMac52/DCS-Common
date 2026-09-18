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
        Assert.True(device.RemoveRequested);
        Assert.Same(device, Assert.Single(model.Devices));
        Assert.Contains("tm-mfd-right", model.CaptureSolution().Decisions.RemovedProfiles);
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
        Assert.True(device.RemoveRequested);
    }

    [Fact]
    public void MainEditorStagesRemovalForAnyUnusedImportedOrRepositoryDevice()
    {
        var model = new MainViewModel();
        var imported = new PreviewDevice
        {
            DeviceId = "tm-tpr", ProfileFile = "T-Pendular-Rudder.diff.lua",
            ProfileKey = "tm-tpr", PhysicalInstance = "T-Pendular-Rudder.diff.lua",
        };
        var repositoryOnly = new PreviewDevice
        {
            DeviceId = "tm-mfd", ProfileFile = "F16 MFD 2.diff.lua",
            ProfileKey = "tm-mfd-2", PhysicalInstance = "MFD2", IsRepositoryOnly = true,
        };
        model.Devices.Add(imported);
        model.Devices.Add(repositoryOnly);

        model.RemoveSharedDevice(imported);
        model.RemoveSharedDevice(repositoryOnly);

        Assert.True(imported.RemoveRequested);
        Assert.True(repositoryOnly.RemoveRequested);
        var removed = model.CaptureSolution().Decisions.RemovedProfiles;
        Assert.Contains("tm-tpr", removed);
        Assert.Contains("tm-mfd-2", removed);
    }

    [Fact]
    public void ClearingFinalAssignmentAllowsDeviceRemoval()
    {
        var model = new MainViewModel { HasPreview = true };
        var hardware = new IpiHardwareChoice { DeviceId = "tm-mfd", Label = "Thrustmaster MFD" };
        var device = model.AddSharedDevice(hardware, "F16 MFD 1.diff.lua", "1", null);
        var row = new PreviewRow
        {
            ProfileFile = device.ProfileFile,
            Stem = "F16 MFD 1",
            Key = "JOY_BTN1",
            Section = "keyDiffs",
            Command = "d-old",
            Name = "Old command",
        };
        model.ReplacePreviewRows([row]);

        model.ClearAssignment(row);
        model.RemoveSharedDevice(device);

        Assert.True(device.RemoveRequested);
        Assert.True(Assert.Single(model.PendingAssignments).Clear);
    }

    [Fact]
    public void NewlyAssignedEmptyControlStillBlocksDeviceRemoval()
    {
        var model = new MainViewModel { HasPreview = true };
        var hardware = new IpiHardwareChoice { DeviceId = "tm-mfd", Label = "Thrustmaster MFD" };
        var device = model.AddSharedDevice(hardware, "F16 MFD 1.diff.lua", "1", null);
        var row = model.GetInteractiveRow(device, new InteractiveControl
        {
            Id = "mfd-osb-t1",
            Key = "JOY_BTN1",
            Type = "button",
            HardwareLabel = "OSB01",
        }, []);
        model.SelectedPreviewRow = row;
        model.SelectedCatalogCommand = new DcsCommandCatalogEntry
        {
            BindingKey = "d-new",
            Name = "New command",
            Type = "button",
        };

        model.AssignSelectedCommand();

        Assert.False(row.IsUnboundCandidate);
        Assert.Equal("d-new", row.Command);
        Assert.Throws<InvalidOperationException>(() => model.RemoveSharedDevice(device));
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
