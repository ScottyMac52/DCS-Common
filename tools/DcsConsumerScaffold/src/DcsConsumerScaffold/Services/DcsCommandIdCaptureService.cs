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

    public void SaveCaptureScript(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Choose where to save the DCS capture script.", nameof(path));
        File.WriteAllText(path, CaptureScript.Replace("\n", Environment.NewLine));
    }

    public string Instructions(string scriptPath) =>
        $"Add this line temporarily to the beginning of DCS World\\Config\\Input\\Aircrafts\\Default\\keyboard\\default.lua:{Environment.NewLine}{Environment.NewLine}" +
        "dofile([[" + Path.GetFullPath(scriptPath).Replace('\\', '/') + "]])" + Environment.NewLine + Environment.NewLine +
        $"Open DCS Controls once. The capture will be written to Saved Games\\DCS...\\Logs\\{OutputFileName}. Remove the temporary dofile line afterward, then use Load ID capture… in the importer.";

    private const string CaptureScript = """
local lfs = require('lfs')
local env = getfenv()
local results = {}
for name, value in pairs(env) do
  if type(name) == 'string' and type(value) == 'number' and string.find(name, '^iCommand') then
    table.insert(results, { symbol = name, id = value })
  end
end
table.sort(results, function(left, right)
  if left.id == right.id then return left.symbol < right.symbol end
  return left.id < right.id
end)
local path = lfs.writedir() .. 'Logs/DcsGlobalCommandIds.json'
local file = assert(io.open(path, 'w'))
file:write('{"schemaVersion":1,"dcsVersion":"' .. tostring(_G.DCS_VERSION or 'unknown') .. '","commands":[')
for index, command in ipairs(results) do
  if index > 1 then file:write(',') end
  file:write(string.format('{"symbol":"%s","id":%d}', command.symbol, command.id))
end
file:write(']}')
file:close()
""";
}
