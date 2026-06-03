import { Fragment, Suspense, createContext, createElement, useCallback, useContext, useEffect, type ReactNode } from "react"
import { PluginErrorBoundary } from "../plugin/PluginErrorBoundary"

export type PanelRenderState = "loading" | "ready" | "error" | "missing"

export interface PanelRenderStatusReport {
  pluginId: string
  panelId: string
  panelInstanceId: string
  revision?: number
  state: PanelRenderState
  error?: { code: string; message: string }
}

interface PanelRenderStatusReporter {
  report(status: PanelRenderStatusReport): void
}

const noopReporter: PanelRenderStatusReporter = { report: () => undefined }
const PanelRenderStatusContext = createContext<PanelRenderStatusReporter>(noopReporter)

export interface PanelRenderStatusProviderProps {
  apiBaseUrl?: string
  workspaceId?: string
  authHeaders?: Record<string, string>
  children: ReactNode
}

function joinUrl(base: string | undefined, path: string): string {
  if (!base) return path
  return `${base.replace(/\/$/, "")}${path}`
}

function scopedHeaders(authHeaders: Record<string, string> | undefined): Record<string, string> {
  return { "content-type": "application/json", ...(authHeaders ?? {}) }
}

export function PanelRenderStatusProvider(props: PanelRenderStatusProviderProps) {
  const report = useCallback((status: PanelRenderStatusReport) => {
    if (!status.panelInstanceId) return
    const body = status
    void fetch(joinUrl(props.apiBaseUrl, "/api/v1/ui/panels/status"), {
      method: "PUT",
      headers: scopedHeaders(props.authHeaders),
      body: JSON.stringify(body),
    }).catch(() => {
      // Best-effort status reporting. A broken status route must never break panels.
    })
  }, [props.apiBaseUrl, props.authHeaders])

  return createElement(PanelRenderStatusContext.Provider, { value: { report } }, props.children)
}

interface PanelRenderStatusBoundaryProps {
  pluginId: string
  panelId: string
  panelInstanceId?: string
  revision?: number
  children: ReactNode
}

function ReadyReporter(props: { onReady: () => void; children: ReactNode }) {
  useEffect(() => {
    props.onReady()
  }, [props.onReady])
  return createElement(Fragment, null, props.children)
}

function LoadingFallback(props: { onLoading: () => void }) {
  useEffect(() => {
    props.onLoading()
  }, [props.onLoading])
  return createElement(
    "div",
    {
      className: "flex h-full items-center justify-center text-sm text-muted-foreground",
      "data-boring-plugin-suspense-fallback": "true",
    },
    "Loading…",
  )
}

export function PanelRenderStatusBoundary(props: PanelRenderStatusBoundaryProps) {
  const reporter = useContext(PanelRenderStatusContext)
  const panelInstanceId = props.panelInstanceId
  const report = useCallback((state: PanelRenderState, error?: { code: string; message: string }) => {
    if (!panelInstanceId?.startsWith("self-test:")) return
    reporter.report({
      pluginId: props.pluginId,
      panelId: props.panelId,
      panelInstanceId,
      ...(props.revision !== undefined ? { revision: props.revision } : {}),
      state,
      ...(error ? { error } : {}),
    })
  }, [panelInstanceId, props.panelId, props.pluginId, props.revision, reporter])

  useEffect(() => {
    return () => report("missing")
  }, [report])

  const onError = useCallback((error: Error) => {
    report("error", { code: "PLUGIN_PANEL_RENDER_ERROR", message: error.message })
  }, [report])

  return createElement(
    "div",
    {
      className: "h-full min-h-0",
      "data-boring-plugin-id": props.pluginId,
      "data-boring-panel-component-id": props.panelId,
      ...(panelInstanceId ? { "data-boring-panel-instance-id": panelInstanceId } : {}),
      ...(props.revision !== undefined ? { "data-boring-plugin-revision": String(props.revision) } : {}),
    },
    createElement(
      PluginErrorBoundary,
      {
        pluginId: props.pluginId,
        contributionKind: "panel" as const,
        contributionId: props.panelId,
        onError,
        children: createElement(
          Suspense,
          {
            fallback: createElement(LoadingFallback, { onLoading: () => report("loading") }),
            children: createElement(ReadyReporter, { onReady: () => report("ready"), children: props.children }),
          },
        ),
      },
    ),
  )
}
