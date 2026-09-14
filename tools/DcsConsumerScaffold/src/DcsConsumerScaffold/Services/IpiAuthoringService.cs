using System.Diagnostics;
using System.IO;
using System.Text.Json;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

public sealed class IpiAuthoringService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public IReadOnlyList<IpiHardwareChoice> Hardware(string commonRoot)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(commonRoot, "assets", "shared", "hardware", "manifest.json")));
        return document.RootElement.GetProperty("devices").EnumerateArray().SelectMany(device =>
        {
            var id = device.GetProperty("id").GetString()!;
            var label = device.GetProperty("label").GetString()!;
            var ids = new List<string> { id };
            if (device.TryGetProperty("aliases", out var aliases)) ids.AddRange(aliases.EnumerateArray().Select(item => item.GetString()!));
            return ids.Select(value => new IpiHardwareChoice { DeviceId = value, Label = label });
        }).OrderBy(item => item.Label).ThenBy(item => item.DeviceId).ToList();
    }

    public IReadOnlyList<IpiUiFunctionChoice> UiFunctions(string commonRoot)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(commonRoot, "assets", "shared", "ui-layer", "functions.json")));
        return document.RootElement.GetProperty("functions").EnumerateArray().Select(item => new IpiUiFunctionChoice
        {
            Id = item.GetProperty("id").GetString()!, Command = item.GetProperty("command").GetString()!,
            Label = item.GetProperty("label").GetString()!, Category = item.GetProperty("category").GetString()!,
        }).OrderBy(item => item.Category).ThenBy(item => item.Label).ToList();
    }

    public Task<IpiAuthoringResult> InitializeAsync(string commonRoot, object request, CancellationToken cancellationToken = default) =>
        RunAsync<IpiAuthoringResult>(commonRoot, "initialize", request, cancellationToken);

    public Task<IpiModuleAuthoringState> InspectModuleAsync(string commonRoot, string repositoryRoot, string inputModuleId,
        CancellationToken cancellationToken = default) =>
        RunAsync<IpiModuleAuthoringState>(commonRoot, "inspect-module", new { repositoryRoot, inputModuleId }, cancellationToken);

    public Task<IpiAuthoringResult> SaveModuleAsync(string commonRoot, object request, CancellationToken cancellationToken = default) =>
        RunAsync<IpiAuthoringResult>(commonRoot, "save-module", request, cancellationToken);

    private static async Task<T> RunAsync<T>(string commonRoot, string command, object request, CancellationToken cancellationToken) where T : class
    {
        var requestPath = Path.Combine(Path.GetTempPath(), $"ipi-authoring-{Guid.NewGuid():N}.json");
        try
        {
            await File.WriteAllTextAsync(requestPath, JsonSerializer.Serialize(request), cancellationToken);
            var start = new ProcessStartInfo("node") { WorkingDirectory = commonRoot, RedirectStandardOutput = true,
                RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add(Path.Combine(commonRoot, "scripts", "ipi-authoring.mjs"));
            start.ArgumentList.Add(command);
            start.ArgumentList.Add(requestPath);
            using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start Node.");
            var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            var output = await stdout;
            var error = await stderr;
            if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? output : error);
            return JsonSerializer.Deserialize<T>(output.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries).Last(), JsonOptions)
                ?? throw new InvalidOperationException("IPI authoring returned no result.");
        }
        finally { try { File.Delete(requestPath); } catch { /* best effort */ } }
    }
}
