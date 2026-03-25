import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import usePanelActions from '../../hooks/usePanelActions'
import { PI_LIST_TABS_BRIDGE, PI_OPEN_PANEL_BRIDGE } from '../../providers/pi/uiBridge'

vi.mock('../../utils/transport', () => ({
  apiFetchJson: vi.fn(),
}))

vi.mock('../../utils/frontendState', () => ({
  getFrontendStateClientId: vi.fn((prefix) => `client-${prefix}`),
}))

vi.mock('../../utils/editorFiles', () => ({
  getEditorPanelComponent: vi.fn(() => 'editor'),
  getMarkdownEditorParam: vi.fn(() => 'rich-text'),
  isMarkdownFile: vi.fn((path) => path.endsWith('.md')),
}))

vi.mock('../../layout', () => ({
  getFileName: vi.fn((path) => path.split('/').pop() || path),
}))

const makePanel = (id, params = {}) => ({
  id,
  params,
  api: {
    updateParameters: vi.fn(),
    setActive: vi.fn(),
    setTitle: vi.fn(),
  },
  group: {
    id: `${id}-group`,
    header: { hidden: false },
    api: {
      setConstraints: vi.fn(),
      setSize: vi.fn(),
    },
  },
})

const makeHookProps = (overrides = {}) => ({
  dockApi: {
    getPanel: vi.fn(() => null),
    addPanel: vi.fn(() => null),
    activePanel: null,
    panels: [],
  },
  centerGroupRef: { current: null },
  panelMinRef: { current: { center: 200 } },
  markdownPane: 'rich-text',
  queryClient: { fetchQuery: vi.fn().mockResolvedValue('file contents') },
  dataProvider: { files: { read: vi.fn().mockResolvedValue('file contents') } },
  tabs: { 'README.md': { content: 'hello', isDirty: false } },
  activeFile: 'README.md',
  setTabs: vi.fn(),
  setActiveDiffFile: vi.fn(),
  uiStateFeatureEnabled: true,
  frontendStateUnavailableRef: { current: false },
  frontendCommandUnavailableRef: { current: false },
  frontendStateClientIdRef: { current: '' },
  storagePrefixRef: { current: 'boring-ui' },
  publishFrontendState: vi.fn().mockResolvedValue(true),
  getLeftSidebarAnchorPosition: vi.fn(() => ({ direction: 'right', referencePanel: 'filetree' })),
  getLiveCenterGroup: vi.fn(() => null),
  findCenterAnchorPanel: vi.fn(() => null),
  isLeftSidebarGroup: vi.fn(() => false),
  ...overrides,
})

