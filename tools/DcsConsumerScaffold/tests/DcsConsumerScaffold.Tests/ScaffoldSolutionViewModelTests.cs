using System.IO;
using Xunit;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using DcsConsumerScaffold.ViewModels;

namespace DcsConsumerScaffold.Tests;

public sealed class ScaffoldSolutionViewModelTests
{
    [Fact]
    public void LoadSolution_RestoresInputsWithoutCreatingPreview()
    {
        var viewModel = new MainViewModel();
        var document = Consumer();
        var path = Path.Combine(Path.GetTempPath(), "solutions", "f14.dcs-scaffold.json");

        viewModel.LoadSolution(document, path);

        Assert.Equal("consumer", viewModel.ImportTarget);
        Assert.Equal(Path.GetFullPath(Path.Combine(Path.GetDirectoryName(path)!, "profiles")), viewModel.ProfilesDir);
        Assert.Equal("F-14B(U)", viewModel.DisplayName);
        Assert.False(viewModel.HasPreview);
        Assert.False(viewModel.IsSolutionDirty);
        Assert.True(viewModel.CanSaveSolution);
    }

    [Fact]
    public void EditingLoadedInput_MarksSolutionDirty()
    {
        var viewModel = new MainViewModel();
        var path = Path.Combine(Path.GetTempPath(), "f14.dcs-scaffold.json");
        viewModel.LoadSolution(Consumer(), path);

        viewModel.KneeboardId = "F-14B-U-Updated";

        Assert.True(viewModel.IsSolutionDirty);
        Assert.Contains("*", viewModel.SolutionDisplay);
    }

    [Fact]
    public void CaptureSolution_PreservesOnlyNonLabelDecisions()
    {
        var viewModel = new MainViewModel
        {
            ProfilesDir = "profiles",
            OutputDir = "output",
            DisplayName = "F-14B(U)",
            InputModuleId = "F-14B",
            KneeboardId = "F-14B-U",
        };
        viewModel.Devices.Add(new PreviewDevice
        {
            ProfileFile = "mfd.lua",
            ProfileKey = "mfd1",
            DeviceId = "tm-mfd",
            Role = "pilot",
            CategoryTop = "Jester",
            CategoryRight = "Radar",
            CategoryBottom = "Steerpoints",
            CategoryLeft = "Navigation",
        });
        viewModel.Devices.Add(new PreviewDevice
        {
            ProfileKey = "unused",
            IsRepositoryOnly = true,
            RemoveRequested = true,
        });
        viewModel.Modifiers.Add(new PreviewModifier { Name = "MFD3_BTN1", SemanticModifier = "shift" });
        viewModel.ReplacePreviewRows([
            new PreviewRow
            {
                BindingId = "binding-1",
                Command = "Jester Menu",
                DefaultLabel = "Default",
                Label = string.Empty,
            },
        ]);

        var document = viewModel.CaptureSolution();

        Assert.Equal("pilot", document.Decisions.InstanceRoles["mfd.lua"]);
        Assert.Equal("shift", document.Decisions.SemanticModifiers["MFD3_BTN1"]);
        Assert.Contains("unused", document.Decisions.RemovedProfiles);
    }

    [Fact]
    public void RelativePaths_RoundTripWithoutBeingRewritten()
    {
        var viewModel = new MainViewModel();
        var document = Consumer();
        var path = Path.Combine(Path.GetTempPath(), "solutions", "f14.dcs-scaffold.json");

        viewModel.LoadSolution(document, path);
        var captured = viewModel.CaptureSolution();

        Assert.Equal("profiles", captured.Import.ProfilesDirectory);
        Assert.Equal("output", captured.Import.OutputDirectory);
    }

    [Fact]
    public void UiLayerSolution_DoesNotRequireConsumerFieldsForSave()
    {
        var viewModel = new MainViewModel();
        var document = new ScaffoldSolutionDocument
        {
            Name = "UI Layer",
            Import = new()
            {
                Target = "ui-layer",
                ProfilesDirectory = "profiles",
                ModifiersPath = "modifiers.lua",
                CommonRoot = "common",
                MozaGrip = "standalone",
            },
        };

        viewModel.LoadSolution(document, Path.Combine(Path.GetTempPath(), "ui-layer.dcs-scaffold.json"));

        Assert.True(viewModel.CanSaveSolution);
        Assert.Equal(string.Empty, viewModel.OutputDir);
    }

    private static ScaffoldSolutionDocument Consumer() => new()
    {
        Name = "F-14B(U)",
        Import = new()
        {
            Target = "consumer",
            ProfilesDirectory = "profiles",
            ModifiersPath = "modifiers.lua",
            MozaGrip = "standalone",
            CommonRoot = "common",
            OutputDirectory = "output",
            DisplayName = "F-14B(U)",
            InputModuleId = "F-14B",
            KneeboardId = "F-14B-U",
        },
    };
}
