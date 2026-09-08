using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

public sealed class InstalledDcsCommandCatalogResult
{
    public required DcsCommandCatalogDocument Document { get; init; }
    public required IReadOnlyList<string> SourceFiles { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }
    public int SkippedEntryCount { get; init; }
}

public sealed partial class InstalledDcsCommandCatalogProvider
{
    public InstalledDcsCommandCatalogResult Build(string defaultLuaPath, string moduleId)
    {
        if (string.IsNullOrWhiteSpace(defaultLuaPath))
            throw new ArgumentException("Select the module's joystick or keyboard default.lua file.", nameof(defaultLuaPath));
        if (string.IsNullOrWhiteSpace(moduleId))
            throw new ArgumentException("Load a preview with an input module ID before loading installed DCS commands.", nameof(moduleId));

        var source = Path.GetFullPath(defaultLuaPath);
        if (!File.Exists(source)) throw new FileNotFoundException("The selected DCS input definition was not found.", source);
        if (!Path.GetFileName(source).Equals("default.lua", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Select a DCS joystick or keyboard file named default.lua.");
        var controller = Path.GetFileName(Path.GetDirectoryName(source));
        if (!string.Equals(controller, "joystick", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(controller, "keyboard", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Select default.lua from the module's joystick or keyboard directory.");

        var root = FindDcsRoot(source);
        var sources = new List<string> { source };

        var commands = new Dictionary<string, DcsCommandCatalogEntry>(StringComparer.Ordinal);
        var warnings = new List<string>();
        var skipped = 0;
        foreach (var source in sources)
        {
            var text = File.ReadAllText(source);
            foreach (var table in ExtractTables(StripComments(text)))
            {
                if (!HasTopLevelField(table, "name")) continue;
                var name = ReadTranslatedString(table, "name");
                if (name is null || !HasActionField(table)) continue;

                var down = ReadNumber(table, "down");
                var pressed = ReadNumber(table, "pressed");
                var up = ReadNumber(table, "up");
                var action = ReadNumber(table, "action");
                var device = ReadNumber(table, "cockpit_device_id");
                if (device is null || (action is null && down is null && pressed is null && up is null))
                {
                    skipped++;
                    continue;
                }

                var valueDown = ReadDecimal(table, "value_down");
                var valueUp = ReadDecimal(table, "value_up");
                var isAxis = action is not null;
                var key = isAxis
                    ? $"a{action}cd{device}"
                    : $"d{Part(down)}p{Part(pressed)}u{Part(up)}cd{device}vd{Part(valueDown)}vpnilvu{Part(valueUp)}";
                commands.TryAdd(key, new DcsCommandCatalogEntry
                {
                    BindingKey = key,
                    Name = name,
                    RawName = name,
                    CategoryPath = ReadCategory(table),
                    Type = isAxis ? "axis" : "button",
                    Actions = new DcsCommandActions
                    {
                        Down = down,
                        Pressed = pressed,
                        Up = up,
                        CockpitDeviceId = device,
                        ValueDown = valueDown,
                        ValueUp = valueUp,
                    },
                    Source = new DcsCommandSource
                    {
                        Provider = "installed-dcs",
                        File = root is null ? source : Path.GetRelativePath(root, source),
                    },
                });
            }
        }

        if (skipped > 0)
            warnings.Add($"Skipped {skipped} command definition(s) whose numeric action or cockpit device identity could not be resolved without executing Lua.");
        var relativeSources = sources.Select(path => root is null ? path : Path.GetRelativePath(root, path)).ToList();
        return new InstalledDcsCommandCatalogResult
        {
            Document = new DcsCommandCatalogDocument
            {
                SchemaVersion = 1,
                DcsVersion = root is null ? null : ReadDcsVersion(root),
                ModuleId = moduleId.Trim(),
                Locale = "en",
                GeneratedAt = DateTimeOffset.UtcNow,
                SourceFingerprint = Fingerprint(sources),
                Commands = commands.Values.OrderBy(command => command.Category, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(command => command.Name, StringComparer.OrdinalIgnoreCase).ToList(),
            },
            SourceFiles = relativeSources,
            Warnings = warnings,
            SkippedEntryCount = skipped,
        };
    }

    private static string? FindDcsRoot(string source)
    {
        for (var directory = Directory.GetParent(source); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "autoupdate.cfg"))) return directory.FullName;
        }
        return null;
    }

    private static IEnumerable<string> ExtractTables(string text)
    {
        var stack = new Stack<int>();
        var quote = '\0';
        var escaped = false;
        for (var index = 0; index < text.Length; index++)
        {
            var ch = text[index];
            if (quote != '\0')
            {
                if (escaped) escaped = false;
                else if (ch == '\\') escaped = true;
                else if (ch == quote) quote = '\0';
                continue;
            }
            if (ch is '\'' or '"') { quote = ch; continue; }
            if (ch == '{') stack.Push(index);
            else if (ch == '}' && stack.TryPop(out var start)) yield return text[start..(index + 1)];
        }
    }

    private static string StripComments(string text) => BlockComment().Replace(LineComment().Replace(text, string.Empty), string.Empty);
    private static bool HasActionField(string table) => ActionField().IsMatch(table);

    private static bool HasTopLevelField(string table, string field)
    {
        var depth = 0;
        var quote = '\0';
        var escaped = false;
        for (var index = 0; index < table.Length; index++)
        {
            var ch = table[index];
            if (quote != '\0')
            {
                if (escaped) escaped = false;
                else if (ch == '\\') escaped = true;
                else if (ch == quote) quote = '\0';
                continue;
            }
            if (ch is '\'' or '"') { quote = ch; continue; }
            if (ch == '{') { depth++; continue; }
            if (ch == '}') { depth--; continue; }
            if (depth != 1 || index + field.Length > table.Length ||
                !table.AsSpan(index, field.Length).Equals(field, StringComparison.Ordinal)) continue;
            var before = index == 0 ? '\0' : table[index - 1];
            var afterIndex = index + field.Length;
            var after = afterIndex >= table.Length ? '\0' : table[afterIndex];
            if ((char.IsLetterOrDigit(before) || before == '_') || (char.IsLetterOrDigit(after) || after == '_')) continue;
            while (afterIndex < table.Length && char.IsWhiteSpace(table[afterIndex])) afterIndex++;
            if (afterIndex < table.Length && table[afterIndex] == '=') return true;
        }
        return false;
    }

    private static string? ReadTranslatedString(string table, string field)
    {
        var match = Regex.Match(table,
            $"\\b{Regex.Escape(field)}\\s*=\\s*(?:_\\s*\\(\\s*)?(?:\"(?<d>(?:\\\\.|[^\"\\\\])*)\"|'(?<s>(?:\\\\.|[^'\\\\])*)')");
        if (!match.Success) return null;
        return Regex.Unescape(match.Groups["d"].Success ? match.Groups["d"].Value : match.Groups["s"].Value).Trim();
    }

    private static List<string> ReadCategory(string table)
    {
        var assignment = Regex.Match(table, @"\bcategory\s*=");
        if (!assignment.Success) return [];
        var tail = table[assignment.Index..];
        var end = tail.IndexOfAny([',', '\n', '\r']);
        if (tail.Contains('{'))
        {
            var open = tail.IndexOf('{');
            var close = tail.IndexOf('}', open + 1);
            if (close >= 0) end = close + 1;
        }
        var expression = end < 0 ? tail : tail[..end];
        return StringLiteral().Matches(expression).Select(match => Regex.Unescape(match.Groups["value"].Value).Trim())
            .Where(value => value.Length > 0).ToList();
    }

    private static int? ReadNumber(string table, string field)
    {
        var value = ReadDecimal(table, field);
        return value is not null && value == Math.Truncate(value.Value) ? checked((int)value.Value) : null;
    }

    private static double? ReadDecimal(string table, string field)
    {
        var match = Regex.Match(table, $@"\b{Regex.Escape(field)}\s*=\s*(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\b");
        return match.Success && double.TryParse(match.Groups["value"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value : null;
    }

    private static string Part(int? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "nil";
    private static string Part(double? value) => value?.ToString("0.################", CultureInfo.InvariantCulture) ?? "nil";

    private static string? ReadDcsVersion(string root)
    {
        var path = Path.Combine(root, "autoupdate.cfg");
        if (!File.Exists(path)) return null;
        try
        {
            using var json = JsonDocument.Parse(File.ReadAllText(path));
            return json.RootElement.TryGetProperty("version", out var version) ? version.GetString() : null;
        }
        catch (JsonException) { return null; }
    }

    private static string Fingerprint(IEnumerable<string> sources)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var source in sources)
        {
            hash.AppendData(Encoding.UTF8.GetBytes(source.Replace('\\', '/')));
            hash.AppendData(File.ReadAllBytes(source));
        }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    [GeneratedRegex(@"--\[\[[\s\S]*?\]\]")] private static partial Regex BlockComment();
    [GeneratedRegex(@"--[^\r\n]*")] private static partial Regex LineComment();
    [GeneratedRegex(@"\b(?:down|up|pressed|action)\s*=")] private static partial Regex ActionField();
    [GeneratedRegex("(?:_\\s*\\(\\s*)?[\"'](?<value>(?:\\\\.|[^\"'\\\\])*)[\"']")] private static partial Regex StringLiteral();
}
