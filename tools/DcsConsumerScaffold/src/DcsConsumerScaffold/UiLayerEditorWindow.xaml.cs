using System.Windows;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Microsoft.Win32;

namespace DcsConsumerScaffold;

public partial class UiLayerEditorWindow : Window
{
    private readonly UiLayerCatalogService _service = new();
    private UiLayerCatalogComparison? _comparison;
    public IReadOnlyList<string> Actions { get; } = ["Keep", "Add", "Replace", "Remove"];

    public UiLayerEditorWindow(string? commonRoot = null)
    {
        InitializeComponent();
        DataContext = this;
        CommonRootBox.Text = commonRoot ?? string.Empty;
    }

    private void BrowseCommon_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select DCS-Common repository root" };
        if (dialog.ShowDialog(this) == true) CommonRootBox.Text = dialog.FolderName;
    }

    private void BrowseSource_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Select Saved Games Config\\Input\\UiLayer folder" };
        if (dialog.ShowDialog(this) == true) SourceRootBox.Text = dialog.FolderName;
    }

    private async void Load_Click(object sender, RoutedEventArgs e) => await RunAsync(async () =>
        Display(await _service.InspectAsync(CommonRootBox.Text.Trim())));

    private async void Compare_Click(object sender, RoutedEventArgs e) => await RunAsync(async () =>
    {
        _comparison = await _service.CompareAsync(CommonRootBox.Text.Trim(), SourceRootBox.Text.Trim());
        Display(_comparison.Canonical);
        ChangesGrid.ItemsSource = _comparison.Changes;
        SaveButton.IsEnabled = _comparison.Source.Valid;
        StatusText.Text = _comparison.Source.Valid
            ? "Comparison loaded. Absence defaults to Keep; choose Remove explicitly when intended."
            : "Imported source is invalid and cannot be saved.";
    });

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (_comparison is null) return;
        if (MessageBox.Show(this, "Validate and atomically apply the selected catalog actions?", "Save definitive UI Layer",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        await RunAsync(async () =>
        {
            var result = await _service.ApplyAsync(CommonRootBox.Text.Trim(), SourceRootBox.Text.Trim(), _comparison.Changes);
            Display(result);
            _comparison = null;
            ChangesGrid.ItemsSource = null;
            SaveButton.IsEnabled = false;
            StatusText.Text = $"Definitive UI Layer saved and validated. Fingerprint: {result.Fingerprint}";
        });
    }

    private void Display(UiLayerCatalogDocument document)
    {
        ProfilesGrid.ItemsSource = document.Profiles;
        BindingsGrid.ItemsSource = document.Bindings;
        ModifiersGrid.ItemsSource = document.Modifiers;
        ErrorsList.ItemsSource = document.Errors;
        SummaryText.Text = $"Profiles={document.Summary.Profiles}  Bindings={document.Summary.Bindings}  " +
            $"Keys={document.Summary.Keys}  Axes={document.Summary.Axes}  Modifiers={document.Summary.Modifiers}  Errors={document.Summary.Errors}";
        StatusText.Text = document.Valid ? $"Catalog valid. Fingerprint: {document.Fingerprint}" : "Catalog validation failed.";
    }

    private async Task RunAsync(Func<Task> action)
    {
        IsEnabled = false;
        try { await action(); }
        catch (Exception ex) { StatusText.Text = ex.Message; MessageBox.Show(this, ex.Message, "UI Layer Editor", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { IsEnabled = true; }
    }
}
