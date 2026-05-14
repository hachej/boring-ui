"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { DataExplorer } from "../../../front/components/DataExplorer"
import type {
  DataExplorerProps,
  DragPayload,
  ExplorerAdapter,
  ExplorerRow,
  FacetConfig,
  FacetValue,
  Facets,
  SearchResult,
} from "../../../front/components/DataExplorer"
import { Input } from "@hachej/boring-ui-kit"
import { cn } from "../../../front/lib/utils"
import { definePanel } from "../../../front/registry/types"
import type { PaneProps, PanelConfig } from "../../../front/registry/types"
import { defineFrontPlugin } from "../../../shared/plugins/defineFrontPlugin"
import type { CatalogConfig, LeftTabParams, PluginOutput } from "../../../shared/plugins/types"
import type { WorkspaceFrontPlugin } from "../../../shared/plugins/defineFrontPlugin"
import { ExplorerRowItem, SectionFilters } from "./sectionedExplorerParts"

export const EXPLORER_PLUGIN_ID = "explorer"

export type ExplorerMode = "flat" | "grouped" | "sectioned"

export interface ExplorerSectionFilter extends FacetConfig {
  values?: FacetValue[]
}

export interface ExplorerSection {
  id: string
  title: string
  subtitle?: string
  count?: number
  filters?: ExplorerSectionFilter[]
  defaultExpanded?: boolean
}

export interface SectionedExplorerSectionsArgs {
  query: string
  globalFilters: Record<string, string[]>
  signal?: AbortSignal
}

export interface SectionedExplorerSearchArgs {
  query: string
  globalFilters: Record<string, string[]>
  filters: Record<string, string[]>
  limit: number
  offset: number
  signal?: AbortSignal
}

export interface SectionedExplorerFacetArgs {
  query: string
  globalFilters: Record<string, string[]>
  filters: Record<string, string[]>
  signal?: AbortSignal
}

export interface SectionedExplorerAdapter {
  sections(args: SectionedExplorerSectionsArgs): Promise<ExplorerSection[]>
  searchSection(sectionId: string, args: SectionedExplorerSearchArgs): Promise<SearchResult>
  fetchSectionFacets?(sectionId: string, args: SectionedExplorerFacetArgs): Promise<Facets>
}

export interface SectionedExplorerProps {
  adapter: SectionedExplorerAdapter
  onActivate?: (row: ExplorerRow) => void
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
  emptyState?: ReactNode
  searchPlaceholder?: string
  searchable?: boolean
  query?: string
  pageSize?: number
  className?: string
}

export type ExplorerViewProps =
  | (Omit<DataExplorerProps, "groupBy"> & {
      mode?: "flat"
      groupBy?: never
      sectionedAdapter?: never
    })
  | (DataExplorerProps & {
      mode: "grouped"
      groupBy: string
      sectionedAdapter?: never
    })
  | (Omit<SectionedExplorerProps, "adapter"> & {
      mode: "sectioned"
      adapter?: never
      sectionedAdapter: SectionedExplorerAdapter
      facets?: never
      groupBy?: never
    })

export interface ExplorerContributionConfig {
  id?: string
  title?: string
  label?: string
  icon?: PanelConfig["icon"]
}

export interface ExplorerCatalogConfig {
  id?: string
  label?: string
  onSelect?: (row: ExplorerRow) => void
}

export interface CreateExplorerOutputsOptions {
  id: string
  label?: string
  mode?: ExplorerMode
  adapter?: ExplorerAdapter
  sectionedAdapter?: SectionedExplorerAdapter
  facets?: FacetConfig[]
  groupBy?: string
  onActivate?: (row: ExplorerRow) => void
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
  emptyState?: ReactNode
  searchPlaceholder?: string
  searchable?: boolean
  query?: string
  pageSize?: number
  debounceMs?: number
  className?: string
  leftTab?: false | ExplorerContributionConfig
  panel?: false | ExplorerContributionConfig
  catalog?: false | ExplorerCatalogConfig
  source?: PanelConfig["source"]
}

export interface CreateExplorerPluginOptions extends CreateExplorerOutputsOptions {
  pluginId?: string
}

function resolveMode(options: CreateExplorerOutputsOptions): ExplorerMode {
  if (options.mode) return options.mode
  return options.sectionedAdapter ? "sectioned" : options.groupBy ? "grouped" : "flat"
}

