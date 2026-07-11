// Stable error-code constants for the remote worker HTTP wire protocol.
// Kept in a dedicated error-codes module so call sites reference the enum
// instead of raw string literals (grep-enforced invariant).
export const WORKER_ERROR_CODES = {
  AUTH_INVALID: 'auth_invalid',
  VALIDATION_ERROR: 'validation_error',
  INVALID_WORKSPACE_ID: 'invalid_workspace_id',
  NOT_IMPLEMENTED: 'not_implemented',
  EXEC_CONCURRENCY_LIMIT: 'exec_concurrency_limit',
  UNSUPPORTED_WORKSPACE_OP: 'unsupported_workspace_op',
} as const

export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[keyof typeof WORKER_ERROR_CODES]
