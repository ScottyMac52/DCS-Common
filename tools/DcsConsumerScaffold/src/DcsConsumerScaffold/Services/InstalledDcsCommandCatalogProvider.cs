using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DcsConsumerScaffold.Models;
using MoonSharp.Interpreter;

namespace DcsConsumerScaffold.Services;

public sealed class InstalledDcsCommandCatalogResult
{
    public required DcsCommandCatalogDocument Document { get; init; }
    public required IReadOnlyList<string> SourceFiles { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }
    public int SkippedEntryCount { get; init; }
    public int UnresolvedEntryCount { get; init; }
}

public sealed class InstalledDcsCommandCatalogProvider
{
    public InstalledDcsCommandCatalogResult Build(string defaultLuaPath, string moduleId)
    {
        if (string.IsNullOrWhiteSpace(defaultLuaPath))
            throw new ArgumentException("Select the module's joystick or keyboard default.lua file.", nameof(defaultLuaPath));
        if (string.IsNullOrWhiteSpace(moduleId))
            throw new ArgumentException("Load a preview with an input module ID before loading installed DCS commands.", nameof(moduleId));

        var source = Path.GetFullPath(defaultLuaPath);
        ValidateSource(source);
        var dcsRoot = FindDcsRoot(source);
        var executor = new DcsInputLuaExecutor(dcsRoot ?? FindAircraftRoot(source), source);
        var commands = executor.Execute();
        var resolutionFiles = DcsCommandIdentityResolver.Resolve(commands, source);
        var unresolved = commands.Count(command => !command.IsAssignable);
        var warnings = unresolved == 0 ? [] : new List<string>
        {
            $"Loaded {unresolved} host-defined command(s) for searching, but they remain unavailable for assignment because DCS did not expose a numeric identity to the embedded runtime.",
        };

        return new InstalledDcsCommandCatalogResult
        {
            Document = new DcsCommandCatalogDocument
            {
                SchemaVersion = 1,
                DcsVersion = dcsRoot is null ? null : ReadDcsVersion(dcsRoot),
                ModuleId = moduleId.Trim(),
                Locale = "en",
                GeneratedAt = DateTimeOffset.UtcNow,
                SourceFingerprint = Fingerprint(executor.SourceFiles.Concat(resolutionFiles)),
                Commands = commands.OrderBy(command => command.Category, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(command => command.Name, StringComparer.OrdinalIgnoreCase).ToList(),
            },
            SourceFiles = executor.SourceFiles.Concat(resolutionFiles).Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(path => dcsRoot is null ? path : Path.GetRelativePath(dcsRoot, path)).ToList(),
            Warnings = warnings,
            UnresolvedEntryCount = unresolved,
        };
    }

    private static void ValidateSource(string source)
    {
        if (!File.Exists(source)) throw new FileNotFoundException("The selected DCS input definition was not found.", source);
        if (!Path.GetFileName(source).Equals("default.lua", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Select a DCS joystick or keyboard file named default.lua.");
        var controller = Path.GetFileName(Path.GetDirectoryName(source));
        if (!string.Equals(controller, "joystick", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(controller, "keyboard", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Select default.lua from the module's joystick or keyboard directory.");
    }

    private static string FindAircraftRoot(string source)
    {
        var directory = new FileInfo(source).Directory;
        for (var index = 0; index < 3 && directory?.Parent is not null; index++) directory = directory.Parent;
        return directory?.FullName ?? Path.GetDirectoryName(source)!;
    }

    private static string? FindDcsRoot(string source)
    {
        for (var directory = Directory.GetParent(source); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "autoupdate.cfg"))) return directory.FullName;
        return null;
    }

    private static string? ReadDcsVersion(string root)
    {
        try
        {
            using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "autoupdate.cfg")));
            return json.RootElement.TryGetProperty("version", out var version) ? version.GetString() : null;
        }
        catch (JsonException) { return null; }
    }

    private static string Fingerprint(IEnumerable<string> sources)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var source in sources.OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(source.Replace('\\', '/')));
            hash.AppendData(File.ReadAllBytes(source));
        }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
}

