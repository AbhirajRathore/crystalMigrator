import React from 'react'
import type { BuilderState, ColumnItem, FieldInfo, FormatKind, HeaderItem } from './types'
import { defaultFormat, emptyBuilder } from './types'
import { introspect } from './introspect'
import { toTemplate, toTemplateJson } from './toTemplate'
import { ReportRenderer } from '../engine/ReportRenderer'
import { fetchRows, getToken, setToken } from '../api/client'

let _id = 0
const uid = () => `b${++_id}`

const FORMATS: FormatKind[] = ['text', 'number', 'money', 'date']
const TYPE_ICON: Record<string, string> = { number: '#', string: 'A', date: '📅' }

export default function Builder() {
  const [state, setState] = React.useState<BuilderState>(emptyBuilder)
  const [fields, setFields] = React.useState<FieldInfo[]>([])
  const [rows, setRows] = React.useState<Record<string, unknown>[]>([])
  const [token, setTok] = React.useState(getToken())
  const [msg, setMsg] = React.useState('Load fields to begin.')
  const [showJson, setShowJson] = React.useState(false)
  const [sel, setSel] = React.useState<{ zone: 'header' | 'column'; id: string } | null>(null)

  const patch = (p: Partial<BuilderState>) => setState((s) => ({ ...s, ...p }))

  async function loadLive() {
    try {
      setToken(token)
      setMsg('Loading from API…')
      const tpl = toTemplate(state)
      const data = await fetchRows(tpl, { location: 'ANT', saleNo: '1135675' })
      ingest(data)
    } catch (e) {
      setMsg('Live load failed: ' + (e as Error).message + ' — try Demo data.')
    }
  }

  async function loadDemo() {
    setMsg('Loading sample_data.json…')
    const res = await fetch('/sample_data.json')
    const json = await res.json()
    // read rows at the configured rowsPath
    const data = state.dataSource.rowsPath
      .split('.')
      .reduce<any>((a, k) => (a == null ? a : a[k]), json) as Record<string, unknown>[]
    ingest(data ?? [])
  }

  function ingest(data: Record<string, unknown>[]) {
    setRows(data)
    setFields(introspect(data))
    setMsg(`${data.length} rows · ${introspect(data).length} fields. Drag fields into the bands →`)
  }

  // ---- drag & drop ----
  function onFieldDragStart(e: React.DragEvent, f: FieldInfo) {
    e.dataTransfer.setData('application/field', JSON.stringify(f))
  }
  function readField(e: React.DragEvent): FieldInfo | null {
    const raw = e.dataTransfer.getData('application/field')
    return raw ? (JSON.parse(raw) as FieldInfo) : null
  }
  function dropToHeader(e: React.DragEvent) {
    e.preventDefault()
    const f = readField(e); if (!f) return
    const item: HeaderItem = {
      id: uid(), label: prettify(f.name) + ':', field: f.name,
      format: defaultFormat(f.type), bold: true,
    }
    patch({ headerItems: [...state.headerItems, item] })
  }
  function dropToTable(e: React.DragEvent) {
    e.preventDefault()
    const f = readField(e); if (!f) return
    const col: ColumnItem = {
      id: uid(), header: prettify(f.name), field: f.name,
      format: defaultFormat(f.type), align: f.type === 'number' ? 'right' : 'left',
      total: false,
    }
    patch({ columns: [...state.columns, col] })
  }
  const allow = (e: React.DragEvent) => e.preventDefault()

  const updateHeader = (id: string, p: Partial<HeaderItem>) =>
    patch({ headerItems: state.headerItems.map((h) => (h.id === id ? { ...h, ...p } : h)) })
  const updateCol = (id: string, p: Partial<ColumnItem>) =>
    patch({ columns: state.columns.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  const removeHeader = (id: string) =>
    patch({ headerItems: state.headerItems.filter((h) => h.id !== id) })
  const removeCol = (id: string) =>
    patch({ columns: state.columns.filter((c) => c.id !== id) })

  function exportJson() {
    const blob = new Blob([toTemplateJson(state)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${toTemplate(state).id}.json`
    a.click()
  }

  const selected =
    sel?.zone === 'header'
      ? state.headerItems.find((h) => h.id === sel.id)
      : sel?.zone === 'column'
      ? state.columns.find((c) => c.id === sel.id)
      : null

  return (
    <div className="builder">
      {/* ---------------- left: data source + field palette ---------------- */}
      <aside className="bld-left">
        <h3>Data source</h3>
        <label>Endpoint<input value={state.dataSource.endpoint}
          onChange={(e) => patch({ dataSource: { ...state.dataSource, endpoint: e.target.value } })} /></label>
        <label>View / Proc name<input value={state.dataSource.name}
          onChange={(e) => patch({ dataSource: { ...state.dataSource, name: e.target.value } })} /></label>
        <label>Rows path<input value={state.dataSource.rowsPath}
          onChange={(e) => patch({ dataSource: { ...state.dataSource, rowsPath: e.target.value } })} /></label>
        <label>Criteria<input value={state.dataSource.criteria}
          onChange={(e) => patch({ dataSource: { ...state.dataSource, criteria: e.target.value } })} /></label>
        <label>Token<input value={token} placeholder="Bearer (for live)" onChange={(e) => setTok(e.target.value)} /></label>
        <div className="bld-row">
          <button onClick={loadLive}>Load (live)</button>
          <button onClick={loadDemo}>Demo data</button>
        </div>
        <div className="bld-msg">{msg}</div>

        <h3>Fields <small>(drag →)</small></h3>
        <div className="palette">
          {fields.map((f) => (
            <div key={f.name} className="chip" draggable onDragStart={(e) => onFieldDragStart(e, f)}
              title={`${f.type}${f.sample ? ' · e.g. ' + f.sample : ''}`}>
              <span className={`tic tic-${f.type}`}>{TYPE_ICON[f.type]}</span>{f.name}
            </div>
          ))}
          {!fields.length && <div className="bld-hint">No fields yet — Load data.</div>}
        </div>
      </aside>

      {/* ---------------- center: canvas bands ---------------- */}
      <main className="bld-canvas">
        <label className="bld-titleline">Report title:&nbsp;
          <input value={state.title} onChange={(e) => patch({ title: e.target.value, titleText: e.target.value })} />
        </label>

        <Zone label="Header fields" onDrop={dropToHeader} onDragOver={allow} empty={!state.headerItems.length}
          hint="Drag single-record fields here (company, dates, party).">
          {state.headerItems.map((h) => (
            <div key={h.id} className={`drp ${sel?.id === h.id ? 'on' : ''}`} onClick={() => setSel({ zone: 'header', id: h.id })}>
              <b>{h.label}</b> {`{{${h.field}}}`}
              <button className="x" onClick={(e) => { e.stopPropagation(); removeHeader(h.id) }}>×</button>
            </div>
          ))}
        </Zone>

        <Zone label="Table columns" onDrop={dropToTable} onDragOver={allow} empty={!state.columns.length}
          hint="Drag repeating fields here to build the detail table.">
          <div className="cols">
            {state.columns.map((c) => (
              <div key={c.id} className={`col ${sel?.id === c.id ? 'on' : ''}`} onClick={() => setSel({ zone: 'column', id: c.id })}>
                <div className="col-h">{c.header}{c.total ? ' Σ' : ''}</div>
                <div className="col-f">{`{{row.${c.field}}}`}</div>
                <button className="x" onClick={(e) => { e.stopPropagation(); removeCol(c.id) }}>×</button>
              </div>
            ))}
          </div>
        </Zone>

        <Zone label="Footer text" onDrop={allow} onDragOver={allow} empty={false} hint="">
          <textarea className="footer-ta" placeholder="One static line per row (notes, legal, bank details)…"
            value={state.footerLines.join('\n')}
            onChange={(e) => patch({ footerLines: e.target.value.split('\n') })} />
        </Zone>
      </main>

      {/* ---------------- right: properties + preview/export ---------------- */}
      <aside className="bld-right">
        <h3>Properties</h3>
        {!selected && <div className="bld-hint">Select a header field or column to edit.</div>}
        {selected && sel?.zone === 'header' && (
          <HeaderProps item={selected as HeaderItem} onChange={(p) => updateHeader(selected.id, p)} />
        )}
        {selected && sel?.zone === 'column' && (
          <ColumnProps item={selected as ColumnItem} onChange={(p) => updateCol(selected.id, p)} />
        )}

        <div className="bld-actions">
          <button className="primary" onClick={() => setShowJson((v) => !v)}>{showJson ? 'Hide JSON' : 'Show JSON'}</button>
          <button className="primary" onClick={exportJson}>Export template.json</button>
        </div>

        <h3>Live preview</h3>
        <div className="bld-preview">
          {rows.length ? (
            <div className="paper-mini"><ReportRenderer template={toTemplate(state)} rows={rows} params={{ location: 'ANT', saleNo: '1135675' }} /></div>
          ) : (
            <div className="bld-hint">Load data to preview.</div>
          )}
        </div>

        {showJson && <pre className="bld-json">{toTemplateJson(state)}</pre>}
      </aside>
    </div>
  )
}

function Zone(props: {
  label: string; hint: string; empty: boolean
  onDrop: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void
  children: React.ReactNode
}) {
  return (
    <section className="zone" onDrop={props.onDrop} onDragOver={props.onDragOver}>
      <div className="zone-label">{props.label}</div>
      {props.empty && props.hint ? <div className="zone-empty">{props.hint}</div> : props.children}
    </section>
  )
}

function FormatSelect({ value, onChange }: { value: FormatKind; onChange: (f: FormatKind) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as FormatKind)}>
      {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
    </select>
  )
}

function HeaderProps({ item, onChange }: { item: HeaderItem; onChange: (p: Partial<HeaderItem>) => void }) {
  return (
    <div className="props">
      <div className="prop-field">Field: <code>{item.field}</code></div>
      <label>Label<input value={item.label} onChange={(e) => onChange({ label: e.target.value })} /></label>
      <label>Format<FormatSelect value={item.format} onChange={(f) => onChange({ format: f })} /></label>
      <label className="cb"><input type="checkbox" checked={item.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> Bold value</label>
    </div>
  )
}

function ColumnProps({ item, onChange }: { item: ColumnItem; onChange: (p: Partial<ColumnItem>) => void }) {
  return (
    <div className="props">
      <div className="prop-field">Field: <code>{item.field}</code></div>
      <label>Header<input value={item.header} onChange={(e) => onChange({ header: e.target.value })} /></label>
      <label>Format<FormatSelect value={item.format} onChange={(f) => onChange({ format: f })} /></label>
      <label>Align
        <select value={item.align} onChange={(e) => onChange({ align: e.target.value as ColumnItem['align'] })}>
          <option>left</option><option>center</option><option>right</option>
        </select>
      </label>
      <label className="cb"><input type="checkbox" checked={item.total} onChange={(e) => onChange({ total: e.target.checked })} /> Sum in totals row</label>
    </div>
  )
}

function prettify(field: string): string {
  return field.toLowerCase().split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : '')).join(' ')
}
