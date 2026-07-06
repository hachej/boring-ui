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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStructuralProvisioningError(error: unknown): ProvisioningError | null {
  if (!isRecord(error)) return null
  const code = ErrorCode.safeParse(error.code)
  if (!code.success) return null
  const message = error instanceof Error ? error.message : `Workspace provisioning failed with ${code.data}`
  const details = isRecord(error.details) ? error.details : {}
  return new ProvisioningError(code.data, message, details, error)
}

export function toProvisioningError(
  code: ErrorCodeValue,
  phase: string,
  error: unknown,
  details: Record<string, unknown> = {},
): ProvisioningError {
  if (error instanceof ProvisioningError) return error
  const structural = toStructuralProvisioningError(error)
  if (structural) return structural
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
