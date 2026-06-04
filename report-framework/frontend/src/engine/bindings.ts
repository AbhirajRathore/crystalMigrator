import type { RenderContext } from './types'

/** Resolve a dotted path (supporting numeric array indices) against an object. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined
    const idx = Number(key)
    if (Array.isArray(acc) && Number.isInteger(idx)) return acc[idx]
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

/** Resolve a top-level binding path like `header.x`, `row.Y`, `computed.z`, `constants.a.b.0`. */
function resolveRef(path: string, ctx: RenderContext): unknown {
  const dot = path.indexOf('.')
  const root = dot === -1 ? path : path.slice(0, dot)
  const rest = dot === -1 ? '' : path.slice(dot + 1)
  const bag = (ctx as unknown as Record<string, unknown>)[root]
  if (bag === undefined) return undefined
  return rest ? getPath(bag, rest) : bag
}

// ---- formatting filters -------------------------------------------------

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

function fmtNumber(v: unknown, decimals = 0): string {
  return toNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** money = grouped thousands with exactly 2 decimals. */
function fmtMoney(v: unknown): string {
  return fmtNumber(v, 2)
}

function fmtDate(v: unknown, pattern = 'dd/MM/yyyy'): string {
  if (v == null || v === '') return ''
  const d = new Date(String(v))
  if (isNaN(d.getTime())) return String(v)
  const pad = (n: number) => String(n).padStart(2, '0')
  const map: Record<string, string> = {
    dd: pad(d.getDate()),
    MM: pad(d.getMonth() + 1),
    yyyy: String(d.getFullYear()),
    yy: String(d.getFullYear()).slice(-2),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
  }
  return pattern.replace(/dd|MM|yyyy|yy|HH|mm/g, (t) => map[t] ?? t)
}

function applyFilter(value: unknown, name: string, arg?: string): unknown {
  switch (name) {
    case 'number':
      return fmtNumber(value, arg ? parseInt(arg, 10) : 0)
    case 'money':
      return fmtMoney(value)
    case 'date':
      return fmtDate(value, arg)
    case 'upper':
      return String(value ?? '').toUpperCase()
    case 'lower':
      return String(value ?? '').toLowerCase()
    case 'default':
      return value == null || value === '' ? (arg ?? '') : value
    default:
      return value
  }
}

/**
 * Interpolate a template string. Supports:
 *   {{ path }}                      -> resolved value
 *   {{ path | filter:arg }}         -> filtered
 *   multiple {{ }} in one string    -> concatenated with the literal text
 * A bare {{ }} expression (single, full-string) returns the raw resolved value
 * so callers can test truthiness / pass numbers through.
 */
export function interpolate(tpl: string | undefined, ctx: RenderContext): string {
  if (tpl == null) return ''
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, body: string) => {
    return String(resolveExpression(body, ctx) ?? '')
  })
}

/** Resolve a single `{{ ... }}` body (path + optional pipe filters) to a raw value. */
export function resolveExpression(body: string, ctx: RenderContext): unknown {
  const parts = body.split('|').map((s) => s.trim())
  const path = parts[0]
  let value = resolveRef(path, ctx)
  for (let i = 1; i < parts.length; i++) {
    const [fname, ...rest] = parts[i].split(':')
    value = applyFilter(value, fname.trim(), rest.join(':').trim() || undefined)
  }
  return value
}

/** Evaluate an `if` condition string (a binding) to a boolean. */
export function evalCondition(cond: string | undefined, ctx: RenderContext): boolean {
  if (!cond) return true
  const m = cond.match(/^\{\{\s*(.+?)\s*\}\}$/)
  const raw = m ? resolveExpression(m[1], ctx) : interpolate(cond, ctx)
  if (raw == null) return false
  if (typeof raw === 'string') return raw.trim() !== ''
  if (typeof raw === 'number') return raw !== 0
  return Boolean(raw)
}
