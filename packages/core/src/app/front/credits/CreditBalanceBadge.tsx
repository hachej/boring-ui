import { useCallback, useEffect, useState } from 'react'
import { formatCreditMicros, isLowBalance, type CreditBalanceResponse } from './helpers.js'

export interface CreditBalanceBadgeProps {
  /** Base URL for the credits API (default: same origin). */
  apiBaseUrl?: string
  /** Fallback enable for the "Buy credits" button. The server's
   * `checkoutEnabled` (from /api/credits/balance) takes precedence when present. */
  buyEnabled?: boolean
  /** Credit pack id to purchase (server maps it to a Lemon Squeezy variant). */
  pack?: string
  /** Poll interval for the balance, ms (default 30s). */
  pollMs?: number
  locale?: string
}

/**
 * Top-bar credit balance pill with a "Buy credits" action. Polls
 * `/api/credits/balance`; hides itself when credits are disabled or the user is
 * unauthenticated. Buying opens the Lemon Squeezy hosted checkout with the
 * user id attached so the purchase webhook credits the right account.
 */
export function CreditBalanceBadge({
  apiBaseUrl = '',
  buyEnabled = false,
  pack,
  pollMs = 30_000,
  locale,
}: CreditBalanceBadgeProps) {
  const [balance, setBalance] = useState<CreditBalanceResponse | null>(null)
  const [hidden, setHidden] = useState(false)
  const [buying, setBuying] = useState(false)

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
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, pollMs])

  const onBuy = useCallback(async () => {
    if (buying) return
    setBuying(true)
    try {
      // Server creates the checkout and sets the buyer id from the session —
      // the client never supplies the user id.
      const res = await fetch(`${apiBaseUrl}/api/credits/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pack ? { pack } : {}),
      })
      if (!res.ok) return
      const { url } = (await res.json()) as { url?: string }
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      // Surface nothing; the badge stays usable.
    } finally {
      setBuying(false)
    }
  }, [apiBaseUrl, pack, buying])

  if (hidden || !balance) return null

  const inDebt = (balance.debtMicros ?? 0) > 0
  const low = inDebt || isLowBalance(balance.remainingMicros)
  // Prefer server truth over the build-time flag so the button can't drift.
  const showBuy = balance.checkoutEnabled ?? buyEnabled

  return (
    <div
      className="credit-balance-badge"
      data-low={low ? 'true' : 'false'}
      data-debt={inDebt ? 'true' : 'false'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      <span
        className="credit-balance-badge__value"
        title={inDebt ? 'Amount owed — top up to resume' : 'Remaining credits'}
        style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: low ? 'var(--color-danger, #c0392b)' : 'inherit' }}
      >
        {inDebt ? `−${formatCreditMicros(balance.debtMicros, locale)}` : formatCreditMicros(balance.remainingMicros, locale)}
      </span>
      {showBuy ? (
        <button type="button" className="credit-balance-badge__buy" onClick={() => void onBuy()} disabled={buying}>
          {buying ? 'Opening…' : 'Buy credits'}
        </button>
      ) : null}
    </div>
  )
}
