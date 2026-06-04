# ERP Backend Integration Guide — Report Template JSON

**Audience:** the ERP backend team / AI that owns the database. This document is
self-contained: you do **not** need access to the React frontend's source to
implement your side. Read it fully before implementing.

---

## 1. What this is

We migrated legacy **Crystal Reports** to a **React frontend**. Each report is now a
single declarative **`template.json`** file. The frontend renders it (and exports PDF)
by combining the template with **rows of data your backend supplies**.

A utility produces each `template.json` (by converting the old `.rpt` or via a visual
builder). **You store these template files on your API server (which has DB access) and
serve two things to the frontend: the template, and the data.**

```
┌────────────┐   template.json (stored on your server)   ┌─────────────────┐
│  Utility   │ ─────────────────────────────────────────▶│  YOUR ERP API   │
│ (.rpt→json)│                                            │  (DB access)    │
└────────────┘                                            └────────┬────────┘
                                                                    │ 1. GET template
                                                  2. GET data ──────┤ (runs view/proc)
                                                                    ▼
                                                          ┌──────────────────┐
                                                          │  React frontend  │
                                                          │  renders + PDF   │
                                                          └──────────────────┘
```

**Your job is small and mechanical:** read a template's `dataSource`, run the named
view/stored-proc with the given parameters, and return the rows in a fixed envelope.
**You do not compute totals, formatting, grouping, or layout** — the frontend does all
of that. You return **raw rows**; the frontend turns them into the report.

---

## 2. The single most important rule

> **Return raw detail rows with original column names and native types.
> Do NOT pre-aggregate, pre-format, or rename anything.**

The template references your columns directly (e.g. `row.AMOUNT_DOLLAR`,
`header.COMPANY_NAME`). If you rename a column, change a number to a formatted string,
or collapse detail rows into a summary, the report will render blank or wrong.

Concretely:
- A number is a JSON number: `1051.218`, **not** `"1,051.22"`.
- A date is an ISO string: `"2026-06-02T00:00:00"`, **not** `"02/06/2026"`.
- `null` is allowed (the template handles missing values).
- If the report shows 8 line items summarised into 1 total, **still return all 8 rows** —
  the template does the summing.

---

## 3. The two endpoints you implement

### 3.1  Serve the template
```
GET /api/v1/reports/{id}/template
→ 200 application/json   (the stored template.json verbatim)
```
The frontend fetches this to know how to render. You serve the file as-is.

### 3.2  Serve the data  ← the important one
```
GET /api/v1/reports/{id}/data?{parameters}
Authorization: Bearer <token>          (forward/validate as your auth requires)
→ 200 application/json   { envelope containing the rows }
```

**How you build the query:** open the stored `template.json` for `{id}`, read its
`dataSource` block (Section 4), substitute the incoming parameters, run it against the
DB, and return the rows.

You may instead expose the **generic** form the template can point at directly
(simpler, but the frontend then knows the view/proc name):
```
GET /api/v1/n1/dynamic-query-data?location=ANT&Name=VIW_SALE_MASTER_DETAIL&Criteria=SALE_NO=1135675
```
Both are fine. **The per-report `/{id}/data` form is recommended** because the DB object
name and parameter binding stay server-side (safer — see Section 8).

---

## 4. The `dataSource` block — your contract

This is the only part of the template you must understand to fetch data. Example:

```jsonc
"dataSource": {
  "endpoint": "/api/v1/n1/dynamic-query-data",  // the path the frontend calls
  "method": "GET",
  "params": {                                   // query params to send; values may
    "location": "{{param.location}}",           //   contain {{param.X}} placeholders
    "Name":     "VIW_SALE_MASTER_DETAIL",        //   ← the view OR stored-proc name
    "Criteria": "SALE_NO={{param.saleNo}}"       //   ← filter / proc args
  },
  "rowsPath": "raw_response.Data"               // where the row array sits in YOUR response
}
```

