/**
 * Pane Registry Unit Tests
 *
 * Tests for pane registration, capabilities, and requirements.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PaneRegistry, createDefaultRegistry } from './panes'

// Mock React component
const MockComponent = () => null
MockComponent.displayName = 'MockComponent'

describe('PaneRegistry', () => {
  let registry

  beforeEach(() => {
    registry = new PaneRegistry()
  })

  describe('register', () => {
    it('registers a pane with valid config', () => {
      registry.register({
        id: 'test-pane',
        component: MockComponent,
        title: 'Test Pane',
      })

      expect(registry.has('test-pane')).toBe(true)
      expect(registry.get('test-pane')).toMatchObject({
        id: 'test-pane',
        title: 'Test Pane',
      })
    })

    it('throws if id is missing', () => {
      expect(() => {
        registry.register({
          component: MockComponent,
          title: 'Test Pane',
        })
      }).toThrow('Pane config must have id and component')
    })

    it('throws if component is missing', () => {
      expect(() => {
        registry.register({
          id: 'test-pane',
          title: 'Test Pane',
        })
      }).toThrow('Pane config must have id and component')
    })

    it('tracks essential panes', () => {
      registry.register({
        id: 'essential-pane',
        component: MockComponent,
        title: 'Essential',
        essential: true,
      })
      registry.register({
        id: 'non-essential-pane',
        component: MockComponent,
        title: 'Non-Essential',
        essential: false,
      })

      expect(registry.isEssential('essential-pane')).toBe(true)
      expect(registry.isEssential('non-essential-pane')).toBe(false)
      expect(registry.essentials()).toContain('essential-pane')
      expect(registry.essentials()).not.toContain('non-essential-pane')
    })
  })

  describe('get / has', () => {
    beforeEach(() => {
      registry.register({
        id: 'test-pane',
        component: MockComponent,
        title: 'Test Pane',
      })
    })

    it('returns pane config by id', () => {
      const pane = registry.get('test-pane')
      expect(pane.id).toBe('test-pane')
      expect(pane.title).toBe('Test Pane')
    })

    it('returns undefined for unknown pane', () => {
      expect(registry.get('unknown')).toBeUndefined()
    })

    it('checks if pane exists', () => {
      expect(registry.has('test-pane')).toBe(true)
      expect(registry.has('unknown')).toBe(false)
    })
  })

  describe('list / listIds', () => {
    beforeEach(() => {
      registry.register({ id: 'pane-a', component: MockComponent, title: 'A' })
      registry.register({ id: 'pane-b', component: MockComponent, title: 'B' })
    })

    it('lists all pane configurations', () => {
      const panes = registry.list()
      expect(panes).toHaveLength(2)
      expect(panes.map(p => p.id)).toContain('pane-a')
      expect(panes.map(p => p.id)).toContain('pane-b')
    })

    it('lists all pane IDs', () => {
      const ids = registry.listIds()
      expect(ids).toHaveLength(2)
      expect(ids).toContain('pane-a')
      expect(ids).toContain('pane-b')
    })
  })

  describe('getComponents', () => {
    beforeEach(() => {
      registry.register({ id: 'pane-a', component: MockComponent, title: 'A' })
    })

    it('returns id -> component mapping', () => {
      const components = registry.getComponents()
      expect(components['pane-a']).toBe(MockComponent)
    })
  })

  describe('getKnownComponents', () => {
    beforeEach(() => {
      registry.register({ id: 'pane-a', component: MockComponent, title: 'A' })
      registry.register({ id: 'pane-b', component: MockComponent, title: 'B' })
    })

    it('returns set of known component names', () => {
      const known = registry.getKnownComponents()
      expect(known.has('pane-a')).toBe(true)
      expect(known.has('pane-b')).toBe(true)
      expect(known.has('unknown')).toBe(false)
    })
  })

  describe('requiresFeatures / requiresRouters', () => {
    beforeEach(() => {
      registry.register({
        id: 'feature-pane',
        component: MockComponent,
        title: 'Feature Pane',
        requiresFeatures: ['files', 'git'],
      })
      registry.register({
        id: 'router-pane',
        component: MockComponent,
        title: 'Router Pane',
        requiresRouters: ['pty', 'chat'],
      })
      registry.register({
        id: 'simple-pane',
        component: MockComponent,
        title: 'Simple Pane',
      })
    })

    it('returns required features for a pane', () => {
      expect(registry.getRequiredFeatures('feature-pane')).toEqual(['files', 'git'])
      expect(registry.getRequiredFeatures('simple-pane')).toEqual([])
      expect(registry.getRequiredFeatures('unknown')).toEqual([])
    })

    it('returns required routers for a pane', () => {
      expect(registry.getRequiredRouters('router-pane')).toEqual(['pty', 'chat'])
      expect(registry.getRequiredRouters('simple-pane')).toEqual([])
      expect(registry.getRequiredRouters('unknown')).toEqual([])
    })
  })

  describe('checkRequirements', () => {
    beforeEach(() => {
      registry.register({
        id: 'feature-pane',
        component: MockComponent,
        title: 'Feature Pane',
        requiresFeatures: ['files', 'git'],
      })
      registry.register({
        id: 'router-pane',
        component: MockComponent,
        title: 'Router Pane',
        requiresRouters: ['pty'],
      })
      registry.register({
        id: 'simple-pane',
        component: MockComponent,
        title: 'Simple Pane',
      })
    })

    it('returns true when all features are satisfied', () => {
      const capabilities = {
        features: { files: true, git: true },
      }
      expect(registry.checkRequirements('feature-pane', capabilities)).toBe(true)
    })

    it('returns false when features are missing', () => {
      const capabilities = {
        features: { files: true },
      }
      expect(registry.checkRequirements('feature-pane', capabilities)).toBe(false)
    })

    it('returns true when routers are satisfied', () => {
      const capabilities = {
        features: { pty: true },
      }
      expect(registry.checkRequirements('router-pane', capabilities)).toBe(true)
    })

    it('returns false when routers are missing', () => {
      const capabilities = {
        features: {},
      }
      expect(registry.checkRequirements('router-pane', capabilities)).toBe(false)
    })

    it('returns true for panes with no requirements', () => {
      const capabilities = { features: {} }
      expect(registry.checkRequirements('simple-pane', capabilities)).toBe(true)
    })

    it('returns false for unknown panes', () => {
      expect(registry.checkRequirements('unknown', {})).toBe(false)
    })
  })

  describe('getAvailablePanes', () => {
    beforeEach(() => {
      registry.register({
        id: 'files-pane',
        component: MockComponent,
        title: 'Files',
        requiresFeatures: ['files'],
      })
      registry.register({
        id: 'git-pane',
        component: MockComponent,
        title: 'Git',
        requiresFeatures: ['git'],
      })
      registry.register({
        id: 'simple-pane',
        component: MockComponent,
        title: 'Simple',
      })
    })

    it('returns panes with satisfied requirements', () => {
      const capabilities = { features: { files: true } }
      const available = registry.getAvailablePanes(capabilities)

      expect(available.map(p => p.id)).toContain('files-pane')
      expect(available.map(p => p.id)).toContain('simple-pane')
      expect(available.map(p => p.id)).not.toContain('git-pane')
    })
  })

  describe('getUnavailableEssentialPanes', () => {
    beforeEach(() => {
      registry.register({
        id: 'essential-with-feature',
        component: MockComponent,
        title: 'Essential with Feature',
        essential: true,
        requiresFeatures: ['files'],
      })
      registry.register({
        id: 'essential-simple',
        component: MockComponent,
        title: 'Essential Simple',
        essential: true,
      })
      registry.register({
        id: 'non-essential',
        component: MockComponent,
        title: 'Non-Essential',
        requiresFeatures: ['git'],
      })
    })

    it('returns essential panes with unmet requirements', () => {
      const capabilities = { features: {} }
      const unavailable = registry.getUnavailableEssentialPanes(capabilities)

      expect(unavailable.map(p => p.id)).toContain('essential-with-feature')
      expect(unavailable.map(p => p.id)).not.toContain('essential-simple')
      expect(unavailable.map(p => p.id)).not.toContain('non-essential')
    })
  })
})

describe('createDefaultRegistry', () => {
  it('creates registry with standard panes', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('filetree')).toBe(true)
    expect(registry.has('editor')).toBe(true)
    expect(registry.has('terminal')).toBe(true)
    expect(registry.has('shell')).toBe(true)
    expect(registry.has('empty')).toBe(true)
    expect(registry.has('review')).toBe(true)
  })

  it('marks essential panes correctly', () => {
    const registry = createDefaultRegistry()

    expect(registry.isEssential('filetree')).toBe(true)
    expect(registry.isEssential('terminal')).toBe(false)
    expect(registry.isEssential('shell')).toBe(true)
    expect(registry.isEssential('editor')).toBe(false)
    expect(registry.isEssential('empty')).toBe(false)
  })

  it('sets requirements for panes', () => {
    const registry = createDefaultRegistry()

    expect(registry.getRequiredFeatures('filetree')).toContain('files')
    expect(registry.getRequiredRouters('terminal')).toContain('chat_claude_code')
    expect(registry.getRequiredRouters('shell')).toContain('pty')
  })

  it('includes companion pane with correct config', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('companion')).toBe(true)
    const pane = registry.get('companion')
    expect(pane.requiresAnyFeatures).toContain('companion')
    expect(pane.requiresAnyFeatures).toContain('pi')
    expect(pane.essential).toBe(false)
    expect(pane.placement).toBe('right')
    expect(pane.hideHeader).toBe(true)
  })

  it('gates companion pane on companion OR pi feature', () => {
    const registry = createDefaultRegistry()

    // Without companion or pi feature
    expect(registry.checkRequirements('companion', { features: {} })).toBe(false)
    expect(registry.checkRequirements('companion', { features: { companion: false } })).toBe(false)
    expect(registry.checkRequirements('companion', { features: { pi: false } })).toBe(false)

    // With companion feature
    expect(registry.checkRequirements('companion', { features: { companion: true } })).toBe(true)
    // With pi feature
    expect(registry.checkRequirements('companion', { features: { pi: true } })).toBe(true)
  })
})
