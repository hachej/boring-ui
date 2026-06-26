import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const DATA_PATH = ".pi/data/github-pr-tracker/prs.json"

type Source = "body" | "comment"

interface GhUser { login?: string; name?: string }
interface GhLabel { name?: string }
interface GhComment { body?: string; author?: GhUser | null; createdAt?: string; updatedAt?: string }
interface GhStatusCheck { conclusion?: string | null; status?: string | null; state?: string | null }
interface GhFile { path?: string; additions?: number; deletions?: number; changeType?: string; patch?: string }
interface GhIssue {
  number: number
  title: string
  body?: string | null
  url: string
  author?: GhUser | null
  createdAt?: string
  updatedAt?: string
  labels?: GhLabel[]
  comments?: GhComment[]
}

interface GhPullRequest {
  number: number
  title: string
  body?: string | null
  url: string
  author?: GhUser | null
  headRefName?: string
  baseRefName?: string
  createdAt?: string
  updatedAt?: string
  isDraft?: boolean
  reviewDecision?: string | null
  mergeStateStatus?: string | null
  labels?: GhLabel[]
  comments?: GhComment[]
  statusCheckRollup?: GhStatusCheck[]
  additions?: number
  deletions?: number
  changedFiles?: number
  files?: GhFile[]
}

function workspaceRoot(): string {
  return process.env.BORING_AGENT_WORKSPACE_ROOT || process.cwd()
}

async function runGhJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("gh", args, {
    cwd: workspaceRoot(),
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    maxBuffer: 1024 * 1024 * 12,
    timeout: 30_000,
  })
  return JSON.parse(stdout) as T
}

async function runGhText(args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd: workspaceRoot(),
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    })
    return stdout.trim()
  } catch {
    return undefined
  }
}

async function runGhDiff(number: number): Promise<string> {
  const args = ["pr", "diff", String(number), "--patch", "--color", "never"]
  const opts = {
    cwd: workspaceRoot(),
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    maxBuffer: 1024 * 1024 * 80,
    timeout: 90_000,
  }
  try {
    const { stdout } = await execFileAsync("gh", args, opts)
    return stdout
  } catch (firstError) {
    // Large PRs can exhaust the buffer or hit network timeouts on the first
    // attempt. Retry once with a smaller timeout as a quick second chance —
    // gh tends to warm up its connection on the first call.
    try {
      const { stdout } = await execFileAsync("gh", args, { ...opts, timeout: 60_000 })
      return stdout
    } catch {
      // Last resort: fetch per-file patches via the REST API in smaller chunks.
      return await runGhDiffViaApi(number)
    }
  }
}

async function runGhDiffViaApi(number: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["api", `repos/:owner/:repo/pulls/${number}`, "-H", "Accept: application/vnd.github.diff"],
      {
        cwd: workspaceRoot(),
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
        maxBuffer: 1024 * 1024 * 80,
        timeout: 90_000,
      },
    )
    return stdout
  } catch {
    return ""
  }
}
function parseDiffPatches(diff: string): Map<string, string> {
  const patches = new Map<string, string>()
  let currentPath: string | null = null
  let current: string[] = []
  const flush = () => {
    if (currentPath) patches.set(currentPath, current.join("\n"))
    currentPath = null
    current = []
  }
  for (const line of diff.split(/\r?\n/)) {
    const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(line)
    if (match) {
      flush()
      currentPath = match[2] || match[1] || "unknown"
    }
    if (currentPath) current.push(line)
  }
  flush()
  return patches
}

async function fetchPatchesForFiles(
  number: number,
  filePaths: string[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  if (filePaths.length === 0) return results

  // Single paginated API call fetches ALL files with their patches at once.
  // --paginate auto-follows Link headers so even 217-file PRs work in one shot.
  // Each output line is a JSON array: ["path/to/file", "patch text..."]
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "api", "--paginate",
        `repos/:owner/:repo/pulls/${number}/files?per_page=100`,
        "--jq",
        `.[] | [.filename, (.patch // "")] | @json`,
      ],
      {
        cwd: workspaceRoot(),
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
        maxBuffer: 1024 * 1024 * 80,
        timeout: 60_000,
      },
    )
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const [filename, patch] = JSON.parse(trimmed) as [string, string]
        if (filename && patch) {
          const header = `diff --git a/${filename} b/${filename}`
          results.set(filename, `${header}\n${patch}`)
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Fallback failed too — return whatever we have
  }
  return results
}

