using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

public sealed record RepositoryDevice(
    string ProfileKey,
    string ProfileFile,
    string DeviceId,
    string? Instance,
    string? Role,
    HashSet<string> Bindings);

public sealed record RepositoryModifier(
    string SemanticName,
    string NativeName,
    string? Device,
    string? Key,
    string? Mode,
    bool Used);

public sealed record RepositoryCommand(string Command, string? Label, HashSet<string> Bindings);

public sealed record RepositoryPreviewSnapshot(
    bool HasBaseline,
    bool IsNewRepository,
    IReadOnlyList<RepositoryDevice> Devices,
    IReadOnlyList<RepositoryModifier> Modifiers,
    IReadOnlyDictionary<string, RepositoryCommand> Commands);

public sealed class PreviewComparisonService
{
    private static readonly Regex GuidSuffix = new(@"\s*\{[0-9A-Fa-f-]{36}\}\s*$", RegexOptions.Compiled);

    public RepositoryPreviewSnapshot Load(string? outputDir)
    {
        if (string.IsNullOrWhiteSpace(outputDir))
            return new(false, false, [], [], new Dictionary<string, RepositoryCommand>());
        var configPath = Path.Combine(outputDir, "config", "kneeboard.json");
        if (!File.Exists(configPath))
            return new(true, true, [], [], new Dictionary<string, RepositoryCommand>());

        using var document = JsonDocument.Parse(File.ReadAllText(configPath));
        var root = document.RootElement;
        var profiles = ReadProfiles(root);
        var devices = new Dictionary<string, MutableDevice>(StringComparer.OrdinalIgnoreCase);
        var commands = new Dictionary<string, MutableCommand>(StringComparer.Ordinal);
        var usedModifiers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (root.TryGetProperty("pages", out var pages) && pages.ValueKind == JsonValueKind.Array)
        {
            foreach (var page in pages.EnumerateArray())
            {
                var deviceId = Property(page, "deviceId") ?? string.Empty;
                var instance = Property(page, "deviceInstance");
                var role = Property(page, "role");
                ReadScope(page, deviceId, instance, role, profiles, devices, commands, usedModifiers);
                if (page.TryGetProperty("layers", out var layers) && layers.ValueKind == JsonValueKind.Array)
                    foreach (var layer in layers.EnumerateArray())
                        ReadScope(layer, deviceId, instance, role, profiles, devices, commands, usedModifiers);
            }
        }

        var modifiers = ReadModifiers(root, outputDir, usedModifiers);
        return new(
            true,
            false,
            devices.Values.Select(item => new RepositoryDevice(
                item.ProfileKey, item.ProfileFile, item.DeviceId, item.Instance, item.Role, item.Bindings)).ToList(),
            modifiers,
            commands.ToDictionary(
                pair => pair.Key,
                pair => new RepositoryCommand(pair.Key, pair.Value.Label, pair.Value.Bindings),
                StringComparer.Ordinal));
    }

    public void Apply(
        RepositoryPreviewSnapshot snapshot,
        IList<PreviewDevice> devices,
        IList<PreviewModifier> modifiers,
        IEnumerable<PreviewRow> rows,
        IList<CommandLabelGroup> commands)
    {
        RemoveSynthetic(devices, modifiers, commands);
        var loadedRows = rows.ToList();
        if (!snapshot.HasBaseline)
        {
            SetNotCompared(devices, modifiers, loadedRows, commands);
            return;
        }

        CompareDevices(snapshot, devices, loadedRows);
        CompareModifiers(snapshot, modifiers, loadedRows);
        CompareCommands(snapshot, commands, loadedRows);
    }

