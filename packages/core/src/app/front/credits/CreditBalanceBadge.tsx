import { useCallback, useEffect, useState } from 'react'
import {
  buildLemonSqueezyCheckoutUrl,
  formatCreditMicros,
  isLowBalance,
  type CreditBalanceResponse,
} from './helpers.js'

export interface CreditBalanceBadgeProps {
  /** Base URL for the credits API (default: same origin). */
  apiBaseUrl?: string
  /** Lemon Squeezy hosted-checkout URL; when unset the buy button is hidden. */
  checkoutUrl?: string
  /** Buyer email to prefill at checkout (optional). */
  userEmail?: string
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
  checkoutUrl,
  userEmail,
  pollMs = 30_000,
  locale,
}: CreditBalanceBadgeProps) {
  const [balance, setBalance] = useState<CreditBalanceResponse | null>(null)
  const [hidden, setHidden] = useState(false)

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

  const onBuy = useCallback(() => {
    if (!balance) return
    const url = buildLemonSqueezyCheckoutUrl(checkoutUrl, { userId: balance.userId, email: userEmail })
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [balance, checkoutUrl, userEmail])

  if (hidden || !balance) return null

  const low = isLowBalance(balance.remainingMicros)

  return (
    <div
      className="credit-balance-badge"
      data-low={low ? 'true' : 'false'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      <span
        className="credit-balance-badge__value"
        title="Remaining credits"
        style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: low ? 'var(--color-danger, #c0392b)' : 'inherit' }}
      >
        {formatCreditMicros(balance.remainingMicros, locale)}
      </span>
      {checkoutUrl ? (
        <button type="button" className="credit-balance-badge__buy" onClick={onBuy}>
          Buy credits
        </button>
      ) : null}
    </div>
  )
}
