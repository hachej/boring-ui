import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "../../../shared/tool.js";

export function adaptToolForPi(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as any,
    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const result = await tool.execute(params as Record<string, unknown>, {
        toolCallId,
        abortSignal: signal ?? new AbortController().signal,
        onUpdate: onUpdate
          ? (partial) => onUpdate({ content: [{ type: "text", text: partial }], details: undefined })
          : undefined,
      });
      if (result.isError) {
        throw new Error(result.content.map((c) => c.text).join("\n"));
      }
      return {
        content: result.content,
        details: result.details,
      };
    },
  } as ToolDefinition;
}

export function adaptToolsForPi(tools: AgentTool[]): ToolDefinition[] {
  return tools.map(adaptToolForPi);
}
