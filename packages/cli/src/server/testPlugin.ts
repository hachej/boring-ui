import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type { Browser, BrowserType } from "playwright"
import type { RuntimePluginDiagnosticsResponse } from "../shared/runtimePluginDiagnostics"

const require = createRequire(import.meta.url)

export interface SelfTestEvent {
  code: string
  message: string
}

export interface SelfTestFailedRequest {
  status?: number
  url: string
}

export interface SelfTestResult {
  ok: boolean
  workspaceId?: string
  pluginId: string
  revision?: number
  reloadErrors: SelfTestEvent[]
  pageErrors: SelfTestEvent[]
  consoleErrors: SelfTestEvent[]
  failedRequests: SelfTestFailedRequest[]
  pane: {
    found: boolean
    state: "ready" | "error" | "timeout"
    selector: string
    panelId?: string
    panelInstanceId?: string
  }
}

interface ReloadResponse {
  diagnostics?: Array<{ source?: string; message?: string; pluginId?: string }>
  restart_warnings?: unknown[]
}

interface BrowserPluginEvent {
  type?: string
  id?: string
  revision?: number
  message?: string
  code?: string
  stage?: string
}

export interface RunPluginSelfTestOptions {
  pluginId: string
  url?: string
  workspaceId?: string
  panelId?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000
const PLUGIN_RELOAD_EVENT = "boring-ui:agent-plugins-reloaded"
const PLAYWRIGHT_BROWSER_INSTALL_MAX_BUFFER = 10 * 1024 * 1024
const PLAYWRIGHT_BROWSER_INSTALL_TIMEOUT_MS = 120_000

class BrowserSetupError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BrowserSetupError'
    this.code = code
  }
}

export function buildPanelId(pluginId: string, panelId?: string): string {
  return panelId?.trim() || `${pluginId}.panel`
}

export function buildPanelInstanceId(pluginId: string, panelId: string): string {
  return `self-test:${pluginId}:${panelId}`
}

export function buildPanelSelector(args: { pluginId: string; panelId: string; panelInstanceId: string }): string {
  return [
    `[data-boring-plugin-id=${JSON.stringify(args.pluginId)}]`,
    `[data-boring-panel-component-id=${JSON.stringify(args.panelId)}]`,
    `[data-boring-panel-instance-id=${JSON.stringify(args.panelInstanceId)}]`,
  ].join("")
}

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return rawUrl.split("?")[0]?.slice(0, 500) ?? rawUrl.slice(0, 500)
  }
}

function truncateMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 1_000)
}

function shouldCaptureFailedRequest(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.pathname === "/favicon.ico") return false
    return true
  } catch {
    return true
  }
}

function event(code: string, message: string): SelfTestEvent {
  return { code, message: truncateMessage(message) }
}

export function inferSelfTestUrl(explicitUrl?: string, env: Record<string, string | undefined> = process.env): string {
  const envUrl = env.BORING_UI_SELF_TEST_URL ?? env.BORING_UI_URL ?? env.BORING_WORKSPACE_URL
  const portUrl = env.PORT ? `http://127.0.0.1:${env.PORT}` : undefined
  return explicitUrl?.trim() || envUrl?.trim() || portUrl || "http://127.0.0.1:5200"
}

export function inferSelfTestWorkspaceId(explicitWorkspaceId?: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return explicitWorkspaceId?.trim()
    || env.BORING_UI_WORKSPACE_ID?.trim()
    || env.BORING_WORKSPACE_ID?.trim()
    || env.BORING_AGENT_WORKSPACE_ID?.trim()
    || undefined
}

export function defaultPlaywrightBrowsersPath(env: Record<string, string | undefined> = process.env): string | undefined {
  const workspaceRoot = env.BORING_AGENT_WORKSPACE_ROOT?.trim()
  if (!workspaceRoot) return undefined
  return join(workspaceRoot, ".boring-agent", "playwright-browsers")
}

export function isMissingPlaywrightBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Executable doesn't exist")
    || message.includes("Please run the following command to download new browsers")
    || message.includes("playwright install")
}

