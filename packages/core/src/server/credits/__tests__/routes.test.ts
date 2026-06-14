import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { createHmac } from 'node:crypto'
import { registerCreditsRoutes } from '../routes'
import { signUserAttribution } from '../lemonSqueezy'
import { CreditsService, type CreditsConfig, type CreditsMeteringStore } from '../creditsService'

const SECRET = 'whsec_test'
/** Valid server-signed attribution token for the webhook (custom_data.uat). */
const uat = (userId: string) => signUserAttribution(userId, SECRET)
const CONFIG: CreditsConfig = {
  enabled: true,
  signupGrantMicros: 2_000_000,
  signupGrantExpiresAfterDays: null,
  runReservationMicros: 250_000,
  reservationTtlSeconds: 7200,
  minBalanceMicros: 50_000,
  pricing: { margin: 1, creditMicrosPerUnit: 1_000_000 },
}

function makeStore(): CreditsMeteringStore {
  return {
    grantOnce: vi.fn(async () => ({ created: true })),
    grantPurchaseOnce: vi.fn(async () => ({ granted: true })),
    revokePurchase: vi.fn(async () => ({ revoked: true })),
    getBalance: vi.fn(async () => ({ userId: 'u1', grantedMicros: 2_000_000, usedMicros: 0, remainingMicros: 2_000_000, activeReservedMicros: 0, availableMicros: 2_000_000 })),
    reserve: vi.fn(async () => ({ reservationId: 'res-1' })),
    recordUsage: vi.fn(async () => ({ inserted: true })),
    finishReservation: vi.fn(async () => ({ updated: true })),
    expireStaleReservations: vi.fn(async () => 0),
    billedMicrosForRun: vi.fn(async () => 0),
    billedMicrosForReservation: vi.fn(async () => 0),
  }
}

function orderBody(userId = 'user-1', subtotalCents = 1000): string {
  return JSON.stringify({
    meta: { event_name: 'order_created', custom_data: { user_id: userId, uat: uat(userId) } },
    data: { type: 'orders', id: 'order-77', attributes: { status: 'paid', test_mode: true, currency: 'EUR', subtotal: subtotalCents, total: subtotalCents, first_order_item: { variant_id: 1 } } },
  })
}

