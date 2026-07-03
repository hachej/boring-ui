import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { BoringTaskBoardConfig, BoringTaskCard } from "../shared"
import type { BoringTaskSourceContext, BoringTaskSourceRuntime } from "./sourceRuntime"
import { TaskSourceServiceError } from "./taskSourceService"

const execFileAsync = promisify(execFile)

interface GitHubLabel { name?: string }
interface GitHubMilestone { id?: number; number?: number; title?: string; url?: string }
interface GitHubIssue {
  number: number
  title: string
  body?: string | null
  url?: string
  state: "OPEN" | "CLOSED" | "open" | "closed"
  labels?: GitHubLabel[]
  milestone?: GitHubMilestone | null
}

export interface GitHubIssueExecutor {
  listIssues(input: { owner: string; repo: string; limit: number; state: "open" | "closed" | "all" }): Promise<GitHubIssue[]>
  viewIssue(input: { owner: string; repo: string; issueNumber: number }): Promise<GitHubIssue>
  addLabels(input: { owner: string; repo: string; issueNumber: number; labels: string[] }): Promise<void>
  removeLabels(input: { owner: string; repo: string; issueNumber: number; labels: string[] }): Promise<void>
  closeIssue(input: { owner: string; repo: string; issueNumber: number }): Promise<void>
  reopenIssue(input: { owner: string; repo: string; issueNumber: number }): Promise<void>
}

interface GitHubStatusMapping {
  addLabels?: string[]
  removeStateLabels?: boolean
  close?: boolean
  reopen?: boolean
}

interface GitHubTaskSourceOptions {
  owner: string
  repo: string
  limit?: number
  state?: "open" | "closed" | "all"
  executor?: GitHubIssueExecutor
}

const GITHUB_COLUMNS = [
  { id: "queued", title: "Queued", description: "Open issues waiting for work", color: "#8b5cf6" },
  { id: "active", title: "Active", description: "In flight or currently owned", color: "#f59e0b" },
  { id: "ready", title: "Ready", description: "Ready for merge/review/next gate", color: "#22c55e" },
  { id: "blocked", title: "Blocked", description: "Waiting on clarification or external input", color: "#ef4444" },
  { id: "done", title: "Done", description: "Closed GitHub issues", color: "#64748b" },
]

const STATUS_MAPPINGS: Record<string, GitHubStatusMapping> = {
  queued: { removeStateLabels: true, addLabels: ["state:queued"], reopen: true },
  active: { removeStateLabels: true, addLabels: ["state:active"], reopen: true },
  ready: { removeStateLabels: true, addLabels: ["state:ready"], reopen: true },
  blocked: { removeStateLabels: true, addLabels: ["state:blocked"], reopen: true },
  done: { removeStateLabels: true, close: true },
}

function workspaceRoot(): string {
  return process.env.BORING_AGENT_WORKSPACE_ROOT || process.cwd()
}

async function runGhJson<T>(args: string[]): Promise<T> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd: workspaceRoot(),
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      maxBuffer: 1024 * 1024 * 8,
      timeout: 30_000,
    })
    return JSON.parse(stdout) as T
  } catch {
    throw new TaskSourceServiceError(500, "TASK_GITHUB_COMMAND_FAILED", "GitHub command failed; check server authentication and repository access.")
  }
}

async function runGh(args: string[]): Promise<void> {
  try {
    await execFileAsync("gh", args, {
      cwd: workspaceRoot(),
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    })
  } catch {
    throw new TaskSourceServiceError(500, "TASK_GITHUB_COMMAND_FAILED", "GitHub command failed; check server authentication and repository access.")
  }
}

