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
    private readonly IpiAuthoringService _ipiAuthoringService = new();
    private readonly ScaffoldEngineService _scaffoldEngine = new();
    private string? _pendingModifierControlKey;

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

    private void OpenModuleAuthoring_Click(object sender, RoutedEventArgs e)
    {
        var window = new ModuleAuthoringWindow(_viewModel.CommonRoot, _viewModel.OutputDir, _viewModel.DisplayName,
            _viewModel.InputModuleId, _viewModel.KneeboardId) { Owner = this };
        window.ShowDialog();
        if (!string.IsNullOrWhiteSpace(window.ProfilesDirectoryCreated))
        {
            _viewModel.ProfilesDir = window.ProfilesDirectoryCreated;
            _viewModel.OutputDir = window.RepositoryRoot;
            _viewModel.DisplayName = window.DisplayName;
            _viewModel.InputModuleId = window.InputModuleId;
            _viewModel.KneeboardId = window.KneeboardId;
            var modifiers = Path.Combine(window.RepositoryRoot, "src", "Config", "Input", window.InputModuleId, "modifiers.lua");
            _viewModel.ModifiersPath = File.Exists(modifiers) ? modifiers : string.Empty;
            _viewModel.StatusText = "Blank clone initialized. Load Preview, import the module command catalog, then add controls on base or created layers.";
        }
    }

    private void ApplyCommandLabel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is CommandLabelGroup group)
            _viewModel.ApplyCommandLabel(group);
    }

    private void ImportCommandCatalog_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Import DCS command catalog",
            Filter = "DCS command catalogs (*.json)|*.json|All files (*.*)|*.*",
        };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            _viewModel.LoadCommandCatalog(dialog.FileName);
        }
        catch (Exception ex)
        {
            _viewModel.StatusText = ex.Message;
            MessageBox.Show(this, ex.Message, "Unable to import command catalog", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void LoadDcsHtmlCommands_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Select all HTML files generated by DCS Controls for this module",
            Filter = "DCS Controls HTML (*.html;*.htm)|*.html;*.htm|HTML files (*.html)|*.html|All files (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = true,
        };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            _viewModel.LoadDcsHtmlCommandCatalog(dialog.FileNames);
        }
        catch (Exception ex)
        {
            _viewModel.StatusText = ex.Message;
            MessageBox.Show(this, ex.Message, "Unable to load DCS Controls HTML", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void SaveCommandCatalog_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog { Title = "Save reloadable DCS command catalog", FileName = $"{_viewModel.InputModuleId}-commands.json", Filter = "DCS command catalogs (*.json)|*.json" };
        if (dialog.ShowDialog(this) != true) return;
        try { _viewModel.SaveCommandCatalog(dialog.FileName); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "Unable to save command catalog", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private void AssignCommand_Click(object sender, RoutedEventArgs e)
    {
        var command = _viewModel.SelectedCatalogCommand;
        var row = _viewModel.SelectedPreviewRow;
        if (command is null || row is null) return;
        if (!string.Equals(row.Command, command.BindingKey, StringComparison.Ordinal))
        {
            var answer = MessageBox.Show(this,
                $"Replace the current assignment on {row.Stem} {row.Key}" +
                $"{(string.IsNullOrWhiteSpace(row.Chord) ? string.Empty : $" + {row.Chord}")}?{Environment.NewLine}{Environment.NewLine}" +
                $"Current: {row.Name ?? row.Command}{Environment.NewLine}New: {command.Name}",
                "Confirm command assignment", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (answer != MessageBoxResult.Yes) return;
        }
        try
        {
            _viewModel.AssignSelectedCommand();
        }
        catch (Exception ex)
        {
            _viewModel.StatusText = ex.Message;
            MessageBox.Show(this, ex.Message, "Unable to assign command", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void EditInUiLayer_Click(object sender, RoutedEventArgs e)
    {
        var row = _viewModel.SelectedPreviewRow;
        var context = row is null ? null : $"Module context: {_viewModel.DisplayName} — {row.Stem} {row.Key} {row.Chord}";
        new UiLayerEditorWindow(_viewModel.CommonRoot, context) { Owner = this }.ShowDialog();
    }

    private void DeviceHardware_DropDownOpened(object sender, EventArgs e) => LoadDeviceHardware();

    private void LoadDeviceHardware()
    {
        if (DeviceHardwareBox.ItemsSource is not null) return;
        var root = _scaffoldEngine.ResolveCommonRoot(_viewModel.CommonRoot)
            ?? throw new InvalidOperationException("Select a valid DCS-Common root before adding shared hardware.");
        DeviceHardwareBox.ItemsSource = _ipiAuthoringService.Hardware(root);
    }

    private void DeviceSelection_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (DevicesGrid.SelectedItem is not PreviewDevice device) return;
        try
        {
            LoadDeviceHardware();
            DeviceHardwareBox.SelectedItem = (DeviceHardwareBox.ItemsSource as IEnumerable<IpiHardwareChoice>)?
                .FirstOrDefault(item => string.Equals(item.DeviceId, device.DeviceId, StringComparison.OrdinalIgnoreCase));
        }
        catch (Exception ex) { _viewModel.StatusText = ex.Message; }
        DeviceProfileBox.Text = device.ProfileFile ?? string.Empty;
        DeviceInstanceEditorBox.Text = device.InstanceHint ?? string.Empty;
        DeviceRoleBox.Text = device.Role ?? string.Empty;
    }

    private void AddDevice_Click(object sender, RoutedEventArgs e) => RunDeviceEdit(() =>
    {
        LoadDeviceHardware();
        if (DeviceHardwareBox.SelectedItem is not IpiHardwareChoice hardware)
            throw new InvalidOperationException("Select shared hardware.");
        _viewModel.AddSharedDevice(hardware, DeviceProfileBox.Text, DeviceInstanceEditorBox.Text, DeviceRoleBox.Text);
    });

    private void UpdateDevice_Click(object sender, RoutedEventArgs e) => RunDeviceEdit(() =>
    {
        if (_viewModel.SelectedDevice is not { } device) throw new InvalidOperationException("Select a physical device instance to update.");
        if (DeviceHardwareBox.SelectedItem is not IpiHardwareChoice hardware) throw new InvalidOperationException("Select shared hardware.");
        _viewModel.UpdateSharedDevice(device, hardware, DeviceProfileBox.Text, DeviceInstanceEditorBox.Text, DeviceRoleBox.Text);
        DevicesGrid.Items.Refresh();
    });

    private void RemoveDevice_Click(object sender, RoutedEventArgs e) => RunDeviceEdit(() =>
    {
        if (_viewModel.SelectedDevice is not { } device) throw new InvalidOperationException("Select a physical device instance to remove.");
        if (MessageBox.Show(this, $"Stage removal of unused device {device.ProfileFile}?", "Remove physical device", MessageBoxButton.YesNo,
            MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        _viewModel.RemoveSharedDevice(device);
    });

    private void RunDeviceEdit(Action action)
    {
        try { action(); }
        catch (Exception ex)
        {
            _viewModel.StatusText = ex.Message;
            MessageBox.Show(this, ex.Message, "Shared hardware editor", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void ModifierDevice_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (ModifierDeviceBox.SelectedItem is not PreviewDevice device || string.IsNullOrWhiteSpace(device.DeviceId))
        {
            ModifierControlBox.ItemsSource = null;
            return;
        }
        try
        {
            var layout = await _viewModel.LoadInteractiveDeviceAsync(device);
            var controls = layout.Controls.Where(item => !item.Shifted).OrderBy(item => item.HardwareLabel).ToList();
            ModifierControlBox.ItemsSource = controls;
            ModifierControlBox.SelectedItem = controls.FirstOrDefault(item => item.Key == _pendingModifierControlKey);
            if (ModifierControlBox.SelectedItem is null && controls.Count > 0) ModifierControlBox.SelectedIndex = 0;
            _pendingModifierControlKey = null;
        }
        catch (Exception ex) { _viewModel.StatusText = ex.Message; }
    }

    private void ModifierSelection_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (ModifiersGrid.SelectedItem is not PreviewModifier modifier) return;
        ModifierNameBox.Text = modifier.Name ?? string.Empty;
        ModifierSemanticBox.Text = modifier.SemanticModifier ?? string.Empty;
        ModifierModeBox.SelectedIndex = string.Equals(modifier.Mode, "toggle", StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        _pendingModifierControlKey = modifier.Key;
        ModifierDeviceBox.SelectedItem = _viewModel.Devices.FirstOrDefault(device =>
            string.Equals(NativeDeviceName(device.ProfileFile), modifier.Device, StringComparison.OrdinalIgnoreCase));
    }

    private void AddModifier_Click(object sender, RoutedEventArgs e) => RunModifierEdit(() =>
    {
        if (ModifierDeviceBox.SelectedItem is not PreviewDevice device || ModifierControlBox.SelectedItem is not InteractiveControl control)
            throw new InvalidOperationException("Select an imported device and one of its shared controls.");
        _viewModel.AddModifier(device, control, ModifierNameBox.Text, ModifierMode(), ModifierSemanticBox.Text);
    });

    private void UpdateModifier_Click(object sender, RoutedEventArgs e) => RunModifierEdit(() =>
    {
        if (_viewModel.SelectedModifier is not { } modifier) throw new InvalidOperationException("Select a modifier to update.");
        _viewModel.UpdateModifier(modifier, ModifierDeviceBox.SelectedItem as PreviewDevice,
            ModifierControlBox.SelectedItem as InteractiveControl, ModifierNameBox.Text, ModifierMode(), ModifierSemanticBox.Text);
        ModifiersGrid.Items.Refresh();
    });

    private void RemoveModifier_Click(object sender, RoutedEventArgs e) => RunModifierEdit(() =>
    {
        if (_viewModel.SelectedModifier is not { } modifier) throw new InvalidOperationException("Select a modifier to remove.");
        if (MessageBox.Show(this, $"Remove modifier {modifier.Name}?", "Remove modifier", MessageBoxButton.YesNo,
            MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        _viewModel.RemoveModifier(modifier);
    });

    private void RunModifierEdit(Action action)
    {
        try { action(); }
        catch (Exception ex)
        {
            _viewModel.StatusText = ex.Message;
            MessageBox.Show(this, ex.Message, "Modifier editor", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private string ModifierMode() => (ModifierModeBox.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "hold";

    private static string NativeDeviceName(string? profileFile) => string.IsNullOrWhiteSpace(profileFile) ? string.Empty
        : profileFile.EndsWith(".diff.lua", StringComparison.OrdinalIgnoreCase)
            ? profileFile[..^".diff.lua".Length]
            : Path.GetFileNameWithoutExtension(profileFile);

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
            if (_viewModel.IsUiLayerImport)
            {
                ShowPreview(device, await _viewModel.RenderDevicePreviewAsync(device));
                return;
            }
            var layout = await _viewModel.LoadInteractiveDeviceAsync(device);
            new InteractivePreviewWindow(_viewModel, device, layout) { Owner = this }.ShowDialog();
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
