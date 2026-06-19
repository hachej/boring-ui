/**
 * In-process registry that lets a plugin's Pi slash command reach the live
 * workspace `UiBridge` WITHOUT an HTTP round-trip or a `BORING_UI_URL` env var.
 *
 * Why this exists
 * ---------------
 * A Pi extension slash-command handler only receives Pi's terminal-oriented
 * `ctx.ui` (notify/select/confirm). It has no concept of the boring-ui
 * workspace UI bridge, so the old canonical template resorted to
 * `fetch(BORING_UI_URL + "/api/v1/ui/commands")` — fragile, and it silently
 * no-op'd whenever the env var was unset (which is the common case). The bridge
 * is already an in-process object owned by the agent server, so the right thing
 * is to call `bridge.postCommand(...)` directly — the exact same path the
 * agent's `exec_ui` tool uses.
 *
 * Why globalThis
 * --------------
 * Hot-reloadable plugins are loaded by Pi through jiti, which keeps its own
 * module cache. A plain module-level singleton populated by the server is NOT
 * guaranteed to be the same instance the plugin imports. `globalThis` is shared
 * across every module realm in the process, so a `Symbol.for`-keyed slot is the
 * one storage that both the server and a jiti-loaded plugin observe identically.
 *
 * This module is browser-safe (only `globalThis` + types), so it can live on
 * the `@hachej/boring-workspace/plugin` authoring surface.
 */
import type { CommandResult, UiBridge, UiCommand } from "../ui-bridge"

const REGISTRY_KEY = Symbol.for("@hachej/boring-workspace:active-ui-bridge")

type GlobalWithBridge = typeof globalThis & {
  [REGISTRY_KEY]?: UiBridge | undefined
}

function slot(): GlobalWithBridge {
  return globalThis as GlobalWithBridge
}

/**
 * Publish the workspace `UiBridge` for the current process so plugin slash
 * commands can dispatch UI commands in-process. The agent server calls this
 * once per server instance (see `createWorkspaceAgentServer`). Returns an
 * unregister function — call it on server shutdown so a closed bridge is not
 * left dangling for the next server in the same process (eval harness, tests).
 */
export function registerWorkspaceUiBridge(bridge: UiBridge): () => void {
  slot()[REGISTRY_KEY] = bridge
  return () => {
    if (slot()[REGISTRY_KEY] === bridge) {
      slot()[REGISTRY_KEY] = undefined
    }
  }
}

/** The active workspace `UiBridge`, or `undefined` when none is registered. */
export function getWorkspaceUiBridge(): UiBridge | undefined {
  return slot()[REGISTRY_KEY]
}

/**
 * Thrown by the plugin-facing helpers when no workspace bridge is active — for
 * example when plugin code runs under a bare Pi CLI with no workspace UI
 * attached. The message is deliberately actionable.
 */
export class NoWorkspaceUiBridgeError extends Error {
  constructor() {
    super(
      "No workspace UI bridge is active. This plugin command must run inside a " +
        "boring-ui workspace agent (it cannot open panels from a bare Pi CLI).",
    )
    this.name = "NoWorkspaceUiBridgeError"
  }
}

function requireBridge(): UiBridge {
  const bridge = getWorkspaceUiBridge()
  if (!bridge) throw new NoWorkspaceUiBridgeError()
  return bridge
}

/**
 * Dispatch an arbitrary UI command through the active workspace bridge. This is
 * the same call the agent's `exec_ui` tool makes; the connected browser drains
 * the command. Prefer the named helpers below for common actions.
 */
export async function execWorkspaceUi(command: UiCommand): Promise<CommandResult> {
  return requireBridge().postCommand(command)
}

export interface OpenPanelArgs {
  /** Tab instance id. Reuse the same id to re-activate an existing tab. */
  id: string
  /** Panel component id (one of the workspace's registered panels). */
  component: string
  /** Optional params forwarded to the panel component. */
  params?: Record<string, unknown>
}

/**
 * Open an app/plugin panel in the workspace from a plugin slash command.
 * In-process — no URL, no env. Throws `NoWorkspaceUiBridgeError` if no bridge.
 */
export async function openPanel(args: OpenPanelArgs): Promise<CommandResult> {
  return execWorkspaceUi({
    kind: "openPanel",
    params: { id: args.id, component: args.component, params: args.params },
  })
}

/**
 * Show a workspace notification (toast) from a plugin slash command. Unlike
 * Pi's `ctx.ui.notify` (a terminal notification that is swallowed in
 * server/headless mode), this surfaces in the browser via the UI bridge.
 */
export async function notify(
  msg: string,
  level: "info" | "warn" | "error" = "info",
): Promise<CommandResult> {
  return execWorkspaceUi({ kind: "showNotification", params: { msg, level } })
}
