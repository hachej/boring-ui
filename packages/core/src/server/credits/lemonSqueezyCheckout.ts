/**
 * Server-side Lemon Squeezy checkout creation.
 *
 * The buyer's user id is set HERE (from the authenticated session), not by the
 * browser. The purchase webhook then trusts `custom_data.user_id` because the
 * server — not a client-editable URL — put it there. This is the money-safe
 * alternative to client-built hosted-checkout links.
 */

import { signUserAttribution } from './lemonSqueezy.js'

export interface CreateCheckoutInput {
  apiKey: string
  storeId: string
  variantId: string
  /** Authenticated user id — written into checkout custom data server-side. */
  userId: string
  /** Secret used to sign the user attribution token (custom_data.uat) so the
   * webhook can verify the user_id came from this server-created checkout. */
  attributionSecret?: string
  email?: string
  /** Where Lemon Squeezy redirects after a successful purchase. */
  redirectUrl?: string
  /** Use test-mode checkout (mirrors the API key's mode). */
  testMode?: boolean
}

export type FetchLike = (url: string, init: {
  method: string
  headers: Record<string, string>
  body: string
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>

const LS_API = 'https://api.lemonsqueezy.com/v1/checkouts'

/** Build the JSON:API request body for a checkout. Exported for testing. */
export function buildCheckoutRequestBody(input: CreateCheckoutInput): Record<string, unknown> {
  // Fail closed: a Lemon Squeezy variant id MUST be a positive integer so the
  // enabled_variants lock is always applied. A non-numeric id would otherwise
  // create a checkout with no variant lock — the buyer could switch variants.
  const numericVariant = Number(input.variantId)
  if (!Number.isInteger(numericVariant) || numericVariant <= 0) {
    throw new Error(`Lemon Squeezy variantId must be a positive integer, got "${input.variantId}"`)
  }
  const enabledVariants = [numericVariant]
  return {
    data: {
      type: 'checkouts',
      attributes: {
        ...(input.testMode !== undefined ? { test_mode: input.testMode } : {}),
        checkout_data: {
          ...(input.email ? { email: input.email } : {}),
          // Custom data is echoed back on the order webhook as meta.custom_data.
          // uat binds the user id to this server-created checkout (verified by the
          // webhook), so a buyer can't credit an arbitrary account via a crafted URL.
          custom: {
            user_id: input.userId,
            ...(input.attributionSecret ? { uat: signUserAttribution(input.userId, input.attributionSecret) } : {}),
          },
        },
        // Disable discount codes: credits are granted on the net pre-tax amount,
        // and a discount must never let a buyer pay less than the credited value.
        checkout_options: { discount: false },
        // Lock the checkout to EXACTLY the server-selected variant — without
        // enabled_variants, LS may let the buyer switch to another variant of the
        // product, which would then mis-credit or not credit at all.
        product_options: {
          enabled_variants: enabledVariants,
          ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
        },
      },
      relationships: {
        store: { data: { type: 'stores', id: input.storeId } },
        variant: { data: { type: 'variants', id: input.variantId } },
      },
    },
  }
}

function extractCheckoutUrl(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const data = (payload as { data?: { attributes?: { url?: unknown } } }).data
  const url = data?.attributes?.url
  return typeof url === 'string' && url.length > 0 ? url : null
}

/** Create a hosted checkout and return its URL. Throws on API failure. */
export async function createLemonSqueezyCheckout(
  input: CreateCheckoutInput,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<{ url: string }> {
  const res = await fetchImpl(LS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify(buildCheckoutRequestBody(input)),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`lemon squeezy checkout failed (${res.status}): ${detail.slice(0, 300)}`)
  }
  const url = extractCheckoutUrl(await res.json())
  if (!url) throw new Error('lemon squeezy checkout returned no url')
  return { url }
}
