"use client"

import {
  createElement,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { PanelLeftClose, Search, X } from "lucide-react"
import { IconButton, Input } from "@hachej/boring-ui-kit"
import { ControlTooltip } from "../../components/ControlTooltip"
import { cn } from "../../lib/utils"
import { PaneCollapseButton } from "../../layout/paneCollapseButton"
import type { FileTreeBridge } from "../../bridge/types"
import { useRegistry, useWorkspaceSourceRegistry } from "../../registry"
import type { PanelConfig, WorkspaceSourceConfig } from "../../registry/types"
import { isWorkspacePagePlacement, isWorkspaceSourcePlacement } from "../../../shared/types/panel"
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
  bridge?: FileTreeBridge
  defaultTab?: WorkbenchLeftTabId
  activeTab?: WorkbenchLeftTabId
  /**
   * Id of the currently-focused surface tab (dockview's active panel). Drives the
   * accent for "workspace-page" rail icons so a page only glows while it's the open
   * tab — `activeTab` is the rail's own click state and goes stale on tab switches.
   */
  activePanelId?: string | null
  onActiveTabChange?: (tab: WorkbenchLeftTabId) => void
  revealFileTreeRequest?: { path: string; seq: number } | null
  onOpenPanel?: (config: WorkbenchLeftPaneOpenPanelConfig) => void
  onReloadAgentPlugins?: () => void | Promise<unknown>
  onCollapse?: () => void
  onExpand?: (tab?: WorkbenchLeftTabId) => void
  onCloseSourcePane?: () => void
  railOnly?: boolean
  className?: string
}

