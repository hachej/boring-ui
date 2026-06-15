import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

const REPORTS = ["daily", "weekly", "monthly", "session", "blocks"] as const
const SOURCES = ["all", "claude", "codex", "opencode", "amp", "droid", "codebuff", "hermes", "pi", "goose", "openclaw", "kilo", "kimi", "qwen", "copilot", "gemini", "ollama"] as const
const QUOTA_PROVIDERS = ["claude", "codex"] as const
const QUOTA_WINDOWS = ["5h", "weekly"] as const

type Report = (typeof REPORTS)[number]
type Source = (typeof SOURCES)[number]
type QuotaProvider = (typeof QUOTA_PROVIDERS)[number]
type QuotaWindow = (typeof QUOTA_WINDOWS)[number]

type Params = { report?: Report; source?: Source; since?: string; until?: string; timezone?: string; project?: string; instances?: boolean; offline?: boolean }
type QuotaParams = { provider?: QuotaProvider | "all" }
type QuotaWindowSnapshot = { window: QuotaWindow; usedPercent: number | null; remainingPercent: number | null; resetsAt: string | null; resetInSeconds: number | null; status: "ok" | "unavailable" | "error"; error?: string; source: string }
type ProviderQuotaSnapshot = { provider: QuotaProvider; status: "ok" | "partial" | "unavailable" | "error"; source: string; fetchedAt: string; windows: QuotaWindowSnapshot[]; raw?: unknown; error?: string }
type QuotaSnapshot = { ok: boolean; generatedAt: string; providers: ProviderQuotaSnapshot[] }

const reportSet = new Set<string>(REPORTS)
const sourceSet = new Set<string>(SOURCES)

function workspaceRoot(): string { return process.env.BORING_AGENT_WORKSPACE_ROOT || process.cwd() }
function usagePath(): string { return join(workspaceRoot(), ".pi", "data", "ccusage-dashboard", "usage.json") }
function quotaPath(): string { return join(workspaceRoot(), ".pi", "data", "ccusage-dashboard", "quota.json") }
function legacyQuotaPath(): string { return join(workspaceRoot(), ".pi", "extensions", "ccusage-dashboard", "quota.json") }
function pickString(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function normalizeReport(value: unknown): Report { const report = pickString(value) ?? "daily"; if (!reportSet.has(report)) throw new Error(`Unsupported ccusage report: ${report}`); return report as Report }
function normalizeSource(value: unknown): Source { const source = pickString(value) ?? "all"; if (!sourceSet.has(source)) throw new Error(`Unsupported ccusage source: ${source}`); return source as Source }
function addDateFlag(args: string[], name: "since" | "until", value: unknown): void { const text = pickString(value); if (!text) return; if (!/^\d{4}-?\d{2}-?\d{2}$/.test(text)) throw new Error(`${name} must be YYYY-MM-DD or YYYYMMDD`); args.push(`--${name}`, text) }
function buildArgs(params: Params = {}): { report: Report; source: Source; args: string[] } { const report = normalizeReport(params.report); const source = normalizeSource(params.source); const args: string[] = source === "all" ? [report] : [source, report]; args.push("--json"); addDateFlag(args, "since", params.since); addDateFlag(args, "until", params.until); if (params.timezone) args.push("--timezone", params.timezone); if (params.project) args.push("--project", params.project); if (params.instances) args.push("--instances"); if (params.offline) args.push("--offline"); return { report, source, args } }
function findRows(parsed: unknown, report: Report): unknown[] { const root = asRecord(parsed); const preferred = root.data ?? root[report] ?? root.daily ?? root.monthly ?? root.sessions ?? root.blocks; if (Array.isArray(preferred)) return preferred; const projects = asRecord(root.projects); return Object.entries(projects).flatMap(([project, rows]) => Array.isArray(rows) ? rows.map((row) => ({ ...asRecord(row), project })) : []) }
function findSummary(parsed: unknown): Record<string, unknown> { const root = asRecord(parsed); return asRecord(root.summary ?? root.totals) }
function summarizeNumber(summary: Record<string, unknown>, rows: unknown[], keys: string[], rowKey: string): number { for (const key of keys) { const value = summary[key]; if (typeof value === "number") return value } return rows.reduce<number>((sum, row) => sum + (Number(asRecord(row)[rowKey]) || 0), 0) }

async function runCcusage(params: Params = {}) {
  const { report, source, args } = buildArgs(params)
  const cliPath = require.resolve("ccusage/dist/cli.js")
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024, env: process.env })
  const raw = JSON.parse(stdout) as unknown
  const data = findRows(raw, report)
  const summary = findSummary(raw)
  const result = { ok: true, report, source, generatedAt: new Date().toISOString(), command: ["ccusage", ...args], data, summary, raw, stderr: stderr || undefined }
  await mkdir(dirname(usagePath()), { recursive: true })
  await writeFile(usagePath(), `${JSON.stringify(result, null, 2)}\n`, "utf8")
  return result
}

