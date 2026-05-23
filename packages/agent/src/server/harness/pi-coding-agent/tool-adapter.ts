import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentTool, ToolResult } from "../../../shared/tool.js";
import { noopTelemetry, safeCapture, type TelemetrySink } from "../../../shared/telemetry.js";
import { ErrorCode } from "../../../shared/error-codes.js";

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

export function adaptToolForPi(tool: AgentTool, sessionId?: string, telemetry: TelemetrySink = noopTelemetry): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as any,
    promptSnippet: tool.promptSnippet ?? tool.description,
    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const startedAt = Date.now();
      let emittedFailure = false;
      try {
        const result = await tool.execute(params as Record<string, unknown>, {
          toolCallId,
          abortSignal: signal ?? new AbortController().signal,
          onUpdate: onUpdate
            ? (partial) => onUpdate({ content: [{ type: "text", text: partial }], details: undefined })
            : undefined,
          sessionId,
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
          throw new Error(result.content.map((c) => c.text).join("\n"));
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
): ToolDefinition[] {
  return tools.map((tool) => adaptToolForPi(tool, sessionId, telemetry));
}
