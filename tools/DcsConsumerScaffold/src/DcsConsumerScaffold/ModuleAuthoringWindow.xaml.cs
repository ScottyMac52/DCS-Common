using System.Collections.ObjectModel;
using System.Windows;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Microsoft.Win32;

namespace DcsConsumerScaffold;

public partial class ModuleAuthoringWindow : Window
{
    private readonly IpiAuthoringService _service = new();
    private string? _fingerprint;
    public ObservableCollection<IpiModifierDefinition> Modifiers { get; } = [];
    public ObservableCollection<IpiUiLayerSelection> Utilization { get; } = [];
    public string? ProfilesDirectoryCreated { get; private set; }
    public string RepositoryRoot => RepositoryRootBox.Text.Trim();
    public string DisplayName => DisplayNameBox.Text.Trim();
    public string InputModuleId => ModuleIdBox.Text.Trim();
    public string KneeboardId => KneeboardIdBox.Text.Trim();

    public ModuleAuthoringWindow(string? commonRoot = null, string? repositoryRoot = null, string? displayName = null,
        string? inputModuleId = null, string? kneeboardId = null)
    {
        InitializeComponent();
        CommonRootBox.Text = commonRoot ?? string.Empty;
        RepositoryRootBox.Text = repositoryRoot ?? string.Empty;
        DisplayNameBox.Text = displayName ?? string.Empty;
        ModuleIdBox.Text = inputModuleId ?? string.Empty;
        KneeboardIdBox.Text = kneeboardId ?? string.Empty;
        ModifiersGrid.ItemsSource = Modifiers;
        UtilizationGrid.ItemsSource = Utilization;
        RefreshInventory();
    }

    private void RefreshInventory()
    {
        try
        {
            if (string.IsNullOrWhiteSpace(CommonRootBox.Text)) return;
            var hardware = _service.Hardware(CommonRootBox.Text.Trim());
            DeviceBox.ItemsSource = hardware;
            UtilDeviceBox.ItemsSource = hardware;
            UtilFunctionBox.ItemsSource = _service.UiFunctions(CommonRootBox.Text.Trim());
            if (DeviceBox.Items.Count > 0) DeviceBox.SelectedIndex = 0;
            if (UtilDeviceBox.Items.Count > 0) UtilDeviceBox.SelectedIndex = 0;
            if (UtilFunctionBox.Items.Count > 0) UtilFunctionBox.SelectedIndex = 0;
        }
        catch (Exception ex) { StatusText.Text = ex.Message; }
    }

    private void BrowseCommon_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select DCS-Common repository root" };
        if (dialog.ShowDialog(this) == true) { CommonRootBox.Text = dialog.FolderName; RefreshInventory(); }
    }

    private void BrowseRepository_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select the consumer Git clone" };
        if (dialog.ShowDialog(this) == true) RepositoryRootBox.Text = dialog.FolderName;
    }

    private async void Initialize_Click(object sender, RoutedEventArgs e)
    {
        if (DeviceBox.SelectedItem is not IpiHardwareChoice device) return;
        await RunAsync(async () =>
        {
            var result = await _service.InitializeAsync(CommonRootBox.Text.Trim(), new
            {
                commonRoot = CommonRootBox.Text.Trim(), repositoryRoot = RepositoryRootBox.Text.Trim(),
                displayName = DisplayName, inputModuleId = InputModuleId,
                kneeboardId = KneeboardId, deviceId = device.DeviceId,
                deviceInstance = NullIfBlank(DeviceInstanceBox.Text), profileFilename = ProfileFilenameBox.Text.Trim(),
            });
            ProfilesDirectoryCreated = result.ProfilesDirectory;
            StatusText.Text = $"Blank clone initialized. Profile source: {ProfilesDirectoryCreated}. Return to the main window, Load Preview, import the module command catalog, and assign controls.";
            await LoadStateAsync();
        });
    }

    private async void Load_Click(object sender, RoutedEventArgs e) => await RunAsync(LoadStateAsync);

    private async Task LoadStateAsync()
    {
        var state = await _service.InspectModuleAsync(CommonRootBox.Text.Trim(), RepositoryRootBox.Text.Trim(), ModuleIdBox.Text.Trim());
        _fingerprint = state.Fingerprint;
        Modifiers.Clear();
        foreach (var item in state.Modifiers) Modifiers.Add(item);
        Utilization.Clear();
        foreach (var item in state.UiLayerUtilization?.Bindings ?? []) Utilization.Add(item);
        StatusText.Text = state.Initialized
            ? $"Loaded module authoring state. {Modifiers.Count} layer definition(s), {Utilization.Count} explicit UI Layer selection(s)."
            : "This clone has not been initialized. Use Initialize blank clone.";
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        await RunAsync(async () =>
        {
            var result = await _service.SaveModuleAsync(CommonRootBox.Text.Trim(), new
            {
                repositoryRoot = RepositoryRootBox.Text.Trim(), inputModuleId = ModuleIdBox.Text.Trim(),
                expectedFingerprint = _fingerprint, modifiers = Modifiers.ToArray(),
                uiLayerUtilization = new IpiUiLayerUtilization { Bindings = Utilization.ToList() },
            });
            _fingerprint = result.Fingerprint;
            StatusText.Text = $"Saved {string.Join(", ", result.ChangedFiles)}. Rebuild kneeboards and the OVGME package; no new IPI EXE is required for these data changes.";
        });
    }

    private void AddUtilization_Click(object sender, RoutedEventArgs e)
    {
        if (UtilDeviceBox.SelectedItem is not IpiHardwareChoice device || UtilFunctionBox.SelectedItem is not IpiUiFunctionChoice function) return;
        var item = new IpiUiLayerSelection { DeviceId = device.DeviceId, DeviceInstance = NullIfBlank(UtilInstanceBox.Text), FunctionId = function.Id };
        item.ModifierDisplay = UtilModifiersBox.Text;
        if (Utilization.Any(existing => existing.DeviceId.Equals(item.DeviceId, StringComparison.OrdinalIgnoreCase)
            && string.Equals(existing.DeviceInstance, item.DeviceInstance, StringComparison.OrdinalIgnoreCase)
            && existing.FunctionId == item.FunctionId && existing.Modifiers.SequenceEqual(item.Modifiers)))
        {
            StatusText.Text = "That exact device, instance, function, and chord is already selected.";
            return;
        }
        Utilization.Add(item);
    }

    private void RemoveUtilization_Click(object sender, RoutedEventArgs e)
    {
        if (UtilizationGrid.SelectedItem is IpiUiLayerSelection selected) Utilization.Remove(selected);
    }

    private async Task RunAsync(Func<Task> action)
    {
        IsEnabled = false;
        try { await action(); }
        catch (Exception ex) { StatusText.Text = ex.Message; MessageBox.Show(this, ex.Message, "IPI authoring", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { IsEnabled = true; }
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