    private static void CompareDevices(
        RepositoryPreviewSnapshot snapshot,
        IList<PreviewDevice> devices,
        IReadOnlyList<PreviewRow> rows)
    {
        var matched = new HashSet<RepositoryDevice>();
        foreach (var device in devices)
        {
            var deviceRows = RowsForDevice(device, rows);
            if (deviceRows.Count == 0 || device.BindingCount == 0)
            {
                Set(device, PreviewChangeState.Unused, "Physical device has no effective loaded bindings.");
                continue;
            }
            var current = MatchDevice(device, snapshot.Devices);
            if (current is null)
            {
                Set(device, PreviewChangeState.New, "New physical device instance.");
                SetRows(deviceRows, PreviewChangeState.New, "Binding belongs to a new physical device instance.");
                continue;
            }
            matched.Add(current);
            var loadedBindings = deviceRows.Select(BindingSignature).ToHashSet(StringComparer.Ordinal);
            var reasons = new List<string>();
            if (!Same(device.DeviceId, current.DeviceId)) reasons.Add($"deviceId changed: {current.DeviceId} → {device.DeviceId}");
            if (!Same(device.InstanceHint, NormalizeInstance(current.Instance))) reasons.Add("physical instance changed");
            if (!Same(device.Role, current.Role)) reasons.Add($"role changed: {current.Role ?? "(none)"} → {device.Role ?? "(none)"}");
            if (!loadedBindings.SetEquals(current.Bindings)) reasons.Add("effective bindings changed");
            var state = reasons.Count == 0 ? PreviewChangeState.Unchanged : PreviewChangeState.Changed;
            var reason = reasons.Count == 0 ? "Physical device instance is unchanged." : string.Join("; ", reasons);
            Set(device, state, reason);
            SetRows(deviceRows, state, reason);
        }

        foreach (var current in snapshot.Devices.Where(item => !matched.Contains(item)))
        {
            devices.Add(new PreviewDevice
            {
                ProfileKey = current.ProfileKey,
                ProfileFile = current.ProfileFile,
                Stem = PhysicalName(current.ProfileFile),
                DeviceId = current.DeviceId,
                InstanceHint = NormalizeInstance(current.Instance),
                PhysicalInstance = current.Instance,
                Role = current.Role,
                BindingCount = current.Bindings.Count,
                IsRepositoryOnly = true,
                ChangeState = PreviewChangeState.Unused,
                ChangeReason = "Definition exists in the repository but not in the loaded input.",
            });
        }
    }

    private static void CompareModifiers(
        RepositoryPreviewSnapshot snapshot,
        IList<PreviewModifier> modifiers,
        IReadOnlyList<PreviewRow> rows)
    {
        var matched = new HashSet<RepositoryModifier>();
        foreach (var modifier in modifiers)
        {
            var used = rows.Any(row => ChordContains(row, modifier.Name) || ChordContains(row, modifier.SemanticModifier));
            var current = snapshot.Modifiers.FirstOrDefault(item => Same(item.NativeName, modifier.Name));
            if (!used)
            {
                Set(modifier, PreviewChangeState.Unused, "Modifier is not referenced by any loaded binding.");
                if (current is not null) matched.Add(current);
                continue;
            }
            if (current is null)
            {
                Set(modifier, PreviewChangeState.New, "New referenced modifier.");
                continue;
            }
            matched.Add(current);
            var reasons = new List<string>();
            if (!Same(current.Device, modifier.Device)) reasons.Add("physical device changed");
            if (!Same(current.Key, modifier.Key)) reasons.Add($"key changed: {current.Key} → {modifier.Key}");
            if (!Same(current.Mode, modifier.Mode)) reasons.Add($"mode changed: {current.Mode} → {modifier.Mode}");
            if (!Same(current.SemanticName, modifier.SemanticModifier ?? modifier.Name)) reasons.Add("semantic modifier changed");
            Set(modifier,
                reasons.Count == 0 ? PreviewChangeState.Unchanged : PreviewChangeState.Changed,
                reasons.Count == 0 ? "Modifier is unchanged." : string.Join("; ", reasons));
        }
        foreach (var current in snapshot.Modifiers.Where(item => !matched.Contains(item)))
        {
            modifiers.Add(new PreviewModifier
            {
                Name = current.NativeName,
                Device = current.Device,
                Key = current.Key,
                Mode = current.Mode,
                SemanticModifier = current.SemanticName,
                IsRepositoryOnly = true,
                ChangeState = PreviewChangeState.Unused,
                ChangeReason = "Modifier exists in the repository but not in the loaded input.",
            });
        }
    }

