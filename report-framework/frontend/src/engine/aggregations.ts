import type { Expr, GroupDef, GroupRow, ReportTemplate, RenderContext } from './types'
import { getPath, resolveExpression } from './bindings'

type Row = Record<string, unknown>

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Evaluate an Expr (literal | "{{binding}}" | {fn,...}) against a set of rows.
 * `scopeRows` is what 'rows'/'groupRows' scoped fn's aggregate over.
 */
export function evalExpr(expr: Expr, ctx: RenderContext, scopeRows: Row[]): unknown {
  if (expr == null) return undefined
  if (typeof expr === 'number') return expr
  if (typeof expr === 'string') {
    // a "{{...}}" binding, or a quoted literal 'like this', or plain text
    const m = expr.match(/^\{\{\s*(.+?)\s*\}\}$/)
    if (m) return resolveExpression(m[1], ctx)
    const q = expr.match(/^'(.*)'$/)
    if (q) return q[1]
    return expr
  }
  // function object
  const rowsFor = (e: { scope?: string }) =>
    e.scope === 'groupRows' ? scopeRows : ctx.rows
  const a = (i: number) => evalExpr(expr.args?.[i] as Expr, ctx, scopeRows)

  switch (expr.fn) {
    case 'sum':
      return rowsFor(expr).reduce((s, r) => s + num(getPath(r, expr.field!)), 0)
    case 'count':
      return rowsFor(expr).length
    case 'avg': {
      const rs = rowsFor(expr)
      return rs.length ? rs.reduce((s, r) => s + num(getPath(r, expr.field!)), 0) / rs.length : 0
    }
    case 'min':
      return Math.min(...rowsFor(expr).map((r) => num(getPath(r, expr.field!))))
    case 'max':
      return Math.max(...rowsFor(expr).map((r) => num(getPath(r, expr.field!))))
    case 'first':
      return getPath(rowsFor(expr)[0] ?? {}, expr.field!)
    case 'divide': {
      const d = num(a(1))
      return d === 0 ? 0 : num(a(0)) / d
    }
    case 'subtract':
      return num(a(0)) - num(a(1))
    case 'multiply':
      return num(a(0)) * num(a(1))
    case 'concat':
      return (expr.args ?? []).map((_, i) => String(a(i) ?? '')).join('')
    case 'ifNull': {
      const v = a(0)
      return v == null || v === '' ? a(1) : v
    }
    default:
      return undefined
  }
}

/** Build the full render context (header / computed / groupRows) from raw rows. */
export function buildContext(
  template: ReportTemplate,
  rows: Row[],
  params: Record<string, unknown>,
): RenderContext {
  const first = rows[0] ?? {}

  // header: alias -> field value (or expression) from the first row
  const header: Record<string, unknown> = {}
  for (const [alias, src] of Object.entries(template.header ?? {})) {
    header[alias] = src in first ? first[src] : getPath(first, src)
  }

  const ctx: RenderContext = {
    rows,
    header,
    computed: {},
    constants: template.constants ?? {},
    param: params,
    groupRows: {},
  }

  // computed (single pass over all rows)
  for (const [name, expr] of Object.entries(template.computed ?? {})) {
    ctx.computed[name] = evalExpr(expr, ctx, rows)
  }

  // groups
  for (const g of template.groups ?? []) {
    ctx.groupRows[g.id] = buildGroup(g, ctx, rows)
  }

  return ctx
}

function buildGroup(g: GroupDef, ctx: RenderContext, rows: Row[]): GroupRow[] {
  // group key: a quoted literal -> single group, else a field name
  const literal = g.by.match(/^'(.*)'$/)
  const buckets = new Map<string, Row[]>()
  if (literal) {
    buckets.set(literal[1], rows.slice())
  } else {
    for (const r of rows) {
      const k = String(getPath(r, g.by) ?? '')
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k)!.push(r)
    }
  }

  const out: GroupRow[] = []
  for (const [key, groupRows] of buckets) {
    const gr: GroupRow = { key, rows: groupRows }
    for (const [aggName, expr] of Object.entries(g.aggregates ?? {})) {
      gr[aggName] = evalExpr(expr, ctx, groupRows)
    }
    out.push(gr)
  }
  return out
}
