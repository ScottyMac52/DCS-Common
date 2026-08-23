using System.ComponentModel;
using System.Runtime.CompilerServices;
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

    [JsonPropertyName("semanticModifiers")]
    public List<string> SemanticModifiers { get; set; } = [];

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

    [JsonIgnore]
    public bool CanPreview => !string.IsNullOrWhiteSpace(DeviceId) && !string.IsNullOrWhiteSpace(ProfileKey) && BindingCount > 0;

    [JsonIgnore]
    public string PreviewReason => CanPreview ? "Preview generated kneeboard" : "Resolve this device and at least one binding before previewing";
}

public sealed class PreviewRow : INotifyPropertyChanged
{
    private string? _label;
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

    [JsonPropertyName("bindingId")]
    public string? BindingId { get; set; }

    [JsonPropertyName("defaultLabel")]
    public string? DefaultLabel { get; set; }

    [JsonPropertyName("deviceLabel")]
    public string? DeviceLabel { get; set; }

    [JsonPropertyName("label")]
    public string? Label
    {
        get => _label;
        set => ApplyLabel(
            value,
            value == DefaultLabel ? "dcs" : value == DeviceLabel ? "device" : "user");
    }

    [JsonPropertyName("labelSource")]
    public string? LabelSource { get; set; }

    [JsonPropertyName("semanticChord")]
    public string? SemanticChord { get; set; }

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

    public event PropertyChangedEventHandler? PropertyChanged;

    public void ApplyLabel(string? label, string source)
    {
        if (_label == label && LabelSource == source) return;
        _label = label;
        LabelSource = source;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Label)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(LabelSource)));
    }

    public void ResetLabel() => ApplyLabel(DeviceLabel, "device");
}

public sealed class PreviewModifier
{
    private string? _semanticModifier;
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("device")]
    public string? Device { get; set; }

    [JsonPropertyName("key")]
    public string? Key { get; set; }

    [JsonPropertyName("mode")]
    public string? Mode { get; set; }

    [JsonPropertyName("semanticModifier")]
    public string? SemanticModifier
    {
        get => _semanticModifier;
        set => _semanticModifier = value;
    }
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

public sealed class CommandLabelGroup : INotifyPropertyChanged
{
    private string? _label;
    private string? _defaultLabel;
    private int _bindingCount;
    private bool _isMixed;

    public required string Command { get; init; }

    public string? DefaultLabel
    {
        get => _defaultLabel;
        private set => Set(ref _defaultLabel, value);
    }

    public string? Label
    {
        get => _label;
        set => Set(ref _label, value);
    }

    public int BindingCount
    {
        get => _bindingCount;
        private set => Set(ref _bindingCount, value);
    }

    public bool IsMixed
    {
        get => _isMixed;
        private set
        {
            if (Set(ref _isMixed, value))
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(State)));
        }
    }

    public string State => IsMixed ? "Mixed" : "Synchronized";

    public event PropertyChangedEventHandler? PropertyChanged;

    public void Refresh(IEnumerable<PreviewRow> source)
    {
        var rows = source.Where(row => string.Equals(row.Command, Command, StringComparison.Ordinal)).ToList();
        BindingCount = rows.Count;

        var defaults = rows.Select(row => row.DefaultLabel ?? string.Empty).Distinct(StringComparer.Ordinal).ToList();
        DefaultLabel = defaults.Count == 1 ? defaults[0] : defaults.Count == 0 ? string.Empty : "Mixed DCS labels";

        var labels = rows.Select(row => row.Label).Distinct(StringComparer.Ordinal).ToList();
        IsMixed = labels.Count > 1;
        Label = IsMixed || labels.Count == 0 ? null : labels[0];
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }
}

public sealed record RenderedPreviewPage(string File, string? Title, byte[] PngBytes);
