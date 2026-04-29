import { useMemo, type KeyboardEvent, type DragEvent, type ReactNode } from "react"
import { ChevronRightIcon, ChevronDownIcon, FilterIcon, XIcon } from "lucide-react"
import { cn } from "../../lib/utils"
import { Input } from "../ui/input"
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover"
import { useExplorerState } from "./useExplorerState"
import type {
  Badge as BadgeT,
  ExplorerAdapter,
  ExplorerRow,
  FacetConfig,
  DragPayload,
} from "./types"

export type DataExplorerProps = {
  adapter: ExplorerAdapter
  /** Facets shown in the toolbar popover. Adapter must implement fetchFacets for this to work. */
  facets?: FacetConfig[]
  /** Single grouping axis (must match a facet key). When set, renders tree mode. */
  groupBy?: string
  /** Activated when a row is clicked, double-clicked, or Enter-pressed. */
  onActivate?: (row: ExplorerRow) => void
  /** Returning a payload makes rows draggable. */
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
  /** Empty state shown when the top-level result has no rows and no query/filters. */
  emptyState?: ReactNode
  searchPlaceholder?: string
  /** Hide the search input. Default true. */
  searchable?: boolean
  /**
   * Controlled query. When set, the toolbar's search input is hidden and the
   * caller is responsible for supplying (and debouncing) the query value.
   * Useful when an outer chrome already owns a search box.
   */
  query?: string
  /** Page size and debounce — passed through to useExplorerState. */
  pageSize?: number
  debounceMs?: number
  className?: string
}

