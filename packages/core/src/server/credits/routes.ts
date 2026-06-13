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

  app.get(balancePath, async (request, reply) => {
    const userId = getUserId(request)
    if (!userId) {
      return reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'authentication required' } })
    }
    return reply.send(await options.service.getBalance(userId))
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
  const creditsForOrder = ls.creditsForOrder
    ?? ((order: LemonSqueezyOrder) => Math.round(order.subtotalCents * (creditMicrosPerUnit / 100)))

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
          grant: (input) => options.service.grantPurchase(input.userId, input.orderId, input.amountMicros),
          log: options.log,
        },
      )
      return reply.code(result.status).send(result.body)
    })
  })
}
