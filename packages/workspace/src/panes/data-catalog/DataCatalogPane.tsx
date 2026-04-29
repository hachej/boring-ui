import { lazy, Suspense, useMemo } from "react"
import { PanelChrome } from "../../dock"
import { createSourcesAdapter, type SourceEntry } from "../../components/DataExplorer/adapters"
import type {
  DataExplorerProps,
  ExplorerAdapter,
  ExplorerRow,
} from "../../components/DataExplorer"

const DataExplorer = lazy(() =>
  import("../../components/DataExplorer/DataExplorer").then((m) => ({
    default: m.DataExplorer,
  })),
)

// ---------------------------------------------------------------------------
// Legacy { sources, onSelect } API still works via createSourcesAdapter.
// Larger catalogs should pass `adapter` directly.
// ---------------------------------------------------------------------------

export type DataSource = SourceEntry

export type DataCatalogPaneProps = {
  sources?: DataSource[]
  onSelect?: (sourceId: string) => void
  /** Pass a custom adapter to override the legacy sources path entirely. */
  adapter?: ExplorerAdapter
  /** Forwarded to DataExplorer when adapter is set. */
  facets?: DataExplorerProps["facets"]
  groupBy?: DataExplorerProps["groupBy"]
  getDragPayload?: DataExplorerProps["getDragPayload"]
  className?: string
  title?: string
}

export function DataCatalogPane({
  sources = [],
  onSelect,
  adapter,
  facets,
  groupBy,
  getDragPayload,
  className,
  title = "Data Sources",
}: DataCatalogPaneProps) {
  const resolvedAdapter = useMemo(
    () => adapter ?? createSourcesAdapter(sources),
    [adapter, sources],
  )
  const onActivate = useMemo(
    () => (onSelect ? (row: ExplorerRow) => onSelect(row.id) : undefined),
    [onSelect],
  )

  return (
    <PanelChrome title={title}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <span className="animate-pulse">Loading…</span>
          </div>
        }
      >
        <DataExplorer
          adapter={resolvedAdapter}
          facets={facets}
          groupBy={groupBy}
          onActivate={onActivate}
          getDragPayload={getDragPayload}
          className={className}
          searchable={sources.length > 8 || !!adapter}
          emptyState="No data sources"
        />
      </Suspense>
    </PanelChrome>
  )
}
