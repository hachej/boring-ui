/**
 * Billing routes — Stripe subscription management + agent query metering.
 *
 * Registers /api/v1/billing/* endpoints on a Fastify instance.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import Stripe from 'stripe'
import { DataService } from '../services/clickhouse'
import { loadMacroConfig } from '../config'

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

interface Tier {
  name: string
  dailyQueryLimit: number // 0 = unlimited
  priceMonthly: number
}

const TIERS: Record<string, Tier> = {
  free: { name: 'free', dailyQueryLimit: 5, priceMonthly: 0 },
  pro: { name: 'pro', dailyQueryLimit: 0, priceMonthly: 49 },
  team: { name: 'team', dailyQueryLimit: 0, priceMonthly: 149 },
}

// ---------------------------------------------------------------------------
// DDL for ClickHouse tables
// ---------------------------------------------------------------------------

const USAGE_DDL = `
CREATE TABLE IF NOT EXISTS agent_usage (
    user_id String,
    query_type String DEFAULT 'agent',
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (user_id, created_at)
TTL created_at + INTERVAL 90 DAY
`

const SUBSCRIPTIONS_DDL = `
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id String,
    stripe_customer_id String DEFAULT '',
    stripe_subscription_id String DEFAULT '',
    tier String DEFAULT 'free',
    status String DEFAULT 'active',
    current_period_end DateTime DEFAULT now(),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY user_id
`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(request: FastifyRequest): string {
  return (request as any).sessionUserId || 'local-dev'
}

let tablesReady = false

async function ensureTables(svc: DataService | null): Promise<void> {
  if (tablesReady || !svc) return
  try {
    await svc.rawCommand(USAGE_DDL)
    await svc.rawCommand(SUBSCRIPTIONS_DDL)
    tablesReady = true
  } catch (err) {
    console.warn('Could not create billing tables:', err)
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  const macroConfig = await loadMacroConfig()
  const svc = macroConfig.clickhouse ? new DataService(macroConfig.clickhouse) : null

  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  const stripe = stripeKey ? new Stripe(stripeKey) : null
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

  app.register(async (scoped: FastifyInstance) => {

    // ---- Subscription status -----------------------------------------------

    scoped.get('/subscription', async (req: FastifyRequest) => {
      await ensureTables(svc)
      const userId = getUserId(req)
      if (!svc) return { ok: true, tier: 'free', status: 'active' }

      try {
        const rows = await svc.rawQuery(
          `SELECT tier, status, stripe_subscription_id, current_period_end
           FROM subscriptions FINAL
           WHERE user_id = '${userId.replace(/'/g, "''")}'
           LIMIT 1`
        )
        if (!rows.length) return { ok: true, tier: 'free', status: 'active' }
        return {
          ok: true,
          tier: rows[0].tier,
          status: rows[0].status,
          stripe_subscription_id: rows[0].stripe_subscription_id,
          current_period_end: rows[0].current_period_end,
        }
      } catch {
        return { ok: true, tier: 'free', status: 'active' }
      }
    })

    // ---- Checkout session ---------------------------------------------------

    scoped.post('/checkout', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!stripe) {
        return { ok: false, error: 'Stripe is not configured' }
      }
      const body = req.body as { tier?: string; success_url?: string; cancel_url?: string }
      const tier = body.tier || ''
      if (tier !== 'pro' && tier !== 'team') {
        return { ok: false, error: "Invalid tier. Choose 'pro' or 'team'." }
      }

      const priceId = process.env[`STRIPE_PRICE_${tier.toUpperCase()}`] || ''
      if (!priceId) {
        return { ok: false, error: `No Stripe price configured for tier '${tier}'` }
      }

      const userId = getUserId(req)
      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: body.success_url || '/',
          cancel_url: body.cancel_url || '/',
          client_reference_id: userId,
          metadata: { user_id: userId, tier },
        })
        return { ok: true, checkout_url: session.url, session_id: session.id }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })

    // ---- Billing portal -----------------------------------------------------

    scoped.post('/portal', async (req: FastifyRequest) => {
      if (!stripe) return { ok: false, error: 'Stripe is not configured' }
      await ensureTables(svc)
      const userId = getUserId(req)
      const body = req.body as { return_url?: string }

      if (!svc) return { ok: false, error: 'Database not available' }
      try {
        const rows = await svc.rawQuery(
          `SELECT stripe_customer_id FROM subscriptions FINAL
           WHERE user_id = '${userId.replace(/'/g, "''")}'
           LIMIT 1`
        )
        if (!rows.length || !rows[0].stripe_customer_id) {
          return { ok: false, error: 'No active subscription found' }
        }
        const session = await stripe.billingPortal.sessions.create({
          customer: rows[0].stripe_customer_id as string,
          return_url: body.return_url || '/',
        })
        return { ok: true, portal_url: session.url }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })

    // ---- Stripe webhook -----------------------------------------------------

    scoped.post('/webhook', {
      config: { rawBody: true },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      if (!stripe || !webhookSecret) {
        reply.code(400).send({ ok: false, error: 'Webhook not configured' })
        return
      }
      const sig = req.headers['stripe-signature'] as string || ''
      let event: Stripe.Event
      try {
        const rawBody = (req as any).rawBody || JSON.stringify(req.body)
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
      } catch (err) {
        reply.code(400).send({ ok: false, error: `Webhook verification failed: ${err}` })
        return
      }

      const data = (event.data as any).object || {}

      if (event.type === 'checkout.session.completed') {
        const userId = data.client_reference_id || ''
        const customerId = data.customer || ''
        const subscriptionId = data.subscription || ''
        const tier = data.metadata?.tier || 'pro'
        if (userId && svc) {
          await upsertSubscription(svc, userId, customerId, subscriptionId, tier, 'active')
        }
      } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const subscriptionId = data.id || ''
        const status = data.status === 'active' || data.status === 'trialing' ? 'active' : 'cancelled'
        if (svc) {
          const rows = await svc.rawQuery(
            `SELECT user_id, tier FROM subscriptions FINAL
             WHERE stripe_subscription_id = '${subscriptionId.replace(/'/g, "''")}'
             LIMIT 1`
          )
          if (rows.length) {
            await upsertSubscription(
              svc,
              rows[0].user_id as string,
              data.customer || '',
              subscriptionId,
              status === 'active' ? (rows[0].tier as string) : 'free',
              status,
            )
          }
        }
      }

      return { ok: true, event_type: event.type }
    })

    // ---- Usage & quota ------------------------------------------------------

    scoped.get('/usage', async (req: FastifyRequest) => {
      await ensureTables(svc)
      const userId = getUserId(req)
      const tier = await getUserTier(svc, userId)
      const usedToday = await getDailyUsage(svc, userId)
      return {
        ok: true,
        tier: tier.name,
        daily_limit: tier.dailyQueryLimit,
        used_today: usedToday,
        remaining: tier.dailyQueryLimit > 0 ? Math.max(0, tier.dailyQueryLimit - usedToday) : -1,
      }
    })

    scoped.get('/quota', async (req: FastifyRequest) => {
      await ensureTables(svc)
      const userId = getUserId(req)
      const tier = await getUserTier(svc, userId)
      if (tier.dailyQueryLimit === 0) {
        return { ok: true, allowed: true, used: 0, limit: 0, tier: tier.name }
      }
      const used = await getDailyUsage(svc, userId)
      return {
        ok: true,
        allowed: used < tier.dailyQueryLimit,
        used,
        limit: tier.dailyQueryLimit,
        tier: tier.name,
      }
    })

    // ---- Record usage (atomic check + record) --------------------------------

    scoped.post('/record-usage', async (req: FastifyRequest) => {
      await ensureTables(svc)
      const userId = getUserId(req)
      const tier = await getUserTier(svc, userId)

      // Unlimited tiers: record for analytics, always allow
      if (tier.dailyQueryLimit === 0) {
        await recordUsage(svc, userId, 'agent')
        return { ok: true, allowed: true, used: 0, limit: 0, remaining: -1, tier: tier.name }
      }

      const used = await getDailyUsage(svc, userId)
      if (used >= tier.dailyQueryLimit) {
        return {
          ok: true,
          allowed: false,
          used,
          limit: tier.dailyQueryLimit,
          remaining: 0,
          tier: tier.name,
        }
      }

      await recordUsage(svc, userId, 'agent')
      const remaining = tier.dailyQueryLimit - used - 1
      return {
        ok: true,
        allowed: true,
        used: used + 1,
        limit: tier.dailyQueryLimit,
        remaining,
        tier: tier.name,
      }
    })

  }, { prefix: '/api/v1/billing' })
}

// ---------------------------------------------------------------------------
// Service helpers
// ---------------------------------------------------------------------------

async function getUserTier(svc: DataService | null, userId: string): Promise<Tier> {
  if (!svc) return TIERS.free
  try {
    const rows = await svc.rawQuery(
      `SELECT tier, status FROM subscriptions FINAL
       WHERE user_id = '${userId.replace(/'/g, "''")}'
       LIMIT 1`
    )
    if (!rows.length) return TIERS.free
    if (rows[0].status !== 'active') return TIERS.free
    return TIERS[rows[0].tier as string] || TIERS.free
  } catch {
    return TIERS.free
  }
}

async function getDailyUsage(svc: DataService | null, userId: string): Promise<number> {
  if (!svc) return 0
  try {
    const rows = await svc.rawQuery(
      `SELECT count() AS cnt FROM agent_usage
       WHERE user_id = '${userId.replace(/'/g, "''")}'
       AND created_at >= today()`
    )
    return rows.length ? Number(rows[0].cnt) : 0
  } catch {
    return 0
  }
}

export async function recordUsage(svc: DataService | null, userId: string, queryType: string = 'agent'): Promise<void> {
  if (!svc) return
  await ensureTables(svc)
  try {
    await svc.rawCommand(
      `INSERT INTO agent_usage (user_id, query_type) VALUES ('${userId.replace(/'/g, "''")}', '${queryType.replace(/'/g, "''")}')`
    )
  } catch (err) {
    console.warn('Failed to record usage:', err)
  }
}

async function upsertSubscription(
  svc: DataService,
  userId: string,
  customerId: string,
  subscriptionId: string,
  tier: string,
  status: string,
): Promise<void> {
  await ensureTables(svc)
  try {
    await svc.rawCommand(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, tier, status, updated_at)
       VALUES ('${userId.replace(/'/g, "''")}', '${customerId.replace(/'/g, "''")}', '${subscriptionId.replace(/'/g, "''")}', '${tier}', '${status}', now())`
    )
  } catch (err) {
    console.warn('Failed to upsert subscription:', err)
  }
}

// Export for metering middleware
export { getUserTier, getDailyUsage, TIERS }