internal sealed partial class DcsInputLuaExecutor
{
    private const string SymbolPrefix = "__DCS_SYMBOL__:";
    private readonly string _allowedRoot;
    private readonly string _defaultLua;
    private readonly Script _script = new(CoreModules.Preset_SoftSandbox);
    private readonly HashSet<string> _sourceFiles = new(StringComparer.OrdinalIgnoreCase);

    public DcsInputLuaExecutor(string allowedRoot, string defaultLua)
    {
        _allowedRoot = Path.GetFullPath(allowedRoot);
        _defaultLua = Path.GetFullPath(defaultLua);
        ConfigureRuntime();
    }

    public IReadOnlyList<string> SourceFiles => _sourceFiles.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToList();

    public List<DcsCommandCatalogEntry> Execute()
    {
        SeedInstalledCommandDefinitions();
        SeedHostSymbols(File.ReadAllText(_defaultLua));
        var result = ExecuteFile(_defaultLua);
        if (result.Type != DataType.Table)
            throw new InvalidDataException("The selected default.lua did not return a DCS input table.");
        var commands = new List<DcsCommandCatalogEntry>();
        AddCommands(result.Table.Get("keyCommands"), "button", commands);
        AddCommands(result.Table.Get("axisCommands"), "axis", commands);
        return commands.GroupBy(command => command.BindingKey, StringComparer.Ordinal).Select(group => group.First()).ToList();
    }

    private void SeedInstalledCommandDefinitions()
    {
        var moduleRoot = Directory.GetParent(Path.GetDirectoryName(_defaultLua)!)?.Parent?.Parent?.FullName;
        var roots = new[] { moduleRoot, Path.Combine(_allowedRoot, "Scripts", "Input"), Path.Combine(_allowedRoot, "Config", "Input") }
            .Where(path => path is not null && Directory.Exists(path)).Cast<string>().Distinct(StringComparer.OrdinalIgnoreCase);
        var candidates = roots.SelectMany(path => Directory.EnumerateFiles(path, "*.lua", SearchOption.AllDirectories))
            .Where(path => Path.GetFileName(path).Contains("command", StringComparison.OrdinalIgnoreCase) &&
                           Path.GetFileName(path).Contains("def", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase);
        foreach (var path in candidates)
        {
            var text = File.ReadAllText(path);
            var used = false;
            foreach (Match match in NumericHostCommandDefinition().Matches(text))
            {
                _script.Globals[match.Groups["name"].Value] = double.Parse(match.Groups["value"].Value, CultureInfo.InvariantCulture);
                used = true;
            }
            if (used) _sourceFiles.Add(path);
        }
    }

    private void ConfigureRuntime()
    {
        _script.Globals["_"] = (Func<DynValue, DynValue>)(value => value);
        _script.Globals["folder"] = Path.GetDirectoryName(_defaultLua)! + Path.DirectorySeparatorChar;
        _script.Globals["join"] = (Action<Table, Table>)Join;
        _script.Globals["dofile"] = (Func<string, DynValue>)(path => ExecuteFile(ResolvePath(path)));
        _script.Globals["external_profile"] = (Func<string, DynValue>)(path =>
        {
            var resolved = ResolvePath(path);
            return File.Exists(resolved) ? ExecuteFile(resolved) : NewInputRoot();
        });
    }

    private DynValue ExecuteFile(string path)
    {
        path = Path.GetFullPath(path);
        EnsureAllowed(path);
        if (!File.Exists(path)) throw new FileNotFoundException("A DCS Lua dependency was not found.", path);
        var text = File.ReadAllText(path);
        SeedHostSymbols(text);
        _sourceFiles.Add(path);
        return _script.DoString(text, null, path);
    }

    private void SeedHostSymbols(string text)
    {
        foreach (Match match in HostCommand().Matches(text))
        {
            var name = match.Value;
            if (_script.Globals.Get(name).IsNil()) _script.Globals[name] = SymbolPrefix + name;
        }
        foreach (Match match in QualifiedSymbol().Matches(text))
        {
            var root = match.Groups["root"].Value;
            if (!_script.Globals.Get(root).IsNil()) continue;
            var table = new Table(_script) { MetaTable = new Table(_script) };
            table.MetaTable["__index"] = (Func<Table, string, string>)((_, key) => SymbolPrefix + root + "." + key);
            _script.Globals[root] = table;
        }
        foreach (Match match in HostFunction().Matches(text))
        {
            var name = match.Groups["name"].Value;
            if (_script.Globals.Get(name).IsNil()) _script.Globals[name] = (Func<DynValue>)EmptyHostResults;
        }
        foreach (Match match in QualifiedFunction().Matches(text))
        {
            var root = _script.Globals.Get(match.Groups["root"].Value);
            if (root.Type != DataType.Table) continue;
            var name = match.Groups["name"].Value;
            var existing = root.Table.RawGet(name);
            if (existing is null || existing.IsNil()) root.Table[name] = (Func<DynValue>)EmptyHostResults;
        }
    }

    private string ResolvePath(string path)
    {
        path = path.Replace('/', Path.DirectorySeparatorChar);
        return Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(_allowedRoot, path));
    }

