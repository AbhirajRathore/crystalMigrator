# Example: serving a report's data from a stored proc (`invoicecalc`)

Scenario: the `.rpt` was converted to `invoice.template.json`, stored in the backend.
Its data source is the stored proc **`invoicecalc`**, which takes parameters
(`@SaleNo`, `@Location`, `@FinYear`). This shows the **backend C#** that runs the proc and
returns rows in the shape the React template expects.

## 1. The template's dataSource (what the converter produced + you set the Name)

```jsonc
"dataSource": {
  "endpoint": "/api/v1/reports/export-invoice-sale/data",
  "params": {
    "Name":     "invoicecalc",            // ← the stored proc (you supplied this)
    "SaleNo":   "{{param.saleNo}}",       // ← proc args, filled from user input
    "Location": "{{param.location}}",
    "FinYear":  "{{param.finYear}}"
  },
  "rowsPath": "raw_response.Data"          // ← where the backend returns the rows
}
```

## 2. appsettings.json — DB connection

```json
{
  "ConnectionStrings": {
    "Erp": "Server=10.x.x.x;Database=KGK_ERP;User Id=report_ro;Password=***;TrustServerCertificate=True;"
  }
}
```
NuGet: `dotnet add package Microsoft.Data.SqlClient`

## 3. The data endpoint (explicit, easy to read)

```csharp
using System.Data;
using Microsoft.Data.SqlClient;

// GET /api/v1/reports/{id}/data?saleNo=1135675&location=ANT&finYear=2026-2027
app.MapGet("/api/v1/reports/{id}/data", async (
    string id, HttpRequest http, TemplateStore store, IConfiguration cfg, CancellationToken ct) =>
{
    // a) load the ALREADY-CONVERTED template stored in the backend
    var t = store.Get(id);
    if (t is null) return Results.NotFound(new { error = $"Unknown report {id}" });

    // b) the proc name comes from the TEMPLATE (server-side), never from the client
    var procName = t.DataSource["params"]!["Name"]!.GetValue<string>();   // "invoicecalc"

    // c) the param VALUES come from the request query (already substituted by the frontend)
    var q = http.Query;

    var rows = new List<Dictionary<string, object?>>();
    await using var conn = new SqlConnection(cfg.GetConnectionString("Erp"));
    await conn.OpenAsync(ct);

    await using var cmd = new SqlCommand(procName, conn) { CommandType = CommandType.StoredProcedure };
    // bind parameters — values are bound (never string-concatenated → no SQL injection)
    cmd.Parameters.Add(new SqlParameter("@SaleNo",   SqlDbType.Int)        { Value = ToInt(q["saleNo"]) });
    cmd.Parameters.Add(new SqlParameter("@Location", SqlDbType.VarChar, 10){ Value = (object?)q["location"].FirstOrDefault() ?? DBNull.Value });
    cmd.Parameters.Add(new SqlParameter("@FinYear",  SqlDbType.VarChar, 12){ Value = (object?)q["finYear"].FirstOrDefault()  ?? DBNull.Value });

    // d) read EVERY column the proc returns into a generic row (no per-report model needed)
    await using var rdr = await cmd.ExecuteReaderAsync(ct);
    while (await rdr.ReadAsync(ct))
    {
        var row = new Dictionary<string, object?>(rdr.FieldCount);
        for (var i = 0; i < rdr.FieldCount; i++)
            row[rdr.GetName(i)] = rdr.IsDBNull(i) ? null : rdr.GetValue(i);   // native types, original names
        rows.Add(row);
    }

    // e) return in the envelope the template's rowsPath expects: raw_response.Data
    return Results.Json(new { raw_response = new { Success = true, Message = "OK", Data = rows } });
});

static int ToInt(string? s) => int.TryParse(s, out var n) ? n : 0;
```

That's the whole thing. The frontend calls
`/api/v1/reports/export-invoice-sale/data?saleNo=1135675&location=ANT&finYear=2026-2027`,
you run `EXEC invoicecalc @SaleNo, @Location, @FinYear`, and return the rows. The React
engine then groups/totals/formats and renders + PDF.

## 4. Generic version (auto-bind ANY proc's params — no hardcoding)

For 20 reports with different procs, don't hardcode parameter names. Let SQL Server tell
you which params the proc declares, and fill them from the request by name:

```csharp
await using var cmd = new SqlCommand(procName, conn) { CommandType = CommandType.StoredProcedure };

// ask the DB what parameters this proc has
SqlCommandBuilder.DeriveParameters(cmd);

// fill each declared param from the query string (case-insensitive), null if absent
foreach (SqlParameter p in cmd.Parameters)
{
    if (p.Direction == ParameterDirection.ReturnValue) continue;
    var key = p.ParameterName.TrimStart('@');                 // @SaleNo -> SaleNo
    var val = http.Query[key].FirstOrDefault();
    p.Value = string.IsNullOrEmpty(val) ? DBNull.Value : Convert.ChangeType(val, MapClrType(p.SqlDbType));
}
// ...execute + read exactly as above...
```

This same handler then serves **every** report — each template just carries a different
`Name` and the user params. (Cache the derived parameters per proc to avoid the extra round-trip.)

## 5. Shorter with Dapper (optional)

```csharp
using Dapper;
var rows = await conn.QueryAsync(
    "invoicecalc",
    new { SaleNo = ToInt(q["saleNo"]), Location = q["location"].FirstOrDefault(), FinYear = q["finYear"].FirstOrDefault() },
    commandType: CommandType.StoredProcedure);
return Results.Json(new { raw_response = new { Data = rows } });
```

## 6. Notes that matter

- **Return raw rows, native types.** `rdr.GetValue` keeps numbers as numbers and dates as
  `DateTime` (serialized to ISO) — exactly what the template binds to. Don't pre-format.
- **Column names must match** the template bindings (`{{row.AMOUNT_DOLLAR}}`, the `header`
  aliases). They come straight from the proc's `SELECT`, so they already match.
- **Multiple result sets:** if `invoicecalc` returns header + lines, read both and shape as
  `{ raw_response: { Header: [...], Data: [...] } }`; point each template at the right
  `rowsPath`. Use `rdr.NextResult()` to advance.
- **Security:** parameters are **bound**, and `procName` comes from the **stored template**,
  not the client — so a caller can only run procs you've registered as reports.
- **rowsPath is the contract:** whatever nesting you return, it must match the template's
  `rowsPath`. Here `raw_response.Data` ↔ `new { raw_response = new { Data = rows } }`.
```
