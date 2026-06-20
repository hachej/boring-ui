import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeAuthContext,
  type BridgeCallerClass,
  type BridgeIdempotencyPolicy,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeError,
  type WorkspaceBridgeOperationDefinition,
} from "../../shared/workspace-bridge-rpc"
import type { WorkspaceBridge, UiCommand, CommandResult } from "../../shared/ui-bridge"

export interface WorkspaceBridgeCallContext extends BridgeAuthContext {
  requestId?: string
  signal?: AbortSignal
  emitUiEffect?: (cmd: UiCommand) => Promise<CommandResult>
}

export interface WorkspaceBridgeHandlerArgs<TInput = unknown> {
  input: TInput
  context: WorkspaceBridgeCallContext
  definition: WorkspaceBridgeOperationDefinition<TInput, unknown>
  signal: AbortSignal
  emitUiEffect?: WorkspaceBridge["emitUiEffect"]
}

export type WorkspaceBridgeHandler<TInput = unknown, TOutput = unknown> = (
  args: WorkspaceBridgeHandlerArgs<TInput>,
) => TOutput | Promise<TOutput>

export interface RegisterWorkspaceBridgeHandlerOptions {
  replace?: boolean
}

export interface WorkspaceBridgeRegistryLogger {
  debug?(message: string, fields?: Record<string, unknown>): void
  info?(message: string, fields?: Record<string, unknown>): void
  warn?(message: string, fields?: Record<string, unknown>): void
  error?(message: string, fields?: Record<string, unknown>): void
}

export interface WorkspaceBridgeRegistryOptions {
  logger?: WorkspaceBridgeRegistryLogger
}

interface RegisteredOperation {
  definition: WorkspaceBridgeOperationDefinition
  handler: WorkspaceBridgeHandler
}

export const RESERVED_WORKSPACE_BRIDGE_OP_PREFIXES = ["workspace-files.v1."] as const

const BRIDGE_CALLER_CLASSES = new Set<BridgeCallerClass>(["browser", "runtime", "server"])
const BRIDGE_IDEMPOTENCY_POLICIES = new Set<BridgeIdempotencyPolicy>(["none", "required", "request-id"])

export function validateWorkspaceBridgeOperationDefinition(
  definition: WorkspaceBridgeOperationDefinition,
): void {
  if (!definition || typeof definition !== "object") {
    throw invalidDefinition("WorkspaceBridge operation definition must be an object")
  }
  if (typeof definition.op !== "string" || definition.op.trim().length === 0) {
    throw invalidDefinition("WorkspaceBridge operation definition op must be a non-empty string")
  }
  const reservedPrefix = RESERVED_WORKSPACE_BRIDGE_OP_PREFIXES.find((prefix) => definition.op.startsWith(prefix))
  if (reservedPrefix) {
    throw invalidDefinition(`WorkspaceBridge operation ${definition.op} uses reserved prefix ${reservedPrefix}`)
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw invalidDefinition(`WorkspaceBridge operation ${definition.op} version must be a positive integer`)
  }
  if (typeof definition.owner !== "string" || definition.owner.trim().length === 0) {
    throw invalidDefinition(`WorkspaceBridge operation ${definition.op} owner must be a non-empty string`)
  }
  if (!Array.isArray(definition.callerClassesAllowed) || definition.callerClassesAllowed.length === 0) {
    throw invalidDefinition(`WorkspaceBridge operation ${definition.op} callerClassesAllowed must be a non-empty array`)
  }
  for (const callerClass of definition.callerClassesAllowed) {
    if (!BRIDGE_CALLER_CLASSES.has(callerClass)) {
      throw invalidDefinition(`WorkspaceBridge operation ${definition.op} callerClassesAllowed contains invalid caller class`)
    }
  }
  if (!Array.isArray(definition.requiredCapabilities)) {
    throw invalidDefinition(`WorkspaceBridge operation ${definition.op} requiredCapabilities must be an array`)
  }
  for (const capability of definition.requiredCapabilities) {
    if (typeof capability !== "string" || capability.trim().length === 0) {
      throw invalidDefinition(`WorkspaceBridge operation ${definition.op} requiredCapabilities must contain non-empty strings`)
    }
  }
  validateSchemaDefinition(definition.op, "inputSchema", definition.inputSchema, true)
  validateSchemaDefinition(definition.op, "outputSchema", definition.outputSchema, false)
  assertPositiveFiniteNumber(definition.op, "timeoutMs", definition.timeoutMs)
  assertPositiveFiniteNumber(definition.op, "maxInputBytes", definition.maxInputBytes)
  assertPositiveFiniteNumber(definition.op, "maxOutputBytes", definition.maxOutputBytes)
  if (!BRIDGE_IDEMPOTENCY_POLICIES.has(definition.idempotencyPolicy)) {
    throw invalidDefinition(`WorkspaceBridge operation ${definition.op} idempotencyPolicy is invalid`)
  }
}

