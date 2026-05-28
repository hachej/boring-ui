import { useCallback, useEffect, useMemo, useState } from "react"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, type ErrorCode } from "@hachej/boring-agent/shared"
import type { RuntimePluginDiagnosticsResponse, RuntimePluginServerSnapshotEntry } from "../shared/runtimePluginDiagnostics"

type BrowserRuntimePluginEvent = {
  type?: string
  id?: string
  revision?: number
  message?: string
  code?: ErrorCode
  stage?: "import" | "register"
  workspaceId?: string
  replay?: boolean
}

interface BrowserRuntimePluginState {
  pluginId: string
  latestBrowserRegisteredRevision?: number
  previousGoodRevision?: number
  lastBrowserError?: {
    code?: ErrorCode
    message: string
    revision?: number
    stage?: "import" | "register"
  }
  lastEventType?: string
  lastEventRevision?: number
  lastEventReplay?: boolean
  unloaded?: boolean
}

export interface RuntimePluginDiagnosticsEntry extends RuntimePluginServerSnapshotEntry {
  browser?: BrowserRuntimePluginState
  status: "replaying" | "ready" | "degraded" | "failed" | "unloaded" | "pending"
}

function workspaceHeaders(workspaceId: string | null): HeadersInit | undefined {
  return workspaceId ? { "x-boring-workspace-id": workspaceId } : undefined
}

