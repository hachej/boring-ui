import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeAuthContext,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeError,
  type WorkspaceBridgeOperationDefinition,
} from "../../shared/workspace-bridge-rpc"
import type { WorkspaceBridge, UiCommand, CommandResult } from "../../shared/ui-bridge"
import {
  auditOutcomeForError,
  createWorkspaceBridgeRateLimitKey,
  type RateLimitPolicy,
  type WorkspaceBridgeAuditSink,
  type WorkspaceBridgeAuditEvent,
} from "./audit"

export interface WorkspaceBridgeCallContext extends BridgeAuthContext {
  requestId?: string
  resourceScope?: Record<string, unknown>
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
  auditSink?: WorkspaceBridgeAuditSink
  rateLimitPolicy?: RateLimitPolicy
}

interface RegisteredOperation {
  definition: WorkspaceBridgeOperationDefinition
  handler: WorkspaceBridgeHandler
}

interface SchemaResult {
  success: boolean
  message?: string
}

export class WorkspaceBridgeRegistry {
  private readonly handlers = new Map<string, RegisteredOperation>()
  private readonly logger?: WorkspaceBridgeRegistryLogger
  private readonly auditSink?: WorkspaceBridgeAuditSink
  private readonly rateLimitPolicy?: RateLimitPolicy

  constructor(options: WorkspaceBridgeRegistryOptions = {}) {
    this.logger = options.logger
    this.auditSink = options.auditSink
    this.rateLimitPolicy = options.rateLimitPolicy
  }

  registerHandler<TInput, TOutput>(
    definition: WorkspaceBridgeOperationDefinition<TInput, TOutput>,
    handler: WorkspaceBridgeHandler<TInput, TOutput>,
    options: RegisterWorkspaceBridgeHandlerOptions = {},
  ): void {
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
    const startedAt = Date.now()
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

    if (this.rateLimitPolicy) {
      const decision = await this.rateLimitPolicy.check({
        key: createWorkspaceBridgeRateLimitKey({
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          principalId: context.actor.performedBy?.id,
          pluginId: context.pluginId,
          runtimeId: context.tokenId,
          callerClass: context.callerClass,
          op: request.op,
        }),
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        principalId: context.actor.performedBy?.id,
        pluginId: context.pluginId,
        runtimeId: context.tokenId,
        callerClass: context.callerClass,
        op: request.op,
      })
      if (!decision.allowed) {
        return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.RateLimited, "Bridge caller is rate limited", logBase, startedAt, "denied")
      }
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

    if (definition.resourceScopeSchema) {
      const scopeValidation = validateSchema(definition.resourceScopeSchema, request.resourceScope ?? context.resourceScope)
      if (!scopeValidation.success) {
        return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.ResourceScopeDenied, "Bridge resource scope failed validation", {
          ...logBase,
          schemaMessage: scopeValidation.message,
        })
      }
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
      const response = { ok: true as const, op: request.op, requestId, output: output as TOutput }
      void this.emitAudit({ definition, context, requestId, outcome: "success", startedAt, inputBytes, outputBytes })
      return response
    } catch (err) {
      if (controller.signal.aborted && controller.signal.reason === "timeout") {
        return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.Timeout, "Bridge handler timed out", logBase)
      }
      this.logger?.error?.("workspace bridge call failed", {
        ...logBase,
        errorName: err instanceof Error ? err.name : typeof err,
      })
      return this.failure(request.op, requestId, WorkspaceBridgeErrorCode.HandlerFailed, "Bridge handler failed", logBase)
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
    startedAt?: number,
    rateLimitDecision?: "allowed" | "denied",
  ): WorkspaceBridgeCallResponse<never> {
    const error = createWorkspaceBridgeError(code, message)
    this.logger?.warn?.("workspace bridge call rejected", {
      ...logFields,
      op,
      requestId,
      errorCode: code,
    })
    if (logFields && "callerClass" in logFields && "workspaceId" in logFields) {
      void this.emitAudit({
        definition: this.handlers.get(op)?.definition,
        context: logFields as unknown as WorkspaceBridgeCallContext,
        requestId,
        outcome: auditOutcomeForError(code),
        error,
        startedAt,
        rateLimitDecision,
      })
    }
    return { ok: false, op, requestId, error }
  }

  private async emitAudit(args: {
    definition?: WorkspaceBridgeOperationDefinition
    context: WorkspaceBridgeCallContext
    requestId: string
    outcome: WorkspaceBridgeAuditEvent["outcome"]
    error?: WorkspaceBridgeError
    startedAt?: number
    inputBytes?: number
    outputBytes?: number
    rateLimitDecision?: "allowed" | "denied"
  }): Promise<void> {
    if (!this.auditSink || !args.definition) return
    await this.auditSink.emit({
      requestId: args.requestId,
      op: args.definition.op,
      workspaceId: args.context.workspaceId,
      sessionId: args.context.sessionId,
      callerClass: args.context.callerClass,
      actorKind: args.context.actor.actorKind,
      performedBy: args.context.actor.performedBy,
      onBehalfOf: args.context.actor.onBehalfOf,
      pluginId: args.context.pluginId,
      runtimeId: args.context.tokenId,
      capabilities: args.context.capabilities,
      capabilityDecision: args.error?.code === WorkspaceBridgeErrorCode.CapabilityDenied ? "denied" : "allowed",
      rateLimitDecision: args.rateLimitDecision ?? "allowed",
      outcome: args.outcome,
      error: args.error,
      durationMs: args.startedAt ? Date.now() - args.startedAt : undefined,
      inputBytes: args.inputBytes,
      outputBytes: args.outputBytes,
    })
  }
}

export function createWorkspaceBridgeRegistry(
  options: WorkspaceBridgeRegistryOptions = {},
): WorkspaceBridgeRegistry {
  return new WorkspaceBridgeRegistry(options)
}

function validateSchema(schema: unknown, value: unknown): SchemaResult {
  if (!schema) return { success: true }
  if (typeof schema === "object" && schema !== null && "safeParse" in schema) {
    const result = (schema as { safeParse: (value: unknown) => { success: boolean; error?: { message?: string } } }).safeParse(value)
    return result.success ? { success: true } : { success: false, message: result.error?.message }
  }
  if (typeof schema === "object" && schema !== null && "parse" in schema) {
    try {
      ;(schema as { parse: (value: unknown) => unknown }).parse(value)
      return { success: true }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "schema parse failed" }
    }
  }
  if (isSimpleJsonSchema(schema)) return validateSimpleJsonSchema(schema, value)
  return { success: true }
}

function isSimpleJsonSchema(schema: unknown): schema is { type?: string; required?: string[] } {
  return typeof schema === "object" && schema !== null && ("type" in schema || "required" in schema)
}

function validateSimpleJsonSchema(schema: { type?: string; required?: string[] }, value: unknown): SchemaResult {
  if (schema.type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
    return { success: false, message: "expected object" }
  }
  if (schema.type === "string" && typeof value !== "string") {
    return { success: false, message: "expected string" }
  }
  if (schema.type === "number" && typeof value !== "number") {
    return { success: false, message: "expected number" }
  }
  if (schema.required && typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const missing = schema.required.find((key) => !(key in record))
    if (missing) return { success: false, message: `missing required field: ${missing}` }
  }
  return { success: true }
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
