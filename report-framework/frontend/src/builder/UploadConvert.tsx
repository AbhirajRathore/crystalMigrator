import React from 'react'
import type { ReportTemplate } from '../engine/types'
import { ReportRenderer } from '../engine/ReportRenderer'
import { getPath } from '../engine/bindings'

interface ConvertResult {
  status: 'ok' | 'manual' | 'error'
  message?: string
  warnings?: string[]
  template?: ReportTemplate
  meta?: Record<string, unknown>
}

export default function UploadConvert({ onOpenInBuilder }: { onOpenInBuilder: () => void }) {
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<ConvertResult | null>(null)
  const [rows, setRows] = React.useState<Record<string, unknown>[]>([])
  const [fileName, setFileName] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setFileName(file.name)
    setBusy(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/v1/convert', { method: 'POST', body: fd })
      const json = (await res.json()) as ConvertResult
      setResult(json)
      if (json.template) {
        // best-effort preview using bundled sample data
        try {
          const sd = await fetch('/sample_data.json').then((r) => r.json())
          const path = json.template.dataSource?.rowsPath ?? 'raw_response.Data'
          setRows((getPath(sd, path) as Record<string, unknown>[]) ?? [])
        } catch { /* preview without data */ }
      }
    } catch (e) {
      setResult({ status: 'error', message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  function download() {
    if (!result?.template) return
    const blob = new Blob([JSON.stringify(result.template, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${result.template.id}.json`
    a.click()
  }

  return (
    <div className="upload-wrap">
      <div className="upload-left">
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div className="dz-icon">⬆</div>
          <div className="dz-main">Drop a <b>.rpt</b> file here, or click to choose</div>
          <div className="dz-sub">The utility extracts the layout and generates a <code>template.json</code></div>
          <input ref={inputRef} type="file" accept=".rpt" hidden
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>

        {fileName && <div className="up-file">📄 {fileName}</div>}
        {busy && <div className="up-status">Converting…</div>}

        {result && (
          <div className={`up-result up-${result.status}`}>
            <div className="up-headline">
              {result.status === 'ok' && '✓ Template generated'}
              {result.status === 'manual' && '⚠ Converter not available — manual finish needed'}
              {result.status === 'error' && '✕ Conversion failed'}
            </div>
            {result.message && <div className="up-msg">{result.message}</div>}
            {result.warnings?.map((w, i) => <div key={i} className="up-warn">• {w}</div>)}
            {result.meta && (
              <pre className="up-meta">{JSON.stringify(result.meta, null, 2)}</pre>
            )}
            <div className="up-actions">
              {result.template && <button className="primary" onClick={download}>Download template.json</button>}
              <button onClick={onOpenInBuilder}>Open in Builder to finish</button>
            </div>
          </div>
        )}

        <div className="up-pipeline">
          <b>Pipeline:</b> upload .rpt → <span>convert (Windows SDK)</span> → template.json →
          render preview → download → store on your API server (DB access).
        </div>
      </div>

      <div className="upload-right">
        <h3>Generated template</h3>
        {result?.template ? (
          <pre className="up-json">{JSON.stringify(result.template, null, 2)}</pre>
        ) : (
          <div className="bld-hint">Upload a file to see its template JSON.</div>
        )}
        <h3>Preview</h3>
        {result?.template && rows.length ? (
          <div className="paper-mini"><ReportRenderer template={result.template} rows={rows} params={{ location: 'ANT', saleNo: '1135675' }} /></div>
        ) : (
          <div className="bld-hint">Preview appears when a template + sample data are available.</div>
        )}
      </div>
    </div>
  )
}
