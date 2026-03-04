/**
 * App Configuration Unit Tests
 *
 * Tests for config loading, merging, and management.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getConfig,
  getDefaultConfig,
  resetConfig,
  setConfig,
  loadConfig,
} from './appConfig'

describe('appConfig', () => {
  beforeEach(() => {
    resetConfig()
  })

  describe('getDefaultConfig', () => {
    it('returns default configuration', () => {
      const config = getDefaultConfig()

      expect(config.branding).toBeDefined()
      expect(config.branding.name).toBe('Boring UI')
      expect(config.branding.logo).toBe('B')
    })

    it('includes all expected sections', () => {
      const config = getDefaultConfig()

      expect(config.branding).toBeDefined()
      expect(config.fileTree).toBeDefined()
      expect(config.storage).toBeDefined()
      expect(config.panels).toBeDefined()
      expect(config.api).toBeDefined()
      expect(config.data).toBeDefined()
      expect(config.features).toBeDefined()
      expect(config.styles).toBeDefined()
    })

    it('has correct storage defaults', () => {
      const config = getDefaultConfig()

      expect(config.storage.prefix).toBe('boring-ui')
      expect(config.storage.layoutVersion).toBe(1)
    })

    it('has correct feature flags', () => {
      const config = getDefaultConfig()

      expect(config.features.gitStatus).toBe(true)
      expect(config.features.search).toBe(true)
      expect(config.features.cloudMode).toBe(false)
    })

    it('has correct data backend defaults', () => {
      const config = getDefaultConfig()
      expect(config.data.backend).toBe('http')
      expect(config.data.strictBackend).toBe(false)
      expect(config.data.lightningfs.name).toBe('boring-fs')
      expect(config.data.cheerpx.workspaceRoot).toBe('/workspace')
    })

    it('has correct panel constraints', () => {
      const config = getDefaultConfig()

      expect(config.panels.essential).toContain('filetree')
      expect(config.panels.essential).toContain('terminal')
      expect(config.panels.essential).toContain('shell')
    })
  })

  describe('getConfig', () => {
    it('returns null before config is loaded', () => {
      expect(getConfig()).toBeNull()
    })

    it('returns config after setConfig', () => {
      setConfig({})
      expect(getConfig()).not.toBeNull()
    })
  })

  describe('setConfig', () => {
    it('merges user config with defaults', () => {
      const config = setConfig({
        branding: {
          name: 'Custom Name',
        },
      })

      expect(config.branding.name).toBe('Custom Name')
      expect(config.branding.logo).toBe('B') // Default preserved
    })

    it('deep merges nested objects', () => {
      const config = setConfig({
        features: {
          cloudMode: true,
        },
      })

      expect(config.features.cloudMode).toBe(true)
      expect(config.features.gitStatus).toBe(true) // Default preserved
      expect(config.features.search).toBe(true) // Default preserved
    })

    it('allows overriding configured data backend', () => {
      const config = setConfig({
        data: {
          backend: 'cheerpx',
          strictBackend: true,
          lightningfs: { name: 'boring-fs-test' },
          cheerpx: { overlayName: 'boring-ui-cheerpx-overlay-test' },
        },
      })
      expect(config.data.backend).toBe('cheerpx')
      expect(config.data.strictBackend).toBe(true)
      expect(config.data.lightningfs.name).toBe('boring-fs-test')
      expect(config.data.cheerpx.overlayName).toBe('boring-ui-cheerpx-overlay-test')
    })

    it('replaces arrays instead of merging', () => {
      const config = setConfig({
        panels: {
          essential: ['custom-panel'],
        },
      })

      expect(config.panels.essential).toEqual(['custom-panel'])
    })

    it('handles undefined values correctly', () => {
      const config = setConfig({
        branding: {
          name: undefined,
        },
      })

      // Undefined values should be ignored, keeping defaults
      expect(config.branding.name).toBe('Boring UI')
    })
  })

  describe('loadConfig', () => {
    it('returns default config with no arguments', async () => {
      const config = await loadConfig()

      expect(config.branding.name).toBe('Boring UI')
    })

    it('merges provided config', async () => {
      const config = await loadConfig({
        branding: { name: 'Custom' },
      })

      expect(config.branding.name).toBe('Custom')
    })

    it('caches config for subsequent calls', async () => {
      await loadConfig({ branding: { name: 'First' } })
      const config = await loadConfig() // No config provided

      expect(config.branding.name).toBe('First')
    })
  })

  describe('resetConfig', () => {
    it('clears cached config', () => {
      setConfig({ branding: { name: 'Test' } })
      expect(getConfig()).not.toBeNull()

      resetConfig()
      expect(getConfig()).toBeNull()
    })
  })

  describe('config integration', () => {
    it('titleFormat function works correctly', () => {
      const config = getDefaultConfig()
      const titleFn = config.branding.titleFormat

      expect(titleFn({})).toBe('Boring UI')
      expect(titleFn({ folder: 'my-project' })).toBe('my-project - Boring UI')
    })

    it('fileTree config has expected structure', () => {
      const config = getDefaultConfig()

      expect(config.fileTree.sections).toBeInstanceOf(Array)
      expect(config.fileTree.sections[0]).toMatchObject({
        key: 'files',
        label: 'Files',
      })
      expect(config.fileTree.gitPollInterval).toBeGreaterThan(0)
      expect(config.fileTree.treePollInterval).toBeGreaterThan(0)
    })

    it('styles config has light and dark themes', () => {
      const config = getDefaultConfig()

      expect(config.styles.light).toBeDefined()
      expect(config.styles.dark).toBeDefined()
    })
  })
})
