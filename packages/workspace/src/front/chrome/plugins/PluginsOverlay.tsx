"use client"

import { Plug, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import type { CapturedFrontPlugin } from "../../../shared/plugins/frontFactory"
import { isWorkspacePagePlacement } from "../../../shared/types/panel"

export interface PluginsOverlayProps {
  /** Captured front plugins to list. */
  plugins: readonly CapturedFrontPlugin[]
  onClose: () => void
}

interface PanelSummary {
  id: string
  label?: string
  placement?: string
}

/**
 * Plugins overlay — hosted as a chat left overlay (not a workspace/workbench
 * panel). Lists the workspace's registered front plugins and the panels each
 * one contributes, so clicking "Plugins" in the app nav surfaces something
 * even when no plugin registers a workspace-page panel.
 */
export function PluginsOverlay({ plugins, onClose }: PluginsOverlayProps) {
  const sorted = [...plugins].sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id))
  return (
    <div data-boring-workspace-part="plugins-overlay" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
            <Plug className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">Plugins</h2>
            <p className="truncate text-xs text-muted-foreground">Front plugins registered in this workspace</p>
          </div>
        </div>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close plugins"
          title="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" strokeWidth={1.75} />
        </IconButton>
      </header>

      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4">
        {sorted.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-center text-sm text-muted-foreground">
            <div>
              <div className="font-medium text-foreground/80">No plugins registered</div>
              <p className="mt-1 max-w-xs">Register a front plugin to see it listed here.</p>
            </div>
          </div>
        ) : (
          <ul role="list" className="grid gap-2">
            {sorted.map((plugin) => {
              const panels: PanelSummary[] = plugin.registrations.panels.map((panel) => ({
                id: panel.id,
                label: panel.label,
                placement: panel.placement,
              }))
              return (
                <li
                  key={plugin.id}
                  className="rounded-xl border border-border/60 bg-card/70 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{plugin.label ?? plugin.id}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{plugin.id}</div>
                    </div>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {panels.length} panel{panels.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {panels.length > 0 ? (
                    <ul className="mt-2 space-y-1" role="list">
                      {panels.map((panel) => (
                        <li key={panel.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{panel.label ?? panel.id}</span>
                          {isWorkspacePagePlacement(panel.placement) ? (
                            <span className="shrink-0 rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              page
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}