import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import useDockLayout from '../../hooks/useDockLayout'

function makeDeps(overrides = {}) {
  return {
    dockApi: null,
    leftSidebarPanelIds: ['filetree', 'data-catalog'],
    collapsed: { filetree: false, agent: false },
    setCollapsed: vi.fn(),
    panelSizesRef: { current: {} },
    storagePrefixRef: { current: 'test' },
    centerGroupRef: { current: null },
    leftSidebarCollapsedWidth: 48,
    panelCollapsedRef: { current: { agent: 48 } },
    sidebarToggleHostId: 'filetree',
    saveCollapsedState: vi.fn(),
    savePanelSizes: vi.fn(),
    ...overrides,
  }
}

function makeGroup(id, height = 220) {
  return {
    id,
    panels: [],
    api: {
      width: 280,
      height,
      setConstraints: vi.fn(),
      setSize: vi.fn(),
    },
  }
}

function makePanel(id, group) {
  const panel = {
    id,
    group,
    api: {
      setActive: vi.fn(),
    },
  }
  group.panels = [...(group.panels || []), panel]
  return panel
}

describe('useDockLayout', () => {
  it('returns all layout helper functions', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps()))
    expect(typeof result.current.getLeftSidebarGroups).toBe('function')
    expect(typeof result.current.getLeftSidebarAnchorPanelId).toBe('function')
    expect(typeof result.current.getLeftSidebarAnchorPosition).toBe('function')
    expect(typeof result.current.isLeftSidebarGroup).toBe('function')
    expect(typeof result.current.findCenterAnchorPanel).toBe('function')
    expect(typeof result.current.getLiveCenterGroup).toBe('function')
    expect(typeof result.current.toggleFiletree).toBe('function')
    expect(typeof result.current.toggleAgent).toBe('function')
    expect(typeof result.current.getSidebarCollapsedHeight).toBe('function')
    expect(typeof result.current.getSidebarExpandedMinHeight).toBe('function')
    expect(typeof result.current.toggleSectionCollapse).toBe('function')
    expect(typeof result.current.activateSidebarPanel).toBe('function')
  })

  it('defaults the active sidebar selection to the first configured panel', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps({
      leftSidebarPanelIds: ['data-catalog', 'filetree'],
    })))

    expect(result.current.activeSidebarPanelId).toBe('data-catalog')
  })

  it('getLeftSidebarGroups returns empty for null api', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps()))
    expect(result.current.getLeftSidebarGroups(null)).toEqual([])
  })

  it('getLeftSidebarAnchorPanelId returns filetree as default', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps()))
    expect(result.current.getLeftSidebarAnchorPanelId(null)).toBe('filetree')
  })

  it('isLeftSidebarGroup returns false for null', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps()))
    expect(result.current.isLeftSidebarGroup(null)).toBe(false)
  })

  it('isLeftSidebarGroup returns true for group containing filetree', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps()))
    const mockGroup = { panels: [{ id: 'filetree' }] }
    expect(result.current.isLeftSidebarGroup(mockGroup)).toBe(true)
  })

  it('isLeftSidebarGroup returns false for center group', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps()))
    const mockGroup = { panels: [{ id: 'editor-main.ts' }] }
    expect(result.current.isLeftSidebarGroup(mockGroup)).toBe(false)
  })

  it('findCenterAnchorPanel returns null for null api', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps()))
    expect(result.current.findCenterAnchorPanel(null)).toBeNull()
  })

  it('getLiveCenterGroup returns null for null api', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps()))
    expect(result.current.getLiveCenterGroup(null)).toBeNull()
  })

  it('toggleFiletree calls setCollapsed', () => {
    const setCollapsed = vi.fn()
    const { result } = renderHook(() => useDockLayout(makeDeps({ setCollapsed })))
    result.current.toggleFiletree()
    expect(setCollapsed).toHaveBeenCalled()
  })

  it('toggleAgent calls setCollapsed', () => {
    const setCollapsed = vi.fn()
    const { result } = renderHook(() => useDockLayout(makeDeps({ setCollapsed })))
    result.current.toggleAgent()
    expect(setCollapsed).toHaveBeenCalled()
  })

  it('calculates filetree collapsed height including toggle host header and footer', () => {
    const { result } = renderHook(() => useDockLayout(makeDeps({
      sidebarToggleHostId: 'filetree',
    })))

    expect(result.current.getSidebarCollapsedHeight('filetree')).toBe(140)
    expect(result.current.getSidebarCollapsedHeight('data-catalog')).toBe(30)
    expect(result.current.getSidebarExpandedMinHeight('data-catalog')).toBe(70)
  })

  it('collapses a sidebar section and applies collapsed constraints', () => {
    const filetreeGroup = makeGroup('filetree-group')
    const catalogGroup = makeGroup('catalog-group')
    const filetreePanel = makePanel('filetree', filetreeGroup)
    const catalogPanel = makePanel('data-catalog', catalogGroup)
    const dockApi = {
      getPanel: vi.fn((id) => ({
        filetree: filetreePanel,
        'data-catalog': catalogPanel,
      }[id] || null)),
    }

    const { result } = renderHook(() => useDockLayout(makeDeps({ dockApi })))

    act(() => {
      result.current.toggleSectionCollapse('data-catalog')
    })

    expect(result.current.sectionCollapsed['data-catalog']).toBe(true)
    expect(catalogGroup.api.setConstraints).toHaveBeenCalledWith({
      minimumHeight: 30,
      maximumHeight: 30,
    })
    expect(catalogGroup.api.setSize).toHaveBeenCalledWith({ height: 30 })
  })

  it('activates a sidebar panel and records catalog search intent', () => {
    const catalogGroup = makeGroup('catalog-group')
    const catalogPanel = makePanel('data-catalog', catalogGroup)
    const dockApi = {
      getPanel: vi.fn((id) => ({
        'data-catalog': catalogPanel,
      }[id] || null)),
    }

    const { result } = renderHook(() => useDockLayout(makeDeps({ dockApi })))

    act(() => {
      result.current.activateSidebarPanel('data-catalog', { mode: 'search' })
    })

    expect(result.current.activeSidebarPanelId).toBe('data-catalog')
    expect(result.current.catalogActivityIntent).toMatchObject({
      panelId: 'data-catalog',
      mode: 'search',
    })
    expect(catalogPanel.api.setActive).toHaveBeenCalledTimes(1)
  })
})
