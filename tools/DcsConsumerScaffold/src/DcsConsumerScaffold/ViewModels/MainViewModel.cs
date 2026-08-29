using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;

namespace DcsConsumerScaffold.ViewModels;

public sealed class MainViewModel : INotifyPropertyChanged
{
    private readonly ScaffoldEngineService _engine;
    private readonly CurrentLabelService _currentLabels;
    private readonly UiLayerImportService _uiLayerImport;
    private readonly PreviewComparisonService _comparison;
    private RepositoryPreviewSnapshot? _comparisonSnapshot;
    private string _profilesDir = string.Empty;
    private string _modifiersPath = string.Empty;
    private string _mozaGrip = "standalone";
    private string _commonRoot = string.Empty;
    private string _outputDir = string.Empty;
    private string _displayName = string.Empty;
    private string _inputModuleId = string.Empty;
    private string _kneeboardId = string.Empty;
    private bool _displayNameIsInferred;
    private bool _inputModuleIdIsInferred;
    private bool _kneeboardIdIsInferred;
    private string _importTarget = "consumer";
    private string _statusText = "Select a profiles directory, then Load Preview. After review, set output + identities and Proceed.";
    private string _summaryText = string.Empty;
    private bool _isBusy;
    private bool _hasPreview;
    private bool _isLoadingPreview;

