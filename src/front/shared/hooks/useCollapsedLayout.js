import { useEffect, useRef } from 'react'
import {
  listDockPanels,
  getPanelComponent,
} from '../utils/dockHelpers'

/**
 * Manages dockview group constraints and sizes based on collapsed state.
 *
 * Applies width/height constraints to left sidebar, terminal, agent,
 * and shell groups whenever their collapsed state changes.
 */
export default function useCollapsedLayout({
  dockApi,
  collapsed,
  leftSidebarPanelIds,
  leftSidebarCollapsedWidth,
  leftSidebarMinWidth,
  sectionCollapsed,
  getSidebarCollapsedHeight,
  getSidebarExpandedMinHeight,
  getLeftSidebarGroups,
  panelSizesRef,
  panelCollapsedRef,
  panelMinRef,
}) {
  const collapsedEffectRan = useRef(false)

  useEffect(() => {
    if (!dockApi) return

    // On first run, only apply constraints and collapsed sizes, not expanded sizes
    // (layout restore already set the correct expanded sizes)
    const isFirstRun = !collapsedEffectRan.current
    if (isFirstRun) {
      collapsedEffectRan.current = true
    }

    const leftGroups = getLeftSidebarGroups(dockApi)
    const terminalGroups = (() => {
      const byId = new Map()
      listDockPanels(dockApi)
        .filter((panel) => getPanelComponent(panel) === 'terminal')
        .forEach((panel) => {
          if (panel?.group?.id) byId.set(panel.group.id, panel.group)
        })
      return Array.from(byId.values())
    })()
    const agentGroups = (() => {
      const byId = new Map()
      listDockPanels(dockApi)
        .filter((panel) => getPanelComponent(panel) === 'agent')
        .forEach((panel) => {
          if (panel?.group?.id) byId.set(panel.group.id, panel.group)
        })
      return Array.from(byId.values())
    })()

    if (leftGroups.length > 0) {
      const collapsedWidth = leftSidebarCollapsedWidth
      const minWidth = leftSidebarMinWidth
      if (collapsed.filetree) {
        // When sidebar is fully collapsed, give filetree all vertical space
        // and hide non-filetree panels (they render empty when collapsed).
        leftSidebarPanelIds.forEach((panelId) => {
          const group = dockApi.getPanel(panelId)?.group
          if (!group) return
          const constraints = {
            minimumWidth: collapsedWidth,
            maximumWidth: collapsedWidth,
          }
          if (leftSidebarPanelIds.length > 1 && panelId !== 'filetree') {
            constraints.minimumHeight = 0
            constraints.maximumHeight = 0
          }
          group.api.setConstraints(constraints)
          group.api.setSize({ width: collapsedWidth })
          if (leftSidebarPanelIds.length > 1 && panelId !== 'filetree') {
            group.api.setSize({ height: 0 })
          }
        })
      } else {
        // Restore width AND height constraints when expanding.
        // Height constraints must be restored because collapse sets non-filetree panels to height 0.
        const allSectionsCollapsed = leftSidebarPanelIds.length > 1
          && leftSidebarPanelIds.every((id) => sectionCollapsed[id])
        leftSidebarPanelIds.forEach((panelId) => {
          const group = dockApi.getPanel(panelId)?.group
          if (!group) return
          const constraints = {
            minimumWidth: minWidth,
            maximumWidth: Number.MAX_SAFE_INTEGER,
          }
          if (leftSidebarPanelIds.length > 1) {
            if (sectionCollapsed[panelId]) {
              const collapsedHeight = getSidebarCollapsedHeight(panelId)
              const hasFooter = panelId === 'filetree'
              const keepFlexible = allSectionsCollapsed && hasFooter
              constraints.minimumHeight = collapsedHeight
              constraints.maximumHeight = keepFlexible ? Number.MAX_SAFE_INTEGER : collapsedHeight
            } else {
              constraints.minimumHeight = getSidebarExpandedMinHeight(panelId)
              constraints.maximumHeight = Number.MAX_SAFE_INTEGER
            }
          }
          group.api.setConstraints(constraints)
        })
        // Only set size on subsequent runs (user toggled), not on initial load.
        if (!isFirstRun) {
          const expandedWidth = Math.max(panelSizesRef.current.filetree ?? minWidth, minWidth)
          leftGroups.forEach((group) => {
            group.api.setSize({ width: expandedWidth })
          })
        }
      }
    }

    terminalGroups.forEach((terminalGroup) => {
      if (collapsed.terminal) {
        terminalGroup.api.setConstraints({
          minimumWidth: panelCollapsedRef.current.terminal,
          maximumWidth: panelCollapsedRef.current.terminal,
        })
        terminalGroup.api.setSize({ width: panelCollapsedRef.current.terminal })
      } else {
        // Use Number.MAX_SAFE_INTEGER to clear max constraint and allow resizing
        terminalGroup.api.setConstraints({
          minimumWidth: panelMinRef.current.terminal,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
        if (!isFirstRun) {
          terminalGroup.api.setSize({ width: panelSizesRef.current.terminal })
        }
      }
    })

    agentGroups.forEach((agentGroup) => {
      if (collapsed.agent) {
        agentGroup.api.setConstraints({
          minimumWidth: panelCollapsedRef.current.agent,
          maximumWidth: panelCollapsedRef.current.agent,
        })
        agentGroup.api.setSize({ width: panelCollapsedRef.current.agent })
      } else {
        agentGroup.api.setConstraints({
          minimumWidth: panelMinRef.current.agent,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
        if (!isFirstRun) {
          agentGroup.api.setSize({ width: panelSizesRef.current.agent })
        }
      }
    })

    const shellPanel = dockApi.getPanel('shell')
    const shellGroup = shellPanel?.group

    // Apply constraints to shell group
    if (shellGroup) {
      if (collapsed.shell) {
        shellGroup.api.setConstraints({
          minimumHeight: panelCollapsedRef.current.shell,
          maximumHeight: panelCollapsedRef.current.shell,
        })
        shellGroup.api.setSize({ height: panelCollapsedRef.current.shell })
      } else {
        // Clear height constraints to allow resizing (use Number.MAX_SAFE_INTEGER as open-ended max)
        shellGroup.api.setConstraints({
          minimumHeight: panelMinRef.current.shell,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
        // Only set size on subsequent runs (user toggled), not on initial load
        if (!isFirstRun) {
          // Ensure saved size respects minimum constraint
          const savedHeight = panelSizesRef.current.shell
          const minHeight = panelMinRef.current.shell
          shellGroup.api.setSize({ height: Math.max(savedHeight, minHeight) })
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally limited deps to avoid re-running layout logic on every config change
  }, [dockApi, collapsed, getLeftSidebarGroups, leftSidebarCollapsedWidth, leftSidebarMinWidth])

  return { collapsedEffectRan }
}
