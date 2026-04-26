/**
 * Drains agent → frontend UI commands posted via /api/v1/ui/commands and
 * dispatches them to the workbench surface.
 *
 * The agent's `exec_ui` tool calls bridge.postCommand on the server-side
 * UiBridge, which appends to an in-memory queue. The frontend pulls that
 * queue with `GET /api/v1/ui/commands/next?poll=true` (poll mode — SSE is
 * supported too but poll is enough for the dev case) and applies each
 * command to the workbench via the SurfaceShellApi handle.
 *
 * The poller and the dispatcher are factored apart so the dispatcher can
 * be exercised in isolation by tests without spinning up a fetch mock.
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
   * Imperative handle to the workbench surface. Function (getter) so that a
   * late SurfaceShell mount, or any later swap, is picked up without
   * restarting the poller. Returns null when the surface isn't ready.
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
 * commands without breaking the chat.
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
      // If the workbench was just opened, dockview hasn't laid out yet — a
      // double-RAF defers the openFile call until after the next paint pair
      // so the panel actually mounts. Same pattern as the in-chat artifact
      // click. We branch on the BEFORE state so a synchronously-applied
      // openWorkbench (e.g. a test stub) doesn't fool the dispatcher into
      // skipping the defer.
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
    // Other kinds (navigateToLine, expandToFile, showNotification,
    // closePanel) are accepted-but-no-op for now — the contract is in
    // place but the surface doesn't expose handlers yet. Wiring is
    // additive: extend SurfaceShellApi when needed.
  }
}

export interface PollerOptions {
  /** Endpoint base — usually "" for same-origin (vite proxy forwards). */
  endpoint?: string
  /** Milliseconds between polls when no commands are returned. */
  intervalMs?: number
  /** Dispatch context. The surface is read on every fire so a late mount works. */
  ctx: DispatchContext
  /**
   * Optional fetch override — tests pass in a fake. Defaults to the global
   * fetch so production code doesn't need to inject anything.
   */
  fetcher?: typeof fetch
}

const DEFAULT_INTERVAL_MS = 1500

/**
 * Start a polling loop. Returns a cleanup function that stops the loop and
 * cancels any in-flight request. Safe to call from useEffect.
 */
export function startUiCommandPoller(opts: PollerOptions): () => void {
  const endpoint = opts.endpoint ?? ""
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const fetcher = opts.fetcher ?? fetch
  const ctx = opts.ctx

  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: AbortController | null = null

  async function tick(): Promise<void> {
    if (cancelled) return
    inflight = new AbortController()
    try {
      const res = await fetcher(`${endpoint}/api/v1/ui/commands/next?poll=true`, {
        signal: inflight.signal,
      })
      if (cancelled) return
      if (res.ok) {
        const body = (await res.json()) as unknown
        if (Array.isArray(body)) {
          for (const cmd of body) {
            if (cmd && typeof cmd === "object" && typeof (cmd as UiCommand).kind === "string") {
              dispatchUiCommand(cmd as UiCommand, ctx)
            }
          }
        }
      }
    } catch {
      /* Network blip — try again on next tick. */
    } finally {
      inflight = null
    }
    if (!cancelled) {
      timer = setTimeout(tick, intervalMs)
    }
  }

  // Kick off — fire-and-forget. The first tick may resolve before the next
  // microtask, but that's fine; we don't await it.
  void tick()

  return () => {
    cancelled = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (inflight) {
      inflight.abort()
      inflight = null
    }
  }
}
