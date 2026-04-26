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

export { createAuth, validatePasswordStrength, authHook, requireWorkspaceMember } from './auth/index.js'
export type { BetterAuthInstance, AuthHookOptions } from './auth/index.js'
