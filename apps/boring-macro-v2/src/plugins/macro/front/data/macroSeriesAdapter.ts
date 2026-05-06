// Adapter for the FRED macro catalog. Talks to /api/macro/catalog
// (records-one-by-one, ~87k series, paginated, faceted by frequency + source).

import type { ExplorerAdapter, ExplorerRow, Facets } from "@hachej/boring-workspace"
import { FREQ_LABELS } from "./macroSeriesUi"

interface CatalogResponse {
  items: Array<{
    id: string
    title: string
    frequency: string
    source: string
    derived?: boolean
    units?: string
  }>
  total: number
  hasMore: boolean
}

interface FacetsResponse {
  frequency: Array<{ value: string; count: number }>
  source: Array<{ value: string; count: number }>
}

function toRow(item: CatalogResponse["items"][number]): ExplorerRow {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.id,
    group: item.frequency,
    leading: { code: item.frequency, tooltip: FREQ_LABELS[item.frequency] },
    trailing: item.derived
      ? [{ code: "D", tooltip: "Derived series" }]
      : undefined,
  }
}

function buildQuery(params: Record<string, string | number | string[] | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    if (Array.isArray(v)) {
      for (const item of v) sp.append(k, String(item))
    } else {
      sp.set(k, String(v))
    }
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

export function createMacroSeriesAdapter(): ExplorerAdapter {
  return {
    async search(args) {
      // When expanding a group, translate its key/value into the server-side
      // filter param — the server has no concept of `group`, only flat filters.
      const frequency = args.group?.key === 'frequency'
        ? [args.group.value]
        : args.filters.frequency
      const qs = buildQuery({
        q: args.query || undefined,
        offset: args.offset,
        limit: args.limit,
        frequency,
        source: args.filters.source,
      })
      const res = await fetch(`/api/macro/catalog${qs}`, { signal: args.signal })
      if (!res.ok) {
        throw new Error(`catalog: ${res.status}`)
      }
      const data = (await res.json()) as CatalogResponse
      return {
        items: data.items.map(toRow),
        total: data.total,
        hasMore: data.hasMore,
      }
    },
    async fetchFacets(args) {
      const qs = buildQuery({
        frequency: args.filters.frequency,
        source: args.filters.source,
      })
      const res = await fetch(`/api/macro/facets${qs}`, { signal: args.signal })
      if (!res.ok) {
        throw new Error(`facets: ${res.status}`)
      }
      return (await res.json()) as Facets & FacetsResponse
    },
  }
}
