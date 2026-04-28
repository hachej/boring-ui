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
    description: [
      "Read the current workspace UI state. Returns a JSON object with:",
      "- workbenchOpen (boolean): is the right-side workbench pane visible?",
      "- drawerOpen (boolean): is the left-side sessions drawer visible?",
      "- openTabs (array): tabs currently open in the workbench, each with",
      "  { id, title, params }. params.path is the file path for file tabs.",
      "- activeTab (string|null): id of the currently focused tab.",
      "- activeFile (string|null): convenience — params.path of activeTab.",
      "- availablePanels (array of strings): every panel component the host",
      "  has registered. Use these names with exec_ui openPanel below.",
      "",
      "Call this BEFORE exec_ui openPanel to learn which `component` ids",
      "are valid for this app. Common built-ins: code-editor, markdown-editor,",
      "csv-viewer. Apps may register more (e.g. chart-canvas, series-viewer).",
    ].join("\n"),
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
    description: [
      "Execute a UI command in the workspace. Use this to open files, panels,",
      "navigate to lines, or show notifications. Supported `kind` values:",
      "",
      "  openFile     params: { path: string, mode?: 'view'|'edit'|'diff' }",
      "               — Open a file in the workbench. The workbench pane",
      "                 auto-opens if collapsed.",
      "                 Example: {kind:'openFile', params:{path:'README.md'}}",
      "",
      "  openPanel    params: { id: string, component: string,",
      "                         title?: string, params?: object }",
      "               — Open an app-specific panel. `component` MUST be one",
      "                 of the ids returned by get_ui_state's availablePanels.",
      "                 `id` is the tab instance id (re-use the same id to",
      "                 re-activate an existing tab; pick a unique id per",
      "                 distinct artifact). `params` is forwarded to the",
      "                 panel component.",
      "                 Example: {kind:'openPanel', params:{id:'chart:GDPC1',",
      "                          component:'chart-canvas',",
      "                          params:{seriesId:'GDPC1'}}}",
      "",
      "  closePanel   params: { id: string }",
      "  navigateToLine params: { file: string, line: number }",
      "  expandToFile params: { path: string }",
      "  showNotification params: { msg: string, level?: 'info'|'warn'|'error' }",
      "",
      "Returns { seq, status: 'ok' | 'error' }. The status is 'ok' as soon as",
      "the command is queued; actual UI dispatch happens asynchronously on",
      "the frontend. If openPanel's `component` isn't registered, the",
      "frontend logs an error to the dev console and the panel does not",
      "appear — call get_ui_state first to discover availablePanels and",
      "avoid that path. To open a FILE, prefer openFile (path-aware) over",
      "openPanel (which is for non-file panes like charts).",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [
            "openFile",
            "openPanel",
            "closePanel",
            "navigateToLine",
            "expandToFile",
            "showNotification",
          ],
        },
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
