import { useMemo } from 'react'
import { getPanelSizeConfigValue } from '../utils/panelConfig'

/**
 * Derives panel sizing configuration from the app config object.
 *
 * Returns defaults, minimums, collapsed sizes, right-rail defaults,
 * and left-sidebar panel metadata used by the layout system.
 */
export default function usePanelConfig(config) {
  const panelDefaults = config.panels?.defaults || { filetree: 280, terminal: 400, agent: 400, shell: 250 }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback object is stable across renders when config is unchanged
  const panelMin = config.panels?.min || { filetree: 180, terminal: 250, agent: 250, shell: 100, center: 200 }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback object is stable across renders when config is unchanged
  const panelCollapsed = config.panels?.collapsed || { filetree: 48, terminal: 48, agent: 48, shell: 36 }
  const rightRailDefaults = {
    agent:
      Number.isFinite(panelDefaults.agent) ? panelDefaults.agent : panelDefaults.terminal,
    agentMin:
      Number.isFinite(panelMin.agent) ? panelMin.agent : panelMin.terminal,
    agentCollapsed:
      Number.isFinite(panelCollapsed.agent) ? panelCollapsed.agent : panelCollapsed.terminal,
  }
  const leftSidebarPanelIds = useMemo(() => {
    const configured = config.panels?.leftSidebarPanels
    if (!Array.isArray(configured) || configured.length === 0) {
      return ['filetree']
    }
    const unique = []
    configured.forEach((id) => {
      if (typeof id !== 'string' || id.length === 0 || unique.includes(id)) return
      unique.push(id)
    })
    return unique.length > 0 ? unique : ['filetree']
  }, [config.panels?.leftSidebarPanels])
  const leftSidebarCollapsedWidth = useMemo(() => {
    const widths = leftSidebarPanelIds
      .map((panelId) => getPanelSizeConfigValue(panelCollapsed, panelId, 'filetree'))
      .filter((value) => Number.isFinite(value))
    if (widths.length === 0) return panelCollapsed.filetree ?? 48
    return Math.max(...widths)
  }, [leftSidebarPanelIds, panelCollapsed])
  const leftSidebarMinWidth = useMemo(() => {
    const widths = leftSidebarPanelIds
      .map((panelId) => getPanelSizeConfigValue(panelMin, panelId, 'filetree'))
      .filter((value) => Number.isFinite(value))
    if (widths.length === 0) return panelMin.filetree ?? 180
    return Math.max(...widths)
  }, [leftSidebarPanelIds, panelMin])

  return {
    panelDefaults,
    panelMin,
    panelCollapsed,
    rightRailDefaults,
    leftSidebarPanelIds,
    leftSidebarCollapsedWidth,
    leftSidebarMinWidth,
  }
}
