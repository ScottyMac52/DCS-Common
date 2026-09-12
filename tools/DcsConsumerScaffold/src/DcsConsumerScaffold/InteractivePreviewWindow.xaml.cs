using System.IO;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.ViewModels;
using Microsoft.Win32;

namespace DcsConsumerScaffold;

public partial class InteractivePreviewWindow : Window
{
    private readonly MainViewModel _model;
    private readonly PreviewDevice _device;
    private readonly InteractiveDevice _layout;
    private readonly Dictionary<Border, PreviewRow> _targets = [];
    private readonly Dictionary<string, string[]> _layers = new(StringComparer.Ordinal);
    private readonly IReadOnlyList<UiLayerProjection> _uiLayer;
    private PreviewRow? _selected;
    private Point _dragStart;
    private bool _updating;
    private sealed record ControlDrag(PreviewRow Source, DcsCommandCatalogEntry Command);

    public InteractivePreviewWindow(MainViewModel model, PreviewDevice device, InteractiveDevice layout)
    {
        InitializeComponent();
        _model = model; _device = device; _layout = layout;
        DataContext = model;
        Title = $"Controls preview — {device.Stem}";
        DeviceTitle.Text = device.Stem;
        _uiLayer = model.UiLayerProjectionsFor(device);
        _layers["Base"] = [];
        foreach (var modifier in model.Modifiers.Where(item => !item.IsRepositoryOnly && !string.IsNullOrEmpty(item.Name)))
            _layers.TryAdd(modifier.Name!, [modifier.Name!]);
        foreach (var row in model.Rows.Where(item => item.ProfileFile == device.ProfileFile && item.Reformers.Count > 0).ToArray())
            _layers.TryAdd(string.Join(" + ", row.Reformers), row.Reformers.ToArray());
        Layers.ItemsSource = _layers.Keys;
        Layers.SelectedIndex = 0;
    }

