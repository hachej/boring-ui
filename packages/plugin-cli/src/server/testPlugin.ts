export type PaneSelfTestState = "ready" | "loading" | "error" | "missing" | "timeout" | "no-browser-connected"

export interface SelfTestEvent {
  code: string
  message: string
}

export interface SelfTestResult {
  ok: boolean
  workspaceId?: string
  pluginId: string
  revision?: number
  reloadErrors: SelfTestEvent[]
  pane: {
    found: boolean
    state: PaneSelfTestState
    panelId: string
    panelInstanceId: string
    error?: SelfTestEvent
    lastReportedAt?: string
  }
}

export interface RunPluginSelfTestOptions {
  pluginId: string
  url?: string
  workspaceId?: string
  panelId?: string
  timeoutMs?: number
}

interface FetchJsonResult {
  status: number
  body: unknown
}

const DEFAULT_TIMEOUT_MS = 10_000
const POLL_MS = 500

export function inferSelfTestUrl(explicitUrl: string | undefined, env: Record<string, string | undefined> = process.env): string {
  const envUrl = env.BORING_UI_SELF_TEST_URL ?? env.BORING_UI_URL ?? env.BORING_WORKSPACE_URL
  const portUrl = env.PORT ? `http://127.0.0.1:${env.PORT}` : undefined
  return explicitUrl?.trim() || envUrl?.trim() || portUrl || "http://127.0.0.1:5200"
}

export function inferSelfTestWorkspaceId(explicitWorkspaceId: string | undefined, env: Record<string, string | undefined> = process.env): string | undefined {
  return explicitWorkspaceId?.trim() || env.BORING_UI_WORKSPACE_ID?.trim() || env.BORING_WORKSPACE_ID?.trim() || env.BORING_AGENT_WORKSPACE_ID?.trim() || undefined
}

export function buildPanelId(pluginId: string, panelId?: string): string {
  return panelId?.trim() || `${pluginId}.panel`
}

export function buildPanelInstanceId(pluginId: string, panelId: string): string {
  return `self-test:${pluginId}:${panelId}`
}

function normalizeBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.hash = ""
  return url.toString().replace(/\/+$/, "")
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`
}

function workspaceHeaders(workspaceId: string | undefined): Record<string, string> {
  return workspaceId ? { "x-boring-workspace-id": workspaceId } : {}
}

function truncateMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 1000)
}

function event(code: string, message: string): SelfTestEvent {
  return { code, message: truncateMessage(message) }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return undefined
  try { return JSON.parse(text) } catch { return text }
}

async function fetchJson(url: string, init?: RequestInit): Promise<FetchJsonResult> {
  const response = await fetch(url, init)
  return { status: response.status, body: await readJson(response) }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function collectReloadDiagnostics(pluginId: string, body: unknown): SelfTestEvent[] {
  if (!isObject(body) || !Array.isArray(body.diagnostics)) return []
  const events: SelfTestEvent[] = []
  for (const diagnostic of body.diagnostics) {
    if (!isObject(diagnostic)) continue
    const diagnosticPlugin = typeof diagnostic.pluginId === "string" ? diagnostic.pluginId : undefined
    if (diagnosticPlugin && diagnosticPlugin !== pluginId) continue
    const message = typeof diagnostic.message === "string" ? diagnostic.message : "reload diagnostic"
    events.push(event("RELOAD_DIAGNOSTIC", message))
  }
  return events
}

function collectRuntimeDiagnostics(pluginId: string, body: unknown): { events: SelfTestEvent[]; revision?: number } {
  const events: SelfTestEvent[] = []
  let revision: number | undefined
  if (!isObject(body) || !Array.isArray(body.plugins)) return { events }
  const plugin = body.plugins.find((entry): entry is Record<string, unknown> => isObject(entry) && entry.id === pluginId)
  if (!plugin) return { events }
  if (typeof plugin.serverLoadedRevision === "number") revision = plugin.serverLoadedRevision
  if (typeof plugin.serverError === "string") events.push(event("PLUGIN_SERVER_ERROR", plugin.serverError))
  if (isObject(plugin.host)) {
    if (typeof plugin.host.revision === "number") revision = plugin.host.revision
    const code = typeof plugin.host.lastErrorCode === "string" ? plugin.host.lastErrorCode : "PLUGIN_RUNTIME_HOST_ERROR"
    const message = typeof plugin.host.lastErrorMessage === "string"
      ? plugin.host.lastErrorMessage
      : typeof plugin.host.lastErrorStage === "string"
        ? plugin.host.lastErrorStage
        : undefined
    if (message) events.push(event(code, message))
  }
  return { events, revision }
}

async function inferWorkspaceIdFromMeta(baseUrl: string): Promise<string | undefined> {
  try {
    const meta = await fetchJson(apiUrl(baseUrl, "/api/v1/workspace/meta"))
    if (meta.status < 200 || meta.status >= 300 || !isObject(meta.body)) return undefined
    return typeof meta.body.workspaceId === "string" ? meta.body.workspaceId : undefined
  } catch {
    return undefined
  }
}

async function maybeReadPluginError(baseUrl: string, pluginId: string, headers: Record<string, string>): Promise<SelfTestEvent[]> {
  try {
    const response = await fetch(apiUrl(baseUrl, `/api/v1/agent-plugins/${encodeURIComponent(pluginId)}/error`), { headers })
    if (response.status === 404) return []
    if (!response.ok) return []
    const text = await response.text()
    return text.trim() ? [event("PLUGIN_LOAD_ERROR", text)] : []
  } catch {
    return []
  }
}

async function pollPaneStatus(args: {
  baseUrl: string
  headers: Record<string, string>
  workspaceId?: string
  pluginId: string
  panelId: string
  panelInstanceId: string
  minReportedAtMs: number
}): Promise<{ state: PaneSelfTestState; status?: Record<string, unknown> }> {
  const url = new URL(apiUrl(args.baseUrl, "/api/v1/ui/panels/status"))
  url.searchParams.set("panelInstanceId", args.panelInstanceId)
  url.searchParams.set("pluginId", args.pluginId)
  url.searchParams.set("panelId", args.panelId)
  if (args.workspaceId) url.searchParams.set("workspaceId", args.workspaceId)
  const result = await fetchJson(url.toString(), { headers: args.headers })
  if (result.status < 200 || result.status >= 300) return { state: "missing" }
  const body = isObject(result.body) ? result.body : {}
  const status = isObject(body.status) ? body.status : undefined
  const reportedAt = typeof status?.reportedAt === "string" ? Date.parse(status.reportedAt) : undefined
  if (reportedAt !== undefined && Number.isFinite(reportedAt) && reportedAt < args.minReportedAtMs) {
    return { state: "missing" }
  }
  const state = typeof body.state === "string" ? body.state as PaneSelfTestState : "missing"
  return { state, status }
}

async function openPanel(args: { baseUrl: string; headers: Record<string, string>; pluginId: string; panelId: string; panelInstanceId: string }): Promise<SelfTestEvent[]> {
  try {
    const result = await fetchJson(apiUrl(args.baseUrl, "/api/v1/ui/commands"), {
      method: "POST",
      headers: { "content-type": "application/json", ...args.headers },
      body: JSON.stringify({
        kind: "openPanel",
        params: {
          id: args.panelInstanceId,
          component: args.panelId,
          title: `Self-test: ${args.pluginId}`,
        },
      }),
    })
    if (result.status < 200 || result.status >= 300) {
      return [event("OPEN_PANEL_HTTP_ERROR", `/api/v1/ui/commands returned ${result.status}`)]
    }
  } catch (error) {
    return [event("OPEN_PANEL_FAILED", error instanceof Error ? error.message : String(error))]
  }
  return []
}

export async function runPluginSelfTest(options: RunPluginSelfTestOptions): Promise<SelfTestResult> {
  const pluginId = options.pluginId.trim()
  if (!pluginId) throw new Error("plugin id is required")
  const baseUrl = normalizeBaseUrl(inferSelfTestUrl(options.url))
  const workspaceId = inferSelfTestWorkspaceId(options.workspaceId) ?? await inferWorkspaceIdFromMeta(baseUrl)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const panelId = buildPanelId(pluginId, options.panelId)
  const panelInstanceId = buildPanelInstanceId(pluginId, panelId)
  const headers = workspaceHeaders(workspaceId)
  const reloadErrors: SelfTestEvent[] = []
  let revision: number | undefined

  try {
    const reload = await fetchJson(apiUrl(baseUrl, "/api/v1/agent/reload"), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ ...(workspaceId ? { sessionId: workspaceId } : {}) }),
    })
    if (reload.status < 200 || reload.status >= 300) reloadErrors.push(event("RELOAD_HTTP_ERROR", `/api/v1/agent/reload returned ${reload.status}`))
    reloadErrors.push(...collectReloadDiagnostics(pluginId, reload.body))
  } catch (error) {
    reloadErrors.push(event("RELOAD_FAILED", error instanceof Error ? error.message : String(error)))
  }

  try {
    const diagnostics = await fetchJson(apiUrl(baseUrl, "/api/v1/runtime-plugin-diagnostics"), { headers })
    if (diagnostics.status >= 200 && diagnostics.status < 300) {
      const normalized = collectRuntimeDiagnostics(pluginId, diagnostics.body)
      reloadErrors.push(...normalized.events)
      revision = normalized.revision
    } else if (diagnostics.status !== 404) {
      reloadErrors.push(event("DIAGNOSTICS_HTTP_ERROR", `/api/v1/runtime-plugin-diagnostics returned ${diagnostics.status}`))
    }
  } catch {
    // Optional endpoint. Workspace playground hosts can still decide by pane status.
  }
  reloadErrors.push(...await maybeReadPluginError(baseUrl, pluginId, headers))

  const start = Date.now()
  let lastOpenAt = 0
  let lastState: PaneSelfTestState = "missing"
  let lastStatus: Record<string, unknown> | undefined
  let openErrors: SelfTestEvent[] = []

  while (Date.now() - start <= timeoutMs) {
    const status = await pollPaneStatus({ baseUrl, headers, workspaceId, pluginId, panelId, panelInstanceId, minReportedAtMs: start })
    lastState = status.state
    lastStatus = status.status
    if (status.state === "no-browser-connected") {
      return buildResult({ pluginId, workspaceId, revision, reloadErrors, panelId, panelInstanceId, state: "no-browser-connected", status: lastStatus })
    }
    if (status.state === "ready" || status.state === "error") break
    if (Date.now() - lastOpenAt >= POLL_MS) {
      openErrors = await openPanel({ baseUrl, headers, pluginId, panelId, panelInstanceId })
      lastOpenAt = Date.now()
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  if (openErrors.length > 0) reloadErrors.push(...openErrors)
  const finalState = lastState === "ready" || lastState === "error" ? lastState : "timeout"
  return buildResult({ pluginId, workspaceId, revision, reloadErrors, panelId, panelInstanceId, state: finalState, status: lastStatus })
}

function buildResult(args: {
  pluginId: string
  workspaceId?: string
  revision?: number
  reloadErrors: SelfTestEvent[]
  panelId: string
  panelInstanceId: string
  state: PaneSelfTestState
  status?: Record<string, unknown>
}): SelfTestResult {
  const error = isObject(args.status?.error)
    ? event(typeof args.status.error.code === "string" ? args.status.error.code : "PANE_ERROR", typeof args.status.error.message === "string" ? args.status.error.message : "pane error")
    : undefined
  const lastReportedAt = typeof args.status?.reportedAt === "string" ? args.status.reportedAt : undefined
  const revision = typeof args.status?.revision === "number" ? args.status.revision : args.revision
  return {
    ok: args.reloadErrors.length === 0 && args.state === "ready",
    ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    pluginId: args.pluginId,
    ...(revision !== undefined ? { revision } : {}),
    reloadErrors: args.reloadErrors,
    pane: {
      found: args.state === "ready" || args.state === "error",
      state: args.state,
      panelId: args.panelId,
      panelInstanceId: args.panelInstanceId,
      ...(error ? { error } : {}),
      ...(lastReportedAt ? { lastReportedAt } : {}),
    },
  }
}

export function formatSelfTestResult(result: SelfTestResult): string {
  const lines = [
    result.ok ? `OK ${result.pluginId}` : `FAIL ${result.pluginId}`,
    `  pane     ${result.pane.state}${result.pane.found ? "" : " (not found)"}`,
  ]
  if (result.revision !== undefined) lines.push(`  revision ${result.revision}`)
  for (const item of result.reloadErrors) lines.push(`  reload   ${item.code}: ${item.message}`)
  if (result.pane.error) lines.push(`  pane     ${result.pane.error.code}: ${result.pane.error.message}`)
  if (result.pane.state === "no-browser-connected") {
    lines.push(`  hint     open the workspace UI, then rerun boring-ui-plugin test ${result.pluginId}`)
  }
  return lines.join("\n")
}
