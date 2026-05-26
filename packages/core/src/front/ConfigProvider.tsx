import { createContext, useContext, useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { RuntimeConfig } from '../shared/types.js'
import { ConfigFetchError } from '../shared/errors.js'
import { apiFetchJson } from './utils.js'

const ConfigContext = createContext<RuntimeConfig | null>(null)

const DEFAULT_BACKOFF_MS = [500, 1000, 2000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchConfigWithRetry(
  backoffMs: number[],
): Promise<RuntimeConfig> {
  const maxRetries = backoffMs.length
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiFetchJson<RuntimeConfig>('/api/v1/config')
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        await sleep(backoffMs[attempt])
      }
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : 'Failed to load config'
  const requestId =
    lastError && typeof lastError === 'object' && 'requestId' in lastError
      ? (lastError as { requestId?: string }).requestId
      : undefined

  throw new ConfigFetchError(message, requestId)
}

export interface ConfigProviderProps {
  children: ReactNode
  /** @internal Override retry backoff delays (ms). Default: [500, 1000, 2000]. */
  retryBackoff?: number[]
}

export function ConfigProvider({
  children,
  retryBackoff = DEFAULT_BACKOFF_MS,
}: ConfigProviderProps) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [error, setError] = useState<ConfigFetchError | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    fetchConfigWithRetry(retryBackoff)
      .then(setConfig)
      .catch((err: unknown) => {
        setError(
          err instanceof ConfigFetchError
            ? err
            : new ConfigFetchError(
                err instanceof Error ? err.message : 'Unknown error',
              ),
        )
      })
  }, [])

  if (error) throw error

  if (!config) return null

  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  )
}

export function useConfig(): RuntimeConfig {
  const ctx = useContext(ConfigContext)
  if (!ctx)
    throw new Error('useConfig must be used within a ConfigProvider')
  return ctx
}

export function useOptionalConfig(): RuntimeConfig | null {
  return useContext(ConfigContext)
}

export function useConfigLoaded(): boolean {
  return useContext(ConfigContext) !== null
}
