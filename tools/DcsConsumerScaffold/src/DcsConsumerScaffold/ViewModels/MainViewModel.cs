using System.IO;
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
    private int _previewErrorCount;
    private string _previewErrorText = string.Empty;
    private ScaffoldSolutionDecisions? _pendingSolutionDecisions;
    private string? _solutionPath;
    private string _solutionName = string.Empty;
    private bool _isSolutionDirty;
    private bool _suppressSolutionDirty;
    private readonly Dictionary<string, (string Raw, string Resolved)> _loadedSolutionPaths = new(StringComparer.Ordinal);

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

    public string? SolutionPath
    {
        get => _solutionPath;
        private set
        {
            if (Set(ref _solutionPath, value))
            {
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SolutionDisplay)));
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CanSaveSolution)));
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CanDeleteSolution)));
            }
        }
    }

    public string SolutionName
    {
        get => _solutionName;
        private set
        {
            if (Set(ref _solutionName, value))
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SolutionDisplay)));
        }
    }

    public string SolutionDisplay => string.IsNullOrWhiteSpace(SolutionPath)
        ? "Unsaved scaffolding solution"
        : $"{SolutionName} — {SolutionPath}{(IsSolutionDirty ? " *" : string.Empty)}";

    public bool IsSolutionDirty
    {
        get => _isSolutionDirty;
        private set
        {
            if (Set(ref _isSolutionDirty, value))
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SolutionDisplay)));
        }
    }

    public bool CanSaveSolution => !string.IsNullOrWhiteSpace(SolutionPath) && HasCompleteSolution;
    public bool CanSaveSolutionAs => HasCompleteSolution;
    public bool CanDeleteSolution => !string.IsNullOrWhiteSpace(SolutionPath);
    public bool HasCompleteSolution =>
        !string.IsNullOrWhiteSpace(ProfilesDir) &&
        (IsUiLayerImport
            ? !string.IsNullOrWhiteSpace(ModifiersPath) && !string.IsNullOrWhiteSpace(CommonRoot)
            : !string.IsNullOrWhiteSpace(OutputDir) &&
              !string.IsNullOrWhiteSpace(DisplayName) &&
              !string.IsNullOrWhiteSpace(InputModuleId) &&
              !string.IsNullOrWhiteSpace(KneeboardId));

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
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsConsumerImport)));
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ModifiersLabel)));
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CommonRootLabel)));
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsMozaConfigurationEnabled)));
                if (!IsUiLayerImport) ApplyProfileIdentityDefaults();
                RecomparePreview();
                MarkSolutionDirty();
            }
        }
    }

    public bool IsUiLayerImport => string.Equals(ImportTarget, "ui-layer", StringComparison.Ordinal);
    public bool IsConsumerImport => !IsUiLayerImport;
    public string ModifiersLabel => IsUiLayerImport ? "UI Layer modifiers.lua (required)" : "modifiers.lua (optional)";
    public string CommonRootLabel => IsUiLayerImport ? "DCS-Common root (required)" : "DCS-Common root (optional)";
    public bool IsMozaConfigurationEnabled => !HasPreview || Devices.Any(device =>
        string.Equals(device.MappingSource, "ui-selection", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(device.MappingSource, "standalone-fallback", StringComparison.OrdinalIgnoreCase));

    public string ProfilesDir
    {
        get => _profilesDir;
        set
        {
            if (Set(ref _profilesDir, value))
            {
                ApplyProfileIdentityDefaults();
                RaiseCommands();
                MarkSolutionDirty();
            }
        }
    }

    public string ModifiersPath
    {
        get => _modifiersPath;
        set { if (Set(ref _modifiersPath, value)) { RaiseCommands(); MarkSolutionDirty(); } }
    }

    public string MozaGrip
    {
        get => _mozaGrip;
        set { if (Set(ref _mozaGrip, value)) MarkSolutionDirty(); }
    }

    public string CommonRoot
    {
        get => _commonRoot;
        set { if (Set(ref _commonRoot, value)) { RaiseCommands(); MarkSolutionDirty(); } }
    }

    public string OutputDir
    {
        get => _outputDir;
        set
        {
            if (Set(ref _outputDir, value))
            {
                RaiseCommands();
                MarkSolutionDirty();
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
                MarkSolutionDirty();
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
                MarkSolutionDirty();
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
                MarkSolutionDirty();
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

    public string PreviewErrorText
    {
        get => _previewErrorText;
        private set => Set(ref _previewErrorText, value);
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
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsMozaConfigurationEnabled)));
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
        _previewErrorCount == 0 &&
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
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(HasCompleteSolution)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CanSaveSolution)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CanSaveSolutionAs)));
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
        _previewErrorCount = 0;
        PreviewErrorText = string.Empty;
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
            _previewErrorCount = document?.Errors?.Count ?? 0;
            PreviewErrorText = errorBlock;
            if (IsUiLayerImport) ApplyUiLayerObservedStates();
            RaiseCommands();
            StatusText = exitCode is 0 or 2
                ? $"Preview loaded (exit {exitCode}).{Environment.NewLine}{stdout}{Environment.NewLine}{errorBlock}".Trim()
                : $"Engine exit {exitCode}.{Environment.NewLine}{stderr}{Environment.NewLine}{stdout}{Environment.NewLine}{errorBlock}".Trim();
            if (existingLabels is not null &&
                existingLabels.CurrentCount + existingLabels.SharedHardwareCount > 0)
                StatusText = $"{StatusText}{Environment.NewLine}Loaded {existingLabels.CurrentCount} current repository labels; " +
                    $"used {existingLabels.SharedHardwareCount} shared-hardware fallbacks.";
            ApplyPendingSolutionDecisions();
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
                StatusText = $"UI Layer synchronized into DCS-Common: {result.ProfileCount} total profiles " +
                    $"({result.ObservedProfileCount} observed, {result.PreservedProfileCount} preserved while absent), " +
                    $"{result.PreservedModifierCount} modifiers preserved while absent, " +
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
                KneeboardId.Trim(),
                removedProfiles: Devices
                    .Where(device => device.IsRepositoryOnly && device.RemoveRequested && !string.IsNullOrWhiteSpace(device.ProfileKey))
                    .Select(device => device.ProfileKey!)
                    .ToArray(),
                mfdCategories: MfdCategoryOverrides());

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
        if (_isLoadingPreview) return;
        if (IsUiLayerImport)
        {
            ApplyUiLayerObservedStates();
            return;
        }
        if (_comparisonSnapshot is null) return;
        _comparison.Apply(_comparisonSnapshot, Devices, Modifiers, Rows, CommandLabels);
    }

    private void ApplyUiLayerObservedStates()
    {
        const string reason = "Observed in the selected authoritative UI Layer source.";
        foreach (var device in Devices) { device.ChangeState = PreviewChangeState.Observed; device.ChangeReason = reason; }
        foreach (var modifier in Modifiers) { modifier.ChangeState = PreviewChangeState.Observed; modifier.ChangeReason = reason; }
        foreach (var row in Rows) { row.ChangeState = PreviewChangeState.Observed; row.ChangeReason = reason; }
        foreach (var group in CommandLabels) { group.ChangeState = PreviewChangeState.Observed; group.ChangeReason = reason; }
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
        MarkSolutionDirty();
    }

    private void Modifier_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(PreviewModifier.SemanticModifier)) { RecomparePreview(); MarkSolutionDirty(); }
    }

    private void Device_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(PreviewDevice.Role) or nameof(PreviewDevice.CategoryTop) or
            nameof(PreviewDevice.CategoryRight) or nameof(PreviewDevice.CategoryBottom) or
            nameof(PreviewDevice.CategoryLeft) or nameof(PreviewDevice.RemoveRequested))
        {
            RecomparePreview();
            MarkSolutionDirty();
        }
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
        .Where(row => !string.IsNullOrWhiteSpace(row.BindingId) &&
            !string.Equals(row.Label, row.DefaultLabel, StringComparison.Ordinal))
        .ToDictionary(row => row.BindingId!, row => row.Label ?? string.Empty, StringComparer.Ordinal);

    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> MfdCategoryOverrides() => Devices
        .Where(device => !device.IsRepositoryOnly && device.IsMfdDevice && !string.IsNullOrWhiteSpace(device.ProfileKey))
        .ToDictionary(
            device => device.ProfileKey!,
            device => device.MfdCategoryLabels(),
            StringComparer.OrdinalIgnoreCase);

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
            device.ProfileKey,
            MfdCategoryOverrides(),
            includeUiLayer: !IsUiLayerImport);
    }


    public ScaffoldSolutionDocument CaptureSolution()
    {
        var decisions = new ScaffoldSolutionDecisions();
        if (_pendingSolutionDecisions is not null)
        {
            foreach (var item in _pendingSolutionDecisions.InstanceRoles) decisions.InstanceRoles[item.Key] = item.Value;
            foreach (var item in _pendingSolutionDecisions.SemanticModifiers) decisions.SemanticModifiers[item.Key] = item.Value;
            foreach (var item in _pendingSolutionDecisions.LabelOverrides) decisions.LabelOverrides[item.Key] = item.Value;
            foreach (var item in _pendingSolutionDecisions.MfdCategories) decisions.MfdCategories[item.Key] = item.Value;
            foreach (var item in _pendingSolutionDecisions.RemovedProfiles) decisions.RemovedProfiles.Add(item);
        }

        foreach (var device in Devices.Where(item => !item.IsRepositoryOnly && !string.IsNullOrWhiteSpace(item.ProfileFile) && !string.IsNullOrWhiteSpace(item.Role)))
            decisions.InstanceRoles[device.ProfileFile!] = device.Role!.Trim();
        foreach (var modifier in ModifierOverrides()) decisions.SemanticModifiers[modifier.Key] = modifier.Value;
        foreach (var label in LabelOverrides()) decisions.LabelOverrides[label.Key] = label.Value;
        foreach (var device in Devices.Where(item => !item.IsRepositoryOnly && item.IsMfdDevice && !string.IsNullOrWhiteSpace(item.ProfileKey)))
            decisions.MfdCategories[device.ProfileKey!] = new ScaffoldMfdCategories
            {
                Top = device.CategoryTop,
                Right = device.CategoryRight,
                Bottom = device.CategoryBottom,
                Left = device.CategoryLeft,
            };
        foreach (var device in Devices.Where(item => item.IsRepositoryOnly && item.RemoveRequested && !string.IsNullOrWhiteSpace(item.ProfileKey)))
            decisions.RemovedProfiles.Add(device.ProfileKey!);

        return new ScaffoldSolutionDocument
        {
            Name = string.IsNullOrWhiteSpace(SolutionName) ? DisplayName : SolutionName,
            Import = new ScaffoldSolutionImport
            {
                Target = ImportTarget,
                ProfilesDirectory = PersistedPath(nameof(ProfilesDir), ProfilesDir)!,
                ModifiersPath = PersistedPath(nameof(ModifiersPath), ModifiersPath),
                MozaGrip = MozaGrip,
                CommonRoot = PersistedPath(nameof(CommonRoot), CommonRoot),
                OutputDirectory = PersistedPath(nameof(OutputDir), OutputDir),
                DisplayName = NullIfBlank(DisplayName),
                InputModuleId = NullIfBlank(InputModuleId),
                KneeboardId = NullIfBlank(KneeboardId),
            },
            Decisions = decisions,
        };
    }

    public void LoadSolution(ScaffoldSolutionDocument document, string path)
    {
        ScaffoldSolutionService.Validate(document);
        _suppressSolutionDirty = true;
        try
        {
            ImportTarget = document.Import.Target;
            _loadedSolutionPaths.Clear();
            ProfilesDir = LoadPath(nameof(ProfilesDir), document.Import.ProfilesDirectory, path);
            ModifiersPath = LoadPath(nameof(ModifiersPath), document.Import.ModifiersPath, path);
            MozaGrip = document.Import.MozaGrip;
            CommonRoot = LoadPath(nameof(CommonRoot), document.Import.CommonRoot, path);
            OutputDir = LoadPath(nameof(OutputDir), document.Import.OutputDirectory, path);
            DisplayName = document.Import.DisplayName ?? string.Empty;
            InputModuleId = document.Import.InputModuleId ?? string.Empty;
            KneeboardId = document.Import.KneeboardId ?? string.Empty;
            _pendingSolutionDecisions = document.Decisions ?? new ScaffoldSolutionDecisions();
            UntrackRows();
            Devices.Clear();
            Rows.Clear();
            Modifiers.Clear();
            CommandLabels.Clear();
            HasPreview = false;
            SummaryText = string.Empty;
            PreviewErrorText = string.Empty;
            SolutionName = string.IsNullOrWhiteSpace(document.Name)
                ? Path.GetFileNameWithoutExtension(path)
                : document.Name;
            SolutionPath = Path.GetFullPath(path);
            IsSolutionDirty = false;
            StatusText = $"Loaded scaffolding solution '{SolutionName}'. Select Load Preview to reconcile its saved decisions.";
        }
        finally
        {
            _suppressSolutionDirty = false;
        }
    }

    public void MarkSolutionSaved(string path)
    {
        SolutionPath = Path.GetFullPath(path);
        if (string.IsNullOrWhiteSpace(SolutionName))
            SolutionName = Path.GetFileNameWithoutExtension(path);
        IsSolutionDirty = false;
    }

    public void MarkSolutionDeleted()
    {
        SolutionPath = null;
        IsSolutionDirty = true;
        StatusText = "Solution file deleted. The current workspace is retained as unsaved.";
    }

    private void ApplyPendingSolutionDecisions()
    {
        if (_pendingSolutionDecisions is null) return;
        var restored = 0;
        restored += ApplyMap(_pendingSolutionDecisions.InstanceRoles, key =>
            Devices.Where(device => !device.IsRepositoryOnly && string.Equals(device.ProfileFile, key, StringComparison.OrdinalIgnoreCase)).ToList(),
            (device, value) => device.Role = value);
        restored += ApplyMap(_pendingSolutionDecisions.SemanticModifiers, key =>
            Modifiers.Where(modifier => !modifier.IsRepositoryOnly && string.Equals(modifier.Name, key, StringComparison.OrdinalIgnoreCase)).ToList(),
            (modifier, value) => modifier.SemanticModifier = value);
        restored += ApplyMap(_pendingSolutionDecisions.LabelOverrides, key =>
            Rows.Where(row => string.Equals(row.BindingId, key, StringComparison.Ordinal)).ToList(),
            (row, value) => row.ApplyLabel(value, "solution"));
        restored += ApplyMap(_pendingSolutionDecisions.MfdCategories, key =>
            Devices.Where(device => !device.IsRepositoryOnly && device.IsMfdDevice &&
                string.Equals(device.ProfileKey, key, StringComparison.OrdinalIgnoreCase)).ToList(),
            (device, value) =>
            {
                device.CategoryTop = value.Top;
                device.CategoryRight = value.Right;
                device.CategoryBottom = value.Bottom;
                device.CategoryLeft = value.Left;
            });

        foreach (var key in _pendingSolutionDecisions.RemovedProfiles.ToList())
        {
            var matches = Devices.Where(device => device.IsRepositoryOnly &&
                string.Equals(device.ProfileKey, key, StringComparison.OrdinalIgnoreCase)).ToList();
            if (matches.Count != 1) continue;
            matches[0].RemoveRequested = true;
            _pendingSolutionDecisions.RemovedProfiles.Remove(key);
            restored++;
        }

        RebuildCommandLabels();
        var unmatched = _pendingSolutionDecisions.InstanceRoles.Count +
            _pendingSolutionDecisions.SemanticModifiers.Count +
            _pendingSolutionDecisions.LabelOverrides.Count +
            _pendingSolutionDecisions.MfdCategories.Count +
            _pendingSolutionDecisions.RemovedProfiles.Count;
        IsSolutionDirty = false;
        StatusText += $"{Environment.NewLine}Restored {restored} saved decisions; {unmatched} no longer match the current preview.";
    }

    private int ApplyMap<TItem, TValue>(
        IDictionary<string, TValue> pending,
        Func<string, List<TItem>> find,
        Action<TItem, TValue> apply)
    {
        var restored = 0;
        _suppressSolutionDirty = true;
        try
        {
            foreach (var item in pending.ToList())
            {
                var matches = find(item.Key);
                if (matches.Count != 1) continue;
                apply(matches[0], item.Value);
                pending.Remove(item.Key);
                restored++;
            }
        }
        finally
        {
            _suppressSolutionDirty = false;
        }
        return restored;
    }

    private void MarkSolutionDirty()
    {
        if (_suppressSolutionDirty) return;
        IsSolutionDirty = true;
    }

    private string LoadPath(string propertyName, string? value, string solutionPath)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var resolved = ScaffoldSolutionService.ResolvePath(value, solutionPath);
        _loadedSolutionPaths[propertyName] = (value, resolved);
        return resolved;
    }

    private string? PersistedPath(string propertyName, string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return _loadedSolutionPaths.TryGetValue(propertyName, out var loaded) &&
               string.Equals(value, loaded.Resolved, StringComparison.OrdinalIgnoreCase)
            ? loaded.Raw
            : value;
    }

    private static string? NullIfBlank(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

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
