using System.Text.Json.Serialization;

namespace DcsConsumerScaffold.Models;

public sealed class PreviewDocument
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; }

    [JsonPropertyName("mode")]
    public string? Mode { get; set; }

    [JsonPropertyName("devices")]
    public List<PreviewDevice> Devices { get; set; } = [];

    [JsonPropertyName("rows")]
    public List<PreviewRow> Rows { get; set; } = [];

    [JsonPropertyName("modifiers")]
    public List<PreviewModifier> Modifiers { get; set; } = [];

    [JsonPropertyName("summary")]
    public PreviewSummary? Summary { get; set; }

    [JsonPropertyName("errors")]
    public List<string> Errors { get; set; } = [];
}

public sealed class PreviewDevice
{
    [JsonPropertyName("profileFile")]
    public string? ProfileFile { get; set; }

    [JsonPropertyName("stem")]
    public string? Stem { get; set; }

    [JsonPropertyName("deviceId")]
    public string? DeviceId { get; set; }

    [JsonPropertyName("instanceHint")]
    public string? InstanceHint { get; set; }

    [JsonPropertyName("guid")]
    public string? Guid { get; set; }

    [JsonPropertyName("physicalInstance")]
    public string? PhysicalInstance { get; set; }

    [JsonPropertyName("role")]
    public string? Role { get; set; }

    [JsonPropertyName("profileKey")]
    public string? ProfileKey { get; set; }

    [JsonPropertyName("repeatedDevice")]
    public bool RepeatedDevice { get; set; }

    [JsonPropertyName("mappingSource")]
    public string? MappingSource { get; set; }

    [JsonPropertyName("bindingCount")]
    public int BindingCount { get; set; }
}

public sealed class PreviewRow
{
    [JsonPropertyName("profileFile")]
    public string? ProfileFile { get; set; }

    [JsonPropertyName("stem")]
    public string? Stem { get; set; }

    [JsonPropertyName("deviceId")]
    public string? DeviceId { get; set; }

    [JsonPropertyName("instanceHint")]
    public string? InstanceHint { get; set; }

    [JsonPropertyName("mappingSource")]
    public string? MappingSource { get; set; }

    [JsonPropertyName("key")]
    public string? Key { get; set; }

    [JsonPropertyName("chord")]
    public string? Chord { get; set; }

    [JsonPropertyName("command")]
    public string? Command { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("calloutId")]
    public string? CalloutId { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("modifierModes")]
    public List<string?> ModifierModes { get; set; } = [];

    public string ModifierModesDisplay =>
        ModifierModes.Count == 0
            ? string.Empty
            : string.Join(", ", ModifierModes.Select(m => m ?? "?"));
}

public sealed class PreviewModifier
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("device")]
    public string? Device { get; set; }

    [JsonPropertyName("key")]
    public string? Key { get; set; }

    [JsonPropertyName("mode")]
    public string? Mode { get; set; }
}

public sealed class PreviewSummary
{
    [JsonPropertyName("profileCount")]
    public int ProfileCount { get; set; }

    [JsonPropertyName("rowCount")]
    public int RowCount { get; set; }

    [JsonPropertyName("mappedDevices")]
    public int MappedDevices { get; set; }

    [JsonPropertyName("unmappedDevices")]
    public int UnmappedDevices { get; set; }

    [JsonPropertyName("errorCount")]
    public int ErrorCount { get; set; }
}
