using System.IO;
using Xunit;
using DcsConsumerScaffold.Services;

namespace DcsConsumerScaffold.Tests;

public sealed class ScaffoldSolutionServiceTests
{
    [Fact]
    public void ConsumerSolution_RoundTripsEveryInputAndDecision()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "f14.dcs-scaffold.json");
        var service = new ScaffoldSolutionService();
        var document = Consumer();
        document.Decisions.InstanceRoles["profile.lua"] = "rio";
        document.Decisions.SemanticModifiers["MFD3_BTN1"] = "shift";
        document.Decisions.RemovedProfiles.Add("old-device");

        service.Save(path, document);
        var loaded = service.Load(path);

        Assert.Equal("consumer", loaded.Import.Target);
        Assert.Equal("standalone", loaded.Import.MozaGrip);
        Assert.Equal("rio", loaded.Decisions.InstanceRoles["profile.lua"]);
        Assert.Contains("old-device", loaded.Decisions.RemovedProfiles);
        Assert.EndsWith(Environment.NewLine, File.ReadAllText(path));
    }

    [Fact]
    public void LegacyLabelFields_AreIgnoredAndNotWrittenBack()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "legacy.dcs-scaffold.json");
        File.WriteAllText(path, """
            {
              "schemaVersion": 1,
              "name": "Legacy",
              "import": {
                "target": "consumer",
                "profilesDirectory": "profiles",
                "mozaGrip": "standalone",
                "outputDirectory": "output",
                "displayName": "Legacy",
                "inputModuleId": "Legacy",
                "kneeboardId": "Legacy"
              },
              "decisions": {
                "instanceRoles": {},
                "semanticModifiers": {},
                "labelOverrides": { "old-binding": "stale" },
                "mfdCategories": {
                  "mfd1": { "top": "stale", "right": "stale", "bottom": "stale", "left": "stale" }
                },
                "removedProfiles": []
              }
            }
            """);

        var service = new ScaffoldSolutionService();
        var document = service.Load(path);
        service.Save(path, document);
        var saved = File.ReadAllText(path);

        Assert.DoesNotContain("labelOverrides", saved);
        Assert.DoesNotContain("mfdCategories", saved);
        Assert.DoesNotContain("stale", saved);
    }

    [Fact]
    public void UiLayerSolution_DoesNotRequireConsumerIdentity()
    {
        var document = new ScaffoldSolutionDocument
        {
            Import = new()
            {
                Target = "ui-layer",
                ProfilesDirectory = "profiles",
                ModifiersPath = "modifiers.lua",
                CommonRoot = "common",
                MozaGrip = "standalone",
            },
        };

        ScaffoldSolutionService.Validate(document);
    }

    [Fact]
    public void InvalidDocument_ReportsAllRequiredConsumerFields()
    {
        var document = new ScaffoldSolutionDocument
        {
            Import = new() { Target = "consumer", ProfilesDirectory = "profiles", MozaGrip = "standalone" },
        };

        var error = Assert.Throws<InvalidDataException>(() => ScaffoldSolutionService.Validate(document));

        Assert.Contains("outputDirectory", error.Message);
        Assert.Contains("displayName", error.Message);
        Assert.Contains("inputModuleId", error.Message);
        Assert.Contains("kneeboardId", error.Message);
    }

    [Fact]
    public void FutureSchema_IsRejected()
    {
        var document = Consumer();
        document.SchemaVersion = ScaffoldSolutionService.CurrentSchemaVersion + 1;

        var error = Assert.Throws<InvalidDataException>(() => ScaffoldSolutionService.Validate(document));

        Assert.Contains("newer than supported", error.Message);
    }

    [Fact]
    public void RelativePath_ResolvesFromSolutionDirectory()
    {
        var solution = Path.Combine(Path.GetTempPath(), "solutions", "f14.dcs-scaffold.json");

        var resolved = ScaffoldSolutionService.ResolvePath(Path.Combine("profiles", "joystick"), solution);

        Assert.Equal(Path.GetFullPath(Path.Combine(Path.GetDirectoryName(solution)!, "profiles", "joystick")), resolved);
    }

    [Fact]
    public void FailedValidation_DoesNotReplaceExistingFile()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "solution.json");
        File.WriteAllText(path, "original");
        var invalid = Consumer();
        invalid.Import.OutputDirectory = null;

        Assert.Throws<InvalidDataException>(() => new ScaffoldSolutionService().Save(path, invalid));
        Assert.Equal("original", File.ReadAllText(path));
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

    private sealed class TempDirectory : IDisposable
    {
        public TempDirectory()
        {
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose() => Directory.Delete(Path, true);
    }
}
