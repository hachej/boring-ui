/**
 * Pure dispatch logic for agent → frontend UI commands.
 *
 * Kept in its own module (no fetch, no EventSource, no React) so it can
 * be exercised in isolation by tests and re-used by both the SSE and
 * polling transports in `uiCommandStream.ts`.
 */
import type { SurfaceShellApi, OpenPanelConfig } from "./SurfaceShell"

export interface UiCommand {
  v?: number
  seq?: number
  kind: string
  params: Record<string, unknown>
}

export interface DispatchContext {
  /**
   * Imperative handle to the workbench surface. Function (getter) so a
   * late SurfaceShell mount, or any later swap, is picked up without
   * restarting the transport. Returns null when the surface isn't ready.
   */
  surface: () => SurfaceShellApi | null
  /** Read the current open/closed state of the workbench pane. */
  isWorkbenchOpen: () => boolean
  /** Toggle the workbench pane open. Must be a no-op when already open. */
  openWorkbench: () => void
}

const KNOWN_KINDS = new Set([
  "openFile",
  "openPanel",
  "navigateToLine",
  "expandToFile",
  "showNotification",
  "closePanel",
])

function strParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function recordParam(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = params[key]
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

/**
 * Apply a single agent-issued UI command. Pure function: takes a command
 * + a context with the surface handle and returns nothing. Unknown kinds
 * are silently ignored — the agent and frontend can drift on supported
 * commands without breaking the chat. Known-but-unhandled kinds
 * (navigateToLine, expandToFile, showNotification, closePanel) are
 * accepted-but-no-op so the contract surface stays additive.
 */
export function dispatchUiCommand(cmd: UiCommand, ctx: DispatchContext): void {
  if (!KNOWN_KINDS.has(cmd.kind)) return
  const surface = ctx.surface()
  if (!surface) return

  switch (cmd.kind) {
    case "openFile": {
      const path = strParam(cmd.params, "path")
      if (!path) return
      const wasClosed = !ctx.isWorkbenchOpen()
      if (wasClosed) ctx.openWorkbench()
      const run = () => surface.openFile(path)
      // If the workbench was just opened, dockview hasn't laid out yet —
      // a double-RAF defers the openFile call until after the next paint
      // pair so the panel actually mounts. We branch on the BEFORE state
      // so a synchronously-applied openWorkbench (e.g. a test stub)
      // doesn't fool the dispatcher into skipping the defer.
      if (wasClosed) requestAnimationFrame(() => requestAnimationFrame(run))
      else run()
      return
    }
    case "openPanel": {
      const id = strParam(cmd.params, "id")
      const component = strParam(cmd.params, "component")
      if (!id || !component) return
      const cfg: OpenPanelConfig = {
        id,
        component,
        title: strParam(cmd.params, "title") ?? undefined,
        params: recordParam(cmd.params, "params"),
      }
      const wasClosed = !ctx.isWorkbenchOpen()
      if (wasClosed) ctx.openWorkbench()
      const run = () => surface.openPanel(cfg)
      if (wasClosed) requestAnimationFrame(() => requestAnimationFrame(run))
      else run()
      return
    }
  }
}
