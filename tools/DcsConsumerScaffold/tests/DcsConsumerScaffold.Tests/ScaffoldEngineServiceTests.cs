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
            mapPath: "C:\\device-overrides.json",
            commonRoot: "C:\\repo");

        Assert.Contains("--preview-json", args);
        Assert.Contains("C:\\temp\\preview.json", args);
        Assert.Contains("--profiles-dir", args);
        Assert.Contains("C:\\profiles", args);
        Assert.Contains("--modifiers", args);
        Assert.Contains("C:\\modifiers.lua", args);
        Assert.Contains("--map", args);
        Assert.Contains("C:\\device-overrides.json", args);
        Assert.Contains("--common-root", args);
        Assert.Contains("C:\\repo", args);
    }

    [Fact]
    public void BuildPreviewArguments_OmitsModifiersWhenNull()
    {
        var args = ScaffoldEngineService.BuildPreviewArguments(
            "script.mjs", "out.json", "profiles", null, null, "root");

        Assert.DoesNotContain("--modifiers", args);
    }

    [Fact]
    public void BuildWriteArguments_IncludesIdentitiesAndOutput()
    {
        var args = ScaffoldEngineService.BuildWriteArguments(
            scriptPath: "script.mjs",
            profilesDir: "profiles",
            modifiersPath: "modifiers.lua",
            mapPath: "device-overrides.json",
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
        Assert.Contains("--repo-name", args);
        Assert.Contains("DCS-F-16C-Components", args);
        Assert.Contains("--modifiers", args);
        Assert.Contains("--map", args);
        Assert.Contains("device-overrides.json", args);
    }

    [Fact]
    public void PreviewRow_ModifierModesDisplay_JoinsValues()
    {
        var row = new PreviewRow { ModifierModes = ["hold", null, "toggle"] };
        Assert.Equal("hold, ?, toggle", row.ModifierModesDisplay);
    }
}
