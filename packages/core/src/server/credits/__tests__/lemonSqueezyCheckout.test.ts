import { describe, it, expect, vi } from 'vitest'
import { buildCheckoutRequestBody, createLemonSqueezyCheckout, type FetchLike } from '../lemonSqueezyCheckout'

const INPUT = {
  apiKey: 'k',
  storeId: '406592',
  variantId: '42',
  userId: 'user-1',
  email: 'a@b.com',
  redirectUrl: 'https://app/thanks',
  testMode: true,
}

describe('buildCheckoutRequestBody', () => {
  it('sets the user id server-side in checkout custom data', () => {
    const body = buildCheckoutRequestBody(INPUT) as any
    expect(body.data.type).toBe('checkouts')
    expect(body.data.attributes.checkout_data.custom).toEqual({ user_id: 'user-1' })
    expect(body.data.attributes.checkout_data.email).toBe('a@b.com')
    expect(body.data.attributes.test_mode).toBe(true)
    expect(body.data.attributes.product_options.redirect_url).toBe('https://app/thanks')
    // Discounts disabled and the checkout locked to exactly the selected variant + qty 1.
    expect(body.data.attributes.checkout_options.discount).toBe(false)
    expect(body.data.attributes.product_options.enabled_variants).toEqual([42])
    expect(body.data.attributes.checkout_data.variant_quantities).toEqual([{ variant_id: 42, quantity: 1 }])
    expect(body.data.relationships.store.data.id).toBe('406592')
    expect(body.data.relationships.variant.data.id).toBe('42')
  })

  it('fails closed for a non-numeric variant id (the lock must always apply)', () => {
    expect(() => buildCheckoutRequestBody({ ...INPUT, variantId: 'var10' })).toThrow(/must be a positive integer/)
  })
})

describe('createLemonSqueezyCheckout', () => {
  it('posts to the LS API and returns the checkout url', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ data: { attributes: { url: 'https://store.lemonsqueezy.com/checkout/abc' } } }),
      text: async () => '',
    })) as unknown as FetchLike

    const { url } = await createLemonSqueezyCheckout(INPUT, fetchImpl)
    expect(url).toBe('https://store.lemonsqueezy.com/checkout/abc')
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('https://api.lemonsqueezy.com/v1/checkouts')
    expect(call[1].headers.Authorization).toBe('Bearer k')
    expect(JSON.parse(call[1].body).data.attributes.checkout_data.custom.user_id).toBe('user-1')
  })

  it('throws on a non-ok API response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({}), text: async () => 'bad variant' })) as unknown as FetchLike
    await expect(createLemonSqueezyCheckout(INPUT, fetchImpl)).rejects.toThrow('422')
  })

  it('throws when no url is returned', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ data: { attributes: {} } }), text: async () => '' })) as unknown as FetchLike
    await expect(createLemonSqueezyCheckout(INPUT, fetchImpl)).rejects.toThrow('no url')
  })
})
