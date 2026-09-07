using System.IO;
using System.Text.Json;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class DcsCommandCatalogServiceTests
{
    [Fact]
    public void Load_ValidatesNormalizesAndOrdersCatalog()
    {
        using var file = TemporaryCatalog(new
        {
            schemaVersion = 1,
            moduleId = "FA-18C_hornet",
            dcsVersion = "2.9",
            commands = new object[]
            {
                new { bindingKey = "d2", name = " Trim ", categoryPath = new[] { "Flight Control" }, type = "SWITCH" },
                new { bindingKey = "a1", name = "Pitch", categoryPath = new[] { "Axis Commands" }, type = "axis" },
            },
        });

        var result = new DcsCommandCatalogService().Load(file.Path, "fa-18c_HORNET");

        Assert.Equal(["Pitch", "Trim"], result.Commands.Select(command => command.Name));
        Assert.Equal("button", result.Commands[1].Type);
    }

    [Fact]
    public void Load_RejectsWrongModuleAndDuplicateCanonicalKeys()
    {
        using var wrongModule = TemporaryCatalog(new
        {
            schemaVersion = 1,
            moduleId = "F-16C_50",
            commands = new[] { new { bindingKey = "one", name = "One", type = "button" } },
        });
        Assert.Contains("does not match", Assert.Throws<InvalidDataException>(() =>
            new DcsCommandCatalogService().Load(wrongModule.Path, "FA-18C_hornet")).Message);

        using var duplicate = TemporaryCatalog(new
        {
            schemaVersion = 1,
            moduleId = "FA-18C_hornet",
            commands = new[]
            {
                new { bindingKey = "same", name = "First", type = "button" },
                new { bindingKey = "same", name = "Second", type = "button" },
            },
        });
        Assert.Contains("Duplicate", Assert.Throws<InvalidDataException>(() =>
            new DcsCommandCatalogService().Load(duplicate.Path, "FA-18C_hornet")).Message);
    }

    [Fact]
    public void Filter_SearchesAllIdentityFieldsAndCombinesFilters()
    {
        var service = new DcsCommandCatalogService();
        var commands = new[]
        {
            Command("d3001", "Sensor Select Left", "HOTAS", "button", "Castle left"),
            Command("a2001", "Pitch", "Axis Commands", "axis"),
        };
        commands[0].SetBindingCount(2);

        Assert.Single(service.Filter(commands, "castle", "All", "All", "All"));
        Assert.Single(service.Filter(commands, "d3001", "HOTAS", "button", "Bound"));
        Assert.Single(service.Filter(commands, null, "Axis Commands", "axis", "Unbound"));
        Assert.Empty(service.Filter(commands, null, "HOTAS", "axis", "All"));
    }

    [Fact]
    public void ReconcileBindings_UsesExactCanonicalIdentity()
    {
        var service = new DcsCommandCatalogService();
        var exact = Command("d3001", "First", "HOTAS", "button");
        var differentCase = Command("D3001", "Second", "HOTAS", "button");

        service.ReconcileBindings([exact, differentCase],
        [
            new PreviewRow { Command = "d3001" },
            new PreviewRow { Command = "d3001" },
        ]);

        Assert.Equal(2, exact.BindingCount);
        Assert.False(differentCase.IsBound);
    }

    private static DcsCommandCatalogEntry Command(string key, string name, string category, string type, params string[] aliases) => new()
    {
        BindingKey = key,
        Name = name,
        CategoryPath = [category],
        Type = type,
        Aliases = [.. aliases],
    };

    private static TemporaryFile TemporaryCatalog(object value) =>
        new(JsonSerializer.Serialize(value));

    private sealed class TemporaryFile : IDisposable
    {
        public TemporaryFile(string content)
        {
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"dcs-command-catalog-{Guid.NewGuid():N}.json");
            File.WriteAllText(Path, content);
        }

        public string Path { get; }
        public void Dispose() => File.Delete(Path);
    }
}
