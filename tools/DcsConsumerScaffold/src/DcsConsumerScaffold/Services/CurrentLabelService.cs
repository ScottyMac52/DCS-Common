using System.IO;
using System.Text.Json;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

public sealed record CurrentLabelImportResult(int CurrentCount, int SharedHardwareCount);

public sealed class CurrentLabelService
{
    public CurrentLabelImportResult Apply(
        string outputDir,
        PreviewDevice device,
        IEnumerable<PreviewRow> rows)
    {
        if (string.IsNullOrWhiteSpace(outputDir))
            throw new InvalidOperationException("Select the destination repository in Output directory first.");
        if (string.IsNullOrWhiteSpace(device.DeviceId))
            throw new InvalidOperationException("Current labels require a resolved device.");
        if (string.IsNullOrWhiteSpace(device.ProfileKey))
            throw new InvalidOperationException("Current labels require a resolved physical device instance.");

        var configPath = Path.Combine(outputDir, "config", "kneeboard.json");
        if (!File.Exists(configPath))
            throw new FileNotFoundException("The destination repository has no config/kneeboard.json.", configPath);

        using var document = JsonDocument.Parse(File.ReadAllText(configPath));
        if (!document.RootElement.TryGetProperty("pages", out var pagesElement) ||
            pagesElement.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException("The destination config/kneeboard.json has no pages array.");
        }

        var pages = pagesElement.EnumerateArray()
            .Where(page => StringEquals(Property(page, "deviceId"), device.DeviceId))
            .ToList();
        var page = SelectPage(pages, device);
        var current = new Dictionary<BindingKey, string?>();
        ReadScope(page, current);
        if (page.TryGetProperty("layers", out var layers) && layers.ValueKind == JsonValueKind.Array)
        {
            foreach (var layer in layers.EnumerateArray()) ReadScope(layer, current);
        }

        var selectedRows = rows.Where(row =>
            StringEquals(row.ProfileKey, device.ProfileKey) ||
            (!string.IsNullOrWhiteSpace(device.ProfileFile) && StringEquals(row.ProfileFile, device.ProfileFile)))
            .ToList();
        if (selectedRows.Count == 0)
            throw new InvalidOperationException($"No preview rows belong to {device.ProfileKey}.");

        var currentCount = 0;
        var sharedCount = 0;
        foreach (var row in selectedRows)
        {
            var key = new BindingKey(row.CalloutId ?? string.Empty, row.Key ?? string.Empty, row.Command ?? string.Empty);
            if (current.TryGetValue(key, out var label))
            {
                row.ApplyLabel(label, "current");
                currentCount++;
            }
            else
            {
                row.ResetLabel();
                sharedCount++;
            }
        }

        return new CurrentLabelImportResult(currentCount, sharedCount);
    }

    private static JsonElement SelectPage(IReadOnlyList<JsonElement> pages, PreviewDevice device)
    {
        if (pages.Count == 0)
            throw new InvalidOperationException($"The destination repository has no page for {device.DeviceId}.");

        var instance = CanonicalInstance(device);
        if (instance != null)
        {
            var instanceMatches = pages
                .Where(page => StringEquals(Property(page, "deviceInstance"), instance))
                .ToList();
            if (instanceMatches.Count == 1) return instanceMatches[0];
        }

        var profileMatches = pages.Where(page => ContainsProfile(page, device.ProfileKey!)).ToList();
        if (profileMatches.Count == 1) return profileMatches[0];
        if (pages.Count == 1) return pages[0];

        throw new InvalidOperationException(
            $"The destination repository has multiple {device.DeviceId} pages and none uniquely matches {device.ProfileKey}.");
    }

    private static void ReadScope(JsonElement scope, IDictionary<BindingKey, string?> labels)
    {
        var scopeLabels = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (scope.TryGetProperty("labels", out var labelElement) && labelElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in labelElement.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.String)
                    scopeLabels[property.Name] = property.Value.GetString();
            }
        }

        if (!scope.TryGetProperty("controls", out var controls) || controls.ValueKind != JsonValueKind.Object) return;
        foreach (var control in controls.EnumerateObject())
        {
            IEnumerable<JsonElement> references = control.Value.ValueKind == JsonValueKind.Array
                ? control.Value.EnumerateArray().ToArray()
                : [control.Value];
            foreach (var reference in references)
            {
                if (reference.ValueKind != JsonValueKind.Object) continue;
                var key = Property(reference, "key");
                var command = Property(reference, "command");
                if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(command)) continue;

                string? label = null;
                var defined = reference.TryGetProperty("label", out var referenceLabel) &&
                    referenceLabel.ValueKind == JsonValueKind.String;
                if (defined) label = referenceLabel.GetString();
                else defined = scopeLabels.TryGetValue(control.Name, out label);
                if (defined) labels[new BindingKey(control.Name, key, command)] = label;
            }
        }
    }

    private static bool ContainsProfile(JsonElement element, string profileKey)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Object => element.EnumerateObject().Any(property =>
                (property.NameEquals("profile") &&
                 property.Value.ValueKind == JsonValueKind.String &&
                 StringEquals(property.Value.GetString(), profileKey)) ||
                ContainsProfile(property.Value, profileKey)),
            JsonValueKind.Array => element.EnumerateArray().Any(item => ContainsProfile(item, profileKey)),
            _ => false,
        };
    }

    private static string? CanonicalInstance(PreviewDevice device)
    {
        if (string.IsNullOrWhiteSpace(device.InstanceHint)) return null;
        return StringEquals(device.DeviceId, "tm-mfd")
            ? $"MFD{device.InstanceHint}"
            : device.InstanceHint;
    }

    private static string? Property(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool StringEquals(string? left, string? right) =>
        string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

    private readonly record struct BindingKey(string CalloutId, string Key, string Command);
}
