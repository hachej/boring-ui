import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { CreditsService } from './creditsService.js'
import { handleLemonSqueezyWebhook, type LemonSqueezyOrder } from './lemonSqueezy.js'

export interface LemonSqueezyRouteOptions {
  webhookSecret: string
  /** Credit micros to grant for an order. Default: subtotal × creditMicrosPerUnit. */
  creditsForOrder?: (order: LemonSqueezyOrder) => number
  webhookPath?: string
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
