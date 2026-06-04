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
            Console.Error.WriteLine("usage: rpt2template <file.rpt> [-o outDir]");
            return 1;
        }
        var rptPath = args[0];
        var outDir = "out";
        for (var i = 1; i < args.Length - 1; i++)
            if (args[i] == "-o") outDir = args[i + 1];
        Directory.CreateDirectory(outDir);

        var doc = new ReportDocument();
        doc.Load(rptPath);

        var extraction = Extract(doc);
        var baseName = Path.GetFileNameWithoutExtension(rptPath);

        var opts = new JsonSerializerOptions { WriteIndented = true };
        File.WriteAllText(Path.Combine(outDir, baseName + ".extraction.json"),
            extraction.ToJsonString(opts));

        var template = Scaffold(extraction, baseName);
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
            // Available when the report was loaded for editing.
            var sql = doc.ReportClientDocument?.RowSetController?
                .GetSQLStatement(null, out _, out _);
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
            case FieldHeadingObject fh:
                o["text"] = fh.Text;
                break;
        }
        return o;
    }

    // ---- starter-template scaffold -----------------------------------------

    private static JsonObject Scaffold(JsonObject extraction, string baseName)
    {
        var id = baseName.Trim().ToLowerInvariant().Replace(' ', '-');
        var firstTable = (extraction["tables"] as JsonArray)?.FirstOrDefault() as JsonObject;
        var viewName = firstTable?["location"]?.GetValue<string>() ?? "VIEW_NAME";

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

        return new JsonObject
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
                    ["Criteria"] = "SALE_NO={{param.saleNo}}",
                },
                ["rowsPath"] = "raw_response.Data",
            },
            ["header"] = new JsonObject(),
            ["computed"] = new JsonObject(),
            ["groups"] = new JsonArray(),
            ["constants"] = new JsonObject(),
            ["body"] = body,
        };
    }

    /// Turn a Crystal field formula like {VIW_SALE_MASTER_DETAIL.TO_PARTY_NAME} into a lower camel alias.
    private static string SuggestAlias(string? formula)
    {
        if (string.IsNullOrWhiteSpace(formula)) return "FIELD";
        var raw = formula!.Trim('{', '}');
        var field = raw.Contains('.') ? raw[(raw.LastIndexOf('.') + 1)..] : raw;
        var parts = field.ToLowerInvariant().Split('_');
        return parts[0] + string.Concat(parts.Skip(1).Select(p =>
            p.Length == 0 ? "" : char.ToUpperInvariant(p[0]) + p[1..]));
    }
}
