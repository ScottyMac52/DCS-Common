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
    public ObservableCollection<IpiUiLayerBindingChoice> AvailableUiBindings { get; } = [];
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
        UtilizationGrid.ItemsSource = AvailableUiBindings;
        _ = RefreshInventoryAsync();
    }

    private async Task RefreshInventoryAsync()
    {
        try
        {
            if (string.IsNullOrWhiteSpace(CommonRootBox.Text)) return;
            var hardware = _service.Hardware(CommonRootBox.Text.Trim());
            DeviceBox.ItemsSource = hardware;
            if (DeviceBox.Items.Count > 0) DeviceBox.SelectedIndex = 0;
            AvailableUiBindings.Clear();
            foreach (var binding in await _service.UiLayerBindingsAsync(CommonRootBox.Text.Trim())) AvailableUiBindings.Add(binding);
        }
        catch (Exception ex) { StatusText.Text = ex.Message; }
    }

    private async void BrowseCommon_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select DCS-Common repository root" };
        if (dialog.ShowDialog(this) == true) { CommonRootBox.Text = dialog.FolderName; await RefreshInventoryAsync(); }
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
        foreach (var binding in AvailableUiBindings) binding.IsSelected = false;
        foreach (var item in state.UiLayerUtilization?.Bindings ?? [])
        {
            var match = AvailableUiBindings.FirstOrDefault(binding => binding.DeviceId.Equals(item.DeviceId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(binding.DeviceInstance, item.DeviceInstance, StringComparison.OrdinalIgnoreCase)
                && binding.FunctionId == item.FunctionId && binding.Modifiers.SequenceEqual(item.Modifiers));
            if (match is not null) match.IsSelected = true;
        }
        UtilizationGrid.Items.Refresh();
        StatusText.Text = state.Initialized
            ? $"Loaded module authoring state. {Modifiers.Count} layer definition(s), {AvailableUiBindings.Count(item => item.IsSelected)} definitive UI Layer assignment(s) selected."
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
                uiLayerUtilization = new IpiUiLayerUtilization { Bindings = AvailableUiBindings.Where(item => item.IsSelected).Select(item => item.ToSelection()).ToList() },
            });
            _fingerprint = result.Fingerprint;
            StatusText.Text = $"Saved {string.Join(", ", result.ChangedFiles)}. Rebuild kneeboards and the OVGME package; no new IPI EXE is required for these data changes.";
        });
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
