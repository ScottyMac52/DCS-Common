using System.IO;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class UiLayerProjectionServiceTests
{
    private static readonly string Root = FindRoot();
    private readonly UiLayerProjectionService _service = new();

    [Theory]
    [InlineData("moza-ab9-hornet-grip", "MOZA_MODIFIER_BTN3")]
    [InlineData("moza-ab9-warthog-grip", "MOZA_MODIFIER_BTN3")]
    [InlineData("ava-base-f16c", "AVA_BASE_MODIFIER_BTN3")]
    [InlineData("vkb-f14-gunfighter", "VKB_F14_BTN7")]
    public void CompositeDevicesProjectOnlyTheirApplicableModifier(string deviceId, string expected)
    {
        var device = Device(deviceId);
        var projected = _service.Load(Root, device, [device]);
        Assert.NotEmpty(projected);
        Assert.All(projected, item => Assert.Equal(expected, item.Modifier));
    }

    [Fact]
    public void MfdProjectionUsesModuleGripFamilyAndOnlyMfd3()
    {
        var grip = Device("moza-ab9-hornet-grip");
        var mfd3 = Device("tm-mfd", "3");
        var mfd2 = Device("tm-mfd", "2");
        var projected = _service.Load(Root, mfd3, [grip, mfd3, mfd2]);
        Assert.NotEmpty(projected);
        Assert.All(projected, item => Assert.Equal("MOZA_MODIFIER_BTN3", item.Modifier));
        Assert.Empty(_service.Load(Root, mfd2, [grip, mfd3, mfd2]));
    }

    private static PreviewDevice Device(string id, string? instance = null) => new()
        { DeviceId = id, InstanceHint = instance, BindingCount = 1, ProfileFile = id + ".diff.lua" };

    private static string FindRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "assets", "shared", "ui-layer", "functions.json")))
            directory = directory.Parent;
        return directory?.FullName ?? throw new DirectoryNotFoundException("DCS-Common root not found.");
    }
}
