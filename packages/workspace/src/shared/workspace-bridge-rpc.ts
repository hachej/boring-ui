/**
 * Platform-neutral WorkspaceBridge RPC contracts.
 *
 * This file is imported by both browser and server bundles. Keep it free of
 * Node-only types/imports and keep stable bridge error codes centralized here.
 */

export type BridgeCallerClass = "browser" | "runtime" | "server"

export type BridgeActorKind = "human" | "agent" | "system" | "service"

export interface BridgeRedactedActorRef {
  /** Redacted, stable-enough label for logs/audit. Never a bearer token. */
  label: string
  /** Optional non-secret stable id when the auth adapter has one. */
  id?: string
}

export interface BridgeActorAttribution {
  actorKind: BridgeActorKind
  performedBy?: BridgeRedactedActorRef
  onBehalfOf?: BridgeRedactedActorRef
}

export interface BridgeAuthContext {
  callerClass: BridgeCallerClass
  workspaceId: string
  sessionId?: string
  pluginId?: string
  capabilities: readonly string[]
  actor: BridgeActorAttribution
  tokenId?: string
  expiresAt?: string
}

export type BridgeIdempotencyPolicy =
  | "none"
  | "required"
  | "request-id"
  | "tool-call-id"

export type BridgeAuditCategory =
  | "ui-effect"
  | "human-input"
  | "macro"
  | "runtime-sdk"
  | "system"
  | (string & {})

export interface WorkspaceBridgeOperationDefinition<
  TInput = unknown,
  TOutput = unknown,
> {
  op: string
  version: number
  owner: string
  callerClassesAllowed: readonly BridgeCallerClass[]
  requiredCapabilities: readonly string[]
  resourceScopeSchema?: unknown
  inputSchema: unknown
  outputSchema?: unknown
  timeoutMs: number
  maxInputBytes: number
  maxOutputBytes: number
  idempotencyPolicy: BridgeIdempotencyPolicy
  auditCategory: BridgeAuditCategory
  /** Type anchors only; no runtime value should be supplied. */
  readonly __inputType?: TInput
  readonly __outputType?: TOutput
}

export interface WorkspaceBridgeCallRequest<TInput = unknown> {
  op: string
  input: TInput
  requestId?: string
  idempotencyKey?: string
  resourceScope?: Record<string, unknown>
}

export interface WorkspaceBridgeCallSuccess<TOutput = unknown> {
  ok: true
  op: string
  requestId: string
  output: TOutput
}

export interface WorkspaceBridgeCallFailure {
  ok: false
  op: string
  requestId?: string
  error: WorkspaceBridgeError
}

export type WorkspaceBridgeCallResponse<TOutput = unknown> =
  | WorkspaceBridgeCallSuccess<TOutput>
  | WorkspaceBridgeCallFailure

export enum WorkspaceBridgeErrorCode {
  OpNotFound = "BRIDGE_OP_NOT_FOUND",
  DuplicateOp = "BRIDGE_DUPLICATE_OP",
  CallerNotAllowed = "BRIDGE_CALLER_NOT_ALLOWED",
  AuthRequired = "BRIDGE_AUTH_REQUIRED",
  CapabilityDenied = "BRIDGE_CAPABILITY_DENIED",
  ResourceScopeDenied = "BRIDGE_RESOURCE_SCOPE_DENIED",
  SchemaInvalid = "BRIDGE_SCHEMA_INVALID",
  OutputSchemaInvalid = "BRIDGE_OUTPUT_SCHEMA_INVALID",
  InputTooLarge = "BRIDGE_INPUT_TOO_LARGE",
  OutputTooLarge = "BRIDGE_OUTPUT_TOO_LARGE",
  Timeout = "BRIDGE_TIMEOUT",
  HandlerFailed = "BRIDGE_HANDLER_FAILED",
  IdempotencyRequired = "BRIDGE_IDEMPOTENCY_REQUIRED",
  IdempotencyConflict = "BRIDGE_IDEMPOTENCY_CONFLICT",
  ReplayRejected = "BRIDGE_REPLAY_REJECTED",
  ReplayDetected = "BRIDGE_REPLAY_DETECTED",
  RateLimited = "BRIDGE_RATE_LIMITED",
  InvalidToken = "BRIDGE_INVALID_TOKEN",
  ExpiredToken = "BRIDGE_EXPIRED_TOKEN",
  InvalidRequest = "BRIDGE_INVALID_REQUEST",
  TranscriptForbidden = "BRIDGE_TRANSCRIPT_FORBIDDEN",
  UiUnavailable = "BRIDGE_UI_UNAVAILABLE",
  UnsupportedRuntime = "BRIDGE_UNSUPPORTED_RUNTIME",
}

export interface WorkspaceBridgeError {
  code: WorkspaceBridgeErrorCode
  message: string
  details?: Record<string, unknown>
}

export function createWorkspaceBridgeError(
  code: WorkspaceBridgeErrorCode,
  message: string,
  details?: Record<string, unknown>,
): WorkspaceBridgeError {
  return details === undefined ? { code, message } : { code, message, details }
}

export interface WorkspaceBridgeFileAssetPointer {
  kind: "file-asset"
  /** Workspace-relative path validated by the Workspace adapter/file route. */
  path: string
  contentType: string
  byteLength?: number
  rawUrl?: string
}

export type WorkspaceBridgeJsonValue =
  | null
  | boolean
  | number
  | string
  | WorkspaceBridgeJsonValue[]
  | { [key: string]: WorkspaceBridgeJsonValue }

export interface WorkspaceBridgeAuditContext {
  requestId: string
  op: string
  workspaceId: string
  sessionId?: string
  callerClass: BridgeCallerClass
  actor: BridgeActorAttribution
  auditCategory: BridgeAuditCategory
  resourceScope?: Record<string, unknown>
}
