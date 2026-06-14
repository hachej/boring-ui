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

/** Server-signed attribution token binding a user id to a server-created
 * checkout. Set as `custom_data.uat`; verified on the webhook so a buyer-crafted
 * hosted-checkout URL can't attribute a paid order to an arbitrary account. */
export function signUserAttribution(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`credit-user:${userId}`).digest('hex')
}

export function verifyUserAttribution(userId: string | undefined, token: string | undefined, secret: string): boolean {
  if (!userId || !token) return false
  const expected = Buffer.from(signUserAttribution(userId, secret), 'utf8')
  const actual = Buffer.from(token, 'utf8')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export interface LemonSqueezyOrder {
  eventName: string
  orderId: string
  /** From checkout `custom_data.user_id` — who to credit. */
  userId?: string
  /** From checkout `custom_data.uat` — server-signed HMAC binding the user_id to
   * a server-created checkout (a crafted hosted-checkout URL can't forge it). */
  userAttributionToken?: string
  userEmail?: string
  status?: string
  /** Test/live mode. `undefined` when the payload omitted it — treated as a
   * MISMATCH by isCreditOrder (never silently assumed live). */
  testMode?: boolean
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
  /** Units of the pack purchased (default 1). Credits scale with it. */
  quantity: number
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
    userAttributionToken: asString(customData?.uat),
    userEmail: asString(attrs.user_email),
    status: asString(attrs.status),
    testMode: typeof attrs.test_mode === 'boolean' ? attrs.test_mode : undefined,
    storeId: attrs.store_id !== undefined ? String(attrs.store_id) : undefined,
    currency: asString(attrs.currency),
    subtotalCents: asNumber(attrs.subtotal),
    discountTotalCents: asNumber(attrs.discount_total),
    totalCents: asNumber(attrs.total),
    refunded: attrs.refunded === true,
    refundedAmountCents: asNumber(attrs.refunded_amount),
    variantId: firstItem?.variant_id !== undefined ? String(firstItem.variant_id) : undefined,
    quantity: (() => { const q = asNumber(firstItem?.quantity); return Number.isInteger(q) && q > 0 ? q : 1 })(),
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
  /** When set, the order's `custom_data.uat` MUST be a valid attribution token
   * for its user_id (signUserAttribution) or the order is not credited — binds
   * attribution to a server-created checkout, not a buyer-supplied user_id. */
  attributionSecret?: string
  /** Grant credits idempotently. `reason` is `purchase:<orderId>` (the
   * idempotency key); `orderId` is provided so callers don't re-parse it. The
   * full `order` is passed so the grant can persist provider identity. */
  grant: (input: { userId: string; orderId: string; reason: string; amountMicros: number }, order: LemonSqueezyOrder) => Promise<{ created: boolean }>
  /** Which events to credit on. Defaults to `order_created`. */
  creditableEvents?: string[]
  /**
   * Confirm this paid order is actually a credit-pack purchase before granting
   * (currency, mode, and that the variant is a configured pack). REQUIRED:
   * without it, ANY signed paid order on the store would mint credits. Returning
   * false acks the webhook without crediting.
   */
  isCreditOrder: (order: LemonSqueezyOrder) => boolean
  /** Optional: is this order on OUR store/mode/currency (ignoring the variant)?
   * When provided, a paid order that's ours but NOT a credit order (unknown/
   * misconfigured variant) returns a retryable 500 instead of a 200 ack — so a
   * paid customer on a credit-only store isn't silently left without credits. */
  isOurStoreOrder?: (order: LemonSqueezyOrder) => boolean
  /** Credit micros per 1 currency unit (e.g. 1_000_000 = €0.000001/credit). When
   * set, the webhook refuses to mint a fixed pack value unless the net paid
   * amount (subtotal − discount) covers it — so a dashboard/manual discount or LS
   * bug can't grant full credits for an underpaid order. */
  creditMicrosPerUnit?: number
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
    // Always reconcile against the order we actually credited (looked up by id):
    // an order whose pack variant was later retired from the allow-list must
    // still be revocable. onRefund tombstones an UNKNOWN order only when it still
    // validates as a credit order (so a cross-store/mode refund can't tombstone
    // by order id alone) — that gate now lives in the refund handler.
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
    // A paid order ON OUR store/mode/currency but with an unknown variant is a
    // pack misconfiguration — the customer paid and would get nothing. Surface it
    // with a retryable 500 rather than a silent 200 ack.
    if (options.isOurStoreOrder?.(order)) {
      options.log?.('lemonsqueezy paid order on our store has an unrecognized credit variant — not crediting', {
        orderId: order.orderId, variantId: order.variantId, currency: order.currency, testMode: order.testMode,
      })
      return { status: 500, body: { ok: false, reason: 'unrecognized_credit_variant', orderId: order.orderId } }
    }
    options.log?.('lemonsqueezy paid order is not a recognized credit pack', {
      orderId: order.orderId, variantId: order.variantId, currency: order.currency, testMode: order.testMode,
    })
    return { status: 200, body: { ok: true, reason: 'not_a_credit_order', orderId: order.orderId } }
  }

  // Bind attribution to a server-created checkout: reject a user_id that isn't
  // accompanied by a valid server-signed token (a crafted hosted-checkout URL
  // could otherwise carry an arbitrary user_id).
  if (options.attributionSecret && !verifyUserAttribution(order.userId, order.userAttributionToken, options.attributionSecret)) {
    options.log?.('lemonsqueezy order user attribution token invalid/missing — not crediting', { orderId: order.orderId })
    return { status: 500, body: { ok: false, reason: 'untrusted_attribution', orderId: order.orderId } }
  }

  const userId = (options.resolveUserId ?? ((o) => o.userId))(order)
  if (!userId) {
    options.log?.('lemonsqueezy PAID credit order missing user id — not crediting; returning 500 so LS retries', { orderId: order.orderId })
    // The customer paid: a 200 ack would drop the order and lose the credits.
    // Return 500 so Lemon Squeezy retries (its retry window surfaces it for
    // operator reconcile). Server-side checkout always sets user_id, so this is
    // an exceptional path, not the norm.
    return { status: 500, body: { ok: false, reason: 'missing_user_id', orderId: order.orderId } }
  }

  const amountMicros = options.creditsForOrder(order)
  if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
    options.log?.('lemonsqueezy recognized credit order resolved to non-positive credits — config bug', { orderId: order.orderId, amountMicros })
    // Recognized, paid credit order that we can't credit (config bug): 500 so LS
    // retries and the failure surfaces, rather than a 200 that drops a paid order.
    return { status: 500, body: { ok: false, reason: 'no_credit_amount', orderId: order.orderId } }
  }

  // Don't mint a fixed pack value for an underpaid order: require the net paid
  // amount (subtotal − discount, pre-tax) to cover the credits being granted.
  if (typeof options.creditMicrosPerUnit === 'number' && options.creditMicrosPerUnit > 0) {
    // LS can report fractional cents (a tax-rounding artifact, e.g. 1499.985 for a
    // €15 pack). Tolerate a shortfall of strictly LESS than one cent (the artifact)
    // but reject a genuine one-cent-or-more underpayment (discount/price bug).
    const oneCentMicros = options.creditMicrosPerUnit / 100
    const netPaidMicros = Math.max(0, order.subtotalCents - order.discountTotalCents) * oneCentMicros
    if (netPaidMicros + oneCentMicros <= amountMicros) {
      options.log?.('lemonsqueezy order underpaid for the credits it maps to — not granting', {
        orderId: order.orderId, amountMicros, netPaidMicros, subtotalCents: order.subtotalCents, discountTotalCents: order.discountTotalCents,
      })
      // A recognized paid order that didn't cover its pack value: 500 so LS
      // retries and the failed delivery surfaces for operator reconcile (refund
      // or manual credit), rather than a 200 that silently drops a paid order.
      return { status: 500, body: { ok: false, reason: 'underpaid_order', orderId: order.orderId } }
    }
  }

  const { created } = await options.grant(
    {
      userId,
      orderId: order.orderId,
      reason: `purchase:${order.orderId}`,
      amountMicros,
    },
    order,
  )
  return { status: 200, body: { ok: true, orderId: order.orderId, created } }
}
