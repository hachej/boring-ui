/**
 * Layout Integration Tests
 *
 * Tests for pane registration and layout persistence integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createDefaultRegistry,
} from '../registry/panes'
import {
  saveLayout,
  loadLayout,
  saveCollapsedState,
  loadCollapsedState,
  LAYOUT_VERSION,
  getStorageKey,
  validateLayoutStructure,
} from '../layout/LayoutManager'
import { getDefaultConfig, setConfig, resetConfig } from '../config/appConfig'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    }),
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
})

// Mock essentialPanes
vi.mock('../registry/panes', async () => {
  const actual = await vi.importActual('../registry/panes')
  return {
    ...actual,
    essentialPanes: () => ['filetree', 'terminal', 'shell'],
  }
})

// Helper to create a valid layout
// Note: contentComponent should match the pane ID in the registry
const createValidLayout = () => ({
  version: LAYOUT_VERSION,
  configVersion: 1,
  grid: {
    root: {
      type: 'branch',
      data: [
        {
          type: 'leaf',
          data: { views: [{ id: 'filetree' }] },
        },
        {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: { views: [{ id: 'shell' }, { id: 'editor-1' }] },
            },
            {
              type: 'leaf',
              data: { views: [{ id: 'terminal' }] },
            },
          ],
        },
      ],
    },
  },
  panels: {
    filetree: { contentComponent: 'filetree' },
    terminal: { contentComponent: 'terminal' },
    shell: { contentComponent: 'shell' },
    'editor-1': { contentComponent: 'editor' },
  },
})

describe('Layout Integration', () => {
  const prefix = 'test-app'
  const projectRoot = '/test/project'

  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    resetConfig()
  })

  describe('Registry + Layout Integration', () => {
    it('validates layout against registry known components', () => {
      const registry = createDefaultRegistry()
      const layout = createValidLayout()

      // Save the layout
      saveLayout(prefix, projectRoot, layout, 1)

      // Load with known components from registry
      const knownComponents = registry.getKnownComponents()
      const loaded = loadLayout(prefix, projectRoot, knownComponents, 1)

      expect(loaded).toBeTruthy()
    })

    it('rejects layout with unknown components', () => {
      const registry = createDefaultRegistry()
      const layout = createValidLayout()
      layout.panels['unknown-pane'] = { contentComponent: 'UnknownPanel' }

      const key = getStorageKey(prefix, projectRoot, 'layout')
      localStorageMock.setItem(key, JSON.stringify(layout))

      const knownComponents = registry.getKnownComponents()
      const loaded = loadLayout(prefix, projectRoot, knownComponents, 1)

      expect(loaded).toBeNull()
    })

    it('accepts a late-registered pane when using a fresh known-components set', () => {
      const registry = createDefaultRegistry()
      const staleKnownComponents = registry.getKnownComponents()
      registry.register({
        id: 'child-markdown',
        component: () => null,
        title: 'Child Markdown',
      })

      const layout = createValidLayout()
      layout.panels['editor-1'] = { contentComponent: 'child-markdown' }

      saveLayout(prefix, projectRoot, layout, 1)

      expect(loadLayout(prefix, projectRoot, staleKnownComponents, 1)).toBeNull()
      saveLayout(prefix, projectRoot, layout, 1)
      expect(loadLayout(prefix, projectRoot, registry.getKnownComponents(), 1)).toBeTruthy()
    })

    it('validates essential panes are present', () => {
      // Layout missing essential pane
      const incompleteLayout = createValidLayout()
      delete incompleteLayout.panels.filetree
      incompleteLayout.grid.root.data[0].data.views = []

      expect(validateLayoutStructure(incompleteLayout)).toBe(false)
    })
  })

  describe('Config + Layout Integration', () => {
    it('respects config storage prefix', () => {
      const config = setConfig({
        storage: { prefix: 'custom-app' },
      })

      const layout = createValidLayout()
      saveLayout(config.storage.prefix, projectRoot, layout, 1)

      // Should be saved with custom prefix
      const key = getStorageKey('custom-app', projectRoot, 'layout')
      expect(localStorageMock.getItem(key)).toBeTruthy()
    })

    it('respects config layout version', () => {
      const config = setConfig({
        storage: { layoutVersion: 5 },
      })

      const layout = createValidLayout()
      saveLayout(prefix, projectRoot, layout, config.storage.layoutVersion)

      // Load with different version should reject
      const loaded = loadLayout(prefix, projectRoot, undefined, 10)
      expect(loaded).toBeNull()
    })

    it('default config has valid panel essentials', () => {
      const config = getDefaultConfig()
      const registry = createDefaultRegistry()

      // All config essentials should be in registry
      for (const essentialId of config.panels.essential) {
        expect(registry.has(essentialId)).toBe(true)
      }
    })
  })

  describe('Collapsed State Persistence', () => {
    it('persists and restores collapsed state', () => {
      // Note: saveCollapsedState signature is (state, prefix)
      saveCollapsedState(
        { filetree: true, terminal: false, shell: false },
        prefix,
      )

      const loaded = loadCollapsedState(prefix)
      expect(loaded).toEqual({
        filetree: true,
        terminal: false,
        shell: false,
      })
    })

    it('returns default state when no state saved', () => {
      // No state saved - returns default { filetree: false, terminal: false, shell: false }
      const loaded = loadCollapsedState(prefix)
      expect(loaded).toEqual({ filetree: false, terminal: false, shell: false })
    })
  })

  describe('Layout Recovery Flow', () => {
    it('recovers from lastKnownGoodLayout when main layout invalid', () => {
      // Save valid backup
      const validLayout = createValidLayout()
      const backupKey = getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout')
      localStorageMock.setItem(backupKey, JSON.stringify(validLayout))

      // Save invalid main layout
      const invalidLayout = createValidLayout()
      delete invalidLayout.panels.filetree
      const mainKey = getStorageKey(prefix, projectRoot, 'layout')
      localStorageMock.setItem(mainKey, JSON.stringify(invalidLayout))

      // Should recover from backup
      const loaded = loadLayout(prefix, projectRoot)
      expect(loaded).toBeTruthy()
      expect(loaded.panels.filetree).toBeTruthy()
    })

    it('saveLayout creates backup when layout is valid', () => {
      const validLayout = createValidLayout()
      saveLayout(prefix, projectRoot, validLayout, 1)

      const backupKey = getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout')
      const backup = localStorageMock.getItem(backupKey)
      expect(backup).toBeTruthy()
    })
  })

  describe('Multi-Project Layout Isolation', () => {
    it('isolates layouts by project root', () => {
      const project1 = '/project1'
      const project2 = '/project2'

      const layout1 = createValidLayout()
      layout1.panels['project1-specific'] = { contentComponent: 'Custom1' }

      const layout2 = createValidLayout()
      layout2.panels['project2-specific'] = { contentComponent: 'Custom2' }

      saveLayout(prefix, project1, layout1, 1)
      saveLayout(prefix, project2, layout2, 1)

      // Each project should have its own layout
      const loaded1 = loadLayout(prefix, project1)
      const loaded2 = loadLayout(prefix, project2)

      expect(loaded1.panels['project1-specific']).toBeTruthy()
      expect(loaded1.panels['project2-specific']).toBeUndefined()
      expect(loaded2.panels['project2-specific']).toBeTruthy()
      expect(loaded2.panels['project1-specific']).toBeUndefined()
    })
  })
})