| Field | Meaning | What you do |
|-------|---------|-------------|
| `endpoint` | path the frontend calls | route it to your handler |
| `params.Name` | the **view or stored-proc** to run | `SELECT * FROM {Name}` or `EXEC {Name}` |
| `params.Criteria` | filter for a view | becomes the `WHERE` (bind it, Section 8) |
| other `params.*` | proc parameters / context (`location`, etc.) | bind to proc args |
| `{{param.X}}` | a **user input** (Section 5) | substitute before running |
| `rowsPath` | dot-path to the rows in **your** JSON response | put your rows there |

**Stored-proc variant** — same idea, different params:
```jsonc
"dataSource": {
  "endpoint": "/api/v1/n1/dynamic-proc-data",
  "params": { "location": "{{param.location}}", "Name": "USP_EXPORT_INVOICE",
              "p_SaleNo": "{{param.saleNo}}" },
  "rowsPath": "Data"
}
```
→ you run `EXEC USP_EXPORT_INVOICE @SaleNo = <saleNo>` and return rows at `Data`.

---

## 5. Parameters (`{{param.X}}`)

The template declares user inputs:

```jsonc
"params": [
  { "name": "location", "type": "string", "default": "ANT" },
  { "name": "saleNo",   "type": "number" }
]
```

Flow: the user enters these in the frontend → the frontend fills the `{{param.X}}`
placeholders in `dataSource.params` → calls your endpoint with the resolved values.
So by the time the request reaches you, placeholders are already substituted:

```
GET /api/v1/reports/export-invoice-sale/data?location=ANT&saleNo=1135675
```

Bind `saleNo`/`location` as **SQL parameters**, never string concatenation.

---

## 6. The response envelope

Return JSON with the row array located exactly at the template's `rowsPath`.
For `rowsPath: "raw_response.Data"`:

```jsonc
{
  "raw_response": {
    "Success": true,
    "Message": "Request successful",
    "Data": [                         // ← the rows the frontend reads
      { "COMPANY_NAME": "KGK DIAMONDS BV", "SALE_NO": 1135675,
        "SALE_DATE": "2026-06-02T00:00:00", "TO_PARTY_NAME": "ANITA DIAMONDS BV",
        "SALE_CARAT": 0.9, "AMOUNT_DOLLAR": 1051.218, "DET_DESCRIPTION": "BR D SI1 Y",
        "LOCAL_EXCHANGE_RATE": 0.862, "PAYMENT_DAYS": "90 DAYS", "BILL_OF_ENTRY_NO": "KGLS-437/2627P",
        /* …all columns the view/proc returns… */ },
      { "...": "row 2" }, { "...": "row 3" }   /* …all detail rows… */
    ]
  }
}
```

Rules:
- The array at `rowsPath` is the **detail rows**, one object per row, original column names.
- **Single-record header values** (company, party, dates, totals base) are read from the
  **first row** — so every row may repeat them (that's fine and expected; it's how the
  view already returns them).
- **Multiple result sets** (stored procs): expose each under its own path and the
  template's `rowsPath` will point at the right one, e.g.
  `{ "DataSets": { "Header": [...], "Lines": [...] } }` with `rowsPath: "DataSets.Lines"`.

---

## 7. End-to-end worked example

**Template** `export-invoice-sale.json` (abridged):
```jsonc
{ "id": "export-invoice-sale",
  "dataSource": { "endpoint": "/api/v1/n1/dynamic-query-data",
    "params": { "location": "{{param.location}}", "Name": "VIW_SALE_MASTER_DETAIL",
                "Criteria": "SALE_NO={{param.saleNo}}" },
    "rowsPath": "raw_response.Data" },
  "params": [ { "name": "location", "default": "ANT" }, { "name": "saleNo" } ] }
```

**1. Frontend → your API** (placeholders already filled):
```
GET /api/v1/n1/dynamic-query-data?location=ANT&Name=VIW_SALE_MASTER_DETAIL&Criteria=SALE_NO%3D1135675
Authorization: Bearer eyJ...
```

**2. You run** (parameter-bound):
```sql
SELECT * FROM VIW_SALE_MASTER_DETAIL WHERE SALE_NO = @saleNo   -- @saleNo = 1135675
```

**3. You return** the envelope from Section 6 (all 8 rows, raw).

