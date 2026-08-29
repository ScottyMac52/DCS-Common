using DcsConsumerScaffold.Services;
using DcsConsumerScaffold.ViewModels;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class ProfilePathIdentityServiceTests
{
    [Theory]
    [InlineData(@"C:\Users\Scott\Saved Games\DCS.openbeta\Config\Input\FA-18C_hornet\joystick", "FA-18C_hornet")]
    [InlineData("C:/Saved Games/DCS/config/input/F-16C_50/joystick/", "F-16C_50")]
    [InlineData(@"C:\DCS\Config\Input\UiLayer", "UiLayer")]
    [InlineData(@"C:\archive\Config\Input\old\Config\Input\new\joystick", "new")]
    [InlineData(@"C:\DCS\\Config\\Input\\A-10C_2\\joystick\\", "A-10C_2")]
    public void InferModuleId_ReturnsModuleSegment(string path, string expected)
    {
        Assert.Equal(expected, ProfilePathIdentityService.InferModuleId(path));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(@"C:\DCS\ConfigInput\FA-18C_hornet\joystick")]
    [InlineData(@"C:\DCS\Input\FA-18C_hornet\joystick")]
    [InlineData(@"C:\DCS\Config\Input")]
    [InlineData(@"C:\Config\Input\old\Config\Input")]
    public void InferModuleId_ReturnsNullForInvalidPaths(string? path)
    {
        Assert.Null(ProfilePathIdentityService.InferModuleId(path));
    }

    [Fact]
    public void ProfilesDirectory_DefaultsAllConsumerIdentities()
    {
        var viewModel = new MainViewModel();

        viewModel.ProfilesDir = @"C:\DCS\Config\Input\FA-18C_hornet\joystick";

        Assert.Equal("FA-18C_hornet", viewModel.DisplayName);
        Assert.Equal("FA-18C_hornet", viewModel.InputModuleId);
        Assert.Equal("FA-18C_hornet", viewModel.KneeboardId);
    }

    [Fact]
    public void ProfilesDirectory_PreservesManualValuesAndUpdatesInferredValues()
    {
        var viewModel = new MainViewModel
        {
            ProfilesDir = @"C:\DCS\Config\Input\FA-18C_hornet\joystick",
        };
        viewModel.DisplayName = "My Hornet";

        viewModel.ProfilesDir = @"C:\DCS\Config\Input\F-16C_50\joystick";

        Assert.Equal("My Hornet", viewModel.DisplayName);
        Assert.Equal("F-16C_50", viewModel.InputModuleId);
        Assert.Equal("F-16C_50", viewModel.KneeboardId);
    }

    [Fact]
    public void ProfilesDirectory_PreservesManualValueEvenWhenItMatchesPreviousDefault()
    {
        var viewModel = new MainViewModel
        {
            ProfilesDir = @"C:\DCS\Config\Input\FA-18C_hornet\joystick",
        };
        viewModel.DisplayName = "temporary";
        viewModel.DisplayName = "FA-18C_hornet";

        viewModel.ProfilesDir = @"C:\DCS\Config\Input\F-16C_50\joystick";

        Assert.Equal("FA-18C_hornet", viewModel.DisplayName);
        Assert.Equal("F-16C_50", viewModel.InputModuleId);
    }

    [Fact]
    public void ProfilesDirectory_InvalidPathPreservesExistingValues()
    {
        var viewModel = new MainViewModel
        {
            ProfilesDir = @"C:\DCS\Config\Input\FA-18C_hornet\joystick",
        };

        viewModel.ProfilesDir = @"C:\unrelated\joystick";

        Assert.Equal("FA-18C_hornet", viewModel.DisplayName);
        Assert.Equal("FA-18C_hornet", viewModel.InputModuleId);
        Assert.Equal("FA-18C_hornet", viewModel.KneeboardId);
        Assert.Contains("Could not infer repository identities", viewModel.StatusText);
    }

    [Fact]
    public void ProfilesDirectory_DoesNotDefaultUiLayerIdentities()
    {
        var viewModel = new MainViewModel { ImportTarget = "ui-layer" };

        viewModel.ProfilesDir = @"C:\DCS\Config\Input\UiLayer\joystick";

        Assert.Empty(viewModel.DisplayName);
        Assert.Empty(viewModel.InputModuleId);
        Assert.Empty(viewModel.KneeboardId);
    }
}
