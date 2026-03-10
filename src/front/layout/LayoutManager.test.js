/**
 * LayoutManager Unit Tests
 *
 * Tests for layout persistence, validation, recovery, and migration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LAYOUT_VERSION,
  hashProjectRoot,
  getStorageKey,
  getSharedStorageKey,
  validateLayoutStructure,
  loadSavedTabs,
  saveTabs,
  loadLayout,
  saveLayout,
  loadLastKnownGoodLayout,
  clearLastKnownGoodLayout,
  registerLayoutMigration,
  migrateLayout,
} from './LayoutManager'

// Mock essentialPanes - must be done before imports
vi.mock('../registry/panes', () => ({
  essentialPanes: () => ['filetree', 'terminal', 'shell'],
}))

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

// Helper to create a valid layout structure
const createValidLayout = (overrides = {}) => ({
  version: LAYOUT_VERSION,
  configVersion: 1,
  savedAt: Date.now(),
  grid: {
    root: {
      type: 'branch',
      data: [
        {
          type: 'leaf',
          data: {
            views: [{ id: 'filetree' }],
          },
        },
        {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: {
                views: [{ id: 'shell' }, { id: 'editor-1' }],
              },
            },
            {
              type: 'leaf',
              data: {
                views: [{ id: 'terminal' }],
              },
            },
          ],
        },
      ],
    },
  },
  panels: {
    filetree: { contentComponent: 'FileTreePanel' },
    terminal: { contentComponent: 'TerminalPanel' },
    shell: { contentComponent: 'ShellTerminalPanel' },
    'editor-1': { contentComponent: 'EditorPanel' },
  },
  ...overrides,
})

describe('LayoutManager', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  describe('hashProjectRoot', () => {
    it('returns "default" for null/undefined', () => {
      expect(hashProjectRoot(null)).toBe('default')
      expect(hashProjectRoot(undefined)).toBe('default')
      expect(hashProjectRoot('')).toBe('default')
    })

    it('generates consistent hash for same path', () => {
      const hash1 = hashProjectRoot('/home/user/project')
      const hash2 = hashProjectRoot('/home/user/project')
      expect(hash1).toBe(hash2)
    })

    it('generates different hashes for different paths', () => {
      const hash1 = hashProjectRoot('/home/user/project1')
      const hash2 = hashProjectRoot('/home/user/project2')
      expect(hash1).not.toBe(hash2)
    })

    it('generates alphanumeric base-36 hash', () => {
      const hash = hashProjectRoot('/some/path')
      expect(hash).toMatch(/^[a-z0-9]+$/)
    })
  })

  describe('getStorageKey', () => {
    it('combines prefix, project hash, and suffix', () => {
      const key = getStorageKey('myapp', '/home/user/project', 'layout')
      expect(key).toContain('myapp')
      expect(key).toContain('layout')
      expect(key).toMatch(/^myapp-[a-z0-9]+-layout$/)
    })

    it('uses default prefix when none provided', () => {
      const key = getStorageKey(null, '/home/user/project', 'layout')
      expect(key).toContain('boring-ui')
    })
  })

  describe('getSharedStorageKey', () => {
    it('combines prefix and suffix without project hash', () => {
      const key = getSharedStorageKey('myapp', 'theme')
      expect(key).toBe('myapp-theme')
    })

    it('uses default prefix when none provided', () => {
      const key = getSharedStorageKey(null, 'theme')
      expect(key).toBe('boring-ui-theme')
    })
  })

  describe('validateLayoutStructure', () => {
    it('returns false for null/undefined', () => {
      expect(validateLayoutStructure(null)).toBe(false)
      expect(validateLayoutStructure(undefined)).toBe(false)
    })

    it('returns false for layout without grid', () => {
      expect(validateLayoutStructure({ panels: {} })).toBe(false)
    })

    it('returns false for layout without panels', () => {
      expect(validateLayoutStructure({ grid: {} })).toBe(false)
    })

    it('returns false when essential panels are missing', () => {
      const layout = createValidLayout()
      delete layout.panels.filetree
      expect(validateLayoutStructure(layout)).toBe(false)
    })

    it('returns true for valid layout', () => {
      const layout = createValidLayout()
      expect(validateLayoutStructure(layout)).toBe(true)
    })

    it('allows essential panels to share a group', () => {
      const layout = createValidLayout()
      // Put terminal in filetree's group — should still be valid
      layout.grid.root.data[0].data.views.push({ id: 'terminal' })
      expect(validateLayoutStructure(layout)).toBe(true)
    })

    it('allows layout when essential panels are omitted from grid views but exist in panels', () => {
      const layout = createValidLayout()
      layout.grid.root.data[0].data.views = []
      layout.grid.root.data[1].data[0].data.views = [{ id: 'editor-1' }]
      layout.grid.root.data[1].data[1].data.views = []
      expect(validateLayoutStructure(layout)).toBe(true)
    })
  })

  describe('saveTabs / loadSavedTabs', () => {
    const prefix = 'test'
    const projectRoot = '/test/project'

    it('saves and loads tabs correctly', () => {
      const tabs = ['/file1.js', '/file2.js', '/file3.js']
      saveTabs(prefix, projectRoot, tabs)
      const loaded = loadSavedTabs(prefix, projectRoot)
      expect(loaded).toEqual(tabs)
    })

    it('returns empty array when no tabs saved', () => {
      const loaded = loadSavedTabs(prefix, projectRoot)
      expect(loaded).toEqual([])
    })

    it('handles corrupted data gracefully', () => {
      const key = getStorageKey(prefix, projectRoot, 'tabs')
      localStorageMock.setItem(key, 'invalid json{')
      const loaded = loadSavedTabs(prefix, projectRoot)
      expect(loaded).toEqual([])
    })
  })

  describe('saveLayout / loadLayout', () => {
    const prefix = 'test'
    const projectRoot = '/test/project'

    it('saves and loads layout correctly', () => {
      const layout = createValidLayout()
      saveLayout(prefix, projectRoot, layout, 1)

      const loaded = loadLayout(prefix, projectRoot)
      expect(loaded).toBeTruthy()
      expect(loaded.version).toBe(LAYOUT_VERSION)
    })

    it('returns null when no layout saved', () => {
      const loaded = loadLayout(prefix, projectRoot)
      expect(loaded).toBeNull()
    })

    it('rejects layout with old version when no migration path', () => {
      const layout = createValidLayout({ version: 1 })
      const key = getStorageKey(prefix, projectRoot, 'layout')
      localStorageMock.setItem(key, JSON.stringify(layout))

      const loaded = loadLayout(prefix, projectRoot)
      expect(loaded).toBeNull()
    })

    it('rejects layout when config version changes', () => {
      const layout = createValidLayout({ configVersion: 1 })
      const key = getStorageKey(prefix, projectRoot, 'layout')
      localStorageMock.setItem(key, JSON.stringify(layout))

      // Load with different config version
      const loaded = loadLayout(prefix, projectRoot, undefined, 2)
      expect(loaded).toBeNull()
    })

    it('rejects layout with unknown components', () => {
      const layout = createValidLayout()
      layout.panels['unknown'] = { contentComponent: 'UnknownPanel' }
      const key = getStorageKey(prefix, projectRoot, 'layout')
      localStorageMock.setItem(key, JSON.stringify(layout))

      const knownComponents = new Set(['FileTreePanel', 'TerminalPanel', 'ShellTerminalPanel', 'EditorPanel'])
      const loaded = loadLayout(prefix, projectRoot, knownComponents)
      expect(loaded).toBeNull()
    })

    it('accepts layout with all known components', () => {
      const layout = createValidLayout()
      const key = getStorageKey(prefix, projectRoot, 'layout')
      localStorageMock.setItem(key, JSON.stringify(layout))

      const knownComponents = new Set(['FileTreePanel', 'TerminalPanel', 'ShellTerminalPanel', 'EditorPanel'])
      const loaded = loadLayout(prefix, projectRoot, knownComponents)
      expect(loaded).toBeTruthy()
    })

    it('saves valid layout as lastKnownGoodLayout', () => {
      const layout = createValidLayout()
      saveLayout(prefix, projectRoot, layout, 1)

      const backupKey = getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout')
      const backup = localStorageMock.getItem(backupKey)
      expect(backup).toBeTruthy()
    })
  })

  describe('loadLastKnownGoodLayout / clearLastKnownGoodLayout', () => {
    const prefix = 'test'
    const projectRoot = '/test/project'

    it('returns null when no backup exists', () => {
      const loaded = loadLastKnownGoodLayout(prefix, projectRoot)
      expect(loaded).toBeNull()
    })

    it('loads valid backup layout', () => {
      const layout = createValidLayout()
      const key = getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout')
      localStorageMock.setItem(key, JSON.stringify(layout))

      const loaded = loadLastKnownGoodLayout(prefix, projectRoot)
      expect(loaded).toBeTruthy()
      expect(loaded.version).toBe(LAYOUT_VERSION)
    })

    it('returns null for outdated backup', () => {
      const layout = createValidLayout({ version: 1 })
      const key = getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout')
      localStorageMock.setItem(key, JSON.stringify(layout))

      const loaded = loadLastKnownGoodLayout(prefix, projectRoot)
      expect(loaded).toBeNull()
    })

    it('clears lastKnownGoodLayout', () => {
      const layout = createValidLayout()
      const key = getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout')
      localStorageMock.setItem(key, JSON.stringify(layout))

      clearLastKnownGoodLayout(prefix, projectRoot)
      expect(localStorageMock.getItem(key)).toBeNull()
    })
  })

  describe('registerLayoutMigration / migrateLayout', () => {
    it('returns layout unchanged if version >= current', () => {
      const layout = createValidLayout()
      const result = migrateLayout(layout, LAYOUT_VERSION)
      expect(result).toBe(layout)
    })

    it('returns null when no migration path exists', () => {
      const layout = createValidLayout({ version: 1 })
      const result = migrateLayout(layout, 1)
      expect(result).toBeNull()
    })

    it('applies direct migration when available', () => {
      const oldVersion = LAYOUT_VERSION - 1
      const migrator = vi.fn((layout) => ({
        ...layout,
        migrated: true,
      }))
      registerLayoutMigration(oldVersion, LAYOUT_VERSION, migrator)

      const layout = createValidLayout({ version: oldVersion })
      const result = migrateLayout(layout, oldVersion)

      expect(migrator).toHaveBeenCalledWith(layout)
      expect(result.migrated).toBe(true)
      expect(result.version).toBe(LAYOUT_VERSION)
    })

    it('applies step-by-step migration', () => {
      const v1 = LAYOUT_VERSION - 2
      const v2 = LAYOUT_VERSION - 1

      registerLayoutMigration(v1, v2, (layout) => ({
        ...layout,
        step1: true,
      }))
      registerLayoutMigration(v2, LAYOUT_VERSION, (layout) => ({
        ...layout,
        step2: true,
      }))

      const layout = createValidLayout({ version: v1 })
      const result = migrateLayout(layout, v1)

      expect(result.step1).toBe(true)
      expect(result.step2).toBe(true)
      expect(result.version).toBe(LAYOUT_VERSION)
    })

    it('returns null if migration throws', () => {
      const oldVersion = LAYOUT_VERSION - 1
      registerLayoutMigration(oldVersion, LAYOUT_VERSION, () => {
        throw new Error('Migration failed')
      })

      const layout = createValidLayout({ version: oldVersion })
      const result = migrateLayout(layout, oldVersion)
      expect(result).toBeNull()
    })
  })

  describe('recovery flow', () => {
    const prefix = 'test'
    const projectRoot = '/test/project'

    it('recovers from lastKnownGoodLayout when main layout is invalid', () => {
      // Save a valid backup
      const validLayout = createValidLayout()
      const backupKey = getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout')
      localStorageMock.setItem(backupKey, JSON.stringify(validLayout))

      // Save an invalid main layout (missing essential)
      const invalidLayout = createValidLayout()
      delete invalidLayout.panels.filetree
      const mainKey = getStorageKey(prefix, projectRoot, 'layout')
      localStorageMock.setItem(mainKey, JSON.stringify(invalidLayout))

      // Should recover from backup
      const loaded = loadLayout(prefix, projectRoot)
      expect(loaded).toBeTruthy()
      expect(loaded.panels.filetree).toBeTruthy()
    })

    it('returns null when both main and backup are invalid', () => {
      // Save invalid backup
      const invalidBackup = createValidLayout({ version: 1 })
      const backupKey = getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout')
      localStorageMock.setItem(backupKey, JSON.stringify(invalidBackup))

      // Save invalid main layout
      const invalidLayout = createValidLayout()
      delete invalidLayout.panels.filetree
      const mainKey = getStorageKey(prefix, projectRoot, 'layout')
      localStorageMock.setItem(mainKey, JSON.stringify(invalidLayout))

      // Should return null
      const loaded = loadLayout(prefix, projectRoot)
      expect(loaded).toBeNull()
    })
  })
})