function validateSchemaDefinition(
  op: string,
  field: "inputSchema" | "outputSchema",
  schema: unknown,
  required: boolean,
): void {
  if (schema === undefined) {
    if (required) throw invalidDefinition(`WorkspaceBridge operation ${op} ${field} is required`)
    return
  }
  if ((typeof schema !== "object" && typeof schema !== "function") || schema === null) {
    throw invalidDefinition(`WorkspaceBridge operation ${op} ${field} must be a schema object`)
  }
  if (hasSafeParse(schema)) return
  const type = (schema as { type?: unknown }).type
  if (!isSupportedJsonSchemaType(type)) {
    throw invalidDefinition(`WorkspaceBridge operation ${op} ${field}.type must be a supported JSON schema type`)
  }
}

function isSupportedJsonSchemaType(type: unknown): type is string {
  return type === "object"
    || type === "array"
    || type === "string"
    || type === "number"
    || type === "integer"
    || type === "boolean"
    || type === "null"
}

function hasSafeParse(schema: unknown): schema is { safeParse: (value: unknown) => { success: boolean; error?: { message?: string } } } {
  return (typeof schema === "object" || typeof schema === "function")
    && schema !== null
    && typeof (schema as { safeParse?: unknown }).safeParse === "function"
}

function assertPositiveFiniteNumber(op: string, field: "timeoutMs" | "maxInputBytes" | "maxOutputBytes", value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw invalidDefinition(`WorkspaceBridge operation ${op} ${field} must be a positive finite number`)
  }
}

function invalidDefinition(message: string): never {
  throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidRequest, message)
}

interface SchemaResult {
  success: boolean
  message?: string
}

export class WorkspaceBridgeRegistry {
  private readonly handlers = new Map<string, RegisteredOperation>()
  private readonly logger?: WorkspaceBridgeRegistryLogger

  constructor(options: WorkspaceBridgeRegistryOptions = {}) {
    this.logger = options.logger
  }

  registerHandler<TInput, TOutput>(
    definition: WorkspaceBridgeOperationDefinition<TInput, TOutput>,
    handler: WorkspaceBridgeHandler<TInput, TOutput>,
    options: RegisterWorkspaceBridgeHandlerOptions = {},
  ): void {
    validateWorkspaceBridgeOperationDefinition(definition as WorkspaceBridgeOperationDefinition)
    const existing = this.handlers.get(definition.op)
    if (existing && !options.replace) {
      throw createWorkspaceBridgeError(
        WorkspaceBridgeErrorCode.DuplicateOp,
        `WorkspaceBridge operation is already registered: ${definition.op}`,
      )
    }
    this.handlers.set(definition.op, {
      definition: definition as WorkspaceBridgeOperationDefinition,
      handler: handler as WorkspaceBridgeHandler,
    })
  }

  getDefinition(op: string): WorkspaceBridgeOperationDefinition | undefined {
    return this.handlers.get(op)?.definition
  }

  listDefinitions(): WorkspaceBridgeOperationDefinition[] {
    return Array.from(this.handlers.values(), ({ definition }) => definition)
  }

  async call<TInput = unknown, TOutput = unknown>(
    request: WorkspaceBridgeCallRequest<TInput>,
    context: WorkspaceBridgeCallContext,
  ): Promise<WorkspaceBridgeCallResponse<TOutput>> {
    const requestId = request.requestId ?? context.requestId ?? createRequestId()
    const registered = this.handlers.get(request.op)
    if (!registered) {
      return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.OpNotFound, "WorkspaceBridge operation is not registered")
    }

    const { definition, handler } = registered
    const logBase = {
      requestId,
      op: request.op,
      callerClass: context.callerClass,
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      pluginId: context.pluginId,
      tokenId: context.tokenId,
      capabilities: context.capabilities,
      actor: context.actor,
    }

