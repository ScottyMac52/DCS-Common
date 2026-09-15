using System.Text.Json.Serialization;

namespace DcsConsumerScaffold.Models;

public sealed class IpiModifierDefinition
{
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("device")] public string Device { get; set; } = string.Empty;
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("mode")] public string Mode { get; set; } = "hold";
    [JsonPropertyName("semanticModifier")] public string? SemanticModifier { get; set; }
    [JsonPropertyName("deviceId")] public string? DeviceId { get; set; }
}

public sealed class IpiAuthoredDeviceDefinition
{
    [JsonPropertyName("deviceId")] public string DeviceId { get; set; } = string.Empty;
    [JsonPropertyName("profileFile")] public string ProfileFile { get; set; } = string.Empty;
    [JsonPropertyName("deviceInstance")] public string? DeviceInstance { get; set; }
    [JsonPropertyName("role")] public string? Role { get; set; }
}

public sealed class IpiUiLayerUtilization
{
    [JsonPropertyName("mode")] public string Mode { get; set; } = "explicit";
    [JsonPropertyName("bindings")] public List<IpiUiLayerSelection> Bindings { get; set; } = [];
}

public sealed class IpiUiLayerSelection
{
    [JsonPropertyName("deviceId")] public string DeviceId { get; set; } = string.Empty;
    [JsonPropertyName("deviceInstance")] public string? DeviceInstance { get; set; }
    [JsonPropertyName("functionId")] public string FunctionId { get; set; } = string.Empty;
    [JsonPropertyName("modifiers")] public List<string> Modifiers { get; set; } = [];
    [JsonIgnore] public string ModifierDisplay
    {
        get => string.Join(" + ", Modifiers);
        set => Modifiers = (value ?? string.Empty).Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    }
}

public sealed class IpiModuleAuthoringState
{
    [JsonPropertyName("fingerprint")] public string Fingerprint { get; set; } = string.Empty;
    [JsonPropertyName("initialized")] public bool Initialized { get; set; }
    [JsonPropertyName("modifiers")] public List<IpiModifierDefinition> Modifiers { get; set; } = [];
    [JsonPropertyName("uiLayerUtilization")] public IpiUiLayerUtilization? UiLayerUtilization { get; set; }
}

public sealed class IpiAuthoringResult
{
    [JsonPropertyName("fingerprint")] public string? Fingerprint { get; set; }
    [JsonPropertyName("profilesDirectory")] public string? ProfilesDirectory { get; set; }
    [JsonPropertyName("changedFiles")] public List<string> ChangedFiles { get; set; } = [];
}

public sealed class IpiHardwareChoice
{
    public string DeviceId { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public override string ToString() => $"{Label} — {DeviceId}";
}

public sealed class IpiSharedControlChoice
{
    public string Id { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string Type { get; set; } = "button";
    public string HardwareLabel { get; set; } = string.Empty;
    public string Section => Type == "axis" ? "axisDiffs" : "keyDiffs";
    public override string ToString() => $"{HardwareLabel} — {Id}";
}

public sealed class IpiLayerChoice
{
    public string Name { get; set; } = string.Empty;
    public string DisplayName => string.IsNullOrEmpty(Name) ? "Base (no modifier)" : Name;
    public override string ToString() => DisplayName;
}

public sealed class IpiUiLayerBindingChoice
{
    public bool IsSelected { get; set; }
    public string BindingId { get; set; } = string.Empty;
    public string DeviceId { get; set; } = string.Empty;
    public string? DeviceInstance { get; set; }
    public string FunctionId { get; set; } = string.Empty;
    public string FunctionLabel { get; set; } = string.Empty;
    public string ControlId { get; set; } = string.Empty;
    public string HardwareLabel { get; set; } = string.Empty;
    public List<string> Modifiers { get; set; } = [];
    public string ModifierDisplay => Modifiers.Count == 0 ? "Base" : string.Join(" + ", Modifiers);
    public IpiUiLayerSelection ToSelection() => new()
    {
        DeviceId = DeviceId, DeviceInstance = DeviceInstance, FunctionId = FunctionId, Modifiers = [.. Modifiers],
    };
}

public sealed class IpiUiFunctionChoice
{
    public string Id { get; set; } = string.Empty;
    public string Command { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public override string ToString() => $"{Category} — {Label}";
}
