using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using DcsConsumerScaffold.ViewModels;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public class ModifierAuthoringTests
{
    [Fact]
    public void MainEditorAddsRenamesAndRemovesUnusedModifier()
    {
        var model = new MainViewModel();
        var device = new PreviewDevice { DeviceId = "tm-mfd", ProfileFile = "F16 MFD 3 {GUID}.diff.lua" };
        var control = new InteractiveControl { Id = "mfd-osb-t1", Key = "JOY_BTN1", HardwareLabel = "OSB01" };

        var modifier = model.AddModifier(device, control, "MFD_SHIFT", "hold", "grip-shift");
        Assert.Equal("F16 MFD 3 {GUID}", modifier.Device);
        Assert.Equal("JOY_BTN1", modifier.Key);

        model.UpdateModifier(modifier, null, null, "MFD_SHIFT_2", "toggle", "grip-shift");
        Assert.Equal("MFD_SHIFT_2", modifier.Name);
        Assert.Equal("toggle", modifier.Mode);

        model.ProfilesDir = "profiles";
        model.OutputDir = "output";
        model.DisplayName = model.InputModuleId = model.KneeboardId = "TestJet";
        var solution = model.CaptureSolution();
        Assert.Equal("MFD_SHIFT_2", Assert.Single(solution.Decisions.AuthoredModifiers!).Name);

        model.RemoveModifier(modifier);
        Assert.Empty(model.Modifiers);
    }

    [Fact]
    public void MainEditorMigratesRenameAndBlocksRemovalWhileUsed()
    {
        var model = new MainViewModel();
        var device = new PreviewDevice { DeviceId = "tm-mfd", ProfileFile = "F16 MFD 3.diff.lua" };
        var modifier = model.AddModifier(device,
            new InteractiveControl { Key = "JOY_BTN1", HardwareLabel = "OSB01" }, "OLD", "hold", null);
        var row = new PreviewRow { Reformers = ["OLD"], Chord = "OLD" };
        model.ReplacePreviewRows([row]);

        model.UpdateModifier(modifier, null, null, "NEW", "hold", null);
        Assert.Equal(new[] { "NEW" }, row.Reformers);
        Assert.Equal("NEW", row.Chord);
        Assert.Throws<InvalidOperationException>(() => model.RemoveModifier(modifier));
    }

    [Fact]
    public void ModifierSerializationIsDeterministicAndReplacementIsExplicit()
    {
        var source = ScaffoldEngineService.SerializeModifiers([
            new PreviewModifier { Name = "SECOND", Device = "Device B", Key = "JOY_BTN2", Mode = "toggle" },
            new PreviewModifier { Name = "FIRST", Device = "Device A", Key = "JOY_BTN1", Mode = "hold" },
        ]);
        Assert.True(source.IndexOf("FIRST", StringComparison.Ordinal) < source.IndexOf("SECOND", StringComparison.Ordinal));
        Assert.Contains("[\"switch\"] = true", source);

        var args = ScaffoldEngineService.BuildWriteArguments("script", "profiles", "modifiers", null, null, "root",
            "out", "Jet", "Jet", "Jet", replaceModifiers: true);
        Assert.Contains("--replace-modifiers", args);
    }
}