function clampPercent(value: unknown): number | null { const n = typeof value === "number" ? value : Number(value); if (!Number.isFinite(n)) return null; return Math.max(0, Math.min(100, n)) }
function resetSecondsFrom(value: unknown): number | null { if (typeof value === "number" && Number.isFinite(value)) return value > 1_000_000_000 ? Math.max(0, Math.round((value * 1000 - Date.now()) / 1000)) : Math.max(0, Math.round(value)); if (typeof value === "string") { const t = Date.parse(value); if (Number.isFinite(t)) return Math.max(0, Math.round((t - Date.now()) / 1000)) } return null }
function resetsAtFrom(seconds: number | null): string | null { return seconds === null ? null : new Date(Date.now() + seconds * 1000).toISOString() }
function unavailableWindow(window: QuotaWindow, source: string, error: string): QuotaWindowSnapshot { return { window, usedPercent: null, remainingPercent: null, resetsAt: null, resetInSeconds: null, status: "unavailable", error, source } }
function windowSnapshot(window: QuotaWindow, usedRaw: unknown, resetRaw: unknown, source: string): QuotaWindowSnapshot { const usedPercent = clampPercent(usedRaw); const resetInSeconds = resetSecondsFrom(resetRaw); return { window, usedPercent, remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent), resetsAt: resetsAtFrom(resetInSeconds), resetInSeconds, status: usedPercent === null ? "unavailable" : "ok", source } }
function findValue(root: unknown, names: string[]): unknown { const wanted = new Set(names); const queue = [root]; while (queue.length) { const item = queue.shift(); if (!item || typeof item !== "object") continue; if (Array.isArray(item)) { queue.push(...item); continue } const rec = item as Record<string, unknown>; for (const [key, value] of Object.entries(rec)) { const normalized = key.toLowerCase().replace(/[_-]/g, ""); if (wanted.has(normalized)) return value; if (value && typeof value === "object") queue.push(value) } } return undefined }
function findNestedValue(root: unknown, containerNames: string[], valueNames: string[]): unknown {
  const containers = new Set(containerNames.map((name) => name.toLowerCase().replace(/[_-]/g, "")))
  const values = new Set(valueNames.map((name) => name.toLowerCase().replace(/[_-]/g, "")))
  const queue = [root]
  while (queue.length) {
    const item = queue.shift()
    if (!item || typeof item !== "object") continue
    if (Array.isArray(item)) { queue.push(...item); continue }
    const rec = item as Record<string, unknown>
    for (const [key, value] of Object.entries(rec)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, "")
      if (containers.has(normalized)) {
        const direct = findValue(value, valueNames)
        if (direct !== undefined) return direct
      }
      if (value && typeof value === "object") queue.push(value)
    }
  }
  return undefined
}

