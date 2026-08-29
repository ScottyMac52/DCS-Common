namespace DcsConsumerScaffold.Services;

public static class ProfilePathIdentityService
{
    public static string? InferModuleId(string? profilesDirectory)
    {
        if (string.IsNullOrWhiteSpace(profilesDirectory)) return null;

        var segments = profilesDirectory
            .Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        for (var index = segments.Length - 2; index >= 0; index--)
        {
            if (string.Equals(segments[index], "Config", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(segments[index + 1], "Input", StringComparison.OrdinalIgnoreCase))
                return index + 2 < segments.Length ? segments[index + 2] : null;
        }

        return null;
    }
}
