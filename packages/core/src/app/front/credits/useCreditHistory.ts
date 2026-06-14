import { useCallback, useState } from 'react'
import type { CreditLedgerEntry } from './helpers.js'

export interface UseCreditHistoryResult {
  entries: CreditLedgerEntry[] | null
  loading: boolean
  error: boolean
  /** Fetch (or refetch) the activity. Call lazily, e.g. when the section expands. */
  load: () => Promise<void>
}

/**
 * Lazy loader for the account credit-activity list (`GET /api/credits/history`).
 * Does NOT fetch on mount — call `load()` when the section is opened. `entries` is
 * null until the first load; `[]` means "no activity yet".
 */
export function useCreditHistory(apiBaseUrl = '', limit = 20): UseCreditHistoryResult {
  const [entries, setEntries] = useState<CreditLedgerEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`${apiBaseUrl}/api/credits/history?limit=${encodeURIComponent(String(limit))}`, { credentials: 'include' })
      if (!res.ok) {
        setError(true)
        return
      }
      const data = (await res.json()) as { entries?: CreditLedgerEntry[] }
      setEntries(Array.isArray(data.entries) ? data.entries : [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, limit])

  return { entries, loading, error, load }
}
