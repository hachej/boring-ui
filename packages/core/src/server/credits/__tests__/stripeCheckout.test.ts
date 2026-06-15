import { describe, it, expect, vi } from 'vitest'
import { buildStripeCheckoutForm, createStripeCheckout } from '../stripeCheckout.js'

function form(input: Parameters<typeof buildStripeCheckoutForm>[0]): URLSearchParams {
  return new URLSearchParams(buildStripeCheckoutForm(input))
}

describe('buildStripeCheckoutForm', () => {
  const base = { apiKey: 'sk_test_x', priceId: 'price_abc', userId: 'u1', packId: '10' }

  it('sets mode=payment, the line item, and server-set buyer attribution (no credit amount in metadata)', () => {
    const p = form({ ...base, redirectUrl: 'https://app.test/account' })
    expect(p.get('mode')).toBe('payment')
    expect(p.get('line_items[0][price]')).toBe('price_abc')
    expect(p.get('line_items[0][quantity]')).toBe('1')
    expect(p.get('client_reference_id')).toBe('u1')
    expect(p.get('metadata[user_id]')).toBe('u1')
    expect(p.get('metadata[pack_id]')).toBe('10')
    // The credit amount is resolved server-side from pack_id; never trusted from metadata.
    expect(p.get('metadata[credit_micros]')).toBeNull()
    // Never set payment_method_types (Stripe best practice → dynamic payment methods).
    expect([...p.keys()].some((k) => k.startsWith('payment_method_types'))).toBe(false)
  })

  it('appends checkout markers to success/cancel urls', () => {
    const p = form({ ...base, redirectUrl: 'https://app.test/account?x=1' })
    expect(p.get('success_url')).toBe('https://app.test/account?x=1&checkout=return')
    expect(p.get('cancel_url')).toBe('https://app.test/account?x=1&checkout=cancelled')
  })

  it('rejects a malformed price id and a missing pack id', () => {
    expect(() => buildStripeCheckoutForm({ ...base, priceId: 'prod_oops' })).toThrow(/price_/)
    expect(() => buildStripeCheckoutForm({ ...base, packId: '' })).toThrow(/packId/)
  })
})

describe('createStripeCheckout', () => {
  it('returns the hosted url on success', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.test/c/abc' }), text: async () => '' }))
    const { url } = await createStripeCheckout({ apiKey: 'sk_test_x', priceId: 'price_abc', userId: 'u1', packId: '10' }, fetchImpl as never)
    expect(url).toBe('https://checkout.stripe.test/c/abc')
    expect(fetchImpl).toHaveBeenCalledWith('https://api.stripe.com/v1/checkout/sessions', expect.objectContaining({ method: 'POST' }))
  })

  it('throws on a Stripe API error and when no url is returned', async () => {
    const err = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'bad' }))
    await expect(createStripeCheckout({ apiKey: 'k', priceId: 'price_abc', userId: 'u1', packId: '10' }, err as never)).rejects.toThrow(/stripe checkout failed/)
    const nourl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }))
    await expect(createStripeCheckout({ apiKey: 'k', priceId: 'price_abc', userId: 'u1', packId: '10' }, nourl as never)).rejects.toThrow(/no url/)
  })
})
