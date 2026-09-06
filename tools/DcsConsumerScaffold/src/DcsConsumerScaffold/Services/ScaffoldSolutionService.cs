using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DcsConsumerScaffold.Services;

public sealed class ScaffoldSolutionDocument
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = ScaffoldSolutionService.CurrentSchemaVersion;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("import")]
    public ScaffoldSolutionImport Import { get; set; } = new();

    [JsonPropertyName("decisions")]
    public ScaffoldSolutionDecisions Decisions { get; set; } = new();
}

public sealed class ScaffoldSolutionImport
{
    [JsonPropertyName("target")]
    public string Target { get; set; } = "consumer";

    [JsonPropertyName("profilesDirectory")]
    public string ProfilesDirectory { get; set; } = string.Empty;

    [JsonPropertyName("modifiersPath")]
    public string? ModifiersPath { get; set; }

    [JsonPropertyName("mozaGrip")]
    public string MozaGrip { get; set; } = "standalone";

    [JsonPropertyName("commonRoot")]
    public string? CommonRoot { get; set; }

    [JsonPropertyName("outputDirectory")]
    public string? OutputDirectory { get; set; }

    [JsonPropertyName("displayName")]
    public string? DisplayName { get; set; }

    [JsonPropertyName("inputModuleId")]
    public string? InputModuleId { get; set; }

    [JsonPropertyName("kneeboardId")]
    public string? KneeboardId { get; set; }
}

public sealed class ScaffoldSolutionDecisions
{
    [JsonPropertyName("instanceRoles")]
    public SortedDictionary<string, string> InstanceRoles { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    [JsonPropertyName("semanticModifiers")]
    public SortedDictionary<string, string> SemanticModifiers { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    [JsonPropertyName("removedProfiles")]
    public SortedSet<string> RemovedProfiles { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class ScaffoldSolutionService
{
    public const int CurrentSchemaVersion = 1;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public ScaffoldSolutionDocument Load(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ScaffoldSolutionDocument document;
        try
        {
            var json = File.ReadAllText(path);
            document = JsonSerializer.Deserialize<ScaffoldSolutionDocument>(json, JsonOptions)
                ?? throw new InvalidDataException("The solution document is empty.");
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException($"Invalid scaffolding solution '{Path.GetFullPath(path)}': {ex.Message}", ex);
        }

        Validate(document);
        return document;
    }

    public void Save(string path, ScaffoldSolutionDocument document)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        Validate(document);

        var fullPath = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(fullPath)
            ?? throw new InvalidOperationException("The solution path has no parent directory.");
        Directory.CreateDirectory(directory);

        var tempPath = Path.Combine(directory, $".{Path.GetFileName(fullPath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            var json = JsonSerializer.Serialize(document, JsonOptions) + Environment.NewLine;
            File.WriteAllText(tempPath, json);
            if (File.Exists(fullPath))
                File.Move(tempPath, fullPath, true);
            else
                File.Move(tempPath, fullPath);
        }
        finally
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
        }
    }

    public void Delete(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        File.Delete(Path.GetFullPath(path));
    }

    public static void Validate(ScaffoldSolutionDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var errors = new List<string>();

        if (document.SchemaVersion != CurrentSchemaVersion)
            errors.Add(document.SchemaVersion > CurrentSchemaVersion
                ? $"schemaVersion {document.SchemaVersion} is newer than supported version {CurrentSchemaVersion}."
                : $"schemaVersion must be {CurrentSchemaVersion}.");

        var import = document.Import;
        if (import is null)
        {
            errors.Add("import is required.");
        }
        else
        {
            if (import.Target is not ("consumer" or "ui-layer"))
                errors.Add("import.target must be 'consumer' or 'ui-layer'.");
            if (string.IsNullOrWhiteSpace(import.ProfilesDirectory))
                errors.Add("import.profilesDirectory is required.");
            if (import.MozaGrip is not ("standalone" or "viper" or "hornet"))
                errors.Add("import.mozaGrip must be 'standalone', 'viper', or 'hornet'.");

            if (import.Target == "consumer")
            {
                Require(import.OutputDirectory, "import.outputDirectory", errors);
                Require(import.DisplayName, "import.displayName", errors);
                Require(import.InputModuleId, "import.inputModuleId", errors);
                Require(import.KneeboardId, "import.kneeboardId", errors);
            }
            else if (import.Target == "ui-layer")
            {
                Require(import.ModifiersPath, "import.modifiersPath", errors);
                Require(import.CommonRoot, "import.commonRoot", errors);
            }
        }

        if (errors.Count > 0)
            throw new InvalidDataException("The scaffolding solution is invalid:" + Environment.NewLine +
                string.Join(Environment.NewLine, errors.Select(error => $"• {error}")));
    }

    public static string ResolvePath(string path, string solutionPath) =>
        Path.IsPathRooted(path)
            ? Path.GetFullPath(path)
            : Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(solutionPath))!, path));

    private static void Require(string? value, string field, ICollection<string> errors)
    {
        if (string.IsNullOrWhiteSpace(value)) errors.Add($"{field} is required.");
    }
}
