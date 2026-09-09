using System.IO;
using System.Text.Json;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

public sealed class UiLayerProjectionService
{
    public IReadOnlyList<UiLayerProjection> Load(
        string commonRoot,
        PreviewDevice target,
        IEnumerable<PreviewDevice> moduleDevices)
    {
        using var functions = Read(commonRoot, "assets", "shared", "ui-layer", "functions.json");
        using var overlays = Read(commonRoot, "assets", "shared", "ui-layer", "hardware-overlays.json");
        using var manifest = Read(commonRoot, "assets", "shared", "hardware", "manifest.json");
        var devices = manifest.RootElement.GetProperty("devices").EnumerateArray().ToArray();
        var targetId = target.DeviceId ?? string.Empty;
        var canonical = FindDevice(targetId, devices);
        if (canonical.ValueKind == JsonValueKind.Undefined) return [];
        var canonicalId = canonical.GetProperty("id").GetString()!;
        if (!overlays.RootElement.GetProperty("devices").TryGetProperty(canonicalId, out var overlay)) return [];
        if (!AppliesToInstance(overlay, target)) return [];

        var selectedModifiers = moduleDevices
            .Where(device => !device.IsRepositoryOnly && device.BindingCount > 0 && !string.IsNullOrWhiteSpace(device.DeviceId))
            .Select(device => ResolveManifestModifier(device.DeviceId!, devices))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal)
            .Cast<string>()
            .ToArray();
        var directModifier = ResolveManifestModifier(targetId, devices);
        var configuredModifier = overlay.TryGetProperty("modifier", out var modifierElement) ? modifierElement.GetString() : null;
        var modifiers = string.Equals(configuredModifier, "grip-shift", StringComparison.Ordinal)
            ? selectedModifiers
            : [directModifier ?? configuredModifier ?? string.Empty];
        modifiers = modifiers.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.Ordinal).ToArray();
        if (modifiers.Length == 0) return [];

        var definitions = functions.RootElement.GetProperty("functions").EnumerateArray().ToDictionary(
            item => item.GetProperty("id").GetString()!, StringComparer.Ordinal);
        var result = new List<UiLayerProjection>();
        foreach (var binding in overlay.GetProperty("bindings").EnumerateObject())
        {
            if (!definitions.TryGetValue(binding.Name, out var definition)) continue;
            foreach (var modifier in modifiers)
                result.Add(new(
                    binding.Value.GetString()!,
                    definition.GetProperty("label").GetString()!,
                    definition.GetProperty("category").GetString()!,
                    modifier));
        }
        return result;
    }

    private static JsonDocument Read(string root, params string[] parts) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(new[] { root }.Concat(parts).ToArray())));

    private static JsonElement FindDevice(string deviceId, JsonElement[] devices) => devices.FirstOrDefault(device =>
        string.Equals(device.GetProperty("id").GetString(), deviceId, StringComparison.Ordinal) ||
        device.TryGetProperty("aliases", out var aliases) && aliases.EnumerateArray().Any(alias =>
            string.Equals(alias.GetString(), deviceId, StringComparison.Ordinal)));

    private static string? ResolveManifestModifier(string deviceId, JsonElement[] devices)
    {
        var device = FindDevice(deviceId, devices);
        if (device.ValueKind == JsonValueKind.Undefined) return null;
        if (device.TryGetProperty("uiLayerModifiers", out var aliases) && aliases.TryGetProperty(deviceId, out var mapped))
            return mapped.GetString();
        return string.Equals(device.GetProperty("id").GetString(), deviceId, StringComparison.Ordinal) &&
               device.TryGetProperty("uiLayerModifier", out var direct) ? direct.GetString() : null;
    }

    private static bool AppliesToInstance(JsonElement overlay, PreviewDevice target)
    {
        if (!overlay.TryGetProperty("appliesToInstances", out var instances)) return true;
        var actual = target.InstanceHint is null ? null : target.DeviceId == "tm-mfd" ? $"MFD{target.InstanceHint}" : target.InstanceHint;
        return instances.EnumerateArray().Any(instance =>
            string.Equals(instance.GetString(), actual, StringComparison.OrdinalIgnoreCase));
    }
}
