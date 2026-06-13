/** Front-end helpers for the credit balance badge + buy-credits flow. */

export interface CreditBalanceResponse {
  enabled: boolean
  userId: string
  grantedMicros: number
  usedMicros: number
  remainingMicros: number
  activeReservedMicros: number
  availableMicros: number
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

/**
 * Build a Lemon Squeezy hosted-checkout URL with the buyer attached via custom
 * data, so the purchase webhook can credit the right user. Returns null when no
 * base checkout URL is configured.
 */
export function buildLemonSqueezyCheckoutUrl(
  baseUrl: string | undefined,
  buyer: { userId: string; email?: string },
): string | null {
  if (!baseUrl) return null
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('checkout[custom][user_id]', buyer.userId)
    if (buyer.email) url.searchParams.set('checkout[email]', buyer.email)
    return url.toString()
  } catch {
    return null
  }
}
