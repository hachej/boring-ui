import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { RunContext } from "../../../shared/harness.js";
import type { AgentTool, ToolResult } from "../../../shared/tool.js";
import { noopTelemetry, safeCapture, type TelemetrySink } from "../../../shared/telemetry.js";
import { ErrorCode } from "../../../shared/error-codes.js";

const BORING_TOOL_ERROR_MARKER = '__boringToolError'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function immutableClone(value: unknown): unknown {
  const cloned = structuredClone(value)
  const freeze = (input: unknown): unknown => {
    if (!input || typeof input !== 'object' || Object.isFrozen(input)) return input
    Object.freeze(input)
    for (const child of Object.values(input)) freeze(child)
    return input
  }
  return freeze(cloned)
}

function currentRunStructuredDetails(
  extensionContext: Parameters<ToolDefinition['execute']>[4] | undefined,
  allowedKinds: readonly string[] | undefined,
) {
  if (!extensionContext || !allowedKinds?.length) return undefined
  const allowed = new Set(allowedKinds)
  const entries = extensionContext.sessionManager.getBranch() as unknown[]
  let runStart = -1
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = record(entries[index])
    const message = record(entry?.message)
    if (entry?.type === 'message' && message?.role === 'user') {
      runStart = index
      break
    }
  }
  const details: Array<{ entryId: string; toolCallId?: string; toolName?: string; kind: string; detail: unknown }> = []
  for (const rawEntry of entries.slice(runStart + 1)) {
    const entry = record(rawEntry)
    const message = record(entry?.message)
    if (entry?.type !== 'message' || message?.role !== 'toolResult' || message.isError === true || typeof entry.id !== 'string') continue
    const root = record(message.details)
    const candidates = root ? [root, ...Object.values(root).map(record).filter((value): value is UnknownRecord => value !== null)] : []
    for (const candidate of candidates) {
      if (typeof candidate.kind !== 'string' || !allowed.has(candidate.kind)) continue
      try {
        details.push(Object.freeze({
          entryId: entry.id,
          ...(typeof message.toolCallId === 'string' ? { toolCallId: message.toolCallId } : {}),
          ...(typeof message.toolName === 'string' ? { toolName: message.toolName } : {}),
          kind: candidate.kind,
          detail: immutableClone(candidate),
        }))
      } catch {
        // Tool details are expected to be structured-cloneable. Ignore malformed
        // third-party details rather than exposing mutable native session state.
      }
    }
  }
  return Object.freeze(details)
}

export function markToolResultErrorDetails(details: unknown): Record<string, unknown> {
  return details && typeof details === 'object' && !Array.isArray(details)
    ? { ...(details as Record<string, unknown>), [BORING_TOOL_ERROR_MARKER]: true }
    : { [BORING_TOOL_ERROR_MARKER]: true, details }
}

export function unmarkToolResultErrorDetails(details: unknown): { isMarked: boolean; details: unknown } {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return { isMarked: false, details }
  const record = { ...(details as Record<string, unknown>) }
  if (record[BORING_TOOL_ERROR_MARKER] !== true) return { isMarked: false, details }
  delete record[BORING_TOOL_ERROR_MARKER]
  if (Object.keys(record).length === 1 && 'details' in record) return { isMarked: true, details: record.details }
  return { isMarked: true, details: record }
}

function toolTelemetryProperties(
  toolName: string,
  sessionId: string | undefined,
  status: 'ok' | 'error',
  startedAt: number,
  result?: ToolResult,
): Record<string, string | number> {
  const properties: Record<string, string | number> = {
    toolName,
    status,
    durationMs: Date.now() - startedAt,
  }
  if (sessionId) properties.sessionId = sessionId
  const errorCode = (result?.details as { code?: unknown } | undefined)?.code
  if (status === 'error') {
    properties.errorCode = ErrorCode.safeParse(errorCode).success
      ? (errorCode as string)
      : ErrorCode.enum.TOOL_EXECUTION_ERROR
  }
  return properties
}

export function adaptToolForPi(tool: AgentTool, sessionId?: string, telemetry: TelemetrySink = noopTelemetry, getRunContext?: () => RunContext | undefined): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as any,
    promptSnippet: tool.promptSnippet ?? tool.description,
    executionMode: tool.executionMode,
    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const startedAt = Date.now();
      let emittedFailure = false;
      try {
        const runContext = getRunContext?.();
        const result = await tool.execute(params as Record<string, unknown>, {
          toolCallId,
          abortSignal: signal ?? new AbortController().signal,
          onUpdate: onUpdate
            ? (partial) => onUpdate({ content: [{ type: "text", text: partial }], details: undefined })
            : undefined,
          sessionId,
          userId: runContext?.userId,
          userEmail: runContext?.userEmail,
          userEmailVerified: runContext?.userEmailVerified,
          workspaceId: runContext?.workspaceId,
          requestId: runContext?.requestId,
          currentRunStructuredDetails: currentRunStructuredDetails(_ctx, tool.currentRunDetailKinds),
        });
        safeCapture(telemetry, {
          name: result.isError ? 'agent.tool.failed' : 'agent.tool.completed',
          properties: toolTelemetryProperties(
            tool.name,
            sessionId,
            result.isError ? 'error' : 'ok',
            startedAt,
            result,
          ),
        });
        if (result.isError) {
          emittedFailure = true;
          return {
            content: result.content,
            details: markToolResultErrorDetails(result.details),
          };
        }
        return {
          content: result.content,
          details: result.details,
        };
      } catch (error) {
        if (!emittedFailure) {
          safeCapture(telemetry, {
            name: 'agent.tool.failed',
            properties: toolTelemetryProperties(tool.name, sessionId, 'error', startedAt),
          });
        }
        throw error;
      }
    },
  } as ToolDefinition;
}

export function adaptToolsForPi(
  tools: AgentTool[],
  sessionId?: string,
  telemetry?: TelemetrySink,
  getRunContext?: () => RunContext | undefined,
): ToolDefinition[] {
  return tools.map((tool) => adaptToolForPi(tool, sessionId, telemetry, getRunContext));
}
