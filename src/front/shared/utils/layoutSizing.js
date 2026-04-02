/**
 * Applies initial panel sizes and constraints to dockview groups
 * based on saved/default sizes and collapsed state.
 *
 * Called during layout initialization and restoration.
 */
export function applyInitialSizes(
  api,
  panelSizesRefArg,
  panelMinRefArg,
  panelCollapsedRefArg,
  collapsedState,
  registry,
) {
  requestAnimationFrame(() => {
    const paneConfigs = typeof registry?.list === 'function' ? registry.list() : []
    const seenGroups = new Set()

    paneConfigs.forEach((paneConfig) => {
      const panelId = paneConfig?.id
      if (!panelId) return

      const defaultSize = panelSizesRefArg?.current?.[panelId]
      if (!Number.isFinite(defaultSize)) return

      const panel = api.getPanel(panelId)
      const group = panel?.group
      if (!group || seenGroups.has(group.id)) return
      seenGroups.add(group.id)

      const groupApi = api.getGroup(group.id)?.api
      if (!groupApi) return

      const collapsedSize = panelCollapsedRefArg?.current?.[panelId]
      const minSize = panelMinRefArg?.current?.[panelId]
      const isCollapsed = !!collapsedState?.[panelId]
      const sizeAxis = paneConfig?.placement === 'bottom' ? 'height' : 'width'

      if (isCollapsed && Number.isFinite(collapsedSize)) {
        if (sizeAxis === 'height') {
          groupApi.setConstraints({
            minimumHeight: collapsedSize,
            maximumHeight: collapsedSize,
          })
          groupApi.setSize({ height: collapsedSize })
        } else {
          groupApi.setConstraints({
            minimumWidth: collapsedSize,
            maximumWidth: collapsedSize,
          })
          groupApi.setSize({ width: collapsedSize })
        }
        return
      }

      const size = Number.isFinite(minSize)
        ? Math.max(defaultSize, minSize)
        : defaultSize
      if (sizeAxis === 'height') {
        if (Number.isFinite(minSize)) {
          groupApi.setConstraints({
            minimumHeight: minSize,
            maximumHeight: Number.MAX_SAFE_INTEGER,
          })
        }
        groupApi.setSize({ height: size })
        return
      }

      if (Number.isFinite(minSize)) {
        groupApi.setConstraints({
          minimumWidth: minSize,
          maximumWidth: Number.MAX_SAFE_INTEGER,
        })
      }
      groupApi.setSize({ width: size })
    })
  })
}
