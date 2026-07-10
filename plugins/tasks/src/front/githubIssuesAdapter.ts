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
  state?: "open" | "closed" | "all"
  /**
   * Optional hosted mover. The browser demo intentionally omits this; hosted
   * apps can route it to a backend that uses `gh` CLI today or GitHub API later.
   */
  moveIssue?: (input: GitHubMoveIssueInput) => Promise<BoringTaskCard | void> | BoringTaskCard | void
}

interface GitHubIssueLabel {
  name?: string
}

interface GitHubMilestone {
  id: number
  title: string
  html_url?: string
}

interface GitHubIssue {
  id: number
  number: number
  title: string
  body?: string | null
  html_url?: string
  state: "open" | "closed"
  labels?: GitHubIssueLabel[]
  milestone?: GitHubMilestone | null
  pull_request?: unknown
}

interface GitHubPullRequest {
  id: number
  number: number
  title: string
  body?: string | null
  html_url?: string
  state: "open" | "closed"
}

const GITHUB_COLUMNS = [
  { id: "needs-triage", title: "Needs triage", description: "Fresh issues that need a first pass", color: "#8b5cf6" },
  { id: "needs-info", title: "Needs info", description: "Blocked on clarification or missing context", color: "#ef4444" },
  { id: "ready-for-agent", title: "Ready for agent", description: "Clear agent-pickable work", color: "#0ea5e9" },
  { id: "ready-for-human", title: "Ready for human", description: "Waiting for owner review or human decision", color: "#f59e0b" },
  { id: "done", title: "Done", description: "Closed GitHub issues", color: "#64748b", acceptsDrop: false },
]

const WORKFLOW_LABELS = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "done"]

function issueLabels(issue: GitHubIssue): string[] {
  return (issue.labels ?? [])
    .map((label) => label.name?.trim())
    .filter((label): label is string => Boolean(label))
}

function issueStatus(issue: GitHubIssue): string {
  if (issue.state === "closed") return "done"
  const labels = issueLabels(issue).map((label) => label.toLowerCase())
  return WORKFLOW_LABELS.find((label) => labels.includes(label)) ?? "needs-triage"
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

function associatedPullRequests(issue: GitHubIssue, pullRequests: readonly GitHubPullRequest[]): GitHubPullRequest[] {
  const issueRef = `#${issue.number}`
  const issueUrl = issue.html_url?.toLowerCase()
  return pullRequests.filter((pr) => {
    const haystack = `${pr.title}\n${pr.body ?? ""}\n${pr.html_url ?? ""}`.toLowerCase()
    return haystack.includes(issueRef.toLowerCase()) || Boolean(issueUrl && haystack.includes(issueUrl))
  })
}

function taskFromIssue(issue: GitHubIssue, adapterId: string, pullRequests: readonly GitHubPullRequest[] = []): BoringTaskCard {
  const prs = associatedPullRequests(issue, pullRequests)
  return {
    id: String(issue.id),
    number: `#${issue.number}`,
    title: issue.title,
    description: descriptionFromBody(issue.body),
    statusId: issueStatus(issue),
    tags: issueLabels(issue).filter((label) => !WORKFLOW_LABELS.includes(label.toLowerCase())),
    epic: issue.milestone ? {
      id: String(issue.milestone.id),
      title: issue.milestone.title,
      url: issue.milestone.html_url,
    } : undefined,
    adapterId,
    pullRequests: prs.map((pr) => ({
      id: String(pr.id),
      number: `#${pr.number}`,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
    })),
    url: issue.html_url,
  }
}

export function createGitHubIssuesAdapter({ owner, repo, limit = 200, state = "open", moveIssue }: GitHubIssuesAdapterOptions): BoringTaskAdapter {
  const adapterId = `github:${owner}/${repo}`
  const board: BoringTaskBoardConfig = {
    adapterId,
    defaultColumnId: "needs-triage",
    columns: GITHUB_COLUMNS,
  }

  const taskCache = new Map<string, BoringTaskCard>()
  const issueNumberByTaskId = new Map<string, number>()

  return {
    id: adapterId,
    label: `GitHub ${owner}/${repo}`,
    description: moveIssue ? "GitHub Issues adapter; Boring v2 labels drive columns" : "Read-only GitHub Issues adapter; Boring v2 labels drive columns",
    capabilities: { move: Boolean(moveIssue) },
    getBoardConfig: () => board,
    async listTasks(): Promise<BoringTaskCard[]> {
      const params = new URLSearchParams({
        state,
        per_page: String(Math.min(Math.max(limit, 1), 100)),
        sort: "updated",
        direction: "desc",
      })
      const issues: GitHubIssue[] = []
      const maxPages = Math.ceil(Math.min(Math.max(limit, 1), 300) / 100)
      for (let page = 1; page <= maxPages; page += 1) {
        params.set("page", String(page))
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?${params.toString()}`, {
          headers: { Accept: "application/vnd.github+json" },
        })
        if (!response.ok) {
          throw new Error(`GitHub issues request failed (${response.status})`)
        }
        const pageIssues = await response.json() as GitHubIssue[]
        issues.push(...pageIssues)
        if (pageIssues.length < Number(params.get("per_page"))) break
      }
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
