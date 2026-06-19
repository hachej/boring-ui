import type { WorkspacePluginClient } from "@hachej/boring-workspace"
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

export async function fetchPrData(client: WorkspacePluginClient): Promise<PrData> {
  return client.readJsonFile<PrData>(DATA_PATH, {
    missingMessage: "No PR data yet. Ask the agent to refresh github pr tracker.",
  })
}

async function sendAgentChat(client: WorkspacePluginClient, message: string): Promise<void> {
  await client.sendAgentPrompt(message, {
    title: "GitHub PR Tracker refresh",
    noncePrefix: "github-pr-tracker",
  })
}

export async function requestServerRefresh(client: WorkspacePluginClient): Promise<void> {
  await client.postJson("/api/v1/github-pr-tracker/refresh")
}

export async function requestAgentRefresh(client: WorkspacePluginClient): Promise<void> {
  try { await requestServerRefresh(client); return } catch {}
  await sendAgentChat(client, "refresh github pr tracker")
}

export async function requestAgentClassifyIssues(client: WorkspacePluginClient): Promise<void> {
  await sendAgentChat(client, "Classify all open GitHub issues in the GitHub PR Tracker data into exactly one difficulty label: easy or needs-plan. Then apply labels with label_github_issue. Use easy only for small, self-contained issues; use needs-plan for broad/ambiguous/risky/multi-file work. If an issue is ready for boring-claw/bead workflow, add bclaw:ready. Also keep/assign one board status label if obvious: status:to-plan, status:to-review, or status:to-merge. Refresh github pr tracker after labeling.")
}

export async function requestAgentLabelIssue(client: WorkspacePluginClient, number: number, add: string[], remove: string[] = []): Promise<void> {
  const parts = [
    add.length > 0 ? `add ${add.map((label) => JSON.stringify(label)).join(", ")}` : null,
    remove.length > 0 ? `remove ${remove.map((label) => JSON.stringify(label)).join(", ")}` : null,
  ].filter(Boolean).join(" and ")
  await sendAgentChat(client, `Use the label_github_issue tool to update labels on issue #${number}: ${parts}.`)
}

export async function requestAgentLabel(client: WorkspacePluginClient, number: number, add: string[], remove: string[]): Promise<void> {
  const parts = [
    add.length > 0 ? `add ${add.map((label) => JSON.stringify(label)).join(", ")}` : null,
    remove.length > 0 ? `remove ${remove.map((label) => JSON.stringify(label)).join(", ")}` : null,
  ].filter(Boolean).join(" and ")
  await sendAgentChat(client, `Use the label_github_pr tool to update labels on PR #${number}: ${parts}.`)
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