async function collectPatches(number: number, filePaths: string[], totalLines = 0): Promise<Map<string, string>> {
  // GitHub refuses whole-PR diffs above 20k changed lines (HTTP 406), so for
  // huge PRs skip straight to the per-file API — the bulk attempts can only
  // waste their timeouts.
  if (totalLines > 18_000) {
    return await fetchPatchesForFiles(number, filePaths)
  }
  // Fast path: fetch the whole diff in one shot.
  const bulkDiff = await runGhDiff(number)
  const patches = parseDiffPatches(bulkDiff)

  // Detect missing files — gh pr diff may silently drop some files for
  // very large PRs, or the bulk call may have failed entirely.
  const missing = filePaths.filter((path) => !patches.has(path))
  if (missing.length === 0) return patches

  // Fallback: fetch missing file patches individually.
  // This is slower but reliable — each request is tiny.
  const fallback = await fetchPatchesForFiles(number, missing)
  for (const [path, patch] of fallback) patches.set(path, patch)
  return patches
}

function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1000 && port <= 65535
}

function collectPorts(text: string | null | undefined, source: Source, author?: string, postedAt?: string) {
  if (!text) return []
  const ports = new Map<number, unknown>()
  const add = (raw: string, snippet: string) => {
    const port = Number(raw)
    if (!isValidPort(port) || ports.has(port)) return
    ports.set(port, { port, source, author, postedAt, text: stripMarkdown(snippet).slice(0, 180) })
  }
  for (const match of text.matchAll(/https?:\/\/[^\s)]+:(\d{2,5})(?:[/?#\s)]|$)/gi)) add(match[1] ?? "", match[0] ?? "")
  for (const match of text.matchAll(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])\s*:\s*(\d{2,5})\b/gi)) add(match[1] ?? "", match[0] ?? "")
  for (const match of text.matchAll(/\b(?:port|localhost|preview|test|workspace|vite|server|app)\b[^\n\r]{0,80}?\b(\d{2,5})\b/gi)) add(match[1] ?? "", match[0] ?? "")
  return Array.from(ports.values())
}

const PROOF_CONTEXT = /\b(visual\s*proof|proof|screenshot|screen\s*recording|recording|video|preview|ui\s*review|browser|playwright|artifact)\b/i
const AGENT_AUTHOR = /\b(agent|bot|claude|codex|copilot|pi|boring)\b/i

function lineContext(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index)
  const end = text.indexOf("\n", index)
  return stripMarkdown(text.slice(start === -1 ? 0 : start + 1, end === -1 ? text.length : end)).slice(0, 220)
}

function normalizeUrl(raw: string, prUrl: string): string | null {
  try { return new URL(raw.trim().replace(/^<|>$/g, ""), prUrl).toString() } catch { return null }
}

function kind(url: string, forceImage = false): "image" | "video" | "link" {
  if (forceImage || /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(url)) return "image"
  if (/\.(mp4|webm|mov|m4v)(?:[?#].*)?$/i.test(url)) return "video"
  return "link"
}

function collectProofs(text: string | null | undefined, prUrl: string, source: Source, author?: string, postedAt?: string) {
  if (!text) return []
  const proofs = new Map<string, unknown>()
  const add = (rawUrl: string, rawTitle: string | undefined, index: number, forceImage = false) => {
    const url = normalizeUrl(rawUrl, prUrl)
    if (!url || proofs.has(url)) return
    const context = lineContext(text, index)
    const title = stripMarkdown(rawTitle || context || "Visual proof").slice(0, 120)
    const proofKind = kind(url, forceImage)
    if (!forceImage && proofKind === "link" && !PROOF_CONTEXT.test(`${title}\n${context}\n${url}`)) return
    proofs.set(url, { url, kind: proofKind, title, source, author, postedAt, isAgentGenerated: AGENT_AUTHOR.test(author ?? "") || PROOF_CONTEXT.test(context), context })
  }
  for (const match of text.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) add(match[2] ?? "", match[1], match.index ?? 0, true)
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) add(match[1] ?? "", /\balt=["']([^"']+)["']/i.exec(match[0])?.[1], match.index ?? 0, true)
  for (const match of text.matchAll(/<video\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) add(match[1] ?? "", "Video proof", match.index ?? 0)
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)) add(match[2] ?? "", match[1], match.index ?? 0)
  for (const match of text.matchAll(/https?:\/\/[^\s)]+/g)) add(match[0] ?? "", undefined, match.index ?? 0)
  return Array.from(proofs.values())
}

