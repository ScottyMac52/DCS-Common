using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace DcsConsumerScaffold.Models;

public sealed class DcsCommandCatalogDocument
{
    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; }
    [JsonPropertyName("dcsVersion")] public string? DcsVersion { get; set; }
    [JsonPropertyName("moduleId")] public string? ModuleId { get; set; }
    [JsonPropertyName("locale")] public string? Locale { get; set; }
    [JsonPropertyName("generatedAt")] public DateTimeOffset? GeneratedAt { get; set; }
    [JsonPropertyName("sourceFingerprint")] public string? SourceFingerprint { get; set; }
    [JsonPropertyName("commands")] public List<DcsCommandCatalogEntry> Commands { get; set; } = [];
}

public sealed class DcsCommandCatalogEntry : INotifyPropertyChanged
{
    private bool _isBound;
    private int _bindingCount;

    [JsonPropertyName("bindingKey")] public string BindingKey { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("rawName")] public string? RawName { get; set; }
    [JsonPropertyName("categoryPath")] public List<string> CategoryPath { get; set; } = [];
    [JsonPropertyName("type")] public string Type { get; set; } = "button";
    [JsonPropertyName("aliases")] public List<string> Aliases { get; set; } = [];
    [JsonPropertyName("actions")] public DcsCommandActions? Actions { get; set; }
    [JsonPropertyName("source")] public DcsCommandSource? Source { get; set; }

    [JsonIgnore] public string Category => CategoryPath.Count == 0 ? "Uncategorized" : string.Join(" / ", CategoryPath);
    [JsonIgnore] public string SourceDisplay => Source?.Provider ?? "imported-catalog";
    [JsonIgnore] public string BindingState => IsBound ? $"Bound ({BindingCount})" : "Unbound";

    [JsonIgnore]
    public bool IsBound
    {
        get => _isBound;
        private set => Set(ref _isBound, value);
    }

    [JsonIgnore]
    public int BindingCount
    {
        get => _bindingCount;
        private set => Set(ref _bindingCount, value);
    }

    public void SetBindingCount(int count)
    {
        BindingCount = count;
        IsBound = count > 0;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(BindingState)));
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

public sealed class DcsCommandActions
{
    [JsonPropertyName("down")] public int? Down { get; set; }
    [JsonPropertyName("up")] public int? Up { get; set; }
    [JsonPropertyName("pressed")] public int? Pressed { get; set; }
    [JsonPropertyName("cockpitDeviceId")] public int? CockpitDeviceId { get; set; }
    [JsonPropertyName("valueDown")] public double? ValueDown { get; set; }
    [JsonPropertyName("valueUp")] public double? ValueUp { get; set; }
}

public sealed class DcsCommandSource
{
    [JsonPropertyName("provider")] public string? Provider { get; set; }
    [JsonPropertyName("file")] public string? File { get; set; }
}
