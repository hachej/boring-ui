export interface ArcadeSharePointRuntimeConfig {
  apiKey: string
  defaultUserId?: string
  defaultProviderId: string
  baseUrl?: string
}

export interface ArcadeSharePointRuntimeConfigInput {
  apiKey?: string
  defaultUserId?: string
  defaultProviderId?: string
  baseUrl?: string
}

export const ARCADE_ENV_KEYS = {
  apiKey: "BORING_SHAREPOINT_ARCADE_API_KEY",
  defaultUserId: "BORING_SHAREPOINT_ARCADE_DEFAULT_USER_ID",
  defaultProviderId: "BORING_SHAREPOINT_ARCADE_PROVIDER_ID",
  baseUrl: "BORING_SHAREPOINT_ARCADE_BASE_URL",
} as const

const DEFAULT_PROVIDER_ID = "microsoft"
const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|secret)/i
const SECRET_VALUE_PATTERN = /Bearer\s+[A-Za-z0-9._~+/-]+=*|([?&#](access_token|refresh_token|id_token|authorization|cookie)=)[^\s&]+/i

export function loadArcadeSharePointRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ArcadeSharePointRuntimeConfigInput {
  return {
    apiKey: readOptionalEnv(env, ARCADE_ENV_KEYS.apiKey),
    defaultUserId: readOptionalEnv(env, ARCADE_ENV_KEYS.defaultUserId),
    defaultProviderId: readOptionalEnv(env, ARCADE_ENV_KEYS.defaultProviderId) ?? DEFAULT_PROVIDER_ID,
    baseUrl: readOptionalEnv(env, ARCADE_ENV_KEYS.baseUrl),
  }
}

export function requireArcadeSharePointRuntimeConfig(
  input: ArcadeSharePointRuntimeConfigInput = loadArcadeSharePointRuntimeConfig(),
): ArcadeSharePointRuntimeConfig {
  if (!input.apiKey) {
    throw new Error(`${ARCADE_ENV_KEYS.apiKey} is required to initialize SharePoint Arcade runtime`)
  }

  return {
    apiKey: input.apiKey,
    defaultUserId: input.defaultUserId,
    defaultProviderId: input.defaultProviderId ?? DEFAULT_PROVIDER_ID,
    baseUrl: input.baseUrl,
  }
}

export function redactArcadeSecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value.length <= 8) return "[REDACTED]"
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function redactArcadeConfigForLog(value: unknown): unknown {
  return redactUnknown(value)
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactUnknown(entry))
  if (typeof value === "string") return SECRET_VALUE_PATTERN.test(value) ? "[REDACTED]" : value
  if (!value || typeof value !== "object") return value

  const redacted: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactUnknown(nested)
  }
  return redacted
}

function readOptionalEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
