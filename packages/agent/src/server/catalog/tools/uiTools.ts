import type { AgentTool, ToolResult } from "../../../shared/tool.js";
import type { UiBridge } from "../../../shared/ui-bridge.js";

export function createGetUiStateTool(bridge: UiBridge): AgentTool {
  return {
    name: "get_ui_state",
    description:
      "Read the current UI state — what the user is looking at (open files, active panels, theme, etc.).",
    parameters: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      const state = await bridge.getState();
      return {
        content: [
          { type: "text", text: JSON.stringify(state ?? {}, null, 2) },
        ],
      };
    },
  };
}

const ALLOWED_KINDS = [
  "openFile",
  "openPanel",
  "closePanel",
  "showNotification",
  "navigateToLine",
  "expandToFile",
] as const;

export function createExecUiTool(bridge: UiBridge): AgentTool {
  return {
    name: "exec_ui",
    description:
      "Dispatch a UI command (open a file, show a notification, navigate to a line, etc.).",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...ALLOWED_KINDS],
          description: "The command kind to dispatch.",
        },
        params: {
          type: "object",
          description: "Parameters for the command.",
        },
      },
      required: ["kind", "params"],
    },
    async execute(input): Promise<ToolResult> {
      const kind = input.kind as string;
      const params = (input.params as Record<string, unknown>) ?? {};
      const result = await bridge.postCommand({ kind, params });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              seq: result.seq,
              status: result.status,
            }),
          },
        ],
      };
    },
  };
}
