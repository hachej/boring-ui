import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseTOML } from 'smol-toml'
import { isCoreEmailVerificationEnabled } from '../../shared/authPolicy.js'
import type { CoreConfig, RuntimeConfig } from '../../shared/types.js'
import { ConfigValidationError } from '../../shared/errors.js'
import { coreConfigSchema } from './schema.js'

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30
const SIXTEEN_MB = 16 * 1024 * 1024

const INSECURE_PLACEHOLDER_SECRET =
  '0000000000000000000000000000000000000000000000000000000000000000'
const INSECURE_DATABASE_URL = 'postgres://placeholder:placeholder@localhost:5432/placeholder'
const INSECURE_ENCRYPTION_KEY =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

export interface LoadConfigOptions {
  tomlPath?: string
  env?: Record<string, string | undefined>
  allowMissingSecrets?: boolean
}

interface TomlAppConfig {
  app?: { id?: string }
  frontend?: {
    branding?: { name?: string; logo?: string; favicon?: string }
    theme?: { default?: string }
  }
  features?: {
    github_oauth?: boolean
    google_oauth?: boolean
    invites_enabled?: boolean
    invite_ttl_days?: number
  }
}

function formatDisplayName(name: string): string {
  const trimmed = name.trim().replace(/[<>]/g, '')
  if (/^[A-Za-z0-9 ._-]+$/.test(trimmed)) return trimmed
  return `"${trimmed.replace(/["\\]/g, '\\$&')}"`
}

function isDefaultBoringDisplayName(name: string): boolean {
  return name.toLowerCase().replace(/[\s._-]+/g, '') === 'boringui'
}

function normalizeMailFrom(appName: string, rawFrom: string): string {
  const from = rawFrom.trim()
  const addressWithDisplay = from.match(/^(.*?)\s*<([^>]+)>$/)
  if (addressWithDisplay) {
    const displayName = addressWithDisplay[1].trim().replace(/^"(.*)"$/, '$1')
    const address = addressWithDisplay[2].trim()
    if (!displayName || isDefaultBoringDisplayName(displayName)) {
      return `${formatDisplayName(appName)} <${address}>`
    }
    return from
  }

  if (/^[^\s@<>]+@[^\s@<>]+$/.test(from)) {
    return `${formatDisplayName(appName)} <${from}>`
  }

  return from
}

function parseRateLimitOverrides(
  raw: string | undefined,
): Record<string, { max: number; window: string }> | undefined {
  if (!raw) return undefined

  try {
    return JSON.parse(raw) as Record<string, { max: number; window: string }>
  } catch {
    throw new ConfigValidationError([
      {
        message:
          'RATE_LIMIT_OVERRIDES_JSON must be valid JSON object: {"<endpoint>":{"max":number,"window":"<duration>"}}',
        path: ['rateLimit'],
      },
    ])
  }
}

