import { describe, it, expect } from 'vitest'
import { usageToCredits, estimateProviderCost, type CreditPricingConfig } from '../pricing'

// 1 credit = €0.000001 ⇒ 1 EUR = 1_000_000 credit micros.
const CONFIG: CreditPricingConfig = { margin: 1.3, creditMicrosPerUnit: 1_000_000 }
const AT_COST: CreditPricingConfig = { margin: 1, creditMicrosPerUnit: 1_000_000 }

describe('usageToCredits', () => {
  it('prices from token rates with margin when the provider reports no cost', () => {
    // Infomaniak placeholder: €0.5/MTok in, €1.5/MTok out.
    const cost = usageToCredits(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { provider: 'infomaniak', id: 'infomaniak/mixtral-8x22b' },
      AT_COST,
    )
    // raw = 0.5 + 1.5 = €2.0 → 2_000_000 micros at cost.
    expect(cost.providerCostMicros).toBe(2_000_000)
    expect(cost.billedCreditMicros).toBe(2_000_000)
  })

  it('applies the margin to the billed amount only', () => {
    const cost = usageToCredits(
      { inputTokens: 1_000_000, outputTokens: 0 },
      { id: 'infomaniak/mistral' },
      CONFIG,
    )
    expect(cost.providerCostMicros).toBe(500_000) // €0.5 raw
    expect(cost.billedCreditMicros).toBe(Math.ceil(0.5 * 1.3 * 1_000_000)) // €0.65
  })

  it('prefers a provider-reported cost over the token estimate', () => {
    const cost = usageToCredits(
      { inputTokens: 10, outputTokens: 10, providerReportedCost: 0.01 },
      { id: 'something' },
      AT_COST,
    )
    expect(cost.providerCostMicros).toBe(10_000) // €0.01
  })

  it('bills cache tokens at the input rate', () => {
    const cost = usageToCredits(
      { inputTokens: 500_000, outputTokens: 0, cacheReadTokens: 300_000, cacheWriteTokens: 200_000 },
      { id: 'kimi-k2:1t' },
      AT_COST,
    )
    // 1M effective input tokens × €0.6/MTok = €0.6.
    expect(cost.providerCostMicros).toBe(600_000)
    expect(cost).toMatchObject({ cacheReadTokens: 300_000, cacheWriteTokens: 200_000 })
  })

  it('clamps malformed token counts and never bills negative', () => {
    const cost = usageToCredits(
      { inputTokens: -50, outputTokens: Number.NaN, providerReportedCost: -1 },
      { id: 'kimi-k2:1t' },
      AT_COST,
    )
    expect(cost.inputTokens).toBe(0)
    expect(cost.outputTokens).toBe(0)
    expect(cost.billedCreditMicros).toBe(0)
  })

  it('bills zero for an unknown model with no reported cost', () => {
    const cost = usageToCredits({ inputTokens: 1000, outputTokens: 1000 }, { id: 'mystery-model' }, CONFIG)
    expect(cost.providerCostMicros).toBe(0)
    expect(cost.billedCreditMicros).toBe(0)
  })

  it('honors a custom rate table override', () => {
    const config: CreditPricingConfig = {
      margin: 1,
      creditMicrosPerUnit: 1_000_000,
      rates: [[/my-model/, { inputPerMillion: 10, outputPerMillion: 20 }]],
    }
    expect(estimateProviderCost('my-model', 1_000_000, 1_000_000, config)).toBe(30)
    expect(estimateProviderCost('kimi-k2', 1_000_000, 0, config)).toBe(0) // default table not used
  })
})
