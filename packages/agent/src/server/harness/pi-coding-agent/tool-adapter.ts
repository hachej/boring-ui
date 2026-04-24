import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "../../../shared/tool.js";

export function adaptToolForPi(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as any,
    // promptSnippet + promptGuidelines are what make custom tools visible
    // in pi's default system prompt. Without at least one of these, pi
    // skips the tool in the "Available tools" section and the model has
    // no idea the tool exists — it answers as if it can't call anything
    // and suggests running commands manually. We surface a minimal
    // snippet derived from the description so any consumer-supplied
    // AgentTool is announced to the model automatically.
    promptSnippet: `- \`${tool.name}\` — ${tool.description}`,
    promptGuidelines: [
      `Prefer the \`${tool.name}\` tool when the user asks for something it can do instead of writing instructions.`,
    ],
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
