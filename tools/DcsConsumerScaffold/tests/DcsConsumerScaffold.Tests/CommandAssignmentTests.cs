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

    [Fact]
    public void AssignmentGuidance_ExplainsEachRequiredSelectionAndMismatch()
    {
        var button = Row("keyDiffs", "JOY_BTN1", "d-old", "Old command");
        var axis = Row("axisDiffs", "JOY_X", "a-old", "Old axis");
        var viewModel = new MainViewModel { HasPreview = true };
        viewModel.ReplacePreviewRows([button, axis]);

        Assert.Equal("Load a command catalog to begin.", viewModel.AssignmentGuidance);

        viewModel.SelectedCatalogCommand = Command("axis", "a-new", "Pitch");
        Assert.Equal("Step 2: select a physical control on the right.", viewModel.AssignmentGuidance);

        viewModel.SelectedPreviewRow = button;
        Assert.Equal("Select an axis control to match this command.", viewModel.AssignmentGuidance);

        viewModel.SelectedPreviewRow = axis;
        Assert.True(viewModel.CanAssignSelectedCommand);
        Assert.StartsWith("Ready.", viewModel.AssignmentGuidance);
        Assert.Contains("JOY_X", viewModel.SelectedControlSummary);
    }

    [Fact]
    public void TargetFilter_FollowsSelectedCommandTypeBindingStateAndChord()
    {
        var boundButton = Row("keyDiffs", "JOY_BTN1", "d-old", "Old command");
        boundButton.Chord = string.Empty;
        boundButton.Reformers = [];
        var shiftedButton = Row("keyDiffs", "JOY_BTN2", "d-shifted", "Shifted command");
        shiftedButton.Chord = "SHIFT";
        shiftedButton.Reformers = ["SHIFT"];
        var unboundButton = Row("keyDiffs", "JOY_BTN3", string.Empty, string.Empty);
        unboundButton.Chord = string.Empty;
        unboundButton.Reformers = [];
        var axis = Row("axisDiffs", "JOY_X", "a-old", "Old axis");
        axis.Chord = string.Empty;
        axis.Reformers = [];
        var viewModel = new MainViewModel { HasPreview = true };
        viewModel.ReplacePreviewRows([boundButton, shiftedButton, unboundButton, axis]);

        viewModel.SelectedCatalogCommand = Command("button", "d-new", "New command");
        Assert.Equal(3, viewModel.FilteredPreviewRows.Count);
        Assert.DoesNotContain(axis, viewModel.FilteredPreviewRows);

        viewModel.SelectedTargetBindingState = "Unbound";
        Assert.Equal(unboundButton, Assert.Single(viewModel.FilteredPreviewRows));

        viewModel.SelectedTargetBindingState = "Bound";
        viewModel.SelectedTargetChord = "SHIFT";
        Assert.Equal(shiftedButton, Assert.Single(viewModel.FilteredPreviewRows));

        viewModel.SelectedPreviewRow = shiftedButton;
        var assignment = viewModel.AssignSelectedCommand();
        Assert.Equal(["SHIFT"], assignment.Reformers);

        viewModel.SelectedCatalogCommand = Command("axis", "a-new", "New axis");
        Assert.Empty(viewModel.FilteredPreviewRows);
        Assert.Null(viewModel.SelectedPreviewRow);
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
