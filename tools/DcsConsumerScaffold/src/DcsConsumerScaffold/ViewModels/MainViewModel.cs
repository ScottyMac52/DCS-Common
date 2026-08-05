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
        Rows = new ObservableCollection<PreviewRow>();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<PreviewRow> Rows { get; }

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
        Rows.Clear();
        HasPreview = false;
        try
        {
            var (document, stdout, stderr, exitCode) = await _engine.RunPreviewAsync(
                ProfilesDir,
                string.IsNullOrWhiteSpace(ModifiersPath) ? null : ModifiersPath,
                string.IsNullOrWhiteSpace(CommonRoot) ? null : CommonRoot);

            if (document?.Rows != null)
            {
                foreach (var row in document.Rows)
                {
                    Rows.Add(row);
                }
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
            var (stdout, stderr, exitCode) = await _engine.RunWriteAsync(
                ProfilesDir,
                string.IsNullOrWhiteSpace(ModifiersPath) ? null : ModifiersPath,
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
