import { noopTelemetry, type TelemetryEvent, type TelemetrySink } from '../../shared/telemetry.js'
import { telemetryEvents } from '../db/schema.js'
import type { Database } from '../db/index.js'

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

export interface CreateDatabaseTelemetryOptions {
  appId: string
  enabled?: boolean
}

export function createDatabaseTelemetryFromEnv(
  db: Database,
  options: { appId: string },
  env: NodeJS.ProcessEnv = process.env,
): TelemetrySink {
  if (env.BORING_TELEMETRY_ENABLED !== 'true') return noopTelemetry
  return createDatabaseTelemetry(db, { appId: options.appId, enabled: true })
}

export function createDatabaseTelemetry(
  db: Database,
  options: CreateDatabaseTelemetryOptions,
): TelemetrySink {
  if (options.enabled === false) return noopTelemetry

  return {
    capture(event: TelemetryEvent) {
      const eventName = sanitizeTelemetryEventName(event.name)
      if (!eventName) return

      const row = {
        appId: options.appId,
        eventName,
        distinctId: sanitizeTelemetryDistinctId(event.distinctId),
        properties: sanitizeTelemetryProperties(event.properties),
      }

      try {
        void Promise.resolve(db.insert(telemetryEvents).values(row)).catch(() => {})
      } catch {}
    },
  }
}

export function sanitizeTelemetryEventName(value: string): string | undefined {
  if (value.length > 128) return undefined
  if (SUSPICIOUS_STRING_PATTERN.test(value)) return undefined
  return EVENT_NAME_PATTERN.test(value) ? value : undefined
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
