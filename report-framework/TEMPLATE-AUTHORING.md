# Template authoring guide

A template is one JSON document validated by `schema/report-template.schema.json`.
This guide is the practical reference for writing one.

## Top-level shape

```jsonc
{
  "id": "export-invoice-sale",
  "title": "Export Invoice Sale",
  "sourceRpt": "Export Invoice Sale.rpt",
  "page": { "size": "A4", "orientation": "portrait", "marginsMm": { ... } },
  "dataSource": { ... },   // where the rows come from
  "params":     [ ... ],   // user inputs (saleNo, location)
  "header":     { ... },   // single-record fields (from row 0)
  "computed":   { ... },   // aggregates over all rows
  "groups":     [ ... ],   // summarised detail rows
  "constants":  { ... },   // static text (bank, legal) not in the data
  "body":       [ ... ]    // ordered layout blocks
}
```

## dataSource

```jsonc
"dataSource": {
  "endpoint": "/api/v1/n1/dynamic-query-data",
  "method": "GET",
  "params": {
    "location": "{{param.location}}",
    "Name": "VIW_SALE_MASTER_DETAIL",
    "Criteria": "SALE_NO={{param.saleNo}}"
  },
  "rowsPath": "raw_response.Data"   // dot-path to the row array in the JSON response
}
```

## Bindings & filters

Anywhere a value is bindable, use `{{ path | filter:arg | filter2 }}`.

**Roots:** `header.*`, `computed.*`, `constants.*`, `param.*`, `row.*` (inside a
detail table), `group.*` (inside a grouped table). Dot paths and array indices work:
`constants.companyBank.lines.0`.

**Filters:**

| Filter | Example | Result |
|--------|---------|--------|
| `number:N` | `{{group.carats \| number:2}}` | `8.32` |
| `money` | `{{computed.grandTotal \| money}}` | `19,795.86` |
| `date:fmt` | `{{header.saleDate \| date:dd/MM/yyyy}}` | `02/06/2026` (tokens: `dd MM yyyy yy HH mm`) |
| `upper` / `lower` | `{{header.country \| upper}}` | `BELGIUM` |
| `default:X` | `{{header.shippingCharges \| default:COLLECT}}` | falls back when null/empty |

## computed & expressions

Each `computed` (and group aggregate) is a literal, a `"{{binding}}"`, or a function:

```jsonc
"computed": {
  "totalCarat": { "fn": "sum",    "field": "SALE_CARAT" },
  "grandTotal": { "fn": "sum",    "field": "AMOUNT_DOLLAR" },
  "eurToUsd":   { "fn": "divide", "args": [1, "{{header.localExchangeRate}}"] }
}
```

Functions: `sum, count, avg, min, max, first` (take `field` + `scope`),
and `divide, subtract, multiply, concat, ifNull` (take `args`).
`scope` is `rows` (all rows, default) or `groupRows` (the current group's rows).

## groups (Crystal group sections)

```jsonc
"groups": [{
  "id": "lines",
  "by": "'Polished Natural Diamonds'",   // quoted = single group; or a field name to group by
  "aggregates": {
    "carats": { "fn": "sum", "field": "SALE_CARAT",    "scope": "groupRows" },
    "amount": { "fn": "sum", "field": "AMOUNT_DOLLAR", "scope": "groupRows" },
    "ppc":    { "fn": "divide", "args": [
                  { "fn": "sum", "field": "AMOUNT_DOLLAR", "scope": "groupRows" },
                  { "fn": "sum", "field": "SALE_CARAT",    "scope": "groupRows" }
              ]}
  }
}]
```

A grouped `table` then exposes `group.key`, `group.carats`, `group.amount`, `group.ppc`.

## body blocks

| `type` | Key props | Notes |
|--------|-----------|-------|
| `row` | `children`, `widths[]`, `gap` | horizontal flex; `widths` are flex-grow numbers or CSS sizes (`"64px"`) |
| `column` | `children`, `gap` | vertical stack |
| `text` / `field` | `text` | a bindable line |
| `labeledField` | `label`, `value`, `className:"split"` | label + value; `split` right-aligns the bold value |
| `table` | `data`, `groupRef`, `columns[]`, `footerRows[][]` | `data:"rows"` (detail) or `"groupRows"` (+ `groupRef`) |
| `richtext` | `lines[]` | multi-line; empty lines are skipped |
| `image` | `src` | bindable URL/asset |
| `html` | `html` | escape hatch; bindings still interpolate (used for the payment-terms box) |
| `spacer` / `rule` | `height` | spacing / horizontal line |

Every block also accepts `style` (whitelisted CSS-ish props; bare numbers → px),
`className`, and `if` (a binding; block hidden when it resolves falsy/empty).

### table example (the invoice line items)

```jsonc
{
  "type": "table", "data": "groupRows", "groupRef": "lines",
  "columns": [
    { "header": "Details",   "cell": "{{group.key}}",                          "align": "left"  },
    { "header": "Carats",    "cell": "{{group.carats | number:2}}",            "align": "right" },
    { "header": "PPC",       "cell": "{{group.ppc | number:2}}",               "align": "right" },
    { "header": "Total USD", "cell": "{{constants.currency}} {{group.amount | money}}", "align": "right" }
  ],
  "footerRows": [
    [ { "text": "Total :", "align": "right" },
      { "text": "{{computed.totalCarat | number:2}}", "align": "right" },
      { "text": "Total USD", "align": "center" },
      { "text": "{{constants.currency}} {{computed.grandTotal | money}}", "align": "right" } ],
    [ { "text": "Grand Total", "align": "right", "colSpan": 3 },
      { "text": "{{constants.currency}} {{computed.grandTotal | money}}", "align": "right" } ]
  ]
}
```

## Migration checklist (next report)

1. **Identify the view & criteria** → fill `dataSource` (`extraction.json → tables[].location`).
2. **Single-record fields** (logo, company, bill-to, dates) → `header` aliases.
3. **Repeating detail** → a `table`. If Crystal summarised it (group footer only), model a `group`.
4. **Totals / FX / derived** → `computed`.
5. **Static text** Crystal hard-codes (bank, legal, notes) → `constants`.
6. **Lay it out** in `body` to match the PDF; verify numbers against the live API.
7. Register it (see main README).

> Tip: keep the rendered PDF beside you and diff field-by-field. The
> `extraction.json` from the converter gives the exact Crystal field name behind
> every printed value, so mapping is mechanical.