    if (!definition.callerClassesAllowed.includes(context.callerClass)) {
      return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.CallerNotAllowed, "Caller class is not allowed for operation", logBase)
    }

    const missingCapability = definition.requiredCapabilities.find((capability) => !context.capabilities.includes(capability))
    if (missingCapability) {
      return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.CapabilityDenied, "Caller is missing a required capability", {
        ...logBase,
        missingCapability,
      })
    }

    const inputBytes = measureJsonBytes(request.input)
    if (inputBytes > definition.maxInputBytes) {
      return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.InputTooLarge, "Bridge input exceeds operation limit", {
        ...logBase,
        inputBytes,
        maxInputBytes: definition.maxInputBytes,
      })
    }

    const inputValidation = validateSchema(definition.inputSchema, request.input)
    if (!inputValidation.success) {
      return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.SchemaInvalid, "Bridge input failed schema validation", {
        ...logBase,
        schemaMessage: inputValidation.message,
      })
    }

    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(context.signal?.reason)
    if (context.signal?.aborted) abortFromCaller()
    else context.signal?.addEventListener("abort", abortFromCaller, { once: true })

    const timeoutResult = Symbol("workspace-bridge-timeout")
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      this.logger?.debug?.("workspace bridge call started", logBase)
      const handlerPromise = Promise.resolve().then(() => handler({
        input: request.input,
        context: { ...context, requestId },
        definition: definition as WorkspaceBridgeOperationDefinition<TInput, unknown>,
        signal: controller.signal,
        emitUiEffect: context.emitUiEffect,
      }))
      const timeoutPromise = new Promise<typeof timeoutResult>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort("timeout")
          resolve(timeoutResult)
        }, definition.timeoutMs)
      })
      const output = await Promise.race([handlerPromise, timeoutPromise])

      if (output === timeoutResult) {
        return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.Timeout, "Bridge handler timed out", logBase)
      }

      const outputValidation = definition.outputSchema
        ? validateSchema(definition.outputSchema, output)
        : { success: true }
      if (!outputValidation.success) {
        return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.OutputSchemaInvalid, "Bridge output failed schema validation", {
          ...logBase,
          schemaMessage: outputValidation.message,
        })
      }

      const outputBytes = measureJsonBytes(output)
      if (outputBytes > definition.maxOutputBytes) {
        return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.OutputTooLarge, "Bridge output exceeds operation limit", {
          ...logBase,
          outputBytes,
          maxOutputBytes: definition.maxOutputBytes,
        })
      }

      this.logger?.info?.("workspace bridge call completed", logBase)
      return { ok: true as const, op: request.op, requestId, output: output as TOutput }
    } catch (err) {
      if (controller.signal.aborted && controller.signal.reason === "timeout") {
        return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.Timeout, "Bridge handler timed out", logBase)
      }
      const bridgeError = isWorkspaceBridgeError(err) ? err : undefined
      this.logger?.error?.("workspace bridge call failed", {
        ...logBase,
        errorName: err instanceof Error ? err.name : typeof err,
        errorCode: bridgeError?.code,
      })
      return this.failure(request.op, requestId, bridgeError?.code ?? WorkspaceBridgeErrorCode.HandlerFailed, bridgeError?.message ?? "Bridge handler failed", logBase)
    } finally {
      if (timeout) clearTimeout(timeout)
      context.signal?.removeEventListener("abort", abortFromCaller)
    }
  }

  private failure(
    op: string,
    requestId: string,
    code: WorkspaceBridgeErrorCode,
    message: string,
    logFields?: Record<string, unknown>,
  ): WorkspaceBridgeCallResponse<never> {
    const error = createWorkspaceBridgeError(code, message)
    this.logger?.warn?.("workspace bridge call rejected", {
      ...logFields,
      op,
      requestId,
      errorCode: code,
    })
    return { ok: false, op, requestId, error }
  }
}

export function createWorkspaceBridgeRegistry(
  options: WorkspaceBridgeRegistryOptions = {},
): WorkspaceBridgeRegistry {
  return new WorkspaceBridgeRegistry(options)
}

const WORKSPACE_BRIDGE_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(WorkspaceBridgeErrorCode))

function isWorkspaceBridgeError(err: unknown): err is WorkspaceBridgeError {
  // Brand by canonical error-code membership so foreign thrown errors (Node
  // `ENOENT`, driver errors, store errors, etc.) are NOT surfaced
  // verbatim to callers — they fall through to a generic HANDLER_FAILED. This
  // keeps response.error.code a real WorkspaceBridgeErrorCode and avoids leaking
  // internal codes/messages across the bridge trust boundary.
  if (!err || typeof err !== "object") return false
  const candidate = err as { code?: unknown; message?: unknown }
  return (
    typeof candidate.code === "string" &&
    WORKSPACE_BRIDGE_ERROR_CODES.has(candidate.code) &&
    typeof candidate.message === "string"
  )
}

function validateSchema(schema: unknown, value: unknown): SchemaResult {
  if (schema === undefined) return { success: true }
  if (hasSafeParse(schema)) {
    const result = schema.safeParse(value)
    return result.success ? { success: true } : { success: false, message: result.error?.message }
  }
  if (typeof schema === "object" && schema !== null) {
    const type = (schema as { type?: unknown }).type
    return validateJsonSchemaType(type, value)
  }
  return { success: false, message: "Unsupported schema" }
}

function validateJsonSchemaType(type: unknown, value: unknown): SchemaResult {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? { success: true }
        : { success: false, message: "Expected object" }
    case "array":
      return Array.isArray(value) ? { success: true } : { success: false, message: "Expected array" }
    case "string":
      return typeof value === "string" ? { success: true } : { success: false, message: "Expected string" }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? { success: true } : { success: false, message: "Expected number" }
    case "integer":
      return Number.isInteger(value) ? { success: true } : { success: false, message: "Expected integer" }
    case "boolean":
      return typeof value === "boolean" ? { success: true } : { success: false, message: "Expected boolean" }
    case "null":
      return value === null ? { success: true } : { success: false, message: "Expected null" }
    default:
      return { success: false, message: "Unsupported schema type" }
  }
}

function measureJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function createRequestId(): string {
  return `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export type { WorkspaceBridgeError }
