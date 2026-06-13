export {
  CreditsService,
  CreditExhaustedError,
  DEFAULT_CREDITS_CONFIG,
  SIGNUP_GRANT_REASON,
} from './creditsService.js'
export type {
  CreditsConfig,
  CreditBalance,
  CreditUsageRecord,
  CreditsMeteringStore,
} from './creditsService.js'

export {
  usageToCredits,
  estimateProviderCost,
  DEFAULT_MODEL_RATES,
} from './pricing.js'
export type {
  CreditPricingConfig,
  ModelTokenRate,
  CreditUsageInput,
  CreditCost,
} from './pricing.js'

export { createCreditsMeteringSink } from './meteringSink.js'

export {
  verifyLemonSqueezySignature,
  parseLemonSqueezyOrder,
  handleLemonSqueezyWebhook,
} from './lemonSqueezy.js'
export type {
  LemonSqueezyOrder,
  LemonSqueezyWebhookOptions,
  LemonSqueezyWebhookResult,
} from './lemonSqueezy.js'

export { registerCreditsRoutes } from './routes.js'
export type { CreditsRoutesOptions, LemonSqueezyRouteOptions } from './routes.js'
