using System.IO;
using System.Text.Json.Nodes;
using DcsConsumerScaffold.Models;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class UiLayerImportServiceTests
{
    [Fact]
    public void Import_PreservesKnownFunctionsAddsNewFunctionsAndScopesOverlays()
    {
        using var common = new TempDirectory("dcs-common-ui-");
        using var source = new TempDirectory("dcs-ui-source-");
        var hardwareRoot = Path.Combine(common.Path, "assets", "shared", "hardware");
        Directory.CreateDirectory(hardwareRoot);
        File.WriteAllText(Path.Combine(hardwareRoot, "manifest.json"), """
            {
              "devices": [
                { "id": "tm-mfd" },
                { "id": "moza-ab9" },
                { "id": "tm-warthog-grip", "aliases": [ "ava-base-f16c" ] }
              ]
            }
            """);
        var uiRoot = Path.Combine(common.Path, "assets", "shared", "ui-layer");
        Directory.CreateDirectory(Path.Combine(uiRoot, "input", "UiLayer", "joystick"));
        File.WriteAllText(Path.Combine(uiRoot, "functions.json"), """
            {
              "schemaVersion": 1,
              "functions": [
                { "id": "vr-zoom", "command": "zoom-command", "label": "Curated VR Zoom", "category": "VR" }
              ]
            }
            """);
        File.WriteAllText(Path.Combine(uiRoot, "hardware-overlays.json"), """
            {
              "schemaVersion": 1,
              "exemptions": {
                "moza-ab9": "Standalone base"
              },
              "devices": {
                "tm-mfd": {
                  "status": "complete",
                  "appliesToInstances": [ "MFD3" ],
                  "bindings": { "vr-zoom": "old-callout" }
                }
              }
            }
            """);

        var profiles = Path.Combine(source.Path, "joystick");
        Directory.CreateDirectory(profiles);
        File.WriteAllText(Path.Combine(uiRoot, "input", "UiLayer", "joystick", "Disconnected.diff.lua"), "return { preserved = true }");
        File.WriteAllText(Path.Combine(uiRoot, "input", "UiLayer", "joystick", "Renamed Device {AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}.diff.lua"), "return { old = true }");
        File.WriteAllText(Path.Combine(profiles, "MFD 3.diff.lua"), "return {}");
        File.WriteAllText(Path.Combine(profiles, "MOZA AB9.diff.lua"), "return {}");
        File.WriteAllText(Path.Combine(profiles, "Renamed Device {BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}.diff.lua"), "return { new = true }");
        var modifiers = Path.Combine(source.Path, "modifiers.lua");
        File.WriteAllText(modifiers, "return {}");

        var mfd3 = Device("MFD 3.diff.lua", "tm-mfd", "3");
        var mfd1 = Device("MFD 1.diff.lua", "tm-mfd", "1");
        var moza = Device("MOZA AB9.diff.lua", "moza-ab9", null);
        var ava = Device("AVA Viper.diff.lua", "ava-base-f16c", null);
        var rows = new[]
        {
            Row(mfd3, "zoom-command", "Imported text must not replace curated text", "mfd-osb-t1-shifted"),
            Row(mfd1, "new-command", "New Function", "mfd-osb-t2-shifted"),
            Row(mfd3, "new-command", "New Function", "mfd-osb-t3-shifted"),
            Row(moza, "new-command", "New Function", "moza-button-1"),
            Row(ava, "zoom-command", "Imported text", "warthog-grip-cms-push"),
        };

        var result = new UiLayerImportService().Import(
            common.Path,
            profiles,
            modifiers,
            new[] { mfd1, mfd3, moza, ava },
            rows);

        var functions = JsonNode.Parse(File.ReadAllText(Path.Combine(uiRoot, "functions.json")))!["functions"]!.AsArray();
        var known = functions.OfType<JsonObject>().Single(item => item["command"]!.GetValue<string>() == "zoom-command");
        var added = functions.OfType<JsonObject>().Single(item => item["command"]!.GetValue<string>() == "new-command");
        Assert.Equal("vr-zoom", known["id"]!.GetValue<string>());
        Assert.Equal("Curated VR Zoom", known["label"]!.GetValue<string>());
        Assert.Equal("new-function", added["id"]!.GetValue<string>());
        Assert.Equal(1, result.NewFunctionCount);

        var overlays = JsonNode.Parse(File.ReadAllText(Path.Combine(uiRoot, "hardware-overlays.json")))!;
        var bindings = overlays["devices"]!["tm-mfd"]!["bindings"]!.AsObject();
        Assert.Equal("mfd-osb-t1-shifted", bindings["vr-zoom"]!.GetValue<string>());
        Assert.Equal("mfd-osb-t3-shifted", bindings["new-function"]!.GetValue<string>());
        Assert.Null(overlays["devices"]!["moza-ab9"]);
        Assert.Null(overlays["devices"]!["ava-base-f16c"]);
        Assert.Equal(
            "warthog-grip-cms-push",
            overlays["devices"]!["tm-warthog-grip"]!["bindings"]!["vr-zoom"]!.GetValue<string>());
        Assert.Equal(1, result.ExemptBindingCount);

        Assert.True(File.Exists(Path.Combine(uiRoot, "input", "UiLayer", "joystick", "MFD 3.diff.lua")));
        Assert.True(File.Exists(Path.Combine(uiRoot, "input", "UiLayer", "joystick", "Disconnected.diff.lua")));
        Assert.False(File.Exists(Path.Combine(uiRoot, "input", "UiLayer", "joystick", "Renamed Device {AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}.diff.lua")));
        Assert.True(File.Exists(Path.Combine(uiRoot, "input", "UiLayer", "joystick", "Renamed Device {BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}.diff.lua")));
        Assert.Equal(1, result.PreservedProfileCount);
        Assert.Equal("return {}", File.ReadAllText(Path.Combine(uiRoot, "input", "UiLayer", "modifiers.lua")));
    }

    [Fact]
    public void MergeModifiers_PreservesUnobservedDefinitionsAndUpdatesObservedDefinitions()
    {
        var existing = """
            local modifiers = {
              ["VKB_SHIFT"] = {
                ["device"] = "VKB",
                ["key"] = "JOY_BTN7",
                ["switch"] = false,
              },
              ["MFD_SHIFT"] = {
                ["device"] = "MFD 3",
                ["key"] = "JOY_BTN20",
                ["switch"] = false,
              },
            }
            return modifiers
            """;
        var observed = """
            local modifiers = {
              ["MFD_SHIFT"] = {
                ["device"] = "MFD 3",
                ["key"] = "JOY_BTN19",
                ["switch"] = false,
              },
            }
            return modifiers
            """;

        var merged = UiLayerImportService.MergeModifiers(existing, observed, out var preserved);

        Assert.Equal(1, preserved);
        Assert.Contains("VKB_SHIFT", merged);
        Assert.Contains("JOY_BTN7", merged);
        Assert.Contains("MFD_SHIFT", merged);
        Assert.Contains("JOY_BTN19", merged);
        Assert.DoesNotContain("JOY_BTN20", merged);
    }

    [Fact]
    public void Import_RejectsAConsumerRepositoryAsTheTarget()
    {
        using var target = new TempDirectory("not-dcs-common-");
        using var source = new TempDirectory("dcs-ui-source-");
        File.WriteAllText(Path.Combine(source.Path, "device.diff.lua"), "return {}");
        var modifiers = Path.Combine(source.Path, "modifiers.lua");
        File.WriteAllText(modifiers, "return {}");

        var error = Assert.Throws<InvalidOperationException>(() =>
            new UiLayerImportService().Import(target.Path, source.Path, modifiers, [], []));

        Assert.Contains("not DCS-Common", error.Message);
        Assert.False(File.Exists(Path.Combine(target.Path, "config", "kneeboard.json")));
    }

    private static PreviewDevice Device(string profile, string deviceId, string? instance) => new()
    {
        ProfileFile = profile,
        ProfileKey = instance == null ? deviceId : $"{deviceId}-{instance}",
        DeviceId = deviceId,
        InstanceHint = instance,
        BindingCount = 1,
    };

    private static PreviewRow Row(PreviewDevice device, string command, string label, string callout) => new()
    {
        ProfileFile = device.ProfileFile,
        ProfileKey = device.ProfileKey,
        DeviceId = device.DeviceId,
        Command = command,
        DefaultLabel = label,
        Label = label,
        CalloutId = callout,
        Status = "OK",
    };
    private sealed class TempDirectory : IDisposable
    {
        private readonly DirectoryInfo _directory;

        public TempDirectory(string prefix)
        {
            _directory = Directory.CreateTempSubdirectory(prefix);
        }

        public string Path => _directory.FullName;

        public void Dispose()
        {
            if (_directory.Exists) _directory.Delete(recursive: true);
        }
    }
}
