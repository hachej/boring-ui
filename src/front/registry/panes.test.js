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

  describe('requiresCapabilities / legacy requirements', () => {
    beforeEach(() => {
      registry.register({
        id: 'capability-pane',
        component: MockComponent,
        title: 'Capability Pane',
        requiresCapabilities: ['workspace.files', 'workspace.git'],
      })
      registry.register({
        id: 'legacy-router-pane',
        component: MockComponent,
        title: 'Legacy Router Pane',
        requiresRouters: ['pty', 'chat'],
      })
      registry.register({
        id: 'simple-pane',
        component: MockComponent,
        title: 'Simple Pane',
      })
    })

    it('returns required capabilities for a pane', () => {
      expect(registry.getRequiredCapabilities('capability-pane')).toEqual(['workspace.files', 'workspace.git'])
      expect(registry.getRequiredFeatures('simple-pane')).toEqual([])
      expect(registry.getRequiredCapabilities('unknown')).toEqual([])
    })

    it('preserves legacy feature accessors for panes that do not use them', () => {
      expect(registry.getRequiredFeatures('unknown')).toEqual([])
    })

    it('returns required routers for legacy router-gated panes', () => {
      expect(registry.getRequiredRouters('legacy-router-pane')).toEqual(['pty', 'chat'])
      expect(registry.getRequiredRouters('simple-pane')).toEqual([])
      expect(registry.getRequiredRouters('unknown')).toEqual([])
    })
  })

  describe('checkRequirements', () => {
    beforeEach(() => {
      registry.register({
        id: 'capability-pane',
        component: MockComponent,
        title: 'Capability Pane',
        requiresCapabilities: ['workspace.files', 'workspace.git'],
      })
      registry.register({
        id: 'legacy-router-pane',
        component: MockComponent,
        title: 'Legacy Router Pane',
        requiresRouters: ['pty'],
      })
      registry.register({
        id: 'simple-pane',
        component: MockComponent,
        title: 'Simple Pane',
      })
    })

    it('returns true when all abstract capabilities are satisfied', () => {
      const capabilities = {
        capabilities: { 'workspace.files': true, 'workspace.git': true },
      }
      expect(registry.checkRequirements('capability-pane', capabilities)).toBe(true)
    })

    it('returns false when abstract capabilities are missing', () => {
      const capabilities = {
        capabilities: { 'workspace.files': true },
      }
      expect(registry.checkRequirements('capability-pane', capabilities)).toBe(false)
    })

    it('still supports legacy router checks during migration', () => {
      const capabilities = {
        features: { pty: true },
      }
      expect(registry.checkRequirements('legacy-router-pane', capabilities)).toBe(true)
    })

    it('returns false when legacy routers are missing', () => {
      const capabilities = {
        features: {},
      }
      expect(registry.checkRequirements('legacy-router-pane', capabilities)).toBe(false)
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
        requiresCapabilities: ['workspace.files'],
      })
      registry.register({
        id: 'git-pane',
        component: MockComponent,
        title: 'Git',
        requiresCapabilities: ['workspace.git'],
      })
      registry.register({
        id: 'simple-pane',
        component: MockComponent,
        title: 'Simple',
      })
    })

    it('returns panes with satisfied requirements', () => {
      const capabilities = { capabilities: { 'workspace.files': true } }
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
        requiresCapabilities: ['workspace.files'],
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
        requiresCapabilities: ['workspace.git'],
      })
    })

    it('returns essential panes with unmet requirements', () => {
      const capabilities = { capabilities: {} }
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
    expect(registry.has('empty')).toBe(true)
    expect(registry.has('review')).toBe(true)
    expect(registry.has('agent')).toBe(true)
  })

  it('does not register legacy terminal or shell panes', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('terminal')).toBe(false)
    expect(registry.has('shell')).toBe(false)
    expect(registry.listIds()).not.toContain('terminal')
    expect(registry.listIds()).not.toContain('shell')
  })

  it('marks essential panes correctly', () => {
    const registry = createDefaultRegistry()

    expect(registry.isEssential('filetree')).toBe(true)
    expect(registry.isEssential('editor')).toBe(false)
    expect(registry.isEssential('empty')).toBe(false)
  })

  it('sets requirements for panes', () => {
    const registry = createDefaultRegistry()

    expect(registry.getRequiredCapabilities('filetree')).toContain('workspace.files')
    expect(registry.getRequiredCapabilities('editor')).toContain('workspace.files')
  })

  it('includes agent pane with correct config', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('agent')).toBe(true)
    const pane = registry.get('agent')
    expect(pane.requiresCapabilities).toContain('agent.chat')
    expect(pane.essential).toBe(false)
    expect(pane.placement).toBe('right')
    expect(pane.hideHeader).toBe(true)
  })

  it('gates agent pane on the abstract agent.chat capability', () => {
    const registry = createDefaultRegistry()

    expect(registry.checkRequirements('agent', { capabilities: {} })).toBe(false)
    expect(registry.checkRequirements('agent', { capabilities: { 'agent.chat': false } })).toBe(false)

    expect(registry.checkRequirements('agent', { capabilities: { 'agent.chat': true } })).toBe(true)
  })
})
