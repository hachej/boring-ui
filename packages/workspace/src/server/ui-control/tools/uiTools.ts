/**
 * Workspace-side LLM tool factories that wrap the in-memory WorkspaceBridge.
 *
 * These tools used to live inside `@hachej/boring-agent`'s standardCatalog under
 * a conditional `if (workspaceBridge) {...}` branch. They moved here because the
 * tools encode workspace-specific concerns (UI state shape, command kinds
 * like `openFile` / `openPanel`) — `@hachej/boring-agent` is now a pure tool
 * harness with no UI knowledge. Hosts that want UI-aware agent tools
 * use `createWorkspaceAgentServer` (which closes over a bridge instance and
 * registers these factories), or pass the result of `createWorkspaceUiTools`
 * via `createAgentApp({ extraTools })` if they prefer hand-wiring.
 */
import { stat } from "node:fs/promises"
import { resolve, isAbsolute, relative, win32 } from "node:path"
import type { AgentTool, ToolResult } from "../../../shared/types/agent-tool"
import type { WorkspaceBridge, UiCommand, UiState } from "../../../shared/ui-bridge"

function makeError(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  }
}

export interface ExecUiToolOptions {
  /**
   * Workspace root used to validate paths in path-bearing commands
   * (`openFile`, `expandToFile`, `navigateToLine`). When provided, the
   * tool stat-checks the resolved path before queueing the UI command and
   * returns an error to the agent if the file is missing or escapes the
   * root — so the model gets immediate feedback instead of the frontend
   * silently no-op'ing on a wrong path. When omitted (for example, remote
   * sandbox filesystems the host cannot stat), path syntax is still validated
   * but existence is left to the frontend/remote filesystem.
   */
  workspaceRoot?: string
  /**
   * Optional workspace-backed stat hook for modes where the host path is not
   * directly stat-able (for example remote sandboxes). When provided, path-
   * bearing UI commands can still reject missing paths and convert folders to
   * file-tree reveal commands.
   */
  resolvePathKind?: (relPath: string) => Promise<"file" | "dir" | null>
  /**
   * After dispatching a state-changing command (openFile, openPanel,
   * openSurface, closePanel), wait this many ms before the first state
   * read. Set to 0 to disable verification entirely. Defaults to 250ms.
   */
  verifyDelayMs?: number
  /**
   * How many additional state reads to attempt after the first if the
   * expected change hasn't appeared yet. Defaults to 20 (~5s total).
   */
  verifyRetries?: number
  /**
   * Milliseconds between retry state reads. Defaults to 250ms.
   */
  verifyIntervalMs?: number
}

const PATH_BEARING_KINDS = new Set(["openFile", "expandToFile", "navigateToLine"])

function getPathParam(kind: string, params: Record<string, unknown>): string | undefined {
  const raw = kind === "navigateToLine" ? params.file : params.path
  return typeof raw === "string" && raw.length > 0 ? raw : undefined
}

function isPathAbsolute(filePath: string): boolean {
  return isAbsolute(filePath) || win32.isAbsolute(filePath)
}

function isOutsideWorkspaceRel(rel: string): boolean {
  return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isPathAbsolute(rel)
}

function validatePathSyntax(
  relPath: string,
  workspaceRoot?: string,
): { ok: true } | { ok: false; reason: string } {
  const rootHint = workspaceRoot ? ` (${workspaceRoot})` : ""
  if (isPathAbsolute(relPath)) {
    return {
      ok: false,
      reason: `path "${relPath}" is absolute — pass a path relative to the workspace root${rootHint}.`,
    }
  }
  if (relPath.includes("\0")) {
    return { ok: false, reason: `path "${relPath}" contains a null byte.` }
  }
  if (relPath.split(/[\\/]+/).includes("..")) {
    return {
      ok: false,
      reason: `path "${relPath}" escapes the workspace root${rootHint}.`,
    }
  }
  return { ok: true }
}

async function validateExistingPath(
  workspaceRoot: string,
  relPath: string,
): Promise<{ ok: true; kind: "file" | "dir" } | { ok: false; reason: string }> {
  const syntax = validatePathSyntax(relPath, workspaceRoot)
  if (!syntax.ok) return syntax
  const resolved = resolve(workspaceRoot, relPath)
  const rel = relative(workspaceRoot, resolved)
  if (isOutsideWorkspaceRel(rel)) {
    return {
      ok: false,
      reason: `path "${relPath}" escapes the workspace root (${workspaceRoot}).`,
    }
  }
  try {
    const fileStat = await stat(resolved)
    return { ok: true, kind: fileStat.isDirectory() ? "dir" : "file" }
  } catch {
    return {
      ok: false,
      reason: `file not found at "${relPath}" (relative to workspace root ${workspaceRoot}). Try find or grep to locate the file before retrying openFile.`,
    }
  }
}