    private void EnsureAllowed(string path)
    {
        var relative = Path.GetRelativePath(_allowedRoot, path);
        if (relative == ".." || relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            throw new InvalidDataException($"DCS Lua attempted to load a file outside the selected installation: {path}");
    }

    private DynValue NewInputRoot()
    {
        var root = new Table(_script);
        root["keyCommands"] = new Table(_script);
        root["axisCommands"] = new Table(_script);
        return DynValue.NewTable(root);
    }

    private DynValue EmptyHostResults() => DynValue.NewTuple(
        DynValue.NewTable(new Table(_script)),
        DynValue.NewTable(new Table(_script)),
        DynValue.NewTable(new Table(_script)));

    private static void Join(Table target, Table additions)
    {
        var next = target.Length + 1;
        foreach (var pair in additions.Pairs.Where(pair => pair.Key.Type == DataType.Number).OrderBy(pair => pair.Key.Number))
            target[next++] = pair.Value;
    }

    private void AddCommands(DynValue collection, string type, ICollection<DcsCommandCatalogEntry> destination)
    {
        if (collection.Type != DataType.Table) return;
        foreach (var pair in collection.Table.Pairs.Where(pair => pair.Key.Type == DataType.Number).OrderBy(pair => pair.Key.Number))
        {
            if (pair.Value.Type != DataType.Table) continue;
            var table = pair.Value.Table;
            var name = Text(table.Get("name"));
            if (string.IsNullOrWhiteSpace(name)) continue;
            var action = type == "axis" ? table.Get("action") : DynValue.Nil;
            var down = table.Get("down");
            var pressed = table.Get("pressed");
            var up = table.Get("up");
            var device = table.Get("cockpit_device_id");
            var numeric = (type == "axis"
                ? IsNumber(action)
                : (IsNumber(down) || IsNumber(pressed) || IsNumber(up)) &&
                  IsNumberOrNil(down) && IsNumberOrNil(pressed) && IsNumberOrNil(up)) &&
                IsNumberOrNil(device);
            var key = numeric ? BindingKey(type, action, down, pressed, up, device, table) : UnresolvedKey(type, name, action, down, pressed, up, device);
            var symbols = new[] { action, down, pressed, up, device }.Select(Symbol).Where(value => value is not null).Cast<string>().Distinct().ToList();
            destination.Add(new DcsCommandCatalogEntry
            {
                BindingKey = key,
                Name = name,
                RawName = name,
                CategoryPath = Category(table.Get("category")),
                Type = type,
                Aliases = symbols,
                IsAssignable = numeric,
                UnavailableReason = numeric ? null : "DCS host symbol did not resolve to a numeric command identity.",
                Actions = new DcsCommandActions
                {
                    Down = Integer(down), Pressed = Integer(pressed), Up = Integer(up), CockpitDeviceId = Integer(device),
                    ValueDown = Number(table.Get("value_down")), ValuePressed = Number(table.Get("value_pressed")), ValueUp = Number(table.Get("value_up")),
                },
                Source = new DcsCommandSource { Provider = "installed-dcs-lua", File = _defaultLua },
            });
        }
    }

    private static string BindingKey(string type, DynValue action, DynValue down, DynValue pressed, DynValue up, DynValue device, Table table) =>
        type == "axis" ? $"a{Part(action)}cd{Part(device)}" :
        $"d{Part(down)}p{Part(pressed)}u{Part(up)}cd{Part(device)}vd{Part(table.Get("value_down"))}vp{Part(table.Get("value_pressed"))}vu{Part(table.Get("value_up"))}";

    private static string UnresolvedKey(params object[] parts)
    {
        var text = string.Join("|", parts.Select(part => part is DynValue value ? Text(value) : part?.ToString()));
        return "unresolved:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant()[..20];
    }

    private static List<string> Category(DynValue value)
    {
        if (value.Type == DataType.String) return [value.String];
        if (value.Type != DataType.Table) return [];
        return value.Table.Pairs.Where(pair => pair.Key.Type == DataType.Number).OrderBy(pair => pair.Key.Number)
            .Select(pair => Text(pair.Value)).Where(text => !string.IsNullOrWhiteSpace(text)).ToList();
    }

    private static bool IsNumber(DynValue value) => value.Type == DataType.Number;
    private static bool IsNumberOrNil(DynValue value) => value.IsNil() || IsNumber(value);
    private static int? Integer(DynValue value) => IsNumber(value) ? checked((int)value.Number) : null;
    private static double? Number(DynValue value) => IsNumber(value) ? value.Number : null;
    private static string Text(DynValue value) => value.Type switch { DataType.String => value.String, DataType.Number => value.Number.ToString(CultureInfo.InvariantCulture), _ => string.Empty };
    private static string Part(DynValue value) => IsNumber(value) ? value.Number.ToString("0.################", CultureInfo.InvariantCulture) : "nil";
    private static string? Symbol(DynValue value) => value.Type == DataType.String && value.String.StartsWith(SymbolPrefix, StringComparison.Ordinal)
        ? value.String[SymbolPrefix.Length..] : null;

    [GeneratedRegex(@"\biCommand[A-Za-z0-9_]+\b")] private static partial Regex HostCommand();
    [GeneratedRegex(@"(?m)^\s*(?<name>iCommand[A-Za-z0-9_]+)\s*=\s*(?<value>-?\d+(?:\.\d+)?)\s*(?:--.*)?$")] private static partial Regex NumericHostCommandDefinition();
    [GeneratedRegex(@"\b(?<root>[A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*")] private static partial Regex QualifiedSymbol();
    [GeneratedRegex(@"(?<![.:])\b(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(")] private static partial Regex HostFunction();
    [GeneratedRegex(@"\b(?<root>[A-Za-z_][A-Za-z0-9_]*)\.(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(")] private static partial Regex QualifiedFunction();
}

internal static partial class DcsCommandIdentityResolver
{
    private static readonly IReadOnlyDictionary<string, int> VerifiedHostCommands = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        // Corroborated by DCS-generated FA-18C joystick profiles. These are global DCS input commands, not module commands.
        ["iCommandPlanePitch"] = 2001,
        ["iCommandPlaneRoll"] = 2002,
    };

