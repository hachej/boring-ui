export {
  loadConfig,
  readCoreSecurityConfigProjection,
  validateConfig,
  buildRuntimeConfigPayload,
  coreConfigSchema,
} from './config/index.js'
export type {
  CoreSecurityConfigProjection,
  CoreTrustedProxyPolicyInput,
  LoadConfigOptions,
} from './config/index.js'

export { safeRedirect } from './security/index.js'

export { createCoreApp, registerRoutes, withUserSettingsWriteLock } from './app/index.js'
export type { CreateCoreAppOptions, RoutesOptions, UserStore, WorkspaceStore, WorkspaceStoreCreateOptions, AuthProvider, CapabilitiesContributor, CoreRequestScope, CoreRequestScopeResolver } from './app/index.js'

export {
  AGENT_TYPE_ID_PATTERN,
  StaticProductDeclarationsError,
  assertTypedDomainModeCompatible,
  createStaticProductDeclarations,
  isAgentTypeId,
  normalizeProductHostname,
} from './productDeclarations.js'
export type {
  ResolvedStaticProductDomain,
  ServerOnlyAgentBehaviorBinding,
  ServerOnlyAgentBehaviorCallable,
  ServerOnlyAgentBehaviorValue,
  StaticProductAgentTypeDeclaration,
  StaticProductDeclarations,
  StaticProductDeclarationsInput,
  StaticProductDomainDeclaration,
  StaticProductWorkspaceTypeDeclaration,
} from './productDeclarations.js'

export { createMailTransport, MailDeliveryError } from './mail/index.js'
export type { MailTransport, RenderedEmail } from './mail/index.js'

export {
  renderVerifyEmail,
  renderResetPassword,
  renderMagicLink,
  renderWorkspaceInvite,
  renderWelcome,
} from './mail/index.js'

export { createDatabase, runMigrations } from './db/index.js'
export type { Database } from './db/index.js'
export { PostgresMeteringStore, InsufficientCreditError, PostgresBudgetReservationStore, PostgresModelBudgetStore, ModelBudgetExceededError, UserBudgetExceededError } from './db/index.js'
export type { BudgetReservationAdmission, BudgetReservationAdmissionInput, ReserveBudgetInput, ReserveBudgetResult, FinishBudgetReservationInput, BudgetReservationScope, BudgetSpendQuery, BudgetSpendSnapshot } from './db/index.js'
export type {
  MeteringBalance,
  GrantOnceInput,
  ReserveInput,
  ReserveResult,
  RecordUsageInput,
  RecordUsageResult,
  ReservationFinalStatus,
  FinishReservationInput,
} from './db/index.js'
export {
  runCoreMigrationsFromEnv,
  type RunCoreMigrationsFromEnvOptions,
} from './migrations.js'

export {
  createAuth,
  validatePasswordStrength,
  authHook,
  requireWorkspaceMember,
  createPostSignupHook,
} from './auth/index.js'
export type {
  BetterAuthInstance,
  CreateAuthOptions,
  AuthHookOptions,
  PostSignupHookDeps,
} from './auth/index.js'

export { registerWorkspaceRoutes, registerMemberRoutes, registerSettingsRoutes, registerInviteRoutes } from './routes/index.js'

export { createIdempotencyMiddleware, createDrizzleIdempotencyStore } from './middleware/index.js'
export type { IdempotencyKeyStore, IdempotencyEntry } from './middleware/index.js'

export type { WorkspaceProvisioner, ProvisionContext, ProvisionResult } from './provisioner/index.js'
export { createFsProvisioner } from './provisioner/index.js'
export type { FsProvisionerOptions } from './provisioner/index.js'

export { WorkspaceRuntimeSandboxHandleStore } from './runtime/index.js'
export type {
  WorkspaceRuntimeStoreLike,
  WorkspaceSandboxHandleRecord,
} from './runtime/index.js'

export {
  CreditsService,
  CreditExhaustedError,
  DEFAULT_CREDITS_CONFIG,
  SIGNUP_GRANT_REASON,
  usageToCredits,
  estimateProviderCost,
  maxEffectiveRate,
  maxServedRate,
  DEFAULT_MODEL_RATES,
  createCreditsMeteringSink,
  verifyLemonSqueezySignature,
  parseLemonSqueezyOrder,
  handleLemonSqueezyWebhook,
  signUserAttribution,
  verifyUserAttribution,
  registerCreditsRoutes,
  createLemonSqueezyCheckout,
  buildCheckoutRequestBody,
  CONSERVATIVE_DEFAULT_RATE,
} from './credits/index.js'
export type {
  CreditsConfig,
  CreditBalance,
  CreditUsageRecord,
  CreditsMeteringStore,
  CreditPricingConfig,
  ModelTokenRate,
  CreditUsageInput,
  CreditCost,
  LemonSqueezyOrder,
  LemonSqueezyWebhookOptions,
  LemonSqueezyWebhookResult,
  CreditsRoutesOptions,
  LemonSqueezyRouteOptions,
  LemonSqueezyCheckoutConfig,
  CreateCheckoutInput,
} from './credits/index.js'
