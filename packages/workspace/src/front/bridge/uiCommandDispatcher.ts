/**
 * Pure dispatch logic for agent → frontend UI commands.
 *
 * Kept in its own module (no fetch, no EventSource, no React) so it can
 * be exercised in isolation by tests and re-used by both the SSE and
 * polling transports in `uiCommandStream.ts`.
 */
import { SurfaceUnavailableError, type SurfaceShellApi, type OpenPanelConfig } from "../chrome/artifact-surface/SurfaceShell"
import type { UiCommand } from "./types"
import { normalizeUiFilesystem } from "../../shared/types/filesystem"
import type { SurfaceOpenRequest } from "../../shared/types/surface"

/**
 * Browser CustomEvent name dispatched on `window` when a `showNotification`
 * UI command is dispatched from the server. Keep in sync with
 * `WORKSPACE_COMMAND_NOTIFY_EVENT` in `@hachej/boring-agent/shared`.
 */
export const WORKSPACE_COMMAND_NOTIFY_EVENT = "boring-ui:command-notify"
export const WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT = "boring-workspace:surface-open-skipped"

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
  /** Open the workbench sources/file-tree pane. Must be a no-op when already open. */
  openWorkbenchSources?: () => void
  /** Close the workbench pane when a command opened it only for an ephemeral task. */
  closeWorkbench?: () => void
  /**
   * Park an op that couldn't run because the surface never mounted within the
   * retry budget (collapsed surface / warmup overlay). The host flushes parked
   * ops when the SurfaceShell next becomes ready. Without this the op is
   * silently dropped.
   */
  enqueue?: (run: (surface: SurfaceShellApi) => void) => void
  /** Retire and remount a surface whose imperative Dockview API stopped accepting operations. */
  recoverSurface?: (surface: SurfaceShellApi) => void
  /** Optional host policy hook for surface requests that are only relevant in a visible/open context. */
  shouldOpenSurface?: (request: SurfaceOpenRequest) => boolean
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

function notifySurfaceOpenSkipped(request: SurfaceOpenRequest): void {
  if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
    globalThis.dispatchEvent(new CustomEvent(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, { detail: request }))
  }
}

function surfaceRequestParam(params: Record<string, unknown>): SurfaceOpenRequest | null {
  const kind = strParam(params, "kind")
  const target = strParam(params, "target")
  if (!kind || !target) return null
  return {
    kind,
    target,
    filesystem: normalizeUiFilesystem(strParam(params, "filesystem")),
    meta: recordParam(params, "meta"),
  }
}

const SURFACE_READY_RETRY_FRAMES = 60

const surfaceRecoveryAttempts = new WeakMap<(surface: SurfaceShellApi) => void, number>()

function recoverUnavailableSurface(
  ctx: DispatchContext,
  surface: SurfaceShellApi,
  run: (surface: SurfaceShellApi) => void,
  error: unknown,
): boolean {
  if (!(error instanceof SurfaceUnavailableError) || !ctx.recoverSurface || !ctx.enqueue) return false
  const attempts = surfaceRecoveryAttempts.get(run) ?? 0
  if (attempts >= 1) return false
  surfaceRecoveryAttempts.set(run, attempts + 1)
  ctx.recoverSurface(surface)
  ctx.enqueue(run)
  return true
}

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
  if (!ctx.isWorkbenchOpen()) return
  if (attempts <= 0) {
    // Out of retry budget but the workbench is open and just hasn't mounted
    // its SurfaceShell yet (collapsed / warming up). Park the op so it replays
    // on surface ready instead of being silently dropped.
    ctx.enqueue?.(run)
    return
  }
  requestAnimationFrame(() => runWhenSurfaceReady(ctx, run, attempts - 1))
}

/**
 * Apply a single agent-issued UI command. Pure function: takes a command
 * + a context with the surface handle and returns nothing. Unknown kinds
 * are silently ignored — the agent and frontend can drift on supported
 * commands without breaking the chat. Known-but-unhandled kinds
 * (navigateToLine, showNotification, closePanel) are accepted-but-no-op
 * so the contract surface stays additive.
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
          surface.openFile(path, { filesystem: normalizeUiFilesystem(strParam(cmd.params, "filesystem")) })
        } catch (err) {
          if (recoverUnavailableSurface(ctx, surface, run, err)) return
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
      if (request.meta?.openOnlyWhenSessionOpen === true && !ctx.shouldOpenSurface) {
        notifySurfaceOpenSkipped(request)
        return
      }
      if (ctx.shouldOpenSurface?.(request) === false) {
        notifySurfaceOpenSkipped(request)
        return
      }
      const wasClosed = !ctx.isWorkbenchOpen()
      if (wasClosed) {
        request.meta = { ...(request.meta ?? {}), closeWorkbenchOnDone: true }
        ctx.openWorkbench()
      }
      const run = (surface: SurfaceShellApi) => {
        try {
          surface.openSurface(request)
        } catch (err) {
          if (recoverUnavailableSurface(ctx, surface, run, err)) return
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
          if (recoverUnavailableSurface(ctx, surface, run, err)) return
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
    case "expandToFile": {
      const path = strParam(cmd.params, "path")
      if (!path) return
      const wasClosed = !ctx.isWorkbenchOpen()
      if (wasClosed) ctx.openWorkbench()
      ctx.openWorkbenchSources?.()
      const run = (surface: SurfaceShellApi) => {
        try {
          surface.expandToFile(path)
        } catch (err) {
          // eslint-disable-next-line no-console -- intentional dev signal
          console.warn(
            `[uiCommandDispatcher] expandToFile dispatch failed:`,
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
    case "showNotification": {
      const msg = strParam(cmd.params, "msg")
      if (!msg) return
      const rawLevel = cmd.params?.level
      const level: "success" | "error" | "info" | "warn" =
        rawLevel === "error" ? "error" : rawLevel === "warn" ? "warn" : "info"
      const command = strParam(cmd.params, "command") ?? undefined
      if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
        globalThis.dispatchEvent(
          new CustomEvent(WORKSPACE_COMMAND_NOTIFY_EVENT, {
            detail: { message: msg, tone: level, command },
          }),
        )
      }
      return
    }
  }
}
