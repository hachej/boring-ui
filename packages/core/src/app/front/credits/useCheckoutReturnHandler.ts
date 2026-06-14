import { useEffect, useState } from 'react'
import { CREDITS_REFRESH_EVENT } from './useCreditBalance.js'
import type { CreditBalanceResponse } from './helpers.js'

export type CheckoutReturnStatus = 'idle' | 'checking' | 'confirmed' | 'processing' | 'cancelled'

export interface UseCheckoutReturnHandlerOptions {
  apiBaseUrl?: string
  /** Query param name the LS redirect uses (default 'checkout'). */
  param?: string
}

export interface UseCheckoutReturnHandlerResult {
  status: CheckoutReturnStatus
  dismiss: () => void
}

const CONFIRM_SCHEDULE_MS = [0, 1_500, 3_000, 6_000, 10_000, 15_000, 22_000, 30_000, 45_000, 60_000]

async function fetchBalance(apiBaseUrl: string): Promise<CreditBalanceResponse | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/credits/balance`, { credentials: 'include' })
    if (!res.ok) return null
    return (await res.json()) as CreditBalanceResponse
  } catch {
    return null
  }
}

/**
 * Handle the return from a Lemon Squeezy hosted checkout. The URL marker (`?checkout=
 * return|success|cancelled`) is NOT treated as proof of payment — on a return we poll
 * the AUTHENTICATED balance and only show success once it actually increases (credits
 * settle asynchronously via the webhook). The marker is stripped immediately so a reload
 * can't replay it, and a `credits:refresh` event + BroadcastChannel signal refresh any
 * other open app tab. Returns the status for a small banner to render.
 */
export function useCheckoutReturnHandler({ apiBaseUrl = '', param = 'checkout' }: UseCheckoutReturnHandlerOptions = {}): UseCheckoutReturnHandlerResult {
  const [status, setStatus] = useState<CheckoutReturnStatus>('idle')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const marker = url.searchParams.get(param)
    if (!marker) return

    // Strip the marker right away so a refresh doesn't re-trigger / re-claim.
    url.searchParams.delete(param)
    window.history.replaceState(window.history.state, '', url.toString())

    if (marker === 'cancelled') {
      setStatus('cancelled')
      return
    }

    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    let channel: BroadcastChannel | null = null
    setStatus('checking')

    void (async () => {
      const baseline = (await fetchBalance(apiBaseUrl))?.remainingMicros ?? null
      // Tell other tabs (and our own balance hooks) to refresh.
      window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT))
      try { channel = new BroadcastChannel('credits'); channel.postMessage('refresh') } catch { /* unsupported */ }

      for (const delay of CONFIRM_SCHEDULE_MS) {
        timers.push(setTimeout(async () => {
          if (cancelled) return
          const bal = await fetchBalance(apiBaseUrl)
          if (cancelled || !bal) return
          if (baseline === null || bal.remainingMicros > baseline) {
            setStatus('confirmed')
            cancelled = true
            window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT))
          }
        }, delay))
      }
      // After the window, if still unconfirmed, fall to "processing".
      timers.push(setTimeout(() => { if (!cancelled) setStatus((s) => (s === 'checking' ? 'processing' : s)) }, CONFIRM_SCHEDULE_MS[CONFIRM_SCHEDULE_MS.length - 1] + 2_000))
    })()

    return () => {
      cancelled = true
      for (const t of timers) clearTimeout(t)
      channel?.close()
    }
  }, [apiBaseUrl, param])

  return { status, dismiss: () => setStatus('idle') }
}
