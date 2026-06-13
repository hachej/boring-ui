/** Front-end helpers for the credit balance badge + buy-credits flow. */

export interface CreditBalanceResponse {
  enabled: boolean
  userId: string
  grantedMicros: number
  usedMicros: number
  remainingMicros: number
  activeReservedMicros: number
  availableMicros: number
  /** Amount owed when the ledger went negative (e.g. refund of spent credits). */
  debtMicros: number
  /** Server truth: whether the Buy-credits checkout is wired (avoids client drift). */
  checkoutEnabled?: boolean
  currency: 'credits'
}

/** Format credit micros as a euro string. 1 credit = €0.000001 ⇒ µ/1e6 euros. */
export function formatCreditMicros(micros: number, locale?: string): string {
  const euros = (Number.isFinite(micros) ? Math.max(0, micros) : 0) / 1_000_000
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(euros)
}

/** True when the remaining balance is at or below the low-balance threshold. */
export function isLowBalance(micros: number, thresholdMicros = 500_000): boolean {
  return Number.isFinite(micros) && micros <= thresholdMicros
}

// NOTE: there is intentionally no client-side checkout-URL builder. The buyer's
// user id must be set SERVER-side (POST /api/credits/checkout) so a client can't
// edit a hosted-checkout URL to credit another account.
