using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class DcsHtmlCommandCatalogProviderTests
{
    [Fact]
    public void Build_JoinsDevicesAndRetainsEffectiveCombos()
    {
        using var exports = new HtmlExports();
        var first = exports.Add("MFD 1", Rows(
            ("JOY_BTN1; SHIFT - JOY_BTN1", "Left &amp; Right", "Instrument Panel; MDI", "d3011pnilu3011cd35vd1vpnilvu0"),
            ("JOY_X", "Pitch", "Flight Control", "a2001cdnil")));
        var second = exports.Add("MFD 2", Rows(
            ("JOY_BTN2", "Left &amp; Right", "Instrument Panel; MDI", "d3011pnilu3011cd35vd1vpnilvu0"),
            ("", "Pitch", "Flight Control", "a2001cdnil")));

        var result = new DcsHtmlCommandCatalogProvider().Build([second, first], "FA-18C_hornet");

        Assert.Equal(2, result.FileCount);
        Assert.Equal(4, result.EffectiveAssignmentCount);
        Assert.Equal(2, result.DuplicateCommandCount);
        Assert.Equal(2, result.Document.Commands.Count);
        Assert.Equal("FA-18C_hornet", result.Document.ModuleId);
        Assert.Null(result.Document.DcsVersion);
        var button = Assert.Single(result.Document.Commands, command => command.Type == "button");
        Assert.Equal("Left & Right", button.Name);
        Assert.Equal(["Instrument Panel", "MDI"], button.CategoryPath);
        Assert.Equal(3011, button.Actions!.Down);
        Assert.Equal(35, button.Actions.CockpitDeviceId);
        Assert.Equal(3, button.CurrentAssignments.Count);
        Assert.Contains(button.CurrentAssignments, assignment => assignment.Device == "MFD 1" && assignment.Combo == "SHIFT - JOY_BTN1");
    }

    [Fact]
    public void Build_IsDeterministicAcrossSelectionOrder()
    {
        using var exports = new HtmlExports();
        var first = exports.Add("One", Rows(("JOY_BTN1", "One", "General", "d1pnilunilcdnilvdnilvpnilvunil")));
        var second = exports.Add("Two", Rows(("JOY_BTN2", "One", "General", "d1pnilunilcdnilvdnilvpnilvunil")));

        var provider = new DcsHtmlCommandCatalogProvider();
        var forward = provider.Build([first, second], "Module");
        var reverse = provider.Build([second, first], "Module");

        Assert.Equal(forward.Document.SourceFingerprint, reverse.Document.SourceFingerprint);
        Assert.Equal(forward.Document.Commands.Select(command => command.BindingKey), reverse.Document.Commands.Select(command => command.BindingKey));
    }

    [Fact]
    public void Build_RejectsMetadataConflictsAndDuplicateHashes()
    {
        using var exports = new HtmlExports();
        var first = exports.Add("One", Rows(("", "First", "General", "d1pnilunilcdnilvdnilvpnilvunil")));
        var conflict = exports.Add("Two", Rows(("", "Changed", "General", "d1pnilunilcdnilvdnilvpnilvunil")));
        var duplicate = exports.Add("Three", Rows(
            ("", "First", "General", "d1pnilunilcdnilvdnilvpnilvunil"),
            ("", "First", "General", "d1pnilunilcdnilvdnilvpnilvunil")));

        var provider = new DcsHtmlCommandCatalogProvider();
        Assert.Contains("metadata", Assert.Throws<InvalidDataException>(() => provider.Build([first, conflict], "Module")).Message);
        Assert.Contains("duplicate", Assert.Throws<InvalidDataException>(() => provider.Build([duplicate], "Module")).Message);
    }

    [Fact]
    public void Build_RejectsWrongHeadingAndUnsupportedHash()
    {
        using var exports = new HtmlExports();
        var wrongHeading = exports.Add("Expected", Rows(("", "First", "General", "d1pnilunilcdnilvdnilvpnilvunil")), "Other");
        var badHash = exports.Add("Bad", Rows(("", "First", "General", "not-a-dcs-hash")));

        var provider = new DcsHtmlCommandCatalogProvider();
        Assert.Contains("does not match", Assert.Throws<InvalidDataException>(() => provider.Build([wrongHeading], "Module")).Message);
        Assert.Contains("unsupported command hash", Assert.Throws<InvalidDataException>(() => provider.Build([badHash], "Module")).Message);
    }

    private static string Rows(params (string Combo, string Name, string Category, string Hash)[] rows) =>
        string.Join(Environment.NewLine, rows.Select(row =>
            $"<tr><td>{row.Combo}</td><td>{row.Name}</td><td>{row.Category}</td><td>{row.Hash}</td></tr>"));

    private sealed class HtmlExports : IDisposable
    {
        private readonly string _directory = Path.Combine(Path.GetTempPath(), $"dcs-html-{Guid.NewGuid():N}");
        public HtmlExports() => Directory.CreateDirectory(_directory);

        public string Add(string filename, string rows, string? heading = null)
        {
            var path = Path.Combine(_directory, $"{filename}.html");
            File.WriteAllText(path, $"<html><section><h1>{heading ?? filename}</h1><table>{rows}</table></section></html>");
            return path;
        }

        public void Dispose() => Directory.Delete(_directory, true);
    }
}
