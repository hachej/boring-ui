import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaneRegistry, createDefaultRegistry } from '../registry/panes'

const makeComponent = () => () => null

const createRegistryWithCustomPanes = () => {
  const registry = createDefaultRegistry()

  if (!registry.has('data-catalog')) {
    registry.register({
      id: 'data-catalog',
      component: makeComponent(),
      title: 'Data Catalog',
      placement: 'left',
    })
  }

  if (!registry.has('chart-canvas')) {
    registry.register({
      id: 'chart-canvas',
      component: makeComponent(),
      title: 'Chart Canvas',
      placement: 'center',
      requiresFeatures: ['files'],
    })
  }

  if (!registry.has('restricted')) {
    registry.register({
      id: 'restricted',
      component: makeComponent(),
      title: 'Restricted',
      placement: 'center',
      requiresFeatures: ['pi'],
    })
  }

  return registry
}

const createMockApi = () => {
  let groupCounter = 0
  const panelsById = new Map()
  const groupsById = new Map()
  const addPanelCalls = []
  const removePanelListeners = []

  const createGroup = () => {
    const constraints = []
    const sizes = []
    const group = {
      id: `group-${++groupCounter}`,
      panels: [],
      header: { hidden: false },
      locked: false,
      api: {
        width: 0,
        height: 0,
        setConstraints: (value) => constraints.push(value),
        setSize: (value) => sizes.push(value),
        _constraints: constraints,
        _sizes: sizes,
      },
    }
    groupsById.set(group.id, group)
    return group
  }

  const api = {
    get panels() {
      return Array.from(panelsById.values())
    },
    get groups() {
      return Array.from(groupsById.values())
    },
    addPanel(options) {
      if (panelsById.has(options.id)) {
        return panelsById.get(options.id)
      }

      addPanelCalls.push(options)

      const pos = options.position
      let group
      if (pos?.referenceGroup) {
        if (pos.direction === 'above' || pos.direction === 'below') {
          group = createGroup()
        } else {
          group = pos.referenceGroup
        }
      } else if (pos?.referencePanel) {
        const refPanel = panelsById.get(pos.referencePanel)
        if (!refPanel) return null
        group = pos.direction ? createGroup() : refPanel.group
      } else {
        group = createGroup()
      }

      const panel = {
        id: options.id,
        component: options.component,
        title: options.title,
        tabComponent: options.tabComponent,
        params: options.params || {},
        group,
        api: {
          close: () => {
            panelsById.delete(panel.id)
            if (group) {
              group.panels = group.panels.filter((p) => p.id !== panel.id)
            }
            removePanelListeners.forEach((fn) => fn({ id: panel.id }))
          },
          updateParameters: (params) => {
            panel.params = { ...panel.params, ...params }
          },
        },
      }

      group.panels.push(panel)
      panelsById.set(panel.id, panel)
      return panel
    },
    getPanel(id) {
      return panelsById.get(id) || null
    },
    getGroup(id) {
      const group = groupsById.get(id)
      if (!group) return null
      return { id: group.id, api: group.api }
    },
    onDidRemovePanel(fn) {
      removePanelListeners.push(fn)
      return { dispose: () => {} }
    },
    _addPanelCalls: addPanelCalls,
  }

  return api
}