describe('credits routes', () => {
  let app: FastifyInstance | undefined
  afterEach(async () => { await app?.close(); app = undefined })

  async function build(store: CreditsMeteringStore, asUser?: string, creditMicrosByVariant?: Record<string, number>) {
    app = Fastify()
    if (asUser) {
      app.addHook('onRequest', async (request: FastifyRequest) => {
        ;(request as unknown as { user: { id: string } }).user = { id: asUser }
      })
    }
    registerCreditsRoutes(app, {
      service: new CreditsService(store, CONFIG),
      // Fixed per-variant value is now required; default variant '1' → €10.
      lemonSqueezy: { webhookSecret: SECRET, creditVariantIds: ['1'], expectedTestMode: true, creditMicrosByVariant: creditMicrosByVariant ?? { '1': 10_000_000 } },
    })
    await app.ready()
    return app
  }

  it('returns the balance for an authenticated user', async () => {
    const store = makeStore()
    const a = await build(store, 'u1')
    const res = await a.inject({ method: 'GET', url: '/api/credits/balance' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ enabled: true, userId: 'u1', remainingMicros: 2_000_000, currency: 'credits' })
  })

  it('401s the balance for an unauthenticated request', async () => {
    const a = await build(makeStore())
    const res = await a.inject({ method: 'GET', url: '/api/credits/balance' })
    expect(res.statusCode).toBe(401)
  })

  it('grants credits on a correctly-signed webhook (subtotal → credits)', async () => {
    const store = makeStore()
    const a = await build(store)
    const body = orderBody('user-1', 1000) // €10
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, orderId: 'order-77' })
    expect(store.grantPurchaseOnce).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', orderId: 'order-77', amountMicros: 10_000_000 }))
  })

  it('grants the FIXED per-variant value, ignoring the order subtotal (multi-item/discount safe)', async () => {
    const store = makeStore()
    // Variant '1' is worth 5_000_000 micros regardless of the €10 order subtotal.
    const a = await build(store, undefined, { '1': 5_000_000 })
    const body = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { user_id: 'user-1', uat: uat('user-1') } },
      data: { type: 'orders', id: 'order-fix', attributes: { status: 'paid', test_mode: true, currency: 'EUR', subtotal: 1000, total: 1190, first_order_item: { variant_id: 1 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(store.grantPurchaseOnce).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', orderId: 'order-fix', amountMicros: 5_000_000 }))
  })

  it('refuses to register the LS webhook with a disabled credits service', async () => {
    const a = Fastify()
    await expect(
      (async () => {
        registerCreditsRoutes(a, {
          service: new CreditsService(makeStore(), { ...CONFIG, enabled: false }),
          lemonSqueezy: { webhookSecret: SECRET, creditVariantIds: ['1'], expectedTestMode: true, creditMicrosByVariant: { '1': 10_000_000 } },
        })
        await a.ready()
      })(),
    ).rejects.toThrow(/disabled credits service/)
    await a.close()
  })

  it('refuses to register the LS webhook with an empty creditVariantIds', async () => {
    const a = Fastify()
    await expect(
      (async () => {
        registerCreditsRoutes(a, {
          service: new CreditsService(makeStore(), CONFIG),
          lemonSqueezy: { webhookSecret: SECRET, creditVariantIds: [], expectedTestMode: true, creditMicrosByVariant: {} },
        })
        await a.ready()
      })(),
    ).rejects.toThrow(/non-empty creditVariantIds/)
    await a.close()
  })

  it('fails registration when a credit variant has no fixed credit value', async () => {
    const a = Fastify()
    await expect(
      (async () => {
        registerCreditsRoutes(a, {
          service: new CreditsService(makeStore(), CONFIG),
          lemonSqueezy: {
            webhookSecret: SECRET,
            creditVariantIds: ['1', '2'],
            expectedTestMode: true,
            creditMicrosByVariant: { '1': 10_000_000 }, // '2' missing → would fall back to subtotal
          },
        })
        await a.ready()
      })(),
    ).rejects.toThrow(/creditMicrosByVariant must be a positive safe integer for credit variant "2"/)
    await a.close()
  })

  it('rejects a paid order whose attribution token is missing/forged (500, no credit)', async () => {
    const store = makeStore()
    const a = await build(store)
    // Valid signature + valid pack, but custom_data has no server-signed uat
    // (e.g. a crafted hosted-checkout URL carrying an arbitrary user_id).
    const body = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { user_id: 'victim', uat: 'forged' } },
      data: { type: 'orders', id: 'order-att', attributes: { status: 'paid', test_mode: true, currency: 'EUR', subtotal: 1000, total: 1000, first_order_item: { variant_id: 1 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toMatchObject({ reason: 'untrusted_attribution' })
    expect(store.grantPurchaseOnce).not.toHaveBeenCalled()
  })

  it('grants per-variant value × quantity for a multi-pack purchase', async () => {
    const store = makeStore()
    const a = await build(store, undefined, { '1': 5_000_000 })
    // 3 units of the €5 pack, paid €15 → grant 15_000_000.
    const body = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { user_id: 'user-1', uat: uat('user-1') } },
      data: { type: 'orders', id: 'order-qty', attributes: { status: 'paid', test_mode: true, currency: 'EUR', subtotal: 1500, total: 1500, first_order_item: { variant_id: 1, quantity: 3 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(store.grantPurchaseOnce).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-qty', amountMicros: 15_000_000 }))
  })

  it('does not credit a paid order for an unconfigured variant (fail closed)', async () => {
    const store = makeStore()
    const a = await build(store)
    const body = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { user_id: 'user-1' } },
      data: { type: 'orders', id: 'order-88', attributes: { status: 'paid', test_mode: true, currency: 'EUR', subtotal: 1000, total: 1000, first_order_item: { variant_id: 999 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    // Our store/mode/currency but an unknown variant → 500 (pack misconfig), so a
    // paid customer on this credit-only store isn't silently left without credits.
    expect(res.statusCode).toBe(500)
    expect(res.json()).toMatchObject({ reason: 'unrecognized_credit_variant' })
    expect(store.grantPurchaseOnce).not.toHaveBeenCalled()
  })

  it('does not credit a paid order in the wrong mode (live order, test-mode webhook)', async () => {
    const store = makeStore()
    const a = await build(store)
    const body = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { user_id: 'user-1' } },
      data: { type: 'orders', id: 'order-89', attributes: { status: 'paid', test_mode: false, currency: 'EUR', subtotal: 1000, total: 1000, first_order_item: { variant_id: 1 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ reason: 'not_a_credit_order' })
    expect(store.grantPurchaseOnce).not.toHaveBeenCalled()
  })

  it('revokes credits on a refund webhook', async () => {
    const store = makeStore()
    const a = await build(store)
    const body = JSON.stringify({
      meta: { event_name: 'order_refunded', custom_data: { user_id: 'user-1' } },
      data: { type: 'orders', id: 'order-77', attributes: { status: 'refunded', test_mode: true, currency: 'EUR', subtotal: 1000, total: 1000, first_order_item: { variant_id: 1 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, reason: 'refund_revoked', orderId: 'order-77' })
    // No refunded_amount → full refund (fraction undefined); variant 1 is a credit
    // order so a pre-grant tombstone is allowed.
    expect(store.revokePurchase).toHaveBeenCalledWith('order-77', expect.objectContaining({ refundFraction: undefined, allowTombstone: true }))
    expect(store.grantPurchaseOnce).not.toHaveBeenCalled()
  })

  it('passes the cumulative refund fraction (refunded_amount / total) for a partial refund', async () => {
    const store = makeStore()
    const a = await build(store)
    // €3 refunded of a €10 order (tax-incl basis) → fraction 0.3.
    const body = JSON.stringify({
      meta: { event_name: 'order_refunded', custom_data: { user_id: 'user-1' } },
      data: { type: 'orders', id: 'order-77', attributes: { status: 'paid', test_mode: true, currency: 'EUR', subtotal: 1000, total: 1000, refunded: true, refunded_amount: 300, first_order_item: { variant_id: 1 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(store.revokePurchase).toHaveBeenCalledWith('order-77', expect.objectContaining({ refundFraction: 0.3, allowTombstone: true }))
  })

  it('allows a pre-grant tombstone for a refund missing its variant (still our store/mode)', async () => {
    const store = makeStore()
    const a = await build(store) // expectedTestMode true, currency EUR, no expectedStoreId
    // Refund payload omits first_order_item — the tombstone must still be allowed
    // (store/mode/currency identify it as ours), or a later order_created could
    // grant a refunded order.
    const body = JSON.stringify({
      meta: { event_name: 'order_refunded', custom_data: { user_id: 'user-1' } },
      data: { type: 'orders', id: 'order-77', attributes: { status: 'refunded', test_mode: true, currency: 'EUR', subtotal: 1000, total: 1000, refunded: true, refunded_amount: 1000 } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(store.revokePurchase).toHaveBeenCalledWith('order-77', expect.objectContaining({ allowTombstone: true }))
  })

  it('does not allow a pre-grant tombstone for a refund in the wrong mode', async () => {
    const store = makeStore()
    const a = await build(store) // expectedTestMode true
    // A LIVE-mode refund (test_mode false) is not ours → no tombstone.
    const body = JSON.stringify({
      meta: { event_name: 'order_refunded', custom_data: { user_id: 'user-1' } },
      data: { type: 'orders', id: 'order-77', attributes: { status: 'refunded', test_mode: false, currency: 'EUR', subtotal: 1000, total: 1000, refunded: true, refunded_amount: 1000, first_order_item: { variant_id: 1 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(store.revokePurchase).toHaveBeenCalledWith('order-77', expect.objectContaining({ allowTombstone: false }))
  })

  it('rejects a discounted underpayment for a fixed pack (net paid below pack value)', async () => {
    const store = makeStore()
    const a = await build(store, undefined, { '1': 10_000_000 }) // €10 pack
    // subtotal €10, discount €4 → only €6 net paid for a €10 pack → underpaid.
    const body = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { user_id: 'user-1', uat: uat('user-1') } },
      data: { type: 'orders', id: 'order-disc', attributes: { status: 'paid', test_mode: true, currency: 'EUR', subtotal: 1000, discount_total: 400, total: 600, first_order_item: { variant_id: 1 } } },
    })
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex') },
      payload: body,
    })
    expect(res.statusCode).toBe(500) // retryable; surfaces for operator reconcile
    expect(res.json()).toMatchObject({ reason: 'underpaid_order' })
    expect(store.grantPurchaseOnce).not.toHaveBeenCalled()
  })

  it('rejects a webhook with a bad signature and never grants', async () => {
    const store = makeStore()
    const a = await build(store)
    const body = orderBody()
    const res = await a.inject({
      method: 'POST',
      url: '/api/credits/webhooks/lemonsqueezy',
      headers: { 'content-type': 'application/json', 'x-signature': 'deadbeef' },
      payload: body,
    })
    expect(res.statusCode).toBe(401)
    expect(store.grantPurchaseOnce).not.toHaveBeenCalled()
  })

  async function buildWithCheckout(asUser?: string) {
    app = Fastify()
    if (asUser) {
      app.addHook('onRequest', async (request: FastifyRequest) => {
        ;(request as unknown as { user: { id: string; email: string } }).user = { id: asUser, email: 'a@b.com' }
      })
    }
    registerCreditsRoutes(app, {
      service: new CreditsService(makeStore(), CONFIG),
      lemonSqueezy: {
        webhookSecret: SECRET,
        creditVariantIds: ['912340', '912325'],
        creditMicrosByVariant: { '912340': 10_000_000, '912325': 25_000_000 },
        expectedTestMode: true,
        checkout: { apiKey: 'k', storeId: '406592', variants: { '10': '912340', '25': '912325' }, defaultPack: '10', testMode: true },
      },
    })
    await app.ready()
    return app
  }

  it('creates a server-side checkout with the session user (never the client)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => new Response(JSON.stringify({ data: { attributes: { url: 'https://store/checkout/x' } } }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const a = await buildWithCheckout('u1')
      const res = await a.inject({ method: 'POST', url: '/api/credits/checkout', payload: { pack: '25' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().url).toBe('https://store/checkout/x')
      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(sentBody.data.attributes.checkout_data.custom.user_id).toBe('u1') // from session, not request
      expect(sentBody.data.relationships.variant.data.id).toBe('912325')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('401s the checkout for an unauthenticated request', async () => {
    const a = await buildWithCheckout()
    const res = await a.inject({ method: 'POST', url: '/api/credits/checkout', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('uses the default pack when none is requested', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => new Response(JSON.stringify({ data: { attributes: { url: 'https://store/checkout/y' } } }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const a = await buildWithCheckout('u1')
      const res = await a.inject({ method: 'POST', url: '/api/credits/checkout', payload: {} })
      expect(res.statusCode).toBe(200)
      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(sentBody.data.relationships.variant.data.id).toBe('912340') // default pack '10'
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('400s an explicitly-requested unknown pack id (never silently substitutes)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const a = await buildWithCheckout('u1')
      const res = await a.inject({ method: 'POST', url: '/api/credits/checkout', payload: { pack: '999' } })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('invalid_pack')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('502s when checkout creation fails upstream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad variant', { status: 422 })))
    try {
      const a = await buildWithCheckout('u1')
      const res = await a.inject({ method: 'POST', url: '/api/credits/checkout', payload: {} })
      expect(res.statusCode).toBe(502)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
