import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ERROR_CODES } from '../../shared/errors.js'
import type { CreditsService } from './creditsService.js'
import { handleLemonSqueezyWebhook, type LemonSqueezyOrder } from './lemonSqueezy.js'
import { createLemonSqueezyCheckout } from './lemonSqueezyCheckout.js'
import { handleStripeWebhook, stripeNetPaidMinor, type StripeOrder } from './stripe.js'
import { createStripeCheckout } from './stripeCheckout.js'
import { safeCapture, noopTelemetry, type TelemetrySink } from '../../shared/telemetry.js'

/** Currencies whose minor unit is NOT 1/100 of the major (0-decimal and 3-decimal). The
 * Stripe credit math assumes 100 minor units/major, so these are rejected at config time. */
const NON_TWO_DECIMAL_CURRENCIES = new Set<string>([
  // 0-decimal
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
  // 3-decimal
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
])

export interface LemonSqueezyCheckoutConfig {
  apiKey: string
  storeId: string
  /** Pack variants keyed by a short pack id the client requests (e.g. "10","25"). */
  variants: Record<string, string>
  /** Pack id used when the request names none. */
  defaultPack: string
  redirectUrl?: string
  testMode?: boolean
}

/** Server-authored, display-ready credit pack the client can render WITHOUT inferring
 * money from the pack id. The Lemon Squeezy variant id is intentionally NOT exposed. */
export interface CreditPack {
  /** Opaque pack id the client passes back to `POST /api/credits/checkout` as `{ pack }`. */
  id: string
  /** Credits granted, in credit micros. */
  creditMicros: number
  /** Price in the currency's minor unit (e.g. cents) for display. */
  priceMinor: number
  /** ISO 4217 currency of `priceMinor`. */
  currency: string
  /** Display label (e.g. "€10"). */
  label: string
  /** Whether this is the default pack (used when checkout is invoked without a pack). */
  isDefault: boolean
  /** A pay-what-you-want pack: the buyer enters the amount on the hosted checkout, and
   * credits are granted proportional to what they pay. `priceMinor` is the MINIMUM and
   * `creditMicros` is 0 (unknown until paid). The client renders an "enter amount" CTA. */
  custom?: boolean
}

/**
 * Build the display-ready pack list from the configured checkout variants + per-variant
 * credit values, in config order. The pack id is the major-unit price (the existing
 * convention), so priceMinor = id × 100. The currency follows the configured checkout
 * currency (`requireCurrency`, default EUR) so a non-EUR store shows the right amount.
 * Returns [] when checkout or its variants aren't configured. Variant ids stay server-side.
 */
function buildCreditPacks(ls: LemonSqueezyRouteOptions, locale?: string): CreditPack[] {
  const checkout = ls.checkout
  if (!checkout) return []
  const credits = ls.creditMicrosByVariant ?? {}
  const currency = ls.requireCurrency ?? 'EUR'
  const packs: CreditPack[] = []
  for (const [packId, variantId] of Object.entries(checkout.variants)) {
    const major = Number(packId)
    const creditMicros = credits[variantId]
    if (!Number.isFinite(major) || major <= 0 || typeof creditMicros !== 'number' || creditMicros <= 0) continue
    const priceMinor = Math.round(major * 100)
    packs.push({
      id: packId,
      creditMicros,
      priceMinor,
      currency,
      label: new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(major),
      isDefault: packId === checkout.defaultPack,
    })
  }
  return packs
}

/**
 * Build display-ready packs for the Stripe provider: the fixed packs (pack id = major-unit
 * price, like LS) plus, when configured, the pay-what-you-want custom pack (priceMinor =
 * the minimum, creditMicros 0, custom: true). Currency follows requireCurrency. Price ids
 * stay server-side.
 */
function buildStripePacks(stripe: StripeRouteOptions, locale?: string): CreditPack[] {
  const checkout = stripe.checkout
  if (!checkout) return []
  const credits = stripe.creditMicrosByPack ?? {}
  const currency = (stripe.requireCurrency ?? 'EUR').toUpperCase()
  const packs: CreditPack[] = []
  for (const [packId] of Object.entries(checkout.variants)) {
    const major = Number(packId)
    const creditMicros = credits[packId]
    if (!Number.isFinite(major) || major <= 0 || typeof creditMicros !== 'number' || creditMicros <= 0) continue
    packs.push({
      id: packId,
      creditMicros,
      priceMinor: Math.round(major * 100),
      currency,
      label: new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(major),
      isDefault: packId === checkout.defaultPack,
    })
  }
  // Show the custom pack only when it's both a webhook policy AND buyable (a price to create
  // a checkout with). Its display minimum/id come from the top-level customPack policy.
  if (stripe.customPack && checkout.customPriceId) {
    packs.push({
      id: stripe.customPack.id,
      creditMicros: 0,
      priceMinor: stripe.customPack.minMinor,
      currency,
      label: 'Custom amount',
      isDefault: stripe.customPack.id === checkout.defaultPack,
      custom: true,
    })
  }
  return packs
}

