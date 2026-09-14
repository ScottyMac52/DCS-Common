using DcsConsumerScaffold.ViewModels;
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
}
