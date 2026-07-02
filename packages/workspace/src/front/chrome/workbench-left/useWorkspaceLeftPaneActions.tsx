"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { useRegistry, useWorkspaceSourceRegistry } from "../../registry"
import type { PanelConfig, WorkspaceSourceConfig } from "../../registry/types"
import { isWorkspacePagePlacement } from "../../../shared/types/panel"

export type WorkbenchLeftTabId = string

const FILES_LEFT_TAB_ID = "files"

export interface WorkspaceLeftPaneOpenPanelConfig {
  id: string
  component: string
  title?: string
  params?: Record<string, unknown>
}

export interface UseWorkspaceLeftPaneActionsOptions {
  defaultTab?: WorkbenchLeftTabId
  activeTab?: WorkbenchLeftTabId
  activePanelId?: string | null
  onActiveTabChange?: (tab: WorkbenchLeftTabId) => void
  revealFileTreeRequest?: { path: string; seq: number } | null
  onOpenPanel?: (config: WorkspaceLeftPaneOpenPanelConfig) => void
  onReloadAgentPlugins?: () => void | Promise<unknown>
  onExpand?: (tab?: WorkbenchLeftTabId) => void
  onCloseSourcePane?: () => void
  railOnly?: boolean
}

export interface WorkspaceLeftPaneAction {
  id: WorkbenchLeftTabId
  title: string
  icon: ReactNode
  kind: "source" | "workspace-page"
  active: boolean
  select: () => void
  reloadAgentPlugins?: () => void | Promise<unknown>
}

type WorkbenchLeftPaneEntry = {
  id: string
  title: string
  icon: ReactNode
  source?: WorkspaceSourceConfig
  panel?: PanelConfig
  kind: "source" | "workspace-page"
}

interface WorkbenchLeftPaneActionModel extends WorkspaceLeftPaneAction {
  source?: WorkspaceSourceConfig
  panel?: PanelConfig
  focused: boolean
}

interface WorkbenchLeftPaneModel {
  actions: WorkbenchLeftPaneActionModel[]
  publicActions: WorkspaceLeftPaneAction[]
  activeTab: WorkbenchLeftTabId
  activeAction?: WorkbenchLeftPaneActionModel
  activeSource?: WorkspaceSourceConfig
}

export function useWorkspaceLeftPaneActions(options: UseWorkspaceLeftPaneActionsOptions = {}): WorkspaceLeftPaneAction[] {
  return useWorkbenchLeftPaneModel({ ...options, railOnly: options.railOnly ?? true }).publicActions
}

export function useWorkbenchLeftPaneModel({
  defaultTab,
  activeTab: controlledActiveTab,
  activePanelId,
  onActiveTabChange,
  revealFileTreeRequest,
  onOpenPanel,
  onReloadAgentPlugins,
  onExpand,
  onCloseSourcePane,
  railOnly = false,
}: UseWorkspaceLeftPaneActionsOptions = {}): WorkbenchLeftPaneModel {
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
  const workspacePagePanels = useMemo(
    () => panels.filter((panel) => isWorkspacePagePlacement(panel.placement)),
    [panels],
  )
  const entries = useMemo<WorkbenchLeftPaneEntry[]>(() => {
    const next: WorkbenchLeftPaneEntry[] = []
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
  const activeTab = entries.some((entry) => entry.id === selectedTab) ? selectedTab : (entries[0]?.id ?? "")
  const setActiveTab = useCallback((next: WorkbenchLeftTabId) => {
    if (controlledActiveTab === undefined) setTab(next)
    onActiveTabChange?.(next)
  }, [controlledActiveTab, onActiveTabChange])

  useEffect(() => {
    if (entries.length > 0 && !entries.some((entry) => entry.id === selectedTab)) {
      setActiveTab(entries[0]!.id)
    }
  }, [entries, selectedTab, setActiveTab])

  useEffect(() => {
    if (!revealFileTreeRequest) return
    if (entries.some((entry) => entry.id === FILES_LEFT_TAB_ID)) {
      setActiveTab(FILES_LEFT_TAB_ID)
    }
  }, [entries, revealFileTreeRequest, setActiveTab])

  const openPanelForEntry = useCallback((entry: WorkbenchLeftPaneEntry) => {
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
    const target = panels.find((panel) => panel.id === defaultPanelId)
    if (!target) return
    onOpenPanel({
      id: target.id,
      component: target.id,
      title: target.title,
    })
  }, [onOpenPanel, panels])

  const selectEntry = useCallback((entry: WorkbenchLeftPaneEntry) => {
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

  const actions = useMemo<WorkbenchLeftPaneActionModel[]>(() => {
    return entries.map((entry) => {
      // A source lives in the collapsible left pane; a workspace-page is a
      // full-window surface tab. At most one plugin should receive the accent:
      // sources are focused while the source pane is open, pages are focused
      // while the rail is collapsed and their surface tab is active.
      const active = entry.kind === "workspace-page" ? entry.id === activePanelId : entry.id === activeTab
      const focused = entry.kind === "workspace-page" ? active && railOnly : active && !railOnly
      return {
        ...entry,
        active,
        focused,
        select: () => selectEntry(entry),
        reloadAgentPlugins: onReloadAgentPlugins,
      }
    })
  }, [activePanelId, activeTab, entries, onReloadAgentPlugins, railOnly, selectEntry])

  const publicActions = useMemo<WorkspaceLeftPaneAction[]>(() => {
    return actions.map(({ id, title, icon, kind, active, select, reloadAgentPlugins }) => ({
      id,
      title,
      icon,
      kind,
      active,
      select,
      reloadAgentPlugins,
    }))
  }, [actions])

  const activeAction = actions.find((entry) => entry.id === activeTab)

  return {
    actions,
    publicActions,
    activeTab,
    activeAction,
    activeSource: activeAction?.kind === "source" ? activeAction.source : undefined,
  }
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
