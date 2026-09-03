import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyInstance } from 'fastify'
import { defineServerPlugin } from '@hachej/boring-workspace/server'
import type { AgentTool, ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'
import { executeCloseEpic, lookupFactoryPrStatus } from './epicClosure'
import type { FactoryDemoPluginControl } from './demoPlugin'
import type { FactorySupervisionPluginControl } from './supervisionPlugin'

export const FACTORY_DELEGATE_PLUGIN_ID = 'factory-delegate'

/** Bump when this file's delegation behavior changes; hashed into the plugin's contentDigest. */
const DELEGATE_PLUGIN_VERSION = 'factory-delegate.v1.2026-09-03'

const DEFAULT_TIMEOUT_MS = 15 * 60_000
const POLL_INTERVAL_MS = 1_000
const BRIEF_MIN_LENGTH = 20
const BRIEF_MAX_LENGTH = 8_000
const MAX_DIRTY_PATHS = 50
const MAX_WORKER_SESSION_PAGES = 5

const execFileAsync = promisify(execFile)

/**
 * Host-owned grant table: which seat may dispatch which other seat, and under
 * what tool name. Never derived from Agent-authored config or tool input.
 */
const DELEGATE_GRANTS: Readonly<Record<string, { readonly toolName: string; readonly targetAgentTypeId: string }>> = Object.freeze({
  'boring-orchestrator': Object.freeze({ toolName: 'dispatch_worker', targetAgentTypeId: 'boring-worker' }),
  'boring-worker': Object.freeze({ toolName: 'fresh_review', targetAgentTypeId: 'boring-reviewer' }),
})

/** Seat granted the host status readback tool. Never derived from Agent-authored config. */
const FACTORY_STATUS_AGENT_TYPE_ID = 'boring-orchestrator'
const FACTORY_STATUS_WORKER_AGENT_TYPE_ID = 'boring-worker'
const CLOSE_EPIC_AGENT_TYPE_ID = 'boring-orchestrator'

export interface CreateFactoryDelegatePluginOptions {
  readonly demoControl: FactoryDemoPluginControl
  readonly supervisionControl: FactorySupervisionPluginControl
  /** Host-owned workspace identity used on every in-process `app.inject` call. */
  readonly workspaceScopeId: string
  /** Deadline for the child session to go idle after one turn. Default 15 minutes. */
  readonly timeoutMs?: number
  /** Epic label (`epic:<epicKey>`) this Factory instance is bound to; read by `factory_status`. */
  readonly epicKey: string
  /** Feature name per docs/procedures/naming-conventions.md, used to title delegated sessions. */
  readonly featureName: string
  /** Shared epic worktree root; `git` and `br` for `factory_status` run here. */
  readonly workspaceRoot: string
}

export interface FactoryDelegatePluginHandle {
  readonly plugin: ReturnType<typeof defineServerPlugin>
  /** Wire the live fastify app once `createWorkspaceAgentServer` resolves. */
  bind(app: FastifyInstance): void
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

class DelegateAbortedError extends Error {
  constructor() {
    super('delegation aborted')
    this.name = 'DelegateAbortedError'
  }
}

function textResult(details: Record<string, unknown>, isError: boolean): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError }
}

function invalidInputResult(message: string): ToolResult {
  return textResult({ code: 'INVALID_INPUT', message }, true)
}

function unboundResult(toolName: string): ToolResult {
  return textResult(
    { code: 'HOST_NOT_BOUND', message: `${toolName} is not bound to a running host` },
    true,
  )
}

function parseBrief(params: Record<string, unknown>): { brief: string; title?: string } | { error: string } {
  const brief = params.brief
  if (typeof brief !== 'string' || brief.length < BRIEF_MIN_LENGTH || brief.length > BRIEF_MAX_LENGTH) {
    return { error: `brief must be a string between ${BRIEF_MIN_LENGTH} and ${BRIEF_MAX_LENGTH} characters` }
  }
  const title = params.title
  if (title !== undefined && typeof title !== 'string') {
    return { error: 'title must be a string when provided' }
  }
  return { brief, title }
}

/** Session title label per docs/procedures/naming-conventions.md, keyed by the delegating tool. */
const SESSION_TITLE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  dispatch_worker: 'Worker',
  fresh_review: 'Review',
})

const SHA_RE = /\b[0-9a-f]{7,40}\b/i

/**
 * `[Feature Name] Worker ← <parent>` for a dispatched Worker, `[Feature Name] Review @ <sha>` for
 * a `fresh_review` bound to a SHA found in its brief (falls back to `← <parent>` when no SHA is
 * present in the brief). The host derives this; the agent-supplied `title` is ignored.
 */