function summarizeChecks(checks: GhStatusCheck[] | undefined) {
  const summary = { total: 0, passed: 0, pending: 0, failed: 0 }
  for (const check of checks ?? []) {
    summary.total += 1
    const conclusion = String(check.conclusion ?? check.state ?? "").toUpperCase()
    const status = String(check.status ?? "").toUpperCase()
    if (["SUCCESS", "PASSED", "NEUTRAL", "SKIPPED"].includes(conclusion)) summary.passed += 1
    else if (["FAILURE", "FAILED", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(conclusion)) summary.failed += 1
    else if (["PENDING", "QUEUED", "IN_PROGRESS", "REQUESTED", "WAITING", "EXPECTED"].includes(status) || !conclusion) summary.pending += 1
    else summary.pending += 1
  }
  return summary
}

function statusFromPr(pr: GhPullRequest, checks: ReturnType<typeof summarizeChecks>) {
  const statusLabel = (pr.labels ?? []).map((label) => label.name ?? "").find((name) => /^status\s*[:/]/i.test(name))
  if (statusLabel) return { tag: statusLabel, tone: "info" }
  if (pr.isDraft) return { tag: "Draft", tone: "neutral" }
  if (checks.failed > 0) return { tag: "Checks failing", tone: "danger" }
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { tag: "Changes requested", tone: "danger" }
  if (["DIRTY", "BLOCKED", "BEHIND"].includes(String(pr.mergeStateStatus ?? "").toUpperCase())) return { tag: "Blocked", tone: "warning" }
  if (checks.pending > 0) return { tag: "Checks pending", tone: "warning" }
  if (pr.reviewDecision === "REVIEW_REQUIRED") return { tag: "Review required", tone: "warning" }
  if (checks.total > 0 && checks.passed === checks.total) return { tag: "Ready", tone: "success" }
  if (pr.reviewDecision === "APPROVED") return { tag: "Approved", tone: "success" }
  return { tag: pr.reviewDecision?.toLowerCase().replace(/_/g, " ") ?? "Open", tone: "info" }
}

function topic(pr: GhPullRequest, labels: string[]): string {
  const body = stripMarkdown(pr.body ?? "").split(/\n{2,}/).map((line) => line.trim()).filter(Boolean)
  const first = body.find((paragraph) => !/^closes\s+#?\d+/i.test(paragraph))
  const value = first || labels.slice(0, 4).join(", ") || pr.title
  return value.length > 240 ? `${value.slice(0, 237).trim()}…` : value
}

function fileBucket(path: string): string {
  const parts = path.split("/").filter(Boolean)
  if (parts.length <= 1) return "root"
  if (["apps", "packages", "plugins", ".pi", ".agents"].includes(parts[0] ?? "") && parts[1]) return `${parts[0]}/${parts[1]}`
  return parts[0] ?? "root"
}
function summarizeDiff(pr: GhPullRequest, patches = new Map<string, string>()) {
  const files = (pr.files ?? []).map((file) => {
    const path = file.path ?? "unknown"
    return { path, additions: Number(file.additions ?? 0), deletions: Number(file.deletions ?? 0), changeType: file.changeType ?? "modified", bucket: fileBucket(path), patch: patches.get(path) ?? file.patch ?? "" }
  })
  const byBucket = new Map<string, { name: string; additions: number; deletions: number; files: number }>()
  for (const file of files) {
    const current = byBucket.get(file.bucket) ?? { name: file.bucket, additions: 0, deletions: 0, files: 0 }
    current.additions += file.additions
    current.deletions += file.deletions
    current.files += 1
    byBucket.set(file.bucket, current)
  }
  const additions = Number(pr.additions ?? files.reduce((sum, file) => sum + file.additions, 0))
  const deletions = Number(pr.deletions ?? files.reduce((sum, file) => sum + file.deletions, 0))
  return {
    additions,
    deletions,
    changedFiles: Number(pr.changedFiles ?? files.length),
    files: files.sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)).slice(0, 80),
    buckets: Array.from(byBucket.values()).sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)).slice(0, 12),
  }
}

