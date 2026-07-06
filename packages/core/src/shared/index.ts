export type {
  CoreConfig,
  RuntimeConfig,
  MemberRole,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceRuntime,
  SessionPayload,
  SessionState,
  RateLimitEndpointOverride,
  JsonValue,
  CoreCapabilities,
  CapabilitiesResponse,
} from './types.js'

export {
  ERROR_CODES,
  HttpError,
  ConfigFetchError,
  ConfigValidationError,
} from './errors.js'
export type { ErrorCode } from './errors.js'

export { noopTelemetry, safeCapture } from './telemetry.js'
export type { TelemetryEvent, TelemetrySink } from './telemetry.js'

export {
  canUseProtectedApi,
  isCoreEmailVerificationEnabled,
  isRuntimeEmailVerificationEnabled,
} from './authPolicy.js'

export {
  isSafeInternalPath,
  normalizeOutreachTargetPath,
  resolveWorkspaceTargetPath,
  sanitizeOutreachTargetPath,
} from './outreach/paths.js'