**4. The frontend** then, on its own:
- reads `header.COMPANY_NAME` etc. from row 0,
- `sum(AMOUNT_DOLLAR)` = 19,795.86, `sum(SALE_CARAT)` = 8.32, PPC = sum/sum,
- groups the 8 lines into the "Polished Natural Diamonds" summary row,
- formats `$ 19,795.86`, `02/06/2026`,
- renders the invoice and offers **Print/PDF**.

You did step 2–3 only. Everything visual is the frontend.

---

## 8. Security (important)

- **Bind parameters.** `Criteria`/proc args must become SQL parameters, never
  concatenated strings. Treat `Criteria` as a *typed filter*, not raw SQL — parse
  `FIELD=value` and bind `value`. Reject anything else.
- **Allowlist the views/procs.** Only run `Name` values that belong to a registered
  report template you stored. Do not run arbitrary names sent by a client.
- **Keep DB object names server-side** by preferring the `/reports/{id}/data` form: the
  client sends only `{id}` + user params; you look up the view/proc from the stored template.
- **Auth:** validate the Bearer token as your platform requires before querying.

---

## 9. Checklist for the ERP backend (the AI's rules)

Do:
- [ ] Serve the stored `template.json` at `GET /reports/{id}/template`.
- [ ] On `GET /reports/{id}/data`, read the template's `dataSource`, run the `Name`
      view/proc with **bound** parameters, return rows at the template's `rowsPath`.
- [ ] Return **all** detail rows, **original column names**, **native types**
      (numbers as numbers, dates as ISO strings, nulls allowed).
- [ ] Put header/single-record fields on every row (or at least row 0).
- [ ] Validate `Name` against an allowlist; bind all values.

Do **not**:
- [ ] ❌ Pre-aggregate, pre-sum, or collapse detail rows.
- [ ] ❌ Pre-format numbers/dates into display strings.
- [ ] ❌ Rename columns the template binds to.
- [ ] ❌ Concatenate user input into SQL.
- [ ] ❌ Compute layout, totals, PPC, currency — that's the frontend's job.

---

## 10. How to know which columns a template needs

Open the template and search for these — every referenced column must exist in your
view/proc output (case-sensitive match):

- `header`: the map values are column names read from row 0
  (e.g. `"companyName": "COMPANY_NAME"` → you must return `COMPANY_NAME`).
- `computed[*].field` and `groups[*].aggregates[*].field`: columns that get summed
  (e.g. `AMOUNT_DOLLAR`, `SALE_CARAT`).
- `body` bindings `{{row.X}}`: columns shown in the detail table.

If a template binds `row.FOO` and your result set has no `FOO`, that cell renders empty.
A quick contract test: `GET /reports/{id}/data`, collect the keys of row 0, and confirm
every column named in the template's `header`, `computed`, `groups`, and `{{row.*}}`
bindings is present.

---

## 11. Glossary

| Term | Meaning |
|------|---------|
| **template.json** | the declarative report definition (replaces the `.rpt`) |
| **dataSource** | the block telling you which view/proc + params to run |
| **rowsPath** | dot-path to the row array inside your JSON response |
| **header** | single-record fields, read from row 0 |
| **computed / groups** | totals & summaries the **frontend** calculates from your rows |
| **{{param.X}}** | a user input, already substituted before the request reaches you |
| **{{row.X}} / {{header.X}}** | frontend bindings to your column `X` |

---

## 12. Minimal reference implementation (pseudocode)

```text
GET /api/v1/reports/{id}/data:
    template = loadStoredTemplate(id)              # the json you stored
    ds       = template.dataSource
    assertAllowlisted(ds.params.Name)              # security
    args     = request.query                       # location, saleNo, ...
    if endpoint is view-style:
        field, value = parse(ds.params.Criteria after substitution)  # "SALE_NO", 1135675
        rows = db.query(f"SELECT * FROM {ds.params.Name} WHERE {field} = @v", v=value)
    else: # proc-style
        rows = db.exec(ds.params.Name, bindProcArgs(ds.params, args))
    return placeAt(ds.rowsPath, rows)              # e.g. { raw_response: { Data: rows } }
```

That's the whole integration. Return raw rows; the frontend renders the report and PDF.
