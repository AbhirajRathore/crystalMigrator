import type { ReportTemplate } from '../engine/types'

/**
 * Report registry. Each migrated report = one template JSON + (in real deployment)
 * one backend endpoint. Here templates are served statically from /templates/<id>.json.
 *
 * To add a report: drop its template under public/templates/ and register it below.
 */
export const REPORTS: { id: string; title: string; templateUrl: string }[] = [
  { id: 'export-invoice-sale', title: 'Export Invoice Sale', templateUrl: '/templates/export-invoice-sale.json' },
]

const cache = new Map<string, ReportTemplate>()

export async function loadTemplate(id: string): Promise<ReportTemplate> {
  if (cache.has(id)) return cache.get(id)!
  const entry = REPORTS.find((r) => r.id === id)
  if (!entry) throw new Error(`Unknown report: ${id}`)
  const res = await fetch(entry.templateUrl)
  if (!res.ok) throw new Error(`Failed to load template ${id}: ${res.status}`)
  const tpl = (await res.json()) as ReportTemplate
  cache.set(id, tpl)
  return tpl
}
