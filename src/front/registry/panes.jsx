/**
 * Pane Registry - Manages panel component registration for Dockview layout.
 *
 * This module provides a centralized registry for all panel components,
 * allowing new panels to be added without touching core app code.
 *
 * ## Capability Gating
 *
 * Panes can declare backend dependencies via `requiresFeatures` and `requiresRouters`.
 * These are checked against the `/api/capabilities` endpoint response:
 *
 * ```json
 * {
 *   "features": {
 *     "files": true,      // File system operations available
 *     "git": true,        // Git operations available
 *     "pty": true,        // PTY/shell WebSocket available
 *     "chat_claude_code": true,  // Claude chat WebSocket available
 *     "approval": true    // Approval request router available
 *   }
 * }
 * ```
 *
 * ### Available Capabilities
 *
 * | Capability | Type | Description |
 * |------------|------|-------------|
 * | `files` | feature | File read/write/rename/delete operations |
 * | `git` | feature | Git status, diff, show operations |
 * | `pty` | router | PTY WebSocket for shell terminals |
 * | `chat_claude_code` | router | Claude stream WebSocket for AI chat |
 * | `approval` | router | Approval request handling |
 *
 * ### Default Pane Requirements
 *
 * - `filetree`: requires `files` feature
 * - `editor`: requires `files` feature
 * - `potion`: requires `files` feature
 * - `terminal`: requires `chat_claude_code` router
 * - `shell`: requires `pty` router
 * - `review`: requires `approval` router
 * - `empty`: no requirements (always available)
 *
 * When requirements are unmet, the pane renders an error state explaining
 * which capabilities are missing rather than crashing.
 *
 * @module registry/panes
 */

import { lazy, Suspense } from 'react'
import FileTreePanel from '../panels/FileTreePanel'
import DataCatalogPanel from '../panels/DataCatalogPanel'
import EmptyPanel from '../panels/EmptyPanel'

// Lazy-load heavy panels to reduce initial bundle size.
// EditorPanel pulls tiptap+lowlight (~600KB), TerminalPanel pulls xterm (~300KB),
// CompanionPanel pulls pi-ai+pi-web-ui (~900KB), etc.
const LazyEditorPanel = lazy(() => import('../panels/EditorPanel'))
const LazyPotionPanel = lazy(() => import('../panels/PotionPanel'))
const LazyTerminalPanel = lazy(() => import('../panels/TerminalPanel'))
const LazyShellTerminalPanel = lazy(() => import('../panels/ShellTerminalPanel'))
const LazyReviewPanel = lazy(() => import('../panels/ReviewPanel'))
const LazyCompanionPanel = lazy(() => import('../panels/CompanionPanel'))

// Wrap lazy components with Suspense so DockView gets a valid component
function withSuspense(LazyComponent) {
  function SuspenseWrapper(props) {
    return (
      <Suspense fallback={<div className="panel-lazy-loading" />}>
        <LazyComponent {...props} />
      </Suspense>
    )
  }
  SuspenseWrapper.displayName = `Lazy(${LazyComponent.displayName || LazyComponent.name || 'Component'})`
  return SuspenseWrapper
}

const EditorPanel = withSuspense(LazyEditorPanel)
const PotionPanel = withSuspense(LazyPotionPanel)
const TerminalPanel = withSuspense(LazyTerminalPanel)
const ShellTerminalPanel = withSuspense(LazyShellTerminalPanel)
const ReviewPanel = withSuspense(LazyReviewPanel)
const CompanionPanel = withSuspense(LazyCompanionPanel)

/**
 * @typedef {Object} PaneConfig
 * @property {string} id - Unique identifier for the pane (lowercase, hyphenated)
 * @property {React.ComponentType} component - The React component to render
 * @property {string} title - Default title for the pane
 * @property {string} [icon] - Optional icon name
 * @property {string} [placement] - Default placement ('left', 'center', 'right', 'bottom')
 * @property {boolean} [essential] - If true, pane must exist in layout (default: false)
 * @property {boolean} [locked] - If true, pane group is locked (no close button) (default: false)
 * @property {boolean} [hideHeader] - If true, group header is hidden (default: false)
 * @property {string} [tabComponent] - Optional Dockview tab component key
 * @property {Object} [constraints] - Size constraints { minWidth, minHeight, collapsedWidth, collapsedHeight }
 * @property {string[]} [requiresFeatures] - Backend features this pane requires.
 *   Checked against capabilities.features from /api/capabilities.
 *   Common values: 'files', 'git'. Default: [] (no feature requirements)
 * @property {string[]} [requiresAnyFeatures] - Backend features where at least one must be enabled.
 *   Useful for panes that can run against multiple backends (e.g. companion OR pi).
 *   Checked against capabilities.features from /api/capabilities.
 *   Default: [] (no OR feature requirements)
 * @property {string[]} [requiresRouters] - Backend routers this pane requires.
 *   Checked against capabilities.features (routers are exposed as features).
 *   Common values: 'pty', 'chat_claude_code', 'approval'. Default: [] (no router requirements)
 */

/**
 * Registry for pane components.
 */
