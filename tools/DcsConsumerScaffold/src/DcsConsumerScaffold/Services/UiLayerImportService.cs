using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

public sealed record UiLayerImportResult(
    int ProfileCount,
    int FunctionCount,
    int NewFunctionCount,
    int OverlayBindingCount,
    int ExemptBindingCount);

public sealed class UiLayerImportService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public UiLayerImportResult Import(
        string commonRoot,
        string profilesDir,
        string modifiersPath,
        IEnumerable<PreviewDevice> devices,
        IEnumerable<PreviewRow> rows)
    {
        Validate(commonRoot, profilesDir, modifiersPath);

        var uiLayerRoot = Path.Combine(commonRoot, "assets", "shared", "ui-layer");
        var destinationProfiles = Path.Combine(uiLayerRoot, "input", "UiLayer", "joystick");
        var destinationModifiers = Path.Combine(uiLayerRoot, "input", "UiLayer", "modifiers.lua");
        var functionsPath = Path.Combine(uiLayerRoot, "functions.json");
        var overlaysPath = Path.Combine(uiLayerRoot, "hardware-overlays.json");

        var functionsRoot = ReadObject(functionsPath);
        var functions = functionsRoot["functions"]?.AsArray()
            ?? throw new InvalidOperationException($"{functionsPath} requires functions[].");
        var functionByCommand = functions
            .OfType<JsonObject>()
            .Where(item => !string.IsNullOrWhiteSpace(item["command"]?.GetValue<string>()))
            .ToDictionary(item => item["command"]!.GetValue<string>(), StringComparer.Ordinal);
        var usedIds = functions
            .OfType<JsonObject>()
            .Select(item => item["id"]?.GetValue<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var newFunctionCount = 0;
        foreach (var row in rows.Where(IsImportableRow))
        {
            var command = row.Command!;
            if (functionByCommand.ContainsKey(command)) continue;

            var label = FirstNonEmpty(row.Label, row.DefaultLabel, row.Name, command);
            var id = UniqueId(Slugify(FirstNonEmpty(row.Name, row.DefaultLabel, command)), usedIds);
            var function = new JsonObject
            {
                ["id"] = id,
                ["command"] = command,
                ["label"] = label,
                ["category"] = "Imported",
            };
            functions.Add(function);
            functionByCommand.Add(command, function);
            newFunctionCount++;
        }

        var overlaysRoot = ReadObject(overlaysPath);
        var overlayDevices = overlaysRoot["devices"]?.AsObject()
            ?? throw new InvalidOperationException($"{overlaysPath} requires devices.");
        var exemptions = overlaysRoot["exemptions"]?.AsObject() ?? new JsonObject();
        var deviceByProfile = devices
            .Where(device => !string.IsNullOrWhiteSpace(device.ProfileFile))
            .ToDictionary(device => device.ProfileFile!, StringComparer.OrdinalIgnoreCase);

        var overlayBindingCount = 0;
        var exemptBindingCount = 0;
        foreach (var row in rows.Where(IsImportableRow))
        {
            if (string.IsNullOrWhiteSpace(row.DeviceId) || string.IsNullOrWhiteSpace(row.CalloutId)) continue;
            if (!functionByCommand.TryGetValue(row.Command!, out var function)) continue;
            var functionId = function["id"]!.GetValue<string>();

            if (exemptions.ContainsKey(row.DeviceId))
            {
                exemptBindingCount++;
                continue;
            }

            var overlay = overlayDevices[row.DeviceId] as JsonObject;
            if (overlay == null)
            {
                overlay = new JsonObject
                {
                    ["status"] = "template",
                    ["bindings"] = new JsonObject(),
                };
                overlayDevices[row.DeviceId] = overlay;
            }

            if (!AppliesToInstance(overlay, row, deviceByProfile)) continue;
            var bindings = overlay["bindings"]?.AsObject();
            if (bindings == null)
            {
                bindings = new JsonObject();
                overlay["bindings"] = bindings;
            }
            bindings[functionId] = row.CalloutId;
            overlayBindingCount++;
        }

        Directory.CreateDirectory(destinationProfiles);
        var sourceFiles = Directory.GetFiles(profilesDir, "*.diff.lua", SearchOption.TopDirectoryOnly);
        var sourceNames = sourceFiles.Select(Path.GetFileName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var destinationFile in Directory.GetFiles(destinationProfiles, "*.diff.lua", SearchOption.TopDirectoryOnly))
        {
            if (!sourceNames.Contains(Path.GetFileName(destinationFile))) File.Delete(destinationFile);
        }
        foreach (var sourceFile in sourceFiles)
        {
            File.Copy(sourceFile, Path.Combine(destinationProfiles, Path.GetFileName(sourceFile)), overwrite: true);
        }

        Directory.CreateDirectory(Path.GetDirectoryName(destinationModifiers)!);
        File.Copy(modifiersPath, destinationModifiers, overwrite: true);
        WriteJson(functionsPath, functionsRoot);
        WriteJson(overlaysPath, overlaysRoot);

        return new UiLayerImportResult(
            sourceFiles.Length,
            functions.Count,
            newFunctionCount,
            overlayBindingCount,
            exemptBindingCount);
    }

    private static void Validate(string commonRoot, string profilesDir, string modifiersPath)
    {
        if (string.IsNullOrWhiteSpace(commonRoot) || !Directory.Exists(commonRoot))
            throw new DirectoryNotFoundException("Select the DCS-Common repository root.");
        var expected = Path.Combine(commonRoot, "assets", "shared", "ui-layer");
        if (!Directory.Exists(expected))
            throw new InvalidOperationException($"The selected root is not DCS-Common; missing {expected}.");
        if (string.IsNullOrWhiteSpace(profilesDir) || !Directory.Exists(profilesDir))
            throw new DirectoryNotFoundException("Select the DCS UiLayer joystick profiles directory.");
        if (!Directory.EnumerateFiles(profilesDir, "*.diff.lua").Any())
            throw new InvalidOperationException("The selected UiLayer joystick directory contains no .diff.lua profiles.");
        if (string.IsNullOrWhiteSpace(modifiersPath) || !File.Exists(modifiersPath))
            throw new FileNotFoundException("Select the UiLayer modifiers.lua file.", modifiersPath);
        if (!string.Equals(Path.GetFileName(modifiersPath), "modifiers.lua", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The UI Layer modifier file must be named modifiers.lua.");
    }

    private static bool IsImportableRow(PreviewRow row) =>
        !string.IsNullOrWhiteSpace(row.Command) &&
        !string.IsNullOrWhiteSpace(row.ProfileFile) &&
        row.Status?.Contains("Unknown modifier", StringComparison.OrdinalIgnoreCase) != true;

    private static bool AppliesToInstance(
        JsonObject overlay,
        PreviewRow row,
        IReadOnlyDictionary<string, PreviewDevice> deviceByProfile)
    {
        if (overlay["appliesToInstances"] is not JsonArray instances || instances.Count == 0) return true;
        if (!deviceByProfile.TryGetValue(row.ProfileFile!, out var device)) return false;
        var instance = device.DeviceId == "tm-mfd" && !string.IsNullOrWhiteSpace(device.InstanceHint)
            ? $"MFD{device.InstanceHint}"
            : device.InstanceHint;
        return instances
            .Select(node => node?.GetValue<string>())
            .Any(value => string.Equals(value, instance, StringComparison.OrdinalIgnoreCase));
    }

    private static JsonObject ReadObject(string path) =>
        JsonNode.Parse(File.ReadAllText(path))?.AsObject()
        ?? throw new InvalidOperationException($"Invalid JSON object: {path}");

    private static void WriteJson(string path, JsonObject root) =>
        File.WriteAllText(path, root.ToJsonString(JsonOptions) + Environment.NewLine);

    private static string FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    private static string Slugify(string value)
    {
        var slug = new string(value.ToLowerInvariant()
            .Select(character => char.IsLetterOrDigit(character) ? character : '-')
            .ToArray());
        while (slug.Contains("--", StringComparison.Ordinal)) slug = slug.Replace("--", "-", StringComparison.Ordinal);
        return slug.Trim('-') is { Length: > 0 } result ? result : "ui-function";
    }

    private static string UniqueId(string baseId, ISet<string> used)
    {
        var candidate = baseId;
        var suffix = 2;
        while (!used.Add(candidate)) candidate = $"{baseId}-{suffix++}";
        return candidate;
    }
}
