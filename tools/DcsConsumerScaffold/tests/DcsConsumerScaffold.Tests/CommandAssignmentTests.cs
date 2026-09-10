using System.IO;
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
    public void AssignSelectedCommand_RejectsCommandAlreadyOnSelectedControl()
    {
        var row = Row("keyDiffs", "JOY_BTN1", "d-current", "Current command");
        var viewModel = new MainViewModel { HasPreview = true };
        viewModel.ReplacePreviewRows([row]);
        viewModel.SelectedPreviewRow = row;
        viewModel.SelectedCatalogCommand = Command("button", "d-current", "Current command");

        Assert.False(viewModel.CanAssignSelectedCommand);
        Assert.Equal("This command is already assigned to the selected control.", viewModel.AssignmentGuidance);
        Assert.Throws<InvalidOperationException>(() => viewModel.AssignSelectedCommand());
        Assert.Empty(viewModel.PendingAssignments);
    }

    [Fact]
    public void RebuildCommandLabels_CollapsesDuplicateAndRepositoryOnlyGroups()
    {
        var row = Row("keyDiffs", "JOY_BTN1", "d-current", "Current command");
        var viewModel = new MainViewModel { HasPreview = true };
        viewModel.ReplacePreviewRows([row]);
        viewModel.CommandLabels.Add(new CommandLabelGroup { Command = "d-current" });
        viewModel.CommandLabels.Add(new CommandLabelGroup { Command = "d-current", IsRepositoryOnly = true });

        viewModel.RebuildCommandLabels();

        var group = Assert.Single(viewModel.CommandLabels);
        Assert.Equal("d-current", group.Command);
        Assert.False(group.IsRepositoryOnly);
        Assert.Equal(1, group.BindingCount);
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

    [Fact]
    public void TargetFilter_IncludesCatalogBackedUnboundControlAndStagesCreation()
    {
        var bound = Row("keyDiffs", "JOY_BTN1", "d-old", "Old command");
        var unbound = Row("keyDiffs", "JOY_BTN2", string.Empty, string.Empty);
        unbound.IsUnboundCandidate = true;
        unbound.Chord = "SHIFT";
        unbound.Reformers = ["SHIFT"];
        var viewModel = new MainViewModel { HasPreview = true };
        viewModel.ReplacePreviewRows([bound], [unbound]);
        viewModel.SelectedCatalogCommand = Command("button", "d-new", "New command");
        viewModel.SelectedTargetBindingState = "Unbound";

        Assert.Equal(unbound, Assert.Single(viewModel.FilteredPreviewRows));
        viewModel.SelectedPreviewRow = unbound;
        var assignment = viewModel.AssignSelectedCommand();

        Assert.True(assignment.AllowCreate);
        Assert.Equal(["SHIFT"], assignment.Reformers);
        Assert.Contains(unbound, viewModel.Rows);
        Assert.False(unbound.IsUnboundCandidate);
        Assert.Equal("d-new", unbound.Command);
    }

    [Fact]
    public void AssignmentGuidance_BlocksApplicableUiLayerConflict()
    {
        var row = Row("keyDiffs", "JOY_BTN1", "d-old", "Old command");
        row.ProfileFile = "tm-mfd.diff.lua";
        row.CalloutId = "mfd-osb-t1-shifted";
        row.Reformers = ["MOZA_F16_F18_BTN3"];
        var grip = new PreviewDevice { DeviceId = "moza-ab9-hornet-grip", BindingCount = 1, ProfileFile = "grip.diff.lua" };
        var mfd = new PreviewDevice { DeviceId = "tm-mfd", InstanceHint = "3", BindingCount = 1, ProfileFile = row.ProfileFile };
        var viewModel = new MainViewModel
        {
            HasPreview = true, CommonRoot = FindRoot(), ProfilesDir = "profiles", OutputDir = "output",
            DisplayName = "Test", InputModuleId = "Test", KneeboardId = "Test",
        };
        viewModel.Devices.Add(grip);
        viewModel.Devices.Add(mfd);
        viewModel.Modifiers.Add(new PreviewModifier
            { Name = "MOZA_F16_F18_BTN3", DeviceId = "moza-ab9-hornet-grip", Key = "JOY_BTN3" });
        viewModel.ReplacePreviewRows([row]);
        viewModel.SelectedPreviewRow = row;
        viewModel.SelectedCatalogCommand = Command("button", "d-new", "New command");

        Assert.False(viewModel.CanAssignSelectedCommand);
        Assert.True(viewModel.HasUiLayerConflicts);
        Assert.False(viewModel.ProceedCommand.CanExecute(null));
        Assert.Contains("Reserved by the applicable UI Layer: VR Zoom", viewModel.AssignmentGuidance);
        Assert.Throws<InvalidOperationException>(() => viewModel.AssignSelectedCommand());
        Assert.Empty(viewModel.PendingAssignments);
    }

    private static string FindRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "assets", "shared", "ui-layer", "functions.json")))
            directory = directory.Parent;
        return directory?.FullName ?? throw new DirectoryNotFoundException("DCS-Common root not found.");
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
