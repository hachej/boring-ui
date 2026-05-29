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

function isWorkspaceBridgeError(err: unknown): err is WorkspaceBridgeError {
  return !!err && typeof err === "object" && "code" in err && "message" in err
}

function validateSchema(schema: unknown, value: unknown): SchemaResult {
  if (!schema) return { success: true }
  if (typeof schema === "object" && schema !== null && "safeParse" in schema) {
    const result = (schema as { safeParse: (value: unknown) => { success: boolean; error?: { message?: string } } }).safeParse(value)
    return result.success ? { success: true } : { success: false, message: result.error?.message }
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