function explorerViewProps(options: CreateExplorerOutputsOptions): ExplorerViewProps {
  const mode = resolveMode(options)
  if (mode === "sectioned") {
    if (!options.sectionedAdapter) {
      throw new Error(`explorer "${options.id}" requires sectionedAdapter for sectioned mode`)
    }
    return {
      mode,
      sectionedAdapter: options.sectionedAdapter,
      onActivate: options.onActivate,
      getDragPayload: options.getDragPayload,
      emptyState: options.emptyState,
      searchPlaceholder: options.searchPlaceholder,
      searchable: options.searchable,
      query: options.query,
      pageSize: options.pageSize,
      className: options.className,
    }
  }

  if (!options.adapter) {
    throw new Error(`explorer "${options.id}" requires adapter for ${mode} mode`)
  }
  if (mode === "grouped" && !options.groupBy) {
    throw new Error(`explorer "${options.id}" requires groupBy for grouped mode`)
  }

  return {
    mode,
    adapter: options.adapter,
    facets: options.facets,
    groupBy: mode === "grouped" ? options.groupBy : undefined,
    onActivate: options.onActivate,
    getDragPayload: options.getDragPayload,
    emptyState: options.emptyState,
    searchPlaceholder: options.searchPlaceholder,
    searchable: options.searchable,
    query: options.query,
    pageSize: options.pageSize,
    debounceMs: options.debounceMs,
    className: options.className,
  } as ExplorerViewProps
}

export function ExplorerView(props: ExplorerViewProps) {
  if (props.mode === "sectioned") {
    const {
      sectionedAdapter,
      mode: _mode,
      adapter: _adapter,
      facets: _facets,
      groupBy: _groupBy,
      ...rest
    } = props
    return <SectionedExplorer adapter={sectionedAdapter} {...rest} />
  }

  const { mode: _mode, sectionedAdapter: _sectionedAdapter, ...rest } = props
  return <DataExplorer {...rest} />
}

export function createExplorerOutputs(options: CreateExplorerOutputsOptions): PluginOutput[] {
  const outputs: PluginOutput[] = []
  const label = options.label ?? "Explorer"
  const viewProps = explorerViewProps(options)
  const source = options.source ?? "app"

  function ExplorerLeftTab({ params, className }: PaneProps<LeftTabParams>) {
    return (
      <ExplorerView
        {...viewProps}
        query={params?.searchQuery ?? params?.query ?? viewProps.query}
        className={className ?? viewProps.className ?? "h-full"}
      />
    )
  }

  function ExplorerPanel({ className }: PaneProps) {
    return <ExplorerView {...viewProps} className={className ?? viewProps.className ?? "h-full"} />
  }

  if (options.leftTab !== false) {
    const leftTab = options.leftTab ?? {}
    outputs.push({
      type: "left-tab",
      id: leftTab.id ?? options.id,
      title: leftTab.title ?? leftTab.label ?? label,
      icon: leftTab.icon,
      component: ExplorerLeftTab,
      source,
      chromeless: true,
    })
  }

  if (options.panel) {
    const panel = definePanel({
      id: options.panel.id ?? `${options.id}-panel`,
      title: options.panel.title ?? options.panel.label ?? label,
      icon: options.panel.icon,
      component: ExplorerPanel,
      placement: "center",
      source,
    })
    outputs.push({ type: "panel", panel })
  }

  if (options.catalog) {
    if (!options.adapter) {
      throw new Error(`explorer "${options.id}" catalog requires a flat/grouped adapter`)
    }
    const catalog: CatalogConfig = {
      id: options.catalog.id ?? options.id,
      label: options.catalog.label ?? label,
      adapter: options.adapter,
      onSelect: options.catalog.onSelect ?? options.onActivate ?? (() => {}),
    }
    outputs.push({ type: "catalog", catalog })
  }

  return outputs
}

