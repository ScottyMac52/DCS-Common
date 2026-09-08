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
        Assert.Equal("installed-dcs-lua", masterArm.Source!.Provider);
        Assert.EndsWith("/Input/FA-18C/joystick/default.lua", masterArm.Source.File!.Replace('\\', '/'));
        Assert.Contains(result.Document.Commands, command => command.BindingKey == "dnilp3042unilcd7vd-1vpnilvunil");
        Assert.Contains(result.Document.Commands, command => command.BindingKey == "a2001cd2" && command.Type == "axis");
        Assert.NotEmpty(result.Document.SourceFingerprint!);
        Assert.Equal(0, result.SkippedEntryCount);
    }

    [Fact]
    public void Build_ExecutesSelectedDefaultLuaAndItsDcsDependencies()
    {
        using var install = new TemporaryDcsInstall("FA-18C", "FA-18C", """
            local cockpit = folder.."../../../Cockpit/Scripts/"
            dofile(cockpit.."devices.lua")
            dofile(cockpit.."command_defs.lua")
            local res = external_profile("Config/Input/Aircrafts/common_joystick_binding.lua")
            local thrust_common, thrust_left, thrust_right = MultiEngineDefaultDeviceAssignmentForThrust()
            join(res.keyCommands, {
              { down = hotas_commands.WEAPON_RELEASE, up = hotas_commands.WEAPON_RELEASE,
                cockpit_device_id = devices.HOTAS, value_down = 1, value_up = 0,
                name = _('Weapon release'), category = {_('HOTAS'), _('Stick')} },
              { down = iCommandEnginesStart, name = _('Auto Start'), category = _('Cheat') }
            })
            join(res.axisCommands, {
              { combos = defaultDeviceAssignmentFor("roll"), action = hotas_commands.ROLL,
                cockpit_device_id = devices.HOTAS, name = _('Roll'), category = _('Axis Commands') }
            })
            return res
            """);
        install.AddFile("Mods/aircraft/FA-18C/Cockpit/Scripts/devices.lua", "devices = { HOTAS = 13 }");
        install.AddFile("Mods/aircraft/FA-18C/Cockpit/Scripts/command_defs.lua", "hotas_commands = { WEAPON_RELEASE = 3001, ROLL = 2001 }");
        install.AddFile("Config/Input/Aircrafts/common_joystick_binding.lua", """
            return { keyCommands = {
              { down = 1001, name = _('Common command'), category = _('General') }
            }, axisCommands = {} }
            """);

        var result = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "FA-18C_hornet");

        Assert.Equal(4, result.Document.Commands.Count);
        var weaponRelease = Assert.Single(result.Document.Commands, command => command.Name == "Weapon release");
        Assert.True(weaponRelease.IsAssignable);
        Assert.Equal("d3001pnilu3001cd13vd1vpnilvu0", weaponRelease.BindingKey);
        var autoStart = Assert.Single(result.Document.Commands, command => command.Name == "Auto Start");
        Assert.False(autoStart.IsAssignable);
        Assert.StartsWith("unresolved:", autoStart.BindingKey);
        Assert.Contains(result.Document.Commands, command => command.Name == "Common command" && command.IsAssignable);
        Assert.Contains(result.Document.Commands, command => command.Name == "Roll" && command.BindingKey == "a2001cd13");
        Assert.Equal(1, result.UnresolvedEntryCount);
        Assert.Equal(4, result.SourceFiles.Count);
    }

    [Fact]
    public void Build_KeepsUnresolvedEntriesSearchableButUnavailableForAssignment()
    {
        using var install = new TemporaryDcsInstall("F-16C", "F-16C_50", """
            return { keyCommands = {
              { down = device_commands.SomeCommand, cockpit_device_id = devices.HOTAS,
                name = _('Unresolved'), category = _('HOTAS') },
              { down = 3002, cockpit_device_id = 5, name = _('Resolved'), category = _('HOTAS') }
            }}
            """);

        var result = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "F-16C_50");

        Assert.Equal(2, result.Document.Commands.Count);
        Assert.Contains(result.Document.Commands, command => command.Name == "Resolved" && command.IsAssignable);
        var unresolved = Assert.Single(result.Document.Commands, command => command.Name == "Unresolved");
        Assert.False(unresolved.IsAssignable);
        Assert.Equal("Search only", unresolved.Availability);
        Assert.Equal(1, result.UnresolvedEntryCount);
        Assert.Contains("unavailable", result.Warnings[0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Build_ResolvesHostCommandFromAdditionalNumericLuaDefinition()
    {
        using var install = new TemporaryDcsInstall("GenericJet", "GenericJet", """
            return { keyCommands = {
              { down = iCommandPilotGestureSalute, name = _('Pilot Salute'), category = _('Communications') }
            }}
            """);
        install.AddFile("Scripts/Input/CommandDefs.lua", "iCommandPilotGestureSalute = 1777");

        var result = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "GenericJet");

        var salute = Assert.Single(result.Document.Commands);
        Assert.True(salute.IsAssignable);
        Assert.Equal("d1777pnilunilcdnilvdnilvpnilvunil", salute.BindingKey);
        Assert.Contains(result.SourceFiles, file => file.Replace('\\', '/').EndsWith("Scripts/Input/CommandDefs.lua"));
    }

    [Fact]
    public void Build_ResolvesHostCommandFromUniqueDcsGeneratedProfileBinding()
    {
        using var install = new TemporaryDcsInstall("GenericJet", "GenericJet", """
            return { keyCommands = {
              { down = iCommandPilotGestureSalute, name = _('Pilot Salute'), category = _('Communications') }
            }}
            """);
        install.AddInputFile("joystick/Existing.diff.lua", """
            local diff = { ["keyDiffs"] = {
              ["d1777pnilunilcdnilvdnilvpnilvunil"] = { ["added"] = { [1] = { ["key"] = "JOY_BTN1" } }, ["name"] = "Pilot Salute" },
            }}
            return diff
            """);

        var result = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "GenericJet");

        var salute = Assert.Single(result.Document.Commands);
        Assert.True(salute.IsAssignable);
        Assert.Equal("d1777pnilunilcdnilvdnilvpnilvunil", salute.BindingKey);
        Assert.Equal("dcs-generated-profile", salute.Source!.Provider);
        Assert.Contains("iCommandPilotGestureSalute", salute.Aliases);
    }

    [Fact]
    public void Build_DoesNotGuessWhenGeneratedProfilesDisagree()
    {
        using var install = new TemporaryDcsInstall("GenericJet", "GenericJet", """
            return { keyCommands = {
              { down = iCommandPilotGestureSalute, name = _('Pilot Salute'), category = _('Communications') }
            }}
            """);
        install.AddInputFile("joystick/First.diff.lua", "[\"d100pnilunilcdnilvdnilvpnilvunil\"] = { [\"name\"] = \"Pilot Salute\" }");
        install.AddInputFile("keyboard/Second.diff.lua", "[\"d200pnilunilcdnilvdnilvpnilvunil\"] = { [\"name\"] = \"Pilot Salute\" }");

        var result = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "GenericJet");

        Assert.False(Assert.Single(result.Document.Commands).IsAssignable);
        Assert.Equal(1, result.UnresolvedEntryCount);
    }

    [Theory]
    [InlineData("iCommandPlanePitch", "Pitch", "a2001cdnil")]
    [InlineData("iCommandPlaneRoll", "Roll", "a2002cdnil")]
    public void Build_ResolvesVerifiedGlobalFlightAxes(string symbol, string name, string expectedKey)
    {
        var lua = "return { axisCommands = { { action = " + symbol + ", name = _('" + name +
                  "'), category = _('Axis Commands') } } }";
        using var install = new TemporaryDcsInstall("GenericJet", "GenericJet", lua);

        var command = Assert.Single(new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "GenericJet").Document.Commands);

        Assert.True(command.IsAssignable);
        Assert.Equal(expectedKey, command.BindingKey);
        Assert.Equal("verified-dcs-host-command", command.Source!.Provider);
    }

    [Fact]
    public void Build_ToleratesModuleSpecificHostAssignmentHelpers()
    {
        using var install = new TemporaryDcsInstall("ThirdPartyJet", "ThirdPartyJet", """
            local primary, secondary, tertiary = ModuleSpecificAssignments()
            local alternate = vendor.defaultAssignments()
            return { keyCommands = {
              { combos = primary, down = 3001, cockpit_device_id = 4,
                name = _('Module command'), category = _('Systems') }
            }, axisCommands = {
              { combos = alternate, action = 2001, cockpit_device_id = 4,
                name = _('Module axis'), category = _('Axis Commands') }
            }}
            """);

        var result = new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "ThirdPartyJet");

        Assert.Equal(2, result.Document.Commands.Count);
        Assert.All(result.Document.Commands, command => Assert.True(command.IsAssignable));
    }

    [Fact]
    public void Build_RejectsLuaDependenciesOutsideTheDcsInstallation()
    {
        using var install = new TemporaryDcsInstall("F-16C", "F-16C_50", """
            dofile(folder.."../../../../../../../../outside.lua")
            return { keyCommands = {} }
            """);

        var error = Assert.Throws<InvalidDataException>(() =>
            new InstalledDcsCommandCatalogProvider().Build(install.DefaultLuaPath, "F-16C_50"));

        Assert.Contains("outside", error.Message, StringComparison.OrdinalIgnoreCase);
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

        public string AddFile(string relativePath, string content)
        {
            var path = Path.Combine(Root, relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, content);
            return path;
        }

        public void Dispose() => Directory.Delete(Root, true);
    }
}
