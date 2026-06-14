import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ERROR_CODES } from '../../shared/errors.js'
import type { CreditsService } from './creditsService.js'
import { handleLemonSqueezyWebhook, type LemonSqueezyOrder } from './lemonSqueezy.js'
import { createLemonSqueezyCheckout } from './lemonSqueezyCheckout.js'

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

export interface CreditsRoutesOptions {
  service: CreditsService
  /** Resolve the authenticated user id. Default: `request.user?.id`. */
  getUserId?: (request: FastifyRequest) => string | undefined
  balancePath?: string
  lemonSqueezy?: LemonSqueezyRouteOptions
  log?: (message: string, fields?: Record<string, unknown>) => void
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
  const balancePath = options.balancePath ?? '/api/credits/balance'

  // Server truth for the Buy-credits button so the client flag can't drift from
  // whether checkout is actually wired.
  const checkoutEnabled = Boolean(options.lemonSqueezy?.checkout)

  app.get(balancePath, async (request, reply) => {
    const userId = getUserId(request)
    if (!userId) {
      return reply.code(401).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: 'authentication required' } })
    }
    return reply.send({ ...(await options.service.getBalance(userId)), checkoutEnabled })
  })

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
    if (checkout.testMode !== undefined && checkout.testMode !== ls.expectedTestMode) {
      throw new Error(`credits: checkout testMode (${checkout.testMode}) does not match the webhook's expectedTestMode (${ls.expectedTestMode}) — orders from this checkout would be classified in the wrong mode and not credited`)
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
          isCreditOrder,
          // Credit-only store (the DEFAULT): an unknown-variant PAID order on our
          // store is a pack misconfiguration → retryable 500. Mixed store (explicit
          // creditOnlyStore: false): such an order is a different product → omit this
          // predicate so the handler 200-ignores it (no infinite retry/alert on
          // legitimate non-credit sales).
          isOurStoreOrder: creditOnlyStore ? isOurStoreOrder : undefined,
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
              refundFraction:
                order.refundedAmountCents > 0 && order.totalCents > 0
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
