"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import type { PanelConfig } from "../../registry/types"
import { useRegistry } from "../../registry"

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
  revealFileTreeRequest?: { path: string; seq: number } | null
  onOpenPanel?: (config: WorkspaceLeftPaneOpenPanelConfig) => void
  onReloadAgentPlugins?: () => void | Promise<unknown>
}

export interface WorkspaceLeftPaneAction {
  id: WorkbenchLeftTabId
  title: string
  icon: ReactNode
  active: boolean
  select: () => void
  reloadAgentPlugins?: () => void | Promise<unknown>
}

interface WorkbenchLeftPaneActionModel extends WorkspaceLeftPaneAction {
  panel?: PanelConfig
}

interface WorkbenchLeftPaneModel {
  actions: WorkbenchLeftPaneActionModel[]
  publicActions: WorkspaceLeftPaneAction[]
  activeTab: WorkbenchLeftTabId
  activeAction?: WorkbenchLeftPaneActionModel
  activePanel?: PanelConfig
}

export function useWorkspaceLeftPaneActions(options: UseWorkspaceLeftPaneActionsOptions = {}): WorkspaceLeftPaneAction[] {
  return useWorkbenchLeftPaneModel(options).publicActions
}

export function useWorkbenchLeftPaneModel({
  defaultTab,
  revealFileTreeRequest,
  onOpenPanel,
  onReloadAgentPlugins,
}: UseWorkspaceLeftPaneActionsOptions = {}): WorkbenchLeftPaneModel {
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
  const tabEntries = useMemo(() => {
    return leftTabPanels.map((panel) => {
      const Icon = panel.icon
      return {
        id: panel.id,
        title: panel.title,
        // Icon-less plugins get an initial-letter glyph instead of a shared
        // generic icon — on an icon-only rail, two identical fallback icons
        // would be indistinguishable.
        icon: Icon ? <Icon className="h-4 w-4" /> : <CategoryInitial title={panel.title} />,
        panel,
      }
    })
  }, [leftTabPanels])

  const [tab, setTab] = useState<WorkbenchLeftTabId>(defaultTab ?? "")
  const activeTab = tabEntries.some((entry) => entry.id === tab) ? tab : (tabEntries[0]?.id ?? "")

  useEffect(() => {
    if (tabEntries.length > 0 && !tabEntries.some((entry) => entry.id === tab)) {
      setTab(tabEntries[0]!.id)
    }
  }, [tab, tabEntries])

  useEffect(() => {
    if (!revealFileTreeRequest) return
    if (tabEntries.some((entry) => entry.id === FILES_LEFT_TAB_ID)) {
      setTab(FILES_LEFT_TAB_ID)
    }
  }, [revealFileTreeRequest, tabEntries])

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

  const selectEntry = useCallback((entry: { id: string; panel?: PanelConfig }) => {
    setTab(entry.id)
    openDefaultPanelForTab(entry)
  }, [openDefaultPanelForTab])

  const actions = useMemo<WorkbenchLeftPaneActionModel[]>(() => {
    return tabEntries.map((entry) => ({
      ...entry,
      active: entry.id === activeTab,
      select: () => selectEntry(entry),
      reloadAgentPlugins: onReloadAgentPlugins,
    }))
  }, [activeTab, onReloadAgentPlugins, selectEntry, tabEntries])

  const publicActions = useMemo<WorkspaceLeftPaneAction[]>(() => {
    return actions.map(({ id, title, icon, active, select, reloadAgentPlugins }) => ({
      id,
      title,
      icon,
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
    activePanel: activeAction?.panel,
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