    private static void CompareCommands(
        RepositoryPreviewSnapshot snapshot,
        IList<CommandLabelGroup> commands,
        IReadOnlyList<PreviewRow> rows)
    {
        var matched = new HashSet<string>(StringComparer.Ordinal);
        foreach (var group in commands)
        {
            var groupRows = rows.Where(row => string.Equals(row.Command, group.Command, StringComparison.Ordinal)).ToList();
            if (groupRows.Count == 0)
            {
                Set(group, PreviewChangeState.Unused, "Command has no loaded bindings.");
                continue;
            }
            if (group.IsMixed)
            {
                Set(group, PreviewChangeState.OutOfSync,
                    $"{groupRows.Count} bindings use {groupRows.Select(row => row.Label).Distinct(StringComparer.Ordinal).Count()} different labels.");
                SetRows(groupRows, PreviewChangeState.OutOfSync, group.ChangeReason);
                if (snapshot.Commands.ContainsKey(group.Command)) matched.Add(group.Command);
                continue;
            }
            if (!snapshot.Commands.TryGetValue(group.Command, out var current))
            {
                Set(group, PreviewChangeState.New, "New DCS command.");
                SetRows(groupRows, PreviewChangeState.New, "Binding uses a new DCS command.");
                continue;
            }
            matched.Add(group.Command);
            var bindings = groupRows.Select(BindingSignature).ToHashSet(StringComparer.Ordinal);
            var reasons = new List<string>();
            if (!bindings.SetEquals(current.Bindings)) reasons.Add("binding membership changed");
            if (!string.Equals(group.Label, current.Label, StringComparison.Ordinal)) reasons.Add("effective synchronized label changed");
            var state = reasons.Count == 0 ? PreviewChangeState.Unchanged : PreviewChangeState.Changed;
            var reason = reasons.Count == 0 ? "Command and label are unchanged." : string.Join("; ", reasons);
            Set(group, state, reason);
            SetRows(groupRows, state, reason);
        }
        foreach (var current in snapshot.Commands.Values.Where(item => !matched.Contains(item.Command)))
        {
            commands.Add(new CommandLabelGroup
            {
                Command = current.Command,
                Label = current.Label,
                IsRepositoryOnly = true,
                ChangeState = PreviewChangeState.Unused,
                ChangeReason = "Command exists in the repository but has no loaded binding.",
            });
        }
    }

