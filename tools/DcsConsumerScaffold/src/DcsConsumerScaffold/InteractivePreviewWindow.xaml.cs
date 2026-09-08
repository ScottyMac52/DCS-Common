using System.IO;
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
            Item("Reset label", () => { row.ResetToDefaultLabel(); Refresh(); });
            target.ContextMenu = menu;
            Diagram.Children.Add(target);
        }
        Refresh();
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
            var pending = _model.PendingFor(row);
            target.Background = _model.HasConflict(row) ? Brushes.LightCoral : string.IsNullOrEmpty(row.Command) ? Brushes.Gainsboro :
                pending is null ? Brushes.White : pending.AllowCreate ? Brushes.LightGreen : Brushes.Khaki;
            target.BorderBrush = row == _selected ? Brushes.RoyalBlue : Brushes.SlateGray;
            ((TextBlock)target.Child).Text = string.IsNullOrEmpty(row.Command) ? "Unassigned" : row.Label;
            target.ToolTip = $"{row.Key} • {(string.IsNullOrEmpty(row.Chord) ? "Base" : row.Chord)}\n{row.Name}\n{row.Label}";
        }
        _updating = true;
        PhysicalInput.Text = _selected?.Key ?? "Select a callout";
        Chord.Text = _selected is null ? "" : $"Modifier / chord: {(string.IsNullOrEmpty(_selected.Chord) ? "Base" : _selected.Chord)}";
        CurrentCommand.Text = _selected is null ? "" : _model.OriginalCommandName(_selected);
        PendingCommand.Text = _selected is null ? "" : _model.PendingFor(_selected) is { } selectedPending ? selectedPending.Clear ? "Clear assignment" : selectedPending.Name : "No pending assignment";
        DefaultLabel.Text = _selected?.DefaultLabel;
        LabelEditor.IsEnabled = !string.IsNullOrEmpty(_selected?.Command);
        LabelEditor.Text = _selected?.Label ?? "";
        _updating = false;
    }
    private void LabelChanged(object sender, TextChangedEventArgs e)
    {
        if (_updating || _selected is null) return;
        _selected.Label = LabelEditor.Text;
        foreach (var (target, row) in _targets.Where(item => item.Value == _selected)) ((TextBlock)target.Child).Text = row.Label;
    }
    private void ZoomChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    { if (Diagram is not null) Diagram.LayoutTransform = new ScaleTransform(e.NewValue, e.NewValue); }
    private void AssignClicked(object sender, RoutedEventArgs e) { if (_selected is not null) Assign(_selected, _model.SelectedCatalogCommand); }
    private void ClearClicked(object sender, RoutedEventArgs e) { if (_selected is not null) Clear(_selected); }
    private void UndoClicked(object sender, RoutedEventArgs e) { if (_selected is not null) { _model.UndoAssignment(_selected); Refresh(); } }
    private void ResetClicked(object sender, RoutedEventArgs e) { if (_selected is not null) { _selected.ResetToDefaultLabel(); Refresh(); } }
    private void BackClicked(object sender, RoutedEventArgs e) => Close();
    private void ProceedClicked(object sender, RoutedEventArgs e)
    {
        if (!_model.ProceedCommand.CanExecute(null)) { Message.Text = "Set the destination directory and module identity on the main screen before proceeding."; return; }
        Close(); _model.ProceedCommand.Execute(null);
    }
    private void ImportClicked(object sender, RoutedEventArgs e) => LoadCatalog(false);
    private void DcsClicked(object sender, RoutedEventArgs e) => LoadCatalog(true);
    private void LoadCatalog(bool installed)
    {
        var dialog = new OpenFileDialog { Filter = installed ? "DCS default.lua|default.lua|Lua files|*.lua" : "Command catalog|*.json" };
        if (dialog.ShowDialog(this) != true) return;
        try { if (installed) _model.LoadInstalledDcsCommandCatalog(dialog.FileName); else _model.LoadCommandCatalog(dialog.FileName); Message.Text = _model.CommandCatalogStatus; }
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
