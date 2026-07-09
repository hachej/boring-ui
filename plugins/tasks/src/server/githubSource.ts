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

export interface GitHubRepositoryDetector {
  detectRepository(input: { workspaceRoot: string }): Promise<{ owner: string; repo: string }>
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

interface WorkspaceGitHubTaskSourceOptions {
  workspaceRoot?: string
  sourceId?: string
  limit?: number
  state?: "open" | "closed" | "all"
  detector?: GitHubRepositoryDetector
  executorFactory?: (input: { workspaceRoot: string; owner: string; repo: string }) => GitHubIssueExecutor
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

function defaultWorkspaceRoot(): string {
  return process.env.BORING_AGENT_WORKSPACE_ROOT || process.cwd()
}

async function runGhJson<T>(args: string[], cwd = defaultWorkspaceRoot()): Promise<T> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      maxBuffer: 1024 * 1024 * 8,
      timeout: 30_000,
    })
    return JSON.parse(stdout) as T
  } catch {
    throw new TaskSourceServiceError(500, "TASK_GITHUB_COMMAND_FAILED", "GitHub command failed; check server authentication and repository access.")
  }
}

async function runGh(args: string[], cwd = defaultWorkspaceRoot()): Promise<void> {
  try {
    await execFileAsync("gh", args, {
      cwd,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    })
  } catch {
    throw new TaskSourceServiceError(500, "TASK_GITHUB_COMMAND_FAILED", "GitHub command failed; check server authentication and repository access.")
  }
}

export function createGhCliGitHubIssueExecutor(options: { workspaceRoot?: string } = {}): GitHubIssueExecutor {
  const repoArg = (owner: string, repo: string) => `${owner}/${repo}`
  const jsonFields = "number,title,body,url,state,labels,milestone"
  const cwd = options.workspaceRoot
  return {
    listIssues: ({ owner, repo, limit, state }) => runGhJson<GitHubIssue[]>([
      "issue", "list", "--repo", repoArg(owner, repo), "--state", state, "--limit", String(limit), "--json", jsonFields,
    ], cwd),
    viewIssue: ({ owner, repo, issueNumber }) => runGhJson<GitHubIssue>([
      "issue", "view", String(issueNumber), "--repo", repoArg(owner, repo), "--json", jsonFields,
    ], cwd),
    addLabels: async ({ owner, repo, issueNumber, labels }) => {
      if (labels.length === 0) return
      await runGh(["issue", "edit", String(issueNumber), "--repo", repoArg(owner, repo), "--add-label", labels.join(",")], cwd)
    },
    removeLabels: async ({ owner, repo, issueNumber, labels }) => {
      if (labels.length === 0) return
      await runGh(["issue", "edit", String(issueNumber), "--repo", repoArg(owner, repo), "--remove-label", labels.join(",")], cwd)
    },
    closeIssue: ({ owner, repo, issueNumber }) => runGh(["issue", "close", String(issueNumber), "--repo", repoArg(owner, repo)], cwd),
    reopenIssue: ({ owner, repo, issueNumber }) => runGh(["issue", "reopen", String(issueNumber), "--repo", repoArg(owner, repo)], cwd),
  }
}

export function createGhCliGitHubRepositoryDetector(): GitHubRepositoryDetector {
  return {
    async detectRepository({ workspaceRoot }) {
      const payload = await runGhJson<{ nameWithOwner?: string }>(["repo", "view", "--json", "nameWithOwner"], workspaceRoot)
      const [owner, repo] = payload.nameWithOwner?.split("/") ?? []
      if (!owner || !repo) {
        throw new TaskSourceServiceError(404, "TASK_GITHUB_REPO_NOT_FOUND", "No GitHub repository is associated with this workspace.")
      }
      return { owner, repo }
    },
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

export function createWorkspaceGitHubTaskSource({
  workspaceRoot,
  sourceId = "github:workspace",
  limit = 200,
  state = "open",
  detector = createGhCliGitHubRepositoryDetector(),
  executorFactory = ({ workspaceRoot }) => createGhCliGitHubIssueExecutor({ workspaceRoot }),
}: WorkspaceGitHubTaskSourceOptions = {}): BoringTaskSourceRuntime {
  const board: BoringTaskBoardConfig = {
    adapterId: sourceId,
    defaultColumnId: "queued",
    columns: GITHUB_COLUMNS,
  }

  const resolveWorkspaceRoot = (ctx: BoringTaskSourceContext): string => ctx.workspaceRoot ?? workspaceRoot ?? defaultWorkspaceRoot()
  const resolveRepo = async (ctx: BoringTaskSourceContext) => {
    const root = resolveWorkspaceRoot(ctx)
    const repoInfo = await detector.detectRepository({ workspaceRoot: root })
    return { ...repoInfo, workspaceRoot: root }
  }

  return {
    summary: () => ({
      id: sourceId,
      label: "GitHub repository",
      description: "GitHub Issues from the current workspace repository via gh CLI",
      capabilities: { move: true },
    }),
    getBoardConfig: () => board,
    async listTasks(ctx): Promise<BoringTaskCard[]> {
      const repoInfo = await resolveRepo(ctx)
      const executor = executorFactory(repoInfo)
      const issues = await executor.listIssues({ owner: repoInfo.owner, repo: repoInfo.repo, limit, state })
      return issues.map((issue) => taskFromIssue(issue, sourceId))
    },
    async moveTask(ctx, { taskId, statusId }): Promise<BoringTaskCard> {
      const issueNumber = Number(taskId)
      if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
        throw new TaskSourceServiceError(400, "TASK_INVALID_ID", `Invalid GitHub issue task id: ${taskId}`)
      }
      const mapping = STATUS_MAPPINGS[statusId]
      if (!mapping) throw new TaskSourceServiceError(400, "TASK_STATUS_NOT_FOUND", `Unknown GitHub task status: ${statusId}`)

      const repoInfo = await resolveRepo(ctx)
      const executor = executorFactory(repoInfo)
      const input = { owner: repoInfo.owner, repo: repoInfo.repo, issueNumber }
      const before = await executor.viewIssue(input)
      if (mapping.close) await executor.closeIssue(input)
      if (mapping.reopen && before.state.toLowerCase() === "closed") await executor.reopenIssue(input)
      if (mapping.removeStateLabels) {
        const stateLabels = issueLabels(before).filter((label) => label.toLowerCase().startsWith("state:"))
        await executor.removeLabels({ ...input, labels: stateLabels })
      }
      await executor.addLabels({ ...input, labels: mapping.addLabels ?? [] })
      const after = await executor.viewIssue(input)
      return taskFromIssue(after, sourceId)
    },
  }
}

export const githubStatusMappings = STATUS_MAPPINGS
