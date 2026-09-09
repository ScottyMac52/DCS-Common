using System.IO;
using DcsConsumerScaffold.Services;
using Xunit;

namespace DcsConsumerScaffold.Tests;

public sealed class DcsCommandIdCaptureServiceTests
{
    [Fact]
    public void Load_ReadsCapturedEnvironmentAndRejectsConflicts()
    {
        var valid = Temporary("""
            {"schemaVersion":1,"dcsVersion":"2.9.30","commands":[
              {"symbol":"iCommandPlaneAttackMyTarget","id":118},
              {"symbol":"iCommandPlaneAttackMyTarget","id":118}
            ]}
            """);
        var conflicting = Temporary("""
            {"schemaVersion":1,"commands":[
              {"symbol":"iCommandPlaneAttackMyTarget","id":118},
              {"symbol":"iCommandPlaneAttackMyTarget","id":999}
            ]}
            """);
        try
        {
            var service = new DcsCommandIdCaptureService();
            var result = service.Load(valid, out var version);
            Assert.Equal("2.9.30", version);
            Assert.Equal(118, result["iCommandPlaneAttackMyTarget"]);
            Assert.Contains("conflicting", Assert.Throws<InvalidDataException>(() => service.Load(conflicting, out _)).Message, StringComparison.OrdinalIgnoreCase);
        }
        finally { File.Delete(valid); File.Delete(conflicting); }
    }

    [Fact]
    public void SaveCaptureScript_EnumeratesNumericICommandsIntoReloadableJson()
    {
        var path = Path.Combine(Path.GetTempPath(), $"capture-{Guid.NewGuid():N}.lua");
        try
        {
            new DcsCommandIdCaptureService().SaveCaptureScript(path);
            var script = File.ReadAllText(path);
            Assert.Contains("getfenv()", script);
            Assert.Contains("^iCommand", script);
            Assert.Contains(DcsCommandIdCaptureService.OutputFileName, script);
            Assert.Contains("schemaVersion", script);
        }
        finally { File.Delete(path); }
    }

    private static string Temporary(string content)
    {
        var path = Path.Combine(Path.GetTempPath(), $"dcs-id-capture-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, content);
        return path;
    }
}
