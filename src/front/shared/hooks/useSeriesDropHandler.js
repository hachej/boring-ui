/**
 * useSeriesDropHandler — Series/chart drag-and-drop handling.
 *
 * Extracted from App.jsx. Provides:
 * - readDroppedSeriesId: extract series ID from drag data transfer
 * - routeSeriesDropToPanel: route a dropped series to a target panel
 * - openSeriesAtPosition: open a series chart at a specific position
 * - resolveDropPosition: resolve drop position from dockview event
 * - onDidDrop: top-level DockviewReact onDidDrop handler
 * - Fallback drop bridge effect for browser paths where Dockview drops are suppressed
 */
import { useCallback, useEffect } from 'react'

import {
  listDockPanels,
  listDockGroups,
  getPanelComponent,
} from '../utils/dockHelpers'

export default function useSeriesDropHandler({
  dockApi,
  centerGroupRef,
  panelMinRef,
  openFileAtPosition,
  getLeftSidebarAnchorPosition,
  getLiveCenterGroup,
  isLeftSidebarGroup,
}) {
  const readDroppedSeriesId = useCallback((dataTransfer) => {
    const transferTypes = dataTransfer?.types && typeof dataTransfer.types[Symbol.iterator] === 'function'
      ? Array.from(dataTransfer.types)
      : []
    const hasCustomSeriesType = transferTypes.includes('text/series-id')
    const droppedSeriesFromCustomType = String(dataTransfer?.getData('text/series-id') || '').trim()
    const droppedPlainText = String(dataTransfer?.getData('text/plain') || '').trim()
    const droppedSeriesFromWindow = typeof window !== 'undefined'
      ? String(window.__BM_DND_SERIES_ID || '').trim()
      : ''
    return droppedSeriesFromCustomType
      || droppedSeriesFromWindow
      || (
        hasCustomSeriesType
        && droppedPlainText
        && !droppedPlainText.includes('/')
        && !droppedPlainText.includes('\\')
        ? droppedPlainText
        : ''
      )
  }, [])

  const routeSeriesDropToPanel = useCallback((targetPanel, droppedSeriesId) => {
    if (!targetPanel || !droppedSeriesId) return
    const nextDropNonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const targetPanelId = String(targetPanel?.id || targetPanel?.api?.id || '')

    // Primary delivery path for chart overlays: explicit browser event routed by panel id.
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('bm-chart-overlay-drop', {
        detail: {
          panelId: targetPanelId,
          seriesId: droppedSeriesId,
          nonce: nextDropNonce,
        },
      }))
    }
    if (typeof targetPanel.api?.setActive === 'function') {
      targetPanel.api.setActive()
    }
  }, [])

  const openSeriesAtPosition = useCallback((seriesId, position, mode = 'chart') => {
    if (!dockApi || !seriesId) return

    const normalizedMode = mode === 'table' ? 'table' : 'chart'
    const panelId = `chart-${seriesId}`
    const existing = dockApi.getPanel(panelId)
    if (existing) {
      existing.api.updateParameters({ seriesId, mode: normalizedMode })
      if (existing.group) existing.group.locked = false
      existing.api.setActive()
      return
    }

    const emptyPanel = dockApi.getPanel('empty-center')
    const panel = dockApi.addPanel({
      id: panelId,
      component: 'chart-canvas',
      title: seriesId,
      params: { seriesId, mode: normalizedMode },
      position,
    })

    if (panel?.group) {
      panel.group.locked = false
      panel.group.header.hidden = false
      centerGroupRef.current = panel.group
      panel.group.api?.setConstraints({
        minimumHeight: panelMinRef.current.center,
        maximumHeight: Number.MAX_SAFE_INTEGER,
      })
    }
    panel?.api?.setActive()

    if (emptyPanel) {
      requestAnimationFrame(() => {
        const staleEmpty = dockApi.getPanel('empty-center')
        if (staleEmpty) {
          staleEmpty.api.close()
        }
      })
    }
  }, [dockApi])

  const resolveDropPosition = useCallback((dropEvent) => {
    const dropGroup = dropEvent?.group
    const dropPanel = dropEvent?.panel || dropGroup?.activePanel
    const rawPosition = dropEvent?.position
    const activePanelId = String(dropPanel?.id || '')

    if (rawPosition && typeof rawPosition === 'object' && !Array.isArray(rawPosition)) {
      return rawPosition
    }

    const mappedDirection = (() => {
      switch (String(rawPosition || '')) {
        case 'top':
          return 'above'
        case 'bottom':
          return 'below'
        case 'left':
          return 'left'
        case 'right':
          return 'right'
        case 'center':
          return 'within'
        default:
          return ''
      }
    })()

    if (mappedDirection && activePanelId) {
      return { direction: mappedDirection, referencePanel: activePanelId }
    }

    if (dropGroup && !isLeftSidebarGroup(dropGroup)) {
      return { referenceGroup: dropGroup }
    }

    const centerGroup = getLiveCenterGroup(dockApi)
    if (centerGroup) {
      return { referenceGroup: centerGroup }
    }

    return getLeftSidebarAnchorPosition(dockApi)
  }, [dockApi, getLeftSidebarAnchorPosition, getLiveCenterGroup, isLeftSidebarGroup])

  const onDidDrop = useCallback((event) => {
    const dataTransfer = event?.nativeEvent?.dataTransfer
    if (!dataTransfer) return

    const fileDataStr = dataTransfer.getData('application/x-kurt-file')
    if (fileDataStr) {
      try {
        const fileData = JSON.parse(fileDataStr)
        const path = fileData.path

        openFileAtPosition(path, resolveDropPosition(event))
      } catch {
        // Ignore parse errors
      }
      return
    }

    const droppedSeriesId = readDroppedSeriesId(dataTransfer)
    if (!droppedSeriesId) return

    const targetPanel = event?.panel || event?.group?.activePanel
    if (targetPanel && getPanelComponent(targetPanel) === 'chart-canvas') {
      routeSeriesDropToPanel(targetPanel, droppedSeriesId)
      return
    }

    if (targetPanel?.id) {
      openSeriesAtPosition(droppedSeriesId, {
        direction: targetPanel.id === 'agent' ? 'left' : 'right',
        referencePanel: targetPanel.id,
      })
      return
    }

    openSeriesAtPosition(droppedSeriesId, resolveDropPosition(event))
  }, [openFileAtPosition, readDroppedSeriesId, resolveDropPosition, routeSeriesDropToPanel, openSeriesAtPosition])

  // Fallback drop bridge for browsers/paths where Dockview external drops are suppressed.
  // Used for series overlay drops onto existing chart panels without split-target overlays.
  useEffect(() => {
    if (!dockApi || typeof document === 'undefined') return

    const dockRoot = document.querySelector('[data-testid="dockview"]')
    if (!dockRoot) return

    const resolvePanelFromTabElement = (tabElement) => {
      const tabTitle = String(
        tabElement?.querySelector?.('.dv-default-tab-content')?.textContent
          || tabElement?.textContent
          || '',
      ).trim()
      if (!tabTitle) return null

      const panels = listDockPanels(dockApi)
      const titleMatches = panels.filter((panel) => String(panel?.title || '').trim() === tabTitle)
      if (titleMatches.length === 0) return null
      if (titleMatches.length === 1) return titleMatches[0]
      return titleMatches.find((panel) => getPanelComponent(panel) === 'chart-canvas') || titleMatches[0]
    }

    const resolvePanelFromNativeTarget = (targetNode) => {
      const tabElement = targetNode?.closest?.('.dv-tab')
      if (tabElement) {
        return resolvePanelFromTabElement(tabElement)
      }

      const groupElement = targetNode?.closest?.('.dv-groupview')
      if (!groupElement) return null

      const groups = listDockGroups(dockApi)
      const group = groups.find((candidate) => candidate?.element === groupElement)
      return group?.activePanel || null
    }

    const onDragOverCapture = (nativeEvent) => {
      const droppedSeriesId = readDroppedSeriesId(nativeEvent.dataTransfer)
      if (!droppedSeriesId) return

      const targetNode = nativeEvent?.target
      if (!targetNode || typeof targetNode?.closest !== 'function') return
      const targetPanel = resolvePanelFromNativeTarget(targetNode)
      if (!targetPanel || getPanelComponent(targetPanel) !== 'chart-canvas') return

      nativeEvent.preventDefault()
      if (nativeEvent.dataTransfer) {
        nativeEvent.dataTransfer.dropEffect = 'copy'
      }
    }

    const onDropCapture = (nativeEvent) => {
      const droppedSeriesId = readDroppedSeriesId(nativeEvent.dataTransfer)
      if (!droppedSeriesId) return

      const targetNode = nativeEvent?.target
      if (!targetNode || typeof targetNode?.closest !== 'function') return
      const targetPanel = resolvePanelFromNativeTarget(targetNode)
      if (!targetPanel || getPanelComponent(targetPanel) !== 'chart-canvas') return

      nativeEvent.preventDefault()
      nativeEvent.stopPropagation()
      routeSeriesDropToPanel(targetPanel, droppedSeriesId)
    }

    dockRoot.addEventListener('dragover', onDragOverCapture, true)
    dockRoot.addEventListener('drop', onDropCapture, true)

    return () => {
      dockRoot.removeEventListener('dragover', onDragOverCapture, true)
      dockRoot.removeEventListener('drop', onDropCapture, true)
    }
  }, [dockApi, readDroppedSeriesId, routeSeriesDropToPanel])

  return {
    readDroppedSeriesId,
    routeSeriesDropToPanel,
    openSeriesAtPosition,
    resolveDropPosition,
    onDidDrop,
  }
}