export async function loadConfig(
  options?: LoadConfigOptions,
): Promise<CoreConfig> {
  const env = options?.env ?? (process.env as Record<string, string | undefined>)
  const tomlPath = resolve(options?.tomlPath ?? './boring.app.toml')
  const allowMissingSecrets = options?.allowMissingSecrets ?? false

  if (allowMissingSecrets && env.NODE_ENV === 'production') {
    throw new ConfigValidationError([
      {
        message: 'allowMissingSecrets is forbidden in production',
        path: ['allowMissingSecrets'],
      },
    ])
  }

  let toml: TomlAppConfig = {}
  if (existsSync(tomlPath)) {
    const raw = readFileSync(tomlPath, 'utf-8')
    toml = parseTOML(raw) as unknown as TomlAppConfig
  }

  const appId = toml.app?.id ?? env.APP_ID ?? 'boring-app'
  const appName = toml.frontend?.branding?.name ?? env.APP_NAME ?? appId
  const appLogo = toml.frontend?.branding?.logo ?? null

  const storesRaw = env.CORE_STORES ?? 'postgres'
  const stores = storesRaw === 'local' ? 'local' : 'postgres'

  let databaseUrl = env.DATABASE_URL ?? null
  let authSecret = env.BETTER_AUTH_SECRET ?? ''
  let encryptionKey = env.WORKSPACE_SETTINGS_ENCRYPTION_KEY ?? ''

  const insecureDefaults: string[] = []

  if (allowMissingSecrets) {
    if (!databaseUrl) {
      databaseUrl = INSECURE_DATABASE_URL
      insecureDefaults.push('DATABASE_URL')
    }
    if (!authSecret) {
      authSecret = INSECURE_PLACEHOLDER_SECRET
      insecureDefaults.push('BETTER_AUTH_SECRET')
    }
    if (!encryptionKey) {
      encryptionKey = INSECURE_ENCRYPTION_KEY
      insecureDefaults.push('WORKSPACE_SETTINGS_ENCRYPTION_KEY')
    }
  }

  if (insecureDefaults.length > 0) {
    console.warn(
      `[config:insecure-defaults] Using placeholder values for: ${insecureDefaults.join(', ')}. Do NOT use in production.`,
    )
  }

  const authUrl = env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT ?? '3000'}`

  const corsOriginsRaw = env.CORS_ORIGINS ?? ''
  const corsOrigins = corsOriginsRaw
    ? corsOriginsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : ['http://localhost:3000', 'http://localhost:5173']
  const cspEnabled = env.CSP_ENABLED !== 'false'
  const cspUpgradeInsecureRequests =
    env.CSP_UPGRADE_INSECURE_REQUESTS !== undefined
      ? env.CSP_UPGRADE_INSECURE_REQUESTS === 'true'
      : authUrl.startsWith('https://')

  const sessionCookieSecureOverride = env.SESSION_COOKIE_SECURE
  const sessionCookieSecure =
    sessionCookieSecureOverride !== undefined
      ? sessionCookieSecureOverride === 'true'
      : authUrl.startsWith('https://')

  const githubOauth =
    toml.features?.github_oauth ?? env.GITHUB_OAUTH === 'true'
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
        }
      : undefined

  const googleOauth = toml.features?.google_oauth === true
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        }
      : undefined

  const mailFrom = env.MAIL_FROM
  const mailTransportUrl = env.MAIL_TRANSPORT_URL
  const mail =
    mailFrom && mailTransportUrl
      ? { from: mailFrom, transportUrl: mailTransportUrl }
      : undefined

  const raw: unknown = {
    appId,
    appName,
    appLogo,

    port: parseInt(env.PORT ?? '3000', 10),
    host: env.HOST ?? '0.0.0.0',
    staticDir: env.STATIC_DIR ?? null,

    databaseUrl,
    stores,

    cors: {
      origins: corsOrigins,
      credentials: true as const,
    },

    bodyLimit: parseInt(env.BODY_LIMIT_BYTES ?? String(SIXTEEN_MB), 10),
    logLevel: env.LOG_LEVEL ?? 'info',
    rateLimit: parseRateLimitOverrides(env.RATE_LIMIT_OVERRIDES_JSON),
    security: {
      csp: {
        enabled: cspEnabled,
        upgradeInsecureRequests: cspUpgradeInsecureRequests,
      },
    },

    encryption: {
      workspaceSettingsKey: encryptionKey,
    },

    auth: {
      secret: authSecret,
      url: authUrl,
      github,
      google,
      mail,
      sessionTtlSeconds: parseInt(
        env.SESSION_TTL_SECONDS ?? String(THIRTY_DAYS_SECONDS),
        10,
      ),
      sessionCookieSecure,
    },

    features: {
      githubOauth: githubOauth && github !== undefined,
      googleOauth: googleOauth && google !== undefined,
      invitesEnabled: toml.features?.invites_enabled ?? true,
      sendWelcomeEmail: env.SEND_WELCOME_EMAIL !== 'false',
      ...(toml.features?.invite_ttl_days != null && { inviteTtlDays: toml.features.invite_ttl_days }),
    },
  }

  const config = validateConfig(raw)
  if (!config.auth.mail) return config

  return {
    ...config,
    auth: {
      ...config.auth,
      mail: {
        ...config.auth.mail,
        from: normalizeMailFrom(config.appName, config.auth.mail.from),
      },
    },
  }
}

export function validateConfig(raw: unknown): CoreConfig {
  const result = coreConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((i) => ({
        message: i.message,
        path: i.path.map((p) => (typeof p === 'number' ? p : String(p))),
      })),
    )
  }
  return result.data as CoreConfig
}

export function isGoogleOauthUsable(config: Pick<CoreConfig, 'features' | 'auth'>): boolean {
  return config.features.googleOauth && config.auth.google !== undefined
}

export function buildRuntimeConfigPayload(config: CoreConfig): RuntimeConfig {
  return {
    appId: config.appId,
    appName: config.appName,
    appLogo: config.appLogo,
    apiBase: config.auth.url,
    features: {
      githubOauth: config.features.githubOauth,
      googleOauth: isGoogleOauthUsable(config),
      invitesEnabled: config.features.invitesEnabled,
      sendWelcomeEmail: config.features.sendWelcomeEmail,
      emailVerification: isCoreEmailVerificationEnabled(config),
    },
  }
}
