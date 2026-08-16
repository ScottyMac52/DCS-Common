using System.Text.Json;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public class ScaffoldEngineServiceTests
{
    [Fact]
    public void BuildPreviewArguments_IncludesModifiersWhenProvided()
    {
        var args = ScaffoldEngineService.BuildPreviewArguments(
            scriptPath: "C:\\repo\\scripts\\scaffold-consumer.mjs",
            previewJsonPath: "C:\\temp\\preview.json",
            profilesDir: "C:\\profiles",
            modifiersPath: "C:\\modifiers.lua",
            mozaGrip: "hornet",
            rolesPath: "C:\\roles.json",
            commonRoot: "C:\\repo");

        Assert.Contains("--preview-json", args);
        Assert.Contains("C:\\temp\\preview.json", args);
        Assert.Contains("--profiles-dir", args);
        Assert.Contains("C:\\profiles", args);
        Assert.Contains("--modifiers", args);
        Assert.Contains("C:\\modifiers.lua", args);
        Assert.Contains("--moza-grip", args);
        Assert.Contains("hornet", args);
        Assert.Contains("--roles", args);
        Assert.Contains("C:\\roles.json", args);
        Assert.Contains("--common-root", args);
        Assert.Contains("C:\\repo", args);
    }

    [Fact]
    public void BuildPreviewArguments_OmitsModifiersWhenNull()
    {
        var args = ScaffoldEngineService.BuildPreviewArguments(
            "script.mjs", "out.json", "profiles", null, null, null, "root");

        Assert.DoesNotContain("--modifiers", args);
    }

    [Fact]
    public void BuildWriteArguments_IncludesIdentitiesAndOutput()
    {
        var args = ScaffoldEngineService.BuildWriteArguments(
            scriptPath: "script.mjs",
            profilesDir: "profiles",
            modifiersPath: "modifiers.lua",
            mozaGrip: "viper",
            rolesPath: "roles.json",
            commonRoot: "root",
            outputDir: "out",
            displayName: "F-16C",
            inputModuleId: "F-16C_50",
            kneeboardId: "F-16C_50",
            repoName: "DCS-F-16C-Components");

        Assert.Contains("--output-dir", args);
        Assert.Contains("out", args);
        Assert.Contains("--display-name", args);
        Assert.Contains("F-16C", args);
        Assert.Contains("--input-module-id", args);
        Assert.Contains("F-16C_50", args);
        Assert.Contains("--kneeboard-id", args);
        Assert.Contains("--roles", args);
        Assert.Contains("roles.json", args);
        Assert.Contains("--repo-name", args);
        Assert.Contains("DCS-F-16C-Components", args);
        Assert.Contains("--modifiers", args);
        Assert.Contains("--moza-grip", args);
        Assert.Contains("viper", args);
    }

    [Fact]
    public void PreviewRow_DeserializesPhysicalInstanceIdentity()
    {
        const string json = """
            {
              "profileFile": "Logitech Flight Quadrant {1C8A8840-5386-11F1-8001-444553540000}.diff.lua",
              "guid": "1c8a8840-5386-11f1-8001-444553540000",
              "physicalInstance": "1c8a8840-5386-11f1-8001-444553540000",
              "role": "supercharger",
              "profileKey": "logitech-throttle-quadrant-supercharger"
            }
            """;

        var row = JsonSerializer.Deserialize<PreviewRow>(json);

        Assert.NotNull(row);
        Assert.Equal("1c8a8840-5386-11f1-8001-444553540000", row.PhysicalInstance);
        Assert.Equal("supercharger", row.Role);
        Assert.Equal("logitech-throttle-quadrant-supercharger", row.ProfileKey);
    }

    [Fact]
    public void ApplicationDisplayTitle_UsesOnlyFourPartAssemblyVersion()
    {
        var title = ApplicationDisplayTitle.Format(new Version(1, 7, 0, 0));

        Assert.Equal("DCS Input Profile Importer version 1.7.0.0", title);
        Assert.DoesNotContain("+", title);
    }

    [Fact]
    public void ApplicationDisplayTitle_FillsMissingVersionPartsWithZero()
    {
        Assert.Equal(
            "DCS Input Profile Importer version 1.7.0.0",
            ApplicationDisplayTitle.Format(new Version(1, 7)));
    }

    [Fact]
    public void PreviewRow_ModifierModesDisplay_JoinsValues()
    {
        var row = new PreviewRow { ModifierModes = ["hold", null, "toggle"] };
        Assert.Equal("hold, ?, toggle", row.ModifierModesDisplay);
    }

    [Fact]
    public void PreviewRow_LabelIsIndependentFromNameAndCanReset()
    {
        var row = new PreviewRow { Name = "toggle VR Zoom", DefaultLabel = "MIC depress", Label = "VR Zoom" };
        Assert.Equal("toggle VR Zoom", row.Name);
        Assert.Equal("VR Zoom", row.Label);
        Assert.Equal("user", row.LabelSource);

        row.ResetLabel();

        Assert.Equal("MIC depress", row.Label);
        Assert.Equal("catalog", row.LabelSource);
        Assert.Equal("toggle VR Zoom", row.Name);
    }

    [Fact]
    public void BuildPreviewArguments_IncludesSemanticModifierAndLabelOverrides()
    {
        var args = ScaffoldEngineService.BuildPreviewArguments(
            "script.mjs", "out.json", "profiles", "modifiers.lua", null, null, "root",
            "semantic.json", "labels.json");

        Assert.Contains("--semantic-modifiers", args);
        Assert.Contains("semantic.json", args);
        Assert.Contains("--labels", args);
        Assert.Contains("labels.json", args);
    }
}
