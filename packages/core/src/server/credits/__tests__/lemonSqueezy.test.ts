import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  handleLemonSqueezyWebhook,
  parseLemonSqueezyOrder,
  verifyLemonSqueezySignature,
  signUserAttribution,
  verifyUserAttribution,
  type LemonSqueezyOrder,
} from '../lemonSqueezy'

const SECRET = 'whsec_test_secret'

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function orderPayload(overrides: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}): string {
  return JSON.stringify({
    meta: { event_name: 'order_created', custom_data: { user_id: 'user-1' }, ...overrides },
    data: {
      type: 'orders',
      id: 'order-123',
      attributes: {
        user_email: 'a@b.com',
        status: 'paid',
        test_mode: true,
        currency: 'EUR',
        subtotal: 1000,
        total: 1190,
        first_order_item: { variant_id: 42, product_name: '€10 credits' },
        ...attrs,
      },
    },
  })
}

describe('verifyLemonSqueezySignature', () => {
  it('accepts a correct signature and rejects tampering', () => {
    const body = orderPayload()
    expect(verifyLemonSqueezySignature(body, sign(body), SECRET)).toBe(true)
    expect(verifyLemonSqueezySignature(body + ' ', sign(body), SECRET)).toBe(false)
    expect(verifyLemonSqueezySignature(body, sign(body, 'wrong'), SECRET)).toBe(false)
    expect(verifyLemonSqueezySignature(body, undefined, SECRET)).toBe(false)
    expect(verifyLemonSqueezySignature(body, sign(body), '')).toBe(false)
  })
})

describe('signUserAttribution / verifyUserAttribution', () => {
  it('verifies a token it signed and rejects tampering', () => {
    const token = signUserAttribution('user-9', 'secret')
    expect(verifyUserAttribution('user-9', token, 'secret')).toBe(true)
    expect(verifyUserAttribution('user-9', token, 'other')).toBe(false) // wrong secret
    expect(verifyUserAttribution('attacker', token, 'secret')).toBe(false) // wrong user
    expect(verifyUserAttribution('user-9', 'forged', 'secret')).toBe(false)
    expect(verifyUserAttribution('user-9', undefined, 'secret')).toBe(false)
    expect(verifyUserAttribution(undefined, token, 'secret')).toBe(false)
  })
})

describe('parseLemonSqueezyOrder', () => {
  it('normalizes an order payload', () => {
    const order = parseLemonSqueezyOrder(JSON.parse(orderPayload()))
    expect(order).toEqual<LemonSqueezyOrder>({
      eventName: 'order_created',
      orderId: 'order-123',
      userId: 'user-1',
      userAttributionToken: undefined,
      userEmail: 'a@b.com',
      status: 'paid',
      testMode: true,
      storeId: undefined,
      currency: 'EUR',
      subtotalCents: 1000,
      discountTotalCents: 0,
      totalCents: 1190,
      refunded: false,
      refundedAmountCents: 0,
      variantId: '42',
      productName: '€10 credits',
    })
  })

  it('returns null for malformed payloads', () => {
    expect(parseLemonSqueezyOrder(null)).toBeNull()
    expect(parseLemonSqueezyOrder({ meta: {}, data: {} })).toBeNull()
    expect(parseLemonSqueezyOrder({ meta: { event_name: 'x' }, data: { id: 'o' } })).toBeNull()
  })
})

