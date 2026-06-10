import type { ErrorCode } from '../error-codes'

export interface ChatError {
  code: ErrorCode
  message: string
  retryable?: boolean
  details?: unknown
}
