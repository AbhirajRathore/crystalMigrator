import type { FieldInfo, FieldType } from './types'

function inferType(v: unknown): FieldType {
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'date'
    // numeric-looking strings stay 'string' to avoid surprising money formatting
  }
  return 'string'
}

/**
 * Derive the field catalog from a set of rows — the client-side equivalent of
 * extraction.json's field list, but built from live data. Scans up to 50 rows
 * per field to find the first non-null value for type inference.
 */
export function introspect(rows: Record<string, unknown>[]): FieldInfo[] {
  const names = new Set<string>()
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r ?? {})) names.add(k)

  return [...names].map((name) => {
    let type: FieldType = 'string'
    let sample: string | undefined
    for (const r of rows.slice(0, 50)) {
      const v = r?.[name]
      if (v != null && v !== '') {
        type = inferType(v)
        sample = String(v).slice(0, 24)
        break
      }
    }
    return { name, type, sample }
  })
}
