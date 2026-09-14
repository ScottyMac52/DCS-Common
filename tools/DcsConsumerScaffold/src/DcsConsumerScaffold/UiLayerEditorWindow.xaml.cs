using System.Windows;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Microsoft.Win32;
using System.Collections.ObjectModel;
using System.Windows.Controls;

namespace DcsConsumerScaffold;

public partial class UiLayerEditorWindow : Window
{
    private readonly UiLayerCatalogService _service = new();
    private UiLayerCatalogComparison? _comparison;
    private readonly List<IpiUiFunctionChoice> _functions = [];
    private UiLayerCatalogBinding? _selectedBinding;
    private string _fingerprint = string.Empty;
    public ObservableCollection<UiLayerBindingEdit> StagedEdits { get; } = [];
    public ObservableCollection<IpiModifierDefinition> EditableModifiers { get; } = [];
    public IReadOnlyList<string> Actions { get; } = ["Keep", "Add", "Replace", "Remove"];

    public UiLayerEditorWindow(string? commonRoot = null, string? moduleContext = null)
    {
        InitializeComponent();
        DataContext = this;
        CommonRootBox.Text = commonRoot ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(moduleContext)) StatusText.Text = $"{moduleContext}. Pending destination: DCS-Common authoritative UI Layer.";
        StagedEditsGrid.ItemsSource = StagedEdits;
        ModifiersGrid.ItemsSource = EditableModifiers;
    }

    private void BrowseCommon_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select DCS-Common repository root" };
        if (dialog.ShowDialog(this) == true) CommonRootBox.Text = dialog.FolderName;
    }

    private void BrowseSource_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select Saved Games Config\\Input\\UiLayer folder" };
        if (dialog.ShowDialog(this) == true) SourceRootBox.Text = dialog.FolderName;
    }

    private async void Load_Click(object sender, RoutedEventArgs e) => await RunAsync(async () =>
        Display(await _service.InspectAsync(CommonRootBox.Text.Trim())));

    private async void Compare_Click(object sender, RoutedEventArgs e) => await RunAsync(async () =>
    {
        _comparison = await _service.CompareAsync(CommonRootBox.Text.Trim(), SourceRootBox.Text.Trim());
        Display(_comparison.Canonical);
        ChangesGrid.ItemsSource = _comparison.Changes;
        SaveButton.IsEnabled = _comparison.Source.Valid;
        StatusText.Text = _comparison.Source.Valid
            ? "Comparison loaded. Absence defaults to Keep; choose Remove explicitly when intended."
            : "Imported source is invalid and cannot be saved.";
    });

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (_comparison is null) return;
        if (MessageBox.Show(this, "Validate and atomically apply the selected catalog actions?", "Save definitive UI Layer",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        await RunAsync(async () =>
        {
            var result = await _service.ApplyAsync(CommonRootBox.Text.Trim(), SourceRootBox.Text.Trim(), _comparison.Changes);
            Display(result);
            _comparison = null;
            ChangesGrid.ItemsSource = null;
            SaveButton.IsEnabled = false;
            StatusText.Text = $"Definitive UI Layer saved and validated. Fingerprint: {result.Fingerprint}";
        });
    }

    private void Display(UiLayerCatalogDocument document)
    {
        ProfilesGrid.ItemsSource = document.Profiles;
        BindingsGrid.ItemsSource = document.Bindings;
        _fingerprint = document.Fingerprint;
        EditableModifiers.Clear();
        foreach (var modifier in document.Modifiers) EditableModifiers.Add(new IpiModifierDefinition
            { Name = modifier.Name, Device = modifier.Device, Key = modifier.Key, Mode = modifier.Mode });
        PossibilitiesGrid.ItemsSource = document.Possibilities;
        EditDeviceBox.ItemsSource = document.Possibilities;
        LayerBox.ItemsSource = new[] { new IpiLayerChoice() }.Concat(document.Modifiers.Select(item => new IpiLayerChoice { Name = item.Name })).ToList();
        LayerBox.SelectedIndex = 0;
        ErrorsList.ItemsSource = document.Errors;
        SummaryText.Text = $"{document.Scope}: Possibilities={document.Summary.Possibilities}  Profiles={document.Summary.Profiles}  Bindings={document.Summary.Bindings}  " +
            $"Keys={document.Summary.Keys}  Axes={document.Summary.Axes}  Modifiers={document.Summary.Modifiers}  Errors={document.Summary.Errors}";
        StatusText.Text = document.Valid ? $"Catalog valid. Fingerprint: {document.Fingerprint}" : "Catalog validation failed.";
        AuthorSaveButton.IsEnabled = document.Valid;
        LoadFunctions();
    }

    private void LoadFunctions()
    {
        _functions.Clear();
        _functions.AddRange(new IpiAuthoringService().UiFunctions(CommonRootBox.Text.Trim()));
        FilterFunctions();
    }

    private void CommandSearch_Changed(object sender, TextChangedEventArgs e) => FilterFunctions();

    private void FilterFunctions()
    {
        var query = CommandSearchBox?.Text?.Trim() ?? string.Empty;
        UiCommandsGrid.ItemsSource = _functions.Where(item => query.Length == 0 ||
            new[] { item.Id, item.Command, item.Label, item.Category }.Any(value => value.Contains(query, StringComparison.OrdinalIgnoreCase))).ToList();
    }

    private static string SelectedText(ComboBox box) => (box.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? string.Empty;

    private async void EditDevice_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (EditDeviceBox.SelectedItem is not UiLayerDevicePossibility device) return;
        try
        {
            SharedControlBox.ItemsSource = await new IpiAuthoringService().SharedControlsAsync(CommonRootBox.Text.Trim(), device.DeviceId);
            SharedControlBox.SelectedIndex = SharedControlBox.Items.Count > 0 ? 0 : -1;
        }
        catch (Exception ex) { StatusText.Text = ex.Message; }
    }

    private void BindingSelection_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (BindingsGrid.SelectedItem is not UiLayerCatalogBinding binding) return;
        _selectedBinding = binding;
        EditProfileBox.Text = binding.Profile;
        EditLabelBox.Text = binding.Name;
        EditDeviceBox.SelectedItem = ((IEnumerable<UiLayerDevicePossibility>)EditDeviceBox.ItemsSource)
            .FirstOrDefault(item => item.DeviceId.Equals(binding.DeviceId, StringComparison.OrdinalIgnoreCase));
        LayerBox.SelectedItem = ((IEnumerable<IpiLayerChoice>)LayerBox.ItemsSource)
            .FirstOrDefault(item => item.Name.Equals(binding.Modifiers.FirstOrDefault() ?? string.Empty, StringComparison.Ordinal));
        var command = _functions.FirstOrDefault(item => item.Command == binding.Command);
        if (command is not null) UiCommandsGrid.SelectedItem = command;
    }

    private void StageEdit_Click(object sender, RoutedEventArgs e)
    {
        if (UiCommandsGrid.SelectedItem is not IpiUiFunctionChoice command)
        {
            MessageBox.Show(this, "Select a validated UI Layer command.", "Stage UI Layer edit", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        var action = SelectedText(EditActionBox);
        var edit = new UiLayerBindingEdit { Action = action, Command = command.Command, Name = string.IsNullOrWhiteSpace(EditLabelBox.Text) ? command.Label : EditLabelBox.Text.Trim() };
        if (action == "relabel") edit.Label = EditLabelBox.Text;
        else
        {
            if (EditDeviceBox.SelectedItem is not UiLayerDevicePossibility device || string.IsNullOrWhiteSpace(EditProfileBox.Text))
                throw new InvalidOperationException("Select a definitive device possibility and profile filename.");
            var control = SharedControlBox.SelectedItem as IpiSharedControlChoice;
            if (action != "clear" && control is null)
                throw new InvalidOperationException("Select a shared DCS-Common control.");
            var category = _selectedBinding?.Profile == EditProfileBox.Text.Trim() ? _selectedBinding.Category : "joystick";
            edit.Profile = new UiLayerProfileTarget { Category = category, Filename = EditProfileBox.Text.Trim(), DeviceId = device.DeviceId };
            edit.Section = action == "clear" ? _selectedBinding?.Section ?? "keyDiffs" : control!.Section;
            var chord = LayerBox.SelectedItem is IpiLayerChoice layer && !string.IsNullOrEmpty(layer.Name) ? new List<string> { layer.Name } : [];
            if (action == "move")
            {
                if (_selectedBinding is null) throw new InvalidOperationException("Select the existing binding to move.");
                edit.From = new UiLayerPhysicalTarget { Key = _selectedBinding.Key, Reformers = [.. _selectedBinding.Modifiers] };
                edit.To = new UiLayerPhysicalTarget { Key = control!.Key, Reformers = chord };
            }
            else
            {
                if (action == "clear" && _selectedBinding is null) throw new InvalidOperationException("Select the existing binding to clear.");
                edit.Key = action == "clear" ? _selectedBinding!.Key : control!.Key;
                edit.Reformers = action == "clear" ? [.. _selectedBinding!.Modifiers] : chord;
            }
        }
        StagedEdits.Add(edit);
        StatusText.Text = $"Staged authoritative change: {edit.Summary}. Nothing has been written yet.";
    }

    private void UnstageEdit_Click(object sender, RoutedEventArgs e)
    {
        if (StagedEditsGrid.SelectedItem is UiLayerBindingEdit edit) StagedEdits.Remove(edit);
    }

    private async void SaveAuthored_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show(this, $"Validate and atomically write {StagedEdits.Count} binding edit(s) and {EditableModifiers.Count} modifier definitions to DCS-Common?",
            "Save authoritative UI Layer", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        await RunAsync(async () =>
        {
            var result = await _service.ApplyEditsAsync(CommonRootBox.Text.Trim(), _fingerprint, EditableModifiers.ToArray(), StagedEdits.ToArray());
            StagedEdits.Clear();
            Display(result);
            StatusText.Text = $"Saved authoritative UI Layer: {string.Join(", ", result.ChangedFiles)}. Re-scaffold affected consumers, rebuild kneeboards and OVGME packages; this data-only edit does not require another EXE rebuild.";
        });
    }

    private async Task RunAsync(Func<Task> action)
    {
        IsEnabled = false;
        try { await action(); }
        catch (Exception ex) { StatusText.Text = ex.Message; MessageBox.Show(this, ex.Message, "UI Layer Editor", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { IsEnabled = true; }
    }
}
