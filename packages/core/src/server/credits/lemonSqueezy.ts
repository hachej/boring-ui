import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Lemon Squeezy (Merchant of Record) credit purchases.
 *
 * Product-neutral: this module verifies the webhook, parses the order, and
 * grants credits via a host-supplied grant function. The host owns how many
 * credits an order is worth (pricing/bonus policy) and which user it belongs
 * to. Grants are idempotent per order id, so webhook retries never double-credit.
 *
 * Lemon Squeezy signs webhooks with HMAC-SHA256 of the raw request body using
 * the store's signing secret, in the `X-Signature` header.
 */

/** Verify the `X-Signature` HMAC against the raw request body. Timing-safe. */
export function verifyLemonSqueezySignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signatureHeader, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface LemonSqueezyOrder {
  eventName: string
  orderId: string
  /** From checkout `custom_data.user_id` — who to credit. */
  userId?: string
  userEmail?: string
  status?: string
  testMode: boolean
  /** Lemon Squeezy store the order belongs to. */
  storeId?: string
  currency?: string
  /** Pre-tax order amount in the smallest currency unit (cents). */
  subtotalCents: number
  /** Discount applied, pre-tax, in cents. Net paid pre-tax = subtotal − discount. */
  discountTotalCents: number
  /** Tax-inclusive total in cents (MoR adds VAT here). */
  totalCents: number
  /** Whether the order has been (fully or partially) refunded. */
  refunded: boolean
  /** Cumulative amount refunded so far, tax-inclusive, in cents. */
  refundedAmountCents: number
  variantId?: string
  productName?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Parse a Lemon Squeezy webhook payload into a normalized order. Returns null
 * for non-order or malformed payloads.
 */
export function parseLemonSqueezyOrder(payload: unknown): LemonSqueezyOrder | null {
  const root = asRecord(payload)
  const meta = asRecord(root?.meta)
  const data = asRecord(root?.data)
  const attrs = asRecord(data?.attributes)
  const eventName = asString(meta?.event_name)
  const orderId = asString(data?.id)
  if (!eventName || !orderId || !attrs) return null

  const customData = asRecord(meta?.custom_data)
  const firstItem = asRecord(attrs.first_order_item)

  return {
    eventName,
    orderId,
    userId: asString(customData?.user_id),
    userEmail: asString(attrs.user_email),
    status: asString(attrs.status),
    testMode: attrs.test_mode === true,
    storeId: attrs.store_id !== undefined ? String(attrs.store_id) : undefined,
    currency: asString(attrs.currency),
    subtotalCents: asNumber(attrs.subtotal),
    discountTotalCents: asNumber(attrs.discount_total),
    totalCents: asNumber(attrs.total),
    refunded: attrs.refunded === true,
    refundedAmountCents: asNumber(attrs.refunded_amount),
    variantId: firstItem?.variant_id !== undefined ? String(firstItem.variant_id) : undefined,
    productName: asString(firstItem?.product_name),
  }
}

export interface LemonSqueezyWebhookOptions {
  secret: string
  /** Credit amount (micros of your credit unit) to grant for this order. */
  creditsForOrder: (order: LemonSqueezyOrder) => number
  /**
   * Resolve the user to credit. Defaults to `order.userId` (custom_data).
   * SECURITY: only trust custom_data.user_id when checkouts are created
   * SERVER-side (see createLemonSqueezyCheckout) so the id is set by your
   * server, not a client-editable hosted-checkout URL. Because the server sets
   * a deterministic user per order, `purchase:<orderId>` is then effectively a
   * per-order idempotency key (the same order never maps to two users).
   */
  resolveUserId?: (order: LemonSqueezyOrder) => string | undefined
  /** Grant credits idempotently. `reason` is `purchase:<orderId>` (the
   * idempotency key); `orderId` is provided so callers don't re-parse it. */
  grant: (input: { userId: string; orderId: string; reason: string; amountMicros: number }) => Promise<{ created: boolean }>
  /** Which events to credit on. Defaults to `order_created`. */
  creditableEvents?: string[]
  /**
   * Confirm this paid order is actually a credit-pack purchase before granting
   * (currency, mode, and that the variant is a configured pack). REQUIRED:
   * without it, ANY signed paid order on the store would mint credits. Returning
   * false acks the webhook without crediting.
   */
  isCreditOrder: (order: LemonSqueezyOrder) => boolean
  /** Events that revoke a previously-credited purchase. Default `order_refunded`. */
  refundEvents?: string[]
  /** Revoke a refunded/disputed order's credits (idempotent per order). REQUIRED
   * so a refund is never silently dropped (which would leave a refunded order
   * credited). */
  onRefund: (order: LemonSqueezyOrder) => Promise<{ revoked: boolean }>
  log?: (message: string, fields?: Record<string, unknown>) => void
}

export interface LemonSqueezyWebhookResult {
  status: number
  body: { ok: boolean; reason?: string; orderId?: string; created?: boolean }
}

/**
 * Full webhook handler: verify signature → parse → grant. Framework-agnostic
 * (takes the raw body + header) so the host wires it to any router with raw-body
 * access. Returns the HTTP status + JSON body to send.
 */
export async function handleLemonSqueezyWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  options: LemonSqueezyWebhookOptions,
): Promise<LemonSqueezyWebhookResult> {
  if (!verifyLemonSqueezySignature(rawBody, signatureHeader, options.secret)) {
    return { status: 401, body: { ok: false, reason: 'invalid_signature' } }
  }

  let payload: unknown
  try {
    payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
  } catch {
    return { status: 400, body: { ok: false, reason: 'invalid_json' } }
  }

  const order = parseLemonSqueezyOrder(payload)
  if (!order) {
    return { status: 400, body: { ok: false, reason: 'unparseable_order' } }
  }

  // Refund/dispute events revoke the order's credits (idempotent per order).
  const refundEvents = options.refundEvents ?? ['order_refunded']
  if (refundEvents.includes(order.eventName)) {
    const { revoked } = await options.onRefund(order)
    options.log?.('lemonsqueezy refund processed', { orderId: order.orderId, revoked })
    return { status: 200, body: { ok: true, reason: revoked ? 'refund_revoked' : 'refund_noop', orderId: order.orderId } }
  }

  const creditable = options.creditableEvents ?? ['order_created']
  if (!creditable.includes(order.eventName)) {
    // Acknowledge other events (subscriptions, etc.) so LS stops retrying.
    return { status: 200, body: { ok: true, reason: 'ignored_event', orderId: order.orderId } }
  }
  // Require an explicit paid status — a missing/other status must not grant.
  if (order.status !== 'paid') {
    return { status: 200, body: { ok: true, reason: `order_status_${order.status ?? 'unknown'}`, orderId: order.orderId } }
  }
  // Confirm it's actually a credit-pack purchase (currency/mode/variant).
  if (!options.isCreditOrder(order)) {
    options.log?.('lemonsqueezy paid order is not a recognized credit pack', {
      orderId: order.orderId, variantId: order.variantId, currency: order.currency, testMode: order.testMode,
    })
    return { status: 200, body: { ok: true, reason: 'not_a_credit_order', orderId: order.orderId } }
  }

  const userId = (options.resolveUserId ?? ((o) => o.userId))(order)
  if (!userId) {
    options.log?.('lemonsqueezy order missing user id', { orderId: order.orderId })
    // 200 so LS doesn't retry forever; the order is logged for manual reconcile.
    return { status: 200, body: { ok: false, reason: 'missing_user_id', orderId: order.orderId } }
  }

  const amountMicros = options.creditsForOrder(order)
  if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
    options.log?.('lemonsqueezy order resolved to non-positive credits', { orderId: order.orderId, amountMicros })
    return { status: 200, body: { ok: false, reason: 'no_credit_amount', orderId: order.orderId } }
  }

  const { created } = await options.grant({
    userId,
    orderId: order.orderId,
    reason: `purchase:${order.orderId}`,
    amountMicros,
  })
  return { status: 200, body: { ok: true, orderId: order.orderId, created } }
}
