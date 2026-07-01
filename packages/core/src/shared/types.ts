import type { ErrorCode } from './errors.js'

export type MemberRole = 'owner' | 'editor' | 'viewer'

export type User = {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  image: string | null
  createdAt: string
  updatedAt: string
  isAnonymousLead?: boolean
}

export type Workspace = {
  id: string
  appId: string
  name: string
  createdBy: string
  createdAt: string
  deletedAt: string | null
  isDefault: boolean
}

export type WorkspaceMember = {
  workspaceId: string
  userId: string
  role: MemberRole
  createdAt: string
}

export type WorkspaceInvite = {
  id: string
  workspaceId: string
  email: string
  tokenHash: string
  role: MemberRole
  expiresAt: string
  acceptedAt: string | null
  createdBy: string | null
  createdAt: string
  failedAttempts: number
  lockedUntil: string | null
}

export type WorkspaceRuntime = {
  workspaceId: string
  spriteUrl: string | null
  spriteName: string | null
  state: 'pending' | 'ready' | 'error'
  lastError: string | null
  volumePath: string | null
  lastErrorOp: string | null
  sandboxProvider?: string | null
  sandboxId?: string | null
  sandboxStatus?: string | null
  sandboxSnapshotId?: string | null
  sandboxCreatedAt?: string | null
  sandboxLastUsedAt?: string | null
  sandboxLastSeenAt?: string | null
  sandboxExpiresAt?: string | null
  provisioningStep: string | null
  stepStartedAt: string | null
  updatedAt: string
}

export type WorkspaceRuntimeResource = {
  id: string
  workspaceId: string
  kind: string
  purpose: string
  provider: string
  handleKind: string
  stableKey: string | null
  providerResourceId: string | null
  parentResourceId: string | null
  state: string
  persistenceMode: string
  config: Record<string, unknown>
  providerMeta: Record<string, unknown>
  lastError: string | null
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
  lastSeenAt: string | null
  lastUsedAt: string | null
  expiresAt: string | null
  generation: number
}

export type WorkspaceRuntimeResourceSelector = {
  kind: string
  purpose: string
  provider: string
}

export type WorkspaceRuntimeResourceInput = WorkspaceRuntimeResourceSelector & {
  id?: string
  handleKind: string
  stableKey?: string | null
  providerResourceId?: string | null
  parentResourceId?: string | null
  state: string
  persistenceMode: string
  config?: Record<string, unknown>
  providerMeta?: Record<string, unknown>
  lastError?: string | null
  lastErrorCode?: string | null
  lastSeenAt?: string | null
  lastUsedAt?: string | null
  expiresAt?: string | null
  generation?: number
}

export type SessionPayload = {
  userId: string
  email: string
  issuedAt: number
  expiresAt: number
}

export type SessionState = {
  data: { user: User; expiresAt: string } | null
  isPending: boolean
  error: { status: number; code: ErrorCode; message: string } | null
}

export type RateLimitEndpointOverride = {
  max: number
  window: string
}

export interface CoreConfig {
  appId: string
  appName: string
  appLogo: string | null

  port: number
  host: string
  staticDir: string | null

  databaseUrl: string | null
  stores: 'postgres' | 'local'

  cors: {
    origins: string[]
    credentials: true
  }

  bodyLimit: number
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  rateLimit?: Record<string, RateLimitEndpointOverride>
  security?: {
    csp: {
      enabled: boolean
      upgradeInsecureRequests?: boolean
    }
  }

  encryption: {
    workspaceSettingsKey: string
  }

  auth: {
    secret: string
    url: string
    github?: { clientId: string; clientSecret: string }
    google?: { clientId: string; clientSecret: string }
    mail?: { from: string; transportUrl: string }
    sessionTtlSeconds: number
    sessionCookieSecure: boolean
  }

  features: {
    githubOauth: boolean
    googleOauth: boolean
    invitesEnabled: boolean
    sendWelcomeEmail: boolean
    inviteTtlDays: number
  }
}

export interface RuntimeConfig {
  appId: string
  appName: string
  appLogo: string | null
  apiBase: string
  features: {
    githubOauth: boolean
    googleOauth: boolean
    invitesEnabled: boolean
    sendWelcomeEmail: boolean
    emailVerification: boolean
  }
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue }

export type CoreCapabilities = {
  version: string
  features: {
    invitesEnabled: boolean
    githubOauth: boolean
    googleOauth: boolean
    emailFlows: boolean
  }
  auth: {
    emailPassword: boolean
    github: boolean
    google: boolean
    emailVerification: boolean
    passwordReset: boolean
    magicLink: boolean
  }
}

export type CapabilitiesResponse = {
  core: CoreCapabilities
  agent?: {
    runtimeMode: 'direct' | 'local' | 'vercel-sandbox'
    tools: string[]
    modelProviders: string[]
  }
  workspace?: { panels: string[] }
  [contributorName: string]: JsonValue | CoreCapabilities | undefined
}
