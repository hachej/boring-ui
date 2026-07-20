export const ERROR_CODES = {
  // Auth + session
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  WEAK_PASSWORD: 'weak_password',
  EMAIL_IN_USE: 'email_in_use',
  EMAIL_NOT_VERIFIED: 'email_not_verified',

  // Workspace membership
  NOT_MEMBER: 'not_member',
  LAST_OWNER: 'last_owner',
  INVALID_WORKSPACE_TYPE_ID: 'invalid_workspace_type_id',
  WORKSPACE_TYPE_IMMUTABLE: 'workspace_type_immutable',

  // Invites
  INVITE_NOT_FOUND: 'invite_not_found',
  INVITE_EXPIRED: 'invite_expired',
  INVITE_ALREADY_ACCEPTED: 'invite_already_accepted',
  INVITE_EMAIL_MISMATCH: 'invite_email_mismatch',
  INVITE_LOCKED: 'invite_locked',

  // Provisioning
  PROVISION_FAILED: 'provision_failed',
  DESTROY_FAILED: 'destroy_failed',
  RUNTIME_UNMANAGED: 'runtime_unmanaged',
  INVALID_RETRY_STATE: 'invalid_retry_state',

  // Validation + infra
  NOT_FOUND: 'not_found',
  VALIDATION_FAILED: 'validation_failed',
  CONFIG_VALIDATION_FAILED: 'config_validation_failed',
  CONFIG_FETCH_FAILED: 'config_fetch_failed',
  INVALID_AGENT_TYPE_ID: 'invalid_agent_type_id',
  INVALID_PRODUCT_HOSTNAME: 'invalid_product_hostname',
  DUPLICATE_PRODUCT_HOSTNAME: 'duplicate_product_hostname',
  INVALID_PRODUCT_DECLARATIONS: 'invalid_product_declarations',
  INVALID_PRODUCT_DEFAULT: 'invalid_product_default',
  PRODUCT_DECLARATION_BINDING_INVALID: 'product_declaration_binding_invalid',
  TYPED_DOMAIN_LEGACY_SCOPE_CONFLICT: 'typed_domain_legacy_scope_conflict',
  UNKNOWN_PRODUCT_HOSTNAME: 'unknown_product_hostname',
  RATE_LIMITED: 'rate_limited',
  MAIL_DISABLED: 'mail_disabled',
  DB_UNAVAILABLE: 'db_unavailable',
  INTERNAL_ERROR: 'internal_error',
  AGENT_HOST_SCOPE_VIOLATION: 'AGENT_HOST_SCOPE_VIOLATION',
  AGENT_HOST_ADMISSION_IDENTITY_MISMATCH: 'AGENT_HOST_ADMISSION_IDENTITY_MISMATCH',
  AGENT_HOST_ADMISSION_RECORD_FAILED: 'AGENT_HOST_ADMISSION_RECORD_FAILED',
  AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN: 'AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN',

  // Credits + purchases
  PAYMENT_REQUIRED: 'payment_required',
  INVALID_PACK: 'invalid_pack',
  CHECKOUT_FAILED: 'checkout_failed',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export class HttpError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly requestId?: string

  constructor(init: {
    status: number
    code: ErrorCode
    message: string
    requestId?: string
  }) {
    super(init.message)
    this.name = 'HttpError'
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId
  }
}

export class ConfigFetchError extends Error {
  readonly requestId?: string

  constructor(message: string, requestId?: string) {
    super(message)
    this.name = 'ConfigFetchError'
    this.requestId = requestId
  }
}

export class ConfigValidationError extends Error {
  readonly issues: Array<{ message: string; path: Array<string | number> }>

  constructor(
    issues: Array<{ message: string; path: Array<string | number> }>,
  ) {
    const summary = issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    super(`Config validation failed:\n${summary}`)
    this.name = 'ConfigValidationError'
    this.issues = issues
  }
}
