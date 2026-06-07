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
import { useEffect, useRef, type ReactElement } from "react"
import { AlertCircleIcon, XIcon } from "lucide-react"
import { cn } from "../lib"
import type { PluginRestartWarning } from "../../shared/agentPluginEvents"
import { noticeIconClass, noticeSurfaceClass, noticeTextClass } from "../chat/components/noticeStyles"

export type { PluginRestartWarning }

export type PluginReloadDiagnostic = {
  source?: string
  message?: string
  pluginId?: string
}

export type PluginUpdateState =
  | { kind: "running" }
  | { kind: "success"; reloaded: boolean; restartWarnings?: PluginRestartWarning[]; diagnostics?: PluginReloadDiagnostic[]; frontEvents?: PluginReloadDiagnostic[] }
  | { kind: "error"; message: string }

export interface PluginUpdateStatusProps {
  state: PluginUpdateState | null
  onDismiss: () => void
  onRetry: () => void
  /** Auto-dismiss clean success banners. Set to 0 to disable. */
  successAutoDismissMs?: number
  /** Width class supplied by ChatPanel so the banner matches the composer. */
  maxWidthClassName?: string
}

export function PluginUpdateStatus({
  state,
  onDismiss,
  onRetry,
  successAutoDismissMs = 1400,
  maxWidthClassName = "max-w-3xl",
}: PluginUpdateStatusProps): ReactElement | null {
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  const successDismissKey = state?.kind === "success"
    ? `${state.reloaded}:${(state.restartWarnings?.length ?? 0) > 0 || (state.diagnostics?.length ?? 0) > 0}`
    : null

  useEffect(() => {
    if (!state || state.kind !== "success" || successAutoDismissMs <= 0) return
    const hasWarningsOrDiagnostics = (state.restartWarnings?.length ?? 0) > 0 || (state.diagnostics?.length ?? 0) > 0
    if (hasWarningsOrDiagnostics) return
    const timeout = window.setTimeout(() => onDismissRef.current(), successAutoDismissMs)
    return () => window.clearTimeout(timeout)
  }, [state?.kind, successDismissKey, successAutoDismissMs])

  if (!state) return null

  if (state.kind === "running") {
    return (
      <div
        data-boring-plugin-update="running"
        role="status"
        aria-live="polite"
        className={cn(
          "mx-auto mb-2 w-full rounded-[var(--radius-md)] border border-accent/30 bg-[color:var(--accent-soft)]",
          "px-3 py-2 text-xs text-foreground flex items-center gap-2",
          maxWidthClassName,
        )}
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        <span>Updating plugins…</span>
      </div>
    )
  }

  if (state.kind === "success") {
    const warnings = state.restartWarnings ?? []
    const diagnostics = state.diagnostics ?? []
    const frontEvents = state.frontEvents ?? []
    const hasWarningsOrDiagnostics = warnings.length > 0 || diagnostics.length > 0
    const title = state.reloaded
      ? hasWarningsOrDiagnostics
        ? "Reload finished with warnings"
        : "Reload complete"
      : "Reload queued"
    const detail = state.reloaded
      ? hasWarningsOrDiagnostics
        ? "Some plugin changes need attention."
        : frontEvents.length > 0
          ? `${frontEvents.length} plugin module${frontEvents.length === 1 ? "" : "s"} refreshed. Changes are live.`
          : "Changes are live."
      : undefined
    return (
      <div
        data-boring-plugin-update="success"
        role="status"
        aria-live="polite"
        className={cn(
          "mx-auto mb-2 w-full rounded-[var(--radius-md)] border border-[oklch(0.78_0.13_148)]/35 bg-[oklch(0.95_0.05_148/0.28)]",
          "px-3 py-2 text-xs text-foreground shadow-sm",
          maxWidthClassName,
        )}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-[oklch(0.45_0.13_148)]" aria-hidden="true">✓</span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-5">{title}</span>
            {detail ? <span className="block leading-4 text-muted-foreground">{detail}</span> : null}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="-mr-1 rounded border border-transparent px-1.5 py-0.5 text-[13px] leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss plugin update status"
          >
            ×
          </button>
        </div>
        {diagnostics.length > 0 ? (
          <div
            data-boring-plugin-update-diagnostics=""
            className={cn(
              "mt-2 rounded border border-[oklch(0.78_0.15_85)]/40 bg-[oklch(0.95_0.06_85/0.4)]",
              "px-2 py-1.5 text-[11px] text-foreground",
            )}
          >
            <div className="flex items-center gap-1.5 font-medium text-[oklch(0.48_0.15_60)]">
              <span aria-hidden="true">⚠</span>
              <span>
                Reload diagnostics for {diagnostics.length} plugin{diagnostics.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-1 ml-4 list-disc text-foreground/85">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.pluginId ?? diagnostic.source ?? "plugin"}-${index}`}>
                  <code className="font-mono text-[10.5px]">{diagnostic.pluginId ?? diagnostic.source ?? "plugin"}</code> — {diagnostic.message ?? "reload diagnostic"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
      className={noticeSurfaceClass("error", cn("mx-auto mb-2 w-full text-xs", maxWidthClassName))}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircleIcon className={noticeIconClass("error", "size-3.5")} aria-hidden="true" />
        <span className="flex-1 font-medium">Plugin update failed.</span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded border border-destructive/25 px-2 py-0.5 text-[11px] font-medium hover:bg-destructive/10"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 -mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss plugin update status"
        >
          <XIcon className="size-3" aria-hidden="true" />
        </button>
      </div>
      <pre className={noticeTextClass("mt-2 text-[11px] text-muted-foreground")}>{state.message}</pre>
    </div>
  )
}