    public MainViewModel(
        ScaffoldEngineService? engine = null,
        CurrentLabelService? currentLabels = null,
        UiLayerImportService? uiLayerImport = null,
        PreviewComparisonService? comparison = null)
    {
        _engine = engine ?? new ScaffoldEngineService();
        _currentLabels = currentLabels ?? new CurrentLabelService();
        _uiLayerImport = uiLayerImport ?? new UiLayerImportService();
        _comparison = comparison ?? new PreviewComparisonService();
        LoadPreviewCommand = new RelayCommand(async () => await LoadPreviewAsync(), CanLoadPreview);
        ProceedCommand = new RelayCommand(async () => await ProceedAsync(), CanProceed);
        Devices = new ObservableCollection<PreviewDevice>();
        Rows = new ObservableCollection<PreviewRow>();
        Modifiers = new ObservableCollection<PreviewModifier>();
        CommandLabels = new ObservableCollection<CommandLabelGroup>();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<PreviewDevice> Devices { get; }
    public ObservableCollection<PreviewRow> Rows { get; }
    public ObservableCollection<PreviewModifier> Modifiers { get; }
    public ObservableCollection<CommandLabelGroup> CommandLabels { get; }

    public string ImportTarget
    {
        get => _importTarget;
        set
        {
            if (Set(ref _importTarget, value))
            {
                RaiseCommands();
                StatusText = IsUiLayerImport
                    ? "UI Layer mode: select Saved Games UiLayer joystick profiles, modifiers.lua, and the DCS-Common root."
                    : "Consumer mode: Load Preview, review labels, then Proceed to write the module repository.";
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsUiLayerImport)));
                if (!IsUiLayerImport) ApplyProfileIdentityDefaults();
            }
        }
    }

    public bool IsUiLayerImport => string.Equals(ImportTarget, "ui-layer", StringComparison.Ordinal);

    public string ProfilesDir
    {
        get => _profilesDir;
        set
        {
            if (Set(ref _profilesDir, value))
            {
                ApplyProfileIdentityDefaults();
                RaiseCommands();
            }
        }
    }

    public string ModifiersPath
    {
        get => _modifiersPath;
        set => Set(ref _modifiersPath, value);
    }

    public string MozaGrip
    {
        get => _mozaGrip;
        set => Set(ref _mozaGrip, value);
    }

    public string CommonRoot
    {
        get => _commonRoot;
        set => Set(ref _commonRoot, value);
    }

    public string OutputDir
    {
        get => _outputDir;
        set
        {
            if (Set(ref _outputDir, value))
            {
                RaiseCommands();
            }
        }
    }

    public string DisplayName
    {
        get => _displayName;
        set
        {
            if (Set(ref _displayName, value))
            {
                _displayNameIsInferred = false;
                RaiseCommands();
            }
        }
    }

    public string InputModuleId
    {
        get => _inputModuleId;
        set
        {
            if (Set(ref _inputModuleId, value))
            {
                _inputModuleIdIsInferred = false;
                RaiseCommands();
            }
        }
    }

    public string KneeboardId
    {
        get => _kneeboardId;
        set
        {
            if (Set(ref _kneeboardId, value))
            {
                _kneeboardIdIsInferred = false;
                RaiseCommands();
            }
        }
    }

    public string StatusText
    {
        get => _statusText;
        set => Set(ref _statusText, value);
    }

    public string SummaryText
    {
        get => _summaryText;
        set => Set(ref _summaryText, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        set
        {
            if (Set(ref _isBusy, value))
            {
                RaiseCommands();
            }
        }
    }

    public bool HasPreview
    {
        get => _hasPreview;
        set
        {
            if (Set(ref _hasPreview, value))
            {
                RaiseCommands();
            }
        }
    }

    public RelayCommand LoadPreviewCommand { get; }
    public RelayCommand ProceedCommand { get; }

    private bool CanLoadPreview() => !IsBusy && !string.IsNullOrWhiteSpace(ProfilesDir);

    private bool CanProceed() =>
        !IsBusy &&
        HasPreview &&
        !string.IsNullOrWhiteSpace(ProfilesDir) &&
        (IsUiLayerImport
            ? !string.IsNullOrWhiteSpace(CommonRoot) && !string.IsNullOrWhiteSpace(ModifiersPath)
            : !string.IsNullOrWhiteSpace(OutputDir) &&
              !string.IsNullOrWhiteSpace(DisplayName) &&
              !string.IsNullOrWhiteSpace(InputModuleId) &&
              !string.IsNullOrWhiteSpace(KneeboardId));

    private void RaiseCommands()
    {
        LoadPreviewCommand.RaiseCanExecuteChanged();
        ProceedCommand.RaiseCanExecuteChanged();
    }

    private void ApplyProfileIdentityDefaults()
    {
        if (IsUiLayerImport) return;

        var moduleId = ProfilePathIdentityService.InferModuleId(ProfilesDir);
        if (moduleId is null)
        {
            if (!string.IsNullOrWhiteSpace(ProfilesDir))
                StatusText = "Could not infer repository identities: select a profile directory below Config\\Input\\<module>. The identity fields remain editable.";
            return;
        }

        ApplyInferredValue(ref _displayName, ref _displayNameIsInferred, moduleId, nameof(DisplayName));
        ApplyInferredValue(ref _inputModuleId, ref _inputModuleIdIsInferred, moduleId, nameof(InputModuleId));
        ApplyInferredValue(ref _kneeboardId, ref _kneeboardIdIsInferred, moduleId, nameof(KneeboardId));
        RaiseCommands();
    }

    private void ApplyInferredValue(ref string field, ref bool isInferred, string inferredValue, string propertyName)
    {
        if (!string.IsNullOrWhiteSpace(field) && !isInferred) return;
        Set(ref field, inferredValue, propertyName);
        isInferred = true;
    }

    public async Task LoadPreviewAsync()
    {
        if (string.IsNullOrWhiteSpace(ProfilesDir))
        {
            StatusText = "Profiles directory is required.";
            return;
        }

        IsBusy = true;
        _isLoadingPreview = true;
        _comparisonSnapshot = null;
        StatusText = "Running Node scaffold engine (preview)…";
        var semanticModifiers = ModifierOverrides();
        var labels = LabelOverrides();
        Devices.Clear();
        UntrackRows();
        Rows.Clear();
        CommandLabels.Clear();
        Modifiers.Clear();
        HasPreview = false;
        try
        {
            var (document, stdout, stderr, exitCode) = await _engine.RunPreviewAsync(
                ProfilesDir,
                string.IsNullOrWhiteSpace(ModifiersPath) ? null : ModifiersPath,
                MozaGrip,
                string.IsNullOrWhiteSpace(CommonRoot) ? null : CommonRoot,
                semanticModifiers,
                labels);

            if (document?.Devices != null)
            {
                foreach (var device in document.Devices)
                {
                    Devices.Add(device);
                    device.PropertyChanged += Device_PropertyChanged;
                }
            }

            if (document?.Rows != null)
                ReplacePreviewRows(document.Rows);

            CurrentLabelImportResult? existingLabels = null;
            if (!IsUiLayerImport)
                existingLabels = _currentLabels.ApplyExistingRepository(OutputDir, Devices, Rows);

            if (document?.Modifiers != null)
            {
                foreach (var modifier in document.Modifiers)
                {
                    Modifiers.Add(modifier);
                    modifier.PropertyChanged += Modifier_PropertyChanged;
                }
            }

            _comparisonSnapshot = IsUiLayerImport ? null : _comparison.Load(OutputDir);
            _isLoadingPreview = false;
            RecomparePreview();

            HasPreview = document != null;
            var summary = document?.Summary;
            SummaryText = summary == null
                ? string.Empty
                : $"Profiles={summary.ProfileCount}  Rows={summary.RowCount}  Mapped={summary.MappedDevices}  Unmapped={summary.UnmappedDevices}  Errors={summary.ErrorCount}";

            var errorBlock = document?.Errors is { Count: > 0 }
                ? string.Join(Environment.NewLine, document.Errors)
                : string.Empty;
            StatusText = exitCode is 0 or 2
                ? $"Preview loaded (exit {exitCode}).{Environment.NewLine}{stdout}{Environment.NewLine}{errorBlock}".Trim()
                : $"Engine exit {exitCode}.{Environment.NewLine}{stderr}{Environment.NewLine}{stdout}{Environment.NewLine}{errorBlock}".Trim();
            if (existingLabels is not null &&
                existingLabels.CurrentCount + existingLabels.SharedHardwareCount > 0)
                StatusText = $"{StatusText}{Environment.NewLine}Loaded {existingLabels.CurrentCount} current repository labels; " +
                    $"used {existingLabels.SharedHardwareCount} shared-hardware fallbacks.";
        }
        catch (Exception ex)
        {
            StatusText = ex.Message;
            SummaryText = string.Empty;
            HasPreview = false;
        }
        finally
        {
            _isLoadingPreview = false;
            IsBusy = false;
        }
    }

    public async Task ProceedAsync()
    {
        if (!CanProceed())
        {
            StatusText = "Proceed requires a successful preview plus output directory, display name, input module ID, and kneeboard ID.";
            return;
        }

        IsBusy = true;
        StatusText = IsUiLayerImport ? "Importing authoritative UI Layer into DCS-Common…" : "Writing consumer repository…";
        try
        {
            if (IsUiLayerImport)
            {
                var result = _uiLayerImport.Import(CommonRoot, ProfilesDir, ModifiersPath, Devices, Rows);
                StatusText = $"UI Layer imported into DCS-Common: {result.ProfileCount} profiles, " +
                    $"{result.FunctionCount} functions ({result.NewFunctionCount} new), " +
                    $"{result.OverlayBindingCount} hardware overlay bindings updated, " +
                    $"{result.ExemptBindingCount} exempt bindings ignored.";
                return;
            }

            var instanceRoles = Devices
                .Where(device => !device.IsRepositoryOnly && !string.IsNullOrWhiteSpace(device.ProfileFile) && !string.IsNullOrWhiteSpace(device.Role))
                .ToDictionary(device => device.ProfileFile!, device => device.Role!.Trim(), StringComparer.OrdinalIgnoreCase);

            var (stdout, stderr, exitCode) = await _engine.RunWriteAsync(
                ProfilesDir,
                string.IsNullOrWhiteSpace(ModifiersPath) ? null : ModifiersPath,
                MozaGrip,
                instanceRoles,
                ModifierOverrides(),
                LabelOverrides(),
                string.IsNullOrWhiteSpace(CommonRoot) ? null : CommonRoot,
                OutputDir,
                DisplayName.Trim(),
                InputModuleId.Trim(),
                KneeboardId.Trim());

            StatusText = exitCode is 0 or 2
                ? $"Proceed finished (exit {exitCode}). See SCAFFOLD-REPORT.md under the output folder.{Environment.NewLine}{stdout}{Environment.NewLine}{stderr}".Trim()
                : $"Proceed failed (exit {exitCode}).{Environment.NewLine}{stderr}{Environment.NewLine}{stdout}".Trim();
        }
        catch (Exception ex)
        {
            StatusText = ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    public void ReplacePreviewRows(IEnumerable<PreviewRow> rows)
    {
        UntrackRows();
        Rows.Clear();
        foreach (var row in rows)
        {
            Rows.Add(row);
            row.PropertyChanged += PreviewRow_PropertyChanged;
        }
        RebuildCommandLabels();
    }

    private void RecomparePreview()
    {
        if (_isLoadingPreview || IsUiLayerImport || _comparisonSnapshot is null) return;
        _comparison.Apply(_comparisonSnapshot, Devices, Modifiers, Rows, CommandLabels);
    }

    public void RebuildCommandLabels()
    {
        var existing = CommandLabels.ToDictionary(group => group.Command, StringComparer.Ordinal);
        var commands = Rows
            .Select(row => row.Command)
            .Where(command => !string.IsNullOrWhiteSpace(command))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(command => command, StringComparer.Ordinal)
            .ToList();

        foreach (var removed in CommandLabels.Where(group => !commands.Contains(group.Command, StringComparer.Ordinal)).ToList())
            CommandLabels.Remove(removed);

        foreach (var command in commands)
        {
            if (!existing.TryGetValue(command!, out var group))
            {
                group = new CommandLabelGroup { Command = command! };
                CommandLabels.Add(group);
            }
            group.Refresh(Rows);
        }
    }

    public void ApplyCommandLabel(CommandLabelGroup group)
    {
        var matchingRows = Rows
            .Where(row => string.Equals(row.Command, group.Command, StringComparison.Ordinal))
            .ToList();
        var appliedLabel = group.Label;
        foreach (var row in matchingRows)
            row.ApplyLabel(appliedLabel, "command");

        group.Refresh(Rows);
        RecomparePreview();
        StatusText = $"Applied command label to {matchingRows.Count} bindings for {group.Command}.";
    }

    private void PreviewRow_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is not PreviewRow row ||
            (e.PropertyName != nameof(PreviewRow.Label) && e.PropertyName != nameof(PreviewRow.LabelSource)) ||
            string.IsNullOrWhiteSpace(row.Command)) return;

        var group = CommandLabels.FirstOrDefault(item =>
            string.Equals(item.Command, row.Command, StringComparison.Ordinal));
        group?.Refresh(Rows);
        RecomparePreview();
    }

    private void Modifier_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(PreviewModifier.SemanticModifier)) RecomparePreview();
    }

    private void Device_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(PreviewDevice.Role)) RecomparePreview();
    }

    private void UntrackRows()
    {
        foreach (var row in Rows) row.PropertyChanged -= PreviewRow_PropertyChanged;
        foreach (var device in Devices) device.PropertyChanged -= Device_PropertyChanged;
        foreach (var modifier in Modifiers) modifier.PropertyChanged -= Modifier_PropertyChanged;
    }

    public IReadOnlyDictionary<string, string> ModifierOverrides() => Modifiers
        .Where(modifier => !modifier.IsRepositoryOnly && !string.IsNullOrWhiteSpace(modifier.Name) && !string.IsNullOrWhiteSpace(modifier.SemanticModifier))
        .ToDictionary(modifier => modifier.Name!, modifier => modifier.SemanticModifier!.Trim(), StringComparer.OrdinalIgnoreCase);

    public IReadOnlyDictionary<string, string> LabelOverrides() => Rows
        .Where(row => !string.IsNullOrWhiteSpace(row.BindingId) && row.LabelSource != "dcs")
        .ToDictionary(row => row.BindingId!, row => row.Label ?? string.Empty, StringComparer.Ordinal);

    public CurrentLabelImportResult ImportCurrentLabels(PreviewDevice device)
    {
        var result = IsUiLayerImport
            ? _currentLabels.ApplyUiLayer(CommonRoot, device, Rows)
            : _currentLabels.Apply(OutputDir, device, Rows);
        var source = IsUiLayerImport ? "authoritative UI Layer" : "destination";
        StatusText = $"Current labels loaded for {device.Stem}: {result.CurrentCount} from {source}, " +
            $"{result.SharedHardwareCount} from DCS-Common shared hardware.";
        return result;
    }

    public int ResetDeviceLabelsToDefault(PreviewDevice device)
    {
        var selectedRows = Rows.Where(row =>
            string.Equals(row.ProfileKey, device.ProfileKey, StringComparison.OrdinalIgnoreCase) ||
            (!string.IsNullOrWhiteSpace(device.ProfileFile) &&
             string.Equals(row.ProfileFile, device.ProfileFile, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        foreach (var row in selectedRows) row.ResetToDefaultLabel();
        StatusText = $"Restored {selectedRows.Count} imported DCS labels for {device.Stem}.";
        return selectedRows.Count;
    }

    public async Task<IReadOnlyList<RenderedPreviewPage>> RenderDevicePreviewAsync(PreviewDevice device)
    {
        if (string.IsNullOrWhiteSpace(device.DeviceId) || string.IsNullOrWhiteSpace(device.ProfileKey))
            throw new InvalidOperationException("Preview requires a resolved, supported physical device instance.");

        var instanceRoles = Devices
            .Where(item => !item.IsRepositoryOnly && !string.IsNullOrWhiteSpace(item.ProfileFile) && !string.IsNullOrWhiteSpace(item.Role))
            .ToDictionary(item => item.ProfileFile!, item => item.Role!.Trim(), StringComparer.OrdinalIgnoreCase);
        return await _engine.RenderDevicePreviewAsync(
            ProfilesDir,
            string.IsNullOrWhiteSpace(ModifiersPath) ? null : ModifiersPath,
            MozaGrip,
            instanceRoles,
            ModifierOverrides(),
            LabelOverrides(),
            string.IsNullOrWhiteSpace(CommonRoot) ? null : CommonRoot,
            string.IsNullOrWhiteSpace(DisplayName) ? "Preview" : DisplayName.Trim(),
            string.IsNullOrWhiteSpace(InputModuleId) ? "UiLayer" : InputModuleId.Trim(),
            string.IsNullOrWhiteSpace(KneeboardId) ? "UiLayer" : KneeboardId.Trim(),
            device.ProfileKey);
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }
}

public sealed class RelayCommand : ICommand
{
    private readonly Func<Task> _executeAsync;
    private readonly Func<bool>? _canExecute;

    public RelayCommand(Func<Task> executeAsync, Func<bool>? canExecute = null)
    {
        _executeAsync = executeAsync;
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => _canExecute?.Invoke() ?? true;

    public async void Execute(object? parameter) => await _executeAsync();

    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}