describe('usePanelActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete window[PI_OPEN_PANEL_BRIDGE]
    delete window[PI_LIST_TABS_BRIDGE]
  })

  it('reuses an existing markdown editor panel when opening a file', async () => {
    const existingPanel = makePanel('editor-README.md')
    const dockApi = {
      getPanel: vi.fn((id) => (id === 'editor-README.md' ? existingPanel : null)),
      addPanel: vi.fn(),
      activePanel: null,
      panels: [],
    }

    const { result } = renderHook(() => usePanelActions(makeHookProps({ dockApi })))

    await act(async () => {
      const opened = result.current.openFile('README.md')
      expect(opened).toBe(true)
    })

    expect(existingPanel.api.updateParameters).toHaveBeenCalledWith({ markdownEditor: 'rich-text' })
    expect(existingPanel.api.setActive).toHaveBeenCalledTimes(1)
    expect(dockApi.addPanel).not.toHaveBeenCalled()
  })

  it('reuses an existing generic panel and updates its params', () => {
    const existingPanel = makePanel('catalog-panel')
    const dockApi = {
      getPanel: vi.fn((id) => (id === 'catalog-panel' ? existingPanel : null)),
      addPanel: vi.fn(),
      activePanel: null,
      panels: [],
    }

    const { result } = renderHook(() => usePanelActions(makeHookProps({ dockApi })))

    const opened = result.current.openPanel({
      id: 'catalog-panel',
      component: 'data-catalog',
      params: { mode: 'search' },
    })

    expect(opened).toBe(true)
    expect(existingPanel.api.updateParameters).toHaveBeenCalledWith({ mode: 'search' })
    expect(existingPanel.api.setActive).toHaveBeenCalledTimes(1)
    expect(dockApi.addPanel).not.toHaveBeenCalled()
  })

  it('updates an existing editor to diff mode when opening a diff', () => {
    const existingPanel = makePanel('editor-src/app.js')
    const dockApi = {
      getPanel: vi.fn((id) => (id === 'editor-src/app.js' ? existingPanel : null)),
      addPanel: vi.fn(),
      activePanel: null,
      panels: [],
    }

    const setActiveDiffFile = vi.fn()
    const { result } = renderHook(() => usePanelActions(
      makeHookProps({ dockApi, setActiveDiffFile }),
    ))

    act(() => {
      result.current.openDiff('src/app.js')
    })

    expect(existingPanel.api.updateParameters).toHaveBeenCalledWith({ initialMode: 'git-diff' })
    expect(existingPanel.api.setActive).toHaveBeenCalledTimes(1)
    expect(setActiveDiffFile).toHaveBeenCalledWith('src/app.js')
  })

  it('registers and cleans up PI bridge helpers', () => {
    const addedPanel = makePanel('custom-panel')
    const centerGroup = {
      id: 'center-group',
      header: { hidden: false },
      api: { setConstraints: vi.fn() },
    }
    const dockApi = {
      getPanel: vi.fn(() => null),
      addPanel: vi.fn(() => addedPanel),
      activePanel: null,
      panels: [],
    }

    const { unmount } = renderHook(() => usePanelActions(makeHookProps({
      dockApi,
      getLiveCenterGroup: vi.fn(() => centerGroup),
    })))

    expect(typeof window[PI_OPEN_PANEL_BRIDGE]).toBe('function')
    expect(window[PI_LIST_TABS_BRIDGE]()).toEqual({
      activeFile: 'README.md',
      tabs: ['README.md'],
    })

    act(() => {
      window[PI_OPEN_PANEL_BRIDGE]({
        id: 'custom-panel',
        component: 'review',
        params: { requestId: 'req-1' },
      })
    })

    expect(dockApi.addPanel).toHaveBeenCalledTimes(1)

    unmount()

    expect(window[PI_OPEN_PANEL_BRIDGE]).toBeUndefined()
    expect(window[PI_LIST_TABS_BRIDGE]).toBeUndefined()
  })

  it('consumes focus_panel commands and publishes updated frontend state', async () => {
    const { apiFetchJson } = await import('../../utils/transport')
    const targetPanel = makePanel('review-1')
    const dockApi = {
      getPanel: vi.fn((id) => (id === 'review-1' ? targetPanel : null)),
      addPanel: vi.fn(),
      activePanel: null,
      panels: [],
    }
    const publishFrontendState = vi.fn().mockResolvedValue(true)
    apiFetchJson.mockResolvedValueOnce({
      response: { ok: true, status: 200 },
      data: {
        command: { kind: 'focus_panel', panel_id: 'review-1' },
      },
    })

    const { result } = renderHook(() => usePanelActions(
      makeHookProps({ dockApi, publishFrontendState }),
    ))

    let consumed = false
    await act(async () => {
      consumed = await result.current.consumeNextFrontendCommand()
    })

    expect(consumed).toBe(true)
    expect(targetPanel.api.setActive).toHaveBeenCalledTimes(1)
    expect(publishFrontendState).toHaveBeenCalledWith(dockApi)
    expect(apiFetchJson).toHaveBeenCalledWith('/api/v1/ui/commands/next', {
      query: { client_id: 'client-boring-ui' },
    })
  })

  it('marks frontend commands unavailable after a 404 response', async () => {
    const { apiFetchJson } = await import('../../utils/transport')
    apiFetchJson.mockResolvedValueOnce({
      response: { ok: false, status: 404 },
      data: {},
    })

    const frontendCommandUnavailableRef = { current: false }
    const { result } = renderHook(() => usePanelActions(
      makeHookProps({ frontendCommandUnavailableRef }),
    ))

    let consumed = true
    await act(async () => {
      consumed = await result.current.consumeNextFrontendCommand()
    })

    expect(consumed).toBe(false)
    expect(frontendCommandUnavailableRef.current).toBe(true)
  })
})
