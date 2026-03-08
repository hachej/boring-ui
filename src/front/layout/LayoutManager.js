/**
 * Layout Manager - Handles Dockview layout persistence and restoration.
 *
 * This module extracts layout management logic from App.jsx to provide
 * a cleaner separation of concerns and enable future layout customization.
 *
 * @module layout/LayoutManager
 */

import { essentialPanes } from '../registry/panes'

// Layout version - increment to force layout reset on breaking changes
export const LAYOUT_VERSION = 22

// Default storage key prefix (can be overridden via config)
const DEFAULT_STORAGE_PREFIX = 'boring-ui'

/**
 * Layout migration registry.
 * Maps [fromVersion, toVersion] -> migration function.
 *
 * Migration functions receive the old layout and return the migrated layout.
 * If no migration exists for a version jump, the layout resets to defaults.
 *
 * @type {Map<string, function(Object): Object>}
 */
const layoutMigrations = new Map()

/**
 * Register a layout migration.
 * @param {number} fromVersion - Source version
 * @param {number} toVersion - Target version
 * @param {function(Object): Object} migrator - Migration function
 */
export const registerLayoutMigration = (fromVersion, toVersion, migrator) => {
  layoutMigrations.set(`${fromVersion}->${toVersion}`, migrator)
}

/**
 * Attempt to migrate a layout from oldVersion to LAYOUT_VERSION.
 * Returns migrated layout if migration path exists, null otherwise.
 *
 * @param {Object} layout - Old layout object
 * @param {number} oldVersion - Old layout version
 * @returns {Object|null} Migrated layout or null if no migration path
 */
export const migrateLayout = (layout, oldVersion) => {
  if (oldVersion >= LAYOUT_VERSION) {
    return layout // No migration needed
  }

  // Try direct migration first
  const directKey = `${oldVersion}->${LAYOUT_VERSION}`
  if (layoutMigrations.has(directKey)) {
    console.info(`[Layout] Migrating from v${oldVersion} to v${LAYOUT_VERSION}`)
    try {
      const migrated = layoutMigrations.get(directKey)(layout)
      return {
        ...migrated,
        version: LAYOUT_VERSION,
      }
    } catch (err) {
      console.error('[Layout] Migration failed:', err)
      return null
    }
  }

  // Try step-by-step migration
  let currentLayout = layout
  let currentVersion = oldVersion

  while (currentVersion < LAYOUT_VERSION) {
    // Find next migration step
    let foundStep = false
    for (let nextVersion = currentVersion + 1; nextVersion <= LAYOUT_VERSION; nextVersion++) {
      const stepKey = `${currentVersion}->${nextVersion}`
      if (layoutMigrations.has(stepKey)) {
        console.info(`[Layout] Migrating from v${currentVersion} to v${nextVersion}`)
        try {
          currentLayout = layoutMigrations.get(stepKey)(currentLayout)
          currentVersion = nextVersion
          foundStep = true
          break
        } catch (err) {
          console.error('[Layout] Migration step failed:', err)
          return null
        }
      }
    }

    if (!foundStep) {
      // No migration path available - fall back to reset
      console.info(`[Layout] No migration path from v${currentVersion} to v${LAYOUT_VERSION}`)
      return null
    }
  }

  // Update version in migrated layout
  return {
    ...currentLayout,
    version: LAYOUT_VERSION,
  }
}

/**
 * Generate a short hash from the project root path for localStorage keys.
 * @param {string} root - Project root path
 * @returns {string} Short hash string
 */
