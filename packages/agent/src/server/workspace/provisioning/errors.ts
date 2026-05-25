import { ErrorCode, type ErrorCode as ErrorCodeValue } from '../../../shared/error-codes'

export type ProvisioningLogLevel = 'info' | 'warn' | 'error'

export interface ProvisioningLogger {
  info?(message: string, fields?: Record<string, unknown>): void
  warn?(message: string, fields?: Record<string, unknown>): void
  error?(message: string, fields?: Record<string, unknown>): void
}

export class ProvisioningError extends Error {
  readonly code: ErrorCodeValue
  readonly details: Record<string, unknown>

  constructor(
    code: ErrorCodeValue,
    message: string,
    details: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'ProvisioningError'
    this.code = code
    this.details = details
  }
}

export function toProvisioningError(
  code: ErrorCodeValue,
  phase: string,
  error: unknown,
  details: Record<string, unknown> = {},
): ProvisioningError {
  if (error instanceof ProvisioningError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ProvisioningError(
    code,
    `Workspace provisioning failed during ${phase}: ${message}`,
    { phase, ...details },
    error,
  )
}

export function logProvisioning(
  logger: ProvisioningLogger | undefined,
  level: ProvisioningLogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  logger?.[level]?.(message, fields)
}

export { ErrorCode }
