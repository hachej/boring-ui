/**
 * Server configuration — mirrors Python's APIConfig with Zod validation.
 * Reads from environment variables with sensible defaults.
 * Fail-closed: missing critical config crashes on startup with clear errors.
 */
import { randomBytes } from 'node:crypto'

// --- Types ---

export type WorkspaceBackend = 'bwrap' | 'lightningfs' | 'justbash'
export type AgentRuntime = 'pi'
export type AgentPlacement = 'browser' | 'server'
export type ControlPlaneProvider = 'local' | 'neon'

export interface ServerConfig {
  /** HTTP port (default: 8000) */
  port: number
  /** Bind host (default: 0.0.0.0) */
  host: string
  /** PostgreSQL connection URL */
  databaseUrl: string | undefined
  /** CORS allowed origins */
  corsOrigins: string[]
  /** Workspace root directory */
  workspaceRoot: string
  /** Session signing secret (auto-generated if not set) */
  sessionSecret: string
  /** Settings encryption key */
  settingsKey: string | undefined
  /** Neon Auth base URL */
  neonAuthBaseUrl: string | undefined
  /** Neon Auth JWKS URL */
  neonAuthJwksUrl: string | undefined
  /** Control plane provider: local | neon */
  controlPlaneProvider: ControlPlaneProvider
  /** Workspace backend: bwrap | lightningfs | justbash */
  workspaceBackend: WorkspaceBackend
  /** Agent runtime: pi */
  agentRuntime: AgentRuntime
  /** Agent placement: browser | server */
  agentPlacement: AgentPlacement
  /** Agents mode: frontend | backend */
  agentsMode: string
  /** Public application origin (validated URL) */
  publicAppOrigin: string | undefined
  /** GitHub App ID */
  githubAppId: string | undefined
  /** GitHub App client ID */
  githubAppClientId: string | undefined
  /** GitHub App client secret */
  githubAppClientSecret: string | undefined
  /** GitHub App private key (PEM) */
  githubAppPrivateKey: string | undefined
  /** GitHub App slug (validated) */
  githubAppSlug: string | undefined
  /** GitHub sync enabled */
  githubSyncEnabled: boolean
  /** Auth session TTL in seconds */
  authSessionTtlSeconds: number
  /** Auth session cookie name */
  authSessionCookieName: string
  /** Auth email provider */
  authEmailProvider: string
  /** Auth app name */
  authAppName: string
  /** Control plane app ID */
  controlPlaneAppId: string
  /** Fly.io API token */
  flyApiToken: string | undefined
  /** Fly.io workspace app */
  flyWorkspaceApp: string | undefined
}

// --- Constants ---

const GITHUB_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/
const PUBLIC_ORIGIN_RE = /^(https?):\/\/([^/]+)$/
const VALID_WORKSPACE_BACKENDS: WorkspaceBackend[] = ['bwrap', 'lightningfs', 'justbash']
const VALID_AGENT_RUNTIMES: AgentRuntime[] = ['pi']
const VALID_AGENT_PLACEMENTS: AgentPlacement[] = ['browser', 'server']
const GENERATED_SESSION_SECRET_WARNING =
  'BORING_UI_SESSION_SECRET and BORING_SESSION_SECRET are unset; generated an ephemeral session secret. Existing sessions will not survive process restart.'

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176',
]

let warnedAboutGeneratedSessionSecret = false

// --- Helpers ---