export function createGhCliGitHubIssueExecutor(): GitHubIssueExecutor {
  const repoArg = (owner: string, repo: string) => `${owner}/${repo}`
  const jsonFields = "number,title,body,url,state,labels,milestone"
  return {
    listIssues: ({ owner, repo, limit, state }) => runGhJson<GitHubIssue[]>([
      "issue", "list", "--repo", repoArg(owner, repo), "--state", state, "--limit", String(limit), "--json", jsonFields,
    ]),
    viewIssue: ({ owner, repo, issueNumber }) => runGhJson<GitHubIssue>([
      "issue", "view", String(issueNumber), "--repo", repoArg(owner, repo), "--json", jsonFields,
    ]),
    addLabels: async ({ owner, repo, issueNumber, labels }) => {
      if (labels.length === 0) return
      await runGh(["issue", "edit", String(issueNumber), "--repo", repoArg(owner, repo), "--add-label", labels.join(",")])
    },
    removeLabels: async ({ owner, repo, issueNumber, labels }) => {
      if (labels.length === 0) return
      await runGh(["issue", "edit", String(issueNumber), "--repo", repoArg(owner, repo), "--remove-label", labels.join(",")])
    },
    closeIssue: ({ owner, repo, issueNumber }) => runGh(["issue", "close", String(issueNumber), "--repo", repoArg(owner, repo)]),
    reopenIssue: ({ owner, repo, issueNumber }) => runGh(["issue", "reopen", String(issueNumber), "--repo", repoArg(owner, repo)]),
  }
}

function issueLabels(issue: GitHubIssue): string[] {
  return (issue.labels ?? []).map((label) => label.name?.trim()).filter((label): label is string => Boolean(label))
}

function issueStatus(issue: GitHubIssue): string {
  if (issue.state.toLowerCase() === "closed") return "done"
  const labels = issueLabels(issue).map((label) => label.toLowerCase())
  const state = labels.find((label) => label.startsWith("state:"))
  if (state === "state:active") return "active"
  if (state === "state:ready") return "ready"
  if (state === "state:blocked") return "blocked"
  return "queued"
}

function descriptionFromBody(body: string | null | undefined): string | undefined {
  if (!body) return undefined
  const compact = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#>*_\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact || undefined
}

function taskFromIssue(issue: GitHubIssue, adapterId: string): BoringTaskCard {
  return {
    id: String(issue.number),
    number: `#${issue.number}`,
    title: issue.title,
    description: descriptionFromBody(issue.body),
    statusId: issueStatus(issue),
    tags: issueLabels(issue).filter((label) => !label.toLowerCase().startsWith("state:")),
    epic: issue.milestone?.title ? {
      id: String(issue.milestone.id ?? issue.milestone.number ?? issue.milestone.title),
      title: issue.milestone.title,
      url: issue.milestone.url,
    } : undefined,
    adapterId,
    url: issue.url,
  }
}

export function createGitHubTaskSource({ owner, repo, limit = 200, state = "open", executor = createGhCliGitHubIssueExecutor() }: GitHubTaskSourceOptions): BoringTaskSourceRuntime {
  const sourceId = `github:${owner}/${repo}`
  const board: BoringTaskBoardConfig = {
    adapterId: sourceId,
    defaultColumnId: "queued",
    columns: GITHUB_COLUMNS,
  }

  return {
    summary: () => ({
      id: sourceId,
      label: `GitHub ${owner}/${repo}`,
      description: "GitHub Issues via backend task source",
      capabilities: { move: true },
    }),
    getBoardConfig: () => board,
    async listTasks(_ctx: BoringTaskSourceContext): Promise<BoringTaskCard[]> {
      const issues = await executor.listIssues({ owner, repo, limit, state })
      return issues.map((issue) => taskFromIssue(issue, sourceId))
    },
    async moveTask(_ctx, { taskId, statusId }): Promise<BoringTaskCard> {
      const issueNumber = Number(taskId)
      if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
        throw new TaskSourceServiceError(400, "TASK_INVALID_ID", `Invalid GitHub issue task id: ${taskId}`)
      }
      const mapping = STATUS_MAPPINGS[statusId]
      if (!mapping) throw new TaskSourceServiceError(400, "TASK_STATUS_NOT_FOUND", `Unknown GitHub task status: ${statusId}`)

      const before = await executor.viewIssue({ owner, repo, issueNumber })
      if (mapping.close) await executor.closeIssue({ owner, repo, issueNumber })
      if (mapping.reopen && before.state.toLowerCase() === "closed") await executor.reopenIssue({ owner, repo, issueNumber })
      if (mapping.removeStateLabels) {
        const stateLabels = issueLabels(before).filter((label) => label.toLowerCase().startsWith("state:"))
        await executor.removeLabels({ owner, repo, issueNumber, labels: stateLabels })
      }
      await executor.addLabels({ owner, repo, issueNumber, labels: mapping.addLabels ?? [] })
      const after = await executor.viewIssue({ owner, repo, issueNumber })
      return taskFromIssue(after, sourceId)
    },
  }
}

export const githubStatusMappings = STATUS_MAPPINGS