function sessionTitleFor(toolName: string, featureName: string, brief: string, parentSessionId: string): string {
  const label = SESSION_TITLE_LABEL[toolName] ?? toolName
  const parentShort = parentSessionId.slice(0, 8)
  if (toolName === 'fresh_review') {
    const sha = brief.match(SHA_RE)?.[0]
    if (sha) return `[${featureName}] ${label} @ ${sha}`
  }
  return `[${featureName}] ${label} ← ${parentShort}`
}

function lastAssistantText(messages: readonly { role: string; parts: readonly { type: string; text?: string }[] }[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!
    if (message.role !== 'assistant') continue
    return message.parts
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim()
  }
  return ''
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DelegateAbortedError()
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(resolvePromise, ms)
    const onAbort = () => {
      clearTimeout(timer)
      rejectPromise(new DelegateAbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface DelegateSessionState {
  readonly summary?: { readonly turnCount?: number }
  readonly state?: {
    readonly status?: string
    readonly currentModel?: unknown
    readonly messages?: readonly { role: string; parts: readonly { type: string; text?: string }[] }[]
  }
}

function createDelegateTool(
  toolName: string,
  targetAgentTypeId: string,
  getApp: () => FastifyInstance | undefined,
  options: CreateFactoryDelegatePluginOptions,
): AgentTool {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const workspaceHeader = { 'x-boring-workspace-id': options.workspaceScopeId }

  return {
    name: toolName,
    description: `Start a brand-new session of the ${targetAgentTypeId} seat with the given brief, wait for it to finish exactly one turn, and return only its final answer. The child never inherits this session's context, and its intermediate tool calls and messages are never exposed here.`,
    parameters: {
      type: 'object',
      properties: {
        brief: {
          type: 'string',
          minLength: BRIEF_MIN_LENGTH,
          maxLength: BRIEF_MAX_LENGTH,
          description: 'Full task brief for the fresh child session. Must stand alone: the child has no memory of this conversation.',
        },
        title: {
          type: 'string',
          description: 'Ignored: the host titles the session per docs/procedures/naming-conventions.md.',
        },
      },
      required: ['brief'],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const parsed = parseBrief(params)
      if ('error' in parsed) return invalidInputResult(parsed.error)
      const { brief } = parsed

      const app = getApp()
      if (!app) return unboundResult(toolName)

      const startedAt = new Date().toISOString()
      const parentSessionId = ctx.sessionId ?? 'unknown'
      const sessionTitle = sessionTitleFor(toolName, options.featureName, brief, parentSessionId)

      try {
        const createResponse = await app.inject({
          method: 'POST',
          url: `/api/v1/agents/${targetAgentTypeId}/sessions`,
          headers: workspaceHeader,
          payload: { requestId: randomUUID(), title: sessionTitle },
        })
        if (createResponse.statusCode !== 201) {
          return textResult(
            { code: 'CREATE_SESSION_FAILED', status: createResponse.statusCode, body: createResponse.body },
            true,
          )
        }
        const { sessionId } = createResponse.json<{ sessionId: string }>()

        const promptResponse = await app.inject({
          method: 'POST',
          url: `/api/v1/agents/${targetAgentTypeId}/sessions/${sessionId}/prompt`,
          headers: workspaceHeader,
          payload: {
            requestId: randomUUID(),
            clientNonce: randomUUID(),
            content: `Host context: your session id is ${sessionId} (use it as your br actor). Parent session: ${ctx.sessionId}.\n\n${brief}`,
            requireIdle: true,
          },
        })
        if (promptResponse.statusCode !== 202) {
          return textResult(
            { code: 'PROMPT_FAILED', delegationId: sessionId, status: promptResponse.statusCode, body: promptResponse.body },
            true,
          )
        }

        const deadline = Date.now() + timeoutMs
        let status: 'completed' | 'timeout' = 'timeout'
        let lastState: DelegateSessionState | undefined
        while (Date.now() < deadline) {
          if (ctx.abortSignal.aborted) throw new DelegateAbortedError()
          const stateResponse = await app.inject({
            method: 'GET',
            url: `/api/v1/agents/${targetAgentTypeId}/sessions/${sessionId}/state`,
            headers: workspaceHeader,
          })
          if (stateResponse.statusCode === 200) {
            lastState = stateResponse.json<DelegateSessionState>()
            const turnCount = lastState.summary?.turnCount ?? 0
            if (lastState.state?.status === 'idle' && turnCount >= 1) {
              status = 'completed'
              break
            }
          }
          await sleep(POLL_INTERVAL_MS, ctx.abortSignal)
        }

        const finishedAt = new Date().toISOString()
        const model = lastState?.state?.currentModel
        const answer = lastAssistantText(lastState?.state?.messages ?? [])
        const details = {
          delegationId: sessionId,
          targetAgentTypeId,
          model,
          status,
          answer,
          provenance: {
            sessionId,
            agentTypeId: targetAgentTypeId,
            model,
            briefDigest: sha256(brief),
            startedAt,
            finishedAt,
          },
        }
        return textResult(details, false)
      } catch (error) {
        if (error instanceof DelegateAbortedError) {
          return textResult({ code: 'ABORTED', message: 'delegation aborted before the child session finished' }, true)
        }
        const message = error instanceof Error ? error.message : 'delegation failed'
        return textResult({ code: 'DELEGATE_FAILED', message }, true)
      }
    },
  }
}

interface BrIssue {
  readonly id: string
  readonly title?: string
  readonly status?: string
  readonly assignee?: string | null
  readonly labels?: readonly string[]
  readonly updated_at?: string
}

interface BrComment {
  readonly created_at: string
}

async function runBr(args: readonly string[], cwd: string): Promise<string> {
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

async function loadEpicBeads(workspaceRoot: string, epicKey: string): Promise<BrIssue[]> {
  const stdout = await runBr(['list', '--label', `epic:${epicKey}`, '--json', '--no-auto-flush'], workspaceRoot)
  return parseBrIssues(stdout)
}

async function commentStatsFor(workspaceRoot: string, issueId: string): Promise<{ commentCount: number; lastCommentAt?: string }> {
  try {
    const stdout = await runBr(['comments', 'list', issueId, '--json', '--no-auto-flush'], workspaceRoot)
    const parsed: unknown = JSON.parse(stdout)
    const comments = Array.isArray(parsed) ? (parsed as BrComment[]) : []
    if (comments.length === 0) return { commentCount: 0 }
    const lastCommentAt = comments
      .map((comment) => comment.created_at)
      .filter((value): value is string => typeof value === 'string')
      .sort()
      .at(-1)
    return { commentCount: comments.length, ...(lastCommentAt ? { lastCommentAt } : {}) }
  } catch {
    return { commentCount: 0 }
  }
}

async function gitOutput(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  return stdout.trim()
}

async function readGitStatus(workspaceRoot: string): Promise<{ branch: string; head: string; remoteHead: string | null; dirtyPaths: string[] }> {
  const [branch, head, statusOutput] = await Promise.all([
    gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRoot),
    gitOutput(['rev-parse', 'HEAD'], workspaceRoot),
    execFileAsync('git', ['status', '--short'], { cwd: workspaceRoot, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout),
  ])
  const dirtyPaths = statusOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_DIRTY_PATHS)
  let remoteHead: string | null = null
  try {
    const lsRemote = await gitOutput(['ls-remote', '--heads', 'origin', branch], workspaceRoot)
    const sha = lsRemote.split(/\s+/)[0]
    remoteHead = sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null
  } catch {
    remoteHead = null
  }
  return { branch, head, remoteHead, dirtyPaths }
}

type SessionLiveness = 'none' | 'unknown' | 'exists-idle' | 'exists-busy'

function computeLiveness(assignee: string | null | undefined, workerStatusBySessionId: ReadonlyMap<string, string>): SessionLiveness {
  if (!assignee) return 'none'
  const status = workerStatusBySessionId.get(assignee)
  if (status === undefined) return 'unknown'
  return status === 'idle' ? 'exists-idle' : 'exists-busy'
}

interface WorkerSessionSummary {
  readonly sessionId: string
  readonly status?: string
  readonly turnCount?: number
  readonly title?: string
  readonly updatedAt?: number
}

async function listWorkerSessions(app: FastifyInstance, workspaceHeader: Record<string, string>): Promise<WorkerSessionSummary[]> {
  const sessions: WorkerSessionSummary[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_WORKER_SESSION_PAGES; page += 1) {
    const url = cursor
      ? `/api/v1/agents/${FACTORY_STATUS_WORKER_AGENT_TYPE_ID}/sessions?cursor=${encodeURIComponent(cursor)}`
      : `/api/v1/agents/${FACTORY_STATUS_WORKER_AGENT_TYPE_ID}/sessions`
    const response = await app.inject({ method: 'GET', url, headers: workspaceHeader })
    if (response.statusCode !== 200) break
    const body = response.json<{ sessions: Array<{ ref: { sessionId: string }; status?: string; turnCount?: number; title?: string; updatedAt?: number }>; nextCursor?: string }>()
    for (const session of body.sessions) {
      sessions.push({ sessionId: session.ref.sessionId, status: session.status, turnCount: session.turnCount, title: session.title, updatedAt: session.updatedAt })
    }
    if (!body.nextCursor) break
    cursor = body.nextCursor
  }
  return sessions
}

function createFactoryStatusTool(
  getApp: () => FastifyInstance | undefined,
  options: CreateFactoryDelegatePluginOptions,
): AgentTool {
  const workspaceHeader = { 'x-boring-workspace-id': options.workspaceScopeId }
  return {
    name: 'factory_status',
    description:
      'Read the durable end-state of this epic: git branch/head/remote-head/dirty paths in the shared ' +
      'worktree, every Bead labelled `epic:<key>` with its status/assignee/labels/comment activity and ' +
      'whether its assignee is a known Worker session (and whether that session is idle or busy), and ' +
      'the raw list of Worker sessions. Read-only; never mutates anything.',
    parameters: {
      type: 'object',
      properties: {
        epicKey: {
          type: 'string',
          description: 'Ignored: the epic key is fixed by the host for this Factory instance.',
        },
      },
      additionalProperties: false,
    },
    async execute(): Promise<ToolResult> {
      const app = getApp()
      if (!app) return unboundResult('factory_status')
      try {
        const [git, beads, workerSessions] = await Promise.all([
          readGitStatus(options.workspaceRoot),
          loadEpicBeads(options.workspaceRoot, options.epicKey),
          listWorkerSessions(app, workspaceHeader),
        ])
        const prDetails = await lookupFactoryPrStatus(options.workspaceRoot, git.branch)
        const workerStatusBySessionId = new Map(workerSessions.map((session) => [session.sessionId, session.status ?? 'idle']))
        const beadsWithComments = await Promise.all(beads.map(async (issue) => {
          const commentStats = await commentStatsFor(options.workspaceRoot, issue.id)
          return {
            id: issue.id,
            status: issue.status,
            assignee: issue.assignee ?? null,
            labels: issue.labels ?? [],
            title: issue.title,
            updatedAt: issue.updated_at,
            commentCount: commentStats.commentCount,
            ...(commentStats.lastCommentAt ? { lastCommentAt: commentStats.lastCommentAt } : {}),
            sessionLiveness: computeLiveness(issue.assignee, workerStatusBySessionId),
          }
        }))
        const details = {
          epicKey: options.epicKey,
          workspaceRoot: options.workspaceRoot,
          git,
          ...prDetails,
          beads: beadsWithComments,
          workerSessions: workerSessions.map((session) => ({
            sessionId: session.sessionId,
            status: session.status,
            turnCount: session.turnCount,
            title: session.title,
            updatedAt: session.updatedAt,
          })),
        }
        return textResult(details, false)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'factory_status failed'
        return textResult({ code: 'FACTORY_STATUS_FAILED', message }, true)
      }
    },
  }
}

function createCloseEpicTool(
  getApp: () => FastifyInstance | undefined,
  options: CreateFactoryDelegatePluginOptions,
): AgentTool {
  return {
    name: 'close_epic',
    description:
      'Orchestrator-only host closure for a merged Factory epic. Re-validates the exact PR, stops demos, closes child Beads before the epic Bead, then stops only the calling session supervision and returns a retry-safe structured receipt.',
    parameters: {
      type: 'object',
      properties: {
        prNumber: { type: 'number', minimum: 1 },
        cleanup: { type: 'boolean' },
      },
      required: ['prNumber'],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      return await executeCloseEpic(params, ctx, {
        workspaceRoot: options.workspaceRoot,
        epicKey: options.epicKey,
        featureName: options.featureName,
        getApp,
        workspaceScopeId: options.workspaceScopeId,
        demoControl: options.demoControl,
        supervisionControl: options.supervisionControl,
      })
    },
  }
}

export function createFactoryDelegatePlugin(
  options: CreateFactoryDelegatePluginOptions,
): FactoryDelegatePluginHandle {
  if (!options.workspaceScopeId.trim()) throw new TypeError('factory-delegate workspaceScopeId is required')
  if (!options.epicKey.trim()) throw new TypeError('factory-delegate epicKey is required')
  if (!options.featureName.trim()) throw new TypeError('factory-delegate featureName is required')
  if (!options.workspaceRoot.trim()) throw new TypeError('factory-delegate workspaceRoot is required')

  let boundApp: FastifyInstance | undefined
  const getApp = () => boundApp

  const plugin = defineServerPlugin({
    id: FACTORY_DELEGATE_PLUGIN_ID,
    label: 'Factory delegation',
    contentDigest: sha256(DELEGATE_PLUGIN_VERSION),
    agentConfigContract: { keys: [] },
    agentToolFactory({ agentTypeId }) {
      const tools: AgentTool[] = []
      const grant = DELEGATE_GRANTS[agentTypeId]
      if (grant) tools.push(createDelegateTool(grant.toolName, grant.targetAgentTypeId, getApp, options))
      if (agentTypeId === FACTORY_STATUS_AGENT_TYPE_ID) tools.push(createFactoryStatusTool(getApp, options))
      if (agentTypeId === CLOSE_EPIC_AGENT_TYPE_ID) tools.push(createCloseEpicTool(getApp, options))
      return tools
    },
  })

  return {
    plugin,
    bind(app: FastifyInstance) {
      boundApp = app
    },
  }
}