function issueColumn(labels: string[]): "to-plan" | "to-review" | "to-merge" | "bclaw-ready" {
  const lower = labels.map((label) => label.toLowerCase())
  if (lower.includes("bclaw:ready")) return "bclaw-ready"
  if (lower.some((label) => label === "status:to-merge" || label === "to-merge" || label === "ready-to-merge")) return "to-merge"
  if (lower.some((label) => label === "status:to-review" || label === "to-review" || label === "review")) return "to-review"
  return "to-plan"
}
function issueDifficulty(labels: string[]): "easy" | "needs-plan" | undefined {
  const lower = labels.map((label) => label.toLowerCase())
  if (lower.includes("easy")) return "easy"
  if (lower.includes("needs-plan")) return "needs-plan"
  return undefined
}
function findBclawSessionId(issue: GhIssue): string | undefined {
  const texts = [issue.body ?? "", ...(issue.comments ?? []).map((comment) => comment.body ?? "")]
  const patterns = [
    /(?:pi[-_\s]*chat[-_\s]*session|pi[-_\s]*session|session[-_\s]*id)\s*[:=]\s*`?([A-Za-z0-9._:-]{4,120})`?/i,
    /[?&]session=([A-Za-z0-9._:-]{4,120})/i,
    /data-pi-chat-session-id=["']([^"']{4,120})["']/i,
  ]
  for (const text of texts) for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match?.[1]) return match[1].replace(/[),.;\]\s]+$/, "")
  }
  return undefined
}
function associatedPrsForIssue(issue: GhIssue, prs: GhPullRequest[]) {
  const issueRef = `#${issue.number}`
  const closing = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+${issueRef.replace("#", "#?")}\\b`, "i")
  const plainRef = new RegExp(`(^|[^\\w/])${issueRef.replace("#", "#?\\s*")}([^\\w-]|$)`, "i")
  return prs.filter((pr) => {
    const text = `${pr.title}\n${pr.body ?? ""}\n${pr.headRefName ?? ""}`
    if (closing.test(text) || plainRef.test(text)) return true
    return (pr.comments ?? []).some((comment) => closing.test(comment.body ?? "") || plainRef.test(comment.body ?? ""))
  }).map((pr) => {
    const checks = summarizeChecks(pr.statusCheckRollup)
    const status = statusFromPr(pr, checks)
    return { number: pr.number, title: pr.title, url: pr.url, statusTag: status.tag, isDraft: Boolean(pr.isDraft) }
  }).sort((a, b) => b.number - a.number)
}
function summarizeIssue(issue: GhIssue, prs: GhPullRequest[] = []) {
  const labels = (issue.labels ?? []).map((label) => label.name).filter(Boolean) as string[]
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    author: issue.author?.login ?? issue.author?.name ?? "unknown",
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    labels,
    body: stripMarkdown(issue.body ?? "").slice(0, 500),
    column: issueColumn(labels),
    difficulty: issueDifficulty(labels),
    bclawSessionId: findBclawSessionId(issue),
    associatedPrs: associatedPrsForIssue(issue, prs),
  }
}

function summarize(pr: GhPullRequest, patches = new Map<string, string>()) {
  const labels = (pr.labels ?? []).map((label) => label.name).filter(Boolean)
  const checks = summarizeChecks(pr.statusCheckRollup)
  const status = statusFromPr(pr, checks)
  const ports = new Map<number, unknown>()
  const proofs = new Map<string, unknown>()
  for (const item of collectPorts(pr.body, "body") as Array<{ port: number }>) ports.set(item.port, item)
  for (const item of collectProofs(pr.body, pr.url, "body") as Array<{ url: string }>) proofs.set(item.url, item)
  for (const comment of pr.comments ?? []) {
    const author = comment.author?.login ?? comment.author?.name ?? undefined
    for (const item of collectPorts(comment.body, "comment", author, comment.updatedAt ?? comment.createdAt) as Array<{ port: number }>) ports.set(item.port, item)
    for (const item of collectProofs(comment.body, pr.url, "comment", author, comment.updatedAt ?? comment.createdAt) as Array<{ url: string }>) proofs.set(item.url, item)
  }
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author?.login ?? pr.author?.name ?? "unknown",
    headRefName: pr.headRefName ?? "",
    baseRefName: pr.baseRefName ?? "",
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    isDraft: Boolean(pr.isDraft),
    reviewDecision: pr.reviewDecision ?? null,
    mergeStateStatus: pr.mergeStateStatus ?? null,
    labels,
    topic: topic(pr, labels as string[]),
    statusTag: status.tag,
    statusTone: status.tone,
    checkSummary: checks,
    diffSummary: summarizeDiff(pr, patches),
    ports: Array.from(ports.values()).sort((a: any, b: any) => a.port - b.port),
    visualProofs: Array.from(proofs.values()).sort((a: any, b: any) => String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? ""))),
  }
}

export async function refresh() {
  const fields = ["number", "title", "body", "url", "author", "headRefName", "baseRefName", "createdAt", "updatedAt", "isDraft", "reviewDecision", "mergeStateStatus", "labels", "comments", "statusCheckRollup", "additions", "deletions", "changedFiles", "files"].join(",")
  const issueFields = ["number", "title", "body", "url", "author", "createdAt", "updatedAt", "labels", "comments"].join(",")
  const limit = Number(process.env.GITHUB_PR_TRACKER_LIMIT || 100)
  const issueLimit = Number(process.env.GITHUB_ISSUE_TRACKER_LIMIT || 100)
  const [repo, prs, issues] = await Promise.all([
    runGhText(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]),
    runGhJson<GhPullRequest[]>(["pr", "list", "--state", "open", "--limit", String(limit), "--json", fields]),
    runGhJson<GhIssue[]>(["issue", "list", "--state", "open", "--limit", String(issueLimit), "--json", issueFields]),
  ])
  // Collect patches per PR. The fast path (bulk `gh pr diff`) handles small
  // PRs instantly. For large PRs the per-file fallback kicks in automatically —
  // each file's patch is fetched as a tiny API call in a worker pool, so even
  // a 217-file PR gets full patch data.
  const patchEntries = await Promise.all(
    prs.map(async (pr) => {
      const filePaths = (pr.files ?? []).map((f) => f.path ?? "unknown").filter((p) => p !== "unknown")
      const totalLines = Number(pr.additions ?? 0) + Number(pr.deletions ?? 0)
      return [pr.number, await collectPatches(pr.number, filePaths, totalLines)] as const
    }),
  )
  const patchesByPr = new Map<number, Map<string, string>>(patchEntries)
  const data = { ok: true, repo, generatedAt: new Date().toISOString(), prs: prs.map((pr) => summarize(pr, patchesByPr.get(pr.number))), issues: issues.map((issue) => summarizeIssue(issue, prs)) }
  const output = resolve(workspaceRoot(), DATA_PATH)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(data, null, 2), "utf8")
  return data
}

async function ensureLabels(labels: string[]) {
  for (const label of labels) {
    try {
      await execFileAsync("gh", ["label", "create", label, "--color", label === "easy" ? "0E8A16" : label === "needs-plan" ? "FBCA04" : label === "bclaw:ready" ? "1D76DB" : "C5DEF5"], {
        cwd: workspaceRoot(),
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
      })
    } catch {
      // Already exists or insufficient label-create permission. gh issue edit will report real failures.
    }
  }
}

export default function extension(api: { registerTool(tool: unknown): void }) {
  api.registerTool({
    name: "refresh_github_pr_tracker",
    description: "Refresh the workspace-local GitHub PR Tracker data by running gh pr list and extracting PR status, ports, and visual proof.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      try {
        const data = await refresh()
        return { content: [{ type: "text", text: `Refreshed ${data.prs.length} open PRs for ${data.repo ?? "this repo"}. Data written to ${DATA_PATH}. Open the GitHub PR Tracker panel or click Refresh in the panel.` }], details: data }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { isError: true, content: [{ type: "text", text: `Could not refresh GitHub PR Tracker: ${message}\n\nMake sure gh is authenticated in this workspace (gh auth login or GH_TOKEN).` }] }
      }
    },
  })

  api.registerTool({
    name: "label_github_pr",
    description: "Add and/or remove labels (tags) on a GitHub pull request via the local gh CLI, then refresh the PR tracker data so panels update.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "number", description: "Pull request number" },
        add: { type: "array", items: { type: "string" }, description: "Labels to add (must exist in the repo)" },
        remove: { type: "array", items: { type: "string" }, description: "Labels to remove" },
      },
      required: ["number"],
      additionalProperties: false,
    },
    async execute(_toolCallId: unknown, params: { number?: number; add?: string[]; remove?: string[] }) {
      try {
        const number = Number(params.number)
        const add = (params.add ?? []).map(String).map((label) => label.trim()).filter(Boolean)
        const remove = (params.remove ?? []).map(String).map((label) => label.trim()).filter(Boolean)
        if (!Number.isInteger(number) || number <= 0) throw new Error("number must be a PR number")
        if (add.length === 0 && remove.length === 0) throw new Error("provide at least one label to add or remove")
        const args = ["pr", "edit", String(number)]
        for (const label of add) args.push("--add-label", label)
        for (const label of remove) args.push("--remove-label", label)
        await execFileAsync("gh", args, {
          cwd: workspaceRoot(),
          env: { ...process.env, GH_PROMPT_DISABLED: "1" },
          maxBuffer: 1024 * 1024,
          timeout: 30_000,
        })
        await refresh()
        const changes = [
          add.length ? `added ${add.join(", ")}` : null,
          remove.length ? `removed ${remove.join(", ")}` : null,
        ].filter(Boolean).join("; ")
        return { content: [{ type: "text", text: `Updated labels on PR #${number} (${changes}) and refreshed tracker data.` }] }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { isError: true, content: [{ type: "text", text: `Could not update PR labels: ${message}\n\nNote: labels must already exist in the repo (gh label create <name>).` }] }
      }
    },
  })

  api.registerTool({
    name: "label_github_issue",
    description: "Add and/or remove labels (tags) on a GitHub issue via the local gh CLI, creating common labels when possible, then refresh tracker data.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "number", description: "Issue number" },
        add: { type: "array", items: { type: "string" }, description: "Labels to add" },
        remove: { type: "array", items: { type: "string" }, description: "Labels to remove" },
      },
      required: ["number"],
      additionalProperties: false,
    },
    async execute(_toolCallId: unknown, params: { number?: number; add?: string[]; remove?: string[] }) {
      try {
        const number = Number(params.number)
        const add = (params.add ?? []).map(String).map((label) => label.trim()).filter(Boolean)
        const remove = (params.remove ?? []).map(String).map((label) => label.trim()).filter(Boolean)
        if (!Number.isInteger(number) || number <= 0) throw new Error("number must be an issue number")
        if (add.length === 0 && remove.length === 0) throw new Error("provide at least one label to add or remove")
        await ensureLabels(add)
        const args = ["issue", "edit", String(number)]
        for (const label of add) args.push("--add-label", label)
        for (const label of remove) args.push("--remove-label", label)
        await execFileAsync("gh", args, {
          cwd: workspaceRoot(),
          env: { ...process.env, GH_PROMPT_DISABLED: "1" },
          maxBuffer: 1024 * 1024,
          timeout: 30_000,
        })
        await refresh()
        const changes = [
          add.length ? `added ${add.join(", ")}` : null,
          remove.length ? `removed ${remove.join(", ")}` : null,
        ].filter(Boolean).join("; ")
        return { content: [{ type: "text", text: `Updated labels on issue #${number} (${changes}) and refreshed tracker data.` }] }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { isError: true, content: [{ type: "text", text: `Could not update issue labels: ${message}` }] }
      }
    },
  })

  api.registerTool({
    name: "comment_github_pr",
    description: "Post a comment to a GitHub pull request using the local gh CLI.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "number", description: "Pull request number" },
        body: { type: "string", description: "Markdown comment body" },
      },
      required: ["number", "body"],
      additionalProperties: false,
    },
    async execute(_toolCallId: unknown, params: { number?: number; body?: string }) {
      try {
        const number = Number(params.number)
        const body = String(params.body ?? "").trim()
        if (!Number.isInteger(number) || number <= 0) throw new Error("number must be a PR number")
        if (!body) throw new Error("body is required")
        await execFileAsync("gh", ["pr", "comment", String(number), "--body", body], {
          cwd: workspaceRoot(),
          env: { ...process.env, GH_PROMPT_DISABLED: "1" },
          maxBuffer: 1024 * 1024,
          timeout: 30_000,
        })
        return { content: [{ type: "text", text: `Posted comment to PR #${number}.` }] }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { isError: true, content: [{ type: "text", text: `Could not comment on PR: ${message}\n\nMake sure gh is authenticated in this workspace (gh auth login or GH_TOKEN).` }] }
      }
    },
  })
}
