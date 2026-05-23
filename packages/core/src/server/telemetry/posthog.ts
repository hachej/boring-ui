import { PostHog } from 'posthog-node'

import { noopTelemetry, type TelemetryEvent, type TelemetrySink } from '../../shared/telemetry.js'

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/

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
      const properties = sanitizeTelemetryProperties(event.properties)
      if (project) properties.boringProject = project
      properties.eventName = event.name

      try {
        posthog.capture({
          distinctId: event.distinctId ?? 'anonymous',
          event: project ? `${project}.${event.name}` : event.name,
          properties,
        })
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

export function sanitizeTelemetryProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, SafeTelemetryProperty> {
  const sanitized: Record<string, SafeTelemetryProperty> = {}
  if (!properties) return sanitized

  for (const [key, value] of Object.entries(properties)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue
    if (!isSafeTelemetryProperty(value)) continue
    sanitized[key] = value
  }

  return sanitized
}

function isSafeTelemetryProperty(value: unknown): value is SafeTelemetryProperty {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}
