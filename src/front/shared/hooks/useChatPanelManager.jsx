/**
 * useChatPanelManager — Chat panel lifecycle management.
 *
 * Extracted from App.jsx. Provides:
 * - addChatPanel: create new agent/chat panels with positioning logic
 * - handleSplitChatPanel: split an existing chat panel
 * - handleOpenChatTab: open a new chat tab (split from active or new)
 * - RightHeaderActions: header component for quick chat actions
 * - createUniquePanelId: generate unique panel IDs
 */
import { useCallback, useMemo, useRef } from 'react'
import { Bot } from 'lucide-react'

import Tooltip from '../components/Tooltip'
import {
  listDockPanels,
  getPanelComponent,
} from '../utils/dockHelpers'

export default function useChatPanelManager({
  dockApi,
  dockApiRef,
  centerGroupRef,
  panelMinRef,
  panelSizesRef,
  collapsed,
  agentMode,
  suppressPendingLayoutRestoreRef,
  getLeftSidebarAnchorPosition,
  getLiveCenterGroup,
}) {
  const createUniquePanelId = useCallback((api, prefix) => {
    let counter = 1
    let candidate = `${prefix}-${Date.now().toString(36)}`
    while (api.getPanel(candidate)) {
      candidate = `${prefix}-${Date.now().toString(36)}-${counter}`
      counter += 1
    }
    return candidate
  }, [])

  const handleSplitChatPanelRef = useRef(null)

  const addChatPanel = useCallback(
    ({
      mode = 'tab',
      sourcePanelId = '',
      piSessionBootstrap = 'latest',
      suppressPendingLayoutRestore = false,
    } = {}) => {
      const api = dockApiRef.current
      if (!api) return false
      if (suppressPendingLayoutRestore) {
        suppressPendingLayoutRestoreRef.current = true
      }

      const sourcePanel = sourcePanelId ? api.getPanel(sourcePanelId) : null
      const component = 'agent'

      const panelIdPrefix = 'agent-chat'
      const panelId = createUniquePanelId(api, panelIdPrefix)
      const piInitialSessionId = agentMode !== 'backend'
        && piSessionBootstrap === 'new'
        ? `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        : ''
      const title = 'Agent'
      const matchingPanels = listDockPanels(api).filter(
        (panel) => getPanelComponent(panel) === component,
      )
      const defaultReferencePanel = matchingPanels[0]
      let emptyCenterPanel = api.getPanel('empty-center')
      let centerGroup = getLiveCenterGroup(api) || emptyCenterPanel?.group

      // Ensure chat panels anchor in the center area, not side rails.
      if (!centerGroup) {
        const emptyCenterPosition = getLeftSidebarAnchorPosition(api)
        if (!emptyCenterPanel && emptyCenterPosition) {
          emptyCenterPanel = api.addPanel({
            id: 'empty-center',
            component: 'empty',
            title: '',
            position: emptyCenterPosition,
          })
        }
        if (emptyCenterPanel?.group) {
          emptyCenterPanel.group.header.hidden = true
          centerGroupRef.current = emptyCenterPanel.group
          centerGroup = emptyCenterPanel.group
          emptyCenterPanel.group.api.setConstraints({
            minimumHeight: panelMinRef.current.center,
            maximumHeight: Number.MAX_SAFE_INTEGER,
          })
        }
      }

      let position
      if (mode === 'split' && sourcePanel) {
        position = { direction: 'right', referencePanel: sourcePanel.id }
      } else if (mode === 'tab' && !sourcePanel && centerGroup) {
        position = { referenceGroup: centerGroup }
      } else if (mode === 'split' && defaultReferencePanel) {
        position = { direction: 'right', referencePanel: defaultReferencePanel.id }
      } else if (sourcePanel?.group) {
        position = { referenceGroup: sourcePanel.group }
      } else if (defaultReferencePanel?.group) {
        position = { referenceGroup: defaultReferencePanel.group }
      } else if (mode === 'split') {
        const emptyCenter = api.getPanel('empty-center')
        if (emptyCenter) {
          position = { direction: 'right', referencePanel: emptyCenter.id }
        } else if (centerGroup?.activePanel?.id) {
          position = { direction: 'right', referencePanel: centerGroup.activePanel.id }
        } else if (centerGroup?.panels?.[0]?.id) {
          position = { direction: 'right', referencePanel: centerGroup.panels[0].id }
        } else if (centerGroup) {
          position = { referenceGroup: centerGroup }
        }
      } else if (centerGroup) {
        position = { referenceGroup: centerGroup }
      } else {
        position = getLeftSidebarAnchorPosition(api)
      }

      const panel = api.addPanel({
        id: panelId,
        component,
        title,
        position,
        params: {
          panelId,
          collapsed: false,
          onToggleCollapse: undefined,
          mode: agentMode,
          piSessionBootstrap,
          piInitialSessionId,
        },
      })
      if (!panel) return false

      // Set onSplitPanel immediately so the "Split chat panel" button
      // appears without waiting for the params sync effect to re-run.
      if (handleSplitChatPanelRef.current) {
        panel.api.updateParameters({
          ...panel.params,
          onSplitPanel: handleSplitChatPanelRef.current,
        })
      }

      if (panel?.group) {
        panel.group.locked = false
        panel.group.header.hidden = false
        panel.group.api.setConstraints({
          minimumWidth: panelMinRef.current.agent,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
        if (!collapsed.agent) {
          panel.group.api.setSize({ width: panelSizesRef.current.agent })
        }

        // Remove empty placeholder once a real chat panel is added to that group.
        if (
          emptyCenterPanel
          && emptyCenterPanel.id !== panel.id
          && emptyCenterPanel.group?.id === panel.group.id
        ) {
          emptyCenterPanel.api.close()
        }
      }

      panel.api.setActive()
      return true
    },
    [
      agentMode,
      createUniquePanelId,
      getLeftSidebarAnchorPosition,
      getLiveCenterGroup,
      collapsed.agent,
    ],
  )

  const handleSplitChatPanel = useCallback((panelId, options = {}) => {
    if (!panelId) return
    addChatPanel({
      mode: 'split',
      sourcePanelId: panelId,
      piSessionBootstrap: options.piSessionBootstrap || 'latest',
      suppressPendingLayoutRestore: true,
    })
  }, [addChatPanel])
  handleSplitChatPanelRef.current = handleSplitChatPanel

  const handleOpenChatTab = useCallback(() => {
    if (!dockApi) {
      addChatPanel({ mode: 'split', piSessionBootstrap: 'new', suppressPendingLayoutRestore: true })
      return
    }

    const agentPanels = listDockPanels(dockApi).filter((panel) => {
      const component = getPanelComponent(panel)
      return component === 'agent'
    })

    const activePanel = dockApi.activePanel
    const activeIsAgent = activePanel
      && getPanelComponent(activePanel) === 'agent'
    const preferredSource = activeIsAgent
      ? activePanel
      : (agentPanels.find((panel) => panel.id === 'agent') || agentPanels[0])

    if (preferredSource?.id) {
      handleSplitChatPanel(preferredSource.id, { piSessionBootstrap: 'new' })
      return
    }

    addChatPanel({ mode: 'split', piSessionBootstrap: 'new', suppressPendingLayoutRestore: true })
  }, [addChatPanel, dockApi, handleSplitChatPanel])

  // Right header actions component for quick chat actions in center groups.
  const RightHeaderActions = useCallback(
    (props) => {
      const panels = props.group?.panels || []
      const hasCenterTabs = panels.some((p) => {
        const id = typeof p?.id === 'string' ? p.id : ''
        return id.startsWith('editor-') || id.startsWith('review-') || id === 'empty-center'
      })

      if (!hasCenterTabs) return null

      return (
        <div className="tab-header-actions">
          {hasCenterTabs && (
            <Tooltip label="Open new chat pane">
              <button
                type="button"
                className="tab-collapse-btn"
                onClick={handleOpenChatTab}
                aria-label="Open new chat pane"
              >
                <Bot size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      )
    },
    [handleOpenChatTab],
  )

  return {
    createUniquePanelId,
    addChatPanel,
    handleSplitChatPanel,
    handleSplitChatPanelRef,
    handleOpenChatTab,
    RightHeaderActions,
  }
}
