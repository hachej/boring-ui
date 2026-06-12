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
import { Menu, Search, X } from "lucide-react"
import { IconButton, Input } from "@hachej/boring-ui-kit"
import { ControlTooltip } from "../../components/ControlTooltip"
import { cn } from "../../lib/utils"
import type { WorkspaceBridge } from "../../bridge/types"
import { useRegistry } from "../../registry"
import type { PaneProps, PanelConfig } from "../../registry/types"
import type { LeftTabParams } from "../../../shared/plugins/types"
import { PluginErrorBoundary } from "../../plugin/PluginErrorBoundary"

export type WorkbenchLeftTabId = string

const FILES_LEFT_TAB_ID = "files"

export interface WorkbenchLeftPaneOpenPanelConfig {
  id: string
  component: string
  title?: string
  params?: Record<string, unknown>
}

export interface WorkbenchLeftPaneProps {
  rootDir?: string
  bridge?: WorkspaceBridge
  defaultTab?: WorkbenchLeftTabId
  revealFileTreeRequest?: { path: string; seq: number } | null
  onOpenPanel?: (config: WorkbenchLeftPaneOpenPanelConfig) => void
  onReloadAgentPlugins?: () => void | Promise<unknown>
  onCollapse?: () => void
  className?: string
}

export function WorkbenchLeftPane({
  rootDir = "",
  bridge,
  defaultTab,
  revealFileTreeRequest,
  onOpenPanel,
  onReloadAgentPlugins,
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
        // Icon-less plugins get an initial-letter glyph instead of a shared
        // generic icon — on an icon-only rail, two identical fallback icons
        // would be indistinguishable.
        icon: Icon ? <Icon className="h-4 w-4" /> : <CategoryInitial title={panel.title} />,
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
  const [chromeActionsElement, setChromeActionsElement] = useState<HTMLDivElement | null>(null)
  const setChromeActionsRef = useCallback((node: HTMLDivElement | null) => {
    setChromeActionsElement(node)
  }, [])
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

  useEffect(() => {
    if (!revealFileTreeRequest) return
    if (tabs.some((entry) => entry.id === FILES_LEFT_TAB_ID)) {
      setTab(FILES_LEFT_TAB_ID)
    }
  }, [revealFileTreeRequest, tabs])

  const openDefaultPanelForTab = useCallback((entry: { panel?: PanelConfig }) => {
    const defaultPanelId = entry.panel?.defaultPanelId
    if (!defaultPanelId || !onOpenPanel) return
    const target = panels.find((panel) => panel.id === defaultPanelId && panel.placement !== "left-tab")
    if (!target) return
    onOpenPanel({
      id: target.id,
      component: target.id,
      title: target.title,
    })
  }, [onOpenPanel, panels])

  const selectTab = useCallback((entry: { id: string; panel?: PanelConfig }) => {
    setTab(entry.id)
    openDefaultPanelForTab(entry)
  }, [openDefaultPanelForTab])

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
  const activeOwnsSearch = Boolean((activeEntry?.panel as { chromeless?: boolean } | undefined)?.chromeless)
  const showChromeSearch = !activeOwnsSearch
  const leftTabParams = useMemo<LeftTabParams>(
    () => ({
      rootDir,
      bridge,
      query: debouncedQuery,
      searchQuery: debouncedQuery || undefined,
      chromeless: true,
      chromeActionsElement,
      revealFileTreeRequest,
    }),
    [bridge, chromeActionsElement, debouncedQuery, revealFileTreeRequest, rootDir],
  )

  // Workspace categories live on a quiet icon rail. The active category
  // visually connects to the content pane as one calm grey surface — same
  // background on the icon and the pane, bridged across the rail gutter,
  // with no accent marker or side stripe (see WORKSPACE_LEFT_NAV_UX_SPEC).
  // Instant tooltips (no OS hover delay) name the icon-only categories.
  const rail = (
    <nav
      className="flex w-11 shrink-0 flex-col items-center gap-1 bg-muted/35 px-1.5 py-2"
      aria-label="Workspace categories"
    >
      {onCollapse && (
        <ControlTooltip label="Hide workspace menu" side="right">
          <button
            type="button"
            aria-label="Hide workspace menu"
            onClick={onCollapse}
            className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Menu className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </ControlTooltip>
      )}
      {tabs.map((entry) => {
        const active = entry.id === activeTab
        return (
          <ControlTooltip key={entry.id} label={entry.title} side="right">
            <button
              type="button"
              aria-label={entry.title}
              aria-pressed={active}
              onClick={() => selectTab(entry)}
              onContextMenu={(event) => {
                if (!onReloadAgentPlugins) return
                event.preventDefault()
                void onReloadAgentPlugins()
              }}
              className={cn(
                "relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                active && "rounded-r-none bg-muted/35 text-foreground shadow-none hover:bg-muted/35 before:absolute before:-right-1.5 before:top-0 before:h-full before:w-1.5 before:bg-muted/35",
              )}
            >
              {entry.icon}
            </button>
          </ControlTooltip>
        )
      })}
    </nav>
  )

  return (
    <div data-boring-workspace-part="workbench-left" className={cn("workbench-left-root flex h-full min-h-0", className)}>
      {rail}

      <div className="flex h-full min-w-0 flex-1 flex-col bg-muted/35">
        {!activeOwnsSearch && (
          <div className="flex h-11 items-center gap-1 border-b border-border/60 bg-muted/35 px-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="shrink-0 text-foreground/80">{activeEntry?.icon}</span>
              <div className="truncate text-[14px] font-medium tracking-tight text-foreground">{activeEntry?.title ?? "Sources"}</div>
            </div>
            {showChromeSearch && (
              <ControlTooltip label="Search" side="bottom">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={toggleSearch}
                  className={cn(searchOpen && "bg-foreground/5 text-foreground")}
                  aria-label="Search"
                >
                  <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
                </IconButton>
              </ControlTooltip>
            )}
            <div
              ref={setChromeActionsRef}
              className="flex shrink-0 items-center gap-1"
              data-boring-workspace-part="left-tab-chrome-actions"
            />
          </div>
        )}

        {!activeOwnsSearch && showChromeSearch && searchOpen && (
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
          <LeftTabPanelHost panel={activeEntry?.panel} params={leftTabParams} onOpenPanel={onOpenPanel} />
        </div>
      </div>
    </div>
  )
}

function CategoryInitial({ title }: { title: string }) {
  const letter = (title.trim()[0] ?? "?").toUpperCase()
  return (
    <span
      aria-hidden="true"
      data-boring-workspace-part="category-initial"
      className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-foreground/10 text-[10px] font-semibold leading-none text-foreground/70"
    >
      {letter}
    </span>
  )
}

const noopDisposable = { dispose() {} }
const noopPaneApi = new Proxy(
  {},
  {
    get: () => () => noopDisposable,
  },
) as PaneProps["api"]
function createLeftTabContainerApi(onOpenPanel: WorkbenchLeftPaneProps["onOpenPanel"]): PaneProps["containerApi"] {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "addPanel") return (config: WorkbenchLeftPaneOpenPanelConfig) => onOpenPanel?.(config)
        return () => undefined
      },
    },
  ) as PaneProps["containerApi"]
}

function LeftTabPanelHost({ panel, params, onOpenPanel }: { panel?: PanelConfig; params: LeftTabParams; onOpenPanel?: WorkbenchLeftPaneProps["onOpenPanel"] }) {
  const Inner = useMemo(() => {
    if (!panel) return null
    if (panel.lazy) {
      return lazy(
        panel.component as () => Promise<{ default: ComponentType<unknown> }>,
      )
    }
    return panel.component as ComponentType<any>
  }, [panel])

  const containerApi = useMemo(() => createLeftTabContainerApi(onOpenPanel), [onOpenPanel])

  if (!panel || !Inner) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
        No workspace category registered.
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
            Loading workspace category...
          </div>
        }
      >
        {createElement(Inner, {
          params,
          api: noopPaneApi,
          containerApi,
          className: "h-full",
        })}
      </Suspense>
    </PluginErrorBoundary>
  )
}
