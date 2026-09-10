using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DcsConsumerScaffold.Services;

public sealed class DcsCommandIdCaptureDocument
{
    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; }
    [JsonPropertyName("dcsVersion")] public string? DcsVersion { get; set; }
    [JsonPropertyName("commands")] public List<DcsCommandIdCaptureEntry> Commands { get; set; } = [];
}

public sealed class DcsCommandIdCaptureEntry
{
    [JsonPropertyName("symbol")] public string Symbol { get; set; } = string.Empty;
    [JsonPropertyName("id")] public int Id { get; set; }
}

public sealed class DcsCommandIdCaptureService
{
    public const string OutputFileName = "DcsGlobalCommandIds.json";

    public IReadOnlyDictionary<string, int> Load(string path, out string? dcsVersion)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("DCS command-ID capture was not found.", path);
        DcsCommandIdCaptureDocument document;
        try
        {
            document = JsonSerializer.Deserialize<DcsCommandIdCaptureDocument>(File.ReadAllText(path),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidDataException("The command-ID capture is empty.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"The command-ID capture is not valid JSON: {exception.Message}", exception);
        }
        if (document.SchemaVersion != 1) throw new InvalidDataException($"Unsupported command-ID capture schemaVersion {document.SchemaVersion}; expected 1.");
        var invalid = document.Commands.FirstOrDefault(item =>
            !item.Symbol.StartsWith("iCommand", StringComparison.Ordinal) || item.Symbol.Any(character => !char.IsLetterOrDigit(character) && character != '_'));
        if (invalid is not null) throw new InvalidDataException($"Invalid captured DCS command symbol '{invalid.Symbol}'.");
        var conflict = document.Commands.GroupBy(item => item.Symbol, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Select(item => item.Id).Distinct().Count() > 1);
        if (conflict is not null) throw new InvalidDataException($"Captured DCS command '{conflict.Key}' has conflicting numeric IDs.");
        dcsVersion = string.IsNullOrWhiteSpace(document.DcsVersion) ||
                     string.Equals(document.DcsVersion, "unknown", StringComparison.OrdinalIgnoreCase)
            ? null
            : document.DcsVersion.Trim();
        return document.Commands.GroupBy(item => item.Symbol, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().Id, StringComparer.Ordinal);
    }

}