class QuotaHttpError extends Error { constructor(readonly status: number, message: string, readonly bodyText: string) { super(message); this.name = "QuotaHttpError" } }
function safeParseJson(text: string): unknown { try { return JSON.parse(text) } catch { return undefined } }
function nestedErrorMessage(body: unknown): string | undefined { const rec = asRecord(body); const error = asRecord(rec.error); return pickString(error.message) ?? pickString(rec.message) }
function quotaHttpErrorMessage(status: number, bodyText: string, fallback: string): string {
  const body = safeParseJson(bodyText)
  const message = nestedErrorMessage(body)
  if (status === 401 || status === 403) return message ? `Authentication failed (${status}): ${message}` : `Authentication failed (${status}). Refresh provider credentials.`
  if (status === 429) return message ? `Rate limited (429): ${message}` : "Rate limited (429). Please try again later."
  return message ? `${status}: ${message}` : `${status} ${fallback}`
}
function quotaErrorStatus(error: unknown): "unavailable" | "error" { return error instanceof QuotaHttpError && (error.status === 401 || error.status === 403) ? "unavailable" : "error" }
function quotaErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> { const res = await fetch(url, { headers }); const text = await res.text(); if (!res.ok) throw new QuotaHttpError(res.status, quotaHttpErrorMessage(res.status, text, res.statusText), text); return text ? JSON.parse(text) : undefined }
// Credentials come from environment variables only.
type SecretValue = { value?: string; source: string; error?: string }
async function resolveSecret(envNames: string[]): Promise<SecretValue> {
  for (const name of envNames) {
    const value = pickString(process.env[name])
    if (value) return { value, source: `env:${name}` }
  }
  return { source: "missing", error: `no value found; set one of: ${envNames.join(", ")}` }
}
async function probeClaudeQuota(): Promise<ProviderQuotaSnapshot> {
  const fetchedAt = new Date().toISOString()
  const secret = await resolveSecret(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_ACCESS_TOKEN"])
  const token = secret.value
  if (!token) return { provider: "claude", status: "unavailable", source: secret.source, fetchedAt, windows: QUOTA_WINDOWS.map((w) => unavailableWindow(w, secret.source, `Claude OAuth token not found in env. ${secret.error || ""}`.trim())) }
  try {
    const raw = await fetchJson("https://api.anthropic.com/api/oauth/usage", { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "content-type": "application/json" })
    const source = `anthropic-oauth-usage:${secret.source}`
    const five = windowSnapshot("5h", findNestedValue(raw, ["fivehour", "fivehourusage", "fivehourwindow", "fivehourlimit", "fivehour", "five_hour", "session", "primarywindow"], ["utilization", "usedpercent", "usedpercentage"]), findNestedValue(raw, ["fivehour", "five_hour", "session", "primarywindow"], ["resetsat", "resetat", "resetafterseconds", "resetinseconds"]), source)
    const week = windowSnapshot("weekly", findNestedValue(raw, ["sevenday", "seven_day", "weekly", "week", "secondarywindow"], ["utilization", "usedpercent", "usedpercentage"]), findNestedValue(raw, ["sevenday", "seven_day", "weekly", "week", "secondarywindow"], ["resetsat", "resetat", "resetafterseconds", "resetinseconds"]), source)
    return { provider: "claude", status: five.status === "ok" && week.status === "ok" ? "ok" : five.status === "ok" || week.status === "ok" ? "partial" : "unavailable", source, fetchedAt, windows: [five, week], raw }
  } catch (err) {
    const error = quotaErrorMessage(err)
    const status = quotaErrorStatus(err)
    return { provider: "claude", status, source: `anthropic-oauth-usage:${secret.source}`, fetchedAt, windows: QUOTA_WINDOWS.map((w) => ({ ...unavailableWindow(w, `anthropic-oauth-usage:${secret.source}`, error), status })), error }
  }
}
async function probeCodexQuota(): Promise<ProviderQuotaSnapshot> {
  const fetchedAt = new Date().toISOString()
  const secret = await resolveSecret(["CODEX_ACCESS_TOKEN", "OPENAI_OAUTH_TOKEN", "OPENAI_ACCESS_TOKEN"])
  const accountSecret = await resolveSecret(["CHATGPT_ACCOUNT_ID", "OPENAI_ACCOUNT_ID"])
  const token = secret.value
  const accountId = accountSecret.value
  if (!token) return { provider: "codex", status: "unavailable", source: secret.source, fetchedAt, windows: QUOTA_WINDOWS.map((w) => unavailableWindow(w, secret.source, `Codex/ChatGPT OAuth token not found in env. ${secret.error || ""}`.trim())) }
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "content-type": "application/json" }
    if (accountId) headers["ChatGPT-Account-Id"] = accountId
    const raw = await fetchJson("https://chatgpt.com/backend-api/wham/usage", headers)
    const source = `chatgpt-wham-usage:${secret.source}${accountId ? `:${accountSecret.source}` : ""}`
    const five = windowSnapshot("5h", findNestedValue(raw, ["primarywindow", "primary_window", "fivehour", "five_hour", "burst"], ["usedpercent", "utilization"]), findNestedValue(raw, ["primarywindow", "primary_window", "fivehour", "five_hour", "burst"], ["resetafterseconds", "resetat", "resetsat"]), source)
    const week = windowSnapshot("weekly", findNestedValue(raw, ["secondarywindow", "secondary_window", "weekly", "week"], ["usedpercent", "utilization"]), findNestedValue(raw, ["secondarywindow", "secondary_window", "weekly", "week"], ["resetafterseconds", "resetat", "resetsat"]), source)
    return { provider: "codex", status: five.status === "ok" && week.status === "ok" ? "ok" : five.status === "ok" || week.status === "ok" ? "partial" : "unavailable", source, fetchedAt, windows: [five, week], raw }
  } catch (err) {
    const error = quotaErrorMessage(err)
    const status = quotaErrorStatus(err)
    return { provider: "codex", status, source: `chatgpt-wham-usage:${secret.source}`, fetchedAt, windows: QUOTA_WINDOWS.map((w) => ({ ...unavailableWindow(w, `chatgpt-wham-usage:${secret.source}`, error), status })), error }
  }
}
async function refreshQuota(params: QuotaParams = {}): Promise<QuotaSnapshot> { const requested = params.provider && params.provider !== "all" ? [params.provider] : QUOTA_PROVIDERS; const providers: ProviderQuotaSnapshot[] = []; for (const provider of requested) providers.push(provider === "claude" ? await probeClaudeQuota() : await probeCodexQuota()); const snapshot = { ok: providers.some((provider) => provider.status === "ok" || provider.status === "partial"), generatedAt: new Date().toISOString(), providers }; const text = `${JSON.stringify(snapshot, null, 2)}\n`; await mkdir(dirname(quotaPath()), { recursive: true }); await writeFile(quotaPath(), text, "utf8"); await mkdir(dirname(legacyQuotaPath()), { recursive: true }); await writeFile(legacyQuotaPath(), text, "utf8"); return snapshot }

