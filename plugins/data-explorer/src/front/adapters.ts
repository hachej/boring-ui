import type { ExplorerDataSource, ExplorerItem, Facets } from "./types"

// ---------------------------------------------------------------------------
// createSourcesAdapter
//
// Wraps a small static array of {id, name, type, description, schema?} entries
// into an ExplorerDataSource. Used by panes that still expose a legacy `sources`
// API. When at least one source has a `schema`, the adapter also exposes
// fetchFacets so the explorer can render schema-grouped, toggleable sections.
// ---------------------------------------------------------------------------

export type SourceEntry = {
  id: string
  name: string
  type: string
  description?: string
  /** Optional grouping bucket — typically a database schema or namespace. */
  schema?: string
}

export function createSourcesAdapter(sources: SourceEntry[]): ExplorerDataSource {
  const rows: ExplorerItem[] = sources.map((s) => ({
    id: s.id,
    title: s.name,
    subtitle: s.description,
    group: s.schema,
    leading: { code: s.type.slice(0, 3).toUpperCase(), tooltip: s.type },
  }))
  const hasSchema = rows.some((r) => r.group)

  const adapter: ExplorerDataSource = {
    async search(args) {
      let pool = rows
      if (args.group) {
        pool = pool.filter((r) => r.group === args.group!.value)
      }
      if (args.query) {
        const q = args.query.toLowerCase()
        pool = pool.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q) ||
            (r.subtitle?.toLowerCase().includes(q) ?? false),
        )
      }
      const slice = pool.slice(args.offset, args.offset + args.limit)
      return {
        items: slice,
        total: pool.length,
        hasMore: args.offset + slice.length < pool.length,
      }
    },
  }

  if (hasSchema) {
    adapter.fetchFacets = async () => {
      const facets: Facets = { schema: [] }
      for (const row of rows) {
        if (!row.group) continue
        const entry = facets.schema.find((e) => e.value === row.group)
        if (entry) entry.count += 1
        else facets.schema.push({ value: row.group, count: 1 })
      }
      return facets
    }
  }

  return adapter
}