const createHarness = ({
  config = {},
  capabilities = { features: { files: true, pty: true, chat_claude_code: true, companion: true } },
  nativeAgentEnabled = true,
  companionAgentEnabled = true,
  panelSizes = {},
  panelMin = {},
} = {}) => {
  const registry = createRegistryWithCustomPanes()
  const api = createMockApi()
  const centerGroupRef = { current: null }
  const panelSizesRef = {
    current: {
      filetree: 280,
      terminal: 400,
      companion: 400,
      shell: 250,
      'data-catalog': 310,
      'chart-canvas': 620,
      ...panelSizes,
    },
  }
  const panelMinRef = {
    current: {
      filetree: 180,
      terminal: 250,
      companion: 250,
      shell: 100,
      center: 200,
      'data-catalog': 200,
      'chart-canvas': 240,
      ...panelMin,
    },
  }

  const getDefaultParams = (id) => {
    if (id === 'filetree') {
      return {
        onOpenFile: () => {},
        onOpenFileToSide: () => {},
        onOpenDiff: () => {},
        projectRoot: '/tmp/project',
        activeFile: '/tmp/project/README.md',
        activeDiffFile: '/tmp/project/diff.md',
        collapsed: false,
        onToggleCollapse: () => {},
        userEmail: 'user@example.com',
        userMenuStatusMessage: '',
        userMenuStatusTone: '',
        onUserMenuRetry: () => {},
        userMenuDisabledActions: [],
        workspaceName: 'workspace',
        workspaceId: 'ws-1',
        onSwitchWorkspace: () => {},
        onCreateWorkspace: () => {},
        onOpenUserSettings: () => {},
        onLogout: () => {},
      }
    }

    if (id === 'shell') {
      return { collapsed: false, onToggleCollapse: () => {} }
    }

    if (id === 'companion') {
      return {
        collapsed: false,
        onToggleCollapse: () => {},
        provider: 'companion',
        lockProvider: true,
      }
    }

    return {}
  }

  const applyPanelConstraints = () => {
    registry.list().forEach((paneConfig) => {
      const panel = api.getPanel(paneConfig.id)
      const group = panel?.group
      if (!group) return

      if (paneConfig.id === 'terminal' && !nativeAgentEnabled) {
        return
      }

      const effectiveLocked = paneConfig.id === 'companion' && companionAgentEnabled
        ? true
        : paneConfig.locked
      if (typeof effectiveLocked === 'boolean') {
        group.locked = effectiveLocked
      }

      if (paneConfig.hideHeader === true) {
        group.header.hidden = true
      }

      if (paneConfig.hideHeader === false) {
        group.header.hidden = false
      }

      const minimumWidth = Number.isFinite(panelMinRef.current[paneConfig.id])
        ? panelMinRef.current[paneConfig.id]
        : paneConfig.constraints?.minWidth
      const minimumHeight = Number.isFinite(panelMinRef.current[paneConfig.id])
        ? panelMinRef.current[paneConfig.id]
        : paneConfig.constraints?.minHeight

      const constraints = {}
      if (Number.isFinite(minimumWidth)) {
        constraints.minimumWidth = minimumWidth
        constraints.maximumWidth = Number.MAX_SAFE_INTEGER
      }
      if (Number.isFinite(minimumHeight)) {
        constraints.minimumHeight = minimumHeight
        constraints.maximumHeight = Number.MAX_SAFE_INTEGER
      }
      if (Object.keys(constraints).length > 0) {
        group.api.setConstraints(constraints)
      }
    })
  }

  const applyInitialSizes = () => {
    const seen = new Set()
    api.panels.forEach((panel) => {
      const group = panel.group
      if (!group || seen.has(group.id)) return
      seen.add(group.id)

      const paneConfig = registry.get(panel.id)
      const isVertical = paneConfig?.placement === 'bottom'
      const size = panelSizesRef.current[panel.id]
      if (!Number.isFinite(size)) return

      if (isVertical) {
        const minH = panelMinRef.current[panel.id] || 0
        group.api.setSize({ height: Math.max(size, minH) })
      } else {
        group.api.setSize({ width: size })
      }
    })
  }

  const ensureCorePanels = () => {
    let filetreePanel = api.getPanel('filetree')
    if (!filetreePanel) {
      filetreePanel = api.addPanel({
        id: 'filetree',
        component: 'filetree',
        title: 'Files',
        params: getDefaultParams('filetree'),
      })
    }

    let terminalPanel = api.getPanel('terminal')
    if (nativeAgentEnabled && !terminalPanel) {
      terminalPanel = api.addPanel({
        id: 'terminal',
        component: 'terminal',
        title: 'Code Sessions',
        position: { direction: 'right', referencePanel: 'filetree' },
      })
    }

    const rightRef = terminalPanel || api.getPanel('companion')
    let emptyPanel = api.getPanel('empty-center')
    if (!emptyPanel) {
      emptyPanel = api.addPanel({
        id: 'empty-center',
        component: 'empty',
        title: '',
        position: rightRef
          ? { direction: 'left', referencePanel: rightRef.id }
          : { direction: 'right', referencePanel: 'filetree' },
      })
    }

    if (emptyPanel?.group) {
      emptyPanel.group.header.hidden = true
      centerGroupRef.current = emptyPanel.group
    }

    if (!api.getPanel('shell') && emptyPanel?.group) {
      api.addPanel({
        id: 'shell',
        component: 'shell',
        title: 'Shell',
        tabComponent: registry.get('shell')?.tabComponent,
        position: { direction: 'below', referenceGroup: emptyPanel.group },
        params: getDefaultParams('shell'),
      })
    }

    applyPanelConstraints()
    applyInitialSizes()
  }

  const buildLayoutFromConfig = () => {
    const layoutPanels = config?.defaultLayout?.panels
    if (!Array.isArray(layoutPanels)) {
      console.error('[Layout] defaultLayout.panels must be an array, falling back to stock layout')
      ensureCorePanels()
      return false
    }

    const createdPanels = new Map()
    const orderedCreated = []

    layoutPanels.forEach((entry) => {
      const id = entry?.id
      if (!id) {
        console.warn('[Layout] Invalid panel entry (missing id), skipping', entry)
        return
      }

      const paneConfig = registry.get(id)
      if (!paneConfig) {
        console.warn(`[Layout] Panel "${id}" not registered in PaneRegistry, skipping`)
        return
      }

      const existing = api.getPanel(id)
      if (existing) {
        createdPanels.set(id, existing)
        orderedCreated.push({ paneConfig, panel: existing })
        return
      }

      if (!registry.checkRequirements(id, capabilities)) {
        console.warn(`[Layout] Panel "${id}" skipped - required capabilities not available`)
        return
      }

      let position
      const ref = entry.ref
      if (ref) {
        if (!createdPanels.has(ref)) {
          console.warn(`[Layout] Panel "${id}" references unknown ref "${ref}", skipping`)
          return
        }

        const direction = entry.position
        if (direction === 'left' || direction === 'right') {
          position = { direction, referencePanel: ref }
        } else if (direction === 'above' || direction === 'below') {
          const referenceGroup = api.getPanel(ref)?.group
          if (!referenceGroup) {
            console.warn(`[Layout] Panel "${id}" references panel "${ref}" without a group, skipping`)
            return
          }
          position = { direction, referenceGroup }
        } else if (direction === 'tab') {
          position = { referencePanel: ref }
        } else {
          console.warn(`[Layout] Panel "${id}" has invalid position "${direction}", skipping`)
          return
        }
      }

      const panel = api.addPanel({
        id,
        component: id,
        title: paneConfig.title,
        tabComponent: paneConfig.tabComponent,
        position,
        params: getDefaultParams(id),
      })

      if (!panel) return
      createdPanels.set(id, panel)
      orderedCreated.push({ paneConfig, panel })
    })

    if (orderedCreated.length === 0) {
      ensureCorePanels()
      return false
    }

    const firstCenter = orderedCreated.find(
      ({ paneConfig, panel }) => paneConfig?.placement === 'center' && panel?.group,
    )?.panel

    if (firstCenter?.group) {
      centerGroupRef.current = firstCenter.group
    }

    if (firstCenter?.group && !api.getPanel('empty-center')) {
      const empty = api.addPanel({
        id: 'empty-center',
        component: 'empty',
        title: '',
        position: { referenceGroup: firstCenter.group },
      })

      if (empty?.group) {
        empty.group.header.hidden = true
        empty.group.api.setConstraints({
          minimumHeight: panelMinRef.current.center,
          maximumHeight: Number.MAX_SAFE_INTEGER,
        })
      }
    }

    applyPanelConstraints()
    applyInitialSizes()
    return true
  }

  const attachEmptyCenterRecreateHandler = () => {
    api.onDidRemovePanel(() => {
      const existingEmpty = api.getPanel('empty-center')
      if (existingEmpty) return

      const hasEditors = api.panels.some((p) => p.id.startsWith('editor-'))
      const hasReviews = api.panels.some((p) => p.id.startsWith('review-'))
      if (hasEditors || hasReviews) return

      const shellPanel = api.getPanel('shell')
      let emptyPanel
      if (centerGroupRef.current && centerGroupRef.current.panels?.length > 0) {
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: { referenceGroup: centerGroupRef.current },
        })
      } else if (shellPanel?.group) {
        emptyPanel = api.addPanel({
          id: 'empty-center',
          component: 'empty',
          title: '',
          position: { direction: 'above', referenceGroup: shellPanel.group },
        })
      }

      if (emptyPanel?.group) {
        centerGroupRef.current = emptyPanel.group
        emptyPanel.group.header.hidden = true
      }
    })
  }

  return {
    api,
    registry,
    centerGroupRef,
    ensureCorePanels,
    buildLayoutFromConfig,
    attachEmptyCenterRecreateHandler,
    getDefaultParams,
  }
}

