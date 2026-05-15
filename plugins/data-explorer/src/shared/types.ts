/**
 * DataExplorer shared types — no runtime deps.
 *
 * Importable from BOTH front and server bundles without dragging in
 * platform-specific code.
 */

export type Badge = {
  /** 1–4 char mono code rendered as a chip. */
  code: string
  tooltip?: string
}

export type ExplorerItem = {
  id: string
  title: string
  /** Optional muted second line (truncates with title). */
  subtitle?: string
  /** Group key — must match one of the facet values for `groupBy`. */
  group?: string
  /** Leading mono chip (e.g. type code, frequency). */
  leading?: Badge
  /** Trailing mono chips for status flags (e.g. [D] derived, [LIVE]). */
  trailing?: Badge[]
  /** Right-aligned plain text for numeric metadata (e.g. "1.2M", "2.4s"). */
  meta?: string
}

export type FacetValue = { value: string; count: number }

export type Facets = Record<string, FacetValue[]>

export type FacetConfig = {
  /** Filter key sent to the adapter (e.g. "frequency"). */
  key: string
  /** Display label (e.g. "Frequency"). */
  label: string
  /** Explicit display order; unknown values go after in adapter order. */
  order?: string[]
  /** Display formatter for raw values (e.g. "M" → "Monthly"). */
  formatValue?: (value: string) => string
}

export type SearchArgs = {
  query: string
  filters: Record<string, string[]>
  /** Scope to a single group's value (only set when paginating inside a group). */
  group?: { key: string; value: string }
  limit: number
  offset: number
  signal?: AbortSignal
}

export type SearchResult = {
  items: ExplorerItem[]
  /** Total count for the current scope (query + filters + optional group). */
  total: number
  hasMore: boolean
}

export type FacetsArgs = {
  filters: Record<string, string[]>
  signal?: AbortSignal
}

export type ExplorerDataSource = {
  search(args: SearchArgs): Promise<SearchResult>
  /** Optional. When omitted, the explorer renders flat (no facet popover). */
  fetchFacets?(args: FacetsArgs): Promise<Facets>
}

export type DragPayload = { mimeType: string; value: string }
