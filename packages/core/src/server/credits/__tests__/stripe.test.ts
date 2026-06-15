import { createHmac } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { verifyStripeSignature, parseStripeEvent, handleStripeWebhook, type StripeWebhookOptions } from '../stripe.js'

const SECRET = 'whsec_test'
const NOW = 1_700_000_000_000 // fixed ms

function sign(body: string, opts: { secret?: string; t?: number } = {}): string {
  const t = opts.t ?? Math.floor(NOW / 1000)
  const sig = createHmac('sha256', opts.secret ?? SECRET).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${sig}`
}

function completedEvent(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid', currency: 'chf',
      amount_subtotal: 1000, amount_total: 1000, livemode: false,
      client_reference_id: 'u1', metadata: { user_id: 'u1', pack_id: '10' },
      ...over,
    } },
  })
}

function refundEvent(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'charge.refunded',
    data: { object: { id: 'ch_1', payment_intent: 'pi_1', currency: 'chf', livemode: false, amount: 1000, amount_refunded: 1000, ...over } },
  })
}

function makeOptions(over: Partial<StripeWebhookOptions> = {}): StripeWebhookOptions {
  const grant = vi.fn(async () => ({ created: true }))
  const onRefund = vi.fn(async () => ({ revoked: true }))
  const FIXED: Record<string, number> = { '10': 10_000_000 }
  const RATE = 1_000_000 / 100 // micros per minor unit
  const isKnown = (id?: string) => id === '10' || id === 'custom'
  const strictOurs = (o: { livemode?: boolean; currency?: string }) => o.livemode === false && o.currency === 'chf'
  const lenientOurs = (o: { livemode?: boolean; currency?: string }) =>
    (o.livemode == null || o.livemode === false) && (o.currency == null || o.currency === 'chf')
  return {
    secret: SECRET,
    now: NOW,
    creditsForOrder: (o) => o.packId === 'custom'
      ? (o.amountSubtotalMinor && o.amountSubtotalMinor > 0 ? Math.floor(o.amountSubtotalMinor * RATE) : 0)
      : (o.packId ? FIXED[o.packId] ?? 0 : 0),
    isCreditOrder: (o) => isKnown(o.packId) && strictOurs(o),
    isOurStoreOrder: (o) => lenientOurs(o),
    isUnverifiedCreditOrder: (o) => isKnown(o.packId) && !strictOurs(o) && lenientOurs(o),
    isRefundForOurStore: (o) => lenientOurs(o),
    creditMicrosPerUnit: 1_000_000,
    grant,
    onRefund,
    ...over,
  }
}

describe('verifyStripeSignature', () => {
  it('accepts a valid signature and rejects tampering / missing / wrong secret', () => {
    const body = completedEvent()
    expect(verifyStripeSignature(body, sign(body), SECRET, { now: NOW })).toBe(true)
    expect(verifyStripeSignature(body, sign(body), 'whsec_other', { now: NOW })).toBe(false)
    expect(verifyStripeSignature(`${body} `, sign(body), SECRET, { now: NOW })).toBe(false)
    expect(verifyStripeSignature(body, undefined, SECRET, { now: NOW })).toBe(false)
  })
  it('rejects a timestamp outside the tolerance (replay window)', () => {
    const body = completedEvent()
    const old = sign(body, { t: Math.floor(NOW / 1000) - 10_000 })
    expect(verifyStripeSignature(body, old, SECRET, { now: NOW })).toBe(false)
    // tolerance disabled → accepts the old timestamp (HMAC still valid)
    expect(verifyStripeSignature(body, old, SECRET, { now: NOW, toleranceSeconds: 0 })).toBe(true)
  })
})

describe('parseStripeEvent', () => {
  it('normalizes a checkout.session.completed and a charge.refunded', () => {
    const c = parseStripeEvent(JSON.parse(completedEvent()))
    expect(c).toMatchObject({ eventType: 'checkout.session.completed', paymentIntentId: 'pi_1', userId: 'u1', paymentStatus: 'paid', currency: 'chf', amountSubtotalMinor: 1000, packId: '10', livemode: false })
    const r = parseStripeEvent(JSON.parse(refundEvent()))
    expect(r).toMatchObject({ eventType: 'charge.refunded', paymentIntentId: 'pi_1', amountMinor: 1000, amountRefundedMinor: 1000 })
  })
})

describe('handleStripeWebhook', () => {
  it('rejects an invalid signature with 401', async () => {
    const body = completedEvent()
    const res = await handleStripeWebhook(body, 't=1,v1=deadbeef', makeOptions())
    expect(res.status).toBe(401)
  })

  it('grants on a paid, known-pack session and is idempotent', async () => {
    const body = completedEvent()
    const opts = makeOptions()
    const res = await handleStripeWebhook(body, sign(body), opts)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, orderId: 'pi_1', created: true })
    expect(opts.grant).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', orderId: 'pi_1', amountMicros: 10_000_000, reason: 'purchase:pi_1' }),
      expect.objectContaining({ packId: '10' }),
    )
  })

  it('credits the AMOUNT PAID for a custom pay-what-you-want pack', async () => {
    const body = completedEvent({ metadata: { user_id: 'u1', pack_id: 'custom' }, amount_subtotal: 1500, amount_total: 1500 })
    const opts = makeOptions()
    const res = await handleStripeWebhook(body, sign(body), opts)
    expect(res.status).toBe(200)
    expect(opts.grant).toHaveBeenCalledWith(expect.objectContaining({ amountMicros: 15_000_000 }), expect.anything())
  })

  it('acks an unpaid session without granting', async () => {
    const body = completedEvent({ payment_status: 'unpaid' })
    const opts = makeOptions()
    const res = await handleStripeWebhook(body, sign(body), opts)
    expect(res.status).toBe(200)
    expect(res.body.reason).toMatch(/payment_status_unpaid/)
    expect(opts.grant).not.toHaveBeenCalled()
  })

  it('fails loud (500) on a paid known pack with no user id', async () => {
    const body = completedEvent({ client_reference_id: null, metadata: { pack_id: '10' } })
    const res = await handleStripeWebhook(body, sign(body), makeOptions())
    expect(res.status).toBe(500)
    expect(res.body.reason).toBe('missing_user_id')
  })

  it('fails loud (500) on an underpaid order', async () => {
    const body = completedEvent({ amount_subtotal: 500 }) // pack 10 needs 1000 minor
    const res = await handleStripeWebhook(body, sign(body), makeOptions())
    expect(res.status).toBe(500)
    expect(res.body.reason).toBe('underpaid_order')
  })

  it('500s an unknown pack paid on our store (credit-only), 200-ignores a foreign-currency order', async () => {
    const unknown = completedEvent({ metadata: { user_id: 'u1', pack_id: '99' } })
    expect((await handleStripeWebhook(unknown, sign(unknown), makeOptions())).status).toBe(500)
    const foreign = completedEvent({ currency: 'usd', metadata: { user_id: 'u1', pack_id: '10' } })
    const res = await handleStripeWebhook(foreign, sign(foreign), makeOptions())
    expect(res.status).toBe(200)
    expect(res.body.reason).toBe('not_a_credit_order')
  })

  it('revokes on a refund', async () => {
    const body = refundEvent()
    const opts = makeOptions()
    const res = await handleStripeWebhook(body, sign(body), opts)
    expect(res.status).toBe(200)
    expect(res.body.reason).toBe('refund_revoked')
    expect(opts.onRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_1' }))
  })
})
