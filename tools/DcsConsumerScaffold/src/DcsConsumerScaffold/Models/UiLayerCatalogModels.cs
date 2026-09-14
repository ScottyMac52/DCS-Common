using System.Text.Json.Serialization;

namespace DcsConsumerScaffold.Models;

public sealed class UiLayerCatalogDocument
{
    [JsonPropertyName("root")] public string Root { get; set; } = string.Empty;
    [JsonPropertyName("scope")] public string Scope { get; set; } = string.Empty;
    [JsonPropertyName("fingerprint")] public string Fingerprint { get; set; } = string.Empty;
    [JsonPropertyName("valid")] public bool Valid { get; set; }
    [JsonPropertyName("profiles")] public List<UiLayerCatalogProfile> Profiles { get; set; } = [];
    [JsonPropertyName("bindings")] public List<UiLayerCatalogBinding> Bindings { get; set; } = [];
    [JsonPropertyName("modifiers")] public List<UiLayerCatalogModifier> Modifiers { get; set; } = [];
    [JsonPropertyName("possibilities")] public List<UiLayerDevicePossibility> Possibilities { get; set; } = [];
    [JsonPropertyName("errors")] public List<string> Errors { get; set; } = [];
    [JsonPropertyName("warnings")] public List<string> Warnings { get; set; } = [];
    [JsonPropertyName("changedFiles")] public List<string> ChangedFiles { get; set; } = [];
    [JsonPropertyName("summary")] public UiLayerCatalogSummary Summary { get; set; } = new();
}

public sealed class UiLayerProfileTarget
{
    [JsonPropertyName("category")] public string Category { get; set; } = "joystick";
    [JsonPropertyName("filename")] public string Filename { get; set; } = string.Empty;
    [JsonPropertyName("deviceId")] public string DeviceId { get; set; } = string.Empty;
}

public sealed class UiLayerPhysicalTarget
{
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("reformers")] public List<string> Reformers { get; set; } = [];
}

public sealed class UiLayerBindingEdit
{
    [JsonPropertyName("action")] public string Action { get; set; } = "upsert";
    [JsonPropertyName("profile")] public UiLayerProfileTarget? Profile { get; set; }
    [JsonPropertyName("section")] public string Section { get; set; } = "keyDiffs";
    [JsonPropertyName("key")] public string? Key { get; set; }
    [JsonPropertyName("reformers")] public List<string> Reformers { get; set; } = [];
    [JsonPropertyName("command")] public string Command { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("from")] public UiLayerPhysicalTarget? From { get; set; }
    [JsonPropertyName("to")] public UiLayerPhysicalTarget? To { get; set; }
    [JsonIgnore] public string Summary => $"{Action}: {Command} → {Profile?.Filename ?? "functions.json"} {Key ?? To?.Key} {string.Join(" + ", Reformers.Count > 0 ? Reformers : To?.Reformers ?? [])}";
}

public sealed class UiLayerCatalogSummary
{
    [JsonPropertyName("profiles")] public int Profiles { get; set; }
    [JsonPropertyName("bindings")] public int Bindings { get; set; }
    [JsonPropertyName("keys")] public int Keys { get; set; }
    [JsonPropertyName("axes")] public int Axes { get; set; }
    [JsonPropertyName("modifiers")] public int Modifiers { get; set; }
    [JsonPropertyName("possibilities")] public int Possibilities { get; set; }
    [JsonPropertyName("errors")] public int Errors { get; set; }
}

public sealed class UiLayerCatalogProfile
{
    [JsonPropertyName("category")] public string Category { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("relativePath")] public string RelativePath { get; set; } = string.Empty;
    [JsonPropertyName("fingerprint")] public string Fingerprint { get; set; } = string.Empty;
    [JsonPropertyName("keyCount")] public int KeyCount { get; set; }
    [JsonPropertyName("axisCount")] public int AxisCount { get; set; }
    [JsonPropertyName("effectiveCount")] public int EffectiveCount { get; set; }
    [JsonPropertyName("catalogState")] public string CatalogState { get; set; } = string.Empty;
}

public sealed class UiLayerCatalogBinding
{
    [JsonPropertyName("profile")] public string Profile { get; set; } = string.Empty;
    [JsonPropertyName("category")] public string Category { get; set; } = string.Empty;
    [JsonPropertyName("section")] public string Section { get; set; } = string.Empty;
    [JsonPropertyName("command")] public string Command { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("chord")] public string Chord { get; set; } = string.Empty;
    [JsonPropertyName("catalogState")] public string CatalogState { get; set; } = string.Empty;
}

public sealed class UiLayerCatalogModifier
{
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("device")] public string Device { get; set; } = string.Empty;
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("mode")] public string Mode { get; set; } = string.Empty;
    [JsonPropertyName("catalogState")] public string CatalogState { get; set; } = string.Empty;
}

public sealed class UiLayerDevicePossibility
{
    [JsonPropertyName("deviceId")] public string DeviceId { get; set; } = string.Empty;
    [JsonPropertyName("canonicalDeviceId")] public string CanonicalDeviceId { get; set; } = string.Empty;
    [JsonPropertyName("label")] public string Label { get; set; } = string.Empty;
    [JsonPropertyName("modifier")] public string? Modifier { get; set; }
    [JsonPropertyName("overlayStatus")] public string OverlayStatus { get; set; } = string.Empty;
    [JsonPropertyName("instances")] public List<string> Instances { get; set; } = [];
    [JsonPropertyName("catalogState")] public string CatalogState { get; set; } = string.Empty;
    [JsonPropertyName("applicability")] public string Applicability { get; set; } = string.Empty;
    public string InstanceDisplay => Instances.Count == 0 ? "All" : string.Join(", ", Instances);
}

public sealed class UiLayerCatalogComparison
{
    [JsonPropertyName("canonical")] public UiLayerCatalogDocument Canonical { get; set; } = new();
    [JsonPropertyName("source")] public UiLayerCatalogDocument Source { get; set; } = new();
    [JsonPropertyName("changes")] public List<UiLayerCatalogChange> Changes { get; set; } = [];
}

public sealed class UiLayerCatalogChange
{
    [JsonPropertyName("relativePath")] public string RelativePath { get; set; } = string.Empty;
    [JsonPropertyName("state")] public string State { get; set; } = string.Empty;
    [JsonPropertyName("action")] public string Action { get; set; } = "Keep";
}
