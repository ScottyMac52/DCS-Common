using System.Diagnostics;
using System.IO;
using System.Text.Json;
using DcsConsumerScaffold.Models;

namespace DcsConsumerScaffold.Services;

public sealed class UiLayerCatalogService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public static string CatalogPath(string commonRoot) => Path.Combine(
        commonRoot, "assets", "shared", "ui-layer", "input", "UiLayer");

    public async Task<UiLayerCatalogDocument> InspectAsync(string commonRoot, CancellationToken cancellationToken = default) =>
        Deserialize<UiLayerCatalogDocument>(await RunAsync(commonRoot, ["inspect", CatalogPath(commonRoot)], cancellationToken));

    public async Task<UiLayerCatalogComparison> CompareAsync(
        string commonRoot, string sourceRoot, CancellationToken cancellationToken = default) =>
        Deserialize<UiLayerCatalogComparison>(await RunAsync(commonRoot, ["compare", CatalogPath(commonRoot), sourceRoot], cancellationToken));

    public async Task<UiLayerCatalogDocument> ApplyAsync(
        string commonRoot, string sourceRoot, IReadOnlyCollection<UiLayerCatalogChange> decisions,
        CancellationToken cancellationToken = default)
    {
        var path = Path.Combine(Path.GetTempPath(), $"ui-layer-decisions-{Guid.NewGuid():N}.json");
        try
        {
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(decisions), cancellationToken);
            return Deserialize<UiLayerCatalogDocument>(await RunAsync(
                commonRoot, ["apply", CatalogPath(commonRoot), sourceRoot, path], cancellationToken));
        }
        finally { try { File.Delete(path); } catch { /* best effort */ } }
    }

    private static T Deserialize<T>(string json) where T : class =>
        JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new InvalidOperationException("Catalog manager returned no result.");

    private static async Task<string> RunAsync(string commonRoot, IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        var script = Path.Combine(commonRoot, "scripts", "manage-ui-layer-catalog.mjs");
        if (!File.Exists(script)) throw new FileNotFoundException("DCS-Common catalog manager was not found.", script);
        var start = new ProcessStartInfo("node") { WorkingDirectory = commonRoot, RedirectStandardOutput = true,
            RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add(script);
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start Node.");
        var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var output = await stdout;
        var error = await stderr;
        if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? output : error);
        return output.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries).Last();
    }
}