const runInitialBuilder = ({ harness, hasSavedLayout = false, invalidLayoutFound = false }) => {
  const hasConfigPanels = harness ? true : false
  if (!hasSavedLayout || invalidLayoutFound) {
    if (hasConfigPanels) {
      return harness.buildLayoutFromConfig()
    }
  }
  return null
}

describe('configurable layout builder', () => {
  let warnSpy
  let errorSpy

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('1) no defaultLayout falls back to stock ensureCorePanels layout', () => {
    const harness = createHarness({ config: {} })
    harness.ensureCorePanels()

    expect(harness.api.getPanel('filetree')).toBeTruthy()
    expect(harness.api.getPanel('terminal')).toBeTruthy()
    expect(harness.api.getPanel('shell')).toBeTruthy()
    expect(harness.api.getPanel('empty-center')).toBeTruthy()
  })

  it('2) builds a 5-panel custom layout in configured order', () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [
            { id: 'data-catalog' },
            { id: 'chart-canvas', position: 'right', ref: 'data-catalog' },
            { id: 'filetree', position: 'below', ref: 'data-catalog' },
            { id: 'companion', position: 'right', ref: 'chart-canvas' },
            { id: 'shell', position: 'below', ref: 'chart-canvas' },
          ],
        },
      },
    })

    const built = harness.buildLayoutFromConfig()

    expect(built).toBe(true)
    expect(harness.api._addPanelCalls.slice(0, 5).map((call) => call.id)).toEqual([
      'data-catalog',
      'chart-canvas',
      'filetree',
      'companion',
      'shell',
    ])
  })

  it("3) 'below' position uses referenceGroup", () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [
            { id: 'chart-canvas' },
            { id: 'shell', position: 'below', ref: 'chart-canvas' },
          ],
        },
      },
    })

    harness.buildLayoutFromConfig()
    const shellCall = harness.api._addPanelCalls.find((call) => call.id === 'shell')

    expect(shellCall.position.direction).toBe('below')
    expect(shellCall.position.referenceGroup).toBe(harness.api.getPanel('chart-canvas').group)
    expect(shellCall.position.referencePanel).toBeUndefined()
  })

  it("4) 'tab' position shares the reference panel group", () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [
            { id: 'filetree' },
            { id: 'data-catalog', position: 'tab', ref: 'filetree' },
          ],
        },
      },
    })

    harness.buildLayoutFromConfig()

    expect(harness.api.getPanel('filetree').group.id).toBe(harness.api.getPanel('data-catalog').group.id)
  })

  it('5) invalid ref skips panel and logs warning', () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [
            { id: 'filetree' },
            { id: 'chart-canvas', position: 'right', ref: 'missing-ref' },
            { id: 'shell', position: 'below', ref: 'filetree' },
          ],
        },
      },
    })

    harness.buildLayoutFromConfig()

    expect(harness.api.getPanel('chart-canvas')).toBeNull()
    expect(harness.api.getPanel('shell')).toBeTruthy()
    expect(warnSpy).toHaveBeenCalledWith('[Layout] Panel "chart-canvas" references unknown ref "missing-ref", skipping')
  })

  it('6) unregistered panel IDs are skipped with warning', () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [{ id: 'unknown-panel' }, { id: 'filetree' }],
        },
      },
    })

    harness.buildLayoutFromConfig()

    expect(harness.api.getPanel('unknown-panel')).toBeNull()
    expect(harness.api.getPanel('filetree')).toBeTruthy()
    expect(warnSpy).toHaveBeenCalledWith('[Layout] Panel "unknown-panel" not registered in PaneRegistry, skipping')
  })

  it('7) unmet capability requirements skip panel with warning', () => {
    const harness = createHarness({
      capabilities: { features: { files: true, pty: true, chat_claude_code: true } },
      config: {
        defaultLayout: {
          panels: [{ id: 'filetree' }, { id: 'restricted', position: 'right', ref: 'filetree' }],
        },
      },
    })

    harness.buildLayoutFromConfig()

    expect(harness.api.getPanel('restricted')).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('[Layout] Panel "restricted" skipped - required capabilities not available')
  })

  it('8) core panels receive runtime params from getDefaultParams()', () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [
            { id: 'filetree' },
            { id: 'shell', position: 'below', ref: 'filetree' },
            { id: 'companion', position: 'right', ref: 'filetree' },
          ],
        },
      },
    })

    harness.buildLayoutFromConfig()

    const filetreeParams = harness.api.getPanel('filetree').params
    const shellParams = harness.api.getPanel('shell').params
    const companionParams = harness.api.getPanel('companion').params

    expect(filetreeParams.workspaceId).toBe('ws-1')
    expect(filetreeParams.projectRoot).toBe('/tmp/project')
    expect(shellParams.collapsed).toBe(false)
    expect(typeof shellParams.onToggleCollapse).toBe('function')
    expect(companionParams.provider).toBe('companion')
    expect(companionParams.lockProvider).toBe(true)
  })

  it('9) panels.defaults sizing is applied for custom panel IDs', () => {
    const harness = createHarness({
      panelSizes: { 'data-catalog': 333 },
      config: {
        defaultLayout: {
          panels: [{ id: 'data-catalog' }],
        },
      },
    })

    harness.buildLayoutFromConfig()
    const group = harness.api.getPanel('data-catalog').group

    expect(group.api._sizes).toContainEqual({ width: 333 })
  })

  it('10) saved layout presence takes priority over defaultLayout builder', () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [{ id: 'filetree' }, { id: 'chart-canvas', position: 'right', ref: 'filetree' }],
        },
      },
    })

    runInitialBuilder({ harness, hasSavedLayout: true, invalidLayoutFound: false })

    expect(harness.api._addPanelCalls).toHaveLength(0)
  })

  it('11) centerGroupRef is set from first center panel and new editors can target it', () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [{ id: 'chart-canvas' }, { id: 'filetree', position: 'left', ref: 'chart-canvas' }],
        },
      },
    })

    harness.buildLayoutFromConfig()

    const centerGroup = harness.centerGroupRef.current
    expect(centerGroup).toBe(harness.api.getPanel('chart-canvas').group)

    const editor = harness.api.addPanel({
      id: 'editor-readme',
      component: 'editor',
      title: 'Editor',
      position: { referenceGroup: centerGroup },
    })
    expect(editor.group.id).toBe(centerGroup.id)
  })

  it('12) empty-center is recreated when all editors close in custom layout', () => {
    const harness = createHarness({
      config: {
        defaultLayout: {
          panels: [{ id: 'chart-canvas' }, { id: 'shell', position: 'below', ref: 'chart-canvas' }],
        },
      },
    })

    harness.attachEmptyCenterRecreateHandler()
    harness.buildLayoutFromConfig()

    const existingEmpty = harness.api.getPanel('empty-center')
    existingEmpty.api.close()

    const editor = harness.api.addPanel({
      id: 'editor-readme',
      component: 'editor',
      title: 'Editor',
      position: { referenceGroup: harness.centerGroupRef.current },
    })

    expect(harness.api.getPanel('empty-center')).toBeNull()
    editor.api.close()

    expect(harness.api.getPanel('empty-center')).toBeTruthy()
  })

  it('13) invalid defaultLayout.panels type logs error and falls back to core layout', () => {
    const harness = createHarness({
      config: { defaultLayout: { panels: { id: 'filetree' } } },
    })

    const built = harness.buildLayoutFromConfig()

    expect(built).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('[Layout] defaultLayout.panels must be an array, falling back to stock layout')
    expect(harness.api.getPanel('filetree')).toBeTruthy()
    expect(harness.api.getPanel('shell')).toBeTruthy()
  })

  it('registers custom panes in a mock PaneRegistry', () => {
    const registry = new PaneRegistry()
    registry.register({
      id: 'data-catalog',
      component: makeComponent(),
      title: 'Data Catalog',
      placement: 'left',
    })
    registry.register({
      id: 'chart-canvas',
      component: makeComponent(),
      title: 'Chart Canvas',
      placement: 'center',
    })

    expect(registry.has('data-catalog')).toBe(true)
    expect(registry.has('chart-canvas')).toBe(true)
  })
})
