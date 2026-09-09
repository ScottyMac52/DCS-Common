namespace DcsConsumerScaffold.Services;

public sealed record DcsGlobalCommandDefinition(
    string Symbol,
    string Type,
    int Id,
    string[] CanonicalNames,
    string VerifiedThroughDcsVersion,
    string Evidence);

public static class DcsGlobalCommandRegistry
{
    public const string VerifiedVersion = "2.9.29";
    private const string EnumEvidence = "DCS iCommand enumeration corroborated by generated controller profiles";

    public static IReadOnlyList<DcsGlobalCommandDefinition> Commands { get; } =
    [
        Button("iCommandPlaneFonar", 71, "Canopy - OPEN/CLOSE", "Canopy Open/Close"),
        Button("iCommandPlaneWheelBrakeOn", 74, "Wheel Brake ON"),
        Button("iCommandPlaneWheelBrakeOff", 75, "Wheel Brake OFF"),
        Button("iCommandPlaneShipTakeOff", 120, "Catapult Hook-Up"),
        Button("iCommandPilotGestureSalute", 238, "Pilot Salute"),
        Button("iCommandScoresWindowToggle", 360, "Score Window"),
        Button("iCommandPlaneWheelBrakeLeftOn", 961, "Wheel Brake Left ON"),
        Button("iCommandPlaneWheelBrakeLeftOff", 962, "Wheel Brake Left OFF"),
        Button("iCommandPlaneWheelBrakeRightOn", 963, "Wheel Brake Right ON"),
        Button("iCommandPlaneWheelBrakeRightOff", 964, "Wheel Brake Right OFF"),
        Button("iCommandPlaneShowKneeboard", 1587, "Kneeboard ON/OFF", "Kneeboard glance view"),
        Axis("iCommandPlanePitch", 2001, "Pitch"),
        Axis("iCommandPlaneRoll", 2002, "Roll"),
        Axis("iCommandPlaneRudder", 2003, "Rudder"),
        Axis("iCommandPlaneThrustCommon", 2004, "Thrust"),
        Axis("iCommandPlaneThrustLeft", 2005, "Thrust Left"),
        Axis("iCommandPlaneThrustRight", 2006, "Thrust Right"),
        Axis("iCommandWheelBrake", 2101, "Wheel Brake"),
        Axis("iCommandLeftWheelBrake", 2112, "Wheel Brake Left"),
        Axis("iCommandRightWheelBrake", 2113, "Wheel Brake Right"),
    ];

    internal static bool TryBySymbol(string symbol, out DcsGlobalCommandDefinition definition)
    {
        definition = Commands.FirstOrDefault(item => item.Symbol == symbol)!;
        return definition is not null;
    }

    internal static DcsGlobalCommandDefinition? ByCanonicalIdentity(string type, string name) =>
        Commands.FirstOrDefault(item => item.Type == type && item.CanonicalNames.Any(candidate =>
            string.Equals(candidate, name.Trim(), StringComparison.OrdinalIgnoreCase)));

    private static DcsGlobalCommandDefinition Button(string symbol, int id, params string[] names) =>
        new(symbol, "button", id, names, VerifiedVersion, EnumEvidence);

    private static DcsGlobalCommandDefinition Axis(string symbol, int id, params string[] names) =>
        new(symbol, "axis", id, names, VerifiedVersion, EnumEvidence);
}
