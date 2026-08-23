using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.ViewModels;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class CommandLabelGroupingTests
{
    [Fact]
    public void GroupsExactCommandsAndSynchronizesOnlyWhenApplied()
    {
        var first = Row("binding-1", "command-a", "Same DCS name", "Initial");
        var second = Row("binding-2", "command-a", "Same DCS name", "Initial");
        var differentCommand = Row("binding-3", "command-b", "Same DCS name", "Other");

        var viewModel = new MainViewModel();
        viewModel.ReplacePreviewRows([first, second, differentCommand]);

        Assert.Equal(2, viewModel.CommandLabels.Count);
        var group = Assert.Single(viewModel.CommandLabels, item => item.Command == "command-a");
        Assert.Equal(2, group.BindingCount);
        Assert.False(group.IsMixed);
        Assert.Equal("Initial", group.Label);

        group.Label = "Unified label";
        viewModel.ApplyCommandLabel(group);

        Assert.Equal("Unified label", first.Label);
        Assert.Equal("Unified label", second.Label);
        Assert.Equal("command", first.LabelSource);
        Assert.Equal("Other", differentCommand.Label);
        Assert.Equal("Synchronized", group.State);
    }

    [Fact]
    public void IndividualOverrideCreatesMixedStateAndGroupCanApplyIntentionalBlank()
    {
        var first = Row("binding-1", "command-a", "Default A", "Shared");
        var second = Row("binding-2", "command-a", "Default A", "Shared");
        var viewModel = new MainViewModel();
        viewModel.ReplacePreviewRows([first, second]);
        var group = Assert.Single(viewModel.CommandLabels);

        first.Label = "One binding only";

        Assert.True(group.IsMixed);
        Assert.Equal("Mixed", group.State);
        Assert.Null(group.Label);
        Assert.Equal("Shared", second.Label);

        group.Label = string.Empty;
        viewModel.ApplyCommandLabel(group);

        Assert.False(group.IsMixed);
        Assert.Equal(string.Empty, group.Label);
        Assert.Equal(string.Empty, first.Label);
        Assert.Equal(string.Empty, second.Label);
        Assert.Equal(2, viewModel.LabelOverrides().Count);
    }

    [Fact]
    public void CurrentAndDeviceLabelChangesRecomputeWithoutChangingSiblingRows()
    {
        var first = Row("binding-1", "command-a", "Default A", "Device A");
        var second = Row("binding-2", "command-a", "Default A", "Device A");
        var viewModel = new MainViewModel();
        viewModel.ReplacePreviewRows([first, second]);
        var group = Assert.Single(viewModel.CommandLabels);

        first.ApplyLabel("Current label", "current");

        Assert.True(group.IsMixed);
        Assert.Equal("Device A", second.Label);

        first.ResetLabel();

        Assert.False(group.IsMixed);
        Assert.Equal("Device A", group.Label);
    }

    private static PreviewRow Row(
        string bindingId,
        string command,
        string defaultLabel,
        string label) => new()
        {
            BindingId = bindingId,
            Command = command,
            DefaultLabel = defaultLabel,
            DeviceLabel = label,
            Label = label,
        };
}
