/** Front-end helpers for the credit balance badge + buy-credits flow. */

/** Display-ready credit pack (server-authored). The client never infers price from
 * the id and never sees the provider's price/variant id. */
export interface CreditPack {
  id: string
  creditMicros: number
  /** Price in the currency's minor unit (e.g. cents). For a custom pack, the MINIMUM. */
  priceMinor: number
  currency: string
  label: string
  isDefault: boolean
  /** Pay-what-you-want pack: the buyer enters the amount on the hosted checkout, so
   * `creditMicros` is 0 here and `priceMinor` is the minimum. The picker shows an
   * "enter amount" option instead of a fixed price. */
  custom?: boolean
}

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
  /** Display-ready packs (present only when checkout is wired). */
  packs?: CreditPack[]
  currency: 'credits'
}

export type CreditLedgerKind = 'grant' | 'purchase' | 'usage' | 'refund' | 'fallback'

/** One credit-activity row (mirrors the server `CreditLedgerEntry`). `amountMicros`
 * is signed: positive = added, negative = consumed/removed. */
export interface CreditLedgerEntry {
  id: string
  kind: CreditLedgerKind
  amountMicros: number
  createdAt: string
  description: string
}

/** Net credit position in micros: remaining minus any debt. Used to detect a real
 * top-up after checkout — `remainingMicros` is clamped at 0, so for a user in debt a
 * purchase that only reduces debt wouldn't raise it; the net DOES rise. */
export function creditNetMicros(balance: Pick<CreditBalanceResponse, 'remainingMicros' | 'debtMicros'>): number {
  const remaining = Number.isFinite(balance.remainingMicros) ? balance.remainingMicros : 0
  const debt = Number.isFinite(balance.debtMicros) ? balance.debtMicros : 0
  return remaining - debt
}

/** Format SIGNED credit micros as a currency string with an explicit +/− sign.
 * `currency` is the configured display currency (1 credit-unit = 1 major unit); defaults
 * to EUR for callers without a configured purchase currency. */
export interface CreditFormatOptions {
  /** Show sub-cent/sub-rappen/sub-credit usage instead of rounding tiny amounts to 0.00. */
  highPrecision?: boolean
}

function creditFractionDigits(major: number, options?: CreditFormatOptions): Intl.NumberFormatOptions {
  if (!options?.highPrecision) return {}
  return {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(major) > 0 && Math.abs(major) < 0.01 ? 6 : 2,
  }
}

export function formatSignedCreditMicros(micros: number, currency = 'EUR', locale?: string, options?: CreditFormatOptions): string {
  const major = (Number.isFinite(micros) ? micros : 0) / 1_000_000
  const sign = major > 0 ? '+' : major < 0 ? '−' : ''
  const abs = new Intl.NumberFormat(locale, { style: 'currency', currency, ...creditFractionDigits(major, options) }).format(Math.abs(major))
  return `${sign}${abs}`
}

/** Format a minor-unit price (e.g. cents) in its currency for pack labels/buttons. */
export function formatMinorPrice(priceMinor: number, currency: string, locale?: string): string {
  const major = (Number.isFinite(priceMinor) ? priceMinor : 0) / 100
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: major % 1 === 0 ? 0 : 2 }).format(major)
}

/** Format credit micros as a currency string. 1 credit-unit = 1 major unit of the
 * configured display `currency` (µ/1e6). Defaults to EUR for callers without a
 * configured purchase currency (e.g. a consumption-only deployment). */
export function formatCreditMicros(micros: number, currency = 'EUR', locale?: string, options?: CreditFormatOptions): string {
  const major = (Number.isFinite(micros) ? Math.max(0, micros) : 0) / 1_000_000
  return new Intl.NumberFormat(locale, { style: 'currency', currency, ...creditFractionDigits(major, options) }).format(major)
}

/** True when the remaining balance is at or below the low-balance threshold. */
export function isLowBalance(micros: number, thresholdMicros = 500_000): boolean {
  return Number.isFinite(micros) && micros <= thresholdMicros
}

/** Stable server error code for an out-of-credits rejection (mirrors the agent's
 * ErrorCode enum). Kept here so the credits feature owns the credit↔code mapping
 * and the agent stays billing-agnostic. */
export const PAYMENT_REQUIRED_ERROR_CODE = 'PAYMENT_REQUIRED'

/** True when a run-rejected notice was an out-of-credits rejection. Hosts use this
 * in renderNoticeAction to decide whether to show the Buy-credits CTA. */
export function isPaymentRequiredNotice(notice: { errorCode?: string }): boolean {
  return notice.errorCode === PAYMENT_REQUIRED_ERROR_CODE
}

// NOTE: there is intentionally no client-side checkout-URL builder. The buyer's
// user id must be set SERVER-side (POST /api/credits/checkout) so a client can't
// edit a hosted-checkout URL to credit another account.
