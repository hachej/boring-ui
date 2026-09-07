import { createHmac } from 'node:crypto'

import type { TelemetrySink } from '@hachej/boring-agent/shared'
import type { SandboxProviderCreateContextV1 } from '../../shared/providerV1'
import { safeCapture } from '../runtimeSupport'

export interface VercelLifecycleLogger {
  info(message: string, metadata: Record<string, unknown>): void
  warn?(message: string, metadata?: Record<string, unknown>): void
}

const STABLE_ERROR_CODES = new Set([
  'CONFIG_INVALID', 'VERCEL_AUTH_FAILED', 'VERCEL_API_ERROR',
  'VERCEL_SANDBOX_NOT_FOUND', 'ENOENT', 'ETIMEDOUT', 'ECONNRESET',
])

export function telemetryDigest(value: string | undefined, salt?: string): string | undefined {
  if (!value || !salt) return undefined
  return createHmac('sha256', salt).update(value).digest('hex')
}

export function normalizedLifecycleErrorCode(error: unknown): string {
  const raw = (error as { code?: unknown } | null)?.code
  return typeof raw === 'string' && STABLE_ERROR_CODES.has(raw) ? raw : 'UNKNOWN'
}

function safeLifecycleProperties(
  input: Record<string, unknown>,
  salt?: string,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'errorCode') output.errorCode = normalizedLifecycleErrorCode({ code: value })
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) output[key] = value
    else if (typeof value === 'string' && ['phase', 'reason', 'sourceType', 'status'].includes(key)) {
      output[key] = /^[a-z0-9._-]{1,64}$/i.test(value) ? value : 'UNKNOWN'
    } else if (typeof value === 'string') output[`${key}Digest`] = telemetryDigest(value, salt)
  }
  return output
}

export function createRedactedLifecycleLogger(
  logger: VercelLifecycleLogger,
  telemetrySalt?: string,
): VercelLifecycleLogger {
  const properties = (metadata: Record<string, unknown> = {}): Record<string, unknown> =>
    safeLifecycleProperties(metadata, telemetrySalt)
  return {
    info(message, metadata) { logger.info(message, properties(metadata)) },
    warn(message, metadata) { logger.warn?.(message, properties(metadata)) },
  }
}

export function captureSandboxSetupEvent(
  telemetry: TelemetrySink | undefined,
  ctx: SandboxProviderCreateContextV1 | undefined,
  name: string,
  properties?: Record<string, unknown>,
): void {
  if (!telemetry) return
  const salt = (ctx as (SandboxProviderCreateContextV1 & { telemetrySalt?: string }) | undefined)?.telemetrySalt
  safeCapture(telemetry, {
    name,
    properties: {
      runtimeMode: 'vercel-sandbox',
      workspaceDigest: telemetryDigest(ctx?.workspaceId, salt),
      sessionDigest: telemetryDigest(ctx?.sessionId, salt),
      requestDigest: telemetryDigest(ctx?.requestId, salt),
      ...safeLifecycleProperties(properties ?? {}, salt),
    },
  })
}
