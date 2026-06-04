using System.Text.Json.Nodes;
using ReportMigrator.Api.Reports;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHttpClient<N1DataClient>();
builder.Services.AddSingleton(_ =>
    new TemplateStore(Path.Combine(AppContext.BaseDirectory, "Reports", "templates")));
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseCors();

// --- Report catalog -------------------------------------------------------
// GET /api/v1/reports  -> list of available migrated reports
app.MapGet("/api/v1/reports", (TemplateStore store) =>
    Results.Ok(store.All.Select(t => new { id = t.Id, title = t.Title })));

// GET /api/v1/reports/{id}/template  -> the full template document for the renderer
app.MapGet("/api/v1/reports/{id}/template", (string id, TemplateStore store) =>
{
    var t = store.Get(id);
    return t is null ? Results.NotFound(new { error = $"Unknown report {id}" })
                     : Results.Text(t.Root.ToJsonString(), "application/json");
});

// GET /api/v1/reports/{id}/data?location=ANT&saleNo=1135675
// Resolves the template's dataSource, calls N1, and returns the clean row array.
// This is the per-report data endpoint the frontend binds to.
app.MapGet("/api/v1/reports/{id}/data", async (
    string id,
    HttpRequest http,
    TemplateStore store,
    N1DataClient client,
    CancellationToken ct) =>
{
    var t = store.Get(id);
    if (t is null) return Results.NotFound(new { error = $"Unknown report {id}" });

    var args = http.Query.ToDictionary(q => q.Key, q => (string?)q.Value.ToString(),
        StringComparer.OrdinalIgnoreCase);

    // Bearer token forwarded from the caller's Authorization header (or query for testing).
    var token = http.Headers.Authorization.ToString()
        .Replace("Bearer ", "", StringComparison.OrdinalIgnoreCase).Trim();
    if (string.IsNullOrWhiteSpace(token) && args.TryGetValue("token", out var qt)) token = qt;

    try
    {
        var rows = await client.FetchRowsAsync(t, args, token, ct);
        return Results.Json(new { reportId = id, count = rows.Count, rows });
    }
    catch (HttpRequestException ex)
    {
        return Results.Problem(ex.Message, statusCode: 502);
    }
});

// POST /api/v1/convert  — upload a .rpt, get back a generated template.json.
// Runs the Windows converter (rpt2template.exe) when configured & present; otherwise
// validates the file and returns a 'manual' status pointing at the Builder.
app.MapPost("/api/v1/convert", async (HttpRequest http, IConfiguration cfg, CancellationToken ct) =>
{
    if (!http.HasFormContentType)
        return Results.BadRequest(new { status = "error", message = "Expected multipart/form-data with a 'file'." });

    var form = await http.ReadFormAsync(ct);
    var file = form.Files["file"];
    if (file is null || file.Length == 0)
        return Results.BadRequest(new { status = "error", message = "No file uploaded." });

    // 1) save to temp under a unique dir, but keep the report's ORIGINAL file name so the
    //    converter derives the template id/title from it (e.g. "Export Invoice Sale.rpt"
    //    -> id "export-invoice-sale") instead of a random GUID.
    var tmpDir = Path.Combine(Path.GetTempPath(), $"rptin_{Guid.NewGuid():N}");
    Directory.CreateDirectory(tmpDir);
    var safeName = Path.GetFileName(file.FileName);   // strip any client-supplied path
    if (string.IsNullOrWhiteSpace(safeName)) safeName = "report.rpt";
    var tmp = Path.Combine(tmpDir, safeName);
    await using (var fs = File.Create(tmp))
        await file.CopyToAsync(fs, ct);

    try
    {
        // 2) validate it's an OLE2 compound doc (Crystal .rpt signature)
        var sig = new byte[8];
        await using (var rs = File.OpenRead(tmp))
            _ = await rs.ReadAsync(sig.AsMemory(0, 8), ct);
        var isOle2 = sig.Length >= 8 && sig[0] == 0xD0 && sig[1] == 0xCF && sig[2] == 0x11 && sig[3] == 0xE0;

        var meta = new
        {
            fileName = file.FileName,
            sizeBytes = file.Length,
            looksLikeCrystalRpt = isOle2,
        };

        if (!isOle2)
            return Results.Json(new { status = "error", message = "Not a valid Crystal .rpt (OLE2) file.", meta });

        // 3) run the converter if available
        var exe = cfg["Converter:ExePath"]; // e.g. C:\tools\rpt2template.exe
        if (!string.IsNullOrWhiteSpace(exe) && File.Exists(exe))
        {
            var outDir = Path.Combine(Path.GetTempPath(), $"rptout_{Guid.NewGuid():N}");
            Directory.CreateDirectory(outDir);
            var psi = new System.Diagnostics.ProcessStartInfo(exe!)
            {
                ArgumentList = { tmp, "-o", outDir },
                RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false,
            };
            using var proc = System.Diagnostics.Process.Start(psi)!;
            await proc.WaitForExitAsync(ct);
            var templateFile = Directory.EnumerateFiles(outDir, "*.template.json").FirstOrDefault();
            if (proc.ExitCode == 0 && templateFile is not null)
            {
                var templateJson = await File.ReadAllTextAsync(templateFile, ct);
                return Results.Content(
                    $"{{\"status\":\"ok\",\"message\":\"Converted via SDK. Refine in Builder if needed.\",\"template\":{templateJson}}}",
                    "application/json");
            }
            return Results.Json(new {
                status = "manual",
                message = "Converter ran but produced no template. Finish in the Builder.",
                warnings = new[] { await proc.StandardError.ReadToEndAsync(ct) },
                meta,
            });
        }

        // 4) no converter on this host (e.g. non-Windows) — honest fallback
        return Results.Json(new {
            status = "manual",
            message = "File is a valid Crystal report, but the .rpt→template converter " +
                      "(SAP SDK, Windows-only) is not configured on this server. Deploy rpt2template.exe " +
                      "and set Converter:ExePath, or build the template in the Builder using live field discovery.",
            warnings = new[] {
                "Crystal .rpt layout streams are encrypted; the SDK is required to read them.",
                "Set Converter:ExePath in appsettings.json to enable automated conversion.",
            },
            meta,
        });
    }
    finally
    {
        try { Directory.Delete(tmpDir, recursive: true); } catch { /* best effort */ }
    }
});

// Convenience pass-through that keeps the original generic shape the frontend can also call.
app.MapGet("/api/v1/n1/dynamic-query-data", () =>
    Results.Problem("Configure the frontend to call /api/v1/reports/{id}/data, or proxy this path to the N1 gateway.", statusCode: 501));

app.Run();
