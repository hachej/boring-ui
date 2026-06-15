import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stripe one-time credit purchases (Checkout Sessions).
 *
 * Product-neutral, like the Lemon Squeezy module: verify the webhook signature,
 * parse the event, and grant/revoke credits via host-supplied callbacks. Grants
 * are idempotent per PaymentIntent id, so webhook retries never double-credit.
 *
 * Trust model (simpler than Lemon Squeezy): a Checkout Session can only be created
 * with the secret key, so `metadata.user_id` / `metadata.credit_micros` are set by
 * THIS server — never by a buyer-crafted URL. So no signed attribution token is
 * needed; the Stripe webhook SIGNATURE proves the event is genuinely from Stripe.
 *
 * Stripe signs webhooks with `Stripe-Signature: t=<ts>,v1=<hmac>` where the HMAC is
 * SHA-256 of `"<ts>.<rawBody>"` using the endpoint's signing secret.
 */

const DEFAULT_TOLERANCE_SECONDS = 300

/**
 * Server-signed attribution token binding (user, pack) to a checkout created BY THIS
 * adapter. Set as `metadata.uat`; verified on the webhook. A Stripe webhook signature only
 * proves the event is from the account — on a mixed/shared account another integration (or
 * Payment Link) could carry a colliding `metadata.pack_id`. The token proves OUR route
 * created the session, so the metadata is trustworthy (Stripe analogue of LS's uat). */
export function signStripeAttribution(userId: string, packId: string, secret: string): string {
  return createHmac('sha256', secret).update(`credit:${userId}:${packId}`).digest('hex')
}

/** Verify the token against any of the given secrets (current + previous, for rotation). */
export function verifyStripeAttribution(userId: string | undefined, packId: string | undefined, token: string | undefined, secret: string | readonly string[]): boolean {
  if (!userId || !packId || !token) return false
  const actual = Buffer.from(token, 'utf8')
  const secrets = typeof secret === 'string' ? [secret] : secret
  return secrets.some((s) => {
    if (!s) return false
    const expected = Buffer.from(signStripeAttribution(userId, packId, s), 'utf8')
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  })
}

/** Parse the `Stripe-Signature` header into its timestamp + v1 signatures. */
function parseSignatureHeader(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null
  const v1: string[] = []
  for (const part of header.split(',')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key === 't') {
      const n = Number(value)
      if (Number.isFinite(n)) t = n
    } else if (key === 'v1' && value) {
      v1.push(value)
    }
  }
  return { t, v1 }
}

function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'utf8')
  const b = Buffer.from(bHex, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Verify a Stripe webhook signature against the raw body. Timing-safe, checks the
 * timestamp tolerance (replay window), and accepts any of the header's v1 schemes.
 * `now` (ms) is injectable for tests.
 */
export function verifyStripeSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
  opts: { now?: number; toleranceSeconds?: number } = {},
): boolean {
  if (!signatureHeader || !secret) return false
  const { t, v1 } = parseSignatureHeader(signatureHeader)
  if (t === null || v1.length === 0) return false
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  // tolerance <= 0 disables the time-window check (still verifies the HMAC).
  if (tolerance > 0) {
    const nowSec = (opts.now ?? Date.now()) / 1000
    if (Math.abs(nowSec - t) > tolerance) return false
  }
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return v1.some((sig) => timingSafeHexEqual(expected, sig))
}

