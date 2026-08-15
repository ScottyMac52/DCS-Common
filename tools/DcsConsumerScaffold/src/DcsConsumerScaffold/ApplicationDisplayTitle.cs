namespace DcsConsumerScaffold;

public static class ApplicationDisplayTitle
{
    private const string ProductName = "DCS Input Profile Importer";

    public static string Format(Version? version)
    {
        if (version is null)
        {
            return ProductName;
        }

        var build = Math.Max(0, version.Build);
        var revision = Math.Max(0, version.Revision);
        return $"{ProductName} version {version.Major}.{version.Minor}.{build}.{revision}";
    }
}
