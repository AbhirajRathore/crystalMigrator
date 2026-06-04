import type { ReportTemplate, Block, Expr } from '../engine/types'
import type { BuilderState } from './types'
import { formatPipe } from './types'

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'
}

/**
 * Assemble a complete, valid ReportTemplate from the builder's structured-zone
 * state. This is the single source of truth for both the live preview and the
 * exported file — the preview renders exactly what you'll export.
 */
export function toTemplate(s: BuilderState): ReportTemplate {
  // header aliases = field names
  const header: Record<string, string> = {}
  for (const h of s.headerItems) header[h.field] = h.field

  // computed sums for any column flagged as a total
  const computed: Record<string, Expr> = {}
  for (const c of s.columns) {
    if (c.total) computed[`total_${c.field}`] = { fn: 'sum', field: c.field }
  }

  const body: Block[] = []

  if (s.titleText.trim()) {
    body.push({ type: 'text', text: s.titleText, style: { fontSize: 14, fontWeight: 700, marginBottom: 8 } })
  }

  if (s.headerItems.length) {
    body.push({
      type: 'column',
      children: s.headerItems.map<Block>((h) => ({
        type: 'labeledField',
        className: 'split',
        label: h.label,
        value: `{{header.${h.field}${formatPipe(h.format)}}}`,
        style: { fontWeight: h.bold ? 700 : 400 },
      })),
    })
    body.push({ type: 'spacer', height: 10 })
  }

  if (s.columns.length) {
    const hasTotals = s.columns.some((c) => c.total)
    const table: Block = {
      type: 'table',
      data: 'rows',
      columns: s.columns.map((c) => ({
        header: c.header,
        cell: `{{row.${c.field}${formatPipe(c.format)}}}`,
        align: c.align,
      })),
    }
    if (hasTotals) {
      table.footerRows = [
        s.columns.map((c, i) => {
          if (i === 0) return { text: 'Total', align: 'right' as const, style: { fontWeight: 700 } }
          return c.total
            ? { text: `{{computed.total_${c.field}${formatPipe(c.format)}}}`, align: c.align, style: { fontWeight: 700 } }
            : { text: '', align: c.align }
        }),
      ]
    }
    body.push(table)
  }

  for (const line of s.footerLines) {
    if (line.trim()) body.push({ type: 'text', text: line, style: { fontSize: 8, color: '#222', marginTop: 4 } })
  }

  return {
    id: slug(s.title),
    title: s.title,
    version: '1.0.0',
    dataSource: {
      endpoint: s.dataSource.endpoint,
      method: 'GET',
      params: {
        location: '{{param.location}}',
        Name: s.dataSource.name,
        Criteria: s.dataSource.criteria,
      },
      rowsPath: s.dataSource.rowsPath,
    },
    params: [
      { name: 'location', label: 'Location', type: 'string', required: true, default: 'ANT' },
      { name: 'saleNo', label: 'Sale No', type: 'number', required: true, default: '1135675' },
    ],
    header,
    computed,
    body,
  }
}

export function toTemplateJson(s: BuilderState): string {
  return JSON.stringify(toTemplate(s), null, 2)
}