export interface LemonSqueezyRouteOptions {
  webhookSecret: string
  /**
   * Secret used to sign/verify the checkout attribution token (`custom_data.uat`).
   * Defaults to `webhookSecret`, but SHOULD be a dedicated, stable secret so rotating
   * the LS webhook secret doesn't invalidate in-flight checkout links. Provide an
   * array (current first, then previous secrets) to allow rotation: checkouts sign
   * with the first; the webhook verifies against ANY, so in-flight links survive.
   */
  attributionSecret?: string | readonly string[]
  /** Optional: resolve whether a credited user still exists. When provided, a credit
   * order for a deleted user is 200-acked without granting (no PII resurrection via a
   * stale webhook). */
  userExists?: (userId: string) => Promise<boolean>
  /**
   * Variant ids that are credit packs. REQUIRED and non-empty for the webhook
   * to credit anything — only orders for these variants mint credits, so
   * unrelated products on the same store are ignored (fail closed).
   */
  creditVariantIds: string[]
  /** Expected mode of credit orders: true = test, false = live. An order whose
   * test_mode differs is ignored (prevents test↔live cross-crediting). */
  expectedTestMode: boolean
  /** Expected Lemon Squeezy store id. When set, an order from another store is
   * ignored (defense in depth on top of the per-store webhook secret). */
  expectedStoreId?: string
  /**
   * Whether this store sells ONLY credit packs. **Defaults to true (fail-closed).**
   * When true (a credit-only store), a paid order in our store/mode/currency whose
   * variant isn't a configured credit pack is treated as a pack MISCONFIGURATION and
   * returns a retryable 500 (the customer paid and would otherwise get nothing — a
   * visible, recoverable failure rather than a silent drop). Set **false** for a MIXED
   * store selling credits plus other products: such an order is then a different product
   * and is 200-ignored, so its webhook isn't retried/alerted forever. A known credit
   * variant with incomplete identity always 500s regardless (see isUnverifiedCreditOrder).
   */
  creditOnlyStore?: boolean
  /** Currency a paid order must be in to be credited (default 'EUR'). A missing
   * or mismatched currency is rejected. */
  requireCurrency?: string
  /**
   * Fixed credit micros to grant per credit-pack variant id. REQUIRED, and the
   * ONLY crediting basis — never order-amount math: the grant is the pack's
   * configured value, so a multi-item order, a discount, or a tax change can't
   * change how many credits are minted. Every entry in `creditVariantIds` must
   * have a positive value here (enforced at registration). A non-pack host that
   * needs a different policy must add an explicit, separately-tested route — the
   * money webhook keeps exactly one safe path.
   */
  creditMicrosByVariant: Record<string, number>
  webhookPath?: string
  /** Server-side checkout creation. Required for money-safe buyer attribution
   * (the user id is set server-side, not by the browser). */
  checkout?: LemonSqueezyCheckoutConfig
  checkoutPath?: string
}

export interface StripeCheckoutConfig {
  /** Stripe secret key (sk_… or rk_…). */
  apiKey: string
  /** Fixed packs keyed by a short pack id the client requests (e.g. "10","25") → Stripe Price id. */
  variants: Record<string, string>
  /** Pack id used when the request names none. */
  defaultPack: string
  /** Stripe Price id of the custom (pay-what-you-want) pack, for creating its checkout.
   * The custom pack's webhook policy (id, minimum) lives on StripeRouteOptions.customPack. */
  customPriceId?: string
  redirectUrl?: string
}

export interface StripeRouteOptions {
  /** Webhook endpoint signing secret (whsec_…). When omitted, the webhook route is NOT
   * registered (checkout can still open, but purchases won't auto-credit). */
  webhookSecret?: string
  /** Secret(s) to sign/verify the attribution token (metadata.uat). Defaults to the
   * webhook secret. Provide [current, ...previous] so rotating the webhook secret doesn't
   * reject in-flight checkouts: sessions sign with the first; the webhook verifies any. */
  attributionSecret?: string | readonly string[]
  /** true = test mode. The webhook only credits sessions whose livemode matches. */
  expectedTestMode: boolean
  /** Currency a paid session must be in to be credited (default 'EUR'). */
  requireCurrency?: string
  /** Whether the account sells only credit packs (default true → an unknown-pack PAID
   * session is a misconfig that fails loud rather than a silent drop). */
  creditOnlyStore?: boolean
  /** Resolve whether a credited user still exists (no PII resurrection on a stale webhook). */
  userExists?: (userId: string) => Promise<boolean>
  /** Fixed pack id → credit micros (the authoritative value the webhook grants). The
   * custom pack is credited from the amount paid, not this map. */
  creditMicrosByPack: Record<string, number>
  /** Pay-what-you-want pack WEBHOOK policy — its reserved id and minimum (minor units).
   * Top-level (not under checkout) so a paid custom session is still recognized/credited
   * even if checkout creation is temporarily unconfigured. The price id for CREATING the
   * checkout lives at checkout.customPriceId. */
  customPack?: { id: string; minMinor: number }
  checkout?: StripeCheckoutConfig
  checkoutPath?: string
  webhookPath?: string
}

export interface CreditsRoutesOptions {
  service: CreditsService
  /** Resolve the authenticated user id. Default: `request.user?.id`. */
  getUserId?: (request: FastifyRequest) => string | undefined
  balancePath?: string
  historyPath?: string
  /** Configure at most ONE purchase provider. */
  lemonSqueezy?: LemonSqueezyRouteOptions
  stripe?: StripeRouteOptions
  log?: (message: string, fields?: Record<string, unknown>) => void
  /** Best-effort telemetry for checkout.started / purchase.webhook_rejected (default noop). */
  telemetry?: TelemetrySink
}

