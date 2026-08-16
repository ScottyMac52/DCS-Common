using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.ViewModels;
using Microsoft.Win32;

namespace DcsConsumerScaffold;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel = new();

    public MainWindow()
    {
        InitializeComponent();
        Title = ApplicationDisplayTitle.Format(typeof(MainWindow).Assembly.GetName().Version);
        DataContext = _viewModel;
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

    private void ResetLabel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is PreviewRow row) row.ResetLabel();
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
