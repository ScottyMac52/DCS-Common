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
    private string _statusText = "Select a profiles directory, then Load Preview.";
    private string _summaryText = string.Empty;
    private bool _isBusy;

    public MainViewModel(ScaffoldEngineService? engine = null)
    {
        _engine = engine ?? new ScaffoldEngineService();
        LoadPreviewCommand = new RelayCommand(async () => await LoadPreviewAsync(), () => !IsBusy && !string.IsNullOrWhiteSpace(ProfilesDir));
        Rows = new ObservableCollection<PreviewRow>();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<PreviewRow> Rows { get; }

    public string ProfilesDir
    {
        get => _profilesDir;
        set { if (Set(ref _profilesDir, value)) LoadPreviewCommand.RaiseCanExecuteChanged(); }
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
                LoadPreviewCommand.RaiseCanExecuteChanged();
            }
        }
    }

    public RelayCommand LoadPreviewCommand { get; }

    public async Task LoadPreviewAsync()
    {
        if (string.IsNullOrWhiteSpace(ProfilesDir))
        {
            StatusText = "Profiles directory is required.";
            return;
        }

        IsBusy = true;
        StatusText = "Running Node scaffold engine…";
        Rows.Clear();
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

            var summary = document?.Summary;
            SummaryText = summary == null
                ? string.Empty
                : $"Profiles={summary.ProfileCount}  Rows={summary.RowCount}  Mapped={summary.MappedDevices}  Unmapped={summary.UnmappedDevices}  Errors={summary.ErrorCount}";

            var errorBlock = document?.Errors is { Count: > 0 }
                ? string.Join(Environment.NewLine, document.Errors)
                : string.Empty;
            StatusText = exitCode == 0
                ? $"Preview loaded (exit {exitCode}).{Environment.NewLine}{stdout}".Trim()
                : $"Engine exit {exitCode}.{Environment.NewLine}{stderr}{Environment.NewLine}{stdout}{Environment.NewLine}{errorBlock}".Trim();
        }
        catch (Exception ex)
        {
            StatusText = ex.Message;
            SummaryText = string.Empty;
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