    private static Dictionary<string, string> ReadProfiles(JsonElement root)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!root.TryGetProperty("profiles", out var profiles) || profiles.ValueKind != JsonValueKind.Object) return result;
        foreach (var property in profiles.EnumerateObject())
            if (property.Value.ValueKind == JsonValueKind.String) result[property.Name] = property.Value.GetString() ?? string.Empty;
        return result;
    }

    private static void ReadScope(
        JsonElement scope,
        string deviceId,
        string? instance,
        string? role,
        IReadOnlyDictionary<string, string> profiles,
        IDictionary<string, MutableDevice> devices,
        IDictionary<string, MutableCommand> commands,
        ISet<string> usedModifiers)
    {
        var labels = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (scope.TryGetProperty("labels", out var labelObject) && labelObject.ValueKind == JsonValueKind.Object)
            foreach (var property in labelObject.EnumerateObject())
                if (property.Value.ValueKind == JsonValueKind.String) labels[property.Name] = property.Value.GetString();
        if (!scope.TryGetProperty("controls", out var controls) || controls.ValueKind != JsonValueKind.Object) return;
        var scopeModifiers = ReadStringArray(scope, "modifiers").Concat(ReadStringArray(scope, "activators"))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        foreach (var control in controls.EnumerateObject())
        {
            var references = control.Value.ValueKind == JsonValueKind.Array
                ? control.Value.EnumerateArray().ToArray()
                : [control.Value];
            foreach (var reference in references.Where(item => item.ValueKind == JsonValueKind.Object))
            {
                var profile = Property(reference, "profile");
                var key = Property(reference, "key");
                var command = Property(reference, "command");
                if (string.IsNullOrWhiteSpace(profile) || string.IsNullOrWhiteSpace(key)) continue;
                var profileFile = profiles.GetValueOrDefault(profile, profile);
                if (!devices.TryGetValue(profile, out var device))
                {
                    device = new(profile, profileFile, deviceId, instance, role);
                    devices[profile] = device;
                }
                var referenceModifiers = ReadStringArray(reference, "modifiers").ToArray();
                var effectiveModifiers = referenceModifiers.Length > 0 ? referenceModifiers : scopeModifiers;
                var signature = BindingSignature(control.Name, key, command, effectiveModifiers);
                device.Bindings.Add(signature);
                foreach (var modifier in effectiveModifiers) usedModifiers.Add(modifier);
                if (string.IsNullOrWhiteSpace(command)) continue;
                if (!commands.TryGetValue(command, out var commandEntry))
                {
                    commandEntry = new MutableCommand(command);
                    commands[command] = commandEntry;
                }
                commandEntry.Bindings.Add(signature);
                var referenceLabel = Property(reference, "label");
                commandEntry.Label ??= referenceLabel ?? labels.GetValueOrDefault(control.Name);
            }
        }
    }

    private static IReadOnlyList<RepositoryModifier> ReadModifiers(JsonElement root, string outputDir, ISet<string> used)
    {
        var physical = ReadPhysicalModifiers(root, outputDir);
        var result = new List<RepositoryModifier>();
        if (!root.TryGetProperty("modifiers", out var modifiers) || modifiers.ValueKind != JsonValueKind.Object) return result;
        foreach (var property in modifiers.EnumerateObject())
        {
            var nativeName = Property(property.Value, "nativeName") ?? property.Name;
            physical.TryGetValue(nativeName, out var native);
            result.Add(new(
                property.Name,
                nativeName,
                native.Device ?? Property(property.Value, "deviceId"),
                native.Key,
                Property(property.Value, "mode") ?? native.Mode,
                used.Contains(property.Name) || used.Contains(nativeName)));
        }
        return result;
    }

    private static Dictionary<string, (string? Device, string? Key, string? Mode)> ReadPhysicalModifiers(JsonElement root, string outputDir)
    {
        var result = new Dictionary<string, (string?, string?, string?)>(StringComparer.OrdinalIgnoreCase);
        var relative = Property(root, "modifiersFile");
        if (string.IsNullOrWhiteSpace(relative)) return result;
        var path = Path.Combine(outputDir, relative.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(path)) return result;
        var source = File.ReadAllText(path);
        foreach (Match match in Regex.Matches(source,
                     "\\[\\\"(?<name>[^\\\"]+)\\\"\\]\\s*=\\s*\\{(?<body>.*?)\\n\\s*\\}",
                     RegexOptions.Singleline))
        {
            var body = match.Groups["body"].Value;
            var switched = Regex.Match(body, "\\[\\\"switch\\\"\\]\\s*=\\s*(?<value>true|false)").Groups["value"].Value;
            result[match.Groups["name"].Value] = (
                LuaValue(body, "device"),
                LuaValue(body, "key"),
                switched == "true" ? "toggle" : "hold");
        }
        return result;
    }

    private static string? LuaValue(string body, string key) =>
        Regex.Match(body, $"\\[\\\"{Regex.Escape(key)}\\\"\\]\\s*=\\s*\\\"(?<value>[^\\\"]*)\\\"").Groups["value"].Value is { Length: > 0 } value ? value : null;

    private static IEnumerable<string> ReadStringArray(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var values) || values.ValueKind != JsonValueKind.Array) return [];
        return values.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.String)
            .Select(value => value.GetString() ?? string.Empty).Where(value => value.Length > 0).ToArray();
    }

    private static RepositoryDevice? MatchDevice(PreviewDevice device, IReadOnlyList<RepositoryDevice> candidates) =>
        candidates.FirstOrDefault(item => Same(item.ProfileKey, device.ProfileKey)) ??
        candidates.FirstOrDefault(item => Same(PhysicalName(item.ProfileFile), PhysicalName(device.ProfileFile)) &&
                                          Same(item.DeviceId, device.DeviceId));

    private static List<PreviewRow> RowsForDevice(PreviewDevice device, IEnumerable<PreviewRow> rows) => rows
        .Where(row => Same(row.ProfileKey, device.ProfileKey) ||
                      (!string.IsNullOrWhiteSpace(device.ProfileFile) && Same(row.ProfileFile, device.ProfileFile)))
        .ToList();

    private static bool ChordContains(PreviewRow row, string? modifier) => !string.IsNullOrWhiteSpace(modifier) &&
        (string.Equals(row.SemanticChord, modifier, StringComparison.OrdinalIgnoreCase) ||
         (row.Chord?.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
              .Any(value => Same(value, modifier)) ?? false));

    private static string BindingSignature(PreviewRow row) => BindingSignature(
        row.CalloutId ?? string.Empty,
        row.Key ?? string.Empty,
        row.Command,
        row.SemanticChord?.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) ?? []);

    private static string BindingSignature(string callout, string key, string? command, IEnumerable<string> modifiers) =>
        $"{callout}\0{key}\0{command ?? string.Empty}\0{string.Join("+", modifiers.OrderBy(value => value, StringComparer.Ordinal))}";

    private static string PhysicalName(string? filename) => GuidSuffix.Replace(
        Path.GetFileName(filename ?? string.Empty).Replace(".diff.lua", string.Empty, StringComparison.OrdinalIgnoreCase), string.Empty).Trim();

    private static string? NormalizeInstance(string? instance) => instance?.StartsWith("MFD", StringComparison.OrdinalIgnoreCase) == true
        ? instance[3..]
        : instance;

    private static string? Property(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool Same(string? left, string? right) => string.Equals(left ?? string.Empty, right ?? string.Empty, StringComparison.OrdinalIgnoreCase);

    private static void RemoveSynthetic(IList<PreviewDevice> devices, IList<PreviewModifier> modifiers, IList<CommandLabelGroup> commands)
    {
        for (var index = devices.Count - 1; index >= 0; index--) if (devices[index].IsRepositoryOnly) devices.RemoveAt(index);
        for (var index = modifiers.Count - 1; index >= 0; index--) if (modifiers[index].IsRepositoryOnly) modifiers.RemoveAt(index);
        for (var index = commands.Count - 1; index >= 0; index--) if (commands[index].IsRepositoryOnly) commands.RemoveAt(index);
    }

    private static void SetNotCompared(IEnumerable<PreviewDevice> devices, IEnumerable<PreviewModifier> modifiers,
        IEnumerable<PreviewRow> rows, IEnumerable<CommandLabelGroup> commands)
    {
        foreach (var item in devices) Set(item, PreviewChangeState.NotCompared, "Select an output repository to compare.");
        foreach (var item in modifiers) Set(item, PreviewChangeState.NotCompared, "Select an output repository to compare.");
        foreach (var item in rows) Set(item, PreviewChangeState.NotCompared, "Select an output repository to compare.");
        foreach (var item in commands) Set(item, PreviewChangeState.NotCompared, "Select an output repository to compare.");
    }

    private static void SetRows(IEnumerable<PreviewRow> rows, PreviewChangeState state, string reason)
    { foreach (var row in rows) Set(row, state, reason); }
    private static void Set(PreviewDevice item, PreviewChangeState state, string reason) { item.ChangeState = state; item.ChangeReason = reason; }
    private static void Set(PreviewModifier item, PreviewChangeState state, string reason) { item.ChangeState = state; item.ChangeReason = reason; }
    private static void Set(PreviewRow item, PreviewChangeState state, string reason) { item.ChangeState = state; item.ChangeReason = reason; }
    private static void Set(CommandLabelGroup item, PreviewChangeState state, string reason) { item.ChangeState = state; item.ChangeReason = reason; }

    private sealed class MutableDevice(string profileKey, string profileFile, string deviceId, string? instance, string? role)
    {
        public string ProfileKey { get; } = profileKey;
        public string ProfileFile { get; } = profileFile;
        public string DeviceId { get; } = deviceId;
        public string? Instance { get; } = instance;
        public string? Role { get; } = role;
        public HashSet<string> Bindings { get; } = new(StringComparer.Ordinal);
    }

    private sealed class MutableCommand(string command)
    {
        public string Command { get; } = command;
        public string? Label { get; set; }
        public HashSet<string> Bindings { get; } = new(StringComparer.Ordinal);
    }
}
