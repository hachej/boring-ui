/**
 * React hook for the auto-sync engine.
 *
 * Manages lifecycle (start/stop) and exposes reactive state.
 *
 * @module hooks/useAutoSync
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDataProvider } from '../providers/data/DataContext'
import { createAutoSyncEngine } from '../providers/data/autoSync'
import { queryKeys } from '../providers/data/queries'

/**
 * @typedef {Object} UseAutoSyncOptions
 * @property {boolean} [enabled=false]          - Whether auto-sync is active.
 * @property {number} [intervalMs=10000]        - Sync interval in ms.
 * @property {boolean} [pushEnabled=false]      - Push to remote after commit.
 * @property {boolean} [initialPull=false]      - Pull from remote on first start.
 * @property {import('../providers/data/types').GitAuthor} [author]
 * @property {import('../providers/data/types').GitRemoteOpts} [remoteOpts]
 */

/**
 * Hook to manage auto-sync for the current DataProvider.
 *
 * @param {UseAutoSyncOptions} [options]
 * @returns {{
 *   state: import('../providers/data/autoSync').SyncState,
 *   lastError: string|null,
 *   lastSyncTimestamp: number,
 *   syncNow: () => void,
 *   isSupported: boolean,
 * }}
 */
export const useAutoSync = (options = {}) => {
  const {
    enabled = false,
    intervalMs = 10_000,
    pushEnabled = false,
    initialPull = false,
    author,
    remoteOpts,
  } = options

  const provider = useDataProvider()
  const qc = useQueryClient()
  const engineRef = useRef(null)

  const [state, setState] = useState('disabled')
  const [lastError, setLastError] = useState(null)
  const [lastSyncTs, setLastSyncTs] = useState(0)

  // Check if the provider supports write ops
  const isSupported = useMemo(
    () =>
      typeof provider.git?.init === 'function' &&
      typeof provider.git?.add === 'function' &&
      typeof provider.git?.commit === 'function',
    [provider],
  )

  // Create/recreate engine when config changes
  useEffect(() => {
    if (!enabled || !isSupported) {
      if (engineRef.current) {
        engineRef.current.stop()
        engineRef.current = null
      }
      setState('disabled')
      return
    }

    const engine = createAutoSyncEngine(provider.git, {
      intervalMs,
      pushEnabled,
      initialPull,
      author,
      remoteOpts,
    })

    const unsub = engine.onStateChange((s, err) => {
      setState(s)
      setLastError(err || null)
      setLastSyncTs(engine.getLastSyncTimestamp())
      // Invalidate git queries after sync so UI refreshes
      if (s === 'idle') {
        qc.invalidateQueries({ queryKey: queryKeys.git.all })
      }
    })

    engineRef.current = engine
    engine.start()

    return () => {
      unsub()
      engine.stop()
      engineRef.current = null
    }
  }, [enabled, intervalMs, pushEnabled, initialPull, isSupported, provider, qc, author, remoteOpts])

  const syncNow = useCallback(() => {
    engineRef.current?.syncNow()
  }, [])

  return { state, lastError, lastSyncTimestamp: lastSyncTs, syncNow, isSupported }
}
