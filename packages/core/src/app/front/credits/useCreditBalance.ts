import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreditBalanceResponse } from './helpers.js'

/** Window event other code can dispatch to force an immediate balance refetch —
 * e.g. the chat dispatching `window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT))`
 * when a run finishes, so the balance updates without waiting for the poll. */
export const CREDITS_REFRESH_EVENT = 'credits:refresh'

export interface UseCreditBalanceOptions {
  /** Base URL for the credits API (default: same origin). */
  apiBaseUrl?: string
  /** Poll interval for the balance, ms (default 30s). */
  pollMs?: number
  /** Credit pack id to purchase (server maps it to a Lemon Squeezy variant). */
  pack?: string
}

export interface UseCreditBalanceResult {
  /** Latest balance, or null before the first successful load. */
  balance: CreditBalanceResponse | null
  /** True when credits are disabled or the user is unauthenticated (UI should hide). */
  hidden: boolean
  /** Refetch the balance now. */
  refresh: () => Promise<void>
  /** Start a Lemon Squeezy checkout (server creates it, sets the buyer id from the
   * session) and open it in a new tab. Resolves to an error message on failure. */
  buy: () => Promise<string | null>
  /** True while a checkout request is in flight. */
  buying: boolean
}

/**
 * Shared credit-balance state for the top-bar badge and the settings panel:
 * polls `/api/credits/balance`, refetches on window focus and on the
 * `credits:refresh` event, and exposes a server-side checkout action. The buyer
 * id is set SERVER-side (POST /api/credits/checkout) so the client never supplies it.
 */
export function useCreditBalance({
  apiBaseUrl = '',
  pollMs = 30_000,
  pack,
}: UseCreditBalanceOptions = {}): UseCreditBalanceResult {
  const [balance, setBalance] = useState<CreditBalanceResponse | null>(null)
  const [hidden, setHidden] = useState(false)
  const [buying, setBuying] = useState(false)
  const buyingRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/credits/balance`, { credentials: 'include' })
      if (res.status === 401) {
        setHidden(true)
        return
      }
      if (!res.ok) return
      const data = (await res.json()) as CreditBalanceResponse
      if (!data.enabled) {
        setHidden(true)
        return
      }
      setBalance(data)
      setHidden(false)
    } catch {
      // Network blip — keep the last known balance.
    }
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), pollMs)
    const onFocus = () => void refresh()
    const onRefreshEvent = () => void refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener(CREDITS_REFRESH_EVENT, onRefreshEvent)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(CREDITS_REFRESH_EVENT, onRefreshEvent)
    }
  }, [refresh, pollMs])

  const buy = useCallback(async (): Promise<string | null> => {
    if (buyingRef.current) return null
    buyingRef.current = true
    setBuying(true)
    try {
      const res = await fetch(`${apiBaseUrl}/api/credits/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pack ? { pack } : {}),
      })
      if (!res.ok) return 'Could not start checkout. Please try again.'
      const { url } = (await res.json()) as { url?: string }
      if (!url) return 'Checkout is not available right now.'
      window.open(url, '_blank', 'noopener,noreferrer')
      return null
    } catch {
      return 'Could not reach the checkout service. Please try again.'
    } finally {
      buyingRef.current = false
      setBuying(false)
    }
  }, [apiBaseUrl, pack])

  return { balance, hidden, refresh, buy, buying }
}