export function createGetUiStateTool(workspaceBridge: WorkspaceBridge): AgentTool {
  return {
    name: "get_ui_state",
    readinessRequirements: ["ui-bridge"],
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
        const state = await workspaceBridge.getState()
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

// Commands that mutate workbench tab state — verified via getState() after dispatch.
const VERIFIABLE_KINDS = new Set(["openFile", "openPanel", "openSurface", "closePanel"])

type UiTab = { id: string; params?: Record<string, unknown> }

function isVerified(
  kind: string,
  params: Record<string, unknown>,
  state: UiState | null,
): boolean {
  if (!state) return false
  const tabs = (state.openTabs as UiTab[] | undefined) ?? []
  if (kind === "openFile") {
    const path = typeof params.path === "string" ? params.path : null
    return path !== null && tabs.some((t) => t.params?.path === path)
  }
  if (kind === "openPanel") {
    const id = typeof params.id === "string" ? params.id : null
    return id !== null && tabs.some((t) => t.id === id)
  }
  if (kind === "closePanel") {
    const id = typeof params.id === "string" ? params.id : null
    return id !== null && !tabs.some((t) => t.id === id)
  }
  // openSurface: tab id is resolver-dependent — treat any state as verified
  return true
}

export function createExecUiTool(
  workspaceBridge: WorkspaceBridge,
  opts: ExecUiToolOptions = {},
): AgentTool {
  const { workspaceRoot, resolvePathKind } = opts
  const verifyDelayMs = opts.verifyDelayMs ?? 250
  const verifyRetries = opts.verifyRetries ?? 20
  const verifyIntervalMs = opts.verifyIntervalMs ?? 250
  return {
    name: "exec_ui",
    readinessRequirements: ["ui-bridge"],
    description: [
      "Execute a UI command in the workspace. Use this to open files, panels,",
      "navigate to lines, or show notifications.",
      "",
      "CRITICAL: When the user asks for a concrete UI action (open/show/",
      "focus/navigate), execute it immediately via exec_ui. Do not ask a",
      "confirmation question first unless the target is genuinely ambiguous",
      "or unsafe.",
      "",
      "CRITICAL: When the user asks to open / show / display / navigate to a",
      "file, ALWAYS call exec_ui openFile. Never skip the call based on",
      "conversation history OR get_ui_state output — even if openTabs already",
      "lists the file. State can drift (the user may have closed the tab,",
      "the persisted state may be stale, the tab may not be focused). Calling",
      "openFile when the file is already open is idempotent: it focuses the",
      "tab. Saying \"already opened\" without calling the tool is a bug — the",
      "user explicitly requested an action; honor it.",
      "",
      "Supported `kind` values:",
      "",
      "  openFile     params: { path: string, mode?: 'view'|'edit'|'diff' }",
      "               — Open a file in the workbench. The workbench pane",
      "                 auto-opens if collapsed. Path must be relative to the",
      "                 workspace root (e.g. `src/foo.ts`, not `foo.ts` if it",
      "                 lives under src/).",
      "                 Recovery on file-not-found: when the server has local",
      "                 filesystem access, this tool stat-checks the path and",
      "                 returns an error if it doesn't exist. On that error,",
      "                 immediately call find (or grep) to locate the file,",
      "                 then call exec_ui openFile AGAIN using the EXACT path",
      "                 returned — don't give up and don't switch to the read",
      "                 tool. Repeat until openFile succeeds or no candidate",
      "                 is found.",
      "                 If the path is a folder, openFile reveals/selects it in",
      "                 the file tree instead of opening an editor tab.",
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
      "  openSurface  params: { kind: string, target: string, meta?: object }",
      "               — Open an app-owned target through the workspace",
      "                 surface resolver registry. Use this when the app",
      "                 defines the mapping from domain target to panel",
      "                 component, for example a catalog row.",
      "                 Example: {kind:'openSurface', params:{",
      "                          kind:'catalog.open-row',",
      "                          target:'orders_daily',",
      "                          meta:{catalogId:'data-catalog'}}}",
      "",
      "  closePanel   params: { id: string }",
      "  closeWorkbenchLeftPane params: {}",
      "               — Hide the workbench's left sources/files pane while",
      "                 keeping the workbench itself open.",
      "  navigateToLine params: { file: string, line: number }",
      "  expandToFile params: { path: string }",
      "  showNotification params: { msg: string, level?: 'info'|'warn'|'error' }",
      "",
      "Returns { seq, status, uiState? }. For openFile / openPanel / openSurface /",
      "closePanel the response includes a `uiState` snapshot after waiting up",
      "to a few seconds for the browser to dispatch the command — check",
      "uiState.openTabs to confirm the action took effect.",
      "If the expected tab is missing from openTabs the frontend silently",
      "rejected the command (unknown panel component, unregistered surface",
      "resolver, or disconnected browser). For other kinds only { seq, status }",
      "is returned. To open a FILE prefer openFile (path-aware) over openPanel",
      "(which is for non-file panes like charts).",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [
            "openFile",
            "openPanel",
            "openSurface",
            "closePanel",
            "closeWorkbenchLeftPane",
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

      const cmdParams = (params as Record<string, unknown> | undefined) ?? {}

      if (kind === "openSurface") {
        if (typeof cmdParams.kind !== "string" || cmdParams.kind.length === 0) {
          return makeError("openSurface: kind param is required")
        }
        if (typeof cmdParams.target !== "string" || cmdParams.target.length === 0) {
          return makeError("openSurface: target param is required")
        }
        if (
          cmdParams.meta !== undefined &&
          (typeof cmdParams.meta !== "object" ||
            cmdParams.meta === null ||
            Array.isArray(cmdParams.meta))
        ) {
          return makeError("openSurface: meta must be an object when provided")
        }
      }

      // Validate path-bearing kinds before queueing so the agent gets
      // immediate feedback rather than the frontend silently no-op'ing on a
      // malformed path. In remote modes workspaceRoot may be omitted because
      // the host cannot stat the microVM filesystem; still enforce relative,
      // non-traversing paths, and only stat-check when a local root is known.
      let effectiveKind = kind

      if (PATH_BEARING_KINDS.has(kind)) {
        const relPath = getPathParam(kind, cmdParams)
        if (!relPath) {
          return makeError(
            `${kind}: ${kind === "navigateToLine" ? "file" : "path"} param is required`,
          )
        }
        const syntax = validatePathSyntax(relPath, workspaceRoot)
        if (!syntax.ok) return makeError(syntax.reason)
        if (workspaceRoot) {
          const check = await validateExistingPath(workspaceRoot, relPath)
          if (!check.ok) {
            return makeError(check.reason)
          }
          if (kind === "openFile" && check.kind === "dir") {
            effectiveKind = "expandToFile"
          }
        } else if (resolvePathKind) {
          const pathKind = await resolvePathKind(relPath)
          if (!pathKind) {
            return makeError(`file not found at "${relPath}". Try find or grep to locate the file before retrying openFile.`)
          }
          if (kind === "openFile" && pathKind === "dir") {
            effectiveKind = "expandToFile"
          }
        }
      }

      try {
        const command: UiCommand = { kind: effectiveKind, params: cmdParams }
        const result = await workspaceBridge.emitUiEffect(command)
        if (result.status === "error") {
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            isError: true,
            details: result,
          }
        }

        // For state-changing commands, poll for the frontend's updated state
        // (pushed back via PUT /api/v1/ui/state after dockview fires
        // onDidAddPanel/onDidRemovePanel). Retry up to verifyRetries times so
        // slow renders or network jitter don't produce stale snapshots.
        if (verifyDelayMs > 0 && VERIFIABLE_KINDS.has(effectiveKind)) {
          await new Promise<void>((r) => setTimeout(r, verifyDelayMs))
          let uiState = await workspaceBridge.getState()
          for (let i = 0; i < verifyRetries; i++) {
            if (uiState === null || isVerified(effectiveKind, cmdParams, uiState)) break
            await new Promise<void>((r) => setTimeout(r, verifyIntervalMs))
            uiState = await workspaceBridge.getState()
          }
          const combined = { ...result, uiState }
          return {
            content: [{ type: "text", text: JSON.stringify(combined) }],
            details: combined,
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
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
 * `extraTools`. `createWorkspaceAgentServer` calls this internally; hosts that
 * want manual control can use it directly:
 *
 *   const bridge = createInMemoryBridge()
 *   const app = await createAgentApp({
 *     extraTools: createWorkspaceUiTools(bridge),
 *   })
 *   await app.register(uiRoutes, { bridge })
 */
export function createWorkspaceUiTools(
  workspaceBridge: WorkspaceBridge,
  opts: ExecUiToolOptions = {},
): AgentTool[] {
  return [createGetUiStateTool(workspaceBridge), createExecUiTool(workspaceBridge, opts)]
}
