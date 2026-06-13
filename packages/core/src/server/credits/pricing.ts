/**
 * Token → credit pricing.
 *
 * Direct EU providers like Infomaniak return token usage but not a per-call
 * cost, so we price from published per-token rates and apply a margin. The
 * result is the credit amount to charge against the balance (in credit micros).
 *
 * Currency-neutral: rates are expressed in a "pricing currency unit" (e.g. EUR)
 * per million tokens; `creditMicrosPerUnit` converts that to credit micros.
 * With 1 credit = €0.000001, `creditMicrosPerUnit = 1_000_000`.
 */

export interface ModelTokenRate {
  /** Pricing-currency units per 1M input tokens (cache tokens billed as input). */
  inputPerMillion: number
  /** Pricing-currency units per 1M output tokens. */
  outputPerMillion: number
}

export interface CreditPricingConfig {
  /** Multiplier applied on top of raw provider cost (your margin). 1.0 = at cost. */
  margin: number
  /** Credit micros per 1 pricing-currency unit. 1 credit = €0.000001 ⇒ 1_000_000. */
  creditMicrosPerUnit: number
  /** Ordered [pattern, rate] table; first match wins. Overrides the defaults. */
  rates?: Array<[RegExp, ModelTokenRate]>
  /**
   * Rate applied when no pattern matches and the provider reported no cost.
   * Defaults to CONSERVATIVE_DEFAULT_RATE so an unpriced model is never billed
   * zero (free usage) in this prepaid path — set it explicitly to tune.
   */
  defaultRate?: ModelTokenRate
}

/** Conservative fallback rate (≈ Claude Sonnet list price). EU open models are
 * cheaper, so this over-charges an un-configured model rather than billing zero. */
export const CONSERVATIVE_DEFAULT_RATE: ModelTokenRate = { inputPerMillion: 3, outputPerMillion: 15 }

// Default rate table (pricing currency = EUR). Confirm Infomaniak's published
// per-token prices for the exact model ids you enable before launch; these are
// conservative placeholders so an unrecognised model still meters rather than
// billing zero.
export const DEFAULT_MODEL_RATES: Array<[RegExp, ModelTokenRate]> = [
  // Infomaniak hosted open models (EUR / MTok). PLACEHOLDER — verify per model.
  [/infomaniak|mixtral|mistral|llama|qwen/i, { inputPerMillion: 0.5, outputPerMillion: 1.5 }],
  // Kimi K2 (public token pricing) for Ollama-hosted demo parity.
  [/kimi-k2/i, { inputPerMillion: 0.6, outputPerMillion: 2.5 }],
  // Claude (public API list prices) as a fallback if ever routed there.
  [/claude-(?:sonnet|3-5-sonnet|3-7-sonnet|4|sonnet-4)/i, { inputPerMillion: 3, outputPerMillion: 15 }],
  [/claude-3-haiku/i, { inputPerMillion: 0.25, outputPerMillion: 1.25 }],
  [/claude-3-opus/i, { inputPerMillion: 15, outputPerMillion: 75 }],
]

export interface CreditUsageInput {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Provider-reported cost in pricing-currency units, if any (0 when absent). */
  providerReportedCost?: number
}

export interface CreditCost {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Raw provider cost (reported or estimated) in credit micros, before margin. */
  providerCostMicros: number
  /** Amount to charge against the balance, in credit micros (with margin). */
  billedCreditMicros: number
  /** True when no model rate matched and the conservative defaultRate was used —
   * a signal to the operator to add an explicit rate for this model. */
  pricedFromDefault: boolean
}

function clampTokens(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function rateForModel(modelId: string, config: CreditPricingConfig): ModelTokenRate | null {
  const table = config.rates ?? DEFAULT_MODEL_RATES
  return table.find(([pattern]) => pattern.test(modelId))?.[1] ?? null
}

/** Estimate raw provider cost (pricing-currency units) from token counts. Cache
 * tokens are billed at the input rate — a deliberate conservative over-count.
 * Unmatched models fall back to `config.defaultRate` (never zero). */
export function estimateProviderCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  config: CreditPricingConfig,
): { units: number; usedDefault: boolean } {
  const matched = rateForModel(modelId, config)
  const rate = matched ?? config.defaultRate ?? CONSERVATIVE_DEFAULT_RATE
  const units = (inputTokens / 1_000_000) * rate.inputPerMillion + (outputTokens / 1_000_000) * rate.outputPerMillion
  return { units, usedDefault: matched === null }
}

/**
 * Price one usage record into the credit amount to charge. Prefers a
 * provider-reported cost; otherwise estimates from token rates. Applies the
 * margin and converts to credit micros (rounded up so we never undercharge).
 */
export function usageToCredits(
  usage: CreditUsageInput,
  model: { provider?: string; id?: string },
  config: CreditPricingConfig,
): CreditCost {
  const inputTokens = clampTokens(usage.inputTokens)
  const outputTokens = clampTokens(usage.outputTokens)
  const cacheReadTokens = clampTokens(usage.cacheReadTokens)
  const cacheWriteTokens = clampTokens(usage.cacheWriteTokens)
  const modelId = model.id ?? 'unknown'

  const reported = usage.providerReportedCost
  const reportedUnits = typeof reported === 'number' && Number.isFinite(reported) && reported > 0 ? reported : 0
  const estimated = estimateProviderCost(
    modelId,
    inputTokens + cacheReadTokens + cacheWriteTokens,
    outputTokens,
    config,
  )
  const providerUnits = reportedUnits > 0 ? reportedUnits : estimated.units

  const providerCostMicros = Math.ceil(providerUnits * config.creditMicrosPerUnit)
  const billedCreditMicros = Math.ceil(providerUnits * config.margin * config.creditMicrosPerUnit)

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    providerCostMicros,
    billedCreditMicros,
    // Only "default-priced" when we fell back to the estimate AND it used the
    // default rate (a reported cost or a matched rate is authoritative).
    pricedFromDefault: reportedUnits === 0 && estimated.usedDefault,
  }
}
