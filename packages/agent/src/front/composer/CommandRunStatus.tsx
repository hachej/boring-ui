/**
 * Server slash-command run status banner. Rendered above the composer in the
 * same slot and through the same shared `ComposerStatusBanner` as the
 * `/reload` banner (`PluginUpdateStatus`) — server commands like
 * `/open-<plugin>` report progress in the status bar, not in the chat
 * transcript.
 *
 * Surfaces:
 *  - "running"  — accent pulse, while /api/v1/agent/commands/execute is in flight.
 *  - "success"  — green accent with an optional detail line (e.g. "ran in 12ms");
 *    auto-dismisses like the reload success banner.
 *  - "error"    — red accent with the failure reason and a dismiss button.
 */
import { useEffect, useRef, type ReactElement } from "react"
import { ComposerStatusBanner } from "./ComposerStatusBanner"

export type CommandRunState =
  | { kind: "running"; command: string }
  | { kind: "success"; command: string; detail?: string }
  | { kind: "error"; command: string; message: string }

export interface CommandRunStatusProps {
  state: CommandRunState | null
  onDismiss: () => void
  /** Auto-dismiss clean success banners. Set to 0 to disable. */
  successAutoDismissMs?: number
  /** Width class supplied by ChatPanel so the banner matches the composer. */
  maxWidthClassName?: string
}

export function CommandRunStatus({
  state,
  onDismiss,
  successAutoDismissMs = 1400,
  maxWidthClassName = "max-w-3xl",
}: CommandRunStatusProps): ReactElement | null {
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  const successKey = state?.kind === "success" ? `${state.command}:${state.detail ?? ""}` : null
  useEffect(() => {
    if (!state || state.kind !== "success" || successAutoDismissMs <= 0) return
    const timeout = window.setTimeout(() => onDismissRef.current(), successAutoDismissMs)
    return () => window.clearTimeout(timeout)
  }, [state?.kind, successKey, successAutoDismissMs])

  if (!state) return null

  if (state.kind === "running") {
    return (
      <ComposerStatusBanner
        tone="running"
        dataAttribute="data-boring-command-run"
        maxWidthClassName={maxWidthClassName}
        runningContent={
          <>
            Running <code className="font-mono">/{state.command}</code>…
          </>
        }
      />
    )
  }

  if (state.kind === "success") {
    return (
      <ComposerStatusBanner
        tone="success"
        dataAttribute="data-boring-command-run"
        maxWidthClassName={maxWidthClassName}
        title={
          <>
            Ran <code className="font-mono">/{state.command}</code>
          </>
        }
        detail={state.detail}
        onDismiss={onDismiss}
        dismissAriaLabel="Dismiss command status"
      />
    )
  }

  return (
    <ComposerStatusBanner
      tone="error"
      dataAttribute="data-boring-command-run"
      maxWidthClassName={maxWidthClassName}
      title={
        <>
          <code className="font-mono">/{state.command}</code> failed.
        </>
      }
      message={state.message}
      onDismiss={onDismiss}
      dismissAriaLabel="Dismiss command status"
    />
  )
}