function playwrightCliPath(): string {
  return join(dirname(require.resolve("playwright/package.json")), "cli.js")
}

function installPlaywrightChromium(env: NodeJS.ProcessEnv, timeoutMs = PLAYWRIGHT_BROWSER_INSTALL_TIMEOUT_MS): void {
  const result = spawnSync(process.execPath, [playwrightCliPath(), "install", "chromium"], {
    env,
    encoding: "utf8",
    maxBuffer: PLAYWRIGHT_BROWSER_INSTALL_MAX_BUFFER,
    timeout: timeoutMs,
  })
  if (result.status === 0) return
  const stderr = result.stderr ? `\n${result.stderr.trim()}` : ""
  const stdout = result.stdout ? `\n${result.stdout.trim()}` : ""
  const reason = result.error?.message ?? `exit ${result.status ?? "unknown"}`
  throw new BrowserSetupError("SELF_TEST_BROWSER_INSTALL_FAILED", `failed to install Playwright Chromium (${reason})${stderr}${stdout}`)
}

async function launchChromiumWithLazyInstall(chromium: BrowserType): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    if (!isMissingPlaywrightBrowserError(error)) {
      throw new BrowserSetupError("SELF_TEST_BROWSER_LAUNCH_FAILED", error instanceof Error ? error.message : String(error))
    }
    installPlaywrightChromium(process.env)
    try {
      return await chromium.launch({ headless: true })
    } catch (retryError) {
      throw new BrowserSetupError("SELF_TEST_BROWSER_LAUNCH_FAILED", retryError instanceof Error ? retryError.message : String(retryError))
    }
  }
}

function normalizeBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.hash = ""
  return url.toString().replace(/\/+$/, "")
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`
}

function workspaceHeaders(workspaceId?: string): Record<string, string> {
  return workspaceId ? { "x-boring-workspace-id": workspaceId } : {}
}

function browserUrl(baseUrl: string, workspaceId?: string): string {
  if (!workspaceId) return `${baseUrl}/`
  return `${baseUrl}/workspace/${encodeURIComponent(workspaceId)}`
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function normalizeDiagnostics(args: {
  pluginId: string
  reloadStatus?: number
  diagnosticsStatus?: number
  reloadBody?: unknown
  diagnosticsBody?: unknown
}): { errors: SelfTestEvent[]; revision?: number } {
  const errors: SelfTestEvent[] = []
  let revision: number | undefined

  if (args.reloadStatus && (args.reloadStatus < 200 || args.reloadStatus >= 300)) {
    errors.push(event("RELOAD_HTTP_ERROR", `/api/v1/agent/reload returned ${args.reloadStatus}`))
  }
  if (args.diagnosticsStatus && (args.diagnosticsStatus < 200 || args.diagnosticsStatus >= 300)) {
    errors.push(event("DIAGNOSTICS_HTTP_ERROR", `/api/v1/runtime-plugin-diagnostics returned ${args.diagnosticsStatus}`))
  }

  const reload = args.reloadBody as ReloadResponse | undefined
  for (const diagnostic of reload?.diagnostics ?? []) {
    if (diagnostic.pluginId && diagnostic.pluginId !== args.pluginId) continue
    errors.push(event("RELOAD_DIAGNOSTIC", diagnostic.message ?? "reload diagnostic"))
  }

  const diagnostics = args.diagnosticsBody as RuntimePluginDiagnosticsResponse | undefined
  const plugin = diagnostics?.plugins?.find((entry) => entry.id === args.pluginId)
  if (plugin?.serverLoadedRevision !== undefined) revision = plugin.serverLoadedRevision
  if (plugin?.serverError) errors.push(event("PLUGIN_SERVER_ERROR", plugin.serverError))
  if (plugin?.host?.revision !== undefined) revision = plugin.host.revision
  if (plugin?.host?.lastErrorCode || plugin?.host?.lastErrorMessage) {
    errors.push(event(
      plugin.host.lastErrorCode ?? "PLUGIN_RUNTIME_HOST_ERROR",
      plugin.host.lastErrorMessage ?? plugin.host.lastErrorStage ?? "runtime plugin host error",
    ))
  }

  return { errors, revision }
}

async function fetchJson(args: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; body: unknown }> {
  const response = await fetch(args.url, {
    method: args.method ?? "GET",
    headers: {
      ...(args.body === undefined ? {} : { "content-type": "application/json" }),
      ...(args.headers ?? {}),
    },
    ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
  })
  return { status: response.status, body: await readJson(response) }
}

export async function runPluginSelfTest(options: RunPluginSelfTestOptions): Promise<SelfTestResult> {
  const pluginId = options.pluginId.trim()
  if (!pluginId) throw new Error("plugin id is required")
  const workspaceId = inferSelfTestWorkspaceId(options.workspaceId)
  const baseUrl = normalizeBaseUrl(inferSelfTestUrl(options.url))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const panelId = buildPanelId(pluginId, options.panelId)
  const panelInstanceId = buildPanelInstanceId(pluginId, panelId)
  const selector = buildPanelSelector({ pluginId, panelId, panelInstanceId })
  const headers = workspaceHeaders(workspaceId)

  const pageErrors: SelfTestEvent[] = []
  const consoleErrors: SelfTestEvent[] = []
  const failedRequests: SelfTestFailedRequest[] = []
  const browserEvents: BrowserPluginEvent[] = []

  let browser: Browser
  try {
    const { chromium } = await import("playwright")
    browser = await launchChromiumWithLazyInstall(chromium)
  } catch (error) {
    const setupError = error instanceof BrowserSetupError
      ? error
      : new BrowserSetupError("SELF_TEST_BROWSER_LAUNCH_FAILED", error instanceof Error ? error.message : String(error))
    return {
      ok: false,
      ...(workspaceId ? { workspaceId } : {}),
      pluginId,
      reloadErrors: [event(setupError.code, setupError.message)],
      pageErrors,
      consoleErrors,
      failedRequests,
      pane: {
        found: false,
        state: "timeout",
        selector,
        panelId,
        panelInstanceId,
      },
    }
  }
  const page = await browser.newPage()

  page.on("pageerror", (err) => {
    pageErrors.push(event("PAGE_ERROR", err.message))
  })
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    consoleErrors.push(event("CONSOLE_ERROR", msg.text()))
  })
  page.on("requestfailed", (request) => {
    if (!shouldCaptureFailedRequest(request.url())) return
    failedRequests.push({ url: redactUrl(request.url()) })
  })
  page.on("response", (response) => {
    const status = response.status()
    if (status < 400 || !shouldCaptureFailedRequest(response.url())) return
    failedRequests.push({ status, url: redactUrl(response.url()) })
  })

  await page.addInitScript((eventName: string) => {
    const key = "__boringPluginSelfTestEvents"
    ;(window as unknown as Record<string, unknown>)[key] = []
    window.addEventListener(eventName, (rawEvent) => {
      const detail = (rawEvent as CustomEvent).detail
      ;((window as unknown as Record<string, unknown>)[key] as unknown[]).push(detail)
    })
  }, PLUGIN_RELOAD_EVENT)

  try {
    const reload = await fetchJson({
      url: apiUrl(baseUrl, "/api/v1/agent/reload"),
      method: "POST",
      headers,
      body: {},
    })
    const diagnostics = await fetchJson({
      url: apiUrl(baseUrl, "/api/v1/runtime-plugin-diagnostics"),
      headers,
    })
    const normalized = normalizeDiagnostics({
      pluginId,
      reloadStatus: reload.status,
      diagnosticsStatus: diagnostics.status,
      reloadBody: reload.body,
      diagnosticsBody: diagnostics.body,
    })
    const reloadErrors = [...normalized.errors]
    let revision = normalized.revision

    await page.goto(browserUrl(baseUrl, workspaceId), { waitUntil: "domcontentloaded", timeout: timeoutMs })

    let frontEvent: BrowserPluginEvent | undefined
    try {
      const handle = await page.waitForFunction(
        ({ id }: { id: string }) => {
          const events = ((window as unknown as Record<string, unknown>).__boringPluginSelfTestEvents as Array<{ id?: string; type?: string }> | undefined) ?? []
          return events.find((entry) => entry?.id === id && (
            entry.type === "boring.plugin.load"
            || entry.type === "boring.plugin.front-error"
            || entry.type === "boring.plugin.error"
          )) ?? null
        },
        { id: pluginId },
        { timeout: timeoutMs },
      )
      frontEvent = await handle.jsonValue() as BrowserPluginEvent | undefined
      if (frontEvent) browserEvents.push(frontEvent)
      if (frontEvent?.revision !== undefined) revision = frontEvent.revision
      if (frontEvent?.type === "boring.plugin.front-error" || frontEvent?.type === "boring.plugin.error") {
        reloadErrors.push(event(frontEvent.code ?? "PLUGIN_FRONT_ERROR", frontEvent.message ?? "plugin front failed to load"))
      }
    } catch {
      reloadErrors.push(event("PLUGIN_FRONT_REGISTRATION_TIMEOUT", `timed out waiting for browser registration event for ${pluginId}`))
    }

    let paneFound = false
    let paneState: SelfTestResult["pane"]["state"] = "timeout"
    if (frontEvent?.type === "boring.plugin.load") {
      const openPanel = await fetchJson({
        url: apiUrl(baseUrl, "/api/v1/ui/commands"),
        method: "POST",
        headers,
        body: {
          kind: "openPanel",
          params: {
            id: panelInstanceId,
            component: panelId,
            title: `Self-test: ${pluginId}`,
          },
        },
      })
      if (openPanel.status < 200 || openPanel.status >= 300) {
        reloadErrors.push(event("OPEN_PANEL_HTTP_ERROR", `/api/v1/ui/commands returned ${openPanel.status}`))
      }
      try {
        const locator = page.locator(selector)
        await locator.waitFor({ state: "attached", timeout: timeoutMs })
        paneFound = true
        const fallback = locator.locator("[data-boring-plugin-suspense-fallback='true']")
        if (await fallback.count() > 0) {
          await fallback.waitFor({ state: "detached", timeout: timeoutMs })
        }
        // Give mounted panels one short tick to run initial effects so failed
        // fetches and immediate render follow-up errors are captured before ok.
        await page.waitForTimeout(Math.min(1_000, Math.max(250, Math.floor(timeoutMs / 10))))
        const errorBoundary = await locator.locator("[data-boring-plugin-error-boundary='true']").count()
        const stillLoading = await fallback.count()
        paneState = stillLoading > 0 ? "timeout" : errorBoundary > 0 ? "error" : "ready"
      } catch {
        paneState = "timeout"
      }
    } else if (reloadErrors.length > 0) {
      paneState = "error"
    }

    const result: SelfTestResult = {
      ok: reloadErrors.length === 0
        && pageErrors.length === 0
        && consoleErrors.length === 0
        && failedRequests.length === 0
        && paneState === "ready",
      ...(workspaceId ? { workspaceId } : {}),
      pluginId,
      ...(revision !== undefined ? { revision } : {}),
      reloadErrors,
      pageErrors,
      consoleErrors,
      failedRequests,
      pane: {
        found: paneFound,
        state: paneState,
        selector,
        panelId,
        panelInstanceId,
      },
    }
    return result
  } finally {
    await browser.close()
  }
}

export function formatSelfTestResult(result: SelfTestResult): string {
  const lines = [
    result.ok ? `OK ${result.pluginId}` : `FAIL ${result.pluginId}`,
    `  pane     ${result.pane.state}${result.pane.found ? "" : " (not found)"}`,
  ]
  if (result.revision !== undefined) lines.push(`  revision ${result.revision}`)
  for (const [label, events] of [
    ["reload", result.reloadErrors],
    ["page", result.pageErrors],
    ["console", result.consoleErrors],
  ] as const) {
    for (const item of events) lines.push(`  ${label}   ${item.code}: ${item.message}`)
  }
  for (const item of result.failedRequests) {
    lines.push(`  request  ${item.status ?? "failed"}: ${item.url}`)
  }
  return lines.join("\n")
}
