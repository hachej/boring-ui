"use client"

import type { ReactNode } from "react"
import { ControlTooltip } from "../../components/ControlTooltip"
import { cn } from "../../lib/utils"

/**
 * One icon on the workbench activity rail.
 *
 * Structurally the subset of `WorkspaceLeftPaneAction` the rail actually
 * renders. Keeping it a plain shape (rather than importing the pane's own
 * action model) is what lets a host drive the rail from something that is not
 * the global workspace-source registry — an embedded workbench scoped to a
 * single job, for instance.
 */
export interface WorkbenchActivityRailEntry {
  id: string
  title: string
  icon: ReactNode
  /** The rail's own click state. */
  active?: boolean
  /** Accented only while the entry's content is the focused surface. */
  focused?: boolean
  select: () => void
  reloadAgentPlugins?: () => void | Promise<unknown>
}

export interface WorkbenchActivityRailProps {
  entries: readonly WorkbenchActivityRailEntry[]
  /** Which edge the rail sits on. Decides which side tooltips open toward. */
  side?: "left" | "right"
  /**
   * Host control pinned above the entries (collapse, close, …), followed by a
   * divider. `WorkbenchLeftPane` puts its collapse button here.
   */
  leading?: ReactNode
  className?: string
  "aria-label"?: string
}

/**
 * The workbench's icon rail.
 *
 * Extracted from `WorkbenchLeftPane`, which still renders it and is still the
 * only thing that renders it for the workspace sources case. It moved out so a
 * second, differently-fed workbench can present the SAME rail — same metrics,
 * same quiet grey, same instant tooltips, same accent rule — instead of a
 * lookalike that drifts.
 *
 * Workspace categories live on a quiet icon rail. The active category visually
 * connects to the content pane as one calm grey surface — same background on
 * the icon and the pane, bridged across the rail gutter, with no accent marker
 * or side stripe (see WORKSPACE_LEFT_NAV_UX_SPEC). Instant tooltips (no OS
 * hover delay) name the icon-only categories.
 */
export function WorkbenchActivityRail({
  entries,
  side = "left",
  leading,
  className,
  "aria-label": ariaLabel = "Workspace categories",
}: WorkbenchActivityRailProps) {
  const tooltipSide = side === "right" ? "left" : "right"
  return (
    <nav
      data-boring-workspace-part="workbench-activity-rail"
      data-boring-side={side}
      className={cn(
        "flex w-11 shrink-0 flex-col items-center gap-1 bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)] px-1.5 py-2",
        className,
      )}
      aria-label={ariaLabel}
    >
      {leading ? (
        <>
          <div
            className="workbench-rail-slot flex h-8 w-8 shrink-0 items-center justify-center"
            data-boring-workspace-part="workbench-host-control-slot"
          >
            {leading}
          </div>
          <span aria-hidden="true" className="my-1 h-px w-6 shrink-0 bg-border/70" />
        </>
      ) : null}
      {entries.map((entry) => (
        <ControlTooltip key={entry.id} label={entry.title} side={tooltipSide}>
          <button
            type="button"
            aria-label={entry.title}
            aria-pressed={entry.active}
            data-boring-workspace-rail-id={entry.id}
            onClick={entry.select}
            onContextMenu={(event) => {
              if (!entry.reloadAgentPlugins) return
              event.preventDefault()
              void entry.reloadAgentPlugins()
            }}
            className={cn(
              "workbench-rail-action relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
            // Inline (not arbitrary Tailwind classes) so it applies even when
            // the host's prebuilt CSS doesn't include these classes. Only an
            // actually open/focused plugin gets the accent chip; a remembered
            // selection in collapsed rail mode stays visually quiet so it does
            // not read as opened.
            style={entry.focused
              ? { color: "var(--accent)", backgroundColor: "color-mix(in oklch, var(--foreground) 10%, transparent)" }
              : undefined}
          >
            {entry.icon}
          </button>
        </ControlTooltip>
      ))}
    </nav>
  )
}
