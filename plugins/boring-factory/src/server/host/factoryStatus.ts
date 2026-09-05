import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FastifyInstance } from 'fastify'
import type { AgentTool, ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'
import type { FactoryDispatchLedger, FactoryDispatchRecord, FactoryReviewRecord } from './dispatchLedger'
import type { FactoryEpicRegistry } from './epicRegistry'
import { FactoryEpicResolutionError, resolveFactoryEpic, type FactorySessionBindings } from './sessionBindings'

const execFileAsync = promisify(execFile)
const MAX_DIRTY_PATHS = 50
const WORKER_AGENT_TYPE_ID = 'boring-worker'

export interface FactoryHostLimits {
  readonly maxConcurrentWorkers: number
  readonly maxDispatchesPerBead: number
  readonly maxReviewRounds: number
}

export type FactoryBrRunner = (args: readonly string[], cwd: string) => Promise<string>

export interface FactoryGitStatus {
  readonly branch: string
  readonly head: string
  readonly remoteHead: string | null
  readonly dirtyPaths: string[]
}

export interface FactoryStatusToolOptions {
  readonly workspaceScopeId: string
  readonly registry: FactoryEpicRegistry
  readonly sessionBindings: FactorySessionBindings
  readonly now?: () => number
  readonly runBr?: FactoryBrRunner
  readonly readGitStatus?: (workspaceRoot: string) => Promise<FactoryGitStatus>
}

export interface BrIssue {
  readonly id: string
  readonly title?: string
  readonly status?: string
  readonly assignee?: string | null
  readonly labels?: readonly string[]
  readonly updated_at?: string
}

interface BrComment {
  readonly created_at?: string
  readonly body?: string
  readonly text?: string
  readonly content?: string
}

export interface WorkerSessionSummary {
  readonly sessionId: string
  readonly status?: string
  readonly turnCount?: number
  readonly title?: string
  readonly updatedAt?: number
}

type SessionLiveness = 'missing' | 'idle' | 'busy'

interface FactoryBeadStatus extends BrIssue {
  readonly assignee: string | null
  readonly labels: readonly string[]
  readonly commentCount: number
  readonly lastCommentAt?: string
  readonly hasHandoff: boolean
  readonly sessionLiveness: SessionLiveness
  readonly sessionLastActivityAt: number | null
  readonly idleForMs: number | null
  readonly stale: boolean
  readonly staleReason?: string
  readonly recoveryCommand?: 'recover_stale_claims'
}

function textResult(details: Record<string, unknown>, isError: boolean): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError }
}

function unboundResult(toolName: string): ToolResult {
  return textResult({ code: 'HOST_NOT_BOUND', message: `${toolName} is not bound to a running host` }, true)
}

function epicResolutionResult(error: unknown): ToolResult {
  if (error instanceof FactoryEpicResolutionError) return textResult({ code: error.code, message: error.message }, true)
  return textResult({ code: 'EPIC_RESOLUTION_FAILED', message: error instanceof Error ? error.message : 'failed to resolve Factory epic' }, true)
}

export function isBusySession(status: string | undefined): boolean {
  return status === 'running' || status === 'streaming' || status === 'aborting'
}

export async function defaultRunBr(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('br', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

function parseBrIssues(stdout: string): BrIssue[] {
  const parsed: unknown = JSON.parse(stdout)
  if (Array.isArray(parsed)) return parsed as BrIssue[]
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { issues?: unknown }).issues)) {
    return (parsed as { issues: BrIssue[] }).issues
  }
  return []
}

export async function loadEpicBeads(workspaceRoot: string, epicKey: string, run: FactoryBrRunner): Promise<BrIssue[]> {
  return parseBrIssues(await run(['list', '--all', '--label', `epic:${epicKey}`, '--json', '--no-auto-flush'], workspaceRoot))
}

async function commentStatsFor(
  workspaceRoot: string,
  issueId: string,
  run: FactoryBrRunner,
): Promise<{ commentCount: number; lastCommentAt?: string; hasHandoff: boolean }> {
  const parsed: unknown = JSON.parse(await run(['comments', 'list', issueId, '--json', '--no-auto-flush'], workspaceRoot))
  const comments = Array.isArray(parsed)
    ? (parsed as BrComment[])
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { comments?: unknown }).comments)
      ? (parsed as { comments: BrComment[] }).comments
      : undefined
  if (!comments) throw new Error(`invalid Bead comment response for ${issueId}`)
  const lastCommentAt = comments
    .map((comment) => comment.created_at)
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1)
  const escapedIssueId = issueId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const canonicalHandoff = new RegExp(`^\\[[^\\]\\r\\n]+\\] handoff · ${escapedIssueId} · [0-9a-f]{7,40}(?:\\s|$)`, 'im')
  const hasHandoff = comments.some((comment) => canonicalHandoff.test(comment.body ?? comment.text ?? comment.content ?? ''))
  return { commentCount: comments.length, ...(lastCommentAt ? { lastCommentAt } : {}), hasHandoff }
}

