import type { FastifyInstance, FastifyRequest } from 'fastify'
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
  /** Currency a paid order must be in to be credited (default 'EUR'). A missing
   * or mismatched currency is rejected. */
  requireCurrency?: string
  /**
   * Fixed credit micros to grant per credit-pack variant id. STRONGLY preferred
   * over order-amount math: the grant is the pack's configured value, so a
   * multi-item order, a discount, or a tax change can't change how many credits
   * are minted. A variant not in this map (but in creditVariantIds) falls back
   * to `creditsForOrder`.
   */
  creditMicrosByVariant?: Record<string, number>
  /** Credit micros to grant for an order. Default: net pre-tax subtotal ×
   * creditMicrosPerUnit. Only used when a variant has no creditMicrosByVariant
   * entry — prefer the variant map to avoid whole-order-amount pitfalls. */
  creditsForOrder?: (order: LemonSqueezyOrder) => number
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
      return reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'authentication required' } })
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

  // Server-side checkout creation: the buyer's user id is taken from the
  // authenticated session, NOT the browser, so the webhook can trust it.
  if (ls.checkout) {
    const checkout = ls.checkout
    app.post(ls.checkoutPath ?? '/api/credits/checkout', async (request, reply) => {
      const userId = getUserId(request)
      if (!userId) {
        return reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'authentication required' } })
      }
      const pack = (request.body as { pack?: unknown } | undefined)?.pack
      // Absent pack → default; an explicitly-requested unknown pack → 400 (don't
      // silently charge for a different pack than the client asked for).
      if (pack !== undefined && pack !== null && (typeof pack !== 'string' || !(pack in checkout.variants))) {
        return reply.code(400).send({ error: { code: 'INVALID_PACK', message: 'unknown credit pack' } })
      }
      const packId = typeof pack === 'string' && pack in checkout.variants ? pack : checkout.defaultPack
      const variantId = checkout.variants[packId]
      if (!variantId) {
        return reply.code(400).send({ error: { code: 'INVALID_PACK', message: 'unknown credit pack' } })
      }
      const email = (request as FastifyRequest & { user?: { email?: unknown } }).user?.email
      try {
        const { url } = await createLemonSqueezyCheckout({
          apiKey: checkout.apiKey,
          storeId: checkout.storeId,
          variantId,
          userId,
          // Sign the attribution token with the webhook secret so the webhook
          // can verify the buyer id came from this server-created checkout.
          attributionSecret: ls.webhookSecret,
          email: typeof email === 'string' ? email : undefined,
          redirectUrl: checkout.redirectUrl,
          testMode: checkout.testMode,
        })
        return reply.send({ url })
      } catch (error) {
        options.log?.('credits: checkout creation failed', { error: String(error) })
        return reply.code(502).send({ error: { code: 'CHECKOUT_FAILED', message: 'could not create checkout' } })
      }
    })
  }

  const webhookPath = ls.webhookPath ?? '/api/credits/webhooks/lemonsqueezy'
  const creditMicrosPerUnit = options.service.config.pricing.creditMicrosPerUnit
  // Crediting basis (NO order-amount fallback — that couples credits to a
  // multi-item/discounted/taxed order total). Require EITHER a fixed per-variant
  // value covering every credit variant, OR an explicit creditsForOrder override
  // (escape hatch for non-LS-pack hosts). Fail registration otherwise.
  const variantCredits = ls.creditMicrosByVariant ?? {}
  if (!ls.creditsForOrder) {
    if (!ls.creditMicrosByVariant) {
      throw new Error('credits: creditMicrosByVariant is required for the Lemon Squeezy webhook (fixed per-variant credit values; no order-amount fallback)')
    }
    for (const variantId of ls.creditVariantIds) {
      const value = variantCredits[variantId]
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`credits: creditMicrosByVariant is missing a positive value for credit variant "${variantId}"`)
      }
    }
  }
  const creditsForOrder = ls.creditsForOrder
    ?? ((order: LemonSqueezyOrder): number => (order.variantId !== undefined ? variantCredits[order.variantId] ?? 0 : 0))

  // Fail closed: only credit paid orders for a configured pack variant, in the
  // required currency, and in the expected mode. Missing/absent fields are
  // rejected — billing must not infer safety from absent data.
  const creditVariantIds = new Set(ls.creditVariantIds)
  const requireCurrency = (ls.requireCurrency ?? 'EUR').toUpperCase()
  // Store/mode/currency check WITHOUT the variant — used to decide whether a
  // refund-before-grant may write a tombstone. Refund payloads can omit/alter
  // first_order_item, so requiring the variant here would let a refunded order
  // be granted later; the store/mode/currency are enough to know it's ours.
  const isOurStoreOrder = (order: LemonSqueezyOrder): boolean => {
    if (!order.currency || order.currency.toUpperCase() !== requireCurrency) return false
    if (order.testMode !== ls.expectedTestMode) return false
    if (ls.expectedStoreId && order.storeId !== ls.expectedStoreId) return false
    return true
  }
  const isCreditOrder = (order: LemonSqueezyOrder): boolean => {
    if (creditVariantIds.size === 0) return false
    if (!order.variantId || !creditVariantIds.has(order.variantId)) return false
    return isOurStoreOrder(order)
  }

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
          // Bind buyer attribution to a server-created checkout (custom_data.uat).
          attributionSecret: ls.webhookSecret,
          // Refuse to grant a fixed pack value the buyer didn't actually pay for.
          creditMicrosPerUnit,
          grant: (input, order) =>
            options.service.grantPurchase(input.userId, input.orderId, input.amountMicros, {
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
            options.service.revokePurchase(order.orderId, {
              refundFraction:
                order.refundedAmountCents > 0 && order.totalCents > 0
                  ? order.refundedAmountCents / order.totalCents
                  : undefined,
              // Tombstone an unknown order only if it's on our store/mode (NOT
              // requiring the variant, which a refund payload may omit).
              allowTombstone: isOurStoreOrder(order),
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
