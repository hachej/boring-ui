/**
 * Workspace-side LLM tool factories that wrap the in-memory UiBridge.
 *
 * These tools used to live inside `@boring/agent`'s standardCatalog under
 * a conditional `if (uiBridge) {...}` branch. They moved here because the
 * tools encode workspace-specific concerns (UI state shape, command kinds
 * like `openFile` / `openPanel`) — `@boring/agent` is now a pure tool
 * harness with no UI knowledge. Hosts that want UI-aware agent tools
 * use `createWorkspaceAgentApp` (which closes over a bridge instance and
 * registers these factories), or pass the result of `createWorkspaceUiTools`
 * via `createAgentApp({ extraTools })` if they prefer hand-wiring.
 */
import type { AgentTool, ToolResult } from "@boring/agent/shared"
import type { UiBridge, UiCommand } from "../shared/ui-bridge"

function makeError(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  }
}

export function createGetUiStateTool(uiBridge: UiBridge): AgentTool {
  return {
    name: "get_ui_state",
    description:
      "Get the current UI state, including open panels and focused resources.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(): Promise<ToolResult> {
      try {
        const state = await uiBridge.getState()
        return {
          content: [{ type: "text", text: JSON.stringify(state ?? {}) }],
          details: state,
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "get_ui_state failed"
        return makeError(message)
      }
    },
  }
}

export function createExecUiTool(uiBridge: UiBridge): AgentTool {
  return {
    name: "exec_ui",
    description:
      "Execute a UI command by command kind and params via the UI bridge.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string" },
        params: { type: "object" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    async execute(input): Promise<ToolResult> {
      const kind = input.kind
      if (typeof kind !== "string" || kind.length === 0) {
        return makeError("kind is required")
      }

      const params = input.params
      if (
        params !== undefined &&
        (typeof params !== "object" || params === null || Array.isArray(params))
      ) {
        return makeError("params must be an object when provided")
      }

      try {
        const command: UiCommand = {
          kind,
          params: (params as Record<string, unknown> | undefined) ?? {},
        }
        const result = await uiBridge.postCommand(command)
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: result.status === "error",
          details: result,
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "exec_ui failed"
        return makeError(message)
      }
    },
  }
}

/**
 * Convenience: returns both UI tools as an `AgentTool[]` ready to merge into
 * `extraTools`. `createWorkspaceAgentApp` calls this internally; hosts that
 * want manual control can use it directly:
 *
 *   const bridge = createInMemoryBridge()
 *   const app = await createAgentApp({
 *     extraTools: createWorkspaceUiTools(bridge),
 *   })
 *   await app.register(uiRoutes, { bridge })
 */
export function createWorkspaceUiTools(uiBridge: UiBridge): AgentTool[] {
  return [createGetUiStateTool(uiBridge), createExecUiTool(uiBridge)]
}
