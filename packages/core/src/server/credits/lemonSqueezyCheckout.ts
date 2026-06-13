/**
 * Server-side Lemon Squeezy checkout creation.
 *
 * The buyer's user id is set HERE (from the authenticated session), not by the
 * browser. The purchase webhook then trusts `custom_data.user_id` because the
 * server — not a client-editable URL — put it there. This is the money-safe
 * alternative to client-built hosted-checkout links.
 */

export interface CreateCheckoutInput {
  apiKey: string
  storeId: string
  variantId: string
  /** Authenticated user id — written into checkout custom data server-side. */
  userId: string
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
  return {
    data: {
      type: 'checkouts',
      attributes: {
        ...(input.testMode !== undefined ? { test_mode: input.testMode } : {}),
        checkout_data: {
          ...(input.email ? { email: input.email } : {}),
          // Custom data is echoed back on the order webhook as meta.custom_data.
          custom: { user_id: input.userId },
        },
        ...(input.redirectUrl ? { product_options: { redirect_url: input.redirectUrl } } : {}),
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
