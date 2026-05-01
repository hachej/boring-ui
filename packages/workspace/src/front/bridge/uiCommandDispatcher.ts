/**
 * Pure dispatch logic for agent → frontend UI commands.
 *
 * Kept in its own module (no fetch, no EventSource, no React) so it can
 * be exercised in isolation by tests and re-used by both the SSE and
 * polling transports in `uiCommandStream.ts`.
 */
import type { SurfaceShellApi, OpenPanelConfig } from "../chrome/artifact-surface/SurfaceShell"
import type { UiCommand } from "./types"
import type { SurfaceOpenRequest } from "../../shared/types/surface"

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
  "openSurface",
  "openPanel",
  "navigateToLine",
  "expandToFile",
  "showNotification",
  "closePanel",
  "closeWorkbenchLeftPane",
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

function surfaceRequestParam(params: Record<string, unknown>): SurfaceOpenRequest | null {
  const kind = strParam(params, "kind")
  const target = strParam(params, "target")
  if (!kind || !target) return null
  return {
    kind,
    target,
    meta: recordParam(params, "meta"),
  }
}

const SURFACE_READY_RETRY_FRAMES = 60

function runWhenSurfaceReady(
  ctx: DispatchContext,
  run: (surface: SurfaceShellApi) => void,
  attempts = SURFACE_READY_RETRY_FRAMES,
): void {
  const surface = ctx.surface()
  if (surface) {
    run(surface)
    return
  }
  if (!ctx.isWorkbenchOpen() || attempts <= 0) return
  requestAnimationFrame(() => runWhenSurfaceReady(ctx, run, attempts - 1))
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

  switch (cmd.kind) {
    case "openFile": {
      const path = strParam(cmd.params, "path")
      if (!path) return
      const wasClosed = !ctx.isWorkbenchOpen()
      if (wasClosed) ctx.openWorkbench()
      const run = (surface: SurfaceShellApi) => {
        try {
          surface.openFile(path)
        } catch (err) {
          // eslint-disable-next-line no-console -- intentional dev signal
          console.warn(
            `[uiCommandDispatcher] openFile dispatch failed:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
      // If the workbench was just opened, dockview hasn't laid out yet.
      // Then keep polling the getter for a few frames because opening the
      // surface is React stateful: the handle does not exist until the
      // SurfaceShell mounts and calls onReady.
      if (wasClosed) requestAnimationFrame(() => requestAnimationFrame(() => runWhenSurfaceReady(ctx, run)))
      else runWhenSurfaceReady(ctx, run)
      return
    }
    case "openSurface": {
      const request = surfaceRequestParam(cmd.params)
      if (!request) return
      const wasClosed = !ctx.isWorkbenchOpen()
      if (wasClosed) ctx.openWorkbench()
      const run = (surface: SurfaceShellApi) => {
        try {
          surface.openSurface(request)
        } catch (err) {
          // eslint-disable-next-line no-console -- intentional dev signal
          console.warn(
            `[uiCommandDispatcher] openSurface dispatch failed:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
      if (wasClosed) requestAnimationFrame(() => requestAnimationFrame(() => runWhenSurfaceReady(ctx, run)))
      else runWhenSurfaceReady(ctx, run)
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
      const run = (surface: SurfaceShellApi) => {
        try {
          surface.openPanel(cfg)
        } catch (err) {
          // eslint-disable-next-line no-console -- intentional dev signal
          console.warn(
            `[uiCommandDispatcher] openPanel dispatch failed:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
      if (wasClosed) requestAnimationFrame(() => requestAnimationFrame(() => runWhenSurfaceReady(ctx, run)))
      else runWhenSurfaceReady(ctx, run)
      return
    }
    case "closeWorkbenchLeftPane": {
      runWhenSurfaceReady(ctx, (surface) => surface.closeWorkbenchLeftPane())
      return
    }
  }
}
