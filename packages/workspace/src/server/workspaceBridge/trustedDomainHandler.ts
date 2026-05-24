import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeAuditCategory,
  type BridgeCallerClass,
  type BridgeIdempotencyPolicy,
  type WorkspaceBridgeOperationDefinition,
} from "../../shared/workspace-bridge-rpc"
import type { WorkspaceBridgeHandler } from "./registry"

const DEFAULT_RESERVED_OP_PREFIXES = ["workspace-files.v1."]
const VERSIONED_OP_PATTERN = /^[a-z][a-z0-9-]*\.v[1-9][0-9]*\.[a-z][a-z0-9.-]*$/

export interface TrustedDomainBridgeHandlerPolicy {
  /** Default true. Trusted app/domain ops should be versioned: domain.v1.action. */
  requireVersionedOp?: boolean
  /** Default rejects generic workspace file proxy surfaces. */
  reservedOpPrefixes?: readonly string[]
}

export interface TrustedDomainBridgeHandlerOptions<TInput = unknown, TOutput = unknown> {
  op: string
  version: number
  owner: string
  callerClassesAllowed: readonly BridgeCallerClass[]
  requiredCapabilities: readonly string[]
  inputSchema: unknown
  outputSchema?: unknown
  timeoutMs?: number
  maxInputBytes?: number
  maxOutputBytes: number
  idempotencyPolicy?: BridgeIdempotencyPolicy
  auditCategory: BridgeAuditCategory
  handler: WorkspaceBridgeHandler<TInput, TOutput>
  policy?: TrustedDomainBridgeHandlerPolicy
}

export interface TrustedDomainBridgeHandlerRegistration<TInput = unknown, TOutput = unknown> {
  definition: WorkspaceBridgeOperationDefinition<TInput, TOutput>
  handler: WorkspaceBridgeHandler<TInput, TOutput>
}

/**
 * Trusted-only helper for app/core/domain-owned WorkspaceBridge handlers.
 *
 * This is intentionally NOT a generated-plugin host-process handler API:
 * generated/runtime plugins must keep using sandbox/runtime SDK calls and must
 * not self-register arbitrary host handlers or Fastify routes.
 */
export function defineTrustedDomainBridgeHandler<TInput = unknown, TOutput = unknown>(
  options: TrustedDomainBridgeHandlerOptions<TInput, TOutput>,
): TrustedDomainBridgeHandlerRegistration<TInput, TOutput> {
  validateTrustedDomainMetadata(options)
  return {
    definition: {
      op: options.op,
      version: options.version,
      owner: options.owner,
      callerClassesAllowed: [...options.callerClassesAllowed],
      requiredCapabilities: [...options.requiredCapabilities],
      inputSchema: options.inputSchema,
      ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      timeoutMs: options.timeoutMs ?? 5_000,
      maxInputBytes: options.maxInputBytes ?? 64 * 1024,
      maxOutputBytes: options.maxOutputBytes,
      idempotencyPolicy: options.idempotencyPolicy ?? "none",
      auditCategory: options.auditCategory,
    },
    handler: options.handler,
  }
}

function validateTrustedDomainMetadata(options: TrustedDomainBridgeHandlerOptions<any, any>): void {
  if (!options || typeof options !== "object") {
    throw invalid("Trusted domain bridge handler metadata is required")
  }
  if (!options.op?.trim()) throw invalid("Trusted domain bridge handler op is required")
  if (!Number.isInteger(options.version) || options.version < 1) throw invalid("Trusted domain bridge handler version is required")
  if (!options.owner?.trim()) throw invalid("Trusted domain bridge handler owner is required")
  if (!Array.isArray(options.callerClassesAllowed) || options.callerClassesAllowed.length === 0) {
    throw invalid("Trusted domain bridge handler callerClassesAllowed is required")
  }
  if (!Array.isArray(options.requiredCapabilities)) throw invalid("Trusted domain bridge handler requiredCapabilities is required")
  if (options.inputSchema === undefined) throw invalid("Trusted domain bridge handler inputSchema is required")
  if (!options.auditCategory) throw invalid("Trusted domain bridge handler auditCategory is required")
  if (typeof options.handler !== "function") throw invalid("Trusted domain bridge handler function is required")
  if (!Number.isFinite(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
    throw invalid("Trusted domain bridge handler maxOutputBytes must be positive")
  }

  const policy = options.policy ?? {}
  const requireVersionedOp = policy.requireVersionedOp ?? true
  if (requireVersionedOp && !VERSIONED_OP_PATTERN.test(options.op)) {
    throw invalid("Trusted domain bridge handler op must be versioned as domain.v1.action")
  }
  const reservedPrefixes = policy.reservedOpPrefixes ?? DEFAULT_RESERVED_OP_PREFIXES
  const reservedPrefix = reservedPrefixes.find((prefix) => options.op.startsWith(prefix))
  if (reservedPrefix) {
    throw invalid(`Trusted domain bridge handler op uses reserved prefix ${reservedPrefix}`)
  }
}

function invalid(message: string): never {
  throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidRequest, message)
}