    private void LayerChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_layout is null || Layers.SelectedItem is not string layer) return;
        Diagram.Children.Clear(); _targets.Clear(); _selected = null;
        Diagram.Width = _layout.Width; Diagram.Height = _layout.Height;
        using var stream = new MemoryStream(_layout.Background);
        var bitmap = new BitmapImage(); bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = stream; bitmap.EndInit(); bitmap.Freeze();
        Diagram.Children.Add(new Image { Source = bitmap, Width = _layout.Width, Height = _layout.Height });
        var reformers = _layers[layer];
        foreach (var control in _layout.Controls)
        {
            // MFD diagrams contain separate base and shifted callout geometry.
            // A shifted target requires a chosen native modifier, never an invented chord.
            if (control.Shifted && reformers.Length == 0) continue;
            var native = control.Shifted || !_layout.Controls.Any(item => item.Id == control.Id + "-shifted") ? reformers : [];
            var row = _model.GetInteractiveRow(_device, control, native);
            var width = control.Width;
            var height = control.Height;
            var text = new TextBlock { FontSize = Math.Max(8, control.FontSize), TextWrapping = TextWrapping.Wrap, TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Stretch, TextAlignment = TextAlignment.Center };
            var target = new Border { Width = width, Height = height, Child = text, BorderThickness = new Thickness(1),
                BorderBrush = Brushes.SlateGray, CornerRadius = new CornerRadius(2), AllowDrop = true, Cursor = Cursors.Hand };
            Canvas.SetLeft(target, Math.Clamp(control.X, 0, _layout.Width - width));
            Canvas.SetTop(target, Math.Clamp(control.Y, 0, _layout.Height - height));
            _targets[target] = row;
            target.MouseLeftButtonDown += (_, e) => { _dragStart = e.GetPosition(this); Select(row); e.Handled = true; };
            target.MouseMove += (_, e) =>
            {
                if (!Dragging(e) || string.IsNullOrEmpty(row.Command) || _model.HasConflict(row)) return;
                var command = new DcsCommandCatalogEntry { BindingKey = row.Command, Name = row.Name ?? row.Command, Type = row.InputType };
                DragDrop.DoDragDrop(target, new ControlDrag(row, command), DragDropEffects.Move);
            };
            target.DragOver += (_, e) => { var command = DropCommand(e.Data); e.Effects = Compatible(command, row) ? DragDropEffects.Copy : DragDropEffects.None; e.Handled = true; };
            target.Drop += (_, e) =>
            {
                var move = e.Data.GetData(typeof(ControlDrag)) as ControlDrag;
                if (move?.Source == row) return;
                if (Assign(row, DropCommand(e.Data)) && move is not null) { _model.ClearAssignment(move.Source); Refresh(); }
                e.Handled = true;
            };
            var menu = new ContextMenu();
            void Item(string title, Action action) { var item = new MenuItem { Header = title }; item.Click += (_, _) => { Select(row); action(); }; menu.Items.Add(item); }
            Item("Assign selected command", () => Assign(row, _model.SelectedCatalogCommand));
            Item("Clear", () => Clear(row));
            Item("Restore", () => { _model.UndoAssignment(row); Refresh(); });
            Item("Edit label", () => { LabelEditor.Focus(); LabelEditor.SelectAll(); });
            if (row.IsAxis) Item("Tune axis…", () => TuneAxis(row));
            Item("Reset label", () => { row.ResetToDefaultLabel(); Refresh(); });
            target.ContextMenu = menu;
            Diagram.Children.Add(target);
        }
        Refresh();
    }

    private void ChooseChordClicked(object sender, RoutedEventArgs e)
    {
        var modifiers = _model.Modifiers.Where(item => !item.IsRepositoryOnly && !string.IsNullOrEmpty(item.Name))
            .GroupBy(item => item.Name!, StringComparer.Ordinal).Select(group => group.First()).ToList();
        if (modifiers.Count == 0)
        {
            Message.Text = "Load modifiers.lua on the main screen to enable chord assignment.";
            return;
        }
        var selectedInput = _selected?.Key;
        var current = Layers.SelectedItem is string layer ? _layers[layer] : [];
        var panel = new StackPanel { Margin = new Thickness(12) };
        panel.Children.Add(new TextBlock { Text = "Select one or more modifiers for the assignment chord.", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 10) });
        var choices = modifiers.Select(modifier => new CheckBox
        {
            Content = $"{modifier.Name} ({modifier.Mode ?? "modifier"})", Tag = modifier.Name,
            IsChecked = current.Contains(modifier.Name), Margin = new Thickness(0, 5, 0, 5),
        }).ToList();
        foreach (var choice in choices) panel.Children.Add(choice);
        var error = new TextBlock { Foreground = Brushes.DarkRed, TextWrapping = TextWrapping.Wrap };
        panel.Children.Add(error);
        var apply = new Button { Content = "Use chord", Padding = new Thickness(12, 6, 12, 6), Margin = new Thickness(0, 10, 0, 0), IsDefault = true };
        panel.Children.Add(apply);
        var dialog = new Window { Owner = this, Title = "Assignment chord", Width = 420, Height = 380,
            Content = new ScrollViewer { Content = panel }, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        apply.Click += (_, _) =>
        {
            try
            {
                var chord = _model.CreateInteractiveChord(choices.Where(choice => choice.IsChecked == true).Select(choice => (string)choice.Tag));
                var name = string.Join(" + ", chord);
                _layers[name] = chord;
                Layers.ItemsSource = _layers.Keys.ToArray();
                Layers.SelectedItem = name;
                var matching = _targets.Values.FirstOrDefault(row => row.Key == selectedInput && row.Reformers.OrderBy(value => value, StringComparer.Ordinal).SequenceEqual(chord));
                if (matching is not null) Select(matching);
                Message.Text = $"Assignment chord: {name}. Drop or assign a command on this layer. Base bindings stay separate.";
                dialog.Close();
            }
            catch (InvalidOperationException ex) { error.Text = ex.Message; }
        };
        dialog.ShowDialog();
    }

    private static DcsCommandCatalogEntry? DropCommand(IDataObject data) =>
        data.GetData(typeof(DcsCommandCatalogEntry)) as DcsCommandCatalogEntry ?? (data.GetData(typeof(ControlDrag)) as ControlDrag)?.Command;
    private bool Compatible(DcsCommandCatalogEntry? command, PreviewRow row) => command is { IsAssignable: true } && command.Type == row.InputType;
    private bool Dragging(MouseEventArgs e) => e.LeftButton == MouseButtonState.Pressed &&
        (Math.Abs(e.GetPosition(this).X - _dragStart.X) >= SystemParameters.MinimumHorizontalDragDistance ||
         Math.Abs(e.GetPosition(this).Y - _dragStart.Y) >= SystemParameters.MinimumVerticalDragDistance);
    private void DragStart(object sender, MouseButtonEventArgs e) => _dragStart = e.GetPosition(this);
    private void CommandDrag(object sender, MouseEventArgs e)
    {
        if (Dragging(e) && Commands.SelectedItem is DcsCommandCatalogEntry { IsAssignable: true } command)
            DragDrop.DoDragDrop(Commands, command, DragDropEffects.Copy);
    }
    private void Select(PreviewRow row) { _selected = row; Refresh(); }
    private bool Assign(PreviewRow row, DcsCommandCatalogEntry? command)
    {
        if (!Compatible(command, row)) { Message.Text = "Choose an assignable command of the matching input type."; return false; }
        if (_model.UiLayerConflictFor(row, _uiLayer) is { } uiConflict)
        {
            Message.Text = $"Assignment blocked: this control and modifier chord are reserved by UI Layer '{uiConflict.Label}' ({uiConflict.Modifier}).";
            return false;
        }
        if (command!.BindingKey == row.Command) return false;
        if (!string.IsNullOrEmpty(row.Command) && MessageBox.Show(this, $"Replace {(_model.HasConflict(row) ? "ALL conflicting commands" : row.Name)} on {row.Key} ({(string.IsNullOrEmpty(row.Chord) ? "base" : row.Chord)}) with {command.Name}?",
                "Replace assignment", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return false;
        _model.SelectedCatalogCommand = command;
        _model.SelectedPreviewRow = row;
        _model.AssignSelectedCommand();
        _selected = row;
        Message.Text = "Assignment staged. Proceed writes destination profiles and kneeboard configuration.";
        Refresh(); return true;
    }
    private void Clear(PreviewRow row)
    {
        if (string.IsNullOrEmpty(row.Command)) return;
        if (MessageBox.Show(this, $"Clear {(_model.HasConflict(row) ? "ALL conflicting commands" : row.Name)} from {row.Key}?", "Clear assignment", MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
        _model.ClearAssignment(row); Refresh();
    }
    private void Refresh()
    {
        foreach (var (target, row) in _targets)
        {
            var uiConflict = _model.UiLayerConflictFor(row, _uiLayer);
            UiLayerProjection[] ui = uiConflict is null ? [] : [uiConflict];
            var uiText = ui.Length == 0 ? string.Empty : "\n" + string.Join("\n", ui.Select(item => $"UI: {item.Label} ({item.Modifier})"));
            var pending = _model.PendingFor(row);
            target.Background = uiConflict is not null && !string.IsNullOrEmpty(row.Command) ? Brushes.OrangeRed :
                _model.HasConflict(row) ? Brushes.LightCoral : string.IsNullOrEmpty(row.Command) ? Brushes.Gainsboro :
                pending is null ? Brushes.White : pending.AllowCreate ? Brushes.LightGreen : Brushes.Khaki;
            target.BorderBrush = row == _selected ? Brushes.RoyalBlue : ui.Length > 0 ? new SolidColorBrush(Color.FromRgb(8, 145, 178)) : Brushes.SlateGray;
            ((TextBlock)target.Child).Text = (string.IsNullOrEmpty(row.Command) ? "Unassigned" : row.Label) + uiText;
            target.ToolTip = $"{row.Key} • {(string.IsNullOrEmpty(row.Chord) ? "Base" : row.Chord)}\n{row.Name}\n{row.Label}{uiText}";
        }
        _updating = true;
        PhysicalInput.Text = _selected?.Key ?? "Select a callout";
        Chord.Text = _selected is null ? "" : $"Modifier / chord: {(string.IsNullOrEmpty(_selected.Chord) ? "Base" : _selected.Chord)}";
        CurrentCommand.Text = _selected is null ? "" : _model.OriginalCommandName(_selected);
        PendingCommand.Text = _selected is null ? "" : _model.PendingFor(_selected) is { } selectedPending ? selectedPending.Clear ? "Clear assignment" : selectedPending.Name : "No pending assignment";
        DefaultLabel.Text = _selected?.DefaultLabel;
        LabelEditor.IsEnabled = !string.IsNullOrEmpty(_selected?.Command);
        LabelEditor.Text = _selected?.Label ?? "";
        TuneAxisButton.IsEnabled = _selected is { IsAxis: true } && !string.IsNullOrEmpty(_selected.Command);
        AxisTuningSummary.Text = _selected?.AxisFilterSummary ?? string.Empty;
        _updating = false;
    }
    private void LabelChanged(object sender, TextChangedEventArgs e)
    {
        if (_updating || _selected is null) return;
        _selected.Label = LabelEditor.Text;
        Refresh();
    }
    private void ZoomChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    { if (Diagram is not null) Diagram.LayoutTransform = new ScaleTransform(e.NewValue, e.NewValue); }
    private void AssignClicked(object sender, RoutedEventArgs e) { if (_selected is not null) Assign(_selected, _model.SelectedCatalogCommand); }
    private void ClearClicked(object sender, RoutedEventArgs e) { if (_selected is not null) Clear(_selected); }
    private void UndoClicked(object sender, RoutedEventArgs e) { if (_selected is not null) { _model.UndoAssignment(_selected); Refresh(); } }
    private void ResetClicked(object sender, RoutedEventArgs e) { if (_selected is not null) { _selected.ResetToDefaultLabel(); Refresh(); } }
    private void TuneAxisClicked(object sender, RoutedEventArgs e) { if (_selected is not null) TuneAxis(_selected); }
    private void TuneAxis(PreviewRow row)
    {
        if (!row.IsAxis || string.IsNullOrWhiteSpace(row.Command)) { Message.Text = "Select an assigned axis before tuning it."; return; }
        var current = (row.AxisFilter ?? AxisFilter.Default).Clone();
        var grid = new Grid { Margin = new Thickness(12) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(145) });
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        for (var index = 0; index < 8; index++) grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        TextBox Field(int rowIndex, string label, string value, string tip)
        {
            var caption = new TextBlock { Text = label, Margin = new Thickness(0, 6, 8, 6), VerticalAlignment = VerticalAlignment.Center };
            var editor = new TextBox { Text = value, Margin = new Thickness(0, 4, 0, 4), ToolTip = tip };
            Grid.SetRow(caption, rowIndex); Grid.SetColumn(caption, 0); Grid.SetRow(editor, rowIndex); Grid.SetColumn(editor, 1);
            grid.Children.Add(caption); grid.Children.Add(editor); return editor;
        }
        var deadzone = Field(0, "Deadzone (%)", Percent(current.Deadzone ?? 0), "0–100");
        var saturationX = Field(1, "Saturation X (%)", Percent(current.SaturationX ?? 1), "0–100");
        var saturationY = Field(2, "Saturation Y (%)", Percent(current.SaturationY ?? 1), "0–100");
        var curvature = Field(3, "Curvature (%)", string.Join(", ", (current.Curvature ?? []).Select(Percent)), "One value or a comma-separated DCS curve; each value -100–100");
        var invert = new CheckBox { Content = "Invert axis", IsChecked = current.Invert == true, Margin = new Thickness(0, 6, 0, 6) };
        var slider = new CheckBox { Content = "Slider", IsChecked = current.Slider == true, Margin = new Thickness(0, 6, 0, 6) };
        Grid.SetRow(invert, 4); Grid.SetColumn(invert, 1); Grid.SetRow(slider, 5); Grid.SetColumn(slider, 1); grid.Children.Add(invert); grid.Children.Add(slider);
        var error = new TextBlock { Foreground = Brushes.DarkRed, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 0) };
        Grid.SetRow(error, 6); Grid.SetColumnSpan(error, 2); grid.Children.Add(error);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 10, 0, 0) };
        var defaults = new Button { Content = "DCS defaults", Padding = new Thickness(10, 5, 10, 5) };
        var apply = new Button { Content = "Apply", Padding = new Thickness(16, 5, 16, 5), Margin = new Thickness(8, 0, 0, 0), IsDefault = true };
        buttons.Children.Add(defaults); buttons.Children.Add(apply); Grid.SetRow(buttons, 7); Grid.SetColumnSpan(buttons, 2); grid.Children.Add(buttons);
        var dialog = new Window { Owner = this, Title = $"Axis tuning — {row.Key}", Width = 470, SizeToContent = SizeToContent.Height,
            Content = grid, WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize };
        defaults.Click += (_, _) => { deadzone.Text = "0"; saturationX.Text = "100"; saturationY.Text = "100"; curvature.Text = ""; invert.IsChecked = false; slider.IsChecked = false; };
        apply.Click += (_, _) =>
        {
            try
            {
                var deadzoneValue = ParsePercent(deadzone.Text, "Deadzone", 0, 100);
                var saturationXValue = ParsePercent(saturationX.Text, "Saturation X", 0, 100);
                var saturationYValue = ParsePercent(saturationY.Text, "Saturation Y", 0, 100);
                var curvatureValues = string.IsNullOrWhiteSpace(curvature.Text) ? [] : curvature.Text.Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries)
                    .Select(value => ParsePercent(value, "Curvature", -100, 100)).ToList();
                var filter = new AxisFilter
                {
                    Deadzone = deadzoneValue == 0 ? null : deadzoneValue,
                    SaturationX = saturationXValue == 1 ? null : saturationXValue,
                    SaturationY = saturationYValue == 1 ? null : saturationYValue,
                    Curvature = curvatureValues.Count == 0 ? null : curvatureValues,
                    Invert = invert.IsChecked == true ? true : null,
                    Slider = slider.IsChecked == true ? true : null,
                };
                _model.StageAxisTuning(row, filter); dialog.Close(); Refresh(); Message.Text = "Axis tuning staged. Proceed writes it to the destination .diff.lua profile.";
            }
            catch (Exception ex) { error.Text = ex.Message; }
        };
        dialog.ShowDialog();
    }
    private static string Percent(double value) => (value * 100).ToString("0.###", CultureInfo.InvariantCulture);
    private static double ParsePercent(string text, string name, double minimum, double maximum)
    {
        if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) || value < minimum || value > maximum)
            throw new InvalidOperationException($"{name} must be a number from {minimum} through {maximum}.");
        return value / 100;
    }
    private void BackClicked(object sender, RoutedEventArgs e) => Close();
    private void ProceedClicked(object sender, RoutedEventArgs e)
    {
        if (!_model.ProceedCommand.CanExecute(null)) { Message.Text = "Set the destination directory and module identity on the main screen before proceeding."; return; }
        Close(); _model.ProceedCommand.Execute(null);
    }
    private void ImportClicked(object sender, RoutedEventArgs e) => LoadCatalog(false);
    private void DcsHtmlClicked(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Select all HTML files generated by DCS Controls for this module",
            Filter = "DCS Controls HTML (*.html;*.htm)|*.html;*.htm|HTML files (*.html)|*.html|All files (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = true,
        };
        if (dialog.ShowDialog(this) != true) return;
        try { _model.LoadDcsHtmlCommandCatalog(dialog.FileNames); Message.Text = _model.StatusText; }
        catch (Exception ex) { Message.Text = ex.Message; }
    }
    private void SaveCatalogClicked(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog { Title = "Save reloadable DCS command catalog", FileName = $"{_model.InputModuleId}-commands.json", Filter = "DCS command catalogs (*.json)|*.json" };
        if (dialog.ShowDialog(this) != true) return;
        try { _model.SaveCommandCatalog(dialog.FileName); Message.Text = _model.StatusText; }
        catch (Exception ex) { Message.Text = ex.Message; }
    }
    private void LoadCatalog(bool unused)
    {
        var dialog = new OpenFileDialog { Filter = "Command catalog|*.json" };
        if (dialog.ShowDialog(this) != true) return;
        try { _model.LoadCommandCatalog(dialog.FileName); Message.Text = _model.CommandCatalogStatus; }
        catch (Exception ex) { Message.Text = ex.Message; }
    }
    private async void RenderClicked(object sender, RoutedEventArgs e)
    {
        var button = (Button)sender; button.IsEnabled = false;
        try
        {
            var pages = await _model.RenderDevicePreviewAsync(_device);
            var tabs = new TabControl();
            foreach (var page in pages)
            {
                using var stream = new MemoryStream(page.PngBytes);
                var bitmap = new BitmapImage(); bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad; bitmap.StreamSource = stream; bitmap.EndInit();
                tabs.Items.Add(new TabItem { Header = page.Title ?? page.File, Content = new ScrollViewer { Content = new Image { Source = bitmap, Stretch = Stretch.Uniform } } });
            }
            new Window { Owner = this, Title = "Rendered kneeboard", Content = tabs, Width = 850, Height = 850, WindowStartupLocation = WindowStartupLocation.CenterOwner }.ShowDialog();
        }
        catch (Exception ex) { Message.Text = ex.Message; }
        finally { button.IsEnabled = true; }
    }
}
