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
    private readonly DcsCommandCatalogService _commandCatalogService;
    private readonly DcsHtmlCommandCatalogProvider _htmlCommandCatalogProvider;
    private readonly UiLayerProjectionService _uiLayerProjection;
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
    private DcsCommandCatalogDocument? _commandCatalog;
    private string? _commandCatalogPath;
    private string _commandSearch = string.Empty;
    private string _selectedCommandCategory = "All";
    private string _selectedCommandType = "All";
    private string _selectedCommandBindingState = "All";
    private string _selectedTargetBindingState = "All";
    private string _selectedTargetChord = "All chords";
    private DcsCommandCatalogEntry? _selectedCatalogCommand;
    private PreviewRow? _selectedPreviewRow;
    private readonly Dictionary<PreviewRow, PreviewRow> _assignmentOriginals = [];
    private readonly HashSet<PreviewRow> _emptyControls = [];
    private readonly Dictionary<PreviewRow, List<PreviewRow>> _displacedRows = [];
    private readonly Dictionary<string, IReadOnlyList<UiLayerProjection>> _uiLayerProjectionCache =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string?> _uiLayerModifierCache = new(StringComparer.Ordinal);
    private string _selectedCommandAvailability = "All";
    public string SelectedCommandAvailability
    {
        get => _selectedCommandAvailability;
        set { if (Set(ref _selectedCommandAvailability, value)) RefreshCommandFilter(); }
    }
    public IReadOnlyList<string> CommandAvailabilities { get; } = ["All", "Assignable", "Search only"];

    public MainViewModel(
        ScaffoldEngineService? engine = null,
        CurrentLabelService? currentLabels = null,
        UiLayerImportService? uiLayerImport = null,
        PreviewComparisonService? comparison = null,
        DcsCommandCatalogService? commandCatalogService = null,
        DcsHtmlCommandCatalogProvider? htmlCommandCatalogProvider = null)
    {
        _engine = engine ?? new ScaffoldEngineService();
        _currentLabels = currentLabels ?? new CurrentLabelService();
        _uiLayerImport = uiLayerImport ?? new UiLayerImportService();
        _comparison = comparison ?? new PreviewComparisonService();
        _commandCatalogService = commandCatalogService ?? new DcsCommandCatalogService();
        _htmlCommandCatalogProvider = htmlCommandCatalogProvider ?? new DcsHtmlCommandCatalogProvider();
        _uiLayerProjection = new UiLayerProjectionService();
        LoadPreviewCommand = new RelayCommand(async () => await LoadPreviewAsync(), CanLoadPreview);
        ProceedCommand = new RelayCommand(async () => await ProceedAsync(), CanProceed);
        Devices = new ObservableCollection<PreviewDevice>();
        Rows = new ObservableCollection<PreviewRow>();
        AssignmentTargets = new ObservableCollection<PreviewRow>();
        Modifiers = new ObservableCollection<PreviewModifier>();
        CommandLabels = new ObservableCollection<CommandLabelGroup>();
        CommandCatalog = new ObservableCollection<DcsCommandCatalogEntry>();
        FilteredCommands = new ObservableCollection<DcsCommandCatalogEntry>();
        FilteredPreviewRows = new ObservableCollection<PreviewRow>();
        CommandCategories = new ObservableCollection<string> { "All" };
        CommandTypes = new ObservableCollection<string> { "All", "button", "axis" };
        CommandBindingStates = new ObservableCollection<string> { "All", "Bound", "Unbound" };
        TargetBindingStates = new ObservableCollection<string> { "All", "Bound", "Unbound" };
        TargetChords = new ObservableCollection<string> { "All chords", "No chord" };
        PendingAssignments = new ObservableCollection<DcsCommandAssignment>();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<PreviewDevice> Devices { get; }
    public ObservableCollection<PreviewRow> Rows { get; }
    public ObservableCollection<PreviewRow> AssignmentTargets { get; }
    public ObservableCollection<PreviewModifier> Modifiers { get; }
    public ObservableCollection<CommandLabelGroup> CommandLabels { get; }
    public ObservableCollection<DcsCommandCatalogEntry> CommandCatalog { get; }
    public ObservableCollection<DcsCommandCatalogEntry> FilteredCommands { get; }
    public ObservableCollection<PreviewRow> FilteredPreviewRows { get; }
    public ObservableCollection<string> CommandCategories { get; }
    public ObservableCollection<string> CommandTypes { get; }
    public ObservableCollection<string> CommandBindingStates { get; }
    public ObservableCollection<string> TargetBindingStates { get; }
    public ObservableCollection<string> TargetChords { get; }
    public ObservableCollection<DcsCommandAssignment> PendingAssignments { get; }

    public DcsCommandCatalogEntry? SelectedCatalogCommand
    {
        get => _selectedCatalogCommand;
        set
        {
            if (!Set(ref _selectedCatalogCommand, value)) return;
            RefreshTargetFilter();
            RaiseAssignmentState();
        }
    }

    public PreviewRow? SelectedPreviewRow
    {
        get => _selectedPreviewRow;
        set { if (Set(ref _selectedPreviewRow, value)) RaiseAssignmentState(); }
    }

    public bool CanAssignSelectedCommand =>
        !IsUiLayerImport &&
        SelectedCatalogCommand is { IsAssignable: true } command &&
        SelectedPreviewRow is { } row &&
        UiLayerConflictFor(row) is null &&
        !string.Equals(command.BindingKey, row.Command, StringComparison.Ordinal) &&
        !string.IsNullOrWhiteSpace(row.ProfileFile) &&
        !string.IsNullOrWhiteSpace(row.Section) &&
        !string.IsNullOrWhiteSpace(row.Key) &&
        ((command.Type == "axis" && row.Section == "axisDiffs") ||
         (command.Type == "button" && row.Section == "keyDiffs"));

    public string SelectedCommandSummary => SelectedCatalogCommand is null
        ? "No command selected"
        : $"{SelectedCatalogCommand.Name} ({SelectedCatalogCommand.Type}, {SelectedCatalogCommand.Availability})";

    public string SelectedControlSummary => SelectedPreviewRow is null
        ? "No physical control selected"
        : $"{SelectedPreviewRow.Stem} • {SelectedPreviewRow.Key}{(string.IsNullOrWhiteSpace(SelectedPreviewRow.Chord) ? string.Empty : $" + {SelectedPreviewRow.Chord}")}";

    public string AssignmentGuidance
    {
        get
        {
            if (_commandCatalog is null && SelectedCatalogCommand is null) return "Load a command catalog to begin.";
            if (SelectedCatalogCommand is null) return "Step 1: select a command on the left.";
            if (!SelectedCatalogCommand.IsAssignable) return "This command is search-only. Select an assignable command.";
            if (SelectedPreviewRow is null) return "Step 2: select a physical control on the right.";
            if (string.Equals(SelectedCatalogCommand.BindingKey, SelectedPreviewRow.Command, StringComparison.Ordinal))
                return "This command is already assigned to the selected control.";
            if (UiLayerConflictFor(SelectedPreviewRow) is { } ui)
                return $"Reserved by the applicable UI Layer: {ui.Label} ({ui.Modifier}). Choose another control or modifier chord.";
            if (!CanAssignSelectedCommand)
                return $"Select {(SelectedCatalogCommand.Type == "axis" ? "an" : "a")} {SelectedCatalogCommand.Type} control to match this command.";
            return "Ready. Stage the replacement, then choose Proceed to write it.";
        }
    }

    public string PendingAssignmentSummary => PendingAssignments.Count == 0
        ? "No pending command assignments"
        : $"{PendingAssignments.Count} pending command assignment(s)";

    public string SelectedTargetBindingState
    {
        get => _selectedTargetBindingState;
        set { if (Set(ref _selectedTargetBindingState, value)) RefreshTargetFilter(); }
    }

    public string SelectedTargetChord
    {
        get => _selectedTargetChord;
        set { if (Set(ref _selectedTargetChord, value)) RefreshTargetFilter(); }
    }

    public string TargetResultSummary => $"Showing {FilteredPreviewRows.Count} of {AssignmentTargets.Count}";

    public string? CommandCatalogPath
    {
        get => _commandCatalogPath;
        private set => Set(ref _commandCatalogPath, value);
    }

    public string CommandCatalogStatus => _commandCatalog is null
        ? "No command catalog loaded. Import a schemaVersion 1 catalog after Load Preview."
        : $"{_commandCatalog.ModuleId} • {CommandCatalog.Count} commands • DCS {_commandCatalog.DcsVersion ?? "unknown"} • {_commandCatalog.Locale ?? "default locale"}";

    public string CommandResultSummary => _commandCatalog is null
        ? string.Empty
        : $"Showing {FilteredCommands.Count} of {CommandCatalog.Count}";

    public string CommandSearch
    {
        get => _commandSearch;
        set { if (Set(ref _commandSearch, value)) RefreshCommandFilter(); }
    }

    public string SelectedCommandCategory
    {
        get => _selectedCommandCategory;
        set { if (Set(ref _selectedCommandCategory, value)) RefreshCommandFilter(); }
    }

    public string SelectedCommandType
    {
        get => _selectedCommandType;
        set { if (Set(ref _selectedCommandType, value)) RefreshCommandFilter(); }
    }

    public string SelectedCommandBindingState
    {
        get => _selectedCommandBindingState;
        set { if (Set(ref _selectedCommandBindingState, value)) RefreshCommandFilter(); }
    }

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
        !HasUiLayerConflicts &&
        !string.IsNullOrWhiteSpace(ProfilesDir) &&
        (IsUiLayerImport
            ? !string.IsNullOrWhiteSpace(CommonRoot) && !string.IsNullOrWhiteSpace(ModifiersPath)
            : !string.IsNullOrWhiteSpace(OutputDir) &&
              !string.IsNullOrWhiteSpace(DisplayName) &&
              !string.IsNullOrWhiteSpace(InputModuleId) &&
              !string.IsNullOrWhiteSpace(KneeboardId));

    public bool HasUiLayerConflicts => !IsUiLayerImport && Rows.Any(row =>
        !string.IsNullOrWhiteSpace(row.Command) && UiLayerConflictFor(row) is not null);

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
        Devices.Clear();
        UntrackRows();
        Rows.Clear();
        AssignmentTargets.Clear();
        RebuildTargetChords();
        RefreshTargetFilter();
        PendingAssignments.Clear();
        _assignmentOriginals.Clear();
        _emptyControls.Clear();
        _displacedRows.Clear();
        _uiLayerProjectionCache.Clear();
        _uiLayerModifierCache.Clear();
        SelectedPreviewRow = null;
        SelectedCatalogCommand = null;
        RaiseAssignmentState();
        CommandLabels.Clear();
        ClearCommandCatalog();
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
                labels: null,
                repositoryProfilesDir: ExistingRepositoryProfilesDirectory());

            if (document?.Devices != null)
            {
                foreach (var device in document.Devices)
                {
                    Devices.Add(device);
                    device.PropertyChanged += Device_PropertyChanged;
                }
            }

            if (document?.Rows != null)
                ReplacePreviewRows(document.Rows, document.AvailableControls);

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
                existingLabels.CurrentCount + existingLabels.SharedHardwareCount + existingLabels.DcsDefaultCount > 0)
                StatusText = $"{StatusText}{Environment.NewLine}Loaded {existingLabels.CurrentCount} current repository labels; " +
                    $"used DCS command labels for {existingLabels.DcsDefaultCount} reassigned controls; " +
                    $"used {existingLabels.SharedHardwareCount} shared-hardware fallbacks for new controls.";
            var uiLayerConflictCount = Rows.Count(row =>
                !string.IsNullOrWhiteSpace(row.Command) && UiLayerConflictFor(row) is not null);
            if (uiLayerConflictCount > 0)
                StatusText = $"{StatusText}{Environment.NewLine}{uiLayerConflictCount} module assignment(s) conflict with the applicable UI Layer. " +
                    "Conflicting assignments are orange-red in the visual editor and must be cleared or moved before Proceed.";
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

    private string? ExistingRepositoryProfilesDirectory()
    {
        if (IsUiLayerImport || string.IsNullOrWhiteSpace(OutputDir) || string.IsNullOrWhiteSpace(InputModuleId)) return null;
        var path = Path.Combine(OutputDir, "src", "Config", "Input", InputModuleId.Trim(), "joystick");
        return Directory.Exists(path) ? path : null;
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
                mfdCategories: MfdCategoryOverrides(),
                pagePresentations: PagePresentationOverrides(),
                assignments: PendingAssignments.ToArray(),
                repositoryProfilesDir: ExistingRepositoryProfilesDirectory());

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

    public void ReplacePreviewRows(IEnumerable<PreviewRow> rows, IEnumerable<PreviewRow>? availableControls = null)
    {
        UntrackRows();
        Rows.Clear();
        AssignmentTargets.Clear();
        foreach (var row in rows)
        {
            Rows.Add(row);
            AssignmentTargets.Add(row);
            row.PropertyChanged += PreviewRow_PropertyChanged;
        }
        foreach (var row in availableControls ?? []) AssignmentTargets.Add(row);
        RebuildCommandLabels();
        RebuildTargetChords();
        RefreshTargetFilter();
        RefreshCommandBindingState();
        RaiseAssignmentState();
    }

    public DcsCommandAssignment AssignSelectedCommand()
    {
        if (!CanAssignSelectedCommand)
            throw new InvalidOperationException(AssignmentGuidance);

        var command = SelectedCatalogCommand!;
        var row = SelectedPreviewRow!;
        RememberOriginal(row);
        DisplaceConflicts(row);
        var assignment = new DcsCommandAssignment
        {
            ProfileFile = row.ProfileFile!,
            Section = row.Section!,
            Key = row.Key!,
            Reformers = [.. row.Reformers.OrderBy(value => value, StringComparer.Ordinal)],
            Command = command.BindingKey,
            Name = command.Name,
            AllowCreate = _emptyControls.Contains(row) || row.IsUnboundCandidate || PendingFor(row)?.AllowCreate == true,
        };
        var existing = PendingAssignments.FirstOrDefault(item =>
            item.ProfileFile.Equals(assignment.ProfileFile, StringComparison.OrdinalIgnoreCase) &&
            item.Section == assignment.Section && item.Key == assignment.Key &&
            item.Reformers.SequenceEqual(assignment.Reformers, StringComparer.Ordinal));
        if (existing is not null) PendingAssignments.Remove(existing);
        PendingAssignments.Add(assignment);
        row.ApplyCommandAssignment(command.BindingKey, command.Name);
        if (!Rows.Contains(row))
        {
            Rows.Add(row);
            if (!AssignmentTargets.Contains(row)) AssignmentTargets.Add(row);
            row.PropertyChanged += PreviewRow_PropertyChanged;
        }
        RebuildCommandLabels();
        RefreshCommandBindingState();
        RefreshTargetFilter();
        MarkSolutionDirty();
        RaiseAssignmentState();
        StatusText = $"Pending: {row.Stem} {row.Key}{(string.IsNullOrWhiteSpace(row.Chord) ? string.Empty : $" + {row.Chord}")} → {command.Name}. Proceed will write the assignment.";
        return assignment;
    }

    private void RaiseAssignmentState()
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CanAssignSelectedCommand)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(PendingAssignmentSummary)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SelectedCommandSummary)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SelectedControlSummary)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(AssignmentGuidance)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(HasUiLayerConflicts)));
        ProceedCommand.RaiseCanExecuteChanged();
    }

    public Task<InteractiveDevice> LoadInteractiveDeviceAsync(PreviewDevice device) =>
        _engine.LoadInteractiveDeviceAsync(CommonRoot, device.DeviceId!);

    public IReadOnlyList<UiLayerProjection> UiLayerProjectionsFor(PreviewDevice device)
    {
        if (IsUiLayerImport || string.IsNullOrWhiteSpace(CommonRoot)) return [];
        var key = device.ProfileFile ?? $"{device.DeviceId}\0{device.InstanceHint}";
        if (!_uiLayerProjectionCache.TryGetValue(key, out var projections))
        {
            projections = _uiLayerProjection.Load(CommonRoot, device, Devices);
            _uiLayerProjectionCache[key] = projections;
        }
        return projections;
    }

    public UiLayerProjection? UiLayerConflictFor(
        PreviewRow row,
        IReadOnlyList<UiLayerProjection>? projections = null)
    {
        if (IsUiLayerImport || string.IsNullOrWhiteSpace(CommonRoot)) return null;
        var device = Devices.FirstOrDefault(item =>
            string.Equals(item.ProfileFile, row.ProfileFile, StringComparison.OrdinalIgnoreCase));
        if (device is null || row.Reformers.Count != 1) return null;
        var modifier = Modifiers.FirstOrDefault(item =>
            string.Equals(item.Name, row.Reformers[0], StringComparison.Ordinal));
        var effectiveModifier = modifier?.Name;
        var modifierDeviceId = modifier?.DeviceId;
        if (!string.IsNullOrWhiteSpace(modifierDeviceId))
        {
            if (!_uiLayerModifierCache.TryGetValue(modifierDeviceId, out effectiveModifier))
            {
                effectiveModifier = _uiLayerProjection.ResolveModifier(CommonRoot, modifierDeviceId) ?? modifier?.Name;
                _uiLayerModifierCache[modifierDeviceId] = effectiveModifier;
            }
        }
        return _uiLayerProjection.FindConflict(
            row, effectiveModifier, projections ?? UiLayerProjectionsFor(device));
    }

    public PreviewRow GetInteractiveRow(PreviewDevice device, InteractiveControl control, IReadOnlyList<string> reformers)
    {
        var section = control.Type == "axis" ? "axisDiffs" : "keyDiffs";
        var chord = string.Join('+', reformers.OrderBy(value => value, StringComparer.Ordinal));
        var existing = AssignmentTargets.FirstOrDefault(row => string.Equals(row.ProfileFile, device.ProfileFile, StringComparison.OrdinalIgnoreCase) &&
            (row.Key == control.Key || row.CalloutId == control.Id) && row.Section == section && string.Join('+', row.Reformers.OrderBy(value => value, StringComparer.Ordinal)) == chord);
        if (existing is not null)
        {
            if (existing.IsUnboundCandidate) _emptyControls.Add(existing);
            return existing;
        }
        var row = new PreviewRow
        {
            ProfileFile = device.ProfileFile, Stem = device.Stem, DeviceId = device.DeviceId,
            ProfileKey = device.ProfileKey, PhysicalInstance = device.PhysicalInstance,
            Key = control.Key, Section = section, Reformers = [.. reformers], Chord = chord,
            SemanticChord = string.Join('+', reformers.Select(name => Modifiers.FirstOrDefault(modifier => modifier.Name == name)?.SemanticModifier ?? name).OrderBy(value => value, StringComparer.Ordinal)),
            CalloutId = control.Id, DeviceLabel = control.HardwareLabel, Command = "", Name = "", DefaultLabel = "", Label = "", Status = "Unbound", IsUnboundCandidate = true,
        };
        _emptyControls.Add(row);
        AssignmentTargets.Add(row);
        RebuildTargetChords();
        RefreshTargetFilter();
        return row;
    }

    public string[] CreateInteractiveChord(IEnumerable<string> names)
    {
        var chord = names.Distinct(StringComparer.Ordinal).OrderBy(name => name, StringComparer.Ordinal).ToArray();
        if (chord.Length == 0) throw new InvalidOperationException("Select at least one modifier for the chord.");
        if (chord.Any(name => !Modifiers.Any(modifier => !modifier.IsRepositoryOnly && modifier.Name == name)))
            throw new InvalidOperationException("Choose modifiers from the imported modifiers.lua file.");
        return chord;
    }

    private void RememberOriginal(PreviewRow row)
    {
        if (!_assignmentOriginals.ContainsKey(row))
        {
            var original = System.Text.Json.JsonSerializer.Deserialize<PreviewRow>(System.Text.Json.JsonSerializer.Serialize(row))!;
            original.ChangeState = row.ChangeState;
            original.ChangeReason = row.ChangeReason;
            _assignmentOriginals[row] = original;
        }
    }

    private void DisplaceConflicts(PreviewRow row)
    {
        var duplicates = Rows.Where(item => item != row && item.ProfileFile == row.ProfileFile && item.Section == row.Section && item.Key == row.Key &&
            item.Reformers.OrderBy(value => value, StringComparer.Ordinal).SequenceEqual(row.Reformers.OrderBy(value => value, StringComparer.Ordinal))).ToList();
        if (duplicates.Count == 0) return;
        if (!_displacedRows.TryGetValue(row, out var displaced)) _displacedRows[row] = displaced = [];
        foreach (var duplicate in duplicates) { Rows.Remove(duplicate); AssignmentTargets.Remove(duplicate); displaced.Add(duplicate); }
    }

    public DcsCommandAssignment? PendingFor(PreviewRow row) => PendingAssignments.FirstOrDefault(item =>
        string.Equals(item.ProfileFile, row.ProfileFile, StringComparison.OrdinalIgnoreCase) && item.Section == row.Section && item.Key == row.Key &&
        item.Reformers.OrderBy(value => value, StringComparer.Ordinal).SequenceEqual(row.Reformers.OrderBy(value => value, StringComparer.Ordinal)));

    public string OriginalCommandName(PreviewRow row) => _assignmentOriginals.TryGetValue(row, out var original) ? original.Name ?? "" : row.Name ?? "";

    public bool HasConflict(PreviewRow row) => Rows.Count(item => item.ProfileFile == row.ProfileFile && item.Section == row.Section && item.Key == row.Key &&
        item.Reformers.OrderBy(value => value, StringComparer.Ordinal).SequenceEqual(row.Reformers.OrderBy(value => value, StringComparer.Ordinal)) && !string.IsNullOrEmpty(item.Command)) > 1;

    public void ClearAssignment(PreviewRow row)
    {
        if (_emptyControls.Contains(row) || PendingFor(row)?.AllowCreate == true) { UndoAssignment(row); return; }
        RememberOriginal(row);
        DisplaceConflicts(row);
        var pending = PendingFor(row);
        if (pending is not null) PendingAssignments.Remove(pending);
        PendingAssignments.Add(new DcsCommandAssignment { ProfileFile = row.ProfileFile!, Section = row.Section!, Key = row.Key!, Reformers = [.. row.Reformers], Clear = true });
        row.ApplyCommandAssignment("", "");
        AssignmentChanged();
    }

    public void UndoAssignment(PreviewRow row)
    {
        if (_displacedRows.Remove(row, out var displaced)) foreach (var originalRow in displaced) { Rows.Add(originalRow); AssignmentTargets.Add(originalRow); }
        var pending = PendingFor(row);
        if (pending is not null) PendingAssignments.Remove(pending);
        if (_assignmentOriginals.Remove(row, out var original))
        {
            row.ApplyCommandAssignment(original.Command ?? "", original.Name ?? "");
            row.DefaultLabel = original.DefaultLabel;
            row.BindingId = original.BindingId;
            row.IsUnboundCandidate = original.IsUnboundCandidate;
            row.ApplyLabel(original.Label, original.LabelSource ?? "dcs");
            row.ChangeState = original.ChangeState;
            row.ChangeReason = original.ChangeReason;
            if (original.IsUnboundCandidate) { Rows.Remove(row); row.PropertyChanged -= PreviewRow_PropertyChanged; }
        }
        AssignmentChanged();
    }

    private void AssignmentChanged()
    {
        RebuildCommandLabels();
        RefreshCommandBindingState();
        RefreshTargetFilter();
        MarkSolutionDirty();
        RaiseAssignmentState();
    }

    public void LoadCommandCatalog(string path)
    {
        if (!HasPreview)
            throw new InvalidOperationException("Load a module preview before importing its DCS command catalog.");

        var document = _commandCatalogService.Load(path, InputModuleId);
        ApplyCommandCatalog(document, Path.GetFullPath(path));
        StatusText = $"Loaded {CommandCatalog.Count} commands for {document.ModuleId} from {Path.GetFileName(path)}.";
    }

    public void LoadDcsHtmlCommandCatalog(IEnumerable<string> htmlPaths)
    {
        if (!HasPreview)
            throw new InvalidOperationException("Load a module preview before loading DCS Controls HTML exports.");

        var paths = htmlPaths.ToList();
        var result = _htmlCommandCatalogProvider.Build(paths, InputModuleId);
        ApplyCommandCatalog(result.Document, string.Join(";", paths.Select(Path.GetFullPath)));
        StatusText = $"Loaded {CommandCatalog.Count} commands and {result.EffectiveAssignmentCount} effective assignments " +
                     $"from {result.FileCount} DCS HTML exports; reconciled {result.DuplicateCommandCount} repeated command rows.";
    }

    public void SaveCommandCatalog(string path)
    {
        if (_commandCatalog is null) throw new InvalidOperationException("Load a DCS command catalog before saving it.");
        _commandCatalogService.Save(path, _commandCatalog);
        StatusText = $"Saved {CommandCatalog.Count} commands for {_commandCatalog.ModuleId} to {Path.GetFileName(path)}.";
    }

    private void ApplyCommandCatalog(DcsCommandCatalogDocument document, string sourcePath)
    {
        _commandCatalog = document;
        CommandCatalogPath = sourcePath;
        CommandCatalog.Clear();
        foreach (var command in document.Commands) CommandCatalog.Add(command);

        CommandCategories.Clear();
        CommandCategories.Add("All");
        foreach (var category in CommandCatalog.Select(command => command.Category)
                     .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
            CommandCategories.Add(category);

        SelectedCommandCategory = "All";
        SelectedCommandType = "All";
        SelectedCommandBindingState = "All";
        CommandSearch = string.Empty;
        RefreshCommandBindingState();
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CommandCatalogStatus)));
    }

    private void ClearCommandCatalog()
    {
        _commandCatalog = null;
        CommandCatalogPath = null;
        CommandCatalog.Clear();
        FilteredCommands.Clear();
        CommandCategories.Clear();
        CommandCategories.Add("All");
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CommandCatalogStatus)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CommandResultSummary)));
    }

    private void RefreshCommandBindingState()
    {
        if (_commandCatalog is null) return;
        _commandCatalogService.ReconcileBindings(CommandCatalog, Rows);
        RefreshCommandFilter();
    }

    private void RefreshCommandFilter()
    {
        FilteredCommands.Clear();
        foreach (var command in _commandCatalogService.Filter(
                     CommandCatalog, CommandSearch, SelectedCommandCategory, SelectedCommandType, SelectedCommandBindingState)
                     .Where(command => SelectedCommandAvailability == "All" || command.Availability == SelectedCommandAvailability))
            FilteredCommands.Add(command);
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CommandResultSummary)));
    }

    private void RebuildTargetChords()
    {
        TargetChords.Clear();
        TargetChords.Add("All chords");
        TargetChords.Add("No chord");
        foreach (var chord in AssignmentTargets.Select(row => row.Chord)
                     .Where(chord => !string.IsNullOrWhiteSpace(chord))
                     .Distinct(StringComparer.OrdinalIgnoreCase)
                     .OrderBy(chord => chord, StringComparer.OrdinalIgnoreCase))
            TargetChords.Add(chord!);
        if (!TargetChords.Contains(SelectedTargetChord)) SelectedTargetChord = "All chords";
    }

    private void RefreshTargetFilter()
    {
        var selectedType = SelectedCatalogCommand?.Type;
        FilteredPreviewRows.Clear();
        foreach (var row in AssignmentTargets.Where(row =>
                     (selectedType is not ("button" or "axis") || row.InputType == selectedType) &&
                     (SelectedTargetBindingState == "All" ||
                      (SelectedTargetBindingState == "Bound") == !string.IsNullOrWhiteSpace(row.Command)) &&
                     (SelectedTargetChord == "All chords" ||
                      (SelectedTargetChord == "No chord"
                          ? string.IsNullOrWhiteSpace(row.Chord)
                          : string.Equals(row.Chord, SelectedTargetChord, StringComparison.OrdinalIgnoreCase)))))
            FilteredPreviewRows.Add(row);

        if (SelectedPreviewRow is not null && Rows.Contains(SelectedPreviewRow) && !FilteredPreviewRows.Contains(SelectedPreviewRow))
            SelectedPreviewRow = null;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(TargetResultSummary)));
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
        // Repository comparison can add synthetic groups while a row is changing. Normalize
        // those transient entries before rebuilding the authoritative groups from Rows.
        foreach (var synthetic in CommandLabels.Where(group => group.IsRepositoryOnly).ToList())
            CommandLabels.Remove(synthetic);
        foreach (var duplicates in CommandLabels.GroupBy(group => (group.Command, group.SemanticChord)))
            foreach (var duplicate in duplicates.Skip(1).ToList())
                CommandLabels.Remove(duplicate);
        var existing = CommandLabels.ToDictionary(group => (group.Command, group.SemanticChord));
        var commands = Rows
            .Where(row => !string.IsNullOrWhiteSpace(row.Command))
            .Select(row => (Command: row.Command!, SemanticChord: CommandLabelGroup.NormalizeChord(row.SemanticChord)))
            .Distinct()
            .OrderBy(item => item.Command, StringComparer.Ordinal)
            .ThenBy(item => item.SemanticChord, StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var removed in CommandLabels.Where(group => !commands.Contains((group.Command, group.SemanticChord))).ToList())
            CommandLabels.Remove(removed);

        foreach (var item in commands)
        {
            if (!existing.TryGetValue(item, out var group))
            {
                group = new CommandLabelGroup { Command = item.Command, SemanticChord = item.SemanticChord };
                CommandLabels.Add(group);
            }
            group.Refresh(Rows);
        }
        RecomparePreview();
    }

    public void ApplyCommandLabel(CommandLabelGroup group)
    {
        var matchingRows = Rows
            .Where(group.Matches)
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
            item.Matches(row));
        group?.Refresh(Rows);
        RecomparePreview();
    }

    private void Modifier_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(PreviewModifier.SemanticModifier)) { RecomparePreview(); MarkSolutionDirty(); }
    }

    private void Device_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(PreviewDevice.Role) or nameof(PreviewDevice.RemoveRequested))
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

    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> PagePresentationOverrides() => Devices
        .Where(device => !device.IsRepositoryOnly &&
            !string.IsNullOrWhiteSpace(device.ProfileKey) &&
            (!string.IsNullOrWhiteSpace(device.PageTitle) || !string.IsNullOrWhiteSpace(device.PageKicker)))
        .ToDictionary(
            device => device.ProfileKey!,
            device => (IReadOnlyDictionary<string, string>)new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["title"] = device.PageTitle ?? string.Empty,
                ["kicker"] = device.PageKicker ?? string.Empty,
            },
            StringComparer.OrdinalIgnoreCase);

    public CurrentLabelImportResult ImportCurrentLabels(PreviewDevice device)
    {
        var result = IsUiLayerImport
            ? _currentLabels.ApplyUiLayer(CommonRoot, device, Rows)
            : _currentLabels.Apply(OutputDir, device, Rows);
        var source = IsUiLayerImport ? "authoritative UI Layer" : "destination";
        StatusText = $"Current labels loaded for {device.Stem}: {result.CurrentCount} from {source}, " +
            $"{result.DcsDefaultCount} reassigned controls from DCS command labels, " +
            $"{result.SharedHardwareCount} new controls from DCS-Common shared hardware.";
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
            PagePresentationOverrides(),
            includeUiLayer: !IsUiLayerImport, assignments: PendingAssignments.ToArray(),
            repositoryProfilesDir: ExistingRepositoryProfilesDirectory());
    }


    public ScaffoldSolutionDocument CaptureSolution()
    {
        var decisions = new ScaffoldSolutionDecisions();
        if (_pendingSolutionDecisions is not null)
        {
            foreach (var item in _pendingSolutionDecisions.InstanceRoles) decisions.InstanceRoles[item.Key] = item.Value;
            foreach (var item in _pendingSolutionDecisions.SemanticModifiers) decisions.SemanticModifiers[item.Key] = item.Value;
            foreach (var item in _pendingSolutionDecisions.RemovedProfiles) decisions.RemovedProfiles.Add(item);
        }

        foreach (var device in Devices.Where(item => !item.IsRepositoryOnly && !string.IsNullOrWhiteSpace(item.ProfileFile) && !string.IsNullOrWhiteSpace(item.Role)))
            decisions.InstanceRoles[device.ProfileFile!] = device.Role!.Trim();
        foreach (var modifier in ModifierOverrides()) decisions.SemanticModifiers[modifier.Key] = modifier.Value;
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
            AssignmentTargets.Clear();
            RebuildTargetChords();
            RefreshTargetFilter();
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