    public static IReadOnlyList<string> Resolve(ICollection<DcsCommandCatalogEntry> commands, string defaultLua)
    {
        var evidence = ReadProfileEvidence(defaultLua, out var files);
        foreach (var command in commands.Where(command => !command.IsAssignable))
        {
            var symbol = command.Aliases.FirstOrDefault(alias => alias.StartsWith("iCommand", StringComparison.Ordinal));
            string? key = null;
            string? provider = null;
            var matches = evidence.Where(item => item.Type == command.Type && NamesEqual(item.Name, command.Name))
                .Select(item => item.Key).Distinct(StringComparer.Ordinal).ToList();
            if (matches.Count == 1)
            {
                key = matches[0];
                provider = "dcs-generated-profile";
            }
            else if (matches.Count == 0 && symbol is not null && VerifiedHostCommands.TryGetValue(symbol, out var id))
            {
                key = command.Type == "axis" ? $"a{id}cdnil" : $"d{id}pnilunilcdnilvdnilvpnilvunil";
                provider = "verified-dcs-host-command";
            }
            if (key is null) continue;
            command.BindingKey = key;
            command.IsAssignable = true;
            command.UnavailableReason = null;
            command.Source = new DcsCommandSource { Provider = provider, File = provider == "dcs-generated-profile" ? files.FirstOrDefault() : defaultLua };
            ApplyActions(command, key);
        }
        return files;
    }