function defaultGetUserId(request: FastifyRequest): string | undefined {
  const user = (request as FastifyRequest & { user?: { id?: unknown } }).user
  return typeof user?.id === 'string' && user.id ? user.id : undefined
}

/**
 * Register the credit balance endpoint and (optionally) the Lemon Squeezy
 * purchase webhook. The webhook route reads the RAW request body so the HMAC
 * signature can be verified before parsing.
 */
export function registerCreditsRoutes(app: FastifyInstance, options: CreditsRoutesOptions): void {
  const getUserId = options.getUserId ?? defaultGetUserId
  const telemetry = options.telemetry ?? noopTelemetry
  const balancePath = options.balancePath ?? '/api/credits/balance'

  if (options.lemonSqueezy && options.stripe) {
    throw new Error('credits: configure at most one purchase provider (lemonSqueezy OR stripe), not both')
  }

  // Stripe checkout is only "live" when its webhook is ALSO wired — otherwise a buyer
  // would be charged with no webhook to credit them. Don't advertise it without both.
  const stripeReady = Boolean(options.stripe?.checkout && options.stripe?.webhookSecret)
  // Server truth for the Buy-credits button so the client flag can't drift from
  // whether checkout is actually wired.
  const checkoutEnabled = Boolean(options.lemonSqueezy?.checkout) || stripeReady
  // Display-ready packs (only when checkout is wired); provider price/variant ids stay server-side.
  const packs = options.lemonSqueezy
    ? buildCreditPacks(options.lemonSqueezy)
    : stripeReady
      ? buildStripePacks(options.stripe!)
      : []

  app.get(balancePath, async (request, reply) => {
    const userId = getUserId(request)
    if (!userId) {
      return reply.code(401).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: 'authentication required' } })
    }
    return reply.send({
      ...(await options.service.getBalance(userId)),
      checkoutEnabled,
      ...(packs.length > 0 ? { packs } : {}),
    })
  })

  // Read-only credit activity for the account page. Auth-gated, user-scoped, limit
  // clamped server-side; entries carry only generic/sanitized descriptions.
  const historyPath = options.historyPath ?? '/api/credits/history'
  app.get(historyPath, async (request, reply) => {
    const userId = getUserId(request)
    if (!userId) {
      return reply.code(401).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: 'authentication required' } })
    }
    const raw = (request.query as { limit?: unknown } | undefined)?.limit
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN
    const limit = Number.isFinite(parsed) ? Math.min(50, Math.max(1, Math.trunc(parsed))) : 20
    return reply.send({ entries: await options.service.listLedger(userId, limit) })
  })

  const stripeOpts = options.stripe
  if (stripeOpts) {
    // A disabled credits service can't grant/tombstone, so exposing checkout/webhook
    // would 200-ack paid orders WITHOUT crediting (customer pays, no credits).
    if (!options.service.config.enabled) {
      throw new Error('credits: cannot register Stripe checkout/webhook with a disabled credits service (paid orders would be acknowledged without crediting)')
    }
    registerStripeRoutes(app, options.service, getUserId, stripeOpts, options.log, telemetry)
    return
  }

  const ls = options.lemonSqueezy
  if (!ls) return

  // A disabled credits service can't grant or tombstone, so exposing the
  // checkout/webhook would 200-ack paid orders WITHOUT crediting (customer pays,
  // no credits, LS stops retrying). Refuse to wire purchase routes when disabled.
  if (!options.service.config.enabled) {
    throw new Error('credits: cannot register Lemon Squeezy checkout/webhook with a disabled credits service (paid orders would be acknowledged without crediting)')
  }
  // An empty credit-variant list would treat every paid order as not-a-credit-
  // order (200, no credit) — a paid customer gets nothing. Refuse to register.
  if (ls.creditVariantIds.length === 0) {
    throw new Error('credits: Lemon Squeezy webhook requires a non-empty creditVariantIds (else every paid order is acknowledged without crediting)')
  }
  // Attribution secret(s), decoupled from the webhook secret so rotating the webhook
  // secret doesn't invalidate in-flight checkout `uat` tokens. Default to the webhook
  // secret (back-compat). Checkouts SIGN with the first; the webhook VERIFIES against
  // all (current + previous) for rotation grace. An empty/all-blank array would leave
  // signing on the webhook secret but DISABLE verification (length 0 ⇒ skipped),
  // silently reopening the arbitrary-user_id attribution hole — so normalize an empty
  // result back to the webhook secret for BOTH signing and verification.
  const rawAttributionSecrets =
    ls.attributionSecret === undefined
      ? [ls.webhookSecret]
      : typeof ls.attributionSecret === 'string'
        ? [ls.attributionSecret]
        : ls.attributionSecret
  const filteredAttributionSecrets = rawAttributionSecrets.filter((s) => typeof s === 'string' && s.length > 0)
  const attributionSecrets: readonly string[] =
    filteredAttributionSecrets.length > 0 ? filteredAttributionSecrets : [ls.webhookSecret]
  const attributionSigningSecret = attributionSecrets[0]

  // Server-side checkout creation: the buyer's user id is taken from the
  // authenticated session, NOT the browser, so the webhook can trust it.
  if (ls.checkout) {
    const checkout = ls.checkout
    // A checkout pack the webhook can't credit is a money trap: the customer pays
    // through a server-created checkout and the webhook then fails to credit (or
    // 500s as an unrecognized variant). Fail registration unless every checkout
    // variant is a configured credit variant with a positive credit value, and the
    // default pack exists. (Full-app derives both maps from one env, but the
    // exported route API must not allow the unsafe wiring.)
    const checkoutCreditVariants = new Set(ls.creditVariantIds)
    for (const [packId, variantId] of Object.entries(checkout.variants)) {
      if (!checkoutCreditVariants.has(variantId)) {
        throw new Error(`credits: checkout pack "${packId}" maps to variant "${variantId}", which is not a configured credit variant (creditVariantIds) — a paid checkout for it would not be credited by the webhook`)
      }
      const micros = ls.creditMicrosByVariant?.[variantId]
      if (typeof micros !== 'number' || !Number.isSafeInteger(micros) || micros <= 0) {
        throw new Error(`credits: checkout pack "${packId}" variant "${variantId}" has no positive creditMicrosByVariant entry — a paid checkout for it could not be credited`)
      }
    }
    if (!(checkout.defaultPack in checkout.variants)) {
      throw new Error(`credits: checkout defaultPack "${checkout.defaultPack}" is not one of the configured checkout variants`)
    }
    // The checkout creates orders for checkout.storeId in checkout.testMode; the
    // webhook only credits orders matching expectedStoreId/expectedTestMode. A
    // mismatch is a money trap: the customer pays, but the resulting order is
    // classified as not-a-credit-order and 200-ignored without crediting. Fail
    // registration so checkout and webhook can't be wired to different store/mode.
    if (ls.expectedStoreId !== undefined && checkout.storeId !== ls.expectedStoreId) {
      throw new Error(`credits: checkout storeId "${checkout.storeId}" does not match the webhook's expectedStoreId "${ls.expectedStoreId}" — orders from this checkout would not be credited`)
    }
    // checkout.testMode must be PRESENT and match: if omitted, createLemonSqueezyCheckout
    // sends no test_mode and LS falls back to the store default, which may differ from
    // expectedTestMode → the webhook classifies the paid order as not-a-credit-order and
    // drops it. Require it explicitly so generated checkouts and the webhook can't disagree.
    if (checkout.testMode !== ls.expectedTestMode) {
      throw new Error(`credits: checkout testMode (${checkout.testMode}) must be set and match the webhook's expectedTestMode (${ls.expectedTestMode}) — otherwise orders from this checkout would be classified in the wrong mode and not credited`)
    }
    app.post(ls.checkoutPath ?? '/api/credits/checkout', async (request, reply) => {
      const userId = getUserId(request)
      if (!userId) {
        return reply.code(401).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: 'authentication required' } })
      }
      const pack = (request.body as { pack?: unknown } | undefined)?.pack
      // Absent pack → default; an explicitly-requested unknown pack → 400 (don't
      // silently charge for a different pack than the client asked for).
      if (pack !== undefined && pack !== null && (typeof pack !== 'string' || !(pack in checkout.variants))) {
        return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_PACK, message: 'unknown credit pack' } })
      }
      const packId = typeof pack === 'string' && pack in checkout.variants ? pack : checkout.defaultPack
      const variantId = checkout.variants[packId]
      if (!variantId) {
        return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_PACK, message: 'unknown credit pack' } })
      }
      const email = (request as FastifyRequest & { user?: { email?: unknown } }).user?.email
      try {
        const { url } = await createLemonSqueezyCheckout({
          apiKey: checkout.apiKey,
          storeId: checkout.storeId,
          variantId,
          userId,
          // Sign the attribution token with the (current) attribution secret so the
          // webhook can verify the buyer id came from this server-created checkout.
          attributionSecret: attributionSigningSecret,
          email: typeof email === 'string' ? email : undefined,
          redirectUrl: checkout.redirectUrl,
          testMode: checkout.testMode,
        })
        return reply.send({ url })
      } catch (error) {
        options.log?.('credits: checkout creation failed', { error: String(error) })
        return reply.code(502).send({ error: { code: ERROR_CODES.CHECKOUT_FAILED, message: 'could not create checkout' } })
      }
    })
  }

  const webhookPath = ls.webhookPath ?? '/api/credits/webhooks/lemonsqueezy'
  const creditMicrosPerUnit = options.service.config.pricing.creditMicrosPerUnit
  // Crediting basis (NO order-amount fallback — that couples credits to a
  // multi-item/discounted/taxed order total). Require a fixed per-variant value
  // covering every credit variant; fail registration otherwise.
  // Namespace the idempotency/purchase key by the configured store + mode so a
  // Lemon Squeezy order id that's reused across test/live or stores (or test data
  // sharing a prod DB before cutover) can't collide: a test order can't block a
  // live order, etc. The raw order id is preserved as the suffix + in the stored
  // identity columns for audit.
  const purchaseKey = (order: LemonSqueezyOrder): string =>
    `ls:${ls.expectedStoreId ?? 'default'}:${ls.expectedTestMode ? 'test' : 'live'}:${order.orderId}`
  const variantCredits = ls.creditMicrosByVariant ?? {}
  if (!ls.creditMicrosByVariant) {
    throw new Error('credits: creditMicrosByVariant is required for the Lemon Squeezy webhook (fixed per-variant credit values; no order-amount fallback)')
  }
  for (const variantId of ls.creditVariantIds) {
    const value = variantCredits[variantId]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`credits: creditMicrosByVariant must be a positive safe integer for credit variant "${variantId}"`)
    }
  }
  const creditsForOrder = (order: LemonSqueezyOrder): number => {
    // Per-pack value × quantity, so a multi-pack purchase is credited fairly
    // (the underpayment check then requires the net paid to cover the total).
    const perUnit = order.variantId !== undefined ? variantCredits[order.variantId] ?? 0 : 0
    return perUnit * Math.max(1, order.quantity)
  }

  // Fail closed: only credit paid orders for a configured pack variant, in the
  // required currency, and in the expected mode. Missing/absent fields are
  // rejected — billing must not infer safety from absent data.
  const creditVariantIds = new Set(ls.creditVariantIds)
  const requireCurrency = (ls.requireCurrency ?? 'EUR').toUpperCase()
  // STRICT store/mode/currency check (no variant) — a present field must match
  // AND mode/currency must be present. Used for a PAID grant's "is this our
  // store" decision (a paid order must not infer safety from absent data).
  const isOurStoreOrder = (order: LemonSqueezyOrder): boolean => {
    if (!order.currency || order.currency.toUpperCase() !== requireCurrency) return false
    if (order.testMode !== ls.expectedTestMode) return false
    if (ls.expectedStoreId && order.storeId !== ls.expectedStoreId) return false
    return true
  }
  // LENIENT store/mode/currency check for REFUNDS: a refund payload may legitimately
  // omit store_id/test_mode/currency, and the credited row already carries the
  // validated identity. So a MISSING field passes; only a PRESENT field that
  // contradicts config rejects (blocks a refund claiming a different store/mode).
  const isRefundForOurStore = (order: LemonSqueezyOrder): boolean => {
    if (order.currency != null && order.currency.toUpperCase() !== requireCurrency) return false
    if (order.testMode != null && order.testMode !== ls.expectedTestMode) return false
    if (order.storeId != null && ls.expectedStoreId != null && order.storeId !== ls.expectedStoreId) return false
    return true
  }
  const isCreditVariant = (order: LemonSqueezyOrder): boolean =>
    order.variantId != null && creditVariantIds.has(order.variantId)
  const isCreditOrder = (order: LemonSqueezyOrder): boolean => {
    if (creditVariantIds.size === 0) return false
    if (!isCreditVariant(order)) return false
    return isOurStoreOrder(order)
  }
  // A KNOWN credit variant, paid, that the strict store check rejects ONLY because
  // a required identity field is MISSING (lenient check still passes = no present
  // contradiction). That's a paid pack we can't safely attribute → fail loud (500),
  // not a silent 200 drop. A genuinely foreign order (present mismatch) fails the
  // lenient check too and is correctly left to the 200 not-a-credit-order path.
  const isUnverifiedCreditOrder = (order: LemonSqueezyOrder): boolean =>
    isCreditVariant(order) && !isOurStoreOrder(order) && isRefundForOurStore(order)
  // Fail-closed default: a credits webhook is for a credit-only store unless the host
  // explicitly opts into mixed-store behaviour (creditOnlyStore: false). So an unknown-
  // variant paid order on our store surfaces as a retryable 500 (visible, recoverable)
  // rather than a silent 200 drop that loses a paying customer's credits.
  const creditOnlyStore = ls.creditOnlyStore !== false

  // Encapsulated scope so the raw-buffer body parser only applies to the webhook.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })
    scope.post(webhookPath, async (request, reply) => {
      const rawBody = request.body as Buffer
      const signature = request.headers['x-signature']
      const result = await handleLemonSqueezyWebhook(
        rawBody,
        typeof signature === 'string' ? signature : Array.isArray(signature) ? signature[0] : undefined,
        {
          secret: ls.webhookSecret,
          creditsForOrder,
          // Don't resurrect a deleted user's PII via a stale order_created webhook.
          userExists: ls.userExists,
          isCreditOrder,
          // Credit-only store (the DEFAULT): an unknown-variant PAID order on our store
          // is a pack misconfiguration → retryable 500. Use the LENIENT identity check
          // (isRefundForOurStore: missing store/mode/currency still counts as ours; only
          // a PRESENT contradiction is exempt) so a misconfigured new pack whose payload
          // omits store_id isn't silently 200-dropped. Mixed store (explicit
          // creditOnlyStore: false): omit this predicate so the handler 200-ignores an
          // unknown variant (a different product — no infinite retry on legit sales).
          isOurStoreOrder: creditOnlyStore ? isRefundForOurStore : undefined,
          // Known credit variant with incomplete identity → retryable 500, not a
          // silent 200 drop (a paid pack we can't safely attribute must fail loud).
          // Fires regardless of creditOnlyStore (it's a recognized pack either way).
          isUnverifiedCreditOrder,
          // Lenient: a refund whose payload omits store/mode/currency still revokes
          // a credited order; only a present-and-mismatched field is rejected.
          isRefundForOurStore,
          // Bind buyer attribution to a server-created checkout (custom_data.uat).
          // Verify against current + previous secrets so a rotation doesn't reject
          // in-flight checkout links.
          attributionSecret: attributionSecrets,
          // Refuse to grant a fixed pack value the buyer didn't actually pay for.
          creditMicrosPerUnit,
          grant: (input, order) =>
            options.service.grantPurchase(input.userId, purchaseKey(order), input.amountMicros, {
              storeId: order.storeId,
              testMode: order.testMode,
              currency: order.currency,
              variantId: order.variantId,
            }),
          // Refunds/disputes revoke the order's credits. A PARTIAL refund passes
          // the cumulative refunded fraction (refunded_amount / total); a full
          // refund passes undefined. allowTombstone gates writing a pre-grant
          // tombstone for an order we HAVEN'T credited yet: only when the refund
          // still validates as a credit order (prevents a cross-store/mode refund
          // from tombstoning by order id). An order we already credited is always
          // revocable regardless (reconciled by order id in the store).
          onRefund: (order) =>
            options.service.revokePurchase(purchaseKey(order), {
              // A partial refund passes the fraction refunded; a missing/zero total
              // (totalCents undefined) or refunded amount falls back to a full refund.
              refundFraction:
                order.refundedAmountCents > 0 && order.totalCents !== undefined && order.totalCents > 0
                  ? order.refundedAmountCents / order.totalCents
                  : undefined,
              // Tombstone an unknown order when the refund is compatible with our
              // store/mode (lenient: missing fields OK). This leniency is DELIBERATE:
              // Lemon Squeezy refund payloads routinely omit the variant id (and often
              // store/mode), so requiring strict identity here would SKIP the tombstone
              // for a refund-before-grant whose payload lacks the variant — reintroducing
              // the bug where the later order_created then grants credits for an order
              // already refunded (the refund fired first, found nothing to revoke, and
              // never re-fires). Safe because: (a) the per-store webhook secret already
              // proves the refund is from our store; (b) the composite purchase key is
              // namespaced by CONFIG store+mode (not the payload), so the tombstone lands
              // in our namespace; (c) order ids are globally unique, so a tombstone can
              // only ever net a FUTURE grant for that SAME order — exactly the intended
              // refund-before-grant behaviour, never a different legitimate order.
              allowTombstone: isRefundForOurStore(order),
              // Match the credited row against the CONFIGURED identity (not the
              // payload's maybe-missing fields). The per-store/mode webhook secret
              // already proves the refund is from our store+mode; the row's stored
              // identity equals config for legit grants, so a colliding order id
              // from another store can't reach here (HMAC) and a legit refund whose
              // payload omits store_id still revokes.
              expectedStoreId: ls.expectedStoreId,
              expectedTestMode: ls.expectedTestMode,
              expectedCurrency: requireCurrency,
            }),
          log: options.log,
        },
      )
      return reply.code(result.status).send(result.body)
    })
  })
}