function envStr(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const parsed = parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function envOptionalMultiline(name: string): string | undefined {
  const value = process.env[name]
  if (!value?.trim()) return undefined
  return value.trim().replace(/\\n/g, '\n')
}

function parseCorsOrigins(envValue: string | undefined): string[] {
  if (!envValue) return DEFAULT_CORS_ORIGINS
  return envValue.split(',').map((o) => o.trim()).filter(Boolean)
}

function normalizeControlPlaneProvider(): ControlPlaneProvider {
  const explicit = process.env.CONTROL_PLANE_PROVIDER?.trim().toLowerCase()
  if (explicit === 'neon') return 'neon'
  if (explicit === 'local') return 'local'
  // Auto-detect: if NEON_AUTH_BASE_URL is set, use neon
  if (process.env.NEON_AUTH_BASE_URL) return 'neon'
  return 'local'
}

function normalizeAgentsMode(): string {
  const value = (
    process.env.BUI_AGENTS_MODE ||
    process.env.AGENTS_MODE ||
    'frontend'
  ).trim().toLowerCase()
  return value === 'backend' ? 'backend' : 'frontend'
}

function normalizePublicOrigin(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  const match = raw.trim().match(PUBLIC_ORIGIN_RE)
  if (!match) return undefined
  return `${match[1]}://${match[2]}`
}

function normalizeGithubSlug(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  return GITHUB_SLUG_RE.test(raw.trim()) ? raw.trim() : undefined
}

function normalizeEmailProvider(raw: string | undefined): string {
  const value = (raw || '').trim().toLowerCase()
  if (['smtp', 'resend', 'email'].includes(value)) return 'smtp'
  if (['none', 'disabled', 'off'].includes(value)) return 'none'
  return process.env.RESEND_API_KEY ? 'smtp' : 'unknown'
}

function generateSessionSecret(): string {
  return randomBytes(48).toString('base64url')
}

function warnAboutGeneratedSessionSecret(): void {
  if (warnedAboutGeneratedSessionSecret) return
  warnedAboutGeneratedSessionSecret = true
  console.warn(GENERATED_SESSION_SECRET_WARNING)
}

// --- Main ---

export function loadConfig(): ServerConfig {
  // Session secret precedence: BORING_UI_SESSION_SECRET → BORING_SESSION_SECRET → auto-generate
  let sessionSecret = process.env.BORING_UI_SESSION_SECRET?.trim() || ''
  if (!sessionSecret) {
    sessionSecret = process.env.BORING_SESSION_SECRET?.trim() || ''
  }
  if (!sessionSecret) {
    warnAboutGeneratedSessionSecret()
    sessionSecret = generateSessionSecret()
  }

  return {
    port: envInt('PORT', 8000),
    host: envStr('HOST', '0.0.0.0'),
    databaseUrl: process.env.DATABASE_URL,
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
    workspaceRoot:
      process.env.BORING_UI_WORKSPACE_ROOT ||
      process.env.BUI_WORKSPACE_ROOT ||
      process.env.WORKSPACE_ROOT ||
      process.cwd(),
    sessionSecret,
    settingsKey: process.env.BORING_SETTINGS_KEY,
    neonAuthBaseUrl: process.env.NEON_AUTH_BASE_URL,
    neonAuthJwksUrl: process.env.NEON_AUTH_JWKS_URL,
    controlPlaneProvider: normalizeControlPlaneProvider(),
    workspaceBackend: (envStr('WORKSPACE_BACKEND', 'bwrap') as WorkspaceBackend),
    agentRuntime: (envStr('AGENT_RUNTIME', 'pi') as AgentRuntime),
    agentPlacement: (envStr('AGENT_PLACEMENT', 'browser') as AgentPlacement),
    agentsMode: normalizeAgentsMode(),
    publicAppOrigin: normalizePublicOrigin(
      process.env.BORING_UI_PUBLIC_ORIGIN || process.env.PUBLIC_APP_ORIGIN,
    ),
    githubAppId: process.env.GITHUB_APP_ID,
    githubAppClientId: process.env.GITHUB_APP_CLIENT_ID,
    githubAppClientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
    githubAppPrivateKey: envOptionalMultiline('GITHUB_APP_PRIVATE_KEY'),
    githubAppSlug: normalizeGithubSlug(process.env.GITHUB_APP_SLUG),
    githubSyncEnabled: envBool('GITHUB_SYNC_ENABLED', true),
    authSessionTtlSeconds: envInt('AUTH_SESSION_TTL_SECONDS', 86400),
    authSessionCookieName: envStr('AUTH_SESSION_COOKIE_NAME', 'boring_session'),
    authEmailProvider: normalizeEmailProvider(
      process.env.AUTH_EMAIL_PROVIDER || process.env.NEON_AUTH_EMAIL_PROVIDER,
    ),
    authAppName: envStr('AUTH_APP_NAME', 'Boring UI'),
    controlPlaneAppId: envStr('CONTROL_PLANE_APP_ID', 'boring-ui'),
    flyApiToken: process.env.FLY_API_TOKEN,
    flyWorkspaceApp: process.env.FLY_WORKSPACE_APP,
  }
}

/**
 * Validate config and fail closed on misconfiguration.
 * Call this at startup — throws with clear error messages.
 */
export function validateConfig(config: ServerConfig): void {
  const errors: string[] = []

  // Validate workspace.backend
  if (!VALID_WORKSPACE_BACKENDS.includes(config.workspaceBackend)) {
    errors.push(
      `Invalid workspace.backend "${config.workspaceBackend}". ` +
      `Must be one of: ${VALID_WORKSPACE_BACKENDS.join(', ')}`,
    )
  }

  // Validate agent.runtime
  if (!VALID_AGENT_RUNTIMES.includes(config.agentRuntime)) {
    errors.push(
      `Invalid agent.runtime "${config.agentRuntime}". ` +
      `Must be one of: ${VALID_AGENT_RUNTIMES.join(', ')}`,
    )
  }

  // Validate agent.placement
  if (!VALID_AGENT_PLACEMENTS.includes(config.agentPlacement)) {
    errors.push(
      `Invalid agent.placement "${config.agentPlacement}". ` +
      `Must be one of: ${VALID_AGENT_PLACEMENTS.join(', ')}`,
    )
  }

  // Neon mode requires DATABASE_URL and NEON_AUTH_BASE_URL
  if (config.controlPlaneProvider === 'neon') {
    if (!config.databaseUrl) {
      errors.push(
        'DATABASE_URL is required when CONTROL_PLANE_PROVIDER=neon. ' +
        'Set DATABASE_URL or switch to CONTROL_PLANE_PROVIDER=local.',
      )
    }
    if (!config.neonAuthBaseUrl) {
      errors.push(
        'NEON_AUTH_BASE_URL is required when CONTROL_PLANE_PROVIDER=neon. ' +
        'Set NEON_AUTH_BASE_URL or switch to CONTROL_PLANE_PROVIDER=local.',
      )
    }
  }

  // Server-side agent placement requires bwrap backend and database
  if (config.agentPlacement === 'server') {
    if (config.workspaceBackend !== 'bwrap') {
      errors.push(
        `agent.placement=server requires workspace.backend=bwrap, ` +
        `got "${config.workspaceBackend}".`,
      )
    }
    if (!config.databaseUrl) {
      errors.push(
        'agent.placement=server requires DATABASE_URL for workspace state.',
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    )
  }
}
