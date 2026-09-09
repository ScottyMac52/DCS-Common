namespace DcsConsumerScaffold.Models;

public sealed class InteractiveDevice
{
    public double Width { get; set; }
    public double Height { get; set; }
    public List<InteractiveControl> Controls { get; set; } = [];
    public byte[] Background { get; set; } = [];
}

public sealed class InteractiveControl
{
    public string Id { get; set; } = "";
    public string Key { get; set; } = "";
    public string Type { get; set; } = "button";
    public string HardwareLabel { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public double FontSize { get; set; }
    public string Anchor { get; set; } = "middle";
    public bool Shifted { get; set; }
}

public sealed record UiLayerProjection(string ControlId, string Label, string Category, string Modifier);
