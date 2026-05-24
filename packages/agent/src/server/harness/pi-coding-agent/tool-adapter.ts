import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "../../../shared/tool.js";

const BORING_TOOL_ERROR_MARKER = '__boringToolError'

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

export function adaptToolForPi(tool: AgentTool, sessionId?: string): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as any,
    promptSnippet: tool.promptSnippet ?? tool.description,
    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const result = await tool.execute(params as Record<string, unknown>, {
        toolCallId,
        abortSignal: signal ?? new AbortController().signal,
        onUpdate: onUpdate
          ? (partial) => onUpdate({ content: [{ type: "text", text: partial }], details: undefined })
          : undefined,
        sessionId,
      });
      if (result.isError) {
        return {
          content: result.content,
          details: markToolResultErrorDetails(result.details),
        };
      }
      return {
        content: result.content,
        details: result.details,
      };
    },
  } as ToolDefinition;
}

export function adaptToolsForPi(tools: AgentTool[], sessionId?: string): ToolDefinition[] {
  return tools.map((tool) => adaptToolForPi(tool, sessionId));
}
