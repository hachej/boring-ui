/**
 * Server-side Stripe Checkout Session creation.
 *
 * The buyer's user id and the chosen pack id are written into the session metadata HERE,
 * server-side. The webhook resolves the credit amount from `metadata.pack_id` (the
 * CONFIGURED value for a fixed pack, or the amount actually paid for a custom pay-what-you-
 * want pack) — never from a buyer-influenceable number. A signed `metadata.uat` token binds
 * (user, pack) to a session THIS adapter created, so on a mixed Stripe account another
 * integration's colliding pack_id can't be credited (the webhook verifies it).
 */
import { signStripeAttribution } from './stripe.js'

export interface CreateStripeCheckoutInput {
  apiKey: string
  /** Stripe Price id (price_…) for the selected pack (fixed-amount or custom_unit_amount). */
  priceId: string
  /** Authenticated user id — written into session metadata + client_reference_id. */
  userId: string
  /** Pack id (e.g. "10" or the custom-pack id), echoed into metadata. The webhook maps
   * it to a configured credit value, or (custom pack) credits the amount paid. */
  packId: string
  /** Secret to sign the (user, pack) attribution token (metadata.uat) so the webhook can
   * confirm THIS adapter created the session. Omit to skip (no attribution binding). */
  attributionSecret?: string
  email?: string
  /** Base URL the buyer returns to. `?checkout=return` / `?checkout=cancelled`
   * are appended for success / cancel. */
  redirectUrl?: string
}

export type StripeFetchLike = (url: string, init: {
  method: string
  headers: Record<string, string>
  body: string
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>

const STRIPE_CHECKOUT_API = 'https://api.stripe.com/v1/checkout/sessions'

function appendCheckoutMarker(url: string, value: 'return' | 'cancelled'): string {
  // Build a return URL with ?checkout=<value> without a URL parser (redirectUrl may
  // be a bare path or absolute). The front strips the marker and confirms server-side.
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}checkout=${value}`
}

/** Build the x-www-form-urlencoded body for a Checkout Session. Exported for tests. */
export function buildStripeCheckoutForm(input: CreateStripeCheckoutInput): string {
  if (!/^price_[A-Za-z0-9]+$/.test(input.priceId)) {
    // Fail closed: a malformed price id would create a broken/empty checkout.
    throw new Error(`Stripe priceId must look like "price_…", got "${input.priceId}"`)
  }
  if (!input.packId) throw new Error('Stripe checkout requires a packId')
  const params: Array<[string, string]> = [
    ['mode', 'payment'],
    ['line_items[0][price]', input.priceId],
    ['line_items[0][quantity]', '1'],
    // Lock quantity: buyer can't change it on the hosted page (so a fixed pack's
    // amount == price; a custom pack collects its amount via custom_unit_amount).
    ['line_items[0][adjustable_quantity][enabled]', 'false'],
    // Disable Adaptive Pricing: it can localize the session into another currency,
    // which our webhook's strict currency gate would then reject — leaving the buyer
    // charged but uncredited. Pin the currency to the configured one.
    ['adaptive_pricing[enabled]', 'false'],
    // Buyer attribution (server-set). Both client_reference_id and metadata carry it
    // so the webhook can read it off the session regardless of Stripe shape changes.
    ['client_reference_id', input.userId],
    ['metadata[user_id]', input.userId],
    ['metadata[pack_id]', input.packId],
    // Mirror onto the PaymentIntent so a refund (charge→payment_intent) can be traced
    // back for audit even though we key revocation by the payment_intent id itself.
    ['payment_intent_data[metadata][user_id]', input.userId],
    ['payment_intent_data[metadata][pack_id]', input.packId],
  ]
  if (input.attributionSecret) {
    // Bind (user, pack) to this server-created session; the webhook verifies metadata.uat.
    params.push(['metadata[uat]', signStripeAttribution(input.userId, input.packId, input.attributionSecret)])
  }
  if (input.email) params.push(['customer_email', input.email])
  if (input.redirectUrl) {
    params.push(['success_url', appendCheckoutMarker(input.redirectUrl, 'return')])
    params.push(['cancel_url', appendCheckoutMarker(input.redirectUrl, 'cancelled')])
  }
  // NOTE: promotion codes are intentionally NOT enabled (default off). A discount
  // would let amount_subtotal fall below the pack price and underpay the credits.
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

function extractCheckoutUrl(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const url = (payload as { url?: unknown }).url
  return typeof url === 'string' && url.length > 0 ? url : null
}

/** Create a Stripe Checkout Session and return its hosted URL. Throws on API failure. */
export async function createStripeCheckout(
  input: CreateStripeCheckoutInput,
  fetchImpl: StripeFetchLike = fetch as unknown as StripeFetchLike,
): Promise<{ url: string }> {
  const res = await fetchImpl(STRIPE_CHECKOUT_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Idempotency on retried checkout *creation* is not required for money-safety
      // (only paid orders mint credits, deduped by payment_intent), so it's omitted.
    },
    body: buildStripeCheckoutForm(input),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`stripe checkout failed (${res.status}): ${detail.slice(0, 300)}`)
  }
  const url = extractCheckoutUrl(await res.json())
  if (!url) throw new Error('stripe checkout returned no url')
  return { url }
}
