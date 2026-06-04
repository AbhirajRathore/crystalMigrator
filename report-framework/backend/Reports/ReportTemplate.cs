using System.Text.Json;
using System.Text.Json.Nodes;

namespace ReportMigrator.Api.Reports;

/// <summary>
/// A thin wrapper over the report-template JSON. The backend only needs the
/// dataSource (to fetch rows) and the param definitions; the full document is
/// passed through verbatim to the frontend renderer.
/// </summary>
public sealed class ReportTemplate
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public required JsonObject Root { get; init; }

    public JsonObject DataSource => Root["dataSource"]!.AsObject();
    public string RowsPath => DataSource["rowsPath"]!.GetValue<string>();

    public IReadOnlyDictionary<string, string> DataSourceParams()
    {
        var dict = new Dictionary<string, string>();
        if (DataSource["params"] is JsonObject ps)
            foreach (var kv in ps)
                dict[kv.Key] = kv.Value?.GetValue<string>() ?? "";
        return dict;
    }

    public static ReportTemplate Load(string path)
    {
        var json = File.ReadAllText(path);
        var root = JsonNode.Parse(json)!.AsObject();
        return new ReportTemplate
        {
            Id = root["id"]!.GetValue<string>(),
            Title = root["title"]!.GetValue<string>(),
            Root = root,
        };
    }
}

/// <summary>Loads and caches all templates from the templates directory.</summary>
public sealed class TemplateStore
{
    private readonly Dictionary<string, ReportTemplate> _byId = new(StringComparer.OrdinalIgnoreCase);

    public TemplateStore(string templatesDir)
    {
        if (!Directory.Exists(templatesDir)) return;
        foreach (var file in Directory.EnumerateFiles(templatesDir, "*.json"))
        {
            var t = ReportTemplate.Load(file);
            _byId[t.Id] = t;
        }
    }

    public IEnumerable<ReportTemplate> All => _byId.Values;
    public ReportTemplate? Get(string id) => _byId.GetValueOrDefault(id);
}
