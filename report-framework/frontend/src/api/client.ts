import type { ReportTemplate } from '../engine/types'
import { getPath } from '../engine/bindings'

/**
 * Bearer token for the data API. In production this comes from your auth/session;
 * for the demo it can be supplied via VITE_API_TOKEN or pasted in the UI.
 */
export function getToken(): string {
  return (import.meta.env.VITE_API_TOKEN as string) || localStorage.getItem('apiToken') || ''
}

export function setToken(t: string) {
  localStorage.setItem('apiToken', t)
}

/** Fill {{param.x}} placeholders in a string from the params bag. */
function fillParams(tpl: string, params: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*param\.(\w+)\s*\}\}/g, (_m, k) => String(params[k] ?? ''))
}

/**
 * Fetch the detail rows for a report by following its dataSource definition.
 * Returns the array located at dataSource.rowsPath inside the JSON response.
 */
export async function fetchRows(
  template: ReportTemplate,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const ds = template.dataSource
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(ds.params ?? {})) {
    qs.set(k, fillParams(v, params))
  }
  const url = `${ds.endpoint}?${qs.toString()}`

  const token = getToken()
  const res = await fetch(url, {
    method: ds.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    throw new Error(`Data API ${res.status}: ${await res.text().catch(() => res.statusText)}`)
  }
  const json = await res.json()
  const rows = getPath(json, ds.rowsPath)
  if (!Array.isArray(rows)) {
    throw new Error(`No rows found at "${ds.rowsPath}" in the API response`)
  }
  return rows as Record<string, unknown>[]
}
