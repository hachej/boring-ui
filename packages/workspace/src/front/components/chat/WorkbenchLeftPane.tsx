"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, Database, FolderTree, Search, X } from "lucide-react"
import { cn } from "../../../lib/utils"
import type { WorkspaceBridge } from "../../bridge/types"
import { FileTreeView } from "../../../panes/file-tree/FileTreeView"
import { DataExplorer } from "../DataExplorer/DataExplorer"
import { createSourcesAdapter, type SourceEntry } from "../DataExplorer/adapters"
import type {
  DragPayload,
  ExplorerAdapter,
  ExplorerRow,
  FacetConfig,
} from "../DataExplorer/types"

export type DataSource = SourceEntry

/**
 * Plug-in config for the chat shell's data tab. When provided, the shell
 * routes the data pane through DataExplorer with the host-supplied adapter
 * — supports macro-style catalogs (thousands of records, async search,
 * facets, drag-to-overlay) without exposing DataExplorer details.
 */
export type DataPaneConfig = {
  adapter: ExplorerAdapter
  groupBy?: string
  facets?: FacetConfig[]
  onActivate?: (row: ExplorerRow) => void
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
  emptyState?: React.ReactNode
}

export type WorkbenchLeftTab = "files" | "data"

export interface WorkbenchLeftPaneProps {
  rootDir?: string
  bridge?: WorkspaceBridge
  /** Legacy: small static catalog. Built into a sync adapter internally. */
  dataSources?: DataSource[]
  /** Plug-in: takes precedence over dataSources when provided. */
  data?: DataPaneConfig
  defaultTab?: WorkbenchLeftTab
  onCollapse?: () => void
  className?: string
}

export function WorkbenchLeftPane({
  rootDir = "",
  bridge,
  dataSources = [],
  data,
  defaultTab = "files",
  onCollapse,
  className,
}: WorkbenchLeftPaneProps) {
  const [tab, setTab] = useState<WorkbenchLeftTab>(defaultTab)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 180)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const toggleSearch = useCallback(() => {
    setSearchOpen((s) => {
      if (s) setQuery("")
      return !s
    })
  }, [])

  const onSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault()
      setSearchOpen(false)
      setQuery("")
    }
  }, [])

  return (
    <div className={cn("workbench-left-root flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-1 border-b border-[color:oklch(from_var(--border)_l_c_h/0.25)] px-2" style={{ height: 44 }}>
        <div
          role="tablist"
          aria-label="Workbench sources"
          className="flex items-center gap-0.5"
        >
          <SegmentedTab
            active={tab === "files"}
            onClick={() => setTab("files")}
            icon={<FolderTree className="h-3.5 w-3.5" />}
          >
            Files
          </SegmentedTab>
          <SegmentedTab
            active={tab === "data"}
            onClick={() => setTab("data")}
            icon={<Database className="h-3.5 w-3.5" />}
          >
            Data
          </SegmentedTab>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={toggleSearch}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground",
            "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "hover:bg-foreground/5 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            searchOpen && "bg-foreground/5 text-foreground",
          )}
          aria-label="Search"
          title="Search"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "hover:bg-foreground/5 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label="Hide files"
            title="Hide files"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {searchOpen && (
        <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={tab === "files" ? "Search files..." : "Search data..."}
            className="h-6 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "files" ? (
          <FileTreeView
            rootDir={rootDir}
            searchQuery={debouncedQuery || undefined}
            bridge={bridge}
            className="px-1 pt-1 [&_[role=treeitem]]:!indent-0"
          />
        ) : data ? (
          <DataExplorerWithConfig config={data} query={debouncedQuery} />
        ) : (
          <DataExplorerForSources sources={dataSources} query={debouncedQuery} />
        )}
      </div>
    </div>
  )
}

function SegmentedTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        "relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium",
        "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("transition-colors", active ? "text-[color:var(--accent)]" : "")}>{icon}</span>
      <span className="tracking-tight">{children}</span>
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-1 -bottom-[9px] h-[2px] rounded-t-[2px] bg-[color:var(--accent)]"
        />
      )}
    </button>
  )
}

function DataExplorerWithConfig({
  config,
  query,
}: {
  config: DataPaneConfig
  query: string
}) {
  return (
    <DataExplorer
      adapter={config.adapter}
      query={query}
      searchable={false}
      groupBy={config.groupBy}
      facets={config.facets}
      onActivate={config.onActivate}
      getDragPayload={config.getDragPayload}
      emptyState={config.emptyState ?? "No data sources"}
      className="h-full"
    />
  )
}

function DataExplorerForSources({ sources, query }: { sources: DataSource[]; query: string }) {
  // Build the adapter once per `sources` reference. The chat shell already
  // provides the search input and debounced query, so we drive DataExplorer
  // in controlled mode and hide its internal toolbar.
  const adapter = useMemo(() => createSourcesAdapter(sources), [sources])
  // If any source declares a schema, group rows by it (toggleable sections).
  const grouped = useMemo(() => sources.some((s) => !!s.schema), [sources])
  return (
    <DataExplorer
      adapter={adapter}
      query={query}
      searchable={false}
      groupBy={grouped ? "schema" : undefined}
      facets={grouped ? [{ key: "schema", label: "Schema" }] : undefined}
      emptyState="No data sources"
      className="h-full"
    />
  )
}