class PaneRegistry {
  constructor() {
    /** @type {Map<string, PaneConfig>} */
    this._panes = new Map()
    /** @type {Set<string>} */
    this._essentials = new Set()
  }

  /**
   * Register a new pane.
   * @param {PaneConfig} config - Pane configuration
   */
  register(config) {
    if (!config.id || !config.component) {
      throw new Error('Pane config must have id and component')
    }
    this._panes.set(config.id, config)
    if (Object.prototype.hasOwnProperty.call(config, 'essential')) {
      if (config.essential) {
        this._essentials.add(config.id)
      } else {
        this._essentials.delete(config.id)
      }
    }
  }

  /**
   * Get a pane configuration by ID.
   * @param {string} id - Pane identifier
   * @returns {PaneConfig|undefined}
   */
  get(id) {
    return this._panes.get(id)
  }

  /**
   * Get all registered pane IDs.
   * @returns {string[]}
   */
  listIds() {
    return Array.from(this._panes.keys())
  }

  /**
   * Get all registered pane configurations.
   * @returns {PaneConfig[]}
   */
  list() {
    return Array.from(this._panes.values())
  }

  /**
   * Get IDs of essential panes (must exist in layout).
   * @returns {string[]}
   */
  essentials() {
    return Array.from(this._essentials)
  }

  /**
   * Check if a pane ID is essential.
   * @param {string} id - Pane identifier
   * @returns {boolean}
   */
  isEssential(id) {
    return this._essentials.has(id)
  }

  /**
   * Check if a pane ID is registered.
   * @param {string} id - Pane identifier
   * @returns {boolean}
   */
  has(id) {
    return this._panes.has(id)
  }

  /**
   * Get components object for Dockview (id -> component mapping).
   * @returns {Object<string, React.ComponentType>}
   */
  getComponents() {
    const components = {}
    for (const [id, config] of this._panes) {
      components[id] = config.component
    }
    return components
  }

  /**
   * Get capability-gated components for Dockview.
   * Wraps each component with capability checking.
   * @param {function(string, React.ComponentType): React.ComponentType} gateFactory - Factory function to create gated components
   * @returns {Object<string, React.ComponentType>}
   */
  getGatedComponents(gateFactory) {
    const components = {}
    for (const [id, config] of this._panes) {
      // Only gate components that have requirements
      const hasRequirements =
        (config.requiresFeatures?.length > 0)
        || (config.requiresAnyFeatures?.length > 0)
        || (config.requiresRouters?.length > 0)
      components[id] = hasRequirements
        ? gateFactory(id, config.component)
        : config.component
    }
    return components
  }

  /**
   * Get set of known component names for validation.
   * @returns {Set<string>}
   */
  getKnownComponents() {
    return new Set(this._panes.keys())
  }

  /**
   * Get required features for a pane.
   * @param {string} id - Pane identifier
   * @returns {string[]}
   */
  getRequiredFeatures(id) {
    const pane = this._panes.get(id)
    return pane?.requiresFeatures || []
  }

  /**
   * Get OR-required features for a pane (at least one must be enabled).
   * @param {string} id - Pane identifier
   * @returns {string[]}
   */
  getRequiredAnyFeatures(id) {
    const pane = this._panes.get(id)
    return pane?.requiresAnyFeatures || []
  }

  /**
   * Get required routers for a pane.
   * @param {string} id - Pane identifier
   * @returns {string[]}
   */
  getRequiredRouters(id) {
    const pane = this._panes.get(id)
    return pane?.requiresRouters || []
  }

  /**
   * Check if a pane's requirements are satisfied.
   * @param {string} id - Pane identifier
   * @param {Object} capabilities - Capabilities from /api/capabilities endpoint
   * @returns {boolean}
   */
  checkRequirements(id, capabilities) {
    const pane = this._panes.get(id)
    if (!pane) return false

    const features = capabilities?.features || {}

    // Check required features
    const requiredFeatures = pane.requiresFeatures || []
    for (const feature of requiredFeatures) {
      if (!features[feature]) return false
    }

    // Check OR-required features (if configured, at least one must be enabled)
    const requiredAnyFeatures = pane.requiresAnyFeatures || []
    if (requiredAnyFeatures.length > 0) {
      const hasAny = requiredAnyFeatures.some((feature) => !!features[feature])
      if (!hasAny) return false
    }

    // Check required routers (routers are also exposed as features)
    const requiredRouters = pane.requiresRouters || []
    for (const router of requiredRouters) {
      if (!features[router]) return false
    }

    return true
  }

  /**
   * Get panes filtered by capability satisfaction.
   * @param {Object} capabilities - Capabilities from /api/capabilities endpoint
   * @returns {PaneConfig[]}
   */
  getAvailablePanes(capabilities) {
    return this.list().filter((pane) => this.checkRequirements(pane.id, capabilities))
  }

  /**
   * Get essential panes that have unmet requirements.
   * @param {Object} capabilities - Capabilities from /api/capabilities endpoint
   * @returns {PaneConfig[]}
   */
  getUnavailableEssentialPanes(capabilities) {
    return this.list().filter(
      (pane) => pane.essential && !this.checkRequirements(pane.id, capabilities),
    )
  }
}

