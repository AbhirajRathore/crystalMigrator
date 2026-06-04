import React from 'react'
import type { ReportTemplate } from './engine/types'
import { ReportRenderer } from './engine/ReportRenderer'
import { fetchRows, getToken, setToken } from './api/client'
import { getPath } from './engine/bindings'
import { REPORTS, loadTemplate } from './reports/registry'
import Builder from './builder/Builder'
import UploadConvert from './builder/UploadConvert'
import './styles/builder.css'

type Mode = 'render' | 'build' | 'upload'

function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const tabs: Mode[] = ['render', 'build', 'upload']
  const label: Record<Mode, string> = { render: 'Render', build: 'Build', upload: 'Upload .rpt' }
  return (
    <div className="mode-switch">
      {tabs.map((t) => (
        <button key={t} className={mode === t ? 'active' : ''} onClick={() => setMode(t)}>{label[t]}</button>
      ))}
    </div>
  )
}

export default function App() {
  const [mode, setMode] = React.useState<Mode>('render')
  const [reportId, setReportId] = React.useState(REPORTS[0].id)
  const [template, setTemplate] = React.useState<ReportTemplate | null>(null)
  const [params, setParams] = React.useState<Record<string, string>>({})
  const [rows, setRows] = React.useState<Record<string, unknown>[]>([])
  const [token, setTok] = React.useState(getToken())
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = React.useState('')

  // load template + seed default params whenever the report changes
  React.useEffect(() => {
    loadTemplate(reportId).then((tpl) => {
      setTemplate(tpl)
      const seed: Record<string, string> = {}
      for (const p of tpl.params ?? []) seed[p.name] = String(p.default ?? '')
      setParams(seed)
      setRows([])
      setStatus('idle')
    })
  }, [reportId])

  async function run() {
    if (!template) return
    setStatus('loading')
    setError('')
    try {
      setToken(token)
      const data = await fetchRows(template, params)
      setRows(data)
      setStatus('ready')
    } catch (e) {
      setError(String((e as Error).message ?? e))
      setStatus('error')
    }
  }

  async function runDemo() {
    if (!template) return
    setStatus('loading')
    setError('')
    try {
      const res = await fetch('/sample_data.json')
      const json = await res.json()
      const data = getPath(json, template.dataSource.rowsPath) as Record<string, unknown>[]
      setRows(data ?? [])
      setStatus('ready')
    } catch (e) {
      setError(String((e as Error).message ?? e))
      setStatus('error')
    }
  }

  if (mode === 'build') {
    return (
      <div className="app">
        <div className="toolbar no-print">
          <strong>KGK Report Migrator</strong>
          <ModeSwitch mode={mode} setMode={setMode} />
          <span style={{ color: '#aeb6c6', fontSize: 13 }}>Structured drag-and-drop template builder</span>
        </div>
        <Builder />
      </div>
    )
  }

  if (mode === 'upload') {
    return (
      <div className="app">
        <div className="toolbar no-print">
          <strong>KGK Report Migrator</strong>
          <ModeSwitch mode={mode} setMode={setMode} />
          <span style={{ color: '#aeb6c6', fontSize: 13 }}>Upload a .rpt → generate template JSON</span>
        </div>
        <UploadConvert onOpenInBuilder={() => setMode('build')} />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="toolbar no-print">
        <strong>KGK Report Migrator</strong>
        <ModeSwitch mode={mode} setMode={setMode} />
        <label>
          Report:&nbsp;
          <select value={reportId} onChange={(e) => setReportId(e.target.value)}>
            {REPORTS.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
        </label>
        {(template?.params ?? []).map((p) => (
          <label key={p.name}>
            {p.label ?? p.name}:&nbsp;
            <input
              value={params[p.name] ?? ''}
              onChange={(e) => setParams({ ...params, [p.name]: e.target.value })}
              style={{ width: p.type === 'number' ? 110 : 90 }}
            />
          </label>
        ))}
        <label title="Bearer token for the data API">
          Token:&nbsp;
          <input value={token} onChange={(e) => setTok(e.target.value)} style={{ width: 220 }} placeholder="Bearer token" />
        </label>
        <button onClick={run} disabled={status === 'loading'}>
          {status === 'loading' ? 'Loading…' : 'Generate'}
        </button>
        <button onClick={runDemo} disabled={status === 'loading'} title="Render from bundled sample_data.json (no auth)">Demo data</button>
        <button onClick={() => window.print()} disabled={status !== 'ready'}>Print / PDF</button>
        {status === 'error' && <span className="err">⚠ {error}</span>}
        {status === 'ready' && <span className="ok">✓ {rows.length} rows</span>}
      </div>

      <div className="page-area">
        {template && status === 'ready' ? (
          <div className="paper">
            <ReportRenderer template={template} rows={rows} params={params} />
          </div>
        ) : (
          <div className="placeholder no-print">
            {status === 'error'
              ? 'Could not load data — check the token and that the data API is reachable.'
              : 'Enter parameters and click Generate to render the report.'}
          </div>
        )}
      </div>
    </div>
  )
}
