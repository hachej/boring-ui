import { createHash, randomUUID } from 'node:crypto'
import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentGateway,
  type AgentGatewayErrorDTO,
  type AgentSessionActivity,
  type AgentSessionConnection,
  type AgentSessionEvent,
  type AgentSessionRef,
  type AgentSendReceipt,
  type AgentSessionStateSnapshot,
  type AgentSessionSummary,
  type AuthorizedAgentScope,
  type IdempotentAgentSend,
  type JsonValue,
  type VerifiedAgentScopeClaim,
} from '../../shared/index'
import type { PiChatEvent, PiChatSnapshot } from '../../shared/chat'
import {
  type PiChatSessionService,
  type PiSessionRequestContext,
} from '../../core/piChatSessionService'
import { AgentSessionEventQueue } from './agentSessionEventQueue'
import {
  runAgentEffect,
  type AgentEffectPreparation,
} from './agentEffectRunner'
import { agentSessionKey } from './agentSessionKey'
import { canonicalDigest } from './canonical'
import { stableServiceActionFailure } from './stableServiceError'
import type { AgentHostRuntime } from './createAgentHost'
import type {
  AgentGatewayEffect,
  AgentHostGateway,
  AgentRequestFailure,
  AgentRequestTarget,
} from './types'

const DEFAULT_PAGE_LIMIT = 50

interface PreparedEffect<TContext, TReceipt> {
  /** Host/Gateway preparation performed only after durable external admission. */
  prepare(): Promise<AgentEffectPreparation<TContext>>
  /** The provider mutation; receives only a successfully prepared context. */
  execute(context: TContext): Promise<TReceipt>
}

interface EffectBehavior {
  readonly replay: 'exact' | 'mark-duplicate'
  /** Opt-in only when a rejected action promise proves no provider mutation began. */
  readonly classifySafeFailure?: (error: unknown) => AgentRequestFailure | undefined
}

interface SessionEffectOptions {
  readonly behavior?: EffectBehavior
}

const DEFAULT_EFFECT_BEHAVIOR: EffectBehavior = {
  replay: 'exact',
}
const MAX_PAGE_LIMIT = 100

function sessionTarget(ref: AgentSessionRef): AgentRequestTarget {
  return { kind: 'session', ref }
}

function context(
  claim: VerifiedAgentScopeClaim,
  requestId: string,
): PiSessionRequestContext {
  return {
    workspaceId: claim.workspaceScopeId,
    storageScope: claim.workspaceScopeId,
    authSubject: claim.authSubjectId,
    sessionAuthority: 'workspace-scope',
    requestId,
  }
}

function summaryFromLegacy(
  ref: AgentSessionRef,
  summary: {
    title: string
    createdAt: string
    updatedAt: string
    turnCount?: number
    nativeSessionId?: string
    hasAssistantReply?: boolean
  },
  status: AgentSessionActivity,
): AgentSessionSummary {
  return {
    ref,
    title: summary.title,
    status,
    createdAt: Date.parse(summary.createdAt),
    updatedAt: Date.parse(summary.updatedAt),
    ...(typeof summary.turnCount === 'number' ? { turnCount: summary.turnCount } : {}),
    ...(typeof summary.nativeSessionId === 'string' ? { nativeSessionId: summary.nativeSessionId } : {}),
    ...(typeof summary.hasAssistantReply === 'boolean' ? { hasAssistantReply: summary.hasAssistantReply } : {}),
  }
}

function compareSessions(a: AgentSessionSummary, b: AgentSessionSummary): number {
  return b.updatedAt - a.updatedAt
    || a.ref.agentTypeId.localeCompare(b.ref.agentTypeId)
    || a.ref.sessionId.localeCompare(b.ref.sessionId)
}

function isAfterCursor(
  summary: AgentSessionSummary,
  cursor: { updatedAt: number; agentTypeId: string; sessionId: string },
): boolean {
  return summary.updatedAt < cursor.updatedAt
    || (summary.updatedAt === cursor.updatedAt && (
      summary.ref.agentTypeId > cursor.agentTypeId
      || (summary.ref.agentTypeId === cursor.agentTypeId && summary.ref.sessionId > cursor.sessionId)
    ))
}

