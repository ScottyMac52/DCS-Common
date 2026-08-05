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
            commonRoot: "C:\\repo");

        Assert.Contains("--preview-json", args);
        Assert.Contains("C:\\temp\\preview.json", args);
        Assert.Contains("--profiles-dir", args);
        Assert.Contains("C:\\profiles", args);
        Assert.Contains("--modifiers", args);
        Assert.Contains("C:\\modifiers.lua", args);
        Assert.Contains("--common-root", args);
        Assert.Contains("C:\\repo", args);
    }

    [Fact]
    public void BuildPreviewArguments_OmitsModifiersWhenNull()
    {
        var args = ScaffoldEngineService.BuildPreviewArguments(
            "script.mjs", "out.json", "profiles", null, "root");

        Assert.DoesNotContain("--modifiers", args);
    }

    [Fact]
    public void PreviewRow_ModifierModesDisplay_JoinsValues()
    {
        var row = new PreviewRow { ModifierModes = ["hold", null, "toggle"] };
        Assert.Equal("hold, ?, toggle", row.ModifierModesDisplay);
    }
}