async function gitOutput(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  return stdout.trim()
}

async function defaultReadGitStatus(workspaceRoot: string): Promise<FactoryGitStatus> {
  const [branch, head, statusOutput] = await Promise.all([
    gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRoot),
    gitOutput(['rev-parse', 'HEAD'], workspaceRoot),
    execFileAsync('git', ['status', '--short'], { cwd: workspaceRoot, maxBuffer: 16 * 1024 * 1024 }).then((result) => result.stdout),
  ])
  const dirtyPaths = statusOutput.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, MAX_DIRTY_PATHS)
  let remoteHead: string | null = null
  try {
    const sha = (await gitOutput(['ls-remote', '--heads', 'origin', branch], workspaceRoot)).split(/\s+/)[0]
    remoteHead = sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null
  } catch {
    remoteHead = null
  }
  return { branch, head, remoteHead, dirtyPaths }
}

export async function listWorkerSessions(app: FastifyInstance, workspaceHeader: Record<string, string>): Promise<WorkerSessionSummary[]> {
  const sessions: WorkerSessionSummary[] = []
  let cursor: string | undefined
  const seenCursors = new Set<string>()
  for (;;) {
    const url = cursor
      ? `/api/v1/agents/${WORKER_AGENT_TYPE_ID}/sessions?cursor=${encodeURIComponent(cursor)}`
      : `/api/v1/agents/${WORKER_AGENT_TYPE_ID}/sessions`
    const response = await app.inject({ method: 'GET', url, headers: workspaceHeader })
    if (response.statusCode !== 200) throw new Error(`Worker session inventory failed: HTTP ${response.statusCode}`)
    const body = response.json<{ sessions: Array<{ ref: { sessionId: string }; status?: string; turnCount?: number; title?: string; updatedAt?: number }>; nextCursor?: string }>()
    for (const session of body.sessions) {
      sessions.push({ sessionId: session.ref.sessionId, status: session.status, turnCount: session.turnCount, title: session.title, updatedAt: session.updatedAt })
    }
    if (!body.nextCursor) break
    if (seenCursors.has(body.nextCursor)) throw new Error('Worker session inventory returned a repeated cursor')
    seenCursors.add(body.nextCursor)
    cursor = body.nextCursor
  }
  return sessions
}

export function resolveEpicWorkerSessionIds(input: {
  readonly epicKey: string
  readonly bindings: Readonly<Record<string, string>>
  readonly beads: readonly BrIssue[]
  readonly dispatches: readonly FactoryDispatchRecord[]
}): Set<string> {
  const inferredEpicsBySession = new Map<string, Set<string>>()
  const infer = (sessionId: string, epicKey: string) => {
    const epicKeys = inferredEpicsBySession.get(sessionId) ?? new Set<string>()
    epicKeys.add(epicKey)
    inferredEpicsBySession.set(sessionId, epicKeys)
  }
  for (const dispatch of input.dispatches) {
    if (dispatch.childSessionId) infer(dispatch.childSessionId, dispatch.epicKey)
  }
  for (const bead of input.beads) {
    if (bead.assignee) infer(bead.assignee, input.epicKey)
  }

  const sessionIds = new Set(
    Object.entries(input.bindings)
      .filter(([, epicKey]) => epicKey === input.epicKey)
      .map(([sessionId]) => sessionId),
  )
  for (const [sessionId, inferredEpicKeys] of inferredEpicsBySession) {
    const binding = input.bindings[sessionId]
    const conflictingInference = binding && [...inferredEpicKeys].find((epicKey) => epicKey !== binding)
    if (conflictingInference && (binding === input.epicKey || inferredEpicKeys.has(input.epicKey))) {
      throw new Error(`Worker session ${sessionId} ownership conflict: bound to ${binding}, inferred for ${conflictingInference}`)
    }
    if (!inferredEpicKeys.has(input.epicKey)) continue
    if (!binding && inferredEpicKeys.size > 1) {
      throw new Error(`Worker session ${sessionId} ownership conflict: inferred for ${[...inferredEpicKeys].join(', ')}`)
    }
    sessionIds.add(sessionId)
  }
  return sessionIds
}