/**
 * Create the default pane registry with all standard panels.
 *
 * Default panes and their capability requirements:
 * | Pane ID   | Essential | Placement | Requirements          |
 * |-----------|-----------|-----------|------------------------|
 * | filetree  | yes       | left      | files feature          |
 * | editor    | no        | center    | files feature          |
 * | potion    | no        | center    | files feature          |
 * | terminal  | no        | right     | chat_claude_code router|
 * | shell     | yes       | bottom    | pty router             |
 * | empty     | no        | center    | none                   |
 * | review    | no        | center    | approval router        |
 * | companion | no        | right     | companion feature      |
 *
 * @returns {PaneRegistry} Configured registry instance
 */
const createDefaultRegistry = () => {
  const registry = new PaneRegistry()

  // Data Catalog - left sidebar placeholder (above filetree)
  registry.register({
    id: 'data-catalog',
    component: DataCatalogPanel,
    title: 'Data Catalog',
    placement: 'left',
    essential: false,
    locked: true,
    hideHeader: true,
    constraints: {
      minWidth: 180,
    },
  })

  // File tree - left sidebar
  registry.register({
    id: 'filetree',
    component: FileTreePanel,
    title: 'Files',
    placement: 'left',
    essential: true,
    locked: true,
    hideHeader: true,
    constraints: {
      minWidth: 180,
      collapsedWidth: 48,
    },
    requiresFeatures: ['files'],
  })

  // Editor - center
  registry.register({
    id: 'editor',
    component: EditorPanel,
    title: 'Editor',
    placement: 'center',
    essential: false,
    requiresFeatures: ['files'],
  })

  // Potion markdown editor - center
  registry.register({
    id: 'potion',
    component: PotionPanel,
    title: 'Potion',
    placement: 'center',
    essential: false,
    requiresFeatures: ['files'],
  })

  // Terminal (Claude sessions) - right sidebar
  registry.register({
    id: 'terminal',
    component: TerminalPanel,
    title: 'Code Sessions',
    placement: 'right',
    essential: false,
    locked: false,
    hideHeader: true,
    constraints: {
      minWidth: 250,
      collapsedWidth: 48,
    },
    requiresRouters: ['chat_claude_code'],
  })

  // Shell - bottom of center column
  registry.register({
    id: 'shell',
    component: ShellTerminalPanel,
    tabComponent: 'noClose',
    title: 'Shell',
    placement: 'bottom',
    essential: true,
    locked: true,
    hideHeader: true,
    constraints: {
      minHeight: 100,
      collapsedHeight: 36,
    },
    requiresRouters: ['pty'],
  })

  // Empty placeholder - shown when no editors open
  registry.register({
    id: 'empty',
    component: EmptyPanel,
    title: '',
    placement: 'center',
    essential: false,
  })

  // Review panel - for approval requests
  registry.register({
    id: 'review',
    component: ReviewPanel,
    title: 'Review',
    placement: 'center',
    essential: false,
    requiresRouters: ['approval'],
  })

  // Agent (Companion backend) - alternative Claude chat panel (Direct Connect)
  registry.register({
    id: 'companion',
    component: CompanionPanel,
    title: 'Agent',
    placement: 'right',
    essential: false,
    locked: false,
    hideHeader: true,
    constraints: {
      minWidth: 250,
    },
    requiresAnyFeatures: ['companion', 'pi'],
  })

  return registry
}

// Default singleton registry
const defaultRegistry = createDefaultRegistry()

// Export the registry and helper functions
export { PaneRegistry, createDefaultRegistry }

// Default exports for convenience
export default defaultRegistry

// Re-export commonly used functions from default registry
export const registerPane = (config) => defaultRegistry.register(config)
export const getPane = (id) => defaultRegistry.get(id)
export const listPanes = () => defaultRegistry.list()
export const listPaneIds = () => defaultRegistry.listIds()
export const essentialPanes = () => defaultRegistry.essentials()
export const isEssential = (id) => defaultRegistry.isEssential(id)
export const hasPane = (id) => defaultRegistry.has(id)
export const getComponents = () => defaultRegistry.getComponents()
export const getGatedComponents = (gateFactory) => defaultRegistry.getGatedComponents(gateFactory)
export const getKnownComponents = () => defaultRegistry.getKnownComponents()
export const getRequiredFeatures = (id) => defaultRegistry.getRequiredFeatures(id)
export const getRequiredAnyFeatures = (id) => defaultRegistry.getRequiredAnyFeatures(id)
export const getRequiredRouters = (id) => defaultRegistry.getRequiredRouters(id)
export const checkRequirements = (id, capabilities) =>
  defaultRegistry.checkRequirements(id, capabilities)
export const getAvailablePanes = (capabilities) =>
  defaultRegistry.getAvailablePanes(capabilities)
export const getUnavailableEssentialPanes = (capabilities) =>
  defaultRegistry.getUnavailableEssentialPanes(capabilities)
