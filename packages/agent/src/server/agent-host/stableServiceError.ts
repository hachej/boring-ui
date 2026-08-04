import { ErrorCode } from '../../shared/error-codes'

export interface StableServiceErrorProjection {
  readonly statusCode: number
  readonly error: {
    readonly code: string
    readonly message: string
    readonly retryable?: boolean
  }
}

/** Preserve only explicitly stable service errors at read/pre-mutation HTTP boundaries. */
export function projectStableServiceError(error: unknown): StableServiceErrorProjection | undefined {
  if (!(error instanceof Error)) return undefined
  const candidate = error as Error & { code?: unknown; statusCode?: unknown; retryable?: unknown }
  const canonicalStatusCode = candidate.code === ErrorCode.enum.PAYMENT_REQUIRED ? 402 : undefined
  const statusCode = candidate.statusCode ?? canonicalStatusCode
  if (
    !ErrorCode.safeParse(candidate.code).success
    || typeof statusCode !== 'number'
    || !Number.isInteger(statusCode)
    || statusCode < 400
    || statusCode > 599
    || (candidate.retryable !== undefined && typeof candidate.retryable !== 'boolean')
  ) return undefined
  return {
    statusCode,
    error: {
      code: candidate.code as string,
      message: candidate.message,
      ...(candidate.retryable === undefined ? {} : { retryable: candidate.retryable }),
    },
  }
}
