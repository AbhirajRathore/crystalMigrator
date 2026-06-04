using System.Text.RegularExpressions;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ReportMigrator.Api.Reports;

/// <summary>
/// Calls the existing N1 dynamic-query API (the same endpoint as the sample curl)
/// and returns the detail rows located at the template's rowsPath.
/// </summary>
public sealed class N1DataClient
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public N1DataClient(HttpClient http, IConfiguration cfg)
    {
        _http = http;
        // e.g. "http://127.0.0.1:8000" — the FastAPI gateway from the curl sample.
        _baseUrl = cfg["DataApi:BaseUrl"]?.TrimEnd('/') ?? "http://127.0.0.1:8000";
    }

    private static readonly Regex ParamRx = new(@"\{\{\s*param\.(\w+)\s*\}\}", RegexOptions.Compiled);

    private static string FillParams(string tpl, IDictionary<string, string?> args) =>
        ParamRx.Replace(tpl, m => Uri.EscapeDataString(
            args.TryGetValue(m.Groups[1].Value, out var v) ? v ?? "" : ""));

    /// <summary>Resolve the template dataSource against runtime args and fetch rows.</summary>
    public async Task<JsonArray> FetchRowsAsync(
        ReportTemplate template,
        IDictionary<string, string?> args,
        string? bearerToken,
        CancellationToken ct)
    {
        var ds = template.DataSource;
        var endpoint = ds["endpoint"]?.GetValue<string>() ?? "/api/v1/n1/dynamic-query-data";

        var query = string.Join("&", template.DataSourceParams()
            .Select(kv => $"{Uri.EscapeDataString(kv.Key)}={FillParams(kv.Value, args)}"));

        var url = $"{_baseUrl}{endpoint}?{query}";

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Add("accept", "application/json");
        if (!string.IsNullOrWhiteSpace(bearerToken))
            req.Headers.Add("Authorization", $"Bearer {bearerToken}");

        using var resp = await _http.SendAsync(req, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Data API {(int)resp.StatusCode}: {body}");

        var json = JsonNode.Parse(body)!;
        var rows = ResolvePath(json, template.RowsPath);
        return rows as JsonArray ?? new JsonArray();
    }

    private static JsonNode? ResolvePath(JsonNode? node, string path)
    {
        foreach (var seg in path.Split('.'))
        {
            if (node is JsonObject o) node = o[seg];
            else return null;
        }
        return node;
    }
}
