/**
 * Plugin update status banner. Rendered above the composer, immediately
 * before the attachment-notice slot. Driven by the `/reload` slash
 * command when the host wires `pluginUpdate` (see
 * slashCommands/builtins.ts and slashCommands/registry.ts).
 *
 * Surfaces:
 *  - "running"  — yellow-ish accent, while the /api/v1/agent/reload call
 *    is in flight.
 *  - "success"  — green-ish accent, with the reloaded plugin count, an
 *    optional amber "restart needed" sub-banner (when the response
 *    carried `restart_warnings`), and a dismiss button.
 *  - "error"    — red-ish accent, with the diagnostic message and a
 *    "Try again" button that re-runs `/reload`.
 */
import type { ReactElement } from "react"
import { cn } from "../lib"
import type { PluginRestartWarning } from "../../shared/agentPluginEvents"

export type { PluginRestartWarning }

export type PluginUpdateState =
  | { kind: "running" }
  | { kind: "success"; reloaded: boolean; restartWarnings?: PluginRestartWarning[] }
  | { kind: "error"; message: string }

export interface PluginUpdateStatusProps {
  state: PluginUpdateState | null
  onDismiss: () => void
  onRetry: () => void
}

export function PluginUpdateStatus({ state, onDismiss, onRetry }: PluginUpdateStatusProps): ReactElement | null {
  if (!state) return null

  if (state.kind === "running") {
    return (
      <div
        data-boring-plugin-update="running"
        role="status"
        aria-live="polite"
        className={cn(
          "mx-auto mb-2 w-full max-w-3xl rounded-[var(--radius-md)] border border-accent/30 bg-[color:var(--accent-soft)]",
          "px-3 py-2 text-xs text-foreground flex items-center gap-2",
        )}
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        <span>Updating plugins…</span>
      </div>
    )
  }

  if (state.kind === "success") {
    const warnings = state.restartWarnings ?? []
    return (
      <div
        data-boring-plugin-update="success"
        role="status"
        aria-live="polite"
        className={cn(
          "mx-auto mb-2 w-full max-w-3xl rounded-[var(--radius-md)] border border-[oklch(0.78_0.13_148)]/40 bg-[oklch(0.95_0.05_148/0.3)]",
          "px-3 py-2 text-xs text-foreground",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-[oklch(0.45_0.13_148)]" aria-hidden="true">✓</span>
          <span className="flex-1">
            {state.reloaded
              ? warnings.length > 0
                ? "Plugins partially updated."
                : "Plugins updated."
              : "Plugins will reload on the next message."}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded border border-transparent px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss plugin update status"
          >
            Dismiss
          </button>
        </div>
        {warnings.length > 0 ? (
          <div
            data-boring-plugin-update-restart-warning=""
            className={cn(
              "mt-2 rounded border border-[oklch(0.78_0.15_85)]/40 bg-[oklch(0.95_0.06_85/0.4)]",
              "px-2 py-1.5 text-[11px] text-foreground",
            )}
          >
            <div className="flex items-center gap-1.5 font-medium text-[oklch(0.48_0.15_60)]">
              <span aria-hidden="true">⚠</span>
              <span>
                Restart needed for {warnings.length} plugin{warnings.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-1 ml-4 list-disc text-foreground/85">
              {warnings.map((w) => (
                <li key={w.id}>
                  <code className="font-mono text-[10.5px]">{w.id}</code> — {w.surfaces.join(" + ")}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-foreground/70">
              The front bundle reloaded successfully, but routes and agent tools were wired at boot. Stop and restart the workspace process (Ctrl-C, then re-run your dev command) to pick up the new code.
            </p>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      data-boring-plugin-update="error"
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto mb-2 w-full max-w-3xl rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/10",
        "px-3 py-2 text-xs text-foreground",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-destructive" aria-hidden="true">⚠</span>
        <span className="flex-1 font-medium">Plugin update failed.</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-destructive/40 px-2 py-0.5 text-[11px] font-medium hover:bg-destructive/10"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-transparent px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss plugin update status"
        >
          Dismiss
        </button>
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-destructive/90">{state.message}</pre>
    </div>
  )
}
