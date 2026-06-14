import { formatCreditMicros, isLowBalance } from './helpers.js'
import { useCreditBalance } from './useCreditBalance.js'

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
  const { balance, hidden, buy, buying } = useCreditBalance({ apiBaseUrl, pollMs, pack })
  const onBuy = buy

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