/**
 * Register the Stripe checkout + webhook routes. Mirrors the Lemon Squeezy wiring's
 * money-safety posture (mode/currency gating, idempotent grant per PaymentIntent, refund
 * revoke, fail-loud on a recognized-but-unattributable paid order). Adds the pay-what-you-
 * want "custom" pack: credited from the amount actually paid, not a fixed pack value.
 */
function registerStripeRoutes(
  app: FastifyInstance,
  service: CreditsService,
  getUserId: (request: FastifyRequest) => string | undefined,
  stripe: StripeRouteOptions,
  log: ((message: string, fields?: Record<string, unknown>) => void) | undefined,
  telemetry: TelemetrySink = noopTelemetry,
): void {
  const creditMicrosPerUnit = service.config.pricing.creditMicrosPerUnit
  // Stripe currencies arrive lowercase; store/compare uppercased for the ledger identity.
  const requireCurrency = (stripe.requireCurrency ?? 'EUR').toUpperCase()
  // The credit math assumes 100 minor units per major unit (ratePerMinor = micros/100).
  // That's wrong for 0-decimal (e.g. JPY) and 3-decimal (e.g. KWD/BHD) currencies, which
  // would mis-credit real paid orders. Restrict to 2-decimal currencies at startup rather
  // than silently mis-credit; non-2-decimal support would need a per-currency exponent.
  if (NON_TWO_DECIMAL_CURRENCIES.has(requireCurrency)) {
    throw new Error(`credits: Stripe currency "${requireCurrency}" is not a 2-decimal currency; the credit math assumes 100 minor units per major unit. Use a 2-decimal currency (e.g. EUR/USD/GBP/CHF).`)
  }
  const expectedLiveMode = !stripe.expectedTestMode
  const creditOnlyStore = stripe.creditOnlyStore !== false
  const fixedPackMicros = stripe.creditMicrosByPack ?? {}
  const customPackId = stripe.customPack?.id

  // Exposing checkout without a webhook would charge buyers with nothing to credit them
  // (and no refund tombstone). Require the webhook secret whenever checkout is configured.
  if (stripe.checkout && !stripe.webhookSecret) {
    throw new Error('credits: Stripe checkout is configured but no webhookSecret — buyers would be charged without being credited (no fulfillment webhook). Set BORING_CREDITS_STRIPE_WEBHOOK_SECRET.')
  }
  const webhookSecret = stripe.webhookSecret
  // No secret ⇒ no checkout either (guarded above), so nothing to register.
  if (!webhookSecret) return

  // Attribution secrets (current + previous) decoupled from the webhook secret so rotating
  // it doesn't reject in-flight checkouts. Default to the webhook secret. Sign with the
  // first; verify against all. Normalize an empty/all-blank list back to the webhook secret
  // so verification can't be silently disabled.
  const rawAttribution = stripe.attributionSecret === undefined
    ? [webhookSecret]
    : typeof stripe.attributionSecret === 'string' ? [stripe.attributionSecret] : stripe.attributionSecret
  const attributionSecrets = rawAttribution.filter((s) => typeof s === 'string' && s.length > 0)
  const effectiveAttributionSecrets: readonly string[] = attributionSecrets.length > 0 ? attributionSecrets : [webhookSecret]
  const attributionSigningSecret = effectiveAttributionSecrets[0]

  if (stripe.checkout) {
    const checkout = stripe.checkout
    // Stripe payment-mode Checkout REQUIRES success_url; without a redirect url every
    // checkout creation would 502. Fail fast rather than advertise a broken Buy button.
    if (!checkout.redirectUrl) {
      throw new Error('credits: Stripe checkout requires a redirect URL (BORING_CREDITS_STRIPE_REDIRECT_URL) — Stripe rejects payment-mode sessions without a success_url')
    }
    // Every fixed checkout pack must have a positive credit value, and the default must
    // exist — else a paid checkout for it couldn't be credited (a money trap).
    for (const [packId, priceId] of Object.entries(checkout.variants)) {
      const micros = fixedPackMicros[packId]
      if (typeof micros !== 'number' || !Number.isSafeInteger(micros) || micros <= 0) {
        throw new Error(`credits: stripe checkout pack "${packId}" (price ${priceId}) has no positive creditMicrosByPack entry`)
      }
    }
    // The default pack must be a configured fixed pack OR the custom pack (a custom-only
    // deployment defaults to the custom pack — requires its price id to create the checkout).
    const defaultIsCustom = customPackId != null && checkout.defaultPack === customPackId && checkout.customPriceId != null
    if (!(checkout.defaultPack in checkout.variants) && !defaultIsCustom) {
      throw new Error(`credits: stripe checkout defaultPack "${checkout.defaultPack}" is not one of the configured packs (or the custom pack)`)
    }
    if (customPackId && customPackId in checkout.variants) {
      throw new Error(`credits: stripe custom pack id "${customPackId}" collides with a fixed pack id`)
    }
  }

  const isFixedPack = (packId: string | undefined): boolean => packId != null && packId in fixedPackMicros
  const isCustomPack = (packId: string | undefined): boolean => customPackId != null && packId === customPackId
  const isKnownPack = (packId: string | undefined): boolean => isFixedPack(packId) || isCustomPack(packId)

  // micros granted per 1 minor currency unit (e.g. per rappen/cent).
  const ratePerMinor = creditMicrosPerUnit / 100
  const customMinMinor = stripe.customPack?.minMinor ?? 0
  const creditsForOrder = (order: StripeOrder): number => {
    if (isCustomPack(order.packId)) {
      // Pay-what-you-want: credit the NET pre-tax amount actually paid (subtotal − discount,
      // validated), not the pre-discount subtotal — so a discount can't over-credit. Enforce
      // the configured minimum SERVER-side too; a below-min/invalid amount returns 0 → the
      // handler fails loud (no_credit_amount 500) for operator review.
      const net = stripeNetPaidMinor(order)
      if (net === null || net <= 0 || net < customMinMinor) return 0
      return Math.floor(net * ratePerMinor)
    }
    if (isFixedPack(order.packId)) return fixedPackMicros[order.packId as string] ?? 0
    return 0
  }

  // STRICT (paid grant): mode + currency must be PRESENT and match.
  const isOurStoreOrder = (order: StripeOrder): boolean =>
    order.livemode === expectedLiveMode && order.currency != null && order.currency.toUpperCase() === requireCurrency
  // LENIENT (refund): a missing field passes; only a present contradiction rejects.
  const isRefundForOurStore = (order: StripeOrder): boolean => {
    if (order.livemode != null && order.livemode !== expectedLiveMode) return false
    if (order.currency != null && order.currency.toUpperCase() !== requireCurrency) return false
    return true
  }
  const isCreditOrder = (order: StripeOrder): boolean => isKnownPack(order.packId) && isOurStoreOrder(order)
  // A known pack_id only exists on a session WE created (we set it in metadata), so a paid
  // known-pack session that fails the strict mode/currency check is OURS-but-misconfigured
  // (e.g. a Price in the wrong currency), NOT a foreign order. Treat it as unverified →
  // the handler returns a retryable 500, never a silent 200 drop of a paid order.
  const isUnverifiedCreditOrder = (order: StripeOrder): boolean =>
    isKnownPack(order.packId) && !isOurStoreOrder(order)

  // Namespace the idempotency/purchase key by mode so a PaymentIntent id can't collide
  // across test/live (e.g. test data sharing a DB before cutover).
  const purchaseKey = (paymentIntentId: string): string => `stripe:${stripe.expectedTestMode ? 'test' : 'live'}:${paymentIntentId}`

  if (stripe.checkout) {
    const checkout = stripe.checkout
    app.post(stripe.checkoutPath ?? '/api/credits/checkout', async (request, reply) => {
      const userId = getUserId(request)
      if (!userId) {
        return reply.code(401).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: 'authentication required' } })
      }
      const pack = (request.body as { pack?: unknown } | undefined)?.pack
      let packId: string
      let priceId: string
      if (pack === undefined || pack === null) {
        packId = checkout.defaultPack
        // The default may be the custom pack (custom-only deployment) — resolve its price.
        priceId = isCustomPack(packId) && checkout.customPriceId ? checkout.customPriceId : (checkout.variants[packId] as string)
      } else if (typeof pack === 'string' && pack in checkout.variants) {
        packId = pack
        priceId = checkout.variants[pack] as string
      } else if (typeof pack === 'string' && isCustomPack(pack) && checkout.customPriceId) {
        packId = pack
        priceId = checkout.customPriceId
      } else {
        return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_PACK, message: 'unknown credit pack' } })
      }
      const email = (request as FastifyRequest & { user?: { email?: unknown } }).user?.email
      try {
        const { url } = await createStripeCheckout({
          apiKey: checkout.apiKey,
          priceId,
          userId,
          packId,
          // Sign (user, pack) so the webhook can confirm THIS adapter created the session.
          attributionSecret: attributionSigningSecret,
          email: typeof email === 'string' ? email : undefined,
          redirectUrl: checkout.redirectUrl,
        })
        safeCapture(telemetry, { name: 'checkout.started', distinctId: userId, properties: { provider: 'stripe', packId } })
        return reply.send({ url })
      } catch (error) {
        log?.('credits: stripe checkout creation failed', { error: String(error) })
        return reply.code(502).send({ error: { code: ERROR_CODES.CHECKOUT_FAILED, message: 'could not create checkout' } })
      }
    })
  }

  const webhookPath = stripe.webhookPath ?? '/api/credits/webhooks/stripe'
  app.register(async (scope) => {
    // Raw body so the Stripe signature can be verified before parsing.
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })
    scope.post(webhookPath, async (request, reply) => {
      const rawBody = request.body as Buffer
      const signature = request.headers['stripe-signature']
      const result = await handleStripeWebhook(
        rawBody,
        typeof signature === 'string' ? signature : Array.isArray(signature) ? signature[0] : undefined,
        {
          secret: webhookSecret,
          creditsForOrder,
          userExists: stripe.userExists,
          isCreditOrder,
          // Credit-only store (default): a paid session that's ours but an unknown pack →
          // retryable 500 (lenient identity) rather than a silent drop. Mixed store: omit.
          isOurStoreOrder: creditOnlyStore ? isRefundForOurStore : undefined,
          isUnverifiedCreditOrder,
          isRefundForOurStore,
          creditMicrosPerUnit,
          // Verify the session was created by THIS adapter (metadata.uat). Verify against
          // ALL attribution secrets (current + previous) so a rotation doesn't reject
          // in-flight checkouts. Defends a mixed Stripe account from a colliding pack_id.
          attributionSecret: effectiveAttributionSecrets,
          grant: (input, order) =>
            service.grantPurchase(input.userId, purchaseKey(order.paymentIntentId as string), input.amountMicros, {
              testMode: stripe.expectedTestMode,
              currency: order.currency?.toUpperCase(),
              variantId: order.packId,
            }),
          onRefund: (order) =>
            service.revokePurchase(purchaseKey(order.paymentIntentId as string), {
              // charge.refunded carries amount_refunded/amount → a proportional fraction
              // for partial refunds. charge.dispute.created carries neither, so the fraction
              // is undefined ⇒ FULL revoke. That's deliberate and safe: a dispute withholds
              // the funds immediately, so revoking the whole order's credits is the
              // conservative direction (a rare partial dispute over-revokes, recoverable by
              // re-grant, vs. the worse alternative of leaving clawed-back funds credited).
              refundFraction:
                order.amountRefundedMinor !== undefined && order.amountRefundedMinor > 0 && order.amountMinor !== undefined && order.amountMinor > 0
                  ? order.amountRefundedMinor / order.amountMinor
                  : undefined,
              allowTombstone: isRefundForOurStore(order),
              expectedTestMode: stripe.expectedTestMode,
              expectedCurrency: requireCurrency,
            }),
          log,
        },
      )
      // Billing-error signal: a rejected/retryable webhook (bad attribution, underpaid,
      // invalid money, refund-unmappable…). Successes (2xx) are not noise here.
      if (result.status >= 400) {
        const reason = (result.body as { reason?: unknown })?.reason
        safeCapture(telemetry, {
          name: 'purchase.webhook_rejected',
          properties: { provider: 'stripe', reason: typeof reason === 'string' ? reason : undefined },
        })
      }
      return reply.code(result.status).send(result.body)
    })
  })
}
