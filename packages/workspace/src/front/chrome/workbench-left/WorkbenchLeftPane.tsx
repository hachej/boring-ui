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
  // Default tab is only a boot preference; once the user picks a source,
  // async plugin tab registration must not steal focus back.
  const userSelectedTabRef = useRef(false)
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
    if (
      defaultTab &&
      !userSelectedTabRef.current &&
      tabs.some((entry) => entry.id === defaultTab) &&
      tab !== defaultTab
    ) {
      setTab(defaultTab)
      return
    }
    if (tabs.length > 0 && !tabs.some((entry) => entry.id === tab)) {
      setTab(tabs[0]!.id)
    }
  }, [defaultTab, tab, tabs])

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
    <div className={cn("workbench-left-root flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-1 border-b border-[color:oklch(from_var(--border)_l_c_h/0.25)] px-2" style={{ height: 44 }}>
        <div
          role="tablist"
          aria-label="Workbench sources"
          className="flex items-center gap-0.5"
        >
          {tabs.map((entry) => (
            <SegmentedTab
              key={entry.id}
              active={activeTab === entry.id}
              onClick={() => {
                userSelectedTabRef.current = true
                setTab(entry.id)
              }}
              icon={entry.icon}
            >
              {entry.title}
            </SegmentedTab>
          ))}
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
            aria-label="Hide sources"
            title="Hide sources"
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
            placeholder={`Search ${(activeEntry?.title ?? "sources").toLowerCase()}...`}
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