export const hashProjectRoot = (root) => {
  if (!root) return 'default'
  let hash = 0
  for (let i = 0; i < root.length; i++) {
    const char = root.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

/**
 * Generate storage key for project-specific data.
 * @param {string} prefix - Storage key prefix (from config)
 * @param {string} projectRoot - Project root path
 * @param {string} suffix - Key suffix (e.g., 'layout', 'tabs')
 * @returns {string} Full storage key
 */
export const getStorageKey = (prefix, projectRoot, suffix) =>
  `${prefix || DEFAULT_STORAGE_PREFIX}-${hashProjectRoot(projectRoot)}-${suffix}`

/**
 * Get shared storage key (UI preferences, not project-specific).
 * @param {string} prefix - Storage key prefix (from config)
 * @param {string} suffix - Key suffix
 * @returns {string} Full storage key
 */
export const getSharedStorageKey = (prefix, suffix) =>
  `${prefix || DEFAULT_STORAGE_PREFIX}-${suffix}`

// Legacy keys for backwards compatibility
export const SIDEBAR_COLLAPSED_KEY = `${DEFAULT_STORAGE_PREFIX}-sidebar-collapsed`
export const PANEL_SIZES_KEY = `${DEFAULT_STORAGE_PREFIX}-panel-sizes`

/**
 * Validate layout structure to detect drift from expected configuration.
 * Returns true if layout is valid, false if it has drifted.
 *
 * @param {Object} layout - Layout object from Dockview toJSON()
 * @returns {boolean} True if layout is valid
 */
export const validateLayoutStructure = (layout) => {
  if (!layout?.grid || !layout?.panels) return false

  const essentials = essentialPanes()
  const panels = layout.panels
  const panelIds = Object.keys(panels)

  // Check all essential panels exist
  for (const essentialId of essentials) {
    if (!panelIds.includes(essentialId)) {
      console.warn(`[Layout drift] Missing essential panel: ${essentialId}`)
      return false
    }
  }

  return true
}

/**
 * Load saved tabs from localStorage.
 * @param {string} prefix - Storage key prefix (from config)
 * @param {string} projectRoot - Project root path
 * @returns {string[]} Array of file paths
 */
export const loadSavedTabs = (prefix, projectRoot) => {
  try {
    const saved = localStorage.getItem(getStorageKey(prefix, projectRoot, 'tabs'))
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (err) {
    console.warn('[Layout] Error loading saved tabs:', err.message)
  }
  return []
}

/**
 * Save open tabs to localStorage.
 * @param {string} prefix - Storage key prefix (from config)
 * @param {string} projectRoot - Project root path
 * @param {string[]} paths - Array of file paths
 */
export const saveTabs = (prefix, projectRoot, paths) => {
  try {
    localStorage.setItem(getStorageKey(prefix, projectRoot, 'tabs'), JSON.stringify(paths))
  } catch (err) {
    console.warn('[Layout] Error saving tabs:', err.message)
  }
}

/**
 * Load lastKnownGoodLayout from localStorage for recovery.
 * Returns null if no valid backup exists.
 *
 * @param {string} prefix - Storage key prefix (from config)
 * @param {string} projectRoot - Project root path
 * @returns {Object|null} Layout object or null
 */
export const loadLastKnownGoodLayout = (prefix, projectRoot) => {
  try {
    const raw = localStorage.getItem(getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout'))
    if (!raw) return null
    const parsed = JSON.parse(raw)

    // Validate the backup layout
    if (!parsed?.version || parsed.version < LAYOUT_VERSION) {
      console.info('[Layout] lastKnownGoodLayout has outdated version, skipping')
      return null
    }
    if (!validateLayoutStructure(parsed)) {
      console.warn('[Layout] lastKnownGoodLayout failed validation, skipping')
      return null
    }

    return parsed
  } catch (err) {
    console.error('[Layout] Error loading lastKnownGoodLayout:', err.message)
    return null
  }
}

/**
 * Load layout from localStorage.
 * Returns null if layout is invalid, outdated, or missing.
 *
 * @param {string} prefix - Storage key prefix (from config)
 * @param {string} projectRoot - Project root path
 * @param {Set<string>} [knownComponents] - Optional set of known component names
 * @param {number} [configLayoutVersion] - Optional layout version from config (for user-controlled resets)
 * @returns {Object|null} Layout object or null
 */
export const loadLayout = (prefix, projectRoot, knownComponents, configLayoutVersion) => {
  try {
    const raw = localStorage.getItem(getStorageKey(prefix, projectRoot, 'layout'))
    if (!raw) return null
    let parsed = JSON.parse(raw)

    // Check internal format version - attempt migration if outdated
    if (!parsed?.version || parsed.version < LAYOUT_VERSION) {
      const oldVersion = parsed?.version || 0
      const migrated = migrateLayout(parsed, oldVersion)

      if (migrated) {
        // Migration successful - save and use migrated layout
        console.info(`[Layout] Successfully migrated from v${oldVersion} to v${LAYOUT_VERSION}`)
        localStorage.setItem(getStorageKey(prefix, projectRoot, 'layout'), JSON.stringify(migrated))
        parsed = migrated
      } else {
        // No migration path - try lastKnownGoodLayout before falling back to defaults
        console.info('[Layout] Format version outdated with no migration path, attempting recovery')
        localStorage.removeItem(getStorageKey(prefix, projectRoot, 'layout'))
        const recovered = loadLastKnownGoodLayout(prefix, projectRoot)
        if (recovered) {
          // Persist recovered layout so it's not lost on next load
          localStorage.setItem(getStorageKey(prefix, projectRoot, 'layout'), JSON.stringify(recovered))
          console.info('[Layout] Recovered from lastKnownGoodLayout after migration failure')
          return recovered
        }
        console.info('[Layout] No valid backup found, falling back to defaults')
        return null
      }
    }

    // Check config layout version - force reset if user bumped their layoutVersion
    // Treat missing configVersion as version 1 (default) for backwards compatibility
    const savedConfigVersion = parsed?.configVersion ?? 1
    if (configLayoutVersion && savedConfigVersion !== configLayoutVersion) {
      console.info('[Layout] Config version changed, resetting layout')
      localStorage.removeItem(getStorageKey(prefix, projectRoot, 'layout'))
      return null
    }

    // Check for unknown components if knownComponents provided
    if (knownComponents && parsed?.panels && typeof parsed.panels === 'object') {
      const panels = Object.values(parsed.panels)
      const hasUnknown = panels.some(
        (panel) =>
          panel?.contentComponent &&
          !knownComponents.has(panel.contentComponent),
      )
      if (hasUnknown) {
        console.info('[Layout] Unknown components found, resetting layout')
        localStorage.removeItem(getStorageKey(prefix, projectRoot, 'layout'))
        return null
      }
    }

    // Validate layout structure to detect drift
    if (!validateLayoutStructure(parsed)) {
      console.info('[Layout] Structure drift detected, attempting recovery')
      localStorage.removeItem(getStorageKey(prefix, projectRoot, 'layout'))
      // Try lastKnownGoodLayout before giving up
      const recovered = loadLastKnownGoodLayout(prefix, projectRoot)
      if (recovered) {
        // Persist recovered layout so it's not lost on next load
        localStorage.setItem(getStorageKey(prefix, projectRoot, 'layout'), JSON.stringify(recovered))
        console.info('[Layout] Successfully recovered from lastKnownGoodLayout')
        return recovered
      }
      console.info('[Layout] No valid backup found, falling back to defaults')
      return null
    }

    return parsed
  } catch (err) {
    console.error('[Layout] Error loading layout:', err)
    // Try lastKnownGoodLayout as fallback
    const recovered = loadLastKnownGoodLayout(prefix, projectRoot)
    if (recovered) {
      // Persist recovered layout so it's not lost on next load
      try {
        localStorage.setItem(getStorageKey(prefix, projectRoot, 'layout'), JSON.stringify(recovered))
      } catch {
        // Ignore save errors during error recovery
      }
      console.info('[Layout] Recovered from lastKnownGoodLayout after error')
      return recovered
    }
    return null
  }
}

/**
 * Save layout to localStorage.
 * Also saves as lastKnownGoodLayout if the layout is valid.
 *
 * @param {string} prefix - Storage key prefix (from config)
 * @param {string} projectRoot - Project root path
 * @param {Object} layout - Layout object from Dockview toJSON()
 * @param {number} [configLayoutVersion] - Optional layout version from config
 */
export const saveLayout = (prefix, projectRoot, layout, configLayoutVersion) => {
  try {
    const layoutWithVersion = {
      ...layout,
      version: LAYOUT_VERSION,
      configVersion: configLayoutVersion || 1,
      savedAt: Date.now(),
    }
    localStorage.setItem(getStorageKey(prefix, projectRoot, 'layout'), JSON.stringify(layoutWithVersion))

    // If layout is valid, also save as lastKnownGoodLayout for recovery
    if (validateLayoutStructure(layout)) {
      localStorage.setItem(
        getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout'),
        JSON.stringify(layoutWithVersion)
      )
    }
  } catch (err) {
    console.error('[Layout] Error saving layout:', err.message)
  }
}

/**
 * Clear the lastKnownGoodLayout (for testing or manual reset).
 *
 * @param {string} prefix - Storage key prefix (from config)
 * @param {string} projectRoot - Project root path
 */
export const clearLastKnownGoodLayout = (prefix, projectRoot) => {
  try {
    localStorage.removeItem(getStorageKey(prefix, projectRoot, 'lastKnownGoodLayout'))
  } catch (err) {
    console.warn('[Layout] Error clearing lastKnownGoodLayout:', err.message)
  }
}

/**
 * Load collapsed state from localStorage.
 * @param {string} [prefix] - Storage key prefix (from config)
 * @returns {Object} Collapsed state { filetree: boolean, terminal: boolean, shell: boolean }
 */
export const loadCollapsedState = (prefix) => {
  const key = prefix
    ? getSharedStorageKey(prefix, 'sidebar-collapsed')
    : SIDEBAR_COLLAPSED_KEY
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (err) {
    console.warn('[Layout] Error loading collapsed state:', err.message)
  }
  return { filetree: false, terminal: false, shell: false }
}

/**
 * Save collapsed state to localStorage.
 * @param {Object} state - Collapsed state
 * @param {string} [prefix] - Storage key prefix (from config)
 */
export const saveCollapsedState = (state, prefix) => {
  const key = prefix
    ? getSharedStorageKey(prefix, 'sidebar-collapsed')
    : SIDEBAR_COLLAPSED_KEY
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch (err) {
    console.warn('[Layout] Error saving collapsed state:', err.message)
  }
}

/**
 * Load panel sizes from localStorage.
 * @param {string} [prefix] - Storage key prefix (from config)
 * @returns {Object} Panel sizes { filetree: number, terminal: number, shell: number }
 */
export const loadPanelSizes = (prefix) => {
  const key = prefix
    ? getSharedStorageKey(prefix, 'panel-sizes')
    : PANEL_SIZES_KEY
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (err) {
    console.warn('[Layout] Error loading panel sizes:', err.message)
  }
  return { filetree: 280, terminal: 400, shell: 250 }
}

/**
 * Save panel sizes to localStorage.
 * @param {Object} sizes - Panel sizes
 * @param {string} [prefix] - Storage key prefix (from config)
 */
export const savePanelSizes = (sizes, prefix) => {
  const key = prefix
    ? getSharedStorageKey(prefix, 'panel-sizes')
    : PANEL_SIZES_KEY
  try {
    localStorage.setItem(key, JSON.stringify(sizes))
  } catch (err) {
    console.warn('[Layout] Error saving panel sizes:', err.message)
  }
}

/**
 * Prune empty groups from Dockview layout.
 * @param {Object} api - Dockview API
 * @param {Set<string>} knownComponents - Set of known component names
 * @returns {boolean} True if any groups were removed
 */
export const pruneEmptyGroups = (api, knownComponents) => {
  if (!api || !Array.isArray(api.groups)) return false
  const groups = [...api.groups]
  let removed = false

  groups.forEach((group) => {
    const panels = Array.isArray(group?.panels) ? group.panels : []
    if (panels.length === 0) {
      api.removeGroup(group)
      removed = true
      return
    }
    const hasKnownPanel = panels.some((panel) =>
      knownComponents.has(panel?.api?.component),
    )
    if (!hasKnownPanel) {
      api.removeGroup(group)
      removed = true
    }
  })

  return removed
}

/**
 * Check if a saved layout exists in localStorage for a given prefix.
 * Used to determine if onReady should create panels or wait for layout restoration.
 *
 * @param {string} prefix - Storage key prefix (from config)
 * @returns {{ hasSaved: boolean, invalidFound: boolean }}
 */
export const checkForSavedLayout = (prefix) => {
  const storagePrefix = prefix || DEFAULT_STORAGE_PREFIX
  let hasSavedLayout = false
  let invalidLayoutFound = false

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(`${storagePrefix}-`) && key.endsWith('-layout')) {
        const raw = localStorage.getItem(key)
        if (raw) {
          const parsed = JSON.parse(raw)
          const hasValidVersion = parsed?.version >= LAYOUT_VERSION
          const hasPanels = !!parsed?.panels
          const hasValidStructure = validateLayoutStructure(parsed)

          // Check if layout is valid
          if (hasValidVersion && hasPanels && hasValidStructure) {
            hasSavedLayout = true
            break
          }

          // Invalid layout detected - clean up
          if (!hasValidStructure || !hasValidVersion || !hasPanels) {
            console.warn('[Layout] Invalid layout detected, clearing:', key)
            localStorage.removeItem(key)
            // Clear related session storage
            const keyPrefix = key.replace('-layout', '')
            localStorage.removeItem(`${keyPrefix}-tabs`)
            localStorage.removeItem(`${storagePrefix}-terminal-sessions`)
            localStorage.removeItem(`${storagePrefix}-terminal-active`)
            localStorage.removeItem(`${storagePrefix}-terminal-chat-interface`)
            invalidLayoutFound = true
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Layout] Error checking for saved layouts:', err.message)
  }

  return { hasSaved: hasSavedLayout, invalidFound: invalidLayoutFound }
}

/**
 * Get file name from path.
 * @param {string} path - File path
 * @returns {string} File name
 */
export const getFileName = (path) => {
  const parts = path.split('/')
  return parts[parts.length - 1]
}

/**
 * Default panel constraints for each panel type.
 */
export const DEFAULT_CONSTRAINTS = {
  filetree: { minimumWidth: 180, collapsedWidth: 48 },
  terminal: { minimumWidth: 250, collapsedWidth: 48 },
  shell: { minimumHeight: 100, collapsedHeight: 36 },
  center: { minimumHeight: 200 },
}

/**
 * Create the default layout configuration.
 * Layout goal: [filetree | [editor / shell] | terminal]
 *
 * @returns {Object} Default layout configuration
 */
export const getDefaultLayoutConfig = () => ({
  filetree: {
    position: null, // First panel, no position needed
    title: 'Files',
    locked: true,
    hideHeader: true,
  },
  terminal: {
    position: { direction: 'right', referencePanel: 'filetree' },
    title: 'Code Sessions',
    locked: true,
    hideHeader: true,
  },
  empty: {
    position: { direction: 'left', referencePanel: 'terminal' },
    title: '',
    hideHeader: true,
  },
  shell: {
    position: { direction: 'below', referenceGroup: 'empty' },
    title: 'Shell',
    locked: true,
    hideHeader: false,
    tabComponent: 'noClose',
  },
})
