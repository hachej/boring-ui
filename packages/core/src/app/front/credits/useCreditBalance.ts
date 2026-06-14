import { useCallback, useEffect, useRef, useState } from 'react'
import { creditNetMicros, type CreditBalanceResponse } from './helpers.js'

/** Window event other code can dispatch to force an immediate balance refetch —
 * e.g. the chat dispatching `window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT))`
 * when a run finishes, so the balance updates without waiting for the poll. */
export const CREDITS_REFRESH_EVENT = 'credits:refresh'

/** localStorage key holding the NET balance captured immediately BEFORE a checkout is
 * opened. localStorage (not sessionStorage) because the hosted checkout opens/redirects
 * in a SEPARATE tab, which needs to read the opener tab's baseline. The post-checkout
 * return handler confirms only on a real net increase vs this baseline — and never
 * confirms when it can't establish one (so a spoofed ?checkout=return can't fake success). */
export const CHECKOUT_BASELINE_STORAGE_KEY = 'credits:checkout-baseline'

/** Max age for a stored checkout baseline. Beyond this it's treated as stale (an
 * abandoned checkout from a previous session) and ignored. */
export const CHECKOUT_BASELINE_TTL_MS = 60 * 60 * 1000

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
  /** Refetch now, then a short backoff burst (~15s) — credit writes settle
   * asynchronously after a run/purchase, so a single refetch can read a stale value.
   * Concurrent bursts are deduped (a new call restarts the window). */
  refreshWithRetry: () => void
  /** Start a Lemon Squeezy checkout (server creates it, sets the buyer id from the
   * session) and open it in a new tab. Resolves to an error message on failure.
   * Pass a pack id to buy a specific pack. */
  buy: (pack?: string) => Promise<string | null>
  /** True while a checkout request is in flight. */
  buying: boolean
  /** Epoch ms of the last successful balance read (null before first load). */
  lastUpdatedAt: number | null
  /** True while a refresh (incl. a retry burst) is in flight. */
  updating: boolean
}

/** Backoff schedule (ms from the trigger) for the post-run/purchase retry burst. */
const RETRY_BURST_MS = [0, 1_000, 2_000, 4_000, 8_000]

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
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [updating, setUpdating] = useState(false)
  const buyingRef = useRef(false)
  const burstRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // True while a retry burst is in flight: keeps `updating` latched across the
  // individual retries so the UI shows "Updating…" continuously until the burst ends,
  // rather than flicking back to "Updated" (with a possibly-stale value) between retries.
  const burstActiveRef = useRef(false)
  // Latest known balance, read by buy() to stash a pre-checkout baseline without
  // adding `balance` to buy()'s deps (which would re-create the callback each poll).
  const balanceRef = useRef<CreditBalanceResponse | null>(null)

  const refresh = useCallback(async () => {
    setUpdating(true)
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
      balanceRef.current = data
      setHidden(false)
      setLastUpdatedAt(Date.now())
    } catch {
      // Network blip — keep the last known balance (don't present it as fresh).
    } finally {
      // Don't drop the "updating" state mid-burst: a retry burst latches it until the
      // final retry completes (see refreshWithRetry) so the balance isn't shown as
      // fresh between retries while metering is still settling.
      if (!burstActiveRef.current) setUpdating(false)
    }
  }, [apiBaseUrl])

  // Refetch now + a backoff burst. A new call cancels the prior burst's pending
  // timers (token bump) so concurrent triggers don't stampede /balance. `updating`
  // stays true for the whole burst and is cleared only after the last retry settles.
  const refreshWithRetry = useCallback(() => {
    const token = (burstRef.current += 1)
    for (const t of timersRef.current) clearTimeout(t)
    burstActiveRef.current = true
    setUpdating(true)
    const lastIndex = RETRY_BURST_MS.length - 1
    timersRef.current = RETRY_BURST_MS.map((delay, index) =>
      setTimeout(async () => {
        if (burstRef.current !== token) return
        try {
          await refresh()
        } finally {
          if (index === lastIndex && burstRef.current === token) {
            burstActiveRef.current = false
            setUpdating(false)
          }
        }
      }, delay),
    )
  }, [refresh])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), pollMs)
    const onFocus = () => void refresh()
    const onRefreshEvent = () => refreshWithRetry()
    window.addEventListener('focus', onFocus)
    window.addEventListener(CREDITS_REFRESH_EVENT, onRefreshEvent)
    // Cross-tab: a purchase confirmed in another tab broadcasts here.
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel('credits')
      channel.onmessage = () => refreshWithRetry()
    } catch { /* BroadcastChannel unsupported — focus/poll still cover it */ }
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(CREDITS_REFRESH_EVENT, onRefreshEvent)
      for (const t of timersRef.current) clearTimeout(t)
      channel?.close()
    }
  }, [refresh, refreshWithRetry, pollMs])

  const buy = useCallback(async (overridePack?: string): Promise<string | null> => {
    if (buyingRef.current) return null
    buyingRef.current = true
    setBuying(true)
    // Open the tab SYNCHRONOUSLY (on the click) so the browser keeps the user activation
    // and doesn't block it after the async checkout fetch. We navigate it once the server
    // returns the URL. Can't use window.open(url, …, 'noopener') here: with noopener the
    // call returns null even on success, so blocking couldn't be detected — instead open
    // blank, detect blocking via the null handle, then sever opener for the same security.
    let win: Window | null = null
    try {
      win = window.open('about:blank', '_blank')
      if (!win) return 'Could not open the checkout tab. Please allow pop-ups for this site and try again.'
      try { win.opener = null } catch { /* some engines disallow assigning opener; ignore */ }
      const chosen = overridePack ?? pack
      const res = await fetch(`${apiBaseUrl}/api/credits/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chosen ? { pack: chosen } : {}),
      })
      if (!res.ok) { win.close(); return 'Could not start checkout. Please try again.' }
      const { url } = (await res.json()) as { url?: string }
      if (!url) { win.close(); return 'Checkout is not available right now.' }
      // Stash the pre-checkout NET balance (+ timestamp) so the return handler — which
      // runs in the checkout tab — can confirm only on a real increase. localStorage so
      // it crosses tabs. Best-effort: storage may be unavailable (private mode).
      // Capture a FRESH server balance for the baseline rather than the hook's cached
      // value: this runs in the exact async-settlement window where a prior run's debit
      // may not have landed yet, so the cache can read higher than the true pre-checkout
      // net and make a real top-up look like no increase. Fall back to cache on failure.
      try {
        let current = balanceRef.current
        try {
          const bres = await fetch(`${apiBaseUrl}/api/credits/balance`, { credentials: 'include' })
          if (bres.ok) {
            const fresh = (await bres.json()) as CreditBalanceResponse
            if (fresh?.enabled) current = fresh
          }
        } catch { /* keep cached value */ }
        if (current) {
          window.localStorage.setItem(
            CHECKOUT_BASELINE_STORAGE_KEY,
            // userId so the return handler can reject a baseline left by a DIFFERENT
            // user (shared localStorage) instead of confirming a phantom purchase.
            JSON.stringify({ net: creditNetMicros(current), ts: Date.now(), userId: current.userId }),
          )
        }
      } catch { /* localStorage unavailable — handler falls back to a fetched baseline */ }
      win.location.href = url
      return null
    } catch {
      win?.close()
      return 'Could not reach the checkout service. Please try again.'
    } finally {
      buyingRef.current = false
      setBuying(false)
    }
  }, [apiBaseUrl, pack])

  return { balance, hidden, refresh, refreshWithRetry, buy, buying, lastUpdatedAt, updating }
}
