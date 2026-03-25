import { useCallback, useEffect } from 'react'
import { getFileName } from '../layout'
import { queryKeys } from '../providers/data'
import {
  isMarkdownFile,
  getEditorPanelComponent,
  getMarkdownEditorParam,
} from '../utils/editorFiles'
import {
  PI_LIST_TABS_BRIDGE,
  PI_OPEN_FILE_BRIDGE,
  PI_OPEN_PANEL_BRIDGE,
} from '../providers/pi/uiBridge'
import { apiFetchJson } from '../utils/transport'
import { routes } from '../utils/routes'
import { getFrontendStateClientId } from '../utils/frontendState'

export default function usePanelActions({
  dockApi,
  centerGroupRef,
  panelMinRef,
  markdownPane,
  queryClient,
  dataProvider,
  tabs,
  activeFile,
  setTabs,
  setActiveDiffFile,
  uiStateFeatureEnabled,
  frontendStateUnavailableRef,
  frontendCommandUnavailableRef,
  frontendStateClientIdRef,
  storagePrefixRef,
  publishFrontendState,
  frontendCommandPollIntervalMs = 0,
  getLeftSidebarAnchorPosition,
  getLiveCenterGroup,
  findCenterAnchorPanel,
  isLeftSidebarGroup,
}) {
  const openFileAtPosition = useCallback((path, position, extraParams = {}) => {
    if (!dockApi) return

    const panelId = `editor-${path}`
    const existingPanel = dockApi.getPanel(panelId)
    const markdownEditor = getMarkdownEditorParam(path, markdownPane)

    if (existingPanel) {
      const nextParams = isMarkdownFile(path)
        ? { ...extraParams, markdownEditor }
        : { ...extraParams }
      if (Object.keys(nextParams).length > 0) {
        existingPanel.api.updateParameters(nextParams)
      }
      existingPanel.api.setActive()
      return
    }

    const addEditorPanel = (content) => {
      const panelComponent = getEditorPanelComponent(path, markdownPane)
      const centerGroup = getLiveCenterGroup(dockApi)
      if (centerGroup) {
        centerGroup.header.hidden = false
      }

      const resolveRetryPosition = () => {
        const liveCenterGroup = getLiveCenterGroup(dockApi)
        if (liveCenterGroup) return { referenceGroup: liveCenterGroup }

        const centerAnchorPanel = findCenterAnchorPanel(dockApi)
        if (centerAnchorPanel?.group) {
          return { referenceGroup: centerAnchorPanel.group }
        }

        const liveEmptyPanel = dockApi.getPanel('empty-center')
        if (liveEmptyPanel?.group) {
          return { referenceGroup: liveEmptyPanel.group }
        }

        return getLeftSidebarAnchorPosition(dockApi)
      }

      const panelParams = {
        path,
        initialContent: content,
        contentVersion: 1,
        ...extraParams,
        onContentChange: (filePath, newContent) => {
          setTabs((prev) => ({
            ...prev,
            [filePath]: { ...prev[filePath], content: newContent },
          }))
        },
        onDirtyChange: (filePath, dirty) => {
          setTabs((prev) => ({
            ...prev,
            [filePath]: { ...prev[filePath], isDirty: dirty },
          }))
          const panel = dockApi.getPanel(`editor-${filePath}`)
          if (panel) {
            panel.api.setTitle(getFileName(filePath) + (dirty ? ' *' : ''))
          }
        },
      }
      if (isMarkdownFile(path)) {
        panelParams.markdownEditor = markdownEditor
      }

      let panel = dockApi.addPanel({
        id: panelId,
        component: panelComponent,
        title: getFileName(path),
        position,
        params: panelParams,
      })

      if (!panel) {
        panel = dockApi.addPanel({
          id: panelId,
          component: panelComponent,
          title: getFileName(path),
          position: resolveRetryPosition(),
          params: panelParams,
        })
      }

      if (!panel) {
        panel = dockApi.addPanel({
          id: panelId,
          component: panelComponent,
          title: getFileName(path),
          params: panelParams,
        })
      }

      if (!panel) return

      setTabs((prev) => ({
        ...prev,
        [path]: { content, isDirty: false },
      }))

      const emptyPanel = dockApi.getPanel('empty-center')
      if (emptyPanel) {
        emptyPanel.api.close()
      }
      if (panel?.group) {
        panel.group.header.hidden = false
        centerGroupRef.current = panel.group
        panel.group.api.setConstraints({
          minimumHeight: panelMinRef.current.center,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
      }
      panel.api.setActive()
    }

    queryClient.fetchQuery({
      queryKey: queryKeys.files.read(path),
      queryFn: ({ signal }) => dataProvider.files.read(path, { signal }),
    })
      .then((content) => {
        addEditorPanel(typeof content === 'string' ? content : '')
      })
      .catch(() => {
        addEditorPanel('')
      })
  }, [
    centerGroupRef,
    dataProvider,
    dockApi,
    findCenterAnchorPanel,
    getLeftSidebarAnchorPosition,
    getLiveCenterGroup,
    markdownPane,
    panelMinRef,
    queryClient,
    setTabs,
  ])

  const openFile = useCallback((path) => {
    if (!dockApi) return false

    const panelId = `editor-${path}`
    const existingPanel = dockApi.getPanel(panelId)
    const markdownEditor = getMarkdownEditorParam(path, markdownPane)

    if (existingPanel) {
      if (isMarkdownFile(path)) {
        existingPanel.api.updateParameters({ markdownEditor })
      }
      existingPanel.api.setActive()
      return true
    }

    const emptyPanel = dockApi.getPanel('empty-center')
    const centerGroup = getLiveCenterGroup(dockApi)
    const existingCenterPanel = findCenterAnchorPanel(dockApi)

    let position
    if (centerGroup) {
      position = { referenceGroup: centerGroup }
    } else if (existingCenterPanel?.group) {
      position = { referenceGroup: existingCenterPanel.group }
    } else if (emptyPanel?.group) {
      position = { referenceGroup: emptyPanel.group }
    } else {
      position = getLeftSidebarAnchorPosition(dockApi)
    }

    openFileAtPosition(path, position)
    return true
  }, [
    dockApi,
    findCenterAnchorPanel,
    getLiveCenterGroup,
    getLeftSidebarAnchorPosition,
    markdownPane,
    openFileAtPosition,
  ])

  const openPanel = useCallback((rawPayload) => {
    if (!dockApi) return false
    const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {}

    const id = String(payload.id || '').trim()
    const component = String(payload.component || '').trim()
    if (!id || !component) return false

    const title = String(payload.title || id)
    const panelParams = payload.params && typeof payload.params === 'object'
      ? payload.params
      : {}

    const existingPanel = dockApi.getPanel(id)
    if (existingPanel) {
      if (Object.keys(panelParams).length > 0) {
        existingPanel.api.updateParameters(panelParams)
      }
      existingPanel.api.setActive()
      return true
    }

    const emptyPanel = dockApi.getPanel('empty-center')
    const agentPanel = dockApi.getPanel('agent')
    const centerGroup = getLiveCenterGroup(dockApi)
    const existingCenterPanel = findCenterAnchorPanel(dockApi)

    let position = payload.position && typeof payload.position === 'object'
      ? payload.position
      : null

    if (!position) {
      if (centerGroup) {
        position = { referenceGroup: centerGroup }
      } else if (existingCenterPanel?.group) {
        position = { referenceGroup: existingCenterPanel.group }
      } else if (emptyPanel?.group) {
        position = { referenceGroup: emptyPanel.group }
      } else if (agentPanel) {
        position = { direction: 'left', referencePanel: agentPanel.id }
      } else {
        position = getLeftSidebarAnchorPosition(dockApi)
      }
    }

    const panel = dockApi.addPanel({
      id,
      component,
      title,
      position,
      params: panelParams,
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
        if (staleEmpty) staleEmpty.api.close()
      })
    }

    return true
  }, [
    centerGroupRef,
    dockApi,
    findCenterAnchorPanel,
    getLeftSidebarAnchorPosition,
    getLiveCenterGroup,
    panelMinRef,
  ])

  const getCommandPanelPosition = useCallback((api) => {
    const emptyPanel = api.getPanel('empty-center')
    if (emptyPanel?.group) {
      return { referenceGroup: emptyPanel.group }
    }

    const centerGroup = getLiveCenterGroup(api)
    if (centerGroup) {
      return { referenceGroup: centerGroup }
    }

    return getLeftSidebarAnchorPosition(api)
  }, [getLeftSidebarAnchorPosition, getLiveCenterGroup])

  const openGenericPanelFromCommand = useCallback((api, command) => {
    const component = typeof command?.component === 'string' ? command.component.trim() : ''
    if (!component) return false

    const requestedId = typeof command?.panel_id === 'string' ? command.panel_id.trim() : ''
    const requestedTitle = typeof command?.title === 'string' ? command.title.trim() : ''
    const panelTitle = requestedTitle || component
    const params = command?.params && typeof command.params === 'object' && !Array.isArray(command.params)
      ? command.params
      : {}
    const preferExisting = command?.prefer_existing !== false

    const baseId = requestedId || `cmd-${component}-${Date.now().toString(36)}`
    const existingPanel = preferExisting ? api.getPanel(baseId) : null
    if (existingPanel) {
      if (Object.keys(params).length > 0) {
        existingPanel.api.updateParameters(params)
      }
      existingPanel.api.setActive()
      return true
    }

    const panelId = api.getPanel(baseId) ? `${baseId}-${Date.now().toString(36)}` : baseId
    const position = getCommandPanelPosition(api)
    const panel = api.addPanel({
      id: panelId,
      component,
      title: panelTitle,
      position,
      params,
    })
    if (!panel) return false

    const emptyPanel = api.getPanel('empty-center')
    if (emptyPanel && emptyPanel.id !== panelId) {
      emptyPanel.api.close()
    }

    if (panel?.group) {
      panel.group.header.hidden = false
      centerGroupRef.current = panel.group
      panel.group.api.setConstraints({
        minimumHeight: panelMinRef.current.center,
        maximumHeight: Number.MAX_SAFE_INTEGER,
      })
    }
    panel.api.setActive()
    return true
  }, [centerGroupRef, getCommandPanelPosition, panelMinRef])

  const executeFrontendCommand = useCallback(async (api, commandEnvelope) => {
    if (!api || !commandEnvelope || typeof commandEnvelope !== 'object') return false
    const command = commandEnvelope.command && typeof commandEnvelope.command === 'object'
      ? commandEnvelope.command
      : commandEnvelope
    const kind = typeof command?.kind === 'string' ? command.kind.trim() : ''
    if (!kind) return false

    if (kind === 'focus_panel') {
      const panelId = typeof command?.panel_id === 'string' ? command.panel_id.trim() : ''
      if (!panelId) return false
      const panel = api.getPanel(panelId)
      if (!panel) return false
      panel.api.setActive()
      await publishFrontendState(api)
      return true
    }

    if (kind === 'open_panel') {
      const opened = openGenericPanelFromCommand(api, command)
      if (opened) {
        await publishFrontendState(api)
      }
      return opened
    }

    return false
  }, [openGenericPanelFromCommand, publishFrontendState])

  const consumeNextFrontendCommand = useCallback(async (api) => {
    const targetApi = api || dockApi
    if (!targetApi) return false
    if (!uiStateFeatureEnabled) return false
    if (frontendStateUnavailableRef.current || frontendCommandUnavailableRef.current) {
      return false
    }
    if (!frontendStateClientIdRef.current) {
      frontendStateClientIdRef.current = getFrontendStateClientId(storagePrefixRef.current)
    }

    const route = routes.uiState.commands.next(frontendStateClientIdRef.current)
    try {
      const { response, data } = await apiFetchJson(route.path, { query: route.query })
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          frontendCommandUnavailableRef.current = true
        }
        return false
      }
      if (!data?.command) return false
      return executeFrontendCommand(targetApi, data.command)
    } catch {
      return false
    }
  }, [
    dockApi,
    executeFrontendCommand,
    frontendCommandUnavailableRef,
    frontendStateClientIdRef,
    frontendStateUnavailableRef,
    storagePrefixRef,
    uiStateFeatureEnabled,
  ])

  useEffect(() => {
    if (!dockApi || !uiStateFeatureEnabled || frontendCommandPollIntervalMs <= 0) return

    let isDisposed = false
    let timeoutId = null
    const pollLoop = async () => {
      while (!isDisposed) {
        await consumeNextFrontendCommand(dockApi)
        if (isDisposed) break
        await new Promise((resolve) => {
          timeoutId = window.setTimeout(resolve, frontendCommandPollIntervalMs)
        })
        timeoutId = null
      }
    }

    void pollLoop()

    return () => {
      isDisposed = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [
    consumeNextFrontendCommand,
    dockApi,
    frontendCommandPollIntervalMs,
    uiStateFeatureEnabled,
  ])

  useEffect(() => {
    const openFileBridge = (path) => openFile(String(path || '').trim())
    const openPanelBridge = (payload) => openPanel(payload)
    const listTabsBridge = () => ({
      activeFile: activeFile || '',
      tabs: Object.keys(tabs),
    })

    window[PI_OPEN_FILE_BRIDGE] = openFileBridge
    window[PI_OPEN_PANEL_BRIDGE] = openPanelBridge
    window[PI_LIST_TABS_BRIDGE] = listTabsBridge

    return () => {
      if (window[PI_OPEN_FILE_BRIDGE] === openFileBridge) {
        delete window[PI_OPEN_FILE_BRIDGE]
      }
      if (window[PI_OPEN_PANEL_BRIDGE] === openPanelBridge) {
        delete window[PI_OPEN_PANEL_BRIDGE]
      }
      if (window[PI_LIST_TABS_BRIDGE] === listTabsBridge) {
        delete window[PI_LIST_TABS_BRIDGE]
      }
    }
  }, [activeFile, openFile, openPanel, tabs])

  const openFileToSide = useCallback((path) => {
    if (!dockApi) return

    const panelId = `editor-${path}`
    const existingPanel = dockApi.getPanel(panelId)

    if (existingPanel) {
      existingPanel.api.setActive()
      return
    }

    const activePanel = dockApi.activePanel
    const centerGroup = getLiveCenterGroup(dockApi)
    let position

    if (activePanel && activePanel.id.startsWith('editor-') && !isLeftSidebarGroup(activePanel.group)) {
      position = { direction: 'right', referencePanel: activePanel.id }
    } else if (centerGroup) {
      const anchorPanelId = centerGroup.activePanel?.id || centerGroup.panels?.[0]?.id
      if (anchorPanelId) {
        position = { direction: 'right', referencePanel: anchorPanelId }
      } else {
        position = { referenceGroup: centerGroup }
      }
    } else {
      position = getLeftSidebarAnchorPosition(dockApi)
    }

    openFileAtPosition(path, position)
  }, [
    dockApi,
    getLeftSidebarAnchorPosition,
    getLiveCenterGroup,
    isLeftSidebarGroup,
    openFileAtPosition,
  ])

  const openDiff = useCallback((path) => {
    if (!dockApi) return

    const panelId = `editor-${path}`
    const existingPanel = dockApi.getPanel(panelId)

    if (existingPanel) {
      existingPanel.api.updateParameters({ initialMode: 'git-diff' })
      existingPanel.api.setActive()
      setActiveDiffFile(path)
      return
    }

    const emptyPanel = dockApi.getPanel('empty-center')
    const centerGroup = getLiveCenterGroup(dockApi)

    let position
    if (emptyPanel?.group) {
      position = { referenceGroup: emptyPanel.group }
    } else if (centerGroup) {
      position = { referenceGroup: centerGroup }
    } else {
      position = getLeftSidebarAnchorPosition(dockApi)
    }

    openFileAtPosition(path, position, { initialMode: 'git-diff' })
    setActiveDiffFile(path)
  }, [
    dockApi,
    getLeftSidebarAnchorPosition,
    getLiveCenterGroup,
    openFileAtPosition,
    setActiveDiffFile,
  ])

  return {
    openFileAtPosition,
    openFile,
    openPanel,
    openFileToSide,
    openDiff,
    consumeNextFrontendCommand,
  }
}
