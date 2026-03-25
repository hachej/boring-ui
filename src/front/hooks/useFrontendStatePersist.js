/**
 * useFrontendStatePersist — publishes UI state snapshots to the backend.
 *
 * Extracted from App.jsx. Encapsulates:
 * - Client ID generation (stable per storage prefix)
 * - Unavailability tracking (stops polling after 404/405)
 * - Publish function (fetch or navigator.sendBeacon)
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether ui_state feature is enabled
 * @param {string} options.storagePrefix - Storage prefix for client ID scoping
 * @returns {{ publish: Function, clientIdRef: React.MutableRefObject, unavailableRef: React.MutableRefObject }}
 */
import { useCallback, useRef, useEffect } from 'react'
import { apiFetch } from '../utils/transport'
import { buildApiUrl } from '../utils/apiBase'
import { routes } from '../utils/routes'
import {
  collectFrontendStateSnapshot,
  getFrontendStateClientId,
} from '../utils/frontendState'

export default function useFrontendStatePersist({ enabled = false, storagePrefix = '' } = {}) {
  const clientIdRef = useRef('')
  const unavailableRef = useRef(false)
  const storagePrefixRef = useRef(storagePrefix)
  storagePrefixRef.current = storagePrefix

  // Initialize client ID
  if (!clientIdRef.current && storagePrefix) {
    clientIdRef.current = getFrontendStateClientId(storagePrefix)
  }

  // Reset on storagePrefix change
  useEffect(() => {
    if (storagePrefix) {
      clientIdRef.current = getFrontendStateClientId(storagePrefix)
      unavailableRef.current = false
    }
  }, [storagePrefix])

  /**
   * Publish current UI state snapshot to the backend.
   *
   * @param {Object} dockApi - DockView API instance
   * @param {Object} [options]
   * @param {boolean} [options.force] - Bypass unavailability check
   * @param {'fetch'|'beacon'} [options.transport] - Transport method
   * @param {string} [options.projectRoot] - Project root for snapshot
   * @returns {Promise<boolean>} Whether publish succeeded
   */
  const publish = useCallback(async (dockApi, options = {}) => {
    if (!dockApi) return false
    if (!enabled) return false

    const force = options.force === true
    const transport = options.transport === 'beacon' ? 'beacon' : 'fetch'
    const projectRoot = options.projectRoot || ''

    if (unavailableRef.current && !force) {
      return false
    }

    if (!clientIdRef.current) {
      clientIdRef.current = getFrontendStateClientId(storagePrefixRef.current)
    }

    const route = routes.uiState.upsert()
    const snapshot = collectFrontendStateSnapshot(
      dockApi,
      clientIdRef.current,
      projectRoot,
    )

    if (
      transport === 'beacon'
      && typeof navigator !== 'undefined'
      && typeof navigator.sendBeacon === 'function'
    ) {
      try {
        const body = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
        return navigator.sendBeacon(buildApiUrl(route.path, route.query), body)
      } catch {
        return false
      }
    }

    try {
      const response = await apiFetch(route.path, {
        query: route.query,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
        keepalive: true,
      })
      if (response.ok) {
        unavailableRef.current = false
        return true
      }
      if (response.status === 404 || response.status === 405) {
        unavailableRef.current = true
      }
    } catch {
      // Ignore transient publish failures (network/server startup races).
    }
    return false
  }, [enabled])

  return {
    /** Publish UI state snapshot */
    publish,
    /** Ref to the current client ID (stable per storagePrefix) */
    clientIdRef,
    /** Ref tracking whether the backend has the ui_state endpoint */
    unavailableRef,
  }
}
