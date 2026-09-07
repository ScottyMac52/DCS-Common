using System.IO;
using System.Text.Json;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

public sealed class DcsCommandCatalogService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public DcsCommandCatalogDocument Load(string path, string? expectedModuleId = null)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select a DCS command catalog JSON file.", nameof(path));
        if (!File.Exists(path)) throw new FileNotFoundException("DCS command catalog was not found.", path);

        DcsCommandCatalogDocument document;
        try
        {
            document = JsonSerializer.Deserialize<DcsCommandCatalogDocument>(File.ReadAllText(path), JsonOptions)
                ?? throw new InvalidDataException("The catalog JSON is empty.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"The command catalog is not valid JSON: {exception.Message}", exception);
        }

        if (document.SchemaVersion != 1)
            throw new InvalidDataException($"Unsupported command catalog schemaVersion {document.SchemaVersion}; expected 1.");
        if (string.IsNullOrWhiteSpace(document.ModuleId))
            throw new InvalidDataException("The command catalog must specify moduleId.");
        if (!string.IsNullOrWhiteSpace(expectedModuleId) &&
            !string.Equals(document.ModuleId, expectedModuleId, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"Catalog module '{document.ModuleId}' does not match selected input module '{expectedModuleId}'.");

        var invalid = document.Commands.FirstOrDefault(command =>
            string.IsNullOrWhiteSpace(command.BindingKey) || string.IsNullOrWhiteSpace(command.Name));
        if (invalid is not null)
            throw new InvalidDataException("Every command must contain a non-empty bindingKey and name.");

        var duplicate = document.Commands
            .GroupBy(command => command.BindingKey, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
            throw new InvalidDataException($"Duplicate canonical bindingKey '{duplicate.Key}'.");

        foreach (var command in document.Commands)
        {
            command.BindingKey = command.BindingKey.Trim();
            command.Name = command.Name.Trim();
            command.Type = NormalizeType(command.Type);
            command.CategoryPath = command.CategoryPath.Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value.Trim()).ToList();
            command.Aliases = command.Aliases.Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }
        document.Commands = document.Commands.OrderBy(command => command.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(command => command.Name, StringComparer.OrdinalIgnoreCase).ToList();
        return document;
    }

    public IReadOnlyList<DcsCommandCatalogEntry> Filter(
        IEnumerable<DcsCommandCatalogEntry> commands,
        string? search,
        string? category,
        string? type,
        string? bindingState)
    {
        var query = commands;
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(command => SearchValues(command).Any(value => value.Contains(term, StringComparison.OrdinalIgnoreCase)));
        }
        if (!string.IsNullOrWhiteSpace(category) && category != "All")
            query = query.Where(command => string.Equals(command.Category, category, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(type) && type != "All")
            query = query.Where(command => string.Equals(command.Type, type, StringComparison.OrdinalIgnoreCase));
        if (bindingState == "Bound") query = query.Where(command => command.IsBound);
        if (bindingState == "Unbound") query = query.Where(command => !command.IsBound);
        return query.ToList();
    }

    public void ReconcileBindings(IEnumerable<DcsCommandCatalogEntry> commands, IEnumerable<PreviewRow> rows)
    {
        var counts = rows.Where(row => !string.IsNullOrWhiteSpace(row.Command))
            .GroupBy(row => row.Command!, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
        foreach (var command in commands)
            command.SetBindingCount(counts.GetValueOrDefault(command.BindingKey));
    }

    private static IEnumerable<string> SearchValues(DcsCommandCatalogEntry command) =>
        new[] { command.Name, command.RawName, command.Category, command.BindingKey }
            .Where(value => !string.IsNullOrWhiteSpace(value))!
            .Concat(command.Aliases);

    private static string NormalizeType(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "axis" => "axis",
        "button" or "switch" or "button/switch" => "button",
        _ => throw new InvalidDataException($"Unsupported command type '{value}'. Expected 'button' or 'axis'."),
    };
}
