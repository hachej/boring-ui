export {
  loadConfig,
  validateConfig,
  buildRuntimeConfigPayload,
  coreConfigSchema,
} from './config/index.js'
export type { LoadConfigOptions } from './config/index.js'

export { safeRedirect } from './security/index.js'

export { createCoreApp, registerRoutes } from './app/index.js'
export type { CreateCoreAppOptions, RoutesOptions, UserStore, WorkspaceStore, AuthProvider, CapabilitiesContributor } from './app/index.js'

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
