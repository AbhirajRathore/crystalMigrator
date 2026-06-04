# `.rpt` → template extractor (Windows)

Crystal `.rpt` files are an **OLE2 compound document whose layout streams are
compressed/encrypted**. (Inspect one and every string is scrambled — there is no
readable XML inside.) No free, cross-platform library can parse the layout reliably.
The only dependable reader is SAP's own SDK, which is **free but Windows-only**.

This tool uses that SDK to open any `.rpt` and dump its full object model to JSON,
plus a *starter* template you finish by hand.

## 1. Install the free SDK (one time)

Download **“SAP Crystal Reports, developer version for Microsoft Visual Studio”**
(free from SAP). It installs the `CrystalDecisions.*` assemblies used here.
After install, fix the `<HintPath>`s in `RptToTemplate.csproj` if your path differs,
or rely on the GAC. Match the **bitness** (`PlatformTarget` x86/x64) to the runtime
you installed.

## 2. Build & run (Windows)

```powershell
cd RptToTemplate
dotnet build -c Release
.\bin\Release\net48\rpt2template.exe "..\..\..\Export Invoice Sale.rpt" -o out
```

## 3. Output

| File | What it is |
|------|------------|
| `<name>.extraction.json` | Faithful dump: data tables (the view name, e.g. `VIW_SALE_MASTER_DETAIL`), the SQL (when retrievable), every database field, **every Crystal formula with its source text**, parameters, groups, and **every report object** with `left/top/width/height`, font, bold, and its text or `{Table.FIELD}` binding. This is your source of truth for migrating. |
| `<name>.template.json` | A **starter** matching `schema/report-template.schema.json`: data source pre-filled from the view name, and one `text`/`field` block per Crystal object (with `_hint`s pointing back to the original). You then add the layout containers, grouping, `computed` totals and final bindings — using the extraction as reference. |

The starter is intentionally not a finished report: Crystal mixes absolute-positioned
bands, sub-reports, conditional suppression and formula fields that don't map 1:1 to
clean HTML. The extraction gives you everything; you curate the template. The complete,
hand-finished result for this invoice lives at
`report-framework/templates/export-invoice-sale.json` — use it as the reference.

## Why not parse the binary directly?

`Export Invoice Sale.rpt` is `Composite Document File V2` (OLE2). Its `Contents`,
`QESession` and embedded streams are compressed — `strings` returns only scrambled
tokens like `177P085X`. SAP has never published the format. So: SDK on Windows for
**automated** extraction, or hand-authoring from the rendered PDF for a quick start.
Both paths produce the same template JSON the React engine consumes.
