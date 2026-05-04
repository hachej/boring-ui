"use client"

import {
  createElement,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react"
import { ChevronLeft, PanelLeft, Search, X } from "lucide-react"
import { IconButton, Input, Tabs, TabsList, TabsTrigger } from "@boring/ui"
import { cn } from "../../lib/utils"
import type { WorkspaceBridge } from "../../bridge/types"
import { useRegistry } from "../../registry"
import type { PaneProps, PanelConfig } from "../../registry/types"
import type { LeftTabParams } from "../../../shared/plugins/types"
import { PluginErrorBoundary } from "../../plugin/PluginErrorBoundary"

export type WorkbenchLeftTabId = string

export interface WorkbenchLeftPaneProps {
  rootDir?: string
  bridge?: WorkspaceBridge
  defaultTab?: WorkbenchLeftTabId
  onCollapse?: () => void
  className?: string
}

export function WorkbenchLeftPane({
  rootDir = "",
  bridge,
  defaultTab,
  onCollapse,
  className,
}: WorkbenchLeftPaneProps) {
  const panelRegistry = useRegistry()
  const panels = useSyncExternalStore(
    panelRegistry.subscribe,
    panelRegistry.getSnapshot,
    panelRegistry.getSnapshot,
  )
  const leftTabPanels = useMemo(
    () => panels.filter((panel) => panel.placement === "left-tab"),
    [panels],
  )
  const tabs = useMemo(() => {
    const next: Array<{ id: string; title: string; icon: React.ReactNode; panel?: PanelConfig }> = []
    for (const panel of leftTabPanels) {
      const Icon = panel.icon
      next.push({
        id: panel.id,
        title: panel.title,
        icon: Icon ? <Icon className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />,
        panel,
      })
    }
    return next
  }, [leftTabPanels])
  const [tab, setTab] = useState<WorkbenchLeftTabId>(defaultTab ?? "")
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : (tabs[0]?.id ?? "")
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

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((entry) => entry.id === tab)) {
      setTab(tabs[0]!.id)
    }
  }, [tab, tabs])

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

  const activeEntry = tabs.find((entry) => entry.id === activeTab)
  const leftTabParams = useMemo<LeftTabParams>(
    () => ({
      rootDir,
      bridge,
      query: debouncedQuery,
      searchQuery: debouncedQuery || undefined,
      chromeless: true,
    }),
    [bridge, debouncedQuery, rootDir],
  )

  return (
    <div data-boring-workspace-part="workbench-left" className={cn("workbench-left-root flex h-full min-h-0 flex-col", className)}>
      <div className="flex h-11 items-center gap-1 border-b border-[color:oklch(from_var(--border)_l_c_h/0.25)] px-2">
        <Tabs value={activeTab} onValueChange={setTab} className="min-w-0 flex-1" aria-label="Workbench sources">
          <TabsList variant="line" className="h-auto gap-0.5 p-0">
            {tabs.map((entry) => (
              <TabsTrigger
                key={entry.id}
                value={entry.id}
                className="h-8 flex-none gap-1.5 px-2 py-1 text-[12px] data-[state=active]:text-foreground data-[state=active]:after:bg-[color:var(--accent)]"
              >
                <span className="data-[state=active]:text-[color:var(--accent)]">{entry.icon}</span>
                <span className="tracking-tight">{entry.title}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={toggleSearch}
          className={cn(searchOpen && "bg-foreground/5 text-foreground")}
          aria-label="Search"
          title="Search"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
        </IconButton>
        {onCollapse && (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCollapse}
            aria-label="Hide sources"
            title="Hide sources"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        )}
      </div>

      {searchOpen && (
        <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={`Search ${(activeEntry?.title ?? "sources").toLowerCase()}...`}
            className="h-7 flex-1 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {query && (
            <IconButton
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </IconButton>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <LeftTabPanelHost panel={activeEntry?.panel} params={leftTabParams} />
      </div>
    </div>
  )
}

const noopDisposable = { dispose() {} }
const noopPaneApi = new Proxy(
  {},
  {
    get: () => () => noopDisposable,
  },
) as PaneProps["api"]
const noopContainerApi = new Proxy(
  {},
  {
    get: () => () => undefined,
  },
) as PaneProps["containerApi"]

function LeftTabPanelHost({ panel, params }: { panel?: PanelConfig; params: LeftTabParams }) {
  const Inner = useMemo(() => {
    if (!panel) return null
    if (panel.lazy) {
      return lazy(
        panel.component as () => Promise<{ default: ComponentType<unknown> }>,
      )
    }
    return panel.component as ComponentType<any>
  }, [panel])

  if (!panel || !Inner) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
        No workbench source registered.
      </div>
    )
  }
  return (
    <PluginErrorBoundary
      pluginId={panel.pluginId ?? panel.id}
      contributionKind="panel"
      contributionId={panel.id}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
            Loading source...
          </div>
        }
      >
        {createElement(Inner, {
          params,
          api: noopPaneApi,
          containerApi: noopContainerApi,
          className: "h-full",
        })}
      </Suspense>
    </PluginErrorBoundary>
  )
}
