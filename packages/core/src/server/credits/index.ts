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
  maxEffectiveRate,
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
  signUserAttribution,
  verifyUserAttribution,
} from './lemonSqueezy.js'
export type {
  LemonSqueezyOrder,
  LemonSqueezyWebhookOptions,
  LemonSqueezyWebhookResult,
} from './lemonSqueezy.js'

export {
  createLemonSqueezyCheckout,
  buildCheckoutRequestBody,
} from './lemonSqueezyCheckout.js'
export type { CreateCheckoutInput } from './lemonSqueezyCheckout.js'

export { registerCreditsRoutes } from './routes.js'
export type {
  CreditsRoutesOptions,
  LemonSqueezyRouteOptions,
  LemonSqueezyCheckoutConfig,
} from './routes.js'

export { CONSERVATIVE_DEFAULT_RATE } from './pricing.js'
