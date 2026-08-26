import { ErrorCode } from "@hachej/boring-agent/shared"

export const RUNTIME_PREFIX = "[plugin-front-runtime]"

export interface PluginFrontRuntimeDiagnostic {
  level: "info" | "warn" | "error"
  prefix: typeof RUNTIME_PREFIX
  msg: string
  workspaceId?: string
  pluginId?: string
  revision?: number
  requestedPath?: string
  resolvedPath?: string
  stage:
    | "track"
    | "validate"
    | "resolve"
    | "cache"
    | "transform"
    | "serve"
    | "cleanup"
  outcome:
    | "tracked"
    | "cache-hit"
    | "cache-miss"
    | "served"
    | "rejected"
    | "disposed"
    | "closed"
  durationMs?: number
  code?: ErrorCode
  details?: Record<string, unknown>
}

export type RuntimeDiagnosticStage = PluginFrontRuntimeDiagnostic["stage"]

/** Emits a diagnostic entry; the runtime host binds this to `onDiagnostic`. */
export type EmitDiagnostic = (entry: Omit<PluginFrontRuntimeDiagnostic, "prefix">) => void

export function diagnostic(
  entry: Omit<PluginFrontRuntimeDiagnostic, "prefix">,
): PluginFrontRuntimeDiagnostic {
  return { prefix: RUNTIME_PREFIX, ...entry }
}

export class PluginFrontRuntimeError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    readonly stage: RuntimeDiagnosticStage,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export interface RuntimeApiError {
  statusCode: number
  body: { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } }
}

/** Request context used only to enrich the details of a non-runtime error. */
interface ApiErrorRequestContext {
  workspaceId?: string
  pluginId?: string
  revision?: number
  requestedPath?: string
}

export function toApiError(error: unknown, request?: ApiErrorRequestContext): RuntimeApiError {
  if (error instanceof PluginFrontRuntimeError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return {
    statusCode: 500,
    body: {
      error: {
        code: ErrorCode.enum.PLUGIN_RUNTIME_TRANSFORM_FAILED,
        message,
        ...(request
          ? { details: { workspaceId: request.workspaceId, pluginId: request.pluginId, revision: request.revision, path: request.requestedPath } }
          : {}),
      },
    },
  }
}