function mergeEntries(
  snapshot: RuntimePluginDiagnosticsResponse | null,
  browserStates: Map<string, BrowserRuntimePluginState>,
  replayPending: boolean,
): RuntimePluginDiagnosticsEntry[] {
  const merged = new Map<string, RuntimePluginDiagnosticsEntry>()
  for (const plugin of snapshot?.plugins ?? []) {
    merged.set(plugin.id, {
      ...plugin,
      status: replayPending ? "replaying" : plugin.serverError ? "failed" : "pending",
    })
  }
  for (const [pluginId, browser] of browserStates.entries()) {
    const current = merged.get(pluginId) ?? { id: pluginId, status: replayPending ? "replaying" : "pending" }
    merged.set(pluginId, { ...current, browser })
  }
  return [...merged.values()]
    .map((entry) => {
      const browser = entry.browser
      const host = entry.host
      const hasBrowserError = !!browser?.lastBrowserError
      const hasHostError = !!host?.lastErrorCode || !!host?.lastErrorMessage
      let status: RuntimePluginDiagnosticsEntry["status"] = "pending"
      if (replayPending) status = "replaying"
      else if (browser?.unloaded) status = "unloaded"
      else if (hasBrowserError) status = "degraded"
      else if (entry.serverError || hasHostError) status = "failed"
      else if (
        entry.serverLoadedRevision !== undefined
        && browser?.latestBrowserRegisteredRevision === entry.serverLoadedRevision
      ) status = "ready"
      else status = "pending"
      return { ...entry, status }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function reduceBrowserState(
  current: Map<string, BrowserRuntimePluginState>,
  detail: BrowserRuntimePluginEvent,
): Map<string, BrowserRuntimePluginState> {
  const pluginId = typeof detail.id === "string" ? detail.id : null
  if (!pluginId) return current
  const next = new Map(current)
  const existing = next.get(pluginId) ?? { pluginId }
  switch (detail.type) {
    case "boring.plugin.load":
      next.set(pluginId, {
        ...existing,
        latestBrowserRegisteredRevision: detail.revision,
        previousGoodRevision: detail.revision,
        lastBrowserError: undefined,
        lastEventType: detail.type,
        lastEventRevision: detail.revision,
        lastEventReplay: detail.replay,
        unloaded: false,
      })
      return next
    case "boring.plugin.unload":
      next.set(pluginId, {
        ...existing,
        lastEventType: detail.type,
        lastEventRevision: detail.revision,
        lastEventReplay: detail.replay,
        unloaded: true,
      })
      return next
    case "boring.plugin.front-error":
      next.set(pluginId, {
        ...existing,
        lastBrowserError: {
          code: detail.code,
          message: detail.message ?? "runtime front load failed",
          revision: detail.revision,
          stage: detail.stage,
        },
        lastEventType: detail.type,
        lastEventRevision: detail.revision,
        lastEventReplay: detail.replay,
      })
      return next
    case "boring.plugin.error":
      next.set(pluginId, {
        ...existing,
        lastEventType: detail.type,
        lastEventRevision: detail.revision,
        lastEventReplay: detail.replay,
      })
      return next
    default:
      return current
  }
}

export function useRuntimePluginDiagnostics(options: {
  enabled: boolean
  workspaceId: string | null
  replayPending: boolean
}) {
  const [snapshot, setSnapshot] = useState<RuntimePluginDiagnosticsResponse | null>(null)
  const [browserStates, setBrowserStates] = useState<Map<string, BrowserRuntimePluginState>>(new Map())
  const [open, setOpen] = useState(false)

  const refresh = useCallback(() => {
    if (!options.enabled) return
    void fetch("/api/v1/runtime-plugin-diagnostics", {
      headers: workspaceHeaders(options.workspaceId),
    })
      .then(async (res) => res.ok ? await res.json() as RuntimePluginDiagnosticsResponse : null)
      .then((data) => {
        if (data) setSnapshot(data)
      })
      .catch(() => {})
  }, [options.enabled, options.workspaceId])

  useEffect(() => {
    if (!options.enabled) return
    setBrowserStates(new Map())
    refresh()
  }, [options.enabled, options.workspaceId, refresh])

  useEffect(() => {
    if (!options.enabled) return
    const handle = (raw: Event) => {
      const detail = (raw as CustomEvent<BrowserRuntimePluginEvent>).detail
      if (!detail) return
      if (detail.workspaceId && options.workspaceId && detail.workspaceId !== options.workspaceId) return
      if (detail.type && detail.type !== "boring.plugin.replay-complete") {
        setBrowserStates((current) => reduceBrowserState(current, detail))
      }
      refresh()
    }
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, handle as EventListener)
    return () => window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, handle as EventListener)
  }, [options.enabled, options.workspaceId, refresh])

  const entries = useMemo(() => mergeEntries(snapshot, browserStates, options.replayPending), [browserStates, options.replayPending, snapshot])
  const problemCount = entries.filter((entry) => entry.status === "degraded" || entry.status === "failed").length

  return {
    open,
    setOpen,
    entries,
    problemCount,
    snapshotWorkspaceId: snapshot?.workspaceId ?? options.workspaceId ?? "folder",
  }
}

function badgeClass(status: RuntimePluginDiagnosticsEntry["status"]): string {
  switch (status) {
    case "ready": return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
    case "degraded": return "bg-amber-500/10 text-amber-700 border-amber-500/20"
    case "failed": return "bg-red-500/10 text-red-700 border-red-500/20"
    case "unloaded": return "bg-slate-500/10 text-slate-700 border-slate-500/20"
    case "replaying": return "bg-blue-500/10 text-blue-700 border-blue-500/20"
    default: return "bg-muted/40 text-muted-foreground border-border/60"
  }
}

function pluginSummary(entry: RuntimePluginDiagnosticsEntry): string {
  if (entry.browser?.lastBrowserError) return entry.browser.lastBrowserError.message
  if (entry.host?.lastErrorMessage) return entry.host.lastErrorMessage
  if (entry.serverError) return entry.serverError
  if (entry.status === "ready") return "browser registered active revision"
  if (entry.status === "unloaded") return "plugin was unloaded after reload"
  if (entry.status === "replaying") return "waiting for replay to finish"
  return "waiting for browser/runtime checkpoints"
}

export function RuntimePluginDiagnosticsButton(props: {
  enabled: boolean
  workspaceId: string | null
  replayPending: boolean
}) {
  const diagnostics = useRuntimePluginDiagnostics(props)
  if (!props.enabled) return null
  return (
    <div className="relative">
      <button
        type="button"
        className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium leading-none tracking-tight text-muted-foreground"
        onClick={() => diagnostics.setOpen(!diagnostics.open)}
      >
        Plugin diagnostics{diagnostics.problemCount > 0 ? ` (${diagnostics.problemCount})` : ""}
      </button>
      {diagnostics.open ? (
        <div className="absolute right-0 top-7 z-50 w-[32rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-background p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Runtime plugin diagnostics</div>
              <div className="text-xs text-muted-foreground">workspace: {diagnostics.snapshotWorkspaceId}</div>
            </div>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => diagnostics.setOpen(false)}>Close</button>
          </div>
          <div className="max-h-[24rem] space-y-2 overflow-auto">
            {diagnostics.entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">No runtime plugins discovered yet.</div>
            ) : diagnostics.entries.map((entry) => (
              <details key={entry.id} className="rounded-xl border border-border p-3" open>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{entry.id}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{pluginSummary(entry)}</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClass(entry.status)}`}>{entry.status}</span>
                </summary>
                <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                  <div>server revision: {entry.serverLoadedRevision ?? "—"} · browser revision: {entry.browser?.latestBrowserRegisteredRevision ?? "—"} · previous good: {entry.browser?.previousGoodRevision ?? "—"}</div>
                  <div>front entry: {entry.frontPath ?? "—"}</div>
                  <div>root: {entry.rootDir ?? "—"}</div>
                  <div>front target: {entry.frontTarget?.entryUrl ?? entry.host?.entryUrl ?? "—"}</div>
                  <div>request: {entry.host?.lastRequestedPath ?? "—"} · transform ok: {entry.host?.lastTransformAt ? "yes" : "no"} · register ok: {entry.browser?.latestBrowserRegisteredRevision === entry.serverLoadedRevision ? "yes" : "no"} · unload seen: {entry.browser?.unloaded || entry.host?.lastDisposedAt ? "yes" : "no"}</div>
                  {entry.serverError ? <div className="text-red-700">server error: {entry.serverError}</div> : null}
                  {entry.host?.lastErrorMessage ? <div className="text-red-700">runtime host error: {entry.host.lastErrorCode ?? "unknown"} — {entry.host.lastErrorMessage}</div> : null}
                  {entry.browser?.lastBrowserError ? <div className="text-red-700">browser error: {entry.browser.lastBrowserError.code ?? "unknown"} — {entry.browser.lastBrowserError.message}</div> : null}
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