export class EmbeddedAgentGateway implements AgentHostGateway {
  private readonly cursorSecret = randomUUID()
  private readonly connections = new Set<() => Promise<void>>()
  private readonly writerTails = new Map<string, Promise<void>>()
  private readonly knownSessions = new Set<string>()
  private closed = false

  constructor(private readonly runtime: AgentHostRuntime) {}

  /** Host-owned addressed runtime-capability effect seam. */
  async runHostEffect<TContext>(input: {
    readonly scope: AuthorizedAgentScope
    readonly operation: 'agent.reload' | 'session.command.execute'
    readonly target: AgentRequestTarget
    readonly requestId: string
    readonly payload: JsonValue
    readonly prepare: () => Promise<TContext>
    readonly action: (context: TContext) => Promise<JsonValue>
  }): Promise<JsonValue> {
    const claim = await this.verify(input.scope)
    if (input.operation === 'agent.reload') {
      if (input.target.kind !== 'agent') throw new TypeError('agent.reload requires an Agent target')
      return await this.effect(
        claim,
        input.operation,
        input.target,
        input.requestId,
        input.payload,
        {
          prepare: async () => ({ kind: 'ready', context: await input.prepare() }),
          execute: input.action,
        },
      )
    }
    if (input.target.kind !== 'session') {
      throw new TypeError('session.command.execute requires a session target')
    }
    return await this.sessionEffect(
      input.target.ref,
      claim,
      input.operation,
      input.requestId,
      input.payload,
      {
        prepare: async () => ({ kind: 'ready', context: await input.prepare() }),
        execute: input.action,
      },
    )
  }

  /** Host-internal resolver shared by every session-bearing capability route. */
  async resolveHostSessionBinding(scope: AuthorizedAgentScope, ref: AgentSessionRef) {
    const claim = await this.verify(scope)
    const binding = await this.bindingForSession(scope, claim, ref)
    return { claim, binding }
  }

