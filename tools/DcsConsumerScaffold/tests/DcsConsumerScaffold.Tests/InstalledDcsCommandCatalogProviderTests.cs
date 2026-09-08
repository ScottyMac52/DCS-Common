using System.IO;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class InstalledDcsCommandCatalogProviderTests
{
    [Fact]
    public void Build_ReadsSelectedHornetDefaultLuaDespiteDifferentPreviewModuleId()
    {
        using var install = new TemporaryDcsInstall("FA-18C", "FA-18C", """
            local res = { keyCommands = {}, axisCommands = {} }
            res.keyCommands = {
              { down = 3001, up = 3001, cockpit_device_id = 13, value_down = 1.0, value_up = 0.0,
                name = _("Master arm ON/OFF"), category = {_('Armament'), _('Master Arm')} },
              { pressed = 3042, cockpit_device_id = 7, value_down = -1,
                name = _('Radar elevation down'), category = _('HOTAS') },
            }
            res.axisCommands = {
              { action = 2001, cockpit_device_id = 2, name = _('Pitch'), category = _('Axis Commands') },
            }
            return res
            """);

        var result = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "FA-18C_hornet");

        Assert.Equal(1, result.Document.SchemaVersion);
        Assert.Equal("FA-18C_hornet", result.Document.ModuleId);
        Assert.Equal("2.9.18.12345", result.Document.DcsVersion);
        Assert.Equal(3, result.Document.Commands.Count);
        var masterArm = Assert.Single(result.Document.Commands, command => command.Name == "Master arm ON/OFF");
        Assert.Equal("d3001pnilu3001cd13vd1vpnilvu0", masterArm.BindingKey);
        Assert.Equal(["Armament", "Master Arm"], masterArm.CategoryPath);
        Assert.Equal(3001, masterArm.Actions!.Down);
        Assert.Equal("installed-dcs", masterArm.Source!.Provider);
        Assert.EndsWith("/Input/FA-18C/joystick/default.lua", masterArm.Source.File!.Replace('\\', '/'));
        Assert.Contains(result.Document.Commands, command => command.BindingKey == "dnilp3042unilcd7vd-1vpnilvunil");
        Assert.Contains(result.Document.Commands, command => command.BindingKey == "a2001cd2" && command.Type == "axis");
        Assert.NotEmpty(result.Document.SourceFingerprint!);
        Assert.Equal(0, result.SkippedEntryCount);
    }

    [Fact]
    public void Build_ReadsOnlyTheSelectedDefaultLuaWithoutExecutingIt()
    {
        using var install = new TemporaryDcsInstall("CommunityHornet", "FA-18C_hornet", """
            local marker = io.open('provider-must-not-execute.txt', 'w')
            if marker then marker:write('bad'); marker:close() end
            return { keyCommands = {
              { down = 3010, cockpit_device_id = 4, name = _('Safe command'), category = _('Systems') }
            }}
            """);
        var keyboard = install.AddInputFile("keyboard/default.lua", """
            return { keyCommands = {
              { down = 3011, cockpit_device_id = 4, name = _('Keyboard source command'), category = _('Systems') }
            }}
            """);

        var joystickResult = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "FA-18C_hornet");
        var keyboardResult = new InstalledDcsCommandCatalogProvider().Build(keyboard, "FA-18C_hornet");

        Assert.Single(joystickResult.Document.Commands);
        Assert.Equal("Safe command", joystickResult.Document.Commands[0].Name);
        Assert.Single(keyboardResult.Document.Commands);
        Assert.Equal("Keyboard source command", keyboardResult.Document.Commands[0].Name);
        Assert.False(File.Exists(Path.Combine(Environment.CurrentDirectory, "provider-must-not-execute.txt")));
        Assert.Single(joystickResult.SourceFiles);
        Assert.Single(keyboardResult.SourceFiles);
    }

    [Fact]
    public void Build_SkipsEntriesWhoseCanonicalNumericIdentityCannotBeResolved()
    {
        using var install = new TemporaryDcsInstall("F-16C", "F-16C_50", """
            return { keyCommands = {
              { down = device_commands.SomeCommand, cockpit_device_id = devices.HOTAS,
                name = _('Unresolved'), category = _('HOTAS') },
              { down = 3002, cockpit_device_id = 5, name = _('Resolved'), category = _('HOTAS') }
            }}
            """);

        var result = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "F-16C_50");

        Assert.Single(result.Document.Commands);
        Assert.Equal("Resolved", result.Document.Commands[0].Name);
        Assert.Equal(1, result.SkippedEntryCount);
        Assert.Contains("numeric", result.Warnings[0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Build_RejectsMissingOrNonDefaultLuaSelection()
    {
        var provider = new InstalledDcsCommandCatalogProvider();
        Assert.Throws<FileNotFoundException>(() => provider.Build(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "default.lua"), "F-14B"));
        using var install = new TemporaryDcsInstall("F-14", "F-14B", "return {}");
        var wrongName = Path.Combine(Path.GetDirectoryName(install.DefaultLuaPath)!, "commands.lua");
        File.WriteAllText(wrongName, "return {}");
        Assert.Throws<InvalidDataException>(() => provider.Build(wrongName, "F-14B"));
    }

    private sealed class TemporaryDcsInstall : IDisposable
    {
        private readonly string _inputRoot;

        public TemporaryDcsInstall(string aircraftFolder, string moduleId, string defaultLua)
        {
            Root = Path.Combine(Path.GetTempPath(), $"dcs-install-{Guid.NewGuid():N}");
            _inputRoot = Path.Combine(Root, "Mods", "aircraft", aircraftFolder, "Input", moduleId);
            AddInputFile("joystick/default.lua", defaultLua);
            File.WriteAllText(Path.Combine(Root, "autoupdate.cfg"), "{\"version\": \"2.9.18.12345\"}");
        }

        public string Root { get; }
        public string DefaultLuaPath { get; private set; } = string.Empty;

        public string AddInputFile(string relativePath, string content)
        {
            var path = Path.Combine(_inputRoot, relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, content);
            if (relativePath.Equals("joystick/default.lua", StringComparison.OrdinalIgnoreCase)) DefaultLuaPath = path;
            return path;
        }

        public void Dispose() => Directory.Delete(Root, true);
    }
}
