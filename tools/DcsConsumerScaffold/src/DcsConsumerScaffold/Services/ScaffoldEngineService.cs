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
        string? mozaGrip,
        string? commonRoot,
        IReadOnlyDictionary<string, string>? semanticModifiers = null,
        IReadOnlyDictionary<string, string>? labels = null,
        CancellationToken cancellationToken = default)
    {
        var root = ResolveCommonRoot(commonRoot)
            ?? throw new InvalidOperationException(
                "Could not find DCS-Common root (scripts/scaffold-consumer.mjs). Set DCS_COMMON_ROOT or browse to the repo.");

        var script = Path.Combine(root, "scripts", "scaffold-consumer.mjs");
        var previewPath = Path.Combine(Path.GetTempPath(), $"dcs-scaffold-preview-{Guid.NewGuid():N}.json");

        string? semanticPath = null;
        string? labelsPath = null;
        try
        {
            semanticPath = await WriteTemporaryJsonAsync("semantic-modifiers", semanticModifiers, cancellationToken);
            labelsPath = await WriteTemporaryJsonAsync("labels", labels, cancellationToken);
            var args = BuildPreviewArguments(script, previewPath, profilesDir, modifiersPath, mozaGrip, null, root, semanticPath, labelsPath);
            var (exitCode, stdout, stderr) = await RunNodeAsync(root, args, cancellationToken).ConfigureAwait(false);

            PreviewDocument? document = null;
            if (File.Exists(previewPath))
            {
                await using var stream = File.OpenRead(previewPath);
                document = await JsonSerializer.DeserializeAsync<PreviewDocument>(stream, JsonOptions, cancellationToken)
                    .ConfigureAwait(false);
            }
            return (document, stdout, stderr, exitCode);
        }
        finally
        {
            DeleteTemporary(previewPath);
            DeleteTemporary(semanticPath);
            DeleteTemporary(labelsPath);
        }
    }

    public async Task<(string StdOut, string StdErr, int ExitCode)> RunWriteAsync(
        string profilesDir,
        string? modifiersPath,
        string? mozaGrip,
        IReadOnlyDictionary<string, string>? instanceRoles,
        IReadOnlyDictionary<string, string>? semanticModifiers,
        IReadOnlyDictionary<string, string>? labels,
        string? commonRoot,
        string outputDir,
        string displayName,
        string inputModuleId,
        string kneeboardId,
        string? repoName = null,
        CancellationToken cancellationToken = default)
    {
        var root = ResolveCommonRoot(commonRoot)
            ?? throw new InvalidOperationException(
                "Could not find DCS-Common root (scripts/scaffold-consumer.mjs). Set DCS_COMMON_ROOT or browse to the repo.");

        var script = Path.Combine(root, "scripts", "scaffold-consumer.mjs");
        string? rolesPath = null;
        string? semanticPath = null;
        string? labelsPath = null;
        try
        {
            if (instanceRoles is { Count: > 0 })
            {
                rolesPath = Path.Combine(Path.GetTempPath(), $"dcs-scaffold-roles-{Guid.NewGuid():N}.json");
                var json = JsonSerializer.Serialize(instanceRoles, new JsonSerializerOptions { WriteIndented = true });
                await File.WriteAllTextAsync(rolesPath, json, cancellationToken).ConfigureAwait(false);
            }
            semanticPath = await WriteTemporaryJsonAsync("semantic-modifiers", semanticModifiers, cancellationToken);
            labelsPath = await WriteTemporaryJsonAsync("labels", labels, cancellationToken);

            var args = BuildWriteArguments(
                script, profilesDir, modifiersPath, mozaGrip, rolesPath, root, outputDir, displayName, inputModuleId, kneeboardId, repoName, semanticPath, labelsPath);
            var (exitCode, stdout, stderr) = await RunNodeAsync(root, args, cancellationToken).ConfigureAwait(false);
            return (stdout, stderr, exitCode);
        }
        finally
        {
            if (rolesPath != null)
            {
                try { File.Delete(rolesPath); } catch { /* ignore */ }
            }
            DeleteTemporary(semanticPath);
            DeleteTemporary(labelsPath);
        }
    }

    public async Task<IReadOnlyList<RenderedPreviewPage>> RenderDevicePreviewAsync(
        string profilesDir,
        string? modifiersPath,
        string? mozaGrip,
        IReadOnlyDictionary<string, string>? instanceRoles,
        IReadOnlyDictionary<string, string>? semanticModifiers,
        IReadOnlyDictionary<string, string>? labels,
        string? commonRoot,
        string displayName,
        string inputModuleId,
        string kneeboardId,
        string profileKey,
        CancellationToken cancellationToken = default)
    {
        var root = ResolveCommonRoot(commonRoot)
            ?? throw new InvalidOperationException("Could not find DCS-Common root.");
        var temporaryRoot = Path.Combine(Path.GetTempPath(), $"dcs-scaffold-render-{Guid.NewGuid():N}");
        var renderDir = Path.Combine(temporaryRoot, "preview");
        try
        {
            Directory.CreateDirectory(temporaryRoot);
            var (_, stderr, exitCode) = await RunWriteAsync(
                profilesDir, modifiersPath, mozaGrip, instanceRoles, semanticModifiers, labels, root,
                temporaryRoot, displayName, inputModuleId, kneeboardId, cancellationToken: cancellationToken);
            if (exitCode is not (0 or 2)) throw new InvalidOperationException($"Temporary scaffold failed: {stderr}");

            var script = Path.Combine(root, "scripts", "render-scaffold-preview.mjs");
            var (renderExit, stdout, renderError) = await RunNodeAsync(
                root, [script, temporaryRoot, renderDir, profileKey], cancellationToken).ConfigureAwait(false);
            if (renderExit != 0) throw new InvalidOperationException($"Preview render failed: {renderError}");
            var json = stdout.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries).Last();
            var pages = JsonSerializer.Deserialize<List<RenderedFile>>(json, JsonOptions) ?? [];
            return pages.Select(page => new RenderedPreviewPage(
                page.File ?? Path.GetFileNameWithoutExtension(page.PngPath) ?? "preview",
                page.Title,
                File.ReadAllBytes(page.PngPath!))).ToList();
        }
        finally
        {
            try { Directory.Delete(temporaryRoot, recursive: true); } catch { /* ignore */ }
        }
    }

    private sealed class RenderedFile
    {
        public string? File { get; set; }
        public string? Title { get; set; }
        public string? PngPath { get; set; }
    }

    private static async Task<string?> WriteTemporaryJsonAsync(
        string stem,
        IReadOnlyDictionary<string, string>? values,
        CancellationToken cancellationToken)
    {
        if (values is not { Count: > 0 }) return null;
        var path = Path.Combine(Path.GetTempPath(), $"dcs-scaffold-{stem}-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(values), cancellationToken).ConfigureAwait(false);
        return path;
    }

    private static void DeleteTemporary(string? path)
    {
        if (path == null) return;
        try { File.Delete(path); } catch { /* ignore */ }
    }

    private static async Task<(int ExitCode, string StdOut, string StdErr)> RunNodeAsync(
        string workingDirectory,
        IReadOnlyList<string> argumentTokens,
        CancellationToken cancellationToken)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = workingDirectory,
        };
        foreach (var token in argumentTokens)
        {
            psi.ArgumentList.Add(token);
        }

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
        return (process.ExitCode, stdout.ToString(), stderr.ToString());
    }

    public static IReadOnlyList<string> BuildPreviewArguments(
        string scriptPath,
        string previewJsonPath,
        string profilesDir,
        string? modifiersPath,
        string? mozaGrip,
        string? rolesPath,
        string commonRoot,
        string? semanticModifiersPath = null,
        string? labelsPath = null)
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

        if (!string.IsNullOrWhiteSpace(mozaGrip))
        {
            list.Add("--moza-grip");
            list.Add(mozaGrip);
        }

        if (!string.IsNullOrWhiteSpace(rolesPath))
        {
            list.Add("--roles");
            list.Add(rolesPath);
        }
        AddOptionalFile(list, "--semantic-modifiers", semanticModifiersPath);
        AddOptionalFile(list, "--labels", labelsPath);

        return list;
    }

    public static IReadOnlyList<string> BuildWriteArguments(
        string scriptPath,
        string profilesDir,
        string? modifiersPath,
        string? mozaGrip,
        string? rolesPath,
        string commonRoot,
        string outputDir,
        string displayName,
        string inputModuleId,
        string kneeboardId,
        string? repoName = null,
        string? semanticModifiersPath = null,
        string? labelsPath = null)
    {
        var list = new List<string>
        {
            scriptPath,
            "--output-dir",
            outputDir,
            "--profiles-dir",
            profilesDir,
            "--common-root",
            commonRoot,
            "--display-name",
            displayName,
            "--input-module-id",
            inputModuleId,
            "--kneeboard-id",
            kneeboardId,
        };
        if (!string.IsNullOrWhiteSpace(modifiersPath))
        {
            list.Add("--modifiers");
            list.Add(modifiersPath);
        }

        if (!string.IsNullOrWhiteSpace(mozaGrip))
        {
            list.Add("--moza-grip");
            list.Add(mozaGrip);
        }

        if (!string.IsNullOrWhiteSpace(rolesPath))
        {
            list.Add("--roles");
            list.Add(rolesPath);
        }
        AddOptionalFile(list, "--semantic-modifiers", semanticModifiersPath);
        AddOptionalFile(list, "--labels", labelsPath);

        if (!string.IsNullOrWhiteSpace(repoName))
        {
            list.Add("--repo-name");
            list.Add(repoName);
        }

        return list;
    }

    private static void AddOptionalFile(List<string> arguments, string option, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        arguments.Add(option);
        arguments.Add(path);
    }
}
