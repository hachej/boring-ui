import type { BoringTaskAdapter, BoringTaskBoardConfig, BoringTaskCard } from "../shared"

interface GitHubMoveIssueInput {
  owner: string
  repo: string
  issueNumber: number
  statusId: string
}

interface GitHubIssuesAdapterOptions {
  owner: string
  repo: string
  limit?: number
  /**
   * Optional hosted mover. The browser demo intentionally omits this; hosted
   * apps can route it to a backend that uses `gh` CLI today or GitHub API later.
   */
  moveIssue?: (input: GitHubMoveIssueInput) => Promise<BoringTaskCard | void> | BoringTaskCard | void
}

interface GitHubIssueLabel {
  name?: string
}

interface GitHubIssue {
  id: number
  number: number
  title: string
  body?: string | null
  html_url?: string
  state: "open" | "closed"
  labels?: GitHubIssueLabel[]
  pull_request?: unknown
}

const GITHUB_COLUMNS = [
  { id: "queued", title: "Queued", description: "Open issues waiting for work", color: "#8b5cf6" },
  { id: "active", title: "Active", description: "In flight or currently owned", color: "#f59e0b" },
  { id: "ready", title: "Ready", description: "Ready for merge/review/next gate", color: "#22c55e" },
  { id: "blocked", title: "Blocked", description: "Waiting on clarification or external input", color: "#ef4444", acceptsDrop: false },
  { id: "done", title: "Done", description: "Closed GitHub issues", color: "#64748b", acceptsDrop: false },
]

function issueLabels(issue: GitHubIssue): string[] {
  return (issue.labels ?? [])
    .map((label) => label.name?.trim())
    .filter((label): label is string => Boolean(label))
}

function issueStatus(issue: GitHubIssue): string {
  if (issue.state === "closed") return "done"
  const labels = issueLabels(issue).map((label) => label.toLowerCase())
  const state = labels.find((label) => label?.startsWith("state:"))
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
    id: String(issue.id),
    number: `#${issue.number}`,
    title: issue.title,
    description: descriptionFromBody(issue.body),
    statusId: issueStatus(issue),
    tags: issueLabels(issue).filter((label) => !label.toLowerCase().startsWith("state:")),
    adapterId,
    url: issue.html_url,
  }
}

export function createGitHubIssuesAdapter({ owner, repo, limit = 40, moveIssue }: GitHubIssuesAdapterOptions): BoringTaskAdapter {
  const adapterId = `github:${owner}/${repo}`
  const board: BoringTaskBoardConfig = {
    adapterId,
    defaultColumnId: "queued",
    columns: GITHUB_COLUMNS,
  }

  const taskCache = new Map<string, BoringTaskCard>()
  const issueNumberByTaskId = new Map<string, number>()

  return {
    id: adapterId,
    label: `GitHub ${owner}/${repo}`,
    description: moveIssue ? "GitHub Issues adapter; state labels drive columns" : "Read-only GitHub Issues adapter; state labels drive columns",
    capabilities: { move: Boolean(moveIssue) },
    getBoardConfig: () => board,
    async listTasks(): Promise<BoringTaskCard[]> {
      const params = new URLSearchParams({
        state: "all",
        per_page: String(Math.min(Math.max(limit, 1), 100)),
        sort: "updated",
        direction: "desc",
      })
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?${params.toString()}`, {
        headers: { Accept: "application/vnd.github+json" },
      })
      if (!response.ok) {
        throw new Error(`GitHub issues request failed (${response.status})`)
      }
      const issues = await response.json() as GitHubIssue[]
      const tasks = issues
        .filter((issue) => !issue.pull_request)
        .map((issue) => {
          const task = taskFromIssue(issue, adapterId)
          taskCache.set(task.id, task)
          issueNumberByTaskId.set(task.id, issue.number)
          return task
        })
      return tasks
    },
    moveTask: moveIssue ? async ({ taskId, statusId }) => {
      const issueNumber = issueNumberByTaskId.get(taskId)
      const cached = taskCache.get(taskId)
      if (!issueNumber || !cached) throw new Error("GitHub issue is not loaded; refresh tasks and try again.")
      const moved = await moveIssue({ owner, repo, issueNumber, statusId })
      const next = moved ?? { ...cached, statusId }
      taskCache.set(taskId, next)
      return next
    } : undefined,
  }
}
