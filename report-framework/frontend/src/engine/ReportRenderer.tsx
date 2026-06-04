import React from 'react'
import type { Block, GroupRow, RenderContext, ReportTemplate, Style } from './types'
import { interpolate, evalCondition, resolveExpression } from './bindings'
import { buildContext } from './aggregations'

/** Convert a template Style (camelCase, numbers => px) to a React style object. */
function toCss(style?: Style): React.CSSProperties {
  if (!style) return {}
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(style)) {
    if (v == null) continue
    // numeric font weights / line heights stay numeric; raw numbers => px
    out[k] = typeof v === 'number' && !['fontWeight', 'lineHeight', 'opacity', 'flexGrow'].includes(k)
      ? `${v}px`
      : v
  }
  return out as React.CSSProperties
}

function widthToFlex(w: number | string): React.CSSProperties {
  if (typeof w === 'number') return { flex: `${w} 1 0` }
  return { flex: `0 0 ${w}`, width: w }
}

interface Props {
  template: ReportTemplate
  rows: Record<string, unknown>[]
  params?: Record<string, unknown>
}

export function ReportRenderer({ template, rows, params = {} }: Props) {
  const ctx = React.useMemo(() => buildContext(template, rows, params), [template, rows, params])
  return (
    <div className="report-doc">
      {template.body.map((b, i) => (
        <BlockView key={i} block={b} ctx={ctx} />
      ))}
    </div>
  )
}

function BlockView({ block, ctx }: { block: Block; ctx: RenderContext }) {
  if (!evalCondition(block.if, ctx)) return null
  const style = toCss(block.style)
  const cls = block.className

  switch (block.type) {
    case 'row': {
      const widths = block.widths
      return (
        <div className={cls} style={{ display: 'flex', gap: block.gap ?? 0, ...style }}>
          {(block.children ?? []).map((c, i) => (
            <div key={i} style={widths?.[i] != null ? widthToFlex(widths[i]) : { flex: '1 1 0' }}>
              <BlockView block={c} ctx={ctx} />
            </div>
          ))}
        </div>
      )
    }
    case 'column':
      return (
        <div className={cls} style={{ display: 'flex', flexDirection: 'column', gap: block.gap ?? 0, ...style }}>
          {(block.children ?? []).map((c, i) => (
            <BlockView key={i} block={c} ctx={ctx} />
          ))}
        </div>
      )
    case 'text':
    case 'field':
      return <div className={cls} style={style}>{interpolate(block.text, ctx)}</div>
    case 'labeledField':
      return (
        <div className={`lf ${cls ?? ''}`} style={style}>
          <span className="lf-label">{block.label}</span>
          <span className="lf-value">{interpolate(block.value, ctx)}</span>
        </div>
      )
    case 'image': {
      const src = interpolate(block.src, ctx)
      return src ? <img className={cls} style={style} src={src} alt="" /> : null
    }
    case 'spacer':
      return <div style={{ height: block.height ?? 8 }} />
    case 'rule':
      return <hr style={{ border: 'none', borderTop: '1px solid #000', margin: 0, ...style }} />
    case 'richtext':
      return (
        <div className={cls} style={style}>
          {(block.lines ?? []).map((ln, i) => {
            const t = interpolate(ln, ctx)
            return t ? <div key={i} className="rt-line">{t}</div> : null
          })}
        </div>
      )
    case 'html':
      return <div className={cls} style={style} dangerouslySetInnerHTML={{ __html: interpolate(block.html, ctx) }} />
    case 'table':
      return <TableView block={block} ctx={ctx} />
    default:
      return null
  }
}

function TableView({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const cols = block.columns ?? []
  let iterRows: { scope: 'row' | 'group'; data: Record<string, unknown> | GroupRow }[] = []

  if (block.data === 'groupRows') {
    const grs = ctx.groupRows[block.groupRef ?? ''] ?? []
    iterRows = grs.map((g) => ({ scope: 'group', data: g }))
  } else {
    iterRows = ctx.rows.map((r) => ({ scope: 'row', data: r }))
  }

  return (
    <table className="report-table" style={toCss(block.style)}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th
              key={i}
              style={{ textAlign: 'center', width: c.width as string, ...toCss(c.headerStyle) }}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {iterRows.map((ir, ri) => {
          const rowCtx: RenderContext =
            ir.scope === 'group'
              ? { ...ctx, group: ir.data as GroupRow }
              : { ...ctx, row: ir.data as Record<string, unknown> }
          return (
            <tr key={ri}>
              {cols.map((c, ci) => (
                <td key={ci} style={{ textAlign: c.align ?? 'left', ...toCss(c.style) }}>
                  {interpolate(c.cell, rowCtx)}
                </td>
              ))}
            </tr>
          )
        })}
        {(block.footerRows ?? []).map((fr, fi) => (
          <tr key={`f${fi}`} className="report-table-foot">
            {fr.map((cell, ci) => (
              <td
                key={ci}
                colSpan={cell.colSpan ?? 1}
                style={{ textAlign: cell.align ?? 'left', ...toCss(cell.style) }}
              >
                {interpolate(cell.text, ctx)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// re-export for convenience
export { resolveExpression }
