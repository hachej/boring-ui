import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { defineServerPlugin } from '@hachej/boring-workspace/server'
import type { AgentTool, ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'
import type { FactoryEpicRegistry } from './epicRegistry'
import {
  FactoryEpicResolutionError,
  resolveFactoryEpic,
  type FactorySessionBindings,
} from './sessionBindings'
import {
  createFactoryDispatchLedger,
  positiveInteger,
  type FactoryDispatchLedger,
  type FactoryDispatchRecord,
  type FactoryReviewRecord,
} from './dispatchLedger'
import {
  createFactoryStatusTools,
  defaultRunBr,
  isBusySession,
  listWorkerSessions,
  loadEpicBeads,
  resolveEpicWorkerSessionIds,
  type BrIssue,
  type FactoryBrRunner,
  type FactoryGitStatus,
  type FactoryHostLimits,
} from './factoryStatus'

export const FACTORY_DELEGATE_PLUGIN_ID = 'factory-delegate'

/** Bump when this file's delegation behavior changes; hashed into the plugin's contentDigest. */
const DELEGATE_PLUGIN_VERSION = 'factory-delegate.v4.2026-09-06'

const DEFAULT_TIMEOUT_MS = 15 * 60_000
const POLL_INTERVAL_MS = 5_000
const BRIEF_MIN_LENGTH = 20
const BRIEF_MAX_LENGTH = 8_000

export const FACTORY_DEFAULT_STALE_IDLE_MS = 10 * 60_000
export const FACTORY_DEFAULT_MAX_CONCURRENT_WORKERS = 2
export const FACTORY_DEFAULT_MAX_DISPATCHES_PER_BEAD = 2
export const FACTORY_DEFAULT_MAX_REVIEW_ROUNDS = 4

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

export interface CreateFactoryDelegatePluginOptions {
  /** Directory holding the host-owned `dispatches.json` ledger. */
  readonly stateRoot: string
  /** Host-owned workspace identity used on every in-process `app.inject` call. */
  readonly workspaceScopeId: string
  /** Deadline for the child session to go idle after one turn. Default 15 minutes. */
  readonly timeoutMs?: number
  readonly registry: FactoryEpicRegistry
  readonly sessionBindings: FactorySessionBindings
  readonly env?: NodeJS.ProcessEnv
  /** Test seam for deterministic Bead command responses. */
  readonly runBr?: FactoryBrRunner
  /** Test seam for stale-age and persisted timestamps. */
  readonly now?: () => number
  /** Test seam for the read-only git projection used by factory_status. */
  readonly readGitStatus?: (workspaceRoot: string) => Promise<FactoryGitStatus>
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

function epicResolutionResult(error: unknown): ToolResult {
  if (error instanceof FactoryEpicResolutionError) {
    return textResult({ code: error.code, message: error.message }, true)
  }
  const message = error instanceof Error ? error.message : 'failed to resolve Factory epic'
  return textResult({ code: 'EPIC_RESOLUTION_FAILED', message }, true)
}

function modelSelection(encoded: string | undefined): { provider: string; id: string } | undefined {
  const separator = encoded?.indexOf(':') ?? -1
  if (!encoded || separator <= 0 || separator === encoded.length - 1) return undefined
  return { provider: encoded.slice(0, separator), id: encoded.slice(separator + 1) }
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

function parseOptionalBeadId(value: unknown): string | undefined | { error: string } {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) return { error: 'beadId must be a non-empty string when provided' }
  return value.trim()
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

interface StartedDelegation {
  readonly sessionId: string
  readonly dispatchRecord?: FactoryDispatchRecord
  readonly reviewRecord?: FactoryReviewRecord
  readonly capReached: boolean
}

function dispatchTargetFrom(
  requestedBeadId: string | undefined,
  brief: string,
  beads: readonly BrIssue[],
): { beadId: string } | { error: string } {
  const openBeads = beads.filter((bead) => bead.status !== 'closed')
  if (requestedBeadId) {
    if (!openBeads.some((bead) => bead.id === requestedBeadId)) {
      return { error: `beadId ${requestedBeadId} is not an open Bead labelled for this epic` }
    }
    return { beadId: requestedBeadId }
  }
  const named = openBeads.filter((bead) => brief.includes(bead.id))
  if (named.length === 1) return { beadId: named[0]!.id }
  if (named.length > 1) return { error: 'brief names more than one open Bead; pass beadId explicitly' }
  return { error: 'dispatch_worker requires beadId, or the brief must name exactly one open Bead in this epic' }
}

async function markBeadBlockedForCap(
  run: FactoryBrRunner,
  epic: { readonly worktree: string; readonly featureName: string },
  beadId: string,
  actor: string,
  message: string,
): Promise<void> {
  await run(['update', beadId, '--status', 'blocked', '--actor', actor, '--json', '--no-auto-flush'], epic.worktree)
  await run([
    'comments', 'add', beadId, '-m',
    `[${epic.featureName}] Factory dispatch blocked · ${beadId}\n\n${message}\n\nRaise an Inbox question with ask_user describing this blocker; do not retry dispatch_worker.`,
    '--actor', actor, '--json', '--no-auto-flush',
  ], epic.worktree)
}

function capRefusal(
  code: 'WORKER_CONCURRENCY_CAP_REACHED' | 'BEAD_DISPATCH_CAP_REACHED',
  beadId: string,
  current: number,
  maximum: number,
): ToolResult {
  const subject = code === 'WORKER_CONCURRENCY_CAP_REACHED'
    ? 'busy Worker concurrency'
    : `dispatches for Bead ${beadId}`
  return textResult({
    code,
    beadId,
    current,
    maximum,
    blocked: true,
    message: `Factory host refused dispatch: ${subject} is at the cap (${current}/${maximum}). The Bead is blocked. Raise an Inbox question with ask_user describing this blocker; do not retry dispatch_worker.`,
  }, true)
}

function reviewCapRefusal(targetKey: string, current: number, maximum: number): ToolResult {
  return textResult({
    code: 'REVIEW_ROUND_CAP_REACHED',
    reviewTarget: targetKey,
    current,
    maximum,
    blocked: true,
    message: `Factory host refused review: the review-round cap is reached (${current}/${maximum}). Do not infer approval or create another review. The Worker must hand off the current SHA with unresolved findings; the Orchestrator must escalate them to the owner.`,
  }, true)
}

function createDelegateTool(
  toolName: string,
  targetAgentTypeId: string,
  getApp: () => FastifyInstance | undefined,
  options: CreateFactoryDelegatePluginOptions,
  ledger: FactoryDispatchLedger,
  limits: FactoryHostLimits,
  run: FactoryBrRunner,
  admitSessionMutation: <T>(operation: () => Promise<T>) => Promise<T>,
): AgentTool {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const workspaceHeader = { 'x-boring-workspace-id': options.workspaceScopeId }

  return {
    name: toolName,
    description: `Start a brand-new session of the ${targetAgentTypeId} seat with the given brief, wait for it to finish exactly one turn, and return only its final answer. The child never inherits this session's context, and its intermediate tool calls and messages are never exposed here.`,
    parameters: {
      type: 'object',
      properties: {
        epicKey: {
          type: 'string',
          description: 'Optional explicit epic override. Normally the host resolves the epic from this session binding.',
        },
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
        beadId: {
          type: 'string',
          description: toolName === 'dispatch_worker'
            ? 'Target Bead. Required unless the brief names exactly one open Bead in this epic.'
            : 'Optional reviewed Bead. When present, review rounds stay on this Bead across fix-forward SHAs.',
        },
      },
      required: ['brief'],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const parsed = parseBrief(params)
      if ('error' in parsed) return invalidInputResult(parsed.error)
      const { brief } = parsed
      const parsedBeadId = parseOptionalBeadId(params.beadId)
      if (typeof parsedBeadId === 'object') return invalidInputResult(parsedBeadId.error)

      const app = getApp()
      if (!app) return unboundResult(toolName)

      let epic
      try {
        epic = await resolveFactoryEpic(params, ctx, options.registry, options.sessionBindings)
      } catch (error) {
        return epicResolutionResult(error)
      }

      const parentSessionId = ctx.sessionId ?? 'unknown'
      const sessionTitle = sessionTitleFor(toolName, epic.featureName, brief, parentSessionId)
      let started: StartedDelegation | undefined

      try {
        const startDelegation = async (): Promise<StartedDelegation | ToolResult> => {
          let beadId = parsedBeadId
          let reviewTargetKey: string | undefined
          let reviewSha: string | undefined
          if (toolName === 'dispatch_worker') {
            const beads = await loadEpicBeads(epic.worktree, epic.epicKey, run)
            const target = dispatchTargetFrom(beadId, brief, beads)
            if ('error' in target) return invalidInputResult(target.error)
            beadId = target.beadId

            const [sessions, bindings, dispatchState] = await Promise.all([
              listWorkerSessions(app, workspaceHeader),
              options.sessionBindings.load(),
              ledger.read(),
            ])
            const epicWorkerIds = resolveEpicWorkerSessionIds({
              epicKey: epic.epicKey,
              bindings,
              beads,
              dispatches: dispatchState.dispatches,
            })
            const busyWorkers = sessions.filter((session) => (
              epicWorkerIds.has(session.sessionId) && isBusySession(session.status)
            )).length
            const dispatchCount = dispatchState.dispatches.filter((record) => (
              record.epicKey === epic.epicKey && record.beadId === beadId
            )).length
            const actor = ctx.sessionId ?? 'factory-host'
            if (busyWorkers >= limits.maxConcurrentWorkers) {
              const message = `Busy Worker concurrency reached ${busyWorkers}/${limits.maxConcurrentWorkers} for epic ${epic.epicKey}.`
              const refusal = await ledger.markRefusal({
                epicKey: epic.epicKey,
                beadId,
                cap: 'worker-concurrency',
                timestamp: new Date(options.now?.() ?? Date.now()).toISOString(),
              })
              if (refusal.created) await markBeadBlockedForCap(run, epic, beadId, actor, message)
              return capRefusal('WORKER_CONCURRENCY_CAP_REACHED', beadId, busyWorkers, limits.maxConcurrentWorkers)
            }
            if (dispatchCount >= limits.maxDispatchesPerBead) {
              const message = `Dispatch history reached ${dispatchCount}/${limits.maxDispatchesPerBead} for Bead ${beadId}.`
              const refusal = await ledger.markRefusal({
                epicKey: epic.epicKey,
                beadId,
                cap: 'bead-dispatch',
                timestamp: new Date(options.now?.() ?? Date.now()).toISOString(),
              })
              if (refusal.created) await markBeadBlockedForCap(run, epic, beadId, actor, message)
              return capRefusal('BEAD_DISPATCH_CAP_REACHED', beadId, dispatchCount, limits.maxDispatchesPerBead)
            }
          } else {
            const sha = brief.match(SHA_RE)?.[0]
            if (!beadId && ctx.sessionId) {
              const dispatches = (await ledger.read()).dispatches
              for (let index = dispatches.length - 1; index >= 0; index -= 1) {
                const dispatch = dispatches[index]!
                if (dispatch.epicKey === epic.epicKey && dispatch.childSessionId === ctx.sessionId) {
                  beadId = dispatch.beadId
                  break
                }
              }
            }
            if (!beadId && !sha) return invalidInputResult('fresh_review requires beadId or a SHA in the brief')
            if (beadId) {
              const beads = await loadEpicBeads(epic.worktree, epic.epicKey, run)
              if (!beads.some((bead) => bead.id === beadId && bead.status !== 'closed')) {
                return invalidInputResult(`beadId ${beadId} is not an open Bead labelled for this epic`)
              }
              reviewTargetKey = `bead:${beadId}`
            } else {
              reviewSha = sha
              reviewTargetKey = `sha-lineage:${sha}`
            }
          }

          const timestamp = new Date(options.now?.() ?? Date.now()).toISOString()
          let dispatchRecord: FactoryDispatchRecord | undefined
          let reviewRecord: FactoryReviewRecord | undefined
          if (toolName === 'dispatch_worker') {
            dispatchRecord = await ledger.reserveDispatch({ epicKey: epic.epicKey, beadId: beadId!, timestamp })
          } else {
            const reservation = await ledger.reserveReview({
              epicKey: epic.epicKey,
              targetKey: reviewTargetKey!,
              ...(beadId ? { beadId } : {}),
              ...(reviewSha ? { sha: reviewSha } : {}),
              ...(ctx.sessionId ? { parentSessionId: ctx.sessionId } : {}),
              timestamp,
            }, limits.maxReviewRounds)
            if (!reservation.accepted) {
              return reviewCapRefusal(reservation.targetKey, reservation.current, reservation.maximum)
            }
            reviewRecord = reservation.record
          }
          const createResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/agents/${targetAgentTypeId}/sessions`,
            headers: workspaceHeader,
            payload: { requestId: randomUUID(), title: sessionTitle },
          })
          if (createResponse.statusCode !== 201) {
            if (dispatchRecord) await ledger.updateDispatch(dispatchRecord.id, 'failed')
            if (reviewRecord) await ledger.updateReview(reviewRecord.id, 'failed')
            return textResult(
              { code: 'CREATE_SESSION_FAILED', status: createResponse.statusCode, body: createResponse.body },
              true,
            )
          }
          const { sessionId } = createResponse.json<{ sessionId: string }>()
          if (toolName === 'dispatch_worker') {
            dispatchRecord = await ledger.attachDispatch(dispatchRecord!.id, sessionId, 'created')
          } else {
            reviewRecord = await ledger.attachReview(reviewRecord!.id, sessionId, 'created')
          }

          try {
            await options.sessionBindings.bind(sessionId, epic.epicKey)
          } catch (error) {
            if (dispatchRecord) await ledger.updateDispatch(dispatchRecord.id, 'bind-failed')
            if (reviewRecord) await ledger.updateReview(reviewRecord.id, 'bind-failed')
            throw error
          }

          const selectedModel = modelSelection(toolName === 'dispatch_worker' ? epic.models?.worker : epic.models?.reviewer)
          const promptResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/agents/${targetAgentTypeId}/sessions/${sessionId}/prompt`,
            headers: workspaceHeader,
            payload: {
              requestId: randomUUID(),
              clientNonce: randomUUID(),
              content: `Host context: epic ${epic.epicKey} ([${epic.featureName}]) worktree ${epic.worktree} branch ${epic.branch}. Your session id is ${sessionId} (use it as your br actor). Parent session: ${ctx.sessionId}.${beadId ? ` Target Bead: ${beadId}.` : ''}\n\n${brief}`,
              requireIdle: true,
              ...(selectedModel ? { model: selectedModel } : {}),
            },
          })
          if (promptResponse.statusCode !== 202) {
            await options.sessionBindings.unbind(sessionId)
            if (dispatchRecord) await ledger.updateDispatch(dispatchRecord.id, 'prompt-failed')
            if (reviewRecord) await ledger.updateReview(reviewRecord.id, 'prompt-failed')
            return textResult(
              { code: 'PROMPT_FAILED', delegationId: sessionId, status: promptResponse.statusCode, body: promptResponse.body },
              true,
            )
          }
          if (dispatchRecord) dispatchRecord = await ledger.updateDispatch(dispatchRecord.id, 'running')
          if (reviewRecord) reviewRecord = await ledger.updateReview(reviewRecord.id, 'running')
          return {
            sessionId,
            ...(dispatchRecord ? { dispatchRecord } : {}),
            ...(reviewRecord ? { reviewRecord } : {}),
            capReached: !!reviewRecord && reviewRecord.round >= limits.maxReviewRounds,
          }
        }

        const admission = toolName === 'dispatch_worker'
          ? await admitSessionMutation(startDelegation)
          : await startDelegation()
        if ('content' in admission) return admission
        started = admission
        const { sessionId } = started

        const deadline = Date.now() + timeoutMs
        let status: 'completed' | 'timeout' = 'timeout'
        let lastState: DelegateSessionState | undefined
        // Poll the cheap batch-summary projection (status + turnCount) instead of
        // serialising the child's full transcript every second: with a dozen lanes
        // the full-state poll saturated the host event loop and starved the UI.
        while (Date.now() < deadline) {
          if (ctx.abortSignal.aborted) throw new DelegateAbortedError()
          let probe: { status?: string; turnCount?: number } | undefined
          try {
            const summaryResponse = await app.inject({
              method: 'POST',
              url: `/api/v1/agents/${targetAgentTypeId}/sessions/summaries`,
              headers: workspaceHeader,
              payload: { sessionIds: [sessionId] },
            })
            if (summaryResponse.statusCode === 200) {
              probe = summaryResponse.json<{ summaries?: Array<{ status?: string; turnCount?: number }> }>().summaries?.[0]
            }
          } catch {
            probe = undefined
          }
          if (!probe) {
            // Hosts without the batch projection (or a session it has not indexed
            // yet) fall back to the full-state read so completion is never missed.
            const stateResponse = await app.inject({
              method: 'GET',
              url: `/api/v1/agents/${targetAgentTypeId}/sessions/${sessionId}/state`,
              headers: workspaceHeader,
            })
            if (stateResponse.statusCode === 200) {
              lastState = stateResponse.json<DelegateSessionState>()
              probe = { status: lastState.state?.status, turnCount: lastState.summary?.turnCount }
            }
          }
          if (probe?.status === 'idle' && (probe.turnCount ?? 0) >= 1) {
            status = 'completed'
            break
          }
          await sleep(POLL_INTERVAL_MS, ctx.abortSignal)
        }
        // One full-state read at the end for the model and final assistant text.
        const finalStateResponse = await app.inject({
          method: 'GET',
          url: `/api/v1/agents/${targetAgentTypeId}/sessions/${sessionId}/state`,
          headers: workspaceHeader,
        })
        if (finalStateResponse.statusCode === 200) lastState = finalStateResponse.json<DelegateSessionState>()

        const finishedAt = new Date().toISOString()
        const model = lastState?.state?.currentModel
        const answer = lastAssistantText(lastState?.state?.messages ?? [])
        if (started.dispatchRecord) await ledger.updateDispatch(started.dispatchRecord.id, status)
        if (started.reviewRecord) await ledger.updateReview(started.reviewRecord.id, status)
        const details = {
          delegationId: sessionId,
          targetAgentTypeId,
          model,
          status,
          answer,
          ...(started.dispatchRecord ? { beadId: started.dispatchRecord.beadId } : {}),
          ...(started.reviewRecord ? {
            reviewRound: started.reviewRecord.round,
            reviewTarget: started.reviewRecord.targetKey,
            capReached: started.capReached,
            ...(started.capReached ? {
              capInstructions: `Review-round cap reached (${started.reviewRecord.round}/${limits.maxReviewRounds}). Do not infer approval or fix forward again. The Worker must hand off the current SHA with unresolved findings; the Orchestrator must escalate them to the owner.`,
            } : {}),
          } : {}),
          provenance: {
            sessionId,
            agentTypeId: targetAgentTypeId,
            model,
            briefDigest: sha256(brief),
            startedAt: started.dispatchRecord?.timestamp ?? started.reviewRecord?.timestamp ?? finishedAt,
            finishedAt,
          },
        }
        return textResult(details, false)
      } catch (error) {
        if (error instanceof DelegateAbortedError) {
          if (started?.dispatchRecord) await ledger.updateDispatch(started.dispatchRecord.id, 'aborted')
          if (started?.reviewRecord) await ledger.updateReview(started.reviewRecord.id, 'aborted')
          return textResult({ code: 'ABORTED', message: 'delegation aborted before the child session finished' }, true)
        }
        if (started?.dispatchRecord) await ledger.updateDispatch(started.dispatchRecord.id, 'failed')
        if (started?.reviewRecord) await ledger.updateReview(started.reviewRecord.id, 'failed')
        const message = error instanceof Error ? error.message : 'delegation failed'
        return textResult({ code: 'DELEGATE_FAILED', message }, true)
      }
    },
  }
}

export function createFactoryDelegatePlugin(
  options: CreateFactoryDelegatePluginOptions,
): FactoryDelegatePluginHandle {
  if (!options.stateRoot.trim()) throw new TypeError('factory-delegate stateRoot is required')
  if (!options.workspaceScopeId.trim()) throw new TypeError('factory-delegate workspaceScopeId is required')

  const env = options.env ?? process.env
  const limits: FactoryHostLimits = {
    maxConcurrentWorkers: positiveInteger(env.BORING_FACTORY_MAX_CONCURRENT_WORKERS, FACTORY_DEFAULT_MAX_CONCURRENT_WORKERS),
    maxDispatchesPerBead: positiveInteger(env.BORING_FACTORY_MAX_DISPATCHES_PER_BEAD, FACTORY_DEFAULT_MAX_DISPATCHES_PER_BEAD),
    maxReviewRounds: positiveInteger(env.BORING_FACTORY_MAX_REVIEW_ROUNDS, FACTORY_DEFAULT_MAX_REVIEW_ROUNDS),
  }
  const staleIdleMs = positiveInteger(env.BORING_FACTORY_STALE_IDLE_MS, FACTORY_DEFAULT_STALE_IDLE_MS)
  const ledger = createFactoryDispatchLedger(options.stateRoot)
  const run = options.runBr ?? defaultRunBr
  let boundApp: FastifyInstance | undefined
  const getApp = () => boundApp
  let sessionAdmissions = Promise.resolve()
  async function admitSessionMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = sessionAdmissions.then(operation)
    sessionAdmissions = next.then(() => undefined, () => undefined)
    return await next
  }

  const plugin = defineServerPlugin({
    id: FACTORY_DELEGATE_PLUGIN_ID,
    label: 'Factory delegation',
    contentDigest: sha256(DELEGATE_PLUGIN_VERSION),
    agentConfigContract: { keys: [] },
    agentToolFactory({ agentTypeId }) {
      const tools: AgentTool[] = []
      const grant = DELEGATE_GRANTS[agentTypeId]
      if (grant) tools.push(createDelegateTool(grant.toolName, grant.targetAgentTypeId, getApp, options, ledger, limits, run, admitSessionMutation))
      if (agentTypeId === FACTORY_STATUS_AGENT_TYPE_ID) {
        tools.push(...createFactoryStatusTools(getApp, options, ledger, limits, staleIdleMs, admitSessionMutation))
      }
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
