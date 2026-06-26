import type { PrData } from "./types"

const DATA_PATH = ".pi/extensions/github-pr-tracker/prs.json"

export function relativeTime(value?: string): string {
  if (!value) return "unknown"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "unknown"
  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  const divisions: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]
  for (const [unit, amount] of divisions) {
    if (Math.abs(seconds) >= amount || unit === "minute") return formatter.format(Math.round(seconds / amount), unit)
  }
  return formatter.format(seconds, "second")
}

export function timestamp(value?: string): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function buildPortUrl(port: number): string {
  if (typeof window === "undefined") return `http://localhost:${port}/`
  const url = new URL(window.location.href)
  url.port = String(port)
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  return url.toString()
}

function workspaceIdFromLocation(): string | undefined {
  const importMatch = /\/runtime\/([^/?#]+)\//.exec(import.meta.url)
  if (importMatch?.[1]) return importMatch[1]
  if (typeof window === "undefined") return undefined
  const direct = new URLSearchParams(window.location.search).get("workspaceId")
  if (direct) return direct
  const pathMatch = /\/runtime\/([^/?#]+)/.exec(window.location.pathname)
  return pathMatch?.[1]
}

export async function fetchPrData(): Promise<PrData> {
  const query = new URLSearchParams({ path: DATA_PATH, t: String(Date.now()) })
  const workspaceId = workspaceIdFromLocation()
  if (workspaceId) query.set("workspaceId", workspaceId)
  const headers: Record<string, string> = {}
  if (workspaceId) headers["x-boring-workspace-id"] = workspaceId
  const response = await fetch(`/api/v1/files/raw?${query.toString()}`, { credentials: "include", headers })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`No PR data yet. Ask the agent to refresh github pr tracker.${detail ? ` (${response.status}: ${detail.slice(0, 160)})` : ""}`)
  }
  return await response.json() as PrData
}

async function readResponseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  if (!text) return `agent request failed (${response.status})`
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = typeof parsed.error?.message === "string"
      ? parsed.error.message
      : typeof parsed.message === "string"
        ? parsed.message
        : text
    return `${message} (${response.status})`
  } catch {
    return `${text.slice(0, 200)} (${response.status})`
  }
}

async function sendAgentChat(message: string): Promise<void> {
  const workspaceId = workspaceIdFromLocation()
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (workspaceId) headers["x-boring-workspace-id"] = workspaceId

  // The old /api/v1/agent/chat endpoint no longer exists. Use the Pi chat
  // API directly: create a short-lived session and submit the prompt to it.
  const sessionResponse = await fetch(`/api/v1/agent/pi-chat/sessions${query}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ title: "GitHub PR Tracker refresh" }),
  })
  if (!sessionResponse.ok) throw new Error(await readResponseError(sessionResponse))
  const session = await sessionResponse.json().catch(() => null) as { id?: unknown } | null
  const sessionId = typeof session?.id === "string" ? session.id : undefined
  if (!sessionId) throw new Error("agent session creation did not return a session id")

  const promptResponse = await fetch(`/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/prompt${query}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      message,
      clientNonce: `github-pr-tracker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    }),
  })
  if (!promptResponse.ok) throw new Error(await readResponseError(promptResponse))
  await promptResponse.text().catch(() => undefined)
}

export async function requestServerRefresh(): Promise<void> {
  const workspaceId = workspaceIdFromLocation()
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""
  const headers: Record<string, string> = {}
  if (workspaceId) headers["x-boring-workspace-id"] = workspaceId
  const response = await fetch(`/api/v1/github-pr-tracker/refresh${query}`, { method: "POST", credentials: "include", headers })
  if (!response.ok) throw new Error(await readResponseError(response))
  await response.json().catch(() => undefined)
}

export async function requestAgentRefresh(): Promise<void> {
  try { await requestServerRefresh(); return } catch {}
  await sendAgentChat("refresh github pr tracker")
}

export async function requestAgentClassifyIssues(): Promise<void> {
  await sendAgentChat("Classify all open GitHub issues in the GitHub PR Tracker data into exactly one difficulty label: easy or needs-plan. Then apply labels with label_github_issue. Use easy only for small, self-contained issues; use needs-plan for broad/ambiguous/risky/multi-file work. If an issue is ready for boring-claw/bead workflow, add bclaw:ready. Also keep/assign one board status label if obvious: status:to-plan, status:to-review, or status:to-merge. Refresh github pr tracker after labeling.")
}

export async function requestAgentLabelIssue(number: number, add: string[], remove: string[] = []): Promise<void> {
  const parts = [
    add.length > 0 ? `add ${add.map((label) => JSON.stringify(label)).join(", ")}` : null,
    remove.length > 0 ? `remove ${remove.map((label) => JSON.stringify(label)).join(", ")}` : null,
  ].filter(Boolean).join(" and ")
  await sendAgentChat(`Use the label_github_issue tool to update labels on issue #${number}: ${parts}.`)
}

export async function requestAgentLabel(number: number, add: string[], remove: string[]): Promise<void> {
  const parts = [
    add.length > 0 ? `add ${add.map((label) => JSON.stringify(label)).join(", ")}` : null,
    remove.length > 0 ? `remove ${remove.map((label) => JSON.stringify(label)).join(", ")}` : null,
  ].filter(Boolean).join(" and ")
  await sendAgentChat(`Use the label_github_pr tool to update labels on PR #${number}: ${parts}.`)
}

export function isDocOrTestFile(path: string): boolean {
  const value = path.toLowerCase()
  return /(^|\/)(docs?|documentation|__tests__|tests?|test|spec|e2e|eval|scripts?|mocks?|__mocks__|fixtures?|__fixtures__)(\/|$)/.test(value) ||
    /(^|\/)(readme|changelog|license|contributing)(\.[a-z0-9]+)?$/.test(value) ||
    /\.(md|mdx|rst|adoc|txt|snap)$/.test(value) ||
    /\.(test|spec)\.[a-z0-9]+$/.test(value) ||
    /(^|\/)\.beads(\/|$)/.test(value) ||
    /(^|\/)\.github(\/(workflows|actions))?\//.test(value)
}

export function changeWeight(item: { additions: number; deletions: number }): number {
  return Math.max(1, item.additions + item.deletions)
}