  /** Side-effect-free reload lookup: validates session access and requires the current binding to be published. */
  async inspectPublishedSessionBinding(scope: AuthorizedAgentScope, ref: AgentSessionRef) {
    const claim = await this.verify(scope)
    if (!this.runtime.compiledById.has(ref.agentTypeId)) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const sessionKey = agentSessionKey(claim.workspaceScopeId, ref)
    const persistedRuntime = await this.runtime.resolveSessionRuntime(
      ref.agentTypeId,
      scope,
      claim,
      ref.sessionId,
    )
    if (!persistedRuntime && !this.knownSessions.has(sessionKey)) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const resolved = persistedRuntime ?? await this.runtime.resolveAgentRuntimeScope(
      ref.agentTypeId,
      scope,
      claim,
      'existing-session',
      `session:${ref.sessionId}`,
      ref.sessionId,
    )
    const binding = this.runtime.findPublishedCurrentBinding(
      ref.agentTypeId,
      claim.workspaceScopeId,
      resolved.physicalBindingIdentity ?? resolved.identity,
      resolved.identity,
      resolved.environment.provisioningFingerprint,
    )
    if (!binding) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
        'session runtime binding is not currently published',
      )
    }
    return { claim, binding }
  }

  /** Test-only activity seam used by the shared implementation conformance. */
  setActivityForTesting(
    workspaceScopeId: string,
    ref: AgentSessionRef,
    activity: AgentSessionActivity,
  ): void {
    this.runtime.activity.set(workspaceScopeId, ref, activity)
  }

  private assertOpen(): void {
    if (this.closed) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'gateway is closed')
    this.runtime.assertOpen()
  }

  private async verify(scope: AuthorizedAgentScope): Promise<VerifiedAgentScopeClaim> {
    this.assertOpen()
    return await this.runtime.verify(scope)
  }

  async listAgents(input: { readonly scope: AuthorizedAgentScope }) {
    await this.verify(input.scope)
    return this.runtime.compiledAgents.map((agent) => ({
      agentTypeId: agent.agentTypeId,
      label: 'legacyDefault' in agent ? 'Agent' : agent.definition.label,
      ...('legacyDefault' in agent || !agent.plugins?.length
        ? {}
        : { pluginIds: agent.plugins.map((plugin) => plugin.name) }),
      ...('legacyDefault' in agent || !agent.definition.version
        ? {}
        : { definition: { version: agent.definition.version, digest: canonicalDigest(agent.definition as unknown as JsonValue) } }),
    }))
  }

  async listSessions(input: Parameters<AgentGateway['listSessions']>[0]) {
    const claim = await this.verify(input.scope)
    const normalizedLimit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_PAGE_LIMIT)))
    if (input.agentTypeId && !this.runtime.compiledById.has(input.agentTypeId)) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'agent type is not available')
    }
    const cursor = input.cursor
      ? this.decodeCursor(input.cursor, claim.workspaceScopeId, input.agentTypeId, normalizedLimit)
      : { depth: 0, after: undefined }
    const agents = input.agentTypeId
      ? [input.agentTypeId]
      : [...this.runtime.compiledById.keys()]
    // Bounded fan-out. Every seat's store orders by the same recency key this
    // gateway sorts by, so a row that lands at merged rank `r` sits at rank
    // <= r inside its own seat's listing. The page covers merged ranks
    // [depth, depth + limit), and one extra row decides `nextCursor` — so
    // `depth + limit + 1` rows per seat is exactly sufficient and never reads
    // the rest of the store (#1338: an unbounded listing parsed every
    // transcript on every request).
    const perAgentLimit = cursor.depth + normalizedLimit + 1
    const rows: AgentSessionSummary[] = []
    for (const agentTypeId of agents) {
      const listed = await this.runtime.listSessionSummaries(agentTypeId, input.scope, claim, { limit: perAgentLimit })
      for (const item of listed) {
        const ref = { agentTypeId, sessionId: item.id }
        rows.push(summaryFromLegacy(ref, item, this.runtime.activity.get(claim.workspaceScopeId, ref)))
      }
    }
    rows.sort(compareSessions)
    const eligible = cursor.after ? rows.filter((row) => isAfterCursor(row, cursor.after!)) : rows
    const sessions = eligible.slice(0, normalizedLimit)
    const nextCursor = eligible.length > sessions.length && sessions.length > 0
      ? this.encodeCursor(
          claim.workspaceScopeId,
          input.agentTypeId,
          normalizedLimit,
          cursor.depth + sessions.length,
          sessions.at(-1)!,
        )
      : undefined
    return { sessions, ...(nextCursor ? { nextCursor } : {}) }
  }

  async createSession(input: Parameters<AgentGateway['createSession']>[0]) {
    const claim = await this.verify(input.scope)
    if (!this.runtime.compiledById.has(input.agentTypeId)) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'agent type is not available')
    }
    const target: AgentRequestTarget = { kind: 'agent', agentTypeId: input.agentTypeId }
    return await this.effect(
      claim,
      'session.create',
      target,
      input.requestId,
      {
        agentTypeId: input.agentTypeId,
        title: input.title ?? null,
        resumeSessionId: input.resumeSessionId ?? null,
      },
      {
        prepare: async () => ({
          kind: 'ready',
          context: await this.runtime.resolveBinding(input.agentTypeId, input.scope, claim),
        }),
        execute: async (binding) => await this.runtime.runBindingOperation(binding.key, async () => {
          if (input.resumeSessionId) {
            const candidateRef = { agentTypeId: input.agentTypeId, sessionId: input.resumeSessionId }
            const resolved = await this.runtime.resolveSessionRuntime(
              input.agentTypeId,
              input.scope,
              claim,
              input.resumeSessionId,
            ).catch(() => undefined)
            if (resolved) {
              const rows = await binding.composition.service.listSessions?.(
                context(claim, input.requestId),
                { includeId: input.resumeSessionId, includeEmpty: true },
              ) ?? []
              const candidate = rows.find((row) => row.id === input.resumeSessionId)
              if (candidate?.turnCount === 0) {
                this.knownSessions.add(agentSessionKey(claim.workspaceScopeId, candidateRef))
                this.runtime.activity.set(claim.workspaceScopeId, candidateRef, 'idle')
                return candidateRef
              }
            }
          }

          const created = await binding.composition.service.createSession!(
            context(claim, input.requestId),
            { title: input.title },
          )
          const ref = { agentTypeId: input.agentTypeId, sessionId: created.id }
          this.knownSessions.add(agentSessionKey(claim.workspaceScopeId, ref))
          this.runtime.activity.set(claim.workspaceScopeId, ref, 'idle')
          return ref
        }),
      },
    )
  }

  async readSessionState(input: Parameters<AgentGateway['readSessionState']>[0]): Promise<AgentSessionStateSnapshot> {
    const claim = await this.verify(input.scope)
    const binding = await this.bindingForSession(input.scope, claim, input.ref)
    let state: PiChatSnapshot
    try {
      state = await binding.composition.service.readState(
        context(claim, randomUUID()), input.ref.sessionId,
      )
    } catch {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const loaded = await this.loadSummary(binding.composition.service, claim, input.ref)
    const status = this.runtime.activity.get(claim.workspaceScopeId, input.ref)
    return {
      ref: input.ref,
      seq: state.seq,
      summary: summaryFromLegacy(input.ref, loaded, status),
      state: state as unknown as AgentSessionStateSnapshot['state'],
    }
  }

  async connectSession(input: Parameters<AgentGateway['connectSession']>[0]): Promise<AgentSessionConnection> {
    const claim = await this.verify(input.scope)
    const binding = await this.bindingForSession(input.scope, claim, input.ref)
    await this.loadSummary(binding.composition.service, claim, input.ref)
    const queue = new AgentSessionEventQueue()
    const initialCursor = input.cursor ?? (await binding.composition.service.readState(
      context(claim, randomUUID()),
      input.ref.sessionId,
    )).seq
    const subscribed = await binding.composition.service.subscribe(
      context(claim, randomUUID()),
      input.ref.sessionId,
      initialCursor,
      (event) => {
        this.runtime.activity.observe(claim.workspaceScopeId, input.ref, event)
        queue.push({
          ref: input.ref,
          seq: event.seq,
          event: event as unknown as AgentSessionEvent['event'],
        })
      },
    )
    if (subscribed.type !== 'ok') {
      throw new AgentGatewayError(
        subscribed.type === 'replay_gap'
          ? AgentGatewayErrorCode.AGENT_SESSION_REPLAY_GAP
          : AgentGatewayErrorCode.AGENT_SESSION_CURSOR_AHEAD,
        'requested event cursor is unavailable',
        { latestSeq: subscribed.latestSeq, minReplaySeq: subscribed.minReplaySeq },
      )
    }
    let connectionClosed = false
    let unregisterHost = () => {}
    const close = async () => {
      if (connectionClosed) return
      connectionClosed = true
      subscribed.unsubscribe()
      queue.close()
      unregisterHost()
      this.connections.delete(close)
    }
    unregisterHost = this.runtime.registerSubscription(close)
    this.connections.add(close)
    const reverify = async () => {
      if (connectionClosed) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'session connection is closed')
      return await this.verify(input.scope)
    }
    return {
      ref: input.ref,
      events: queue,
      send: async (command) => {
        const current = await reverify()
        return await this.send(input.ref, input.scope, current, command) as Awaited<ReturnType<AgentSessionConnection['send']>>
      },
      interrupt: async ({ requestId, queueAction }) => {
        const current = await reverify()
        const payload: Record<string, never> | { queueAction: 'hold' | 'resume' } = queueAction === undefined ? {} : { queueAction }
        return await this.sessionEffect(input.ref, current, 'session.interrupt', requestId, payload, {
          prepare: async () => ({
            kind: 'ready',
            context: await this.bindingForSession(input.scope, current, input.ref),
          }),
          execute: async (binding) => await this.runtime.runBindingOperation(binding.key, async () => {
            const receipt = await binding.composition.service.interrupt(
              context(current, requestId), input.ref.sessionId, payload,
            )
            if (queueAction !== 'resume' && this.runtime.activity.get(current.workspaceScopeId, input.ref) === 'running') {
              this.runtime.activity.set(current.workspaceScopeId, input.ref, 'aborting')
            }
            return receipt
          }),
        })
      },
      stop: async ({ requestId }) => {
        const current = await reverify()
        return await this.sessionEffect(input.ref, current, 'session.stop', requestId, {}, {
          prepare: async () => ({
            kind: 'ready',
            context: await this.bindingForSession(input.scope, current, input.ref),
          }),
          execute: async (binding) => await this.runtime.runBindingOperation(binding.key, async () => {
            const receipt = await binding.composition.service.stop(
              context(current, requestId), input.ref.sessionId, {},
            )
            this.runtime.activity.set(current.workspaceScopeId, input.ref, 'idle')
            return receipt
          }),
        })
      },
      clearQueue: async ({ requestId, clientNonce, clientSeq }) => {
        const current = await reverify()
        return await this.sessionEffect(input.ref, current, 'session.queue.clear', requestId, {
          clientNonce: clientNonce ?? null,
          clientSeq: clientSeq ?? null,
        }, {
          prepare: async () => {
            const binding = await this.bindingForSession(input.scope, current, input.ref)
            const error = await this.queueClearAdmission(
              binding.composition.service,
              current,
              input.ref,
              requestId,
              clientNonce,
              clientSeq,
            )
            return error
              ? { kind: 'reject', error }
              : { kind: 'ready', context: binding }
          },
          execute: (binding) => this.runtime.runBindingOperation(binding.key, () =>
            binding.composition.service.clearQueue(
              context(current, requestId),
              input.ref.sessionId,
              { ...(clientNonce ? { clientNonce } : {}), ...(clientSeq === undefined ? {} : { clientSeq }) },
            )),
        })
      },
      close,
    }
  }

  /** Effect-first send path used by direct HTTP projection without opening a subscription. */
  async sendSession(input: {
    readonly scope: AuthorizedAgentScope
    readonly ref: AgentSessionRef
    readonly command: IdempotentAgentSend
  }): Promise<AgentSendReceipt> {
    const claim = await this.verify(input.scope)
    return await this.send(input.ref, input.scope, claim, input.command)
  }

  private async send(
    ref: AgentSessionRef,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    command: IdempotentAgentSend,
  ): Promise<AgentSendReceipt> {
    if (command.kind === 'prompt') {
      return await this.sessionEffect(
        ref,
        claim,
        'session.prompt',
        command.requestId,
        command as unknown as JsonValue,
        {
          prepare: async () => {
            const binding = await this.bindingForSession(scope, claim, ref)
            const error = await this.promptAdmission(
              binding.composition.service,
              claim,
              ref,
              command.requestId,
              command.requireIdle === true,
            )
            return error
              ? { kind: 'retryable', error }
              : { kind: 'ready', context: binding }
          },
          execute: async (binding) => {
            const service = binding.composition.service
            return await this.runtime.runBindingOperation(binding.key, async () => {
            const receipt = await service.prompt(context(claim, command.requestId), ref.sessionId, {
              message: command.content,
              displayMessage: command.displayContent,
              clientNonce: command.clientNonce,
              model: command.model,
              thinkingLevel: command.thinkingLevel,
              attachments: command.attachments ? [...command.attachments] : undefined,
            })
            this.runtime.activity.set(claim.workspaceScopeId, ref, 'running')
            return { ...receipt, disposition: 'prompt' as const }
            })
          },
        },
        {
          behavior: {
            replay: 'mark-duplicate',
            classifySafeFailure: stableServiceActionFailure,
          },
        },
      )
    }
    return await this.sessionEffect(
      ref,
      claim,
      'session.followup',
      command.requestId,
      command as unknown as JsonValue,
      {
        prepare: async () => ({
          kind: 'ready',
          context: await this.bindingForSession(scope, claim, ref),
        }),
        execute: async (binding) => await this.runtime.runBindingOperation(binding.key, async () => {
          const receipt = await binding.composition.service.followUp(
            context(claim, command.requestId),
            ref.sessionId,
            {
              message: command.content,
              displayMessage: command.displayContent,
              clientNonce: command.clientNonce,
              clientSeq: command.clientSeq,
            },
          )
          return { ...receipt, disposition: 'followup' as const }
        }),
      },
      {
        behavior: {
          replay: 'mark-duplicate',
          classifySafeFailure: stableServiceActionFailure,
        },
      },
    )
  }

  async renameSession(input: Parameters<AgentGateway['renameSession']>[0]) {
    const claim = await this.verify(input.scope)
    return await this.sessionEffect(input.ref, claim, 'session.rename', input.requestId, { title: input.title }, {
      prepare: async () => ({
        kind: 'ready',
        context: await this.bindingForSession(input.scope, claim, input.ref),
      }),
      execute: async (preparedBinding) => await this.runtime.runBindingOperation(preparedBinding.key, async () => {
        const repository = preparedBinding.composition.sessionStore as typeof preparedBinding.composition.sessionStore & {
          rename?: (ctx: { workspaceId?: string }, sessionId: string, title: string) => Promise<{ title: string; createdAt: string; updatedAt: string }>
        }
        if (!repository.rename) {
          throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE, 'session repository does not support rename')
        }
        const renamed = await repository.rename!(
          { workspaceId: claim.workspaceScopeId }, input.ref.sessionId, input.title,
        )
        return summaryFromLegacy(input.ref, renamed, this.runtime.activity.get(claim.workspaceScopeId, input.ref))
      }),
    })
  }

  async deleteSession(input: Parameters<AgentGateway['deleteSession']>[0]): Promise<void> {
    const claim = await this.verify(input.scope)
    await this.sessionEffect(input.ref, claim, 'session.delete', input.requestId, {}, {
      prepare: async () => ({
        kind: 'ready',
        context: await this.bindingForSession(input.scope, claim, input.ref),
      }),
      execute: async (preparedBinding) => await this.runtime.runBindingOperation(preparedBinding.key, async () => {
        await preparedBinding.composition.service.deleteSession!(
          context(claim, input.requestId), input.ref.sessionId,
        )
        this.runtime.activity.delete(claim.workspaceScopeId, input.ref)
        return null
      }),
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.allSettled([...this.connections].map((close) => close()))
    this.connections.clear()
  }

  private async bindingForSession(
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    ref: AgentSessionRef,
  ) {
    if (!this.runtime.compiledById.has(ref.agentTypeId)) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const sessionKey = agentSessionKey(claim.workspaceScopeId, ref)
    const persistedRuntime = await this.runtime.resolveSessionRuntime(
      ref.agentTypeId,
      scope,
      claim,
      ref.sessionId,
    )
    if (!persistedRuntime && !this.knownSessions.has(sessionKey)) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const currentRuntime = persistedRuntime ?? await this.runtime.resolveAgentRuntimeScope(
      ref.agentTypeId,
      scope,
      claim,
      'existing-session',
      `session:${ref.sessionId}`,
      ref.sessionId,
    )
    return await this.runtime.resolveBinding(ref.agentTypeId, scope, claim, currentRuntime)
  }

  private async loadSummary(
    service: PiChatSessionService,
    claim: VerifiedAgentScopeClaim,
    ref: AgentSessionRef,
  ) {
    const list = await service.listSessions?.(
      context(claim, randomUUID()),
      { includeId: ref.sessionId, includeEmpty: true },
    ) ?? []
    const summary = list.find((item) => item.id === ref.sessionId)
    if (!summary) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    return summary
  }

  private sessionEffect<TContext, TReceipt>(
    ref: AgentSessionRef,
    claim: VerifiedAgentScopeClaim,
    operation: AgentGatewayEffect,
    requestId: string,
    payload: JsonValue,
    preparedEffect: PreparedEffect<TContext, TReceipt>,
    options: SessionEffectOptions = {},
  ): Promise<TReceipt> {
    const behavior = options.behavior ?? DEFAULT_EFFECT_BEHAVIOR
    return runAgentEffect(this.runtime, {
      claim,
      operation,
      target: sessionTarget(ref),
      requestId,
      payload,
      plan: {
        ...behavior,
        runExclusive: (effect) => this.withWriter(claim.workspaceScopeId, ref, effect),
        prepare: preparedEffect.prepare,
        execute: preparedEffect.execute,
      },
    })
  }

  private effect<TContext, TReceipt>(
    claim: VerifiedAgentScopeClaim,
    operation: AgentGatewayEffect,
    target: AgentRequestTarget,
    requestId: string,
    payload: JsonValue,
    preparedEffect: PreparedEffect<TContext, TReceipt>,
    behavior: EffectBehavior = DEFAULT_EFFECT_BEHAVIOR,
  ): Promise<TReceipt> {
    return runAgentEffect(this.runtime, {
      claim,
      operation,
      target,
      requestId,
      payload,
      plan: {
        ...behavior,
        runExclusive: (run) => run(),
        prepare: preparedEffect.prepare,
        execute: preparedEffect.execute,
      },
    })
  }

  private async promptAdmission(
    service: PiChatSessionService,
    claim: VerifiedAgentScopeClaim,
    ref: AgentSessionRef,
    requestId: string,
    requireIdle: boolean,
  ): Promise<AgentGatewayErrorDTO | undefined> {
    const snapshot = await service.readState(
      context(claim, requestId),
      ref.sessionId,
    )
    const admissible = requireIdle
      ? snapshot.status === 'idle'
      : snapshot.status === 'idle' || snapshot.status === 'error'
    if (admissible) return undefined
    return new AgentGatewayError(
      AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
      requireIdle ? 'session is not idle' : 'prompt is invalid in current state',
      { status: snapshot.status },
    ).toJSON()
  }

  private async queueClearAdmission(
    service: PiChatSessionService,
    claim: VerifiedAgentScopeClaim,
    ref: AgentSessionRef,
    requestId: string,
    clientNonce?: string,
    clientSeq?: number,
  ): Promise<AgentGatewayErrorDTO | undefined> {
    if (clientNonce === undefined || clientSeq === undefined) return undefined
    const snapshot = await service.readState(
      context(claim, requestId), ref.sessionId,
    )
    const byNonce = snapshot.queue.followUps.find((item) => item.clientNonce === clientNonce)
    const bySeq = snapshot.queue.followUps.find((item) => item.clientSeq === clientSeq)
    if (byNonce && byNonce === bySeq) return undefined
    return new AgentGatewayError(
      AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
      'queue selectors disagree',
    ).toJSON()
  }

  private async withWriter<T>(workspaceScopeId: string, ref: AgentSessionRef, action: () => Promise<T>): Promise<T> {
    const key = agentSessionKey(workspaceScopeId, ref)
    const previous = this.writerTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    this.writerTails.set(key, tail)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.writerTails.get(key) === tail) this.writerTails.delete(key)
    }
  }

  private encodeCursor(
    workspaceScopeId: string,
    agentTypeId: string | undefined,
    limit: number,
    depth: number,
    last: AgentSessionSummary,
  ): string {
    const payload = JSON.stringify({
      workspaceScopeId,
      agentTypeId: agentTypeId ?? null,
      limit,
      depth,
      updatedAt: last.updatedAt,
      lastAgentTypeId: last.ref.agentTypeId,
      sessionId: last.ref.sessionId,
    })
    const encoded = Buffer.from(payload).toString('base64url')
    const signature = createHash('sha256').update(`${this.cursorSecret}:${encoded}`).digest('base64url')
    return `${encoded}.${signature}`
  }

  private decodeCursor(
    cursor: string,
    workspaceScopeId: string,
    agentTypeId: string | undefined,
    limit: number,
  ): { depth: number; after: { updatedAt: number; agentTypeId: string; sessionId: string } } {
    try {
      const [encoded, signature, extra] = cursor.split('.')
      if (!encoded || !signature || extra) throw new Error('malformed')
      const expected = createHash('sha256').update(`${this.cursorSecret}:${encoded}`).digest('base64url')
      if (signature !== expected) throw new Error('signature')
      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>
      if (
        decoded.workspaceScopeId !== workspaceScopeId
        || decoded.agentTypeId !== (agentTypeId ?? null)
        || decoded.limit !== limit
        || typeof decoded.depth !== 'number'
        || !Number.isInteger(decoded.depth)
        || decoded.depth < 0
        || typeof decoded.updatedAt !== 'number'
        || typeof decoded.lastAgentTypeId !== 'string'
        || typeof decoded.sessionId !== 'string'
      ) throw new Error('binding')
      return {
        depth: decoded.depth,
        after: {
          updatedAt: decoded.updatedAt,
          agentTypeId: decoded.lastAgentTypeId,
          sessionId: decoded.sessionId,
        },
      }
    } catch {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_CURSOR_INVALID, 'session cursor is invalid')
    }
  }
}
