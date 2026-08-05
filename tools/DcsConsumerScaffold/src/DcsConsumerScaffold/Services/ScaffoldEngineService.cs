using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

/// <summary>
/// Invokes the Node scaffold engine (Option A). Requires <c>node</c> on PATH.
/// </summary>
public sealed class ScaffoldEngineService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public string? ResolveCommonRoot(string? explicitRoot)
    {
        if (!string.IsNullOrWhiteSpace(explicitRoot) &&
            File.Exists(Path.Combine(explicitRoot, "scripts", "scaffold-consumer.mjs")))
        {
            return Path.GetFullPath(explicitRoot);
        }

        var env = Environment.GetEnvironmentVariable("DCS_COMMON_ROOT");
        if (!string.IsNullOrWhiteSpace(env) &&
            File.Exists(Path.Combine(env, "scripts", "scaffold-consumer.mjs")))
        {
            return Path.GetFullPath(env);
        }

        // Dev layout: .../tools/DcsConsumerScaffold/src/DcsConsumerScaffold/bin/.../ → repo root
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 10 && dir != null; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "scripts", "scaffold-consumer.mjs");
            if (File.Exists(candidate))
            {
                return dir.FullName;
            }
        }

        return null;
    }

    public async Task<(PreviewDocument? Document, string StdOut, string StdErr, int ExitCode)> RunPreviewAsync(
        string profilesDir,
        string? modifiersPath,
        string? commonRoot,
        CancellationToken cancellationToken = default)
    {
        var root = ResolveCommonRoot(commonRoot)
            ?? throw new InvalidOperationException(
                "Could not find DCS-Common root (scripts/scaffold-consumer.mjs). Set DCS_COMMON_ROOT or browse to the repo.");

        var script = Path.Combine(root, "scripts", "scaffold-consumer.mjs");
        var previewPath = Path.Combine(Path.GetTempPath(), $"dcs-scaffold-preview-{Guid.NewGuid():N}.json");

        var args = new StringBuilder();
        args.Append('"').Append(script).Append('"');
        args.Append(" --preview-json \"").Append(previewPath).Append('"');
        args.Append(" --profiles-dir \"").Append(profilesDir).Append('"');
        args.Append(" --common-root \"").Append(root).Append('"');
        if (!string.IsNullOrWhiteSpace(modifiersPath))
        {
            args.Append(" --modifiers \"").Append(modifiersPath).Append('"');
        }

        var psi = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = args.ToString(),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = root,
        };

        using var process = new Process { StartInfo = psi };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        process.OutputDataReceived += (_, e) => { if (e.Data != null) stdout.AppendLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data != null) stderr.AppendLine(e.Data); };

        if (!process.Start())
        {
            throw new InvalidOperationException("Failed to start node. Ensure Node.js is installed and on PATH.");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);

        PreviewDocument? document = null;
        if (File.Exists(previewPath))
        {
            try
            {
                await using var stream = File.OpenRead(previewPath);
                document = await JsonSerializer.DeserializeAsync<PreviewDocument>(stream, JsonOptions, cancellationToken)
                    .ConfigureAwait(false);
            }
            finally
            {
                try { File.Delete(previewPath); } catch { /* ignore */ }
            }
        }

        return (document, stdout.ToString(), stderr.ToString(), process.ExitCode);
    }

    /// <summary>Builds argv list for tests without starting a process.</summary>
    public static IReadOnlyList<string> BuildPreviewArguments(
        string scriptPath,
        string previewJsonPath,
        string profilesDir,
        string? modifiersPath,
        string commonRoot)
    {
        var list = new List<string>
        {
            scriptPath,
            "--preview-json",
            previewJsonPath,
            "--profiles-dir",
            profilesDir,
            "--common-root",
            commonRoot,
        };
        if (!string.IsNullOrWhiteSpace(modifiersPath))
        {
            list.Add("--modifiers");
            list.Add(modifiersPath);
        }

        return list;
    }
}
