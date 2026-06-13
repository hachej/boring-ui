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
  /** Credit micros to grant for an order. Default: subtotal × creditMicrosPerUnit. */
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
  // €1 = 100 cents, so 1 cent = creditMicrosPerUnit / 100 credit micros.
  const centsToMicros = (cents: number) => Math.round(Math.max(0, cents) * (creditMicrosPerUnit / 100))
  // Credit the NET pre-tax amount paid (subtotal − discount), so a discount code
  // can't mint full face-value credits for a partial payment.
  const creditsForOrder = ls.creditsForOrder
    ?? ((order: LemonSqueezyOrder) => centsToMicros(order.subtotalCents - order.discountTotalCents))

  // Fail closed: only credit paid orders for a configured pack variant, in the
  // required currency, and in the expected mode. Missing/absent fields are
  // rejected — billing must not infer safety from absent data.
  const creditVariantIds = new Set(ls.creditVariantIds)
  const requireCurrency = (ls.requireCurrency ?? 'EUR').toUpperCase()
  const isCreditOrder = (order: LemonSqueezyOrder): boolean => {
    if (creditVariantIds.size === 0) return false
    if (!order.variantId || !creditVariantIds.has(order.variantId)) return false
    if (!order.currency || order.currency.toUpperCase() !== requireCurrency) return false
    if (order.testMode !== ls.expectedTestMode) return false
    if (ls.expectedStoreId && order.storeId !== ls.expectedStoreId) return false
    return true
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
          grant: (input) => options.service.grantPurchase(input.userId, input.orderId, input.amountMicros),
          // Refunds/disputes revoke the order's credits. For a PARTIAL refund, LS
          // reports the cumulative refunded_amount (tax-incl) against the order
          // total — pass that fraction so the store revokes the proportional
          // share of the (pre-tax) credited amount; a full refund (no/zero amount,
          // or amount ≥ total) revokes everything.
          onRefund: (order) =>
            options.service.revokePurchase(
              order.orderId,
              order.refundedAmountCents > 0 && order.totalCents > 0
                ? order.refundedAmountCents / order.totalCents
                : undefined,
            ),
          log: options.log,
        },
      )
      return reply.code(result.status).send(result.body)
    })
  })
}