export function WorkbenchLeftPane({
  rootDir = "",
  bridge,
  defaultTab,
  activeTab: controlledActiveTab,
  activePanelId,
  onActiveTabChange,
  revealFileTreeRequest,
  onOpenPanel,
  onReloadAgentPlugins,
  onCollapse,
  onExpand,
  onCloseSourcePane,
  railOnly = false,
  className,
}: WorkbenchLeftPaneProps) {
  const panelRegistry = useRegistry()
  const workspaceSourceRegistry = useWorkspaceSourceRegistry()
  const panels = useSyncExternalStore(
    panelRegistry.subscribe,
    panelRegistry.getSnapshot,
    panelRegistry.getSnapshot,
  )
  const workspaceSources = useSyncExternalStore(
    workspaceSourceRegistry.subscribe,
    workspaceSourceRegistry.getSnapshot,
    workspaceSourceRegistry.getSnapshot,
  )
  type LeftPaneEntry = {
    id: string
    title: string
    icon: ReactNode
    source?: WorkspaceSourceConfig
    panel?: PanelConfig
    kind: "source" | "workspace-page"
  }
  const workspacePagePanels = useMemo(
    () => panels.filter((panel) => isWorkspacePagePlacement(panel.placement)),
    [panels],
  )
  const tabs = useMemo(() => {
    const next: LeftPaneEntry[] = []
    for (const source of workspaceSources) {
      const Icon = source.icon
      next.push({
        id: source.id,
        title: source.title,
        kind: "source",
        // Icon-less plugins get an initial-letter glyph instead of a shared
        // generic icon — on an icon-only rail, two identical fallback icons
        // would be indistinguishable.
        icon: Icon ? <Icon className="h-4 w-4" /> : <CategoryInitial title={source.title} />,
        source,
      })
    }
    for (const panel of workspacePagePanels) {
      const Icon = panel.icon
      next.push({
        id: panel.id,
        title: panel.title,
        kind: "workspace-page",
        icon: Icon ? <Icon className="h-4 w-4" /> : <CategoryInitial title={panel.title} />,
        panel,
      })
    }
    return next
  }, [workspacePagePanels, workspaceSources])
  const [tab, setTab] = useState<WorkbenchLeftTabId>(defaultTab ?? "")
  const selectedTab = controlledActiveTab ?? tab
  const activeTab = tabs.some((entry) => entry.id === selectedTab) ? selectedTab : (tabs[0]?.id ?? "")
  const setActiveTab = useCallback((next: WorkbenchLeftTabId) => {
    if (controlledActiveTab === undefined) setTab(next)
    onActiveTabChange?.(next)
  }, [controlledActiveTab, onActiveTabChange])
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
    if (tabs.length > 0 && !tabs.some((entry) => entry.id === selectedTab)) {
      setActiveTab(tabs[0]!.id)
    }
  }, [selectedTab, setActiveTab, tabs])

  useEffect(() => {
    if (!revealFileTreeRequest) return
    if (tabs.some((entry) => entry.id === FILES_LEFT_TAB_ID)) {
      setActiveTab(FILES_LEFT_TAB_ID)
    }
  }, [revealFileTreeRequest, setActiveTab, tabs])

  const openPanelForEntry = useCallback((entry: LeftPaneEntry) => {
    if (!onOpenPanel) return
    if (entry.kind === "workspace-page" && entry.panel) {
      onOpenPanel({
        id: entry.panel.id,
        component: entry.panel.id,
        title: entry.panel.title,
      })
      return
    }
    const defaultPanelId = entry.source?.defaultPanelId
    if (!defaultPanelId) return
    const target = panels.find((panel) => panel.id === defaultPanelId && !isWorkspaceSourcePlacement(panel.placement))
    if (!target) return
    onOpenPanel({
      id: target.id,
      component: target.id,
      title: target.title,
    })
  }, [onOpenPanel, panels])

  const selectTab = useCallback((entry: LeftPaneEntry) => {
    if (entry.kind === "source") {
      if (!railOnly && entry.id === activeTab) {
        onCloseSourcePane?.()
        return
      }
      setActiveTab(entry.id)
      onExpand?.(entry.id)
      openPanelForEntry(entry)
      return
    }
    setActiveTab(entry.id)
    openPanelForEntry(entry)
    onCloseSourcePane?.()
  }, [activeTab, onCloseSourcePane, onExpand, openPanelForEntry, railOnly, setActiveTab])

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
  const activeSource = activeEntry?.kind === "source" ? activeEntry.source : undefined
  const activeOwnsSearch = Boolean(activeSource?.chromeless)
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
        <PaneCollapseButton label="Hide workspace menu" side="right" onClick={onCollapse} className="mb-1">
          <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
        </PaneCollapseButton>
      )}
      {tabs.map((entry) => {
        // A "source" lives in the collapsible left pane: its "selected" state is the
        // rail's own activeTab. A "workspace-page" is a full-window surface tab: its
        // "selected" state is whether it's the focused surface tab (activePanelId),
        // NOT the rail click — otherwise the icon stays lit after you switch tabs.
        const isPage = entry.kind === "workspace-page"
        const active = isPage ? entry.id === activePanelId : entry.id === activeTab
        // At most ONE plugin is "focused" (accent/orange) at a time. A source pane and
        // a page surface tab can be open at once (source on the left, page in the main
        // area), so gate by railOnly (= source pane collapsed): while a source pane is
        // open the active source is focused; while it's collapsed the active surface
        // page is focused. The other, if still open, falls through to the quiet neutral
        // highlight below — never a second accent.
        const showAccent = isPage ? active && railOnly : active && !railOnly
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
              )}
              // Inline (not arbitrary Tailwind classes) so it applies even when
              // the host's prebuilt CSS doesn't include these classes. Open plugin
              // (pane visible) = accent icon on an elevated chip; selected but
              // collapsed = quiet neutral, no accent.
              style={
                showAccent
                  ? { color: "var(--accent)", backgroundColor: "color-mix(in oklch, var(--foreground) 10%, transparent)" }
                  : active
                    ? { backgroundColor: "color-mix(in oklch, var(--foreground) 6%, transparent)" }
                    : undefined
              }
            >
              {entry.icon}
            </button>
          </ControlTooltip>
        )
      })}
    </nav>
  )

  if (railOnly) {
    return (
      <div data-boring-workspace-part="workbench-left" className={cn("workbench-left-root flex h-full min-h-0", className)}>
        {rail}
      </div>
    )
  }

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
          {activeEntry?.kind === "workspace-page" ? (
            <WorkspacePageLauncher title={activeEntry.title} />
          ) : (
            <LeftTabPanelHost source={activeSource} params={leftTabParams} onOpenPanel={onOpenPanel} />
          )}
        </div>
      </div>
    </div>
  )
}

function WorkspacePageLauncher({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
      <div className="mb-1 text-sm font-medium text-foreground">{title}</div>
      <div>Opened in the workspace.</div>
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

function LeftTabPanelHost({ source, params, onOpenPanel }: { source?: WorkspaceSourceConfig; params: LeftTabParams; onOpenPanel?: WorkbenchLeftPaneProps["onOpenPanel"] }) {
  const workspaceSourceRegistry = useWorkspaceSourceRegistry()
  const Inner = source ? workspaceSourceRegistry.getComponent(source.id) : null

  if (!source || !Inner) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
        No workspace category registered.
      </div>
    )
  }
  return (
    <PluginErrorBoundary
      pluginId={source.pluginId ?? source.id}
      contributionKind="workspace-source"
      contributionId={source.id}
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
          openPanel: onOpenPanel,
          className: "h-full",
        })}
      </Suspense>
    </PluginErrorBoundary>
  )
}
