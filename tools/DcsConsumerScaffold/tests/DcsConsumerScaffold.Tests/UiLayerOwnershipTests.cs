using System.IO;
using DcsConsumerScaffold.ViewModels;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class UiLayerOwnershipTests
{
    [Fact]
    public async Task ObservedUiLayerTarget_IsPreviewOnlyAndCannotWriteTheDefinitiveCatalog()
    {
        var viewModel = new MainViewModel
        {
            ImportTarget = "ui-layer",
            ProfilesDir = @"C:\DCS\Config\Input\UiLayer\joystick",
            ModifiersPath = @"C:\DCS\Config\Input\UiLayer\modifiers.lua",
            CommonRoot = @"C:\Source\DCS-Common",
            HasPreview = true,
        };

        Assert.False(viewModel.ProceedCommand.CanExecute(null));
        await viewModel.ProceedAsync();
        Assert.Contains("observed snapshot, not the definitive catalog", viewModel.StatusText);
        Assert.Contains("Definitive UI Layer Editor", viewModel.StatusText);
    }
    [Fact]
    public void DiscoverConsumerRoots_FindsOnlySiblingConsumerRepositories()
    {
        var parent = Path.Combine(Path.GetTempPath(), $"ipi-impact-{Guid.NewGuid():N}");
        var common = Path.Combine(parent, "DCS-Common");
        var consumer = Path.Combine(parent, "DCS-Test-Components");
        var unrelated = Path.Combine(parent, "notes");
        Directory.CreateDirectory(common);
        Directory.CreateDirectory(Path.Combine(consumer, "config"));
        Directory.CreateDirectory(unrelated);
        File.WriteAllText(Path.Combine(consumer, "config", "kneeboard.json"), "{}");
        try
        {
            var roots = UiLayerCatalogService.DiscoverConsumerRoots(common);
            Assert.Single(roots);
            Assert.Equal(consumer, roots[0]);
        }
        finally
        {
            Directory.Delete(parent, recursive: true);
        }
    }

}
