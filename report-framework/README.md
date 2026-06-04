# KGK Report Migrator — Crystal Reports → React + .NET

Migrate Crystal `.rpt` reports to a **React frontend + .NET Core backend**, with
**no paid software**. A report becomes a small **declarative JSON template** that the
React engine renders against live API data. Each report = one template + one endpoint.

This was built and verified against the **Export Invoice Sale** report
(`VIW_SALE_MASTER_DETAIL`), reproducing the supplied PDF pixel-for-pixel from live data.

```
 .rpt  ──(converter, Windows SDK)──►  template.json  ──►  React engine ──► HTML/print
                                          ▲                    │
        hand-authored from PDF ───────────┘                    └── fetches rows from
                                                                   .NET endpoint → N1 API
```

## What's in here

| Folder | Purpose |
|--------|---------|
| `schema/report-template.schema.json` | The **template format** (JSON Schema). One declarative document describes a whole report: data source, derived fields, grouping/totals, and layout blocks. Frontend and backend both consume it. |
| `templates/export-invoice-sale.json` | The fully hand-authored template for this invoice — the reference example. |
| `frontend/` | **React + Vite + TS** renderer engine. Generic: give it any template + rows and it draws the report. Includes the invoice app, print-to-PDF, and an offline **Demo data** mode. |
| `backend/` | **ASP.NET Core (.NET 8)** endpoint pattern. Serves templates and proxies the N1 `dynamic-query-data` API. Adding a report = drop a template + it's auto-served. |
| `converter/` | **Windows C# tool** (`rpt2template`) using the free SAP Crystal SDK to dump any `.rpt`'s objects/fields/formulas to JSON + a starter template. |
| `frontend/src/builder/` | The in-app **utility**: an **Upload `.rpt`** tab (upload → convert → generated `template.json` → preview → download) and a **structured drag-and-drop Builder** (data source + field discovery → drag fields into bands → totals/format → live preview → export). |
| **[ERP-BACKEND-INTEGRATION.md](./ERP-BACKEND-INTEGRATION.md)** | **Hand this to the ERP backend team/AI.** Self-contained contract: how to read a template's `dataSource`, run the view/proc, and return raw rows so the frontend renders + exports PDF. |

## The utility (upload → JSON → render → download)

The frontend has three tabs:
- **Render** — pick a stored report, fetch live data, render, Print/PDF.
- **Build** — author a new template by dragging discovered fields into bands (no `.rpt` needed).
- **Upload .rpt** — drop a `.rpt`; the backend `POST /api/v1/convert` validates it and (on a
  Windows host with the SAP SDK + `Converter:ExePath` set) runs `rpt2template` to generate the
  `template.json`, which you preview and **download** to store on your API server.

> The `.rpt`→JSON conversion step requires the **free SAP Crystal SDK on Windows** (the layout
> streams are encrypted — see `converter/README.md`). On non-Windows hosts the upload endpoint
> validates the file and routes you to the Builder. Everything else runs anywhere.

## The key constraint (read this)

`.rpt` files are an **OLE2 compound document with compressed/encrypted layout
streams** — there is no readable XML inside, and SAP never published the format.
So there are exactly two ways to produce a template, and this repo supports both:

1. **Automated (Windows):** `converter/` opens the `.rpt` with SAP's free SDK and
   extracts everything (positions, fonts, fields, **formula source text**, groups).
   You finish the template using that extraction. Best for bulk migration.
2. **Hand-authored (any OS):** read the rendered PDF + the API response and write the
   template directly — as done for `export-invoice-sale.json`. Fastest for one report.

Either way the output is the **same template JSON**, and the React engine is identical.

## Quick start (the working demo)

```bash
# 1. Frontend
cd frontend
npm install
npm run dev          # http://localhost:5180

# In the UI: pick "Export Invoice Sale", set Location=ANT, Sale No=1135675,
# paste a valid Bearer token, click Generate  → the invoice renders.
# No token handy? Click "Demo data" to render from the bundled sample_data.json.
# Click "Print / PDF" to export.

# 2. Backend (optional — serves templates + proxies N1)
cd ../backend
dotnet run           # http://localhost:5249
#   GET /api/v1/reports
#   GET /api/v1/reports/export-invoice-sale/template
#   GET /api/v1/reports/export-invoice-sale/data?location=ANT&saleNo=1135675
#       (forward your Bearer token; it proxies to the N1 gateway in appsettings.json)
```

The frontend dev server proxies `/api/*` to `DATA_API` (default `http://127.0.0.1:8000`,
the FastAPI gateway from your curl). Point it at the .NET backend instead by setting
`DATA_API=http://localhost:5249` — or change each template's `dataSource.endpoint` to
`/api/v1/reports/<id>/data`.

## How a report renders

1. `dataSource` tells the frontend which endpoint to call and where the row array is
   (`rowsPath`, e.g. `raw_response.Data`). `{{param.x}}` placeholders are filled from UI inputs.
2. `header` maps aliases to single-record fields (taken from the first row — Crystal's report header).
3. `computed` evaluates aggregates once over all rows (`sum`, `divide`, …) → totals, FX rate.
4. `groups` summarise detail rows (Crystal group sections). The invoice groups its 8 line
   items into one **"Polished Natural Diamonds"** row: `carats = sum(SALE_CARAT)`,
   `amount = sum(AMOUNT_DOLLAR)`, `ppc = amount / carats`.
5. `body` is an ordered list of layout blocks (`row`, `column`, `text`, `labeledField`,
   `table`, `richtext`, `image`, `html`). Bindings use `{{path | filter:arg}}` —
   e.g. `{{computed.grandTotal | money}}`, `{{header.saleDate | date:dd/MM/yyyy}}`.

See **[TEMPLATE-AUTHORING.md](./TEMPLATE-AUTHORING.md)** for the full block/binding reference
and a step-by-step for migrating the next report.

## Adding the next report

1. Get its template: run `converter/` on the `.rpt` **or** hand-author from the PDF.
2. Drop `templates/<id>.json` (and `frontend/public/templates/<id>.json`, `backend/Reports/templates/<id>.json`).
3. Register it in `frontend/src/reports/registry.ts`.
4. If it uses a different view/criteria, that's just its `dataSource` — no engine changes.

That's the whole point: **new report = new JSON, not new code.**
