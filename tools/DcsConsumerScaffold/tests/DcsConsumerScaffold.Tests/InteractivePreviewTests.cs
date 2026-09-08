using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.ViewModels;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class InteractivePreviewTests
{
    [Fact]
    public void NewChordCombinesKnownModifiersAndStagesASeparateAssignment()
    {
        var model = new MainViewModel { HasPreview = true };
        model.Modifiers.Add(new PreviewModifier { Name = "SHIFT", Mode = "hold" });
        model.Modifiers.Add(new PreviewModifier { Name = "CTRL", Mode = "hold" });
        var chord = model.CreateInteractiveChord(["SHIFT", "CTRL", "SHIFT"]);
        Assert.Equal(new[] { "CTRL", "SHIFT" }, chord);
        Assert.Throws<InvalidOperationException>(() => model.CreateInteractiveChord([]));
        Assert.Throws<InvalidOperationException>(() => model.CreateInteractiveChord(["UNKNOWN"]));
        var baseRow = model.GetInteractiveRow(Device(), Control(), []);
        var chordRow = model.GetInteractiveRow(Device(), Control(), chord);
        Assert.Empty(model.Rows);
        model.SelectedCatalogCommand = Command(); model.SelectedPreviewRow = chordRow;
        var pending = model.AssignSelectedCommand();
        Assert.Equal(chord, pending.Reformers);
        Assert.True(pending.AllowCreate);
        Assert.Empty(baseRow.Command!);
        model.SelectedCatalogCommand = Command("d-second"); model.SelectedPreviewRow = chordRow;
        Assert.True(model.AssignSelectedCommand().AllowCreate);
        model.UndoAssignment(chordRow);
        Assert.Empty(model.Rows);
        Assert.Contains(chordRow, model.AssignmentTargets);
        Assert.True(chordRow.IsUnboundCandidate);
    }
    private static PreviewDevice Device(string profile = "Stick.diff.lua") => new() { ProfileFile = profile, ProfileKey = profile, DeviceId = "tm-warthog-grip", Stem = "Stick" };
    private static InteractiveControl Control(string key = "JOY_BTN1", string type = "button") => new() { Id = "trigger", Key = key, Type = type, HardwareLabel = "Trigger" };
    private static DcsCommandCatalogEntry Command(string key = "d-new") => new() { BindingKey = key, Name = "New command", Type = "button" };

    [Fact]
    public void EmptyTargetsRemainDistinctByDeviceAndModifierAndUndoCreation()
    {
        var model = new MainViewModel { HasPreview = true };
        var row = model.GetInteractiveRow(Device(), Control(), []);
        var shifted = model.GetInteractiveRow(Device(), Control(), ["SHIFT"]);
        var other = model.GetInteractiveRow(Device("Other.diff.lua"), Control(), []);
        Assert.NotSame(row, shifted); Assert.NotSame(row, other);
        Assert.Same(row, model.GetInteractiveRow(Device(), Control(), []));
        model.SelectedCatalogCommand = Command(); model.SelectedPreviewRow = row;
        var assignment = model.AssignSelectedCommand();
        Assert.True(assignment.AllowCreate);
        Assert.Empty(shifted.Command!); Assert.Empty(other.Command!);
        row.Label = "CUSTOM";
        Assert.Equal("CUSTOM", model.LabelOverrides()[row.BindingId!]);
        model.UndoAssignment(row);
        Assert.Empty(model.PendingAssignments); Assert.Empty(row.Command!);
    }

    [Fact]
    public void RepeatedReplacementAndClearRestoreOriginalCommandAndLabel()
    {
        var row = new PreviewRow { ProfileFile = "Stick.diff.lua", Key = "JOY_BTN1", Section = "keyDiffs", Command = "d-old", Name = "Old", DefaultLabel = "Old", Label = "MY LABEL", BindingId = "original", ChangeState = PreviewChangeState.Unchanged };
        var model = new MainViewModel { HasPreview = true };
        model.ReplacePreviewRows([row]);
        model.SelectedCatalogCommand = Command(); model.SelectedPreviewRow = row; model.AssignSelectedCommand();
        model.SelectedCatalogCommand = Command("d-second"); model.SelectedPreviewRow = row; model.AssignSelectedCommand();
        model.ClearAssignment(row);
        Assert.True(Assert.Single(model.PendingAssignments).Clear);
        model.UndoAssignment(row);
        Assert.Equal("d-old", row.Command); Assert.Equal("MY LABEL", row.Label);
        Assert.Equal("original", row.BindingId); Assert.Equal(PreviewChangeState.Unchanged, row.ChangeState);
        Assert.Empty(model.PendingAssignments);
    }

    [Fact]
    public void ConflictReplacementCollapsesDuplicatesAndUndoRestoresThem()
    {
        PreviewRow Row(string command) => new() { ProfileFile = "Stick.diff.lua", Key = "JOY_BTN1", Section = "keyDiffs", Command = command, Name = command };
        var a = Row("d-a"); var b = Row("d-b");
        var model = new MainViewModel { HasPreview = true };
        model.ReplacePreviewRows([a, b]); Assert.True(model.HasConflict(a));
        model.SelectedCatalogCommand = Command(); model.SelectedPreviewRow = a; model.AssignSelectedCommand();
        Assert.Single(model.Rows); Assert.False(model.HasConflict(a));
        model.UndoAssignment(a);
        Assert.Equal(2, model.Rows.Count); Assert.True(model.HasConflict(a));
    }

    [Fact]
    public void EmptyAxisRejectsButtonAndSearchOnlyCommands()
    {
        var model = new MainViewModel { HasPreview = true };
        var axis = model.GetInteractiveRow(Device(), Control("JOY_X", "axis"), []);
        model.SelectedCatalogCommand = Command(); model.SelectedPreviewRow = axis;
        Assert.False(model.CanAssignSelectedCommand);
        model.SelectedCatalogCommand = new() { Type = "axis", BindingKey = "a-new", Name = "Axis", IsAssignable = false };
        model.SelectedPreviewRow = axis;
        Assert.False(model.CanAssignSelectedCommand);
        Assert.Throws<InvalidOperationException>(() => model.AssignSelectedCommand());
    }
}
