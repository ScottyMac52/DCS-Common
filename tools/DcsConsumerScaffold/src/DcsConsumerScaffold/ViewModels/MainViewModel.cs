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
    private string _profilesDir = string.Empty;
    private string _modifiersPath = string.Empty;
    private string _mozaGrip = "standalone";
    private string _commonRoot = string.Empty;
    private string _outputDir = string.Empty;
    private string _displayName = string.Empty;
    private string _inputModuleId = string.Empty;
    private string _kneeboardId = string.Empty;
    private string _statusText = "Select a profiles directory, then Load Preview. After review, set output + identities and Proceed.";
    private string _summaryText = string.Empty;
    private bool _isBusy;
    private bool _hasPreview;

    public MainViewModel(ScaffoldEngineService? engine = null)
    {
        _engine = engine ?? new ScaffoldEngineService();
        LoadPreviewCommand = new RelayCommand(async () => await LoadPreviewAsync(), CanLoadPreview);
        ProceedCommand = new RelayCommand(async () => await ProceedAsync(), CanProceed);
        Devices = new ObservableCollection<PreviewDevice>();
        Rows = new ObservableCollection<PreviewRow>();
        Modifiers = new ObservableCollection<PreviewModifier>();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<PreviewDevice> Devices { get; }
    public ObservableCollection<PreviewRow> Rows { get; }
    public ObservableCollection<PreviewModifier> Modifiers { get; }

    public string ProfilesDir
    {
        get => _profilesDir;
        set
        {
            if (Set(ref _profilesDir, value))
            {
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
        !string.IsNullOrWhiteSpace(OutputDir) &&
        !string.IsNullOrWhiteSpace(DisplayName) &&
        !string.IsNullOrWhiteSpace(InputModuleId) &&
        !string.IsNullOrWhiteSpace(KneeboardId);

    private void RaiseCommands()
    {
        LoadPreviewCommand.RaiseCanExecuteChanged();
        ProceedCommand.RaiseCanExecuteChanged();
    }

    public async Task LoadPreviewAsync()
    {
        if (string.IsNullOrWhiteSpace(ProfilesDir))
        {
            StatusText = "Profiles directory is required.";
            return;
        }

        IsBusy = true;
        StatusText = "Running Node scaffold engine (preview)…";
        var semanticModifiers = ModifierOverrides();
        var labels = LabelOverrides();
        Devices.Clear();
        Rows.Clear();
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
                }
            }

            if (document?.Rows != null)
            {
                foreach (var row in document.Rows)
                {
                    Rows.Add(row);
                }
            }

            if (document?.Modifiers != null)
            {
                foreach (var modifier in document.Modifiers) Modifiers.Add(modifier);
            }

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
        }
        catch (Exception ex)
        {
            StatusText = ex.Message;
            SummaryText = string.Empty;
            HasPreview = false;
        }
        finally
        {
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
        StatusText = "Writing consumer repository…";
        try
        {
            var instanceRoles = Devices
                .Where(device => !string.IsNullOrWhiteSpace(device.ProfileFile) && !string.IsNullOrWhiteSpace(device.Role))
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

    public IReadOnlyDictionary<string, string> ModifierOverrides() => Modifiers
        .Where(modifier => !string.IsNullOrWhiteSpace(modifier.Name) && !string.IsNullOrWhiteSpace(modifier.SemanticModifier))
        .ToDictionary(modifier => modifier.Name!, modifier => modifier.SemanticModifier!.Trim(), StringComparer.OrdinalIgnoreCase);

    public IReadOnlyDictionary<string, string> LabelOverrides() => Rows
        .Where(row => !string.IsNullOrWhiteSpace(row.BindingId) && row.LabelSource != "dcs")
        .ToDictionary(row => row.BindingId!, row => row.Label ?? string.Empty, StringComparer.Ordinal);

    public async Task<IReadOnlyList<RenderedPreviewPage>> RenderDevicePreviewAsync(PreviewDevice device)
    {
        if (string.IsNullOrWhiteSpace(device.DeviceId) || string.IsNullOrWhiteSpace(device.ProfileKey))
            throw new InvalidOperationException("Preview requires a resolved, supported physical device instance.");

        var instanceRoles = Devices
            .Where(item => !string.IsNullOrWhiteSpace(item.ProfileFile) && !string.IsNullOrWhiteSpace(item.Role))
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