describe('handleLemonSqueezyWebhook', () => {
  function opts(overrides: Partial<Parameters<typeof handleLemonSqueezyWebhook>[2]> = {}) {
    const grant = vi.fn(async () => ({ created: true }))
    return {
      grant,
      options: {
        secret: SECRET,
        // €10 subtotal → €10 of credits at 1 credit = €0.000001 (1 cent = 10_000 micros).
        creditsForOrder: (o: LemonSqueezyOrder) => o.subtotalCents * 10_000,
        grant,
        isCreditOrder: () => true,
        onRefund: async () => ({ revoked: true }),
        ...overrides,
      },
    }
  }

  it('verifies, parses, and grants idempotent credits keyed on the order id', async () => {
    const { options, grant } = opts()
    const body = orderPayload()
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)

    expect(res).toEqual({ status: 200, body: { ok: true, orderId: 'order-123', created: true } })
    expect(grant).toHaveBeenCalledWith(
      { userId: 'user-1', orderId: 'order-123', reason: 'purchase:order-123', amountMicros: 10_000_000 },
      expect.objectContaining({ orderId: 'order-123', variantId: '42' }),
    )
  })

  it('rejects an invalid signature with 401 and never grants', async () => {
    const { options, grant } = opts()
    const body = orderPayload()
    const res = await handleLemonSqueezyWebhook(body, sign(body, 'attacker'), options)
    expect(res.status).toBe(401)
    expect(grant).not.toHaveBeenCalled()
  })

  it('400s on invalid JSON', async () => {
    const { options } = opts()
    const res = await handleLemonSqueezyWebhook('not json', sign('not json'), options)
    expect(res.status).toBe(400)
    expect(res.body.reason).toBe('invalid_json')
  })

  it('acknowledges non-creditable events without granting', async () => {
    const { options, grant } = opts()
    const body = orderPayload({ event_name: 'subscription_created' })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res).toMatchObject({ status: 200, body: { ok: true, reason: 'ignored_event' } })
    expect(grant).not.toHaveBeenCalled()
  })

  it('does not credit an unpaid order', async () => {
    const { options, grant } = opts()
    const body = orderPayload({}, { status: 'pending' })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res.body.reason).toBe('order_status_pending')
    expect(grant).not.toHaveBeenCalled()
  })

  it('does not credit an order with a missing status (must be explicitly paid)', async () => {
    const { options, grant } = opts()
    const body = orderPayload({}, { status: undefined })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res.body.reason).toBe('order_status_unknown')
    expect(grant).not.toHaveBeenCalled()
  })

  it('skips a paid order that isCreditOrder rejects (wrong variant/currency/mode)', async () => {
    const { options, grant } = opts({ isCreditOrder: (o) => o.variantId === '99' })
    const body = orderPayload() // variant_id 42 ≠ 99
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res).toMatchObject({ status: 200, body: { ok: true, reason: 'not_a_credit_order' } })
    expect(grant).not.toHaveBeenCalled()
  })

  it('returns a retryable 500 (not a 200 ack) when a paid credit order is missing its user id', async () => {
    const log = vi.fn()
    const { options, grant } = opts({ log })
    const body = orderPayload({ custom_data: {} })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    // 500 so LS retries — a 200 would drop a paid order and lose the credits.
    expect(res).toMatchObject({ status: 500, body: { ok: false, reason: 'missing_user_id' } })
    expect(grant).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })

  it('skips grant when the order resolves to no credit amount', async () => {
    const { options, grant } = opts({ creditsForOrder: () => 0 })
    const body = orderPayload()
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res.body.reason).toBe('no_credit_amount')
    expect(grant).not.toHaveBeenCalled()
  })

  it('does not grant when the net paid amount is below the credits it maps to', async () => {
    // creditsForOrder grants 10_000_000 micros (€10), but the buyer paid only €1.
    const { options, grant } = opts({ creditsForOrder: () => 10_000_000, creditMicrosPerUnit: 1_000_000 })
    const body = orderPayload({}, { subtotal: 100, discount_total: 0, total: 100 })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    // 500 (retryable) so a recognized paid order isn't silently dropped.
    expect(res).toMatchObject({ status: 500, body: { ok: false, reason: 'underpaid_order' } })
    expect(grant).not.toHaveBeenCalled()
  })

  it('grants when the net paid amount covers the credits (discount-aware)', async () => {
    const { options, grant } = opts({ creditsForOrder: () => 6_000_000, creditMicrosPerUnit: 1_000_000 })
    // €10 subtotal − €4 discount = €6 net, grants €6 of credits.
    const body = orderPayload({}, { subtotal: 1000, discount_total: 400, total: 600 })
    await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(grant).toHaveBeenCalled()
  })

  it('accepts a fractional-cent subtotal for a full payment (tax-rounding artifact)', async () => {
    const { options, grant } = opts({ creditsForOrder: () => 15_000_000, creditMicrosPerUnit: 1_000_000 })
    // LS reports 1499.985 cents for a €15 pack — must round/tolerate, not reject.
    const body = orderPayload({}, { subtotal: 1499.985, discount_total: 0, total: 1499.985 })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res).toMatchObject({ status: 200, body: { ok: true } })
    expect(grant).toHaveBeenCalled()
  })

  it('requires a valid attribution token when attributionSecret is set', async () => {
    const { options: base, grant } = opts({ attributionSecret: 'attr-secret' })
    // No uat → rejected with a retryable 500, no grant.
    const noToken = orderPayload()
    expect(await handleLemonSqueezyWebhook(noToken, sign(noToken), base)).toMatchObject({ status: 500, body: { reason: 'untrusted_attribution' } })
    expect(grant).not.toHaveBeenCalled()

    // Valid uat → granted.
    const signed = orderPayload({ custom_data: { user_id: 'user-1', uat: signUserAttribution('user-1', 'attr-secret') } })
    expect(await handleLemonSqueezyWebhook(signed, sign(signed), base)).toMatchObject({ status: 200, body: { ok: true } })
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), expect.anything())
  })

  it('honors a custom resolveUserId', async () => {
    const { options, grant } = opts({ resolveUserId: () => 'mapped-user' })
    const body = orderPayload({ custom_data: {} })
    await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({ userId: 'mapped-user' }), expect.anything())
  })

  it('revokes credits on a refund event and never grants', async () => {
    const onRefund = vi.fn(async () => ({ revoked: true }))
    const { options, grant } = opts({ onRefund })
    const body = orderPayload({ event_name: 'order_refunded' }, { status: 'refunded' })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res).toMatchObject({ status: 200, body: { ok: true, reason: 'refund_revoked', orderId: 'order-123' } })
    expect(onRefund).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-123' }))
    expect(grant).not.toHaveBeenCalled()
  })

  it('always dispatches a refund to onRefund (credit-order gating is the handler caller\'s job)', async () => {
    // Even when isCreditOrder is false, the handler dispatches the refund — the
    // store reconciles by order id (an order we credited is revocable) and the
    // caller decides via allowTombstone whether an UNKNOWN order may be tombstoned.
    const onRefund = vi.fn(async () => ({ revoked: false }))
    const { options } = opts({ isCreditOrder: () => false, onRefund })
    const body = orderPayload({ event_name: 'order_refunded' }, { status: 'refunded' })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res).toMatchObject({ status: 200, body: { ok: true, reason: 'refund_noop' } })
    expect(onRefund).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-123' }))
  })

  it('reports refund_noop when nothing was revoked (unknown order)', async () => {
    const onRefund = vi.fn(async () => ({ revoked: false }))
    const { options } = opts({ onRefund })
    const body = orderPayload({ event_name: 'order_refunded' }, { status: 'refunded' })
    const res = await handleLemonSqueezyWebhook(body, sign(body), options)
    expect(res).toMatchObject({ status: 200, body: { ok: true, reason: 'refund_noop' } })
  })
})
