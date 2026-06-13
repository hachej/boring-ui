import { describe, it, expect } from 'vitest'
import { usageToCredits, estimateProviderCost, maxEffectiveRate, type CreditPricingConfig } from '../pricing'

// 1 credit = €0.000001 ⇒ 1 EUR = 1_000_000 credit micros.
// Explicit Infomaniak rates (the production path supplies these via config.rates).
const INFOMANIAK_RATE: CreditPricingConfig['rates'] = [[/infomaniak/, { inputPerMillion: 0.5, outputPerMillion: 1.5 }]]
const CONFIG: CreditPricingConfig = { margin: 1.3, creditMicrosPerUnit: 1_000_000, rates: INFOMANIAK_RATE }
const AT_COST: CreditPricingConfig = { margin: 1, creditMicrosPerUnit: 1_000_000 }
const AT_COST_INFOMANIAK: CreditPricingConfig = { margin: 1, creditMicrosPerUnit: 1_000_000, rates: INFOMANIAK_RATE }
const AT_COST_PREFER_REPORTED: CreditPricingConfig = { margin: 1, creditMicrosPerUnit: 1_000_000, preferProviderReportedCost: true }

describe('usageToCredits', () => {
  it('prices from configured token rates with margin when the provider reports no cost', () => {
    const cost = usageToCredits(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { provider: 'infomaniak', id: 'infomaniak/mixtral-8x22b' },
      AT_COST_INFOMANIAK,
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

  it('uses a provider-reported cost only when preferProviderReportedCost is set', () => {
    const opted = usageToCredits(
      { inputTokens: 10, outputTokens: 10, providerReportedCost: 0.01 },
      { id: 'something' },
      AT_COST_PREFER_REPORTED,
    )
    expect(opted.providerCostMicros).toBe(10_000) // €0.01 reported
  })

  it('ignores a provider-reported cost by default and prices from tokens (prepaid safety)', () => {
    const cost = usageToCredits(
      { inputTokens: 1_000_000, outputTokens: 0, providerReportedCost: 0.000001 }, // bogus tiny reported cost
      { id: 'mystery-model' },
      AT_COST,
    )
    // Token pricing at the conservative default (€3/MTok) wins over the tiny report.
    expect(cost.providerCostMicros).toBe(3_000_000)
    expect(cost.pricedFromDefault).toBe(true)
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

  it('fails safe: an unknown model bills at the conservative default rate (never zero)', () => {
    const cost = usageToCredits({ inputTokens: 1_000_000, outputTokens: 0 }, { id: 'mystery-model' }, AT_COST)
    // CONSERVATIVE_DEFAULT_RATE.inputPerMillion = €3.
    expect(cost.providerCostMicros).toBe(3_000_000)
    expect(cost.billedCreditMicros).toBe(3_000_000)
    expect(cost.pricedFromDefault).toBe(true)
  })

  it('does not mark a matched or trusted-reported-cost usage as default-priced', () => {
    expect(usageToCredits({ inputTokens: 1_000_000, outputTokens: 0 }, { id: 'kimi-k2:1t' }, AT_COST).pricedFromDefault).toBe(false)
    // A trusted (opted-in) reported cost is authoritative, not default-priced.
    expect(usageToCredits({ inputTokens: 1, outputTokens: 1, providerReportedCost: 0.01 }, { id: 'x' }, AT_COST_PREFER_REPORTED).pricedFromDefault).toBe(false)
  })

  it('honors a custom rate table override and falls back to the explicit default rate', () => {
    const config: CreditPricingConfig = {
      margin: 1,
      creditMicrosPerUnit: 1_000_000,
      rates: [[/my-model/, { inputPerMillion: 10, outputPerMillion: 20 }]],
      defaultRate: { inputPerMillion: 1, outputPerMillion: 1 },
    }
    expect(estimateProviderCost('my-model', 1_000_000, 1_000_000, config)).toEqual({ units: 30, usedDefault: false })
    // Unmatched (custom table doesn't have kimi) → explicit defaultRate, not the built-ins.
    expect(estimateProviderCost('kimi-k2', 1_000_000, 0, config)).toEqual({ units: 1, usedDefault: true })
  })

  describe('maxEffectiveRate (for sizing the per-run hold)', () => {
    it('uses the priciest DEFAULT_MODEL_RATES entry when no rates are configured', () => {
      // DEFAULT_MODEL_RATES includes Claude Opus at 15/75 — the hold must cover it.
      expect(maxEffectiveRate({ margin: 1.3, creditMicrosPerUnit: 1_000_000 })).toEqual({ inputPerMillion: 15, outputPerMillion: 75 })
    })

    it('uses the priciest configured rate (with the conservative default as a floor)', () => {
      const rate = maxEffectiveRate({
        margin: 1.3,
        creditMicrosPerUnit: 1_000_000,
        rates: [[/infomaniak/, { inputPerMillion: 0.5, outputPerMillion: 1.5 }]],
      })
      // Configured rate is cheaper than the conservative default (3/15) → default floors it.
      expect(rate).toEqual({ inputPerMillion: 3, outputPerMillion: 15 })
    })

    it('takes the max across multiple configured rates', () => {
      const rate = maxEffectiveRate({
        margin: 1.3,
        creditMicrosPerUnit: 1_000_000,
        rates: [
          [/cheap/, { inputPerMillion: 1, outputPerMillion: 2 }],
          [/pricey/, { inputPerMillion: 8, outputPerMillion: 40 }],
        ],
      })
      expect(rate).toEqual({ inputPerMillion: 8, outputPerMillion: 40 })
    })
  })
})