async function collectBeadStatuses(input: {
  readonly beads: readonly BrIssue[]
  readonly worktree: string
  readonly workerSessions: readonly WorkerSessionSummary[]
  readonly staleIdleMs: number
  readonly now: number
  readonly run: FactoryBrRunner
}): Promise<FactoryBeadStatus[]> {
  const sessionById = new Map(input.workerSessions.map((session) => [session.sessionId, session]))
  const statusById = new Map(input.workerSessions.map((session) => [session.sessionId, session.status ?? 'idle']))
  return await Promise.all(input.beads.map(async (issue) => {
    const comments = await commentStatsFor(input.worktree, issue.id, input.run)
    const sessionStatus = issue.assignee ? statusById.get(issue.assignee) : undefined
    const sessionLiveness: SessionLiveness = sessionStatus === undefined ? 'missing' : isBusySession(sessionStatus) ? 'busy' : 'idle'
    const lastActivity = issue.assignee ? sessionById.get(issue.assignee)?.updatedAt : undefined
    const idleForMs = sessionLiveness === 'idle' && typeof lastActivity === 'number' ? Math.max(0, input.now - lastActivity) : null
    const staleMissing = issue.status === 'in_progress' && sessionLiveness === 'missing'
    const staleIdle = issue.status === 'in_progress' && sessionLiveness === 'idle' && !comments.hasHandoff
      && idleForMs !== null && idleForMs > input.staleIdleMs
    const stale = staleMissing || staleIdle
    const staleReason = staleMissing
      ? `assignee session ${issue.assignee ?? '(none)'} is missing`
      : staleIdle
        ? `assignee session ${issue.assignee} has been idle for ${idleForMs}ms with no handoff comment`
        : undefined
    return {
      id: issue.id,
      status: issue.status,
      assignee: issue.assignee ?? null,
      labels: issue.labels ?? [],
      title: issue.title,
      updatedAt: issue.updated_at,
      commentCount: comments.commentCount,
      ...(comments.lastCommentAt ? { lastCommentAt: comments.lastCommentAt } : {}),
      hasHandoff: comments.hasHandoff,
      sessionLiveness,
      sessionLastActivityAt: typeof lastActivity === 'number' ? lastActivity : null,
      idleForMs,
      stale,
      ...(staleReason ? { staleReason, recoveryCommand: 'recover_stale_claims' as const } : {}),
    }
  }))
}

function reviewRoundCounters(records: readonly FactoryReviewRecord[], epicKey: string) {
  const byBead: Record<string, number> = {}
  const byShaLineage: Record<string, number> = {}
  for (const record of records) {
    if (record.epicKey !== epicKey) continue
    const target = record.targetKey.replace(/^sha-lineage:/, '')
    if (record.beadId) byBead[record.beadId] = (byBead[record.beadId] ?? 0) + 1
    else byShaLineage[target] = (byShaLineage[target] ?? 0) + 1
  }
  return { byBead, byShaLineage }
}

function toolParameters() {
  return {
    type: 'object' as const,
    properties: { epicKey: { type: 'string', description: 'Optional explicit epic override. Normally resolved from this session binding.' } },
    additionalProperties: false,
  }
}