    private static void ApplyActions(DcsCommandCatalogEntry command, string key)
    {
        command.Actions ??= new DcsCommandActions();
        var match = BindingIdentity().Match(key);
        if (!match.Success) return;
        if (command.Type == "axis") return;
        command.Actions.Down = Part(match.Groups["down"].Value);
        command.Actions.Pressed = Part(match.Groups["pressed"].Value);
        command.Actions.Up = Part(match.Groups["up"].Value);
        command.Actions.CockpitDeviceId = Part(match.Groups["device"].Value);
    }

    private static List<(string Key, string Name, string Type)> ReadProfileEvidence(string defaultLua, out List<string> files)
    {
        files = [];
        var result = new List<(string, string, string)>();
        var moduleRoot = Directory.GetParent(Path.GetDirectoryName(defaultLua)!)?.FullName;
        if (moduleRoot is null) return result;
        foreach (var file in Directory.EnumerateFiles(moduleRoot, "*.diff.lua", SearchOption.AllDirectories))
        {
            var text = File.ReadAllText(file);
            var found = false;
            var keys = ProfileBindingKey().Matches(text).Cast<Match>().ToList();
            for (var index = 0; index < keys.Count; index++)
            {
                var start = keys[index].Index;
                var length = (index + 1 < keys.Count ? keys[index + 1].Index : text.Length) - start;
                var name = ProfileName().Match(text.Substring(start, length));
                if (!name.Success) continue;
                var key = keys[index].Groups["key"].Value;
                result.Add((key, LuaUnescape(name.Groups["name"].Value), key.StartsWith('a') ? "axis" : "button"));
                found = true;
            }
            if (found) files.Add(file);
        }
        return result;
    }

    private static bool NamesEqual(string left, string right) => string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);
    private static string LuaUnescape(string value) => value.Replace("\\\"", "\"").Replace("\\\\", "\\");
    private static int? Part(string value) => value == "nil" ? null : int.Parse(value, CultureInfo.InvariantCulture);

    [GeneratedRegex(@"\[""(?<key>(?:a-?\d+cd(?:-?\d+|nil)|d(?:-?\d+|nil)p(?:-?\d+|nil)u(?:-?\d+|nil)cd(?:-?\d+|nil)vd[^""]+vp[^""]+vu[^""]+))""\]\s*=")]
    private static partial Regex ProfileBindingKey();
    [GeneratedRegex(@"\[""name""\]\s*=\s*""(?<name>(?:\\.|[^""])*)""")]
    private static partial Regex ProfileName();
    [GeneratedRegex(@"^d(?<down>-?\d+|nil)p(?<pressed>-?\d+|nil)u(?<up>-?\d+|nil)cd(?<device>-?\d+|nil)")]
    private static partial Regex BindingIdentity();
}
