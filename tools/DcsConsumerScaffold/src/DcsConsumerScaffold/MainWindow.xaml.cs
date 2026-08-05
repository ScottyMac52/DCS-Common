using System.Windows;
using DcsConsumerScaffold.ViewModels;
using Microsoft.Win32;

namespace DcsConsumerScaffold;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel = new();

    public MainWindow()
    {
        InitializeComponent();
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
}