/** Normalized Stripe purchase/refund, parsed from a webhook event. */
export interface StripeOrder {
  eventType: string
  /** Idempotency/refund key: the PaymentIntent id (shared by the paid session and
   * its later refund event), namespaced + used as the purchase id. */
  paymentIntentId?: string
  /** Checkout Session id (audit; fallback id only). */
  sessionId?: string
  /** From session metadata.user_id / client_reference_id — who to credit. */
  userId?: string
  /** From metadata.uat — server-signed token binding (user, pack) to a session this
   * adapter created (verified when attributionSecret is set). */
  userAttributionToken?: string
  /** Stripe payment_status ('paid' when funds captured). */
  paymentStatus?: string
  /** false = test mode, true = live. `undefined` when absent (treated as a mismatch). */
  livemode?: boolean
  /** Lowercase ISO currency (e.g. 'chf'). */
  currency?: string
  /** Pre-tax, PRE-discount amount in minor units (Stripe `amount_subtotal`). */
  amountSubtotalMinor?: number
  /** Tax+discount-inclusive amount in minor units (Stripe `amount_total`). */
  amountTotalMinor?: number
  /** Discount applied, minor units (Stripe `total_details.amount_discount`). */
  amountDiscountMinor?: number
  /** Tax, minor units (Stripe `total_details.amount_tax`). */
  amountTaxMinor?: number
  /** Pack id (metadata.pack_id). The route maps it to the CONFIGURED credit value for a
   * fixed pack, or credits the amount paid for the custom pay-what-you-want pack. There is
   * deliberately NO buyer-influenceable credit amount in metadata. */
  packId?: string
  /** Refund: cumulative amount refunded (minor units). */
  amountRefundedMinor?: number
  /** Refund: original charge amount (minor units) — denominator for the fraction. */
  amountMinor?: number
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
/** A Stripe id field may be a bare string or an expanded object {id}. */
function asId(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined
  const id = asRecord(value)?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}
/**
 * Validated NET pre-tax amount paid, in minor units, or null when the money fields are
 * missing/inconsistent (fail closed). Net = amount_subtotal − amount_discount, cross-checked
 * against amount_total − amount_tax (the two must agree within 1 minor unit). This is the
 * authoritative basis for BOTH the fixed-pack underpayment guard and the custom pack's
 * credit amount, so a Dashboard/coupon discount can't mint credits the buyer didn't pay for.
 */
export function stripeNetPaidMinor(order: StripeOrder): number | null {
  const sub = order.amountSubtotalMinor
  const total = order.amountTotalMinor
  const disc = order.amountDiscountMinor
  const tax = order.amountTaxMinor
  // Presence-preserving (like the LS adapter): a MISSING discount/tax (absent total_details)
  // must NOT be read as a real 0 — a discount that tax offsets could otherwise slip past the
  // cross-check and credit the pre-discount subtotal. Require all four money fields present.
  if (typeof sub !== 'number' || typeof total !== 'number' || typeof disc !== 'number' || typeof tax !== 'number') return null
  const netFromSubtotal = sub - disc
  const netFromTotal = total - tax
  const sane =
    sub >= 0 && disc >= 0 && total >= 0 && tax >= 0 &&
    sub >= disc && total >= tax &&
    netFromSubtotal <= netFromTotal + 1
  if (!sane) return null
  return Math.max(0, netFromSubtotal)
}

/** Parse a Stripe webhook event into a normalized order. Returns null if not an event. */
export function parseStripeEvent(payload: unknown): StripeOrder | null {
  const root = asRecord(payload)
  const eventType = asString(root?.type)
  const object = asRecord(asRecord(root?.data)?.object)
  if (!eventType || !object) return null

  // checkout.session.* — a purchase.
  if (eventType.startsWith('checkout.session.')) {
    const meta = asRecord(object.metadata)
    const totals = asRecord(object.total_details)
    return {
      eventType,
      paymentIntentId: asId(object.payment_intent),
      sessionId: asString(object.id),
      userId: asString(meta?.user_id) ?? asString(object.client_reference_id),
      userAttributionToken: asString(meta?.uat),
      paymentStatus: asString(object.payment_status),
      livemode: typeof object.livemode === 'boolean' ? object.livemode : undefined,
      currency: asString(object.currency)?.toLowerCase(),
      amountSubtotalMinor: asOptionalNumber(object.amount_subtotal),
      amountTotalMinor: asOptionalNumber(object.amount_total),
      amountDiscountMinor: asOptionalNumber(totals?.amount_discount),
      amountTaxMinor: asOptionalNumber(totals?.amount_tax),
      packId: asString(meta?.pack_id),
    }
  }

  // charge.refunded — a refund/dispute against a prior charge.
  if (eventType === 'charge.refunded' || eventType === 'charge.dispute.created') {
    return {
      eventType,
      paymentIntentId: asId(object.payment_intent),
      currency: asString(object.currency)?.toLowerCase(),
      livemode: typeof object.livemode === 'boolean' ? object.livemode : undefined,
      amountMinor: asOptionalNumber(object.amount),
      amountRefundedMinor: asOptionalNumber(object.amount_refunded),
    }
  }

  // Other events (recognized envelope, but not one we act on).
  return { eventType }
}

export interface StripeWebhookOptions {
  secret: string
  /** Credit micros to grant for this order. The route resolves it from the CONFIGURED
   * pack→micros map (keyed by order.packId), NOT raw metadata, so a bad metadata value
   * can't over-credit. Returns 0 for an unknown pack. */
  creditsForOrder: (order: StripeOrder) => number
  resolveUserId?: (order: StripeOrder) => string | undefined
  /** When provided, a credit order for a non-existent (deleted) user is 200-acked
   * WITHOUT granting (no PII resurrection via a stale webhook). */
  userExists?: (userId: string) => Promise<boolean>
  /** Idempotent grant (per PaymentIntent). */
  grant: (input: { userId: string; orderId: string; reason: string; amountMicros: number }, order: StripeOrder) => Promise<{ created: boolean }>
  /** Idempotent revoke for a refund/dispute. */
  onRefund: (order: StripeOrder) => Promise<{ revoked: boolean }>
  /** Events that credit. Default: completed + async success. */
  creditableEvents?: string[]
  /** Events that revoke. Default: charge.refunded + dispute.created. */
  refundEvents?: string[]
  /** Confirm this is a configured credit pack on our mode/currency. REQUIRED — without
   * it any signed paid session would mint credits. */
  isCreditOrder: (order: StripeOrder) => boolean
  /** STRICT our-mode/currency check (credit-only store): a PAID order that's ours but
   * not a known pack → retryable 500 rather than a silent 200 drop. */
  isOurStoreOrder?: (order: StripeOrder) => boolean
  /** LENIENT refund check: a refund whose payload omits mode/currency still revokes;
   * only a present mismatch rejects. */
  isRefundForOurStore?: (order: StripeOrder) => boolean
  /** Known pack with incomplete mode/currency identity → fail loud (500). */
  isUnverifiedCreditOrder?: (order: StripeOrder) => boolean
  /** Credit micros per 1 major currency unit. When set, refuse to mint a pack value the
   * buyer didn't actually pay for (net pre-tax = amount_subtotal must cover it). */
  creditMicrosPerUnit?: number
  /** When set, the session's `metadata.uat` MUST be a valid attribution token for its
   * (user_id, pack_id) — proving THIS adapter created the session. Defends a mixed Stripe
   * account where another integration could carry a colliding metadata.pack_id. May be an
   * array (current + previous) for secret rotation. Undefined ⇒ no attribution required. */
  attributionSecret?: string | readonly string[]
  now?: number
  toleranceSeconds?: number
  log?: (message: string, fields?: Record<string, unknown>) => void
}

export interface StripeWebhookResult {
  status: number
  body: { ok: boolean; reason?: string; orderId?: string; created?: boolean }
}

/**
 * Verify → parse → grant/revoke. Framework-agnostic (raw body + header). Mirrors the
 * Lemon Squeezy handler's fail-closed posture: a recognized PAID order we can't safely
 * credit returns a retryable 500 (Stripe retries, operator reconciles) rather than a
 * 200 that silently drops a paying customer's credits.
 */
export async function handleStripeWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  options: StripeWebhookOptions,
): Promise<StripeWebhookResult> {
  if (!verifyStripeSignature(rawBody, signatureHeader, options.secret, { now: options.now, toleranceSeconds: options.toleranceSeconds })) {
    return { status: 401, body: { ok: false, reason: 'invalid_signature' } }
  }

  let payload: unknown
  try {
    payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
  } catch {
    return { status: 400, body: { ok: false, reason: 'invalid_json' } }
  }

  const order = parseStripeEvent(payload)
  if (!order) return { status: 400, body: { ok: false, reason: 'unparseable_event' } }

  // --- Refund / dispute → revoke ---
  const refundEvents = options.refundEvents ?? ['charge.refunded', 'charge.dispute.created']
  if (refundEvents.includes(order.eventType)) {
    // Foreign refund/dispute (a PRESENT mode/currency mismatch) → ignore (not ours).
    if (options.isRefundForOurStore && !options.isRefundForOurStore(order)) {
      options.log?.('stripe refund not for our mode/currency — ignoring', { paymentIntentId: order.paymentIntentId, currency: order.currency, livemode: order.livemode })
      return { status: 200, body: { ok: true, reason: 'refund_not_our_store', orderId: order.paymentIntentId } }
    }
    // Ours (or unattributable) but no PaymentIntent to map back to a grant — FAIL LOUD so
    // Stripe retries and an operator reconciles, rather than silently leaving a refunded/
    // disputed purchase credited (a 200 here would stop retries and drop the reversal).
    if (!order.paymentIntentId) {
      options.log?.('stripe refund/dispute for our store has no payment_intent to map to a grant — failing loud', { eventType: order.eventType, currency: order.currency, livemode: order.livemode })
      return { status: 500, body: { ok: false, reason: 'refund_unmappable' } }
    }
    const { revoked } = await options.onRefund(order)
    options.log?.('stripe refund processed', { paymentIntentId: order.paymentIntentId, revoked })
    return { status: 200, body: { ok: true, reason: revoked ? 'refund_revoked' : 'refund_noop', orderId: order.paymentIntentId } }
  }

  // --- Purchase → grant ---
  const creditable = options.creditableEvents ?? ['checkout.session.completed', 'checkout.session.async_payment_succeeded']
  if (!creditable.includes(order.eventType)) {
    return { status: 200, body: { ok: true, reason: 'ignored_event' } }
  }

  // Require captured funds. A MISSING payment_status on what looks like our credit order
  // is a parser/shape gap → fail loud (500) rather than drop a possibly-paid order.
  if (order.paymentStatus !== 'paid') {
    const statusMissing = !order.paymentStatus
    const looksOurs = options.isCreditOrder(order) || Boolean(options.isOurStoreOrder?.(order)) || Boolean(options.isUnverifiedCreditOrder?.(order))
    if (statusMissing && looksOurs) {
      options.log?.('stripe recognized credit session missing payment_status — failing loud', { sessionId: order.sessionId, paymentIntentId: order.paymentIntentId })
      return { status: 500, body: { ok: false, reason: 'payment_status_missing', orderId: order.paymentIntentId } }
    }
    // Unpaid/processing (e.g. async pending): ack; async_payment_succeeded will follow.
    return { status: 200, body: { ok: true, reason: `payment_status_${order.paymentStatus ?? 'unknown'}`, orderId: order.paymentIntentId } }
  }

  if (!options.isCreditOrder(order)) {
    if (options.isUnverifiedCreditOrder?.(order)) {
      options.log?.('stripe paid session for a known pack has incomplete mode/currency identity — not crediting, retrying', { paymentIntentId: order.paymentIntentId, packId: order.packId, currency: order.currency, livemode: order.livemode })
      return { status: 500, body: { ok: false, reason: 'unverified_credit_order', orderId: order.paymentIntentId } }
    }
    if (options.isOurStoreOrder?.(order)) {
      options.log?.('stripe paid session on our account has an unrecognized pack — not crediting', { paymentIntentId: order.paymentIntentId, packId: order.packId })
      return { status: 500, body: { ok: false, reason: 'unrecognized_credit_pack', orderId: order.paymentIntentId } }
    }
    return { status: 200, body: { ok: true, reason: 'not_a_credit_order', orderId: order.paymentIntentId } }
  }

  // Bind attribution to a session THIS adapter created: require a valid metadata.uat for
  // (user_id, pack_id). A webhook signature only proves the event is from the account, not
  // that we created the session — so on a mixed account a colliding pack_id can't mint
  // credits. attributionSecret undefined ⇒ no attribution required (opt-out by omission).
  if (options.attributionSecret !== undefined) {
    const provided = typeof options.attributionSecret === 'string' ? [options.attributionSecret] : options.attributionSecret
    const secrets = provided.filter((s) => typeof s === 'string' && s.length > 0)
    if (secrets.length === 0 || !verifyStripeAttribution(order.userId, order.packId, order.userAttributionToken, secrets)) {
      options.log?.('stripe paid known-pack session has an invalid/missing attribution token — not crediting', { paymentIntentId: order.paymentIntentId, packId: order.packId })
      return { status: 500, body: { ok: false, reason: 'untrusted_attribution', orderId: order.paymentIntentId } }
    }
  }

  // A paid credit order without a PaymentIntent can't be keyed idempotently/revoked → 500.
  if (!order.paymentIntentId) {
    options.log?.('stripe paid credit session missing payment_intent — cannot key the grant, retrying', { sessionId: order.sessionId })
    return { status: 500, body: { ok: false, reason: 'missing_payment_intent', orderId: order.sessionId } }
  }

  const userId = (options.resolveUserId ?? ((o) => o.userId))(order)
  if (!userId) {
    options.log?.('stripe PAID credit order missing user id — not crediting; 500 so Stripe retries', { paymentIntentId: order.paymentIntentId })
    return { status: 500, body: { ok: false, reason: 'missing_user_id', orderId: order.paymentIntentId } }
  }
  if (options.userExists && !(await options.userExists(userId))) {
    options.log?.('stripe credit order for a non-existent (deleted) user — not crediting (no PII resurrection)', { paymentIntentId: order.paymentIntentId, userId })
    return { status: 200, body: { ok: true, reason: 'user_not_found', orderId: order.paymentIntentId } }
  }

  const amountMicros = options.creditsForOrder(order)
  if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
    options.log?.('stripe recognized credit order resolved to non-positive credits — config bug', { paymentIntentId: order.paymentIntentId, amountMicros })
    return { status: 500, body: { ok: false, reason: 'no_credit_amount', orderId: order.paymentIntentId } }
  }

  // Underpayment guard: the NET pre-tax paid (subtotal − discount, cross-checked against
  // total − tax) must cover the credits — so a Dashboard/coupon discount can't mint a
  // full pack value the buyer didn't pay for.
  if (typeof options.creditMicrosPerUnit === 'number' && options.creditMicrosPerUnit > 0) {
    const netPaidMinor = stripeNetPaidMinor(order)
    if (netPaidMinor === null) {
      options.log?.('stripe order has missing/inconsistent money fields — not granting', { paymentIntentId: order.paymentIntentId, amountSubtotalMinor: order.amountSubtotalMinor, amountTotalMinor: order.amountTotalMinor, amountDiscountMinor: order.amountDiscountMinor, amountTaxMinor: order.amountTaxMinor })
      return { status: 500, body: { ok: false, reason: 'invalid_money_fields', orderId: order.paymentIntentId } }
    }
    const oneUnitMinorMicros = options.creditMicrosPerUnit / 100 // micros per 1 minor unit
    const netPaidMicros = netPaidMinor * oneUnitMinorMicros
    if (netPaidMicros + oneUnitMinorMicros <= amountMicros) {
      options.log?.('stripe order underpaid for the credits it maps to — not granting', { paymentIntentId: order.paymentIntentId, amountMicros, netPaidMicros, netPaidMinor })
      return { status: 500, body: { ok: false, reason: 'underpaid_order', orderId: order.paymentIntentId } }
    }
  }

  const { created } = await options.grant(
    { userId, orderId: order.paymentIntentId, reason: `purchase:${order.paymentIntentId}`, amountMicros },
    order,
  )
  return { status: 200, body: { ok: true, orderId: order.paymentIntentId, created } }
}
