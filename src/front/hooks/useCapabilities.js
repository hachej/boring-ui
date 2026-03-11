/**
 * useCapabilities hook - Fetches and caches backend API capabilities.
 *
 * This hook fetches capabilities from /api/capabilities and provides
 * them to components for feature gating and conditional rendering.
 *
 * @module hooks/useCapabilities
 */

import { useState, useEffect, useCallback } from 'react'
import { apiFetchJson } from '../utils/transport'
import { routes } from '../utils/routes'

const UNKNOWN_CAPABILITIES = {
  version: 'unknown',
  features: {},
  routers: [],
}

/**
 * Capabilities response from /api/capabilities endpoint.
 *
 * Standard features (all exposed via features object):
 * - `files`: File system operations (read, write, rename, delete)
 * - `git`: Git operations (status, diff, show)
 * - `pty`: PTY WebSocket for shell terminals
 * - `chat_claude_code`: Claude stream WebSocket for AI chat
 * - `approval`: Approval request handling
 *
 * Note: Router capabilities are also exposed as features for simple checking.
 *
 * @typedef {Object} Capabilities
 * @property {string} version - API version (e.g., "0.1.0")
 * @property {Object<string, boolean>} features - Feature flags including router availability
 * @property {Array<{name: string, prefix: string, description: string, enabled: boolean}>} routers - Detailed router info
 */

/**
 * Hook to fetch and cache backend capabilities.
 *
 * @returns {{
 *   capabilities: Capabilities|null,
 *   loading: boolean,
 *   error: Error|null,
 *   refetch: () => Promise<void>
 * }}
 */
export const useCapabilities = () => {
  const [capabilities, setCapabilities] = useState(UNKNOWN_CAPABILITIES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchCapabilities = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const route = routes.capabilities.get()
      const { response, data } = await apiFetchJson(route.path, { query: route.query })
      if (!response.ok) {
        throw new Error(`Failed to fetch capabilities: ${response.status}`)
      }

      setCapabilities(data)
    } catch (err) {
      console.error('[Capabilities] Failed to fetch:', err)
      setError(err)
      // Preserve last known-good capabilities if available.
      setCapabilities((prev) => (
        prev || {
          ...UNKNOWN_CAPABILITIES,
        }
      ))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCapabilities()
  }, [fetchCapabilities])

  // If initial fetch failed (empty features), keep retrying until we get
  // a real capabilities payload so panes recover without a hard refresh.
  useEffect(() => {
    const featureCount = Object.keys(capabilities?.features || {}).length
    if (loading || featureCount > 0) return

    const timer = setTimeout(() => {
      fetchCapabilities()
    }, 2000)
    return () => clearTimeout(timer)
  }, [capabilities, loading, fetchCapabilities])

  return {
    capabilities,
    loading,
    error,
    refetch: fetchCapabilities,
  }
}

/**
 * Check if a feature is enabled in capabilities.
 *
 * @param {Capabilities|null} capabilities - Capabilities object
 * @param {string} feature - Feature name to check
 * @returns {boolean}
 */
export const isFeatureEnabled = (capabilities, feature) => {
  return capabilities?.features?.[feature] ?? false
}

/**
 * Check if all required features are enabled.
 *
 * @param {Capabilities|null} capabilities - Capabilities object
 * @param {string[]} features - Feature names to check
 * @returns {boolean}
 */
export const areAllFeaturesEnabled = (capabilities, features) => {
  if (!features || features.length === 0) return true
  return features.every((f) => isFeatureEnabled(capabilities, f))
}

export default useCapabilities
