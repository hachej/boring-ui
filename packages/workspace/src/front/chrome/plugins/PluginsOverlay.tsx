"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plug, RefreshCw, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "../../agentPlugins/reloadEvent"
import { cn } from "../../lib/utils"
import { useWorkspacePluginClient } from "../../plugin/useWorkspacePluginClient"

export interface PluginsOverlayProps {
  onClose: () => void
  /** Reload external/runtime plugins. The host owns the exact session-aware
   *  reload payload; this overlay owns only the chrome. */
  onReloadExternalPlugins?: () => Promise<string | undefined> | string | undefined
  /** Reserve room for shell-level chrome that floats over collapsed app nav. */
  headerInsetStart?: boolean
  /** Reserve room for shell-level top-right controls floating over the overlay. */
  headerInsetEnd?: boolean
}

interface ExternalPluginEntry {
  id: string
  boring?: { id?: string; label?: string; front?: string | false; server?: string | false }
  version?: string
  revision?: number
  frontTarget?: { kind?: string; entryUrl?: string; revision?: number }
}

interface ExternalPluginEvent extends ExternalPluginEntry {
  type?: string
  replay?: boolean
  message?: string
}

type LoadState =
  | { status: "loading"; plugins: ExternalPluginEntry[]; error?: undefined }
  | { status: "ready"; plugins: ExternalPluginEntry[]; error?: undefined }
  | { status: "error"; plugins: ExternalPluginEntry[]; error: string }

function pluginLabel(plugin: ExternalPluginEntry): string {
  return plugin.boring?.label || plugin.boring?.id || plugin.id
}

function upsertPlugin(plugins: ExternalPluginEntry[], plugin: ExternalPluginEntry): ExternalPluginEntry[] {
  const next = plugins.filter((entry) => entry.id !== plugin.id)
  next.push(plugin)
  return next.sort((a, b) => pluginLabel(a).localeCompare(pluginLabel(b)))
}

/**
 * External plugins overlay — hosted as a chat overlay, not as a workbench panel.
 * Lists only runtime/external plugins; statically bundled app plugins (Deck,
 * Questions, etc.) are intentionally hidden here.
 */
export function PluginsOverlay({ onClose, onReloadExternalPlugins, headerInsetStart = false, headerInsetEnd = false }: PluginsOverlayProps) {
  const client = useWorkspacePluginClient()
  const [state, setState] = useState<LoadState>({ status: "loading", plugins: [] })
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [reloading, setReloading] = useState(false)
  const [reloadMessage, setReloadMessage] = useState<string | null>(null)

  const loadPlugins = useCallback(async () => {
    setState((current) => ({ status: "loading", plugins: current.plugins }))
    try {
      const plugins = await client.getJson<ExternalPluginEntry[]>("/api/v1/agent-plugins?external=1", {
        missingMessage: "Failed to load external plugins.",
      })
      const sorted = Array.isArray(plugins)
        ? [...plugins].sort((a, b) => pluginLabel(a).localeCompare(pluginLabel(b)))
        : []
      setState({ status: "ready", plugins: sorted })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load external plugins."
      // A 404 means this deployment doesn't expose the external-plugins API at
      // all (e.g. a locked-down public app with externalPlugins: false). That's
      // not an error — there simply are no external plugins. Show the clean
      // empty state instead of a scary failure.
      if (/\(404\)/.test(message)) {
        setState({ status: "ready", plugins: [] })
        return
      }
      setState((current) => ({
        status: "error",
        plugins: current.plugins,
        error: message,
      }))
    }
  }, [client])

  useEffect(() => {
    void loadPlugins()
  }, [loadPlugins])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ExternalPluginEvent>).detail
      if (!detail || typeof detail !== "object") return
      switch (detail.type) {
        case "boring.plugin.load":
          setState((current) => ({ ...current, plugins: upsertPlugin(current.plugins, detail) }))
          setPendingIds((current) => {
            const next = new Set(current)
            next.delete(detail.id)
            return next
          })
          break
        case "boring.plugin.unload":
          setState((current) => ({ ...current, plugins: current.plugins.filter((plugin) => plugin.id !== detail.id) }))
          setPendingIds((current) => {
            const next = new Set(current)
            next.delete(detail.id)
            return next
          })
          break
        case "boring.plugin.front-pending":
          setPendingIds((current) => new Set(current).add(detail.id))
          break
        case "boring.plugin.front-settled":
          setPendingIds((current) => {
            const next = new Set(current)
            next.delete(detail.id)
            return next
          })
          break
        case "boring.plugin.error":
        case "boring.plugin.front-error":
          setReloadMessage(detail.message ? `${detail.id}: ${detail.message}` : `${detail.id} failed to reload`)
          setPendingIds((current) => {
            const next = new Set(current)
            next.delete(detail.id)
            return next
          })
          break
        case "boring.plugin.replay-complete":
          void loadPlugins()
          break
      }
    }
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, handler as EventListener)
    return () => window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, handler as EventListener)
  }, [loadPlugins])

  const sorted = useMemo(() => [...state.plugins].sort((a, b) => pluginLabel(a).localeCompare(pluginLabel(b))), [state.plugins])

  const reload = useCallback(async () => {
    setReloading(true)
    setReloadMessage(null)
    try {
      const message = onReloadExternalPlugins
        ? await onReloadExternalPlugins()
        : undefined
      setReloadMessage(message || "External plugins reloaded.")
      await loadPlugins()
    } catch (error) {
      setReloadMessage(error instanceof Error ? error.message : "External plugin reload failed.")
    } finally {
      setReloading(false)
    }
  }, [loadPlugins, onReloadExternalPlugins])

  return (
    <div data-boring-workspace-part="plugins-overlay" className="flex h-full min-h-0 flex-col bg-background">
      <header className={cn(
        "flex h-12 shrink-0 items-center justify-between border-b border-border/60",
        headerInsetStart ? "pl-12" : "pl-4",
        headerInsetEnd ? "pr-16" : "pr-4",
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
            <Plug className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">Plugins</h2>
            <p className="truncate text-xs text-muted-foreground">External plugins loaded for this workspace</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => void reload()}
            disabled={reloading || state.status === "loading"}
            aria-label="Reload plugins"
            title="Reload plugins"
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("size-3", (reloading || state.status === "loading") && "animate-spin")} strokeWidth={1.75} />
          </IconButton>
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
        </div>
      </header>

      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {state.status === "error" ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {state.error}
          </div>
        ) : null}
        {reloadMessage ? (
          <div className="mb-4 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {reloadMessage}
          </div>
        ) : null}
        {state.status === "loading" && sorted.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-muted-foreground">
            Loading external plugins…
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-center text-sm text-muted-foreground">
            <div>
              <div className="font-medium text-foreground/80">No external plugins loaded</div>
              <p className="mt-1 max-w-xs">Create or install an external plugin, then reload external plugins.</p>
            </div>
          </div>
        ) : (
          <ul role="list" className="grid gap-2">
            {sorted.map((plugin) => {
              const pending = pendingIds.has(plugin.id)
              return (
                <li
                  key={plugin.id}
                  className="rounded-xl border border-border/60 bg-card/70 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{pluginLabel(plugin)}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{plugin.id}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {pending ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">loading</span>
                      ) : null}
                      {plugin.frontTarget ? (
                        <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">front</span>
                      ) : null}
                      {typeof plugin.revision === "number" ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">r{plugin.revision}</span>
                      ) : null}
                    </div>
                  </div>
                  {plugin.version ? (
                    <div className="mt-2 text-xs text-muted-foreground">Version {plugin.version}</div>
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
