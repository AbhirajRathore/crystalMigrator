using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using CrystalDecisions.CrystalReports.Engine;
using CrystalDecisions.Shared;

namespace RptToTemplate;

/// <summary>
/// Opens a Crystal Reports .rpt file using the (free) SAP CrystalDecisions SDK and
/// dumps its object model to JSON. Crystal .rpt files are a compressed/encrypted OLE2
/// format, so the SDK is the only reliable way to read the layout. This is Windows-only.
///
///   rpt2template "Export Invoice Sale.rpt" -o out
///
/// Produces:
///   out\&lt;name&gt;.extraction.json  — faithful dump: data source, fields, formulas, sections,
///                                  every report object with position/font/text.
///   out\&lt;name&gt;.template.json    — a STARTER template (schema/report-template.schema.json)
///                                  scaffolded from the sections; hand-finish bindings & grouping.
/// </summary>
internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine(
                "usage: rpt2template <file.rpt> [-o outDir] [--datasource VIEW_OR_SP] [--rowspath PATH] [--criteria \"SALE_NO={{param.saleNo}}\"]");
            return 1;
        }
        var rptPath = args[0];
        var outDir = "out";
        string? dataSourceOverride = null, rowsPathOverride = null, criteriaOverride = null;
        for (var i = 1; i < args.Length; i++)
        {
            var next = i + 1 < args.Length ? args[i + 1] : null;
            switch (args[i])
            {
                case "-o": outDir = next ?? outDir; i++; break;
                case "--datasource": dataSourceOverride = next; i++; break;
                case "--rowspath": rowsPathOverride = next; i++; break;
                case "--criteria": criteriaOverride = next; i++; break;
            }
        }
        Directory.CreateDirectory(outDir);

        var doc = new ReportDocument();
        doc.Load(rptPath);

        var extraction = Extract(doc);
        var baseName = Path.GetFileNameWithoutExtension(rptPath);

        var opts = new JsonSerializerOptions { WriteIndented = true };
        File.WriteAllText(Path.Combine(outDir, baseName + ".extraction.json"),
            extraction.ToJsonString(opts));

        var template = Scaffold(extraction, baseName, dataSourceOverride, rowsPathOverride, criteriaOverride);
        File.WriteAllText(Path.Combine(outDir, baseName + ".template.json"),
            template.ToJsonString(opts));

        Console.WriteLine($"Wrote {baseName}.extraction.json and {baseName}.template.json to {outDir}");
        doc.Close();
        return 0;
    }

    // ---- faithful extraction ------------------------------------------------

    private static JsonObject Extract(ReportDocument doc)
    {
        var root = new JsonObject
        {
            ["reportName"] = doc.Name,
            ["recordSelectionFormula"] = doc.RecordSelectionFormula,
        };

        // Database tables + their location (often the view/SP name) and the qualified SQL.
        var tables = new JsonArray();
        foreach (Table t in doc.Database.Tables)
        {
            tables.Add(new JsonObject
            {
                ["name"] = t.Name,
                ["location"] = t.Location,   // e.g. VIW_SALE_MASTER_DETAIL
            });
        }
        root["tables"] = tables;
        TryAddSql(doc, root);

        // Field definitions: database, formula (with text), parameter, running totals.
        root["databaseFields"] = MapFields(doc.DataDefinition.FormulaFields, isFormula: false, doc);
        root["formulaFields"] = FormulaFields(doc);
        root["parameterFields"] = ParameterFields(doc);
        root["groups"] = GroupFields(doc);

        // Layout: sections -> report objects with geometry, font and text/binding.
        var sections = new JsonArray();
        foreach (Section sec in doc.ReportDefinition.Sections)
        {
            var objs = new JsonArray();
            foreach (ReportObject ro in sec.ReportObjects)
                objs.Add(MapObject(ro));
            sections.Add(new JsonObject
            {
                ["name"] = sec.Name,
                ["kind"] = sec.Kind.ToString(),
                ["height"] = sec.Height,
                ["objects"] = objs,
            });
        }
        root["sections"] = sections;
        return root;
    }

    private static void TryAddSql(ReportDocument doc, JsonObject root)
    {
        try
        {
            // Available when the report was loaded for editing. Note: the property is
            // RowsetController (lowercase 's') and GetSQLStatement takes a group path
            // (null = whole report) plus a single reserved out-param in this runtime.
            var sql = doc.ReportClientDocument?.RowsetController?
                .GetSQLStatement(null, out _);
            if (!string.IsNullOrWhiteSpace(sql)) root["sql"] = sql;
        }
        catch { /* SQL not always retrievable; tables[].location is the fallback */ }
    }

    private static JsonArray MapFields(object _, bool isFormula, ReportDocument doc)
    {
        var arr = new JsonArray();
        foreach (DatabaseFieldDefinition f in doc.Database.Tables
                     .Cast<Table>().SelectMany(t => t.Fields.Cast<DatabaseFieldDefinition>()))
        {
            arr.Add(new JsonObject
            {
                ["name"] = f.Name,
                ["formula"] = f.FormulaName,           // {Table.FIELD}
                ["type"] = f.ValueType.ToString(),
                ["table"] = f.TableName,
            });
        }
        return arr;
    }

    private static JsonArray FormulaFields(ReportDocument doc)
    {
        var arr = new JsonArray();
        foreach (FormulaFieldDefinition f in doc.DataDefinition.FormulaFields)
            arr.Add(new JsonObject
            {
                ["name"] = f.Name,
                ["formula"] = f.FormulaName,            // {@MyFormula}
                ["text"] = f.Text,                     // the Crystal formula source
                ["type"] = f.ValueType.ToString(),
            });
        return arr;
    }

    private static JsonArray ParameterFields(ReportDocument doc)
    {
        var arr = new JsonArray();
        foreach (ParameterFieldDefinition p in doc.DataDefinition.ParameterFields)
            arr.Add(new JsonObject
            {
                ["name"] = p.Name,
                ["formula"] = p.FormulaName,
                ["type"] = p.ValueType.ToString(),
                ["prompt"] = p.PromptText,
            });
        return arr;
    }

    private static JsonArray GroupFields(ReportDocument doc)
    {
        var arr = new JsonArray();
        foreach (Group g in doc.DataDefinition.Groups)
            arr.Add(new JsonObject { ["conditionField"] = g.ConditionField?.FormulaName });
        return arr;
    }

    private static JsonObject MapObject(ReportObject ro)
    {
        var o = new JsonObject
        {
            ["name"] = ro.Name,
            ["kind"] = ro.Kind.ToString(),
            ["left"] = ro.Left, ["top"] = ro.Top,
            ["width"] = ro.Width, ["height"] = ro.Height,
        };
        switch (ro)
        {
            // FieldHeadingObject derives from TextObject, so it must be matched first.
            case FieldHeadingObject fh:
                o["text"] = fh.Text;
                break;
            case TextObject txt:
                o["text"] = txt.Text;
                o["font"] = txt.Font.Name;
                o["fontSize"] = txt.Font.Size;
                o["bold"] = txt.Font.Bold;
                break;
            case FieldObject fld:
                o["dataSource"] = fld.DataSource?.FormulaName; // {Table.FIELD} or {@Formula}
                o["font"] = fld.Font.Name;
                o["fontSize"] = fld.Font.Size;
                o["bold"] = fld.Font.Bold;
                break;
        }
        return o;
    }

    // ---- starter-template scaffold -----------------------------------------

    /// <summary>
    /// A generic ADO.NET table name (DataTable1, Table1, NewDataSet, ...) means the report
    /// was built on a PUSHED dataset — the real view/SP name is NOT stored in the .rpt.
    /// </summary>
    private static bool IsGenericTableName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return true;
        var n = name!.Trim();
        return System.Text.RegularExpressions.Regex.IsMatch(
            n, @"^(DataTable\d*|Table\d*|NewDataSet|Dataset\d*|Untitled.*)$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    /// <summary>Clean a Crystal table location like "db.dbo.USP_X;1" down to "USP_X".</summary>
    private static string CleanName(string raw)
    {
        var n = raw;
        var semi = n.IndexOf(';'); if (semi >= 0) n = n.Substring(0, semi); // strip proc ;1
        var dot = n.LastIndexOf('.'); if (dot >= 0) n = n.Substring(dot + 1); // strip db.schema.
        return n.Trim();
    }

    /// <summary>Best real data-source name from the tables, or null if all are generic pushed datasets.</summary>
    private static string? DetectDataSourceName(JsonObject extraction)
    {
        if (extraction["tables"] is not JsonArray tables) return null;
        foreach (var tn in tables)
        {
            var loc = (tn as JsonObject)?["location"]?.GetValue<string>();
            if (!IsGenericTableName(loc)) return CleanName(loc!);
            var nm = (tn as JsonObject)?["name"]?.GetValue<string>();
            if (!IsGenericTableName(nm)) return CleanName(nm!);
        }
        return null;
    }

    private static JsonObject Scaffold(
        JsonObject extraction, string baseName,
        string? dataSourceOverride, string? rowsPathOverride, string? criteriaOverride)
    {
        var id = baseName.Trim().ToLowerInvariant().Replace(' ', '-');

        // 1) explicit override wins; 2) else auto-detect a real name; 3) else clear placeholder.
        var detected = DetectDataSourceName(extraction);
        var viewName = dataSourceOverride
            ?? detected
            ?? "REPLACE_WITH_VIEW_OR_SP_NAME";
        var pushedDataset = dataSourceOverride is null && detected is null;

        var body = new JsonArray();
        foreach (var secNode in (JsonArray)extraction["sections"]!)
        {
            var sec = (JsonObject)secNode!;
            foreach (var objNode in (JsonArray)sec["objects"]!)
            {
                var obj = (JsonObject)objNode!;
                var kind = obj["kind"]?.GetValue<string>();
                if (kind == "TextObject")
                {
                    body.Add(new JsonObject
                    {
                        ["type"] = "text",
                        ["text"] = obj["text"]?.GetValue<string>() ?? "",
                        ["_hint"] = $"section={sec["name"]}, left={obj["left"]}, top={obj["top"]}",
                    });
                }
                else if (kind == "FieldObject")
                {
                    body.Add(new JsonObject
                    {
                        ["type"] = "field",
                        ["text"] = "{{header." + SuggestAlias(obj["dataSource"]?.GetValue<string>()) + "}}",
                        ["_hint"] = $"crystalField={obj["dataSource"]}, section={sec["name"]}",
                    });
                }
            }
        }

        var result = new JsonObject
        {
            ["id"] = id,
            ["title"] = baseName,
            ["sourceRpt"] = baseName + ".rpt",
            ["_note"] = "STARTER scaffold — bindings, grouping, totals and layout containers must be hand-finished. See report-framework/templates/export-invoice-sale.json for a complete example.",
            ["dataSource"] = new JsonObject
            {
                ["endpoint"] = "/api/v1/n1/dynamic-query-data",
                ["method"] = "GET",
                ["params"] = new JsonObject
                {
                    ["location"] = "{{param.location}}",
                    ["Name"] = viewName,
                    ["Criteria"] = criteriaOverride ?? "SALE_NO={{param.saleNo}}",
                },
                ["rowsPath"] = rowsPathOverride ?? "raw_response.Data",
            },
            ["header"] = new JsonObject(),
            ["computed"] = new JsonObject(),
            ["groups"] = new JsonArray(),
            ["constants"] = new JsonObject(),
            ["body"] = body,
        };

        if (pushedDataset)
        {
            ((JsonObject)result["dataSource"]!)["_dataSourceNote"] =
                "This .rpt was built on a PUSHED dataset, so the real view/stored-proc name is NOT in the file " +
                "(the report's fields read {DataTable1.*}). Set dataSource.params.Name to the actual view/SP, " +
                "or re-run the converter with --datasource \"VIW_SALE_MASTER_DETAIL\".";
        }
        return result;
    }

    /// Turn a Crystal field formula like {VIW_SALE_MASTER_DETAIL.TO_PARTY_NAME} into a lower camel alias.
    private static string SuggestAlias(string? formula)
    {
        if (string.IsNullOrWhiteSpace(formula)) return "FIELD";
        var raw = formula!.Trim('{', '}');
        // net48 lacks System.Index/System.Range, so use Substring instead of [..] slicing.
        var field = raw.Contains('.') ? raw.Substring(raw.LastIndexOf('.') + 1) : raw;
        var parts = field.ToLowerInvariant().Split('_');
        return parts[0] + string.Concat(parts.Skip(1).Select(p =>
            p.Length == 0 ? "" : char.ToUpperInvariant(p[0]) + p.Substring(1)));
    }
}
