using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.ViewModels;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class CommandAssignmentTests
{
    [Fact]
    public void AssignSelectedCommand_StagesCompatibleControlAndUpdatesPreview()
    {
        var row = Row("keyDiffs", "JOY_BTN1", "d-old", "Old command");
        var command = Command("button", "d-new", "New command");
        var viewModel = new MainViewModel { HasPreview = true };
        viewModel.ReplacePreviewRows([row]);
        viewModel.SelectedPreviewRow = row;
        viewModel.SelectedCatalogCommand = command;

        var assignment = viewModel.AssignSelectedCommand();

        Assert.Equal("Stick.diff.lua", assignment.ProfileFile);
        Assert.Equal("keyDiffs", assignment.Section);
        Assert.Equal("JOY_BTN1", assignment.Key);
        Assert.Equal(["SHIFT"], assignment.Reformers);
        Assert.Equal("d-new", assignment.Command);
        Assert.Equal("d-new", row.Command);
        Assert.Equal("New command", row.Name);
        Assert.Equal(PreviewChangeState.Changed, row.ChangeState);
        Assert.Single(viewModel.PendingAssignments);
    }

    [Fact]
    public void AssignSelectedCommand_RejectsSearchOnlyAndTypeMismatch()
    {
        var row = Row("keyDiffs", "JOY_BTN1", "d-old", "Old command");
        var viewModel = new MainViewModel { HasPreview = true, SelectedPreviewRow = row };
        viewModel.SelectedCatalogCommand = Command("button", "unresolved:1", "Search only", false);
        Assert.False(viewModel.CanAssignSelectedCommand);
        Assert.Throws<InvalidOperationException>(() => viewModel.AssignSelectedCommand());

        viewModel.SelectedCatalogCommand = Command("axis", "a2001cd1", "Pitch");
        Assert.False(viewModel.CanAssignSelectedCommand);
    }

    [Fact]
    public void AssignSelectedCommand_ReplacesEarlierPendingChoiceForSamePhysicalControl()
    {
        var row = Row("keyDiffs", "JOY_BTN1", "d-old", "Old command");
        var viewModel = new MainViewModel { HasPreview = true, SelectedPreviewRow = row };
        viewModel.SelectedCatalogCommand = Command("button", "d-first", "First");
        viewModel.AssignSelectedCommand();
        viewModel.SelectedCatalogCommand = Command("button", "d-second", "Second");

        viewModel.AssignSelectedCommand();

        var pending = Assert.Single(viewModel.PendingAssignments);
        Assert.Equal("d-second", pending.Command);
        Assert.Equal("d-second", row.Command);
    }

    private static PreviewRow Row(string section, string key, string command, string name) => new()
    {
        ProfileFile = "Stick.diff.lua", Stem = "Stick", Section = section, Key = key,
        Reformers = ["SHIFT"], Chord = "SHIFT", Command = command, Name = name,
        DefaultLabel = name, BindingId = "old-binding",
    };

    private static DcsCommandCatalogEntry Command(string type, string key, string name, bool assignable = true) => new()
    {
        Type = type, BindingKey = key, Name = name, IsAssignable = assignable,
    };
}