export function createFactoryStatusTools(
  getApp: () => FastifyInstance | undefined,
  options: FactoryStatusToolOptions,
  ledger: FactoryDispatchLedger,
  limits: FactoryHostLimits,
  staleIdleMs: number,
  admitSessionMutation: <T>(operation: () => Promise<T>) => Promise<T>,
): AgentTool[] {
  const workspaceHeader = { 'x-boring-workspace-id': options.workspaceScopeId }
  const run = options.runBr ?? defaultRunBr
  const statusTool: AgentTool = {
    name: 'factory_status',
    description: 'Read this epic\'s git, Bead, Worker-session, stale-claim, dispatch, and review facts. Read-only; never mutates anything.',
    parameters: toolParameters(),
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const app = getApp()
      if (!app) return unboundResult('factory_status')
      let epic
      try { epic = await resolveFactoryEpic(params, ctx, options.registry, options.sessionBindings) } catch (error) { return epicResolutionResult(error) }
      try {
        const [git, allWorkerSessions, bindings, dispatchState, epicBeads] = await Promise.all([
          (options.readGitStatus ?? defaultReadGitStatus)(epic.worktree),
          listWorkerSessions(app, workspaceHeader),
          options.sessionBindings.load(),
          ledger.read(),
          loadEpicBeads(epic.worktree, epic.epicKey, run),
        ])
        const epicSessionIds = resolveEpicWorkerSessionIds({
          epicKey: epic.epicKey,
          bindings,
          beads: epicBeads,
          dispatches: dispatchState.dispatches,
        })
        const workerSessions = allWorkerSessions.filter((session) => epicSessionIds.has(session.sessionId))
        const beads = await collectBeadStatuses({
          beads: epicBeads, worktree: epic.worktree, workerSessions, staleIdleMs,
          now: options.now?.() ?? Date.now(), run,
        })
        const openBeads = beads.filter((bead) => bead.status !== 'closed')
        const dispatchesPerOpenBead = Object.fromEntries(openBeads.map((bead) => [
          bead.id,
          dispatchState.dispatches.filter((record) => record.epicKey === epic.epicKey && record.beadId === bead.id).length,
        ]))
        return textResult({
          epicKey: epic.epicKey,
          featureName: epic.featureName,
          workspaceRoot: epic.worktree,
          branch: epic.branch,
          git,
          beads,
          workerSessions,
          staleClaims: {
            count: beads.filter((bead) => bead.stale).length,
            beadIds: beads.filter((bead) => bead.stale).map((bead) => bead.id),
            recoveryCommand: 'recover_stale_claims',
          },
          counters: {
            busyWorkers: workerSessions.filter((session) => isBusySession(session.status)).length,
            dispatchesPerOpenBead,
            reviewRounds: reviewRoundCounters(dispatchState.reviews, epic.epicKey),
          },
          limits: { staleIdleMs, ...limits },
        }, false)
      } catch (error) {
        return textResult({ code: 'FACTORY_STATUS_FAILED', message: error instanceof Error ? error.message : 'factory_status failed' }, true)
      }
    },
  }

  const recoverTool: AgentTool = {
    name: 'recover_stale_claims',
    description: 'Re-read this epic\'s session and Bead facts, then release every stale claim. Busy claims are never released.',
    parameters: toolParameters(),
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const app = getApp()
      if (!app) return unboundResult('recover_stale_claims')
      let epic
      try { epic = await resolveFactoryEpic(params, ctx, options.registry, options.sessionBindings) } catch (error) { return epicResolutionResult(error) }
      return await admitSessionMutation(async () => {
        try {
          const [allWorkerSessions, epicBeads, bindings, dispatchState] = await Promise.all([
            listWorkerSessions(app, workspaceHeader),
            loadEpicBeads(epic.worktree, epic.epicKey, run),
            options.sessionBindings.load(),
            ledger.read(),
          ])
          const epicSessionIds = resolveEpicWorkerSessionIds({
            epicKey: epic.epicKey,
            bindings,
            beads: epicBeads,
            dispatches: dispatchState.dispatches,
          })
          const workerSessions = allWorkerSessions.filter((session) => epicSessionIds.has(session.sessionId))
          const beads = await collectBeadStatuses({
            beads: epicBeads, worktree: epic.worktree, workerSessions, staleIdleMs,
            now: options.now?.() ?? Date.now(), run,
          })
          const actor = ctx.sessionId ?? 'factory-host'
          const recovered: Array<{ beadId: string; deadSessionId: string | null; reason: string }> = []
          const skipped: Array<{ beadId: string; reason: string }> = []
          for (const bead of beads.filter((candidate) => candidate.stale)) {
            const [currentWorkerSessions, currentBeads, currentBindings, currentDispatchState] = await Promise.all([
              listWorkerSessions(app, workspaceHeader),
              loadEpicBeads(epic.worktree, epic.epicKey, run),
              options.sessionBindings.load(),
              ledger.read(),
            ])
            const currentIssue = currentBeads.find((issue) => issue.id === bead.id)
            if (!currentIssue) {
              skipped.push({ beadId: bead.id, reason: 'Bead no longer exists in the epic' })
              continue
            }
            const currentEpicSessionIds = resolveEpicWorkerSessionIds({
              epicKey: epic.epicKey,
              bindings: currentBindings,
              beads: currentBeads,
              dispatches: currentDispatchState.dispatches,
            })
            const [current] = await collectBeadStatuses({
              beads: [currentIssue],
              worktree: epic.worktree,
              workerSessions: currentWorkerSessions.filter((session) => currentEpicSessionIds.has(session.sessionId)),
              staleIdleMs,
              now: options.now?.() ?? Date.now(),
              run,
            })
            if (!current?.stale) {
              skipped.push({ beadId: bead.id, reason: `claim is now ${current?.sessionLiveness ?? 'unknown'} and is not stale` })
              continue
            }
            await run(['update', current.id, '--assignee', '', '--status', 'open', '--actor', actor, '--json', '--no-auto-flush'], epic.worktree)
            const reason = current.staleReason ?? 'host classified the claim as stale'
            await run([
              'comments', 'add', current.id, '-m',
              `[${epic.featureName}] recovered stale claim from ${current.assignee ?? '(missing assignee)'}: ${reason}.`,
              '--actor', actor, '--json', '--no-auto-flush',
            ], epic.worktree)
            recovered.push({ beadId: current.id, deadSessionId: current.assignee, reason })
          }
          return textResult({ epicKey: epic.epicKey, recovered, skipped }, false)
        } catch (error) {
          return textResult({ code: 'STALE_CLAIM_RECOVERY_FAILED', message: error instanceof Error ? error.message : 'stale claim recovery failed' }, true)
        }
      })
    },
  }
  return [statusTool, recoverTool]
}