export function createExplorerPlugin(options: CreateExplorerPluginOptions): WorkspaceFrontPlugin {
  return defineFrontPlugin({
    id: options.pluginId ?? options.id,
    label: options.label ?? "Explorer",
    outputs: createExplorerOutputs(options),
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function SectionedExplorer({
  adapter,
  onActivate,
  getDragPayload,
  emptyState = "No results",
  searchPlaceholder = "Search…",
  searchable = true,
  query: controlledQuery,
  pageSize = 50,
  className,
}: SectionedExplorerProps) {
  const isControlled = controlledQuery !== undefined
  const [query, setQuery] = useState(controlledQuery ?? "")
  const [sections, setSections] = useState<ExplorerSection[]>([])
  const [sectionItems, setSectionItems] = useState<Record<string, ExplorerRow[]>>({})
  const [sectionTotals, setSectionTotals] = useState<Record<string, number>>({})
  const [sectionHasMore, setSectionHasMore] = useState<Record<string, boolean>>({})
  const [loadingSections, setLoadingSections] = useState(false)
  const [loadingItems, setLoadingItems] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [scopedFilters, setScopedFilters] = useState<Record<string, Record<string, string[]>>>({})
  const [sectionFacets, setSectionFacets] = useState<Record<string, Facets>>({})
  const sectionsController = useRef<AbortController | null>(null)
  const itemControllers = useRef(new Map<string, AbortController>())

  const effectiveQuery = controlledQuery ?? query

  const sectionItemsRef = useRef(sectionItems)
  sectionItemsRef.current = sectionItems
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const loadSectionItems = useCallback(
    async (sectionId: string, offset: number, append: boolean) => {
      itemControllers.current.get(sectionId)?.abort()
      const ctrl = new AbortController()
      itemControllers.current.set(sectionId, ctrl)
      setLoadingItems((prev) => ({ ...prev, [sectionId]: true }))
      try {
        const filters = scopedFilters[sectionId] ?? {}
        const result = await adapter.searchSection(sectionId, {
          query: effectiveQuery,
          globalFilters: {},
          filters,
          limit: pageSize,
          offset,
          signal: ctrl.signal,
        })
        if (ctrl.signal.aborted) return
        setSectionItems((prev) => ({
          ...prev,
          [sectionId]: append ? [...(prev[sectionId] ?? []), ...result.items] : result.items,
        }))
        setSectionTotals((prev) => ({ ...prev, [sectionId]: result.total }))
        setSectionHasMore((prev) => ({ ...prev, [sectionId]: result.hasMore }))
      } catch (error) {
        if (!isAbortError(error)) console.error("Explorer: section search failed", error)
      } finally {
        if (itemControllers.current.get(sectionId) === ctrl) {
          setLoadingItems((prev) => ({ ...prev, [sectionId]: false }))
        }
      }
    },
    [adapter, effectiveQuery, pageSize, scopedFilters],
  )

  const loadSectionFacets = useCallback(
    async (sectionId: string) => {
      if (!adapter.fetchSectionFacets) return
      try {
        const facets = await adapter.fetchSectionFacets(sectionId, {
          query: effectiveQuery,
          globalFilters: {},
          filters: scopedFilters[sectionId] ?? {},
        })
        setSectionFacets((prev) => ({ ...prev, [sectionId]: facets }))
      } catch (error) {
        if (!isAbortError(error)) console.error("Explorer: section facets failed", error)
      }
    },
    [adapter, effectiveQuery, scopedFilters],
  )

  const loadSectionItemsRef = useRef(loadSectionItems)
  const loadSectionFacetsRef = useRef(loadSectionFacets)
  loadSectionItemsRef.current = loadSectionItems
  loadSectionFacetsRef.current = loadSectionFacets

  useEffect(() => {
    sectionsController.current?.abort()
    const ctrl = new AbortController()
    sectionsController.current = ctrl
    setLoadingSections(true)
    void adapter
      .sections({ query: effectiveQuery, globalFilters: {}, signal: ctrl.signal })
      .then((nextSections) => {
        if (ctrl.signal.aborted) return
        setSections(nextSections)
        const defaults: Record<string, boolean> = {}
        for (const section of nextSections) defaults[section.id] = !!section.defaultExpanded
        setExpanded(defaults)
        setSectionItems({})
        setSectionHasMore({})
        setSectionTotals({})
        for (const section of nextSections) {
          if (section.defaultExpanded) {
            void loadSectionFacetsRef.current(section.id)
            void loadSectionItemsRef.current(section.id, 0, false)
          }
        }
      })
      .catch((error) => {
        if (!isAbortError(error)) console.error("Explorer: sections failed", error)
      })
      .finally(() => {
        if (sectionsController.current === ctrl) setLoadingSections(false)
      })
    return () => ctrl.abort()
  }, [adapter, effectiveQuery])

  const toggleSection = useCallback(
    (sectionId: string) => {
      setExpanded((prev) => {
        const next = !prev[sectionId]
        if (next && !(sectionId in sectionItemsRef.current)) {
          void loadSectionFacets(sectionId)
          void loadSectionItems(sectionId, 0, false)
        }
        return { ...prev, [sectionId]: next }
      })
    },
    [loadSectionFacets, loadSectionItems],
  )

  const toggleScopedFilter = useCallback(
    (sectionId: string, key: string, value: string) => {
      setScopedFilters((prev) => {
        const sectionFilters = prev[sectionId] ?? {}
        const current = sectionFilters[key] ?? []
        const nextValues = current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value]
        const nextSectionFilters = { ...sectionFilters }
        if (nextValues.length) nextSectionFilters[key] = nextValues
        else delete nextSectionFilters[key]
        return { ...prev, [sectionId]: nextSectionFilters }
      })
      setSectionItems((prev) => ({ ...prev, [sectionId]: [] }))
    },
    [],
  )

  useEffect(() => {
    for (const sectionId of Object.keys(scopedFilters)) {
      if (expandedRef.current[sectionId]) {
        void loadSectionFacets(sectionId)
        void loadSectionItems(sectionId, 0, false)
      }
    }
  }, [scopedFilters, loadSectionFacets, loadSectionItems])

  const showEmpty = !loadingSections && sections.length === 0

  return (
    <div className={cn("flex h-full flex-col", className)} data-slot="sectioned-explorer">
      {searchable && !isControlled ? (
        <div className="border-b border-border/60 px-2 py-1.5">
          <Input
            aria-label="Search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            className="h-7 rounded-sm border-transparent bg-muted/40 px-2 text-[12.5px] shadow-none focus-visible:bg-background focus-visible:ring-1"
          />
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto" data-slot="sectioned-explorer-list">
        {showEmpty ? (
          <div className="flex h-full items-center justify-center px-4 py-8 text-[12px] text-muted-foreground">
            {emptyState}
          </div>
        ) : (
          <ul className="flex flex-col py-1">
            {sections.map((section) => {
              const isExpanded = !!expanded[section.id]
              const items = sectionItems[section.id] ?? []
              const staticFacets = Object.fromEntries(
                (section.filters ?? []).map((filter) => [filter.key, filter.values ?? []]),
              ) as Facets
              const facets = sectionFacets[section.id] ?? staticFacets
              const filters = scopedFilters[section.id] ?? {}
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleSection(section.id)}
                    className={cn(
                      "group mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-md px-1.5 py-1 text-left",
                      "transition-colors duration-120 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-muted/40",
                    )}
                  >
                    {isExpanded ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                      {section.title}
                    </span>
                    <span className="font-mono text-[10.5px] text-muted-foreground/80">
                      {(sectionTotals[section.id] ?? section.count ?? 0).toLocaleString()}
                    </span>
                  </button>
                  {isExpanded ? (
                    <div>
                      <SectionFilters
                        configs={section.filters ?? []}
                        facets={facets}
                        selected={filters}
                        onToggle={(key, value) => toggleScopedFilter(section.id, key, value)}
                      />
                      <ul className="flex flex-col">
                        {items.map((row) => (
                          <ExplorerRowItem
                            key={row.id}
                            row={row}
                            indent
                            onActivate={onActivate}
                            getDragPayload={getDragPayload}
                          />
                        ))}
                        {loadingItems[section.id] && items.length === 0 ? (
                          <li className="py-1.5 pl-7 pr-3 text-[11px] text-muted-foreground/80">
                            Loading…
                          </li>
                        ) : null}
                        {sectionHasMore[section.id] ? (
                          <li className="py-1 pl-7 pr-3">
                            <button
                              type="button"
                              onClick={() => loadSectionItems(section.id, items.length, true)}
                              disabled={loadingItems[section.id]}
                              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                            >
                              {loadingItems[section.id] ? "Loading…" : "Load more"}
                            </button>
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export type {
  DataExplorerProps,
  DragPayload,
  ExplorerAdapter,
  ExplorerRow,
  FacetConfig,
  FacetValue,
  Facets,
  SearchResult,
}
