export const OBJECTIVE_ERROR_CODES = {
  NOT_FOUND: "OBJECTIVE_NOT_FOUND",
  VALIDATION_INVALID: "OBJECTIVE_VALIDATION_INVALID",
  REVISION_CONFLICT: "OBJECTIVE_REVISION_CONFLICT",
  IDEMPOTENCY_CONFLICT: "OBJECTIVE_IDEMPOTENCY_CONFLICT",
  PATH_ESCAPE: "OBJECTIVE_PATH_ESCAPE",
  TOO_LARGE: "OBJECTIVE_TOO_LARGE",
  LOCK_TIMEOUT: "OBJECTIVE_LOCK_TIMEOUT",
  STORE_CORRUPT: "OBJECTIVE_STORE_CORRUPT",
  STORE_IO: "OBJECTIVE_STORE_IO",
  CONFIG_INVALID: "OBJECTIVE_CONFIG_INVALID",
} as const

export type ObjectiveErrorCode = (typeof OBJECTIVE_ERROR_CODES)[keyof typeof OBJECTIVE_ERROR_CODES]

export const OBJECTIVE_ERROR_CODE_VALUES = Object.values(OBJECTIVE_ERROR_CODES) as ObjectiveErrorCode[]

/** Every Objective failure carries a stable code registered in Agent's canonical ErrorCode enum. */
export class ObjectiveError extends Error {
  constructor(
    public readonly code: ObjectiveErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
