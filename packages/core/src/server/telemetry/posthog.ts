import { PostHog } from 'posthog-node'

import { noopTelemetry, type TelemetryEvent, type TelemetrySink } from '../../shared/telemetry.js'

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*){0,8}$/
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const SAFE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/
const SAFE_STATUS_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_:-]{0,63}$/
const SAFE_PACKAGE_NAME_PATTERN = /^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]{1,96}$/
const SAFE_PACKAGE_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/
const SUSPICIOUS_STRING_PATTERN = /(?:secret|token|bearer|password|api[_-]?key|private|\.env|sk[_-](?:live|test)|ghp_|github_pat_|glpat-|xox[baprs]-|AKIA|ASIA|ya29\.|eyJ|phc_|npm_)/i

const ALLOWED_PROPERTY_KEYS = new Set([
  'workspaceId',
  'sessionId',
  'requestId',
  'runtimeMode',
  'modelProvider',
  'toolName',
  'panelId',
  'commandId',
  'status',
  'durationMs',
  'errorCode',
  'packageName',
  'packageVersion',
])

type SafeTelemetryProperty = string | number | boolean | null

export function createPostHogTelemetryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TelemetrySink {
  if (env.BORING_TELEMETRY_ENABLED !== 'true') return noopTelemetry

  const posthogKey = env.POSTHOG_KEY
  if (!posthogKey) {
    console.warn('PostHog telemetry is enabled but POSTHOG_KEY is missing; using noop telemetry.')
    return noopTelemetry
  }

  const posthog = new PostHog(posthogKey, {
    host: env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
  })
  const project = parseTelemetryProject(env.BORING_TELEMETRY_PROJECT)

  return {
    capture(event: TelemetryEvent) {
      const eventName = parseTelemetryEventName(event.name)
      if (!eventName) return

      const properties = sanitizeTelemetryProperties(event.properties)
      if (project) properties.boringProject = project
      properties.eventName = eventName

      try {
        void Promise.resolve(posthog.capture({
          distinctId: sanitizeTelemetryDistinctId(event.distinctId),
          event: project ? `${project}.${eventName}` : eventName,
          properties,
        })).catch(() => {})
      } catch {}
    },
    async flush() {
      await Promise.resolve(posthog.shutdown())
    },
  }
}

export function parseTelemetryProject(value: string | undefined): string | undefined {
  const project = value?.trim()
  if (!project) return undefined
  if (PROJECT_SLUG_PATTERN.test(project)) return project

  console.warn('BORING_TELEMETRY_PROJECT must be a lowercase slug; telemetry project prefix disabled.')
  return undefined
}

export function sanitizeTelemetryDistinctId(value: string | undefined): string {
  if (!value) return 'anonymous'
  return sanitizeTelemetryString('distinctId', value) ?? 'anonymous'
}

export function sanitizeTelemetryProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, SafeTelemetryProperty> {
  const sanitized: Record<string, SafeTelemetryProperty> = {}
  if (!properties) return sanitized

  for (const [key, value] of Object.entries(properties)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue
    const sanitizedValue = sanitizeTelemetryProperty(key, value)
    if (sanitizedValue === undefined) continue
    sanitized[key] = sanitizedValue
  }

  return sanitized
}

function parseTelemetryEventName(value: string): string | undefined {
  if (value.length > 128) return undefined
  if (SUSPICIOUS_STRING_PATTERN.test(value)) return undefined
  return EVENT_NAME_PATTERN.test(value) ? value : undefined
}

function sanitizeTelemetryProperty(key: string, value: unknown): SafeTelemetryProperty | undefined {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  return sanitizeTelemetryString(key, value)
}

function sanitizeTelemetryString(key: string, value: string): string | undefined {
  if (value.length === 0) return undefined
  if (SUSPICIOUS_STRING_PATTERN.test(value)) return undefined

  switch (key) {
    case 'workspaceId':
    case 'sessionId':
    case 'requestId':
    case 'distinctId':
      return SAFE_ID_PATTERN.test(value) ? value : undefined
    case 'runtimeMode':
    case 'modelProvider':
    case 'toolName':
    case 'panelId':
    case 'commandId':
      return SAFE_SLUG_PATTERN.test(value) ? value : undefined
    case 'status':
      return SAFE_STATUS_PATTERN.test(value) ? value : undefined
    case 'errorCode':
      return SAFE_ERROR_CODE_PATTERN.test(value) ? value : undefined
    case 'packageName':
      return SAFE_PACKAGE_NAME_PATTERN.test(value) ? value : undefined
    case 'packageVersion':
      return SAFE_PACKAGE_VERSION_PATTERN.test(value) ? value : undefined
    default:
      return undefined
  }
}
