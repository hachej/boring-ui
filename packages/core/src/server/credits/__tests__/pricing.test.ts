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
    // Token pricing wins over the tiny report; an unmatched model fails closed at
    // the highest effective rate (Opus 15/MTok from the built-in defaults).
    expect(cost.providerCostMicros).toBe(15_000_000)
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

  it('fails closed: an unknown model bills at the highest effective rate (never zero/cheap)', () => {
    const cost = usageToCredits({ inputTokens: 1_000_000, outputTokens: 0 }, { id: 'mystery-model' }, AT_COST)
    // No explicit defaultRate ⇒ highest built-in (Opus 15/MTok), not the cheap floor.
    expect(cost.providerCostMicros).toBe(15_000_000)
    expect(cost.billedCreditMicros).toBe(15_000_000)
    expect(cost.pricedFromDefault).toBe(true)
  })

  it('uses an explicit defaultRate for unmatched models when configured', () => {
    const config: CreditPricingConfig = { margin: 1, creditMicrosPerUnit: 1_000_000, defaultRate: { inputPerMillion: 4, outputPerMillion: 8 } }
    const cost = usageToCredits({ inputTokens: 1_000_000, outputTokens: 0 }, { id: 'mystery-model' }, config)
    expect(cost.providerCostMicros).toBe(4_000_000)
    expect(cost.pricedFromDefault).toBe(true)
  })

  it('does not mark a matched or trusted-reported-cost usage as default-priced', () => {
    expect(usageToCredits({ inputTokens: 1_000_000, outputTokens: 0 }, { id: 'kimi-k2:1t' }, AT_COST).pricedFromDefault).toBe(false)
    // A trusted (opted-in) reported cost is authoritative, not default-priced.
    expect(usageToCredits({ inputTokens: 1, outputTokens: 1, providerReportedCost: 0.01 }, { id: 'x' }, AT_COST_PREFER_REPORTED).pricedFromDefault).toBe(false)
  })

  it('checks configured rates first but still consults the built-in defaults for unlisted models', () => {
    const config: CreditPricingConfig = {
      margin: 1,
      creditMicrosPerUnit: 1_000_000,
      rates: [[/my-model/, { inputPerMillion: 10, outputPerMillion: 20 }]],
      defaultRate: { inputPerMillion: 1, outputPerMillion: 1 },
    }
    // Configured rate wins for the model it matches.
    expect(estimateProviderCost('my-model', 1_000_000, 1_000_000, config)).toEqual({ units: 30, usedDefault: false })
    // An unlisted model still matches the built-in defaults (kimi 0.6/MTok), NOT
    // the cheap explicit defaultRate — so a known model is never undercharged.
    expect(estimateProviderCost('kimi-k2', 1_000_000, 0, config)).toEqual({ units: 0.6, usedDefault: false })
    // A truly-unknown model falls through to the explicit default rate.
    expect(estimateProviderCost('zzz-unknown', 1_000_000, 0, config)).toEqual({ units: 1, usedDefault: true })
  })

  it('matches a provider-keyed rate against the provider, not just the model id', () => {
    // Rate keyed by provider name; the model id alone ("Qwen/Qwen3.5") doesn't
    // contain "infomaniak", but the provider-qualified key does.
    const config: CreditPricingConfig = { margin: 1, creditMicrosPerUnit: 1_000_000, rates: INFOMANIAK_RATE }
    const cost = usageToCredits({ inputTokens: 1_000_000, outputTokens: 0 }, { provider: 'infomaniak', id: 'Qwen/Qwen3.5' }, config)
    expect(cost.providerCostMicros).toBe(500_000) // €0.5 infomaniak rate applied
    expect(cost.pricedFromDefault).toBe(false)
  })

  describe('maxEffectiveRate (for sizing the per-run hold)', () => {
    it('uses the priciest DEFAULT_MODEL_RATES entry when no rates are configured', () => {
      // DEFAULT_MODEL_RATES includes Claude Opus at 15/75 — the hold must cover it.
      expect(maxEffectiveRate({ margin: 1.3, creditMicrosPerUnit: 1_000_000 })).toEqual({ inputPerMillion: 15, outputPerMillion: 75 })
    })

    it('still covers the built-in expensive defaults even when cheaper rates are configured', () => {
      const rate = maxEffectiveRate({
        margin: 1.3,
        creditMicrosPerUnit: 1_000_000,
        rates: [[/infomaniak/, { inputPerMillion: 0.5, outputPerMillion: 1.5 }]],
      })
      // Configured rates merge with the built-ins, so a selectable Opus (15/75)
      // still drives the hold size — never silently dropped.
      expect(rate).toEqual({ inputPerMillion: 15, outputPerMillion: 75 })
    })

    it('takes the max across configured rates and built-in defaults', () => {
      const rate = maxEffectiveRate({
        margin: 1.3,
        creditMicrosPerUnit: 1_000_000,
        // A configured rate pricier than every built-in dominates.
        rates: [[/pricey/, { inputPerMillion: 20, outputPerMillion: 100 }]],
      })
      expect(rate).toEqual({ inputPerMillion: 20, outputPerMillion: 100 })
    })
  })
})
