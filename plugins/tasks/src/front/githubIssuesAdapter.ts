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

const GITHUB_COLUMNS = [
  { id: "needs-triage", title: "Needs triage", description: "Not evaluated yet", color: "#d4c5f9" },
  { id: "needs-info", title: "Needs info", description: "Waiting on specific answers", color: "#f9d0c4" },
  { id: "ready-for-agent", title: "Ready for agent", description: "Agent can plan or implement safely", color: "#0e8a16" },
  { id: "ready-for-human", title: "Ready for human", description: "Human judgment, access, approval, review, or merge needed", color: "#f9a825" },
  { id: "done", title: "Done", description: "Closed GitHub issues", color: "#64748b" },
]

function issueLabels(issue: GitHubIssue): string[] {
  return (issue.labels ?? [])
    .map((label) => label.name?.trim())
    .filter((label): label is string => Boolean(label))
}

function issueStatus(issue: GitHubIssue): string {
  if (issue.state === "closed") return "done"
  const labels = issueLabels(issue).map((label) => label.toLowerCase())
  if (labels.includes("needs-info")) return "needs-info"
  if (labels.includes("ready-for-human")) return "ready-for-human"
  if (labels.includes("ready-for-agent")) return "ready-for-agent"
  return "needs-triage"
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
    tags: issueLabels(issue).filter((label) => !["needs-triage", "needs-info", "ready-for-agent", "ready-for-human"].includes(label.toLowerCase())),
    epic: issue.milestone ? {
      id: String(issue.milestone.id),
      title: issue.milestone.title,
      url: issue.milestone.html_url,
    } : undefined,
    adapterId,
    url: issue.html_url,
  }
}

export function createGitHubIssuesAdapter({ owner, repo, limit = 200, state = "open", moveIssue }: GitHubIssuesAdapterOptions): BoringTaskAdapter {
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
