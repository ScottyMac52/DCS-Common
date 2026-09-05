using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using DcsConsumerScaffold.ViewModels;
using Microsoft.Win32;

namespace DcsConsumerScaffold;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel = new();
    private readonly ScaffoldSolutionService _solutionService = new();

    public MainWindow()
    {
        InitializeComponent();
        Title = ApplicationDisplayTitle.Format(typeof(MainWindow).Assembly.GetName().Version);
        DataContext = _viewModel;
        Closing += MainWindow_Closing;
    }


    private void OpenSolution_Click(object sender, RoutedEventArgs e)
    {
        if (!ConfirmDiscardChanges()) return;
        var dialog = new OpenFileDialog
        {
            Title = "Open scaffolding solution",
            Filter = "DCS scaffolding solutions (*.dcs-scaffold.json)|*.dcs-scaffold.json|JSON files (*.json)|*.json|All files (*.*)|*.*",
        };
        if (dialog.ShowDialog(this) != true) return;

        try
        {
            var document = _solutionService.Load(dialog.FileName);
            _viewModel.LoadSolution(document, dialog.FileName);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Unable to open solution", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void SaveSolution_Click(object sender, RoutedEventArgs e) => SaveCurrentSolution();

    private void SaveSolutionAs_Click(object sender, RoutedEventArgs e) => SaveSolutionAs();

    private void DeleteSolution_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_viewModel.SolutionPath)) return;
        var fullPath = Path.GetFullPath(_viewModel.SolutionPath);
        var answer = MessageBox.Show(this,
            $"Permanently delete only this scaffolding solution JSON?{Environment.NewLine}{Environment.NewLine}{fullPath}",
            "Delete scaffolding solution",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);
        if (answer != MessageBoxResult.Yes) return;

        try
        {
            _solutionService.Delete(fullPath);
            _viewModel.MarkSolutionDeleted();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Unable to delete solution", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private bool SaveCurrentSolution()
    {
        if (string.IsNullOrWhiteSpace(_viewModel.SolutionPath)) return SaveSolutionAs();
        return SaveSolution(_viewModel.SolutionPath);
    }

    private bool SaveSolutionAs()
    {
        var suggestedName = string.IsNullOrWhiteSpace(_viewModel.DisplayName)
            ? "scaffold"
            : string.Concat(_viewModel.DisplayName.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '-' : ch));
        var dialog = new SaveFileDialog
        {
            Title = "Save scaffolding solution",
            Filter = "DCS scaffolding solutions (*.dcs-scaffold.json)|*.dcs-scaffold.json|JSON files (*.json)|*.json",
            DefaultExt = ".dcs-scaffold.json",
            AddExtension = true,
            OverwritePrompt = true,
            FileName = $"{suggestedName}.dcs-scaffold.json",
        };
        return dialog.ShowDialog(this) == true && SaveSolution(dialog.FileName);
    }

    private bool SaveSolution(string path)
    {
        try
        {
            var document = _viewModel.CaptureSolution();
            if (string.IsNullOrWhiteSpace(document.Name))
                document.Name = Path.GetFileNameWithoutExtension(path);
            _solutionService.Save(path, document);
            _viewModel.MarkSolutionSaved(path);
            _viewModel.StatusText = $"Saved scaffolding solution '{Path.GetFullPath(path)}'.";
            return true;
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Unable to save solution", MessageBoxButton.OK, MessageBoxImage.Error);
            return false;
        }
    }

    private bool ConfirmDiscardChanges()
    {
        if (!_viewModel.IsSolutionDirty) return true;
        var answer = MessageBox.Show(this,
            "The scaffolding solution has unsaved changes. Save them first?",
            "Unsaved scaffolding solution",
            MessageBoxButton.YesNoCancel,
            MessageBoxImage.Warning);
        return answer switch
        {
            MessageBoxResult.Yes => SaveCurrentSolution(),
            MessageBoxResult.No => true,
            _ => false,
        };
    }

    private void MainWindow_Closing(object? sender, CancelEventArgs e)
    {
        if (!ConfirmDiscardChanges()) e.Cancel = true;
    }

    private void BrowseProfiles_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select DCS joystick profiles directory" };
        if (dialog.ShowDialog(this) == true)
        {
            _viewModel.ProfilesDir = dialog.FolderName;
        }
    }

    private void BrowseModifiers_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Select modifiers.lua",
            Filter = "Lua files (*.lua)|*.lua|All files (*.*)|*.*",
        };
        if (dialog.ShowDialog(this) == true)
        {
            _viewModel.ModifiersPath = dialog.FileName;
        }
    }

    private void BrowseCommon_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select DCS-Common repository root" };
        if (dialog.ShowDialog(this) == true)
        {
            _viewModel.CommonRoot = dialog.FolderName;
        }
    }

    private void BrowseOutput_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select output directory for the new consumer repo" };
        if (dialog.ShowDialog(this) == true)
        {
            _viewModel.OutputDir = dialog.FolderName;
        }
    }

    private void OpenUiLayerEditor_Click(object sender, RoutedEventArgs e)
    {
        new UiLayerEditorWindow(_viewModel.CommonRoot) { Owner = this }.ShowDialog();
    }

    private void ApplyCommandLabel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is CommandLabelGroup group)
            _viewModel.ApplyCommandLabel(group);
    }

    private void PreviewGrid_BeginningEdit(object sender, DataGridBeginningEditEventArgs e)
    {
        if (e.Row.Item is PreviewDevice { IsRepositoryOnly: true } or
            PreviewModifier { IsRepositoryOnly: true } or
            CommandLabelGroup { IsRepositoryOnly: true })
            e.Cancel = !string.Equals(e.Column.Header?.ToString(), "Remove", StringComparison.Ordinal);
    }

    private void ResetLabel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is PreviewRow row) row.ResetLabel();
    }

    private void CurrentLabels_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is not PreviewDevice device) return;
        try
        {
            _viewModel.ImportCurrentLabels(device);
        }
        catch (Exception ex)
        {
            _viewModel.StatusText = ex.Message;
            MessageBox.Show(this, ex.Message, "Current labels unavailable", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void DefaultLabels_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is PreviewDevice device)
            _viewModel.ResetDeviceLabelsToDefault(device);
    }

    private async void PreviewDevice_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is not PreviewDevice device) return;
        try
        {
            _viewModel.StatusText = $"Rendering preview for {device.Stem}…";
            var pages = await _viewModel.RenderDevicePreviewAsync(device);
            if (pages.Count == 0) throw new InvalidOperationException("No generated kneeboard page contains this device instance.");
            ShowPreview(device, pages);
            _viewModel.StatusText = $"Preview rendered for {device.Stem}.";
        }
        catch (Exception ex)
        {
            _viewModel.StatusText = ex.Message;
            MessageBox.Show(this, ex.Message, "Preview unavailable", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void ShowPreview(PreviewDevice device, IReadOnlyList<RenderedPreviewPage> pages)
    {
        var image = new Image { Stretch = Stretch.Uniform, LayoutTransform = new ScaleTransform(1, 1) };
        var selector = new ComboBox { ItemsSource = pages, DisplayMemberPath = "Title", SelectedIndex = 0, MinWidth = 260 };
        var zoom = new Slider { Minimum = 0.25, Maximum = 3, Value = 1, Width = 180, Margin = new Thickness(12, 0, 0, 0) };
        var resetZoom = new Button { Content = "Reset", Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(10, 2, 10, 2) };
        void Display(RenderedPreviewPage page)
        {
            using var stream = new MemoryStream(page.PngBytes);
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = stream;
            bitmap.EndInit();
            image.Source = bitmap;
        }
        selector.SelectionChanged += (_, _) => { if (selector.SelectedItem is RenderedPreviewPage page) Display(page); };
        zoom.ValueChanged += (_, _) => image.LayoutTransform = new ScaleTransform(zoom.Value, zoom.Value);
        resetZoom.Click += (_, _) => zoom.Value = 1;
        Display(pages[0]);

        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(8) };
        toolbar.Children.Add(selector);
        toolbar.Children.Add(new TextBlock { Text = "Zoom", Margin = new Thickness(16, 4, 0, 0) });
        toolbar.Children.Add(zoom);
        toolbar.Children.Add(resetZoom);
        var dock = new DockPanel();
        DockPanel.SetDock(toolbar, Dock.Top);
        dock.Children.Add(toolbar);
        dock.Children.Add(new ScrollViewer { Content = image, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        new Window
        {
            Owner = this,
            Title = $"Kneeboard Preview — {device.Stem}",
            Width = 900,
            Height = 900,
            Content = dock,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
        }.ShowDialog();
    }
}
