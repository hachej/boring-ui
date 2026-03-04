/**
 * App configuration system for boring-ui.
 *
 * Provides a merged configuration from app.config.js with sensible defaults.
 * All defaults match the current behavior so the app looks identical without config.
 */

// Default configuration matching current app behavior
const DEFAULT_CONFIG = {
  // App branding
  branding: {
    name: 'Boring UI',
    logo: 'B',
    titleFormat: (ctx) => ctx.folder ? `${ctx.folder} - Boring UI` : 'Boring UI',
  },

  // FileTree configuration
  fileTree: {
    sections: [
      { key: 'files', label: 'Files', icon: 'Folder' },
    ],
    configFiles: ['*.config', '*.config.js', 'README.md'],
    gitPollInterval: 5000,
    treePollInterval: 3000,
  },

  // LocalStorage key configuration
  storage: {
    prefix: 'boring-ui',
    layoutVersion: 1,
  },

  // Panel configuration
  panels: {
    essential: ['filetree', 'terminal', 'shell'],
    defaults: {
      filetree: 280,
      terminal: 400,
      companion: 400,
      shell: 250,
    },
    min: {
      filetree: 180,
      terminal: 250,
      companion: 250,
      shell: 100,
      center: 200, // Minimum height for the center/main content area
    },
    collapsed: {
      filetree: 48,
      terminal: 48,
      companion: 48,
      shell: 36,
    },
  },

  // Optional initial DockView layout override
  defaultLayout: null,

  // API configuration
  api: {
    baseUrl: '',
  },

  // Data backend selection.
  // - 'http' uses the built-in HTTP provider.
  // - Any other value resolves through a host-registered provider factory.
  data: {
    backend: 'http',
  },

  // Feature flags
  features: {
    gitStatus: true,
    search: true,
    cloudMode: false,
    workflows: false,
    controlPlaneOnboarding: false,
    // Right-rail agent chat mode: 'all' | 'native' | 'companion' | 'pi'
    agentRailMode: 'all',
  },

  // Design token customization (CSS variables)
  // These values override the CSS defaults in styles.css
  styles: {
    light: {
      // Accent colors (default: Claude orange from styles.css)
      // accent: '#ea580c',
      // accentHover: '#c2410c',
      // accentLight: '#fff7ed',
      // Typography (uses CSS defaults if not specified)
      // fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      // fontMono: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
    },
    dark: {
      // Accent colors (default: vibrant orange for dark mode)
      // accent: '#fb923c',
      // accentHover: '#fdba74',
      // accentLight: '#431407',
    },
  },
}

/**
 * Deep merge two objects.
 * Arrays are replaced, not merged.
 */
function deepMerge(target, source) {
  const result = { ...target }

  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue)
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue
    }
  }

  return result
}

let _config = null

/**
 * Load the app configuration.
 *
 * Returns default config. To customize, pass config to ConfigProvider.
 *
 * @param {object} [userConfig] - Optional user config to merge with defaults
 * @returns {Promise<object>} The merged configuration
 */
export async function loadConfig(userConfig = {}) {
  if (_config && Object.keys(userConfig).length === 0) {
    return _config
  }

  _config = deepMerge(DEFAULT_CONFIG, userConfig)
  return _config
}

/**
 * Get the current config synchronously.
 *
 * Returns null if config hasn't been loaded yet.
 * Use loadConfig() for async loading.
 *
 * @returns {object|null} The config or null if not loaded
 */
export function getConfig() {
  return _config
}

/**
 * Get the default config (useful for reference/testing).
 *
 * @returns {object} The default configuration
 */
export function getDefaultConfig() {
  return { ...DEFAULT_CONFIG }
}

/**
 * Reset config (for testing).
 */
export function resetConfig() {
  _config = null
}

/**
 * Set config directly (for testing or programmatic setup).
 *
 * @param {object} config - Config to merge with defaults
 */
export function setConfig(config) {
  _config = deepMerge(DEFAULT_CONFIG, config)
  return _config
}