function textResult(text: string, details?: unknown) { return { content: [{ type: "text", text }], details } }
function errorResult(error: unknown) { return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } }

export default function extension(api: { registerTool(tool: unknown): void }) {
  api.registerTool({ name: "refresh_ccusage_dashboard", description: "Run ccusage locally, write .pi/data/ccusage-dashboard/usage.json, and refresh the token dashboard data.", parameters: { type: "object", properties: { report: { type: "string", enum: REPORTS }, source: { type: "string", enum: SOURCES }, since: { type: "string" }, until: { type: "string" }, timezone: { type: "string" }, project: { type: "string" }, instances: { type: "boolean" }, offline: { type: "boolean" } }, additionalProperties: false }, async execute(params: Params) { try { const result = await runCcusage(params); const tokens = summarizeNumber(result.summary, result.data, ["totalTokens"], "totalTokens"); const cost = summarizeNumber(result.summary, result.data, ["totalCostUSD", "totalCost", "costUSD"], "costUSD"); return textResult(`Updated ccusage dashboard (${result.command.join(" ")}).\nRows: ${result.data.length}\nTokens: ${tokens.toLocaleString()}\nCost: $${Number(cost || 0).toFixed(2)}\nData: .pi/data/ccusage-dashboard/usage.json`, result) } catch (error) { return errorResult(error) } } })
  api.registerTool({ name: "read_ccusage_dashboard", description: "Read the last ccusage dashboard JSON snapshot from .pi/data/ccusage-dashboard/usage.json.", parameters: { type: "object", properties: {}, additionalProperties: false }, async execute() { try { const text = await readFile(usagePath(), "utf8"); return textResult(text, JSON.parse(text)) } catch (error) { return errorResult(error) } } })
  api.registerTool({ name: "refresh_provider_quota", description: "Best-effort refresh of Claude and Codex subscription quota windows. Writes .pi/data/ccusage-dashboard/quota.json.", parameters: { type: "object", properties: { provider: { type: "string", enum: ["all", ...QUOTA_PROVIDERS] } }, additionalProperties: false }, async execute(params: QuotaParams) { try { const snapshot = await refreshQuota(params); return textResult(`Updated provider quota snapshot. Providers: ${snapshot.providers.map((p) => `${p.provider}:${p.status}`).join(", ")}\nData: .pi/data/ccusage-dashboard/quota.json`, snapshot) } catch (error) { return errorResult(error) } } })
  api.registerTool({ name: "read_provider_quota", description: "Read .pi/data/ccusage-dashboard/quota.json.", parameters: { type: "object", properties: {}, additionalProperties: false }, async execute() { try { const text = await readFile(quotaPath(), "utf8"); return textResult(text, JSON.parse(text)) } catch (error) { return errorResult(error) } } })
}