export function DataExplorer({
  adapter,
  facets: facetConfigs,
  groupBy,
  onActivate,
  getDragPayload,
  emptyState = "No results",
  searchPlaceholder = "Search…",
  searchable = true,
  query,
  pageSize,
  debounceMs,
  className,
}: DataExplorerProps) {
  const state = useExplorerState({
    adapter,
    facets: facetConfigs,
    groupBy,
    pageSize,
    debounceMs,
    query,
  })
  const isControlled = query !== undefined
  const showSearch = searchable && !isControlled

  // While a query is active, force flat mode even if groupBy is set —
  // group counts come from facets which don't reflect the query, so trees
  // would hide matches behind unrelated group headers.
  const hasQuery = (query ?? state.query ?? "").length > 0
  const treeMode = !!groupBy && !hasQuery
  const hasFilters = Object.values(state.filters).some((v) => v.length > 0)
  const filterCount = Object.values(state.filters).reduce((n, v) => n + v.length, 0)

  // Group entries from facets (canonical for tree mode).
  const groupEntries = useMemo(() => {
    if (!treeMode || !groupBy) return []
    const config = facetConfigs?.find((f) => f.key === groupBy)
    const values = state.facets?.[groupBy] ?? []
    const ordered = [...values]
    if (config?.order?.length) {
      const orderIdx = (v: string) => {
        const i = config.order!.indexOf(v)
        return i === -1 ? Number.MAX_SAFE_INTEGER : i
      }
      ordered.sort((a, b) => orderIdx(a.value) - orderIdx(b.value))
    }
    return ordered.map((v) => ({
      value: v.value,
      count: v.count,
      label: config?.formatValue ? config.formatValue(v.value) : v.value,
    }))
  }, [treeMode, groupBy, facetConfigs, state.facets])

  const showEmpty =
    !state.loading &&
    !treeMode &&
    state.topItems.length === 0 &&
    state.query.length === 0 &&
    !hasFilters

  return (
    <div className={cn("flex h-full flex-col", className)} data-slot="data-explorer">
      {showSearch || facetConfigs?.length ? (
        <Toolbar
          searchable={showSearch}
          searchPlaceholder={searchPlaceholder}
          query={state.query}
          onQueryChange={state.setQuery}
          facetConfigs={facetConfigs}
          facets={state.facets}
          filters={state.filters}
          filterCount={filterCount}
          onToggleFilter={state.toggleFilter}
          onClearFilters={state.clearFilters}
          total={treeMode ? null : state.topTotal}
        />
      ) : null}

      <div className="flex-1 overflow-y-auto" data-slot="data-explorer-list">
        {showEmpty ? (
          <div className="flex h-full items-center justify-center px-4 py-8 text-[12px] text-muted-foreground">
            {emptyState}
          </div>
        ) : treeMode ? (
          <TreeList
            entries={groupEntries}
            isExpanded={state.isExpanded}
            getGroup={state.getGroup}
            onExpand={state.expandGroup}
            onCollapse={state.collapseGroup}
            onLoadMoreGroup={state.loadMoreGroup}
            onActivate={onActivate}
            getDragPayload={getDragPayload}
          />
        ) : (
          <FlatList
            items={state.topItems}
            hasMore={state.topHasMore}
            loading={state.loading}
            onLoadMore={state.loadMoreTop}
            onActivate={onActivate}
            getDragPayload={getDragPayload}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

type ToolbarProps = {
  searchable: boolean
  searchPlaceholder: string
  query: string
  onQueryChange: (q: string) => void
  facetConfigs?: FacetConfig[]
  facets: ReturnType<typeof useExplorerState>["facets"]
  filters: Record<string, string[]>
  filterCount: number
  onToggleFilter: (key: string, value: string) => void
  onClearFilters: () => void
  total: number | null
}

function Toolbar({
  searchable,
  searchPlaceholder,
  query,
  onQueryChange,
  facetConfigs,
  facets,
  filters,
  filterCount,
  onToggleFilter,
  onClearFilters,
  total,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
      {searchable ? (
        <Input
          aria-label="Search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-7 flex-1 rounded-sm border-transparent bg-muted/40 px-2 text-[12.5px] shadow-none focus-visible:bg-background focus-visible:ring-1"
        />
      ) : null}
      {total != null ? (
        <span className="px-1 font-mono text-[10.5px] uppercase tracking-[0.05em] text-muted-foreground/80">
          {total.toLocaleString()}
        </span>
      ) : null}
      {facetConfigs?.length ? (
        <Popover>
          <PopoverTrigger
            aria-label="Filters"
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              filterCount > 0 && "bg-muted text-foreground",
            )}
          >
            <FilterIcon size={12} />
            {filterCount > 0 ? <span className="font-mono text-[10px]">{filterCount}</span> : null}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-64 space-y-3 p-3 text-[12px]"
          >
            {facetConfigs.map((config) => (
              <FacetSection
                key={config.key}
                config={config}
                values={facets?.[config.key] ?? []}
                selected={filters[config.key] ?? []}
                onToggle={onToggleFilter}
              />
            ))}
            {filterCount > 0 ? (
              <button
                type="button"
                onClick={onClearFilters}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <XIcon size={11} /> Clear all
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

function FacetSection({
  config,
  values,
  selected,
  onToggle,
}: {
  config: FacetConfig
  values: { value: string; count: number }[]
  selected: string[]
  onToggle: (key: string, value: string) => void
}) {
  if (!values.length) return null
  const ordered = config.order
    ? [...values].sort((a, b) => {
        const ia = config.order!.indexOf(a.value)
        const ib = config.order!.indexOf(b.value)
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
      })
    : values

  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
        {config.label}
      </div>
      <div className="flex flex-wrap gap-1">
        {ordered.map((v) => {
          const active = selected.includes(v.value)
          const label = config.formatValue ? config.formatValue(v.value) : v.value
          return (
            <button
              key={v.value}
              type="button"
              onClick={() => onToggle(config.key, v.value)}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px]",
                "transition-colors duration-120 ease-[cubic-bezier(0.22,1,0.36,1)]",
                active
                  ? "border-foreground/20 bg-foreground/8 text-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:border-foreground/15 hover:text-foreground",
              )}
            >
              {label}
              <span className="font-mono text-[10px] text-muted-foreground/80">
                {v.count.toLocaleString()}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function FlatList({
  items,
  hasMore,
  loading,
  onLoadMore,
  onActivate,
  getDragPayload,
}: {
  items: ExplorerRow[]
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
  onActivate?: (row: ExplorerRow) => void
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
}) {
  return (
    <ul className="flex flex-col px-1 py-1">
      {items.map((row) => (
        <Row
          key={row.id}
          row={row}
          onActivate={onActivate}
          getDragPayload={getDragPayload}
        />
      ))}
      {hasMore ? (
        <li className="px-3 py-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="w-full text-left text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </li>
      ) : null}
    </ul>
  )
}

function TreeList({
  entries,
  isExpanded,
  getGroup,
  onExpand,
  onCollapse,
  onLoadMoreGroup,
  onActivate,
  getDragPayload,
}: {
  entries: { value: string; count: number; label: string }[]
  isExpanded: (v: string) => boolean
  getGroup: (v: string) => { items: ExplorerRow[]; hasMore: boolean; loading: boolean }
  onExpand: (v: string) => void
  onCollapse: (v: string) => void
  onLoadMoreGroup: (v: string) => void
  onActivate?: (row: ExplorerRow) => void
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
}) {
  return (
    <ul className="flex flex-col py-1">
      {entries.map((entry) => {
        const expanded = isExpanded(entry.value)
        const group = getGroup(entry.value)
        return (
          <li key={entry.value}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() =>
                expanded ? onCollapse(entry.value) : onExpand(entry.value)
              }
              className={cn(
                "group mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-md px-1.5 py-1 text-left",
                "transition-colors duration-120 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-muted/40",
              )}
            >
              {expanded ? (
                <ChevronDownIcon size={11} className="text-muted-foreground/80" />
              ) : (
                <ChevronRightIcon size={11} className="text-muted-foreground/80" />
              )}
              <span className="text-[12.5px] font-medium text-foreground">{entry.label}</span>
              <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/80">
                {entry.count.toLocaleString()}
              </span>
            </button>
            {expanded ? (
              <ul className="flex flex-col">
                {group.items.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    indent
                    onActivate={onActivate}
                    getDragPayload={getDragPayload}
                  />
                ))}
                {group.loading && group.items.length === 0 ? (
                  <li className="pl-7 pr-3 py-1.5 text-[11px] text-muted-foreground/80">
                    Loading…
                  </li>
                ) : null}
                {group.hasMore ? (
                  <li className="pl-7 pr-3 py-1">
                    <button
                      type="button"
                      onClick={() => onLoadMoreGroup(entry.value)}
                      disabled={group.loading}
                      className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      {group.loading ? "Loading…" : "Load more"}
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function Row({
  row,
  indent,
  onActivate,
  getDragPayload,
}: {
  row: ExplorerRow
  indent?: boolean
  onActivate?: (row: ExplorerRow) => void
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
}) {
  const interactive = !!onActivate
  const payload = getDragPayload?.(row)
  const draggable = !!payload

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!interactive) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onActivate?.(row)
    }
  }

  const handleDragStart = (e: DragEvent<HTMLLIElement>) => {
    if (!payload) return
    e.dataTransfer.setData(payload.mimeType, payload.value)
    e.dataTransfer.setData("text/plain", payload.value)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <li
      {...(interactive
        ? { role: "button", tabIndex: 0, onClick: () => onActivate?.(row), onKeyDown: handleKeyDown }
        : {})}
      {...(draggable ? { draggable: true, onDragStart: handleDragStart } : {})}
      className={cn(
        "group mx-1 flex items-start gap-2 rounded-md px-1.5 py-1",
        "transition-colors duration-120 ease-[cubic-bezier(0.22,1,0.36,1)]",
        interactive && "cursor-pointer hover:bg-foreground/5",
        indent && "pl-7",
      )}
      title={row.title}
    >
      {row.leading ? <Chip badge={row.leading} /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] font-medium leading-tight text-foreground">
          {row.title}
        </span>
        {row.subtitle ? (
          <span className="truncate text-[11.5px] leading-snug text-muted-foreground/85">
            {row.subtitle}
          </span>
        ) : null}
      </span>
      {row.trailing?.length ? (
        <span className="flex shrink-0 items-center gap-1">
          {row.trailing.map((b, i) => (
            <Chip key={i} badge={b} />
          ))}
        </span>
      ) : null}
      {row.meta ? (
        <span className="shrink-0 self-center font-mono text-[10.5px] text-muted-foreground/80">
          {row.meta}
        </span>
      ) : null}
    </li>
  )
}

function Chip({ badge }: { badge: BadgeT }) {
  return (
    <span
      aria-hidden="true"
      title={badge.tooltip}
      className="mt-[1px] inline-flex h-[16px] min-w-[24px] shrink-0 items-center justify-center rounded-[3px] bg-muted/60 px-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground group-hover:text-foreground"
    >
      {badge.code}
    </span>
  )
}
