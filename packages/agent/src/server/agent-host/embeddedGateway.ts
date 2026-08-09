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
import { agentSessionKey } from './agentSessionKey'
import { canonicalDigest } from './canonical'
import { stableServiceActionFailure } from './stableServiceError'
import type { AgentHostRuntime } from './createAgentHost'
import type {
  AgentGatewayEffect,
  AgentRequestFailure,
  AgentRequestKey,
  AgentRequestTarget,
} from './types'

const DEFAULT_PAGE_LIMIT = 50

type RetryableSessionGuard = () => Promise<AgentGatewayErrorDTO | undefined>
type EffectSerializer = <T>(effect: () => Promise<T>) => Promise<T>
type EffectClassification =
  | { readonly kind: 'execute' }
  | { readonly kind: 'reject'; readonly error: AgentGatewayErrorDTO }
type EffectClassifier = () => Promise<EffectClassification>
type SafeActionFailureClassifier = (error: unknown) => AgentRequestFailure | undefined

interface EffectOptions {
  duplicateReceipt?: boolean
  serialize?: EffectSerializer
  guard?: RetryableSessionGuard
  classify?: EffectClassifier
  /** Deterministic validation that must run while holding the session writer. */
  serializedClassify?: EffectClassifier
  /** Host/Gateway-only work that must finish before provider mutation begins. */
  preflight?: () => Promise<void>
  /** Opt-in only when a rejected action promise proves no provider mutation began. */
  classifySafeActionFailure?: SafeActionFailureClassifier
}
interface SessionEffectOptions extends Omit<EffectOptions, 'serialize'> {
  bindingKey?: string
}
const MAX_PAGE_LIMIT = 100
const UNAUTHORIZED_HISTORICAL_RUNTIME_IDENTITY = '33293674ddb7f24bcc036f4b5bedbf2457ac3a639e2969353ccb0175d385d7fe'

type ReceiptObject = Readonly<Record<string, JsonValue>>

function gatewayError(dto: AgentGatewayErrorDTO): AgentGatewayError {
  return new AgentGatewayError(dto.code, dto.message, dto.details)
}

function sessionTarget(ref: AgentSessionRef): AgentRequestTarget {
  return { kind: 'session', ref }
}

function context(
  claim: VerifiedAgentScopeClaim,
  requestId: string,
  runtimeScopeIdentity?: string,
): PiSessionRequestContext {
  return {
    workspaceId: claim.workspaceScopeId,
    storageScope: claim.workspaceScopeId,
    authSubject: claim.authSubjectId,
    sessionAuthority: 'workspace-scope',
    ...(runtimeScopeIdentity ? { runtimeScopeIdentity } : {}),
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

export class EmbeddedAgentGateway implements AgentGateway {
  private readonly cursorSecret = randomUUID()
  private readonly connections = new Set<() => Promise<void>>()
  private readonly pins = new Map<string, string>()
  private readonly unpinnedSessionFallbackPins = new Set<string>()
  private readonly writerTails = new Map<string, Promise<void>>()
  private sessionRuntimeResolutionObserver?: (input: {
    readonly source: 'unpinned-session-fallback' | 'persisted-runtime-pin'
    readonly runtimeScopeIdentity: string
  }) => void
  private closed = false

  constructor(private readonly runtime: AgentHostRuntime) {}

  /** Host-owned addressed runtime-capability effect seam. */
  async runHostEffect(input: {
    readonly scope: AuthorizedAgentScope
    readonly operation: 'agent.reload' | 'session.command.execute'
    readonly target: AgentRequestTarget
    readonly requestId: string
    readonly payload: JsonValue
    readonly action: () => Promise<JsonValue>
    readonly classify?: () => Promise<
      | { readonly kind: 'execute' }
      | { readonly kind: 'reject'; readonly error: AgentGatewayErrorDTO }
    >
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
        input.action,
        { classify: input.classify },
      ) as JsonValue
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
      input.action,
    ) as JsonValue
  }

  /** Host-internal resolver shared by every session-bearing capability route. */
  async resolveHostSessionBinding(scope: AuthorizedAgentScope, ref: AgentSessionRef) {
    const claim = await this.verify(scope)
    const binding = await this.bindingForSession(scope, claim, ref)
    return { claim, binding }
  }

  /** Side-effect-free reload lookup: validates persisted existence/pin and requires an already-published binding. */
  async inspectPublishedSessionBinding(scope: AuthorizedAgentScope, ref: AgentSessionRef) {
    const claim = await this.verify(scope)
    if (!this.runtime.compiledById.has(ref.agentTypeId)) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const authority = await this.runtime.resolveSessionRuntime(
      ref.agentTypeId,
      scope,
      claim,
      ref.sessionId,
    )
    const cached = this.pins.get(agentSessionKey(claim.workspaceScopeId, ref))
    if (!authority && !cached) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const runtimeScopeIdentity = authority?.runtimeScopeIdentity ?? cached ?? authority?.runtimeScope.identity
    const binding = this.runtime.findPublishedBinding(
      ref.agentTypeId,
      claim.workspaceScopeId,
      runtimeScopeIdentity,
      authority?.runtimeScope.physicalBindingIdentity ?? authority?.runtimeScope.identity,
      authority?.runtimeScope.environment.provisioningFingerprint,
    )
    if (!binding) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
        'session runtime binding is not currently published',
      )
    }
    return { claim, binding }
  }

  /** Server-only test observer for distinguishing runtime pin resolution paths. */
  setSessionRuntimeResolutionObserverForTesting(
    observer: (input: {
      readonly source: 'unpinned-session-fallback' | 'persisted-runtime-pin'
      readonly runtimeScopeIdentity: string
    }) => void,
  ): void {
    this.sessionRuntimeResolutionObserver = observer
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
      : undefined
    const agents = input.agentTypeId
      ? [input.agentTypeId]
      : [...this.runtime.compiledById.keys()]
    const rows: AgentSessionSummary[] = []
    for (const agentTypeId of agents) {
      const listed = await this.runtime.listSessionSummaries(agentTypeId, input.scope, claim)
      for (const item of listed) {
        const ref = { agentTypeId, sessionId: item.id }
        rows.push(summaryFromLegacy(ref, item, this.runtime.activity.get(claim.workspaceScopeId, ref)))
      }
    }
    rows.sort(compareSessions)
    const eligible = cursor ? rows.filter((row) => isAfterCursor(row, cursor)) : rows
    const sessions = eligible.slice(0, normalizedLimit)
    const nextCursor = eligible.length > sessions.length && sessions.length > 0
      ? this.encodeCursor(claim.workspaceScopeId, input.agentTypeId, normalizedLimit, sessions.at(-1)!)
      : undefined
    return { sessions, ...(nextCursor ? { nextCursor } : {}) }
  }

  async createSession(input: Parameters<AgentGateway['createSession']>[0]) {
    const claim = await this.verify(input.scope)
    if (!this.runtime.compiledById.has(input.agentTypeId)) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'agent type is not available')
    }
    const target: AgentRequestTarget = { kind: 'agent', agentTypeId: input.agentTypeId }
    let binding: Awaited<ReturnType<AgentHostRuntime['resolveBinding']>> | undefined
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
      async () => {
        const preparedBinding = binding
        if (!preparedBinding) throw new TypeError('session creation executed before binding preflight')
        return await this.runtime.runBindingOperation(preparedBinding.key, async () => {
          if (input.resumeSessionId) {
            const candidateRef = { agentTypeId: input.agentTypeId, sessionId: input.resumeSessionId }
            const authority = await this.runtime.resolveSessionRuntime(
              input.agentTypeId,
              input.scope,
              claim,
              input.resumeSessionId,
            ).catch(() => undefined)
            if (authority?.runtimeScopeIdentity === preparedBinding.scope.identity) {
              const rows = await preparedBinding.composition.service.listSessions?.(
                context(claim, input.requestId, preparedBinding.scope.identity),
                { includeId: input.resumeSessionId, includeEmpty: true },
              ) ?? []
              const candidate = rows.find((row) => row.id === input.resumeSessionId)
              if (candidate?.turnCount === 0) {
                this.pins.set(agentSessionKey(claim.workspaceScopeId, candidateRef), preparedBinding.scope.identity)
                this.runtime.activity.set(claim.workspaceScopeId, candidateRef, 'idle')
                return candidateRef
              }
            }
          }

          const created = await preparedBinding.composition.service.createSession!(
            context(claim, input.requestId, preparedBinding.scope.identity),
            { title: input.title },
          )
          const ref = { agentTypeId: input.agentTypeId, sessionId: created.id }
          this.pins.set(agentSessionKey(claim.workspaceScopeId, ref), preparedBinding.scope.identity)
          this.runtime.activity.set(claim.workspaceScopeId, ref, 'idle')
          return ref
        })
      },
      {
        preflight: async () => {
          binding = await this.runtime.resolveBinding(input.agentTypeId, input.scope, claim)
        },
      },
    ) as AgentSessionRef
  }

  async readSessionState(input: Parameters<AgentGateway['readSessionState']>[0]): Promise<AgentSessionStateSnapshot> {
    const claim = await this.verify(input.scope)
    const binding = await this.bindingForSession(input.scope, claim, input.ref)
    let state: PiChatSnapshot
    try {
      state = await binding.composition.service.readState(
        context(claim, randomUUID(), binding.scope.identity), input.ref.sessionId,
      )
    } catch {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const loaded = await this.loadSummary(binding.composition.service, claim, input.ref, binding.scope.identity)
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
    await this.loadSummary(binding.composition.service, claim, input.ref, binding.scope.identity)
    const queue = new AgentSessionEventQueue()
    const initialCursor = input.cursor ?? (await binding.composition.service.readState(
      context(claim, randomUUID(), binding.scope.identity),
      input.ref.sessionId,
    )).seq
    const subscribed = await binding.composition.service.subscribe(
      context(claim, randomUUID(), binding.scope.identity),
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
      interrupt: async ({ requestId }) => {
        const current = await reverify()
        const currentBinding = await this.bindingForSession(input.scope, current, input.ref)
        return await this.sessionEffect(input.ref, current, 'session.interrupt', requestId, {}, async () => {
          const receipt = await currentBinding.composition.service.interrupt(
            context(current, requestId, currentBinding.scope.identity), input.ref.sessionId, {},
          )
          if (this.runtime.activity.get(current.workspaceScopeId, input.ref) === 'running') {
            this.runtime.activity.set(current.workspaceScopeId, input.ref, 'aborting')
          }
          return receipt
        }, { bindingKey: currentBinding.key }) as Awaited<ReturnType<AgentSessionConnection['interrupt']>>
      },
      stop: async ({ requestId }) => {
        const current = await reverify()
        const currentBinding = await this.bindingForSession(input.scope, current, input.ref)
        return await this.sessionEffect(input.ref, current, 'session.stop', requestId, {}, async () => {
          const receipt = await currentBinding.composition.service.stop(
            context(current, requestId, currentBinding.scope.identity), input.ref.sessionId, {},
          )
          this.runtime.activity.set(current.workspaceScopeId, input.ref, 'idle')
          return receipt
        }, { bindingKey: currentBinding.key }) as Awaited<ReturnType<AgentSessionConnection['stop']>>
      },
      clearQueue: async ({ requestId, clientNonce, clientSeq }) => {
        const current = await reverify()
        const currentBinding = await this.bindingForSession(input.scope, current, input.ref)
        return await this.sessionEffect(input.ref, current, 'session.queue.clear', requestId, {
          clientNonce: clientNonce ?? null,
          clientSeq: clientSeq ?? null,
        }, () => currentBinding.composition.service.clearQueue(
          context(current, requestId, currentBinding.scope.identity),
          input.ref.sessionId,
          { ...(clientNonce ? { clientNonce } : {}), ...(clientSeq === undefined ? {} : { clientSeq }) },
        ), {
          bindingKey: currentBinding.key,
          serializedClassify: async () => {
            const error = await this.queueClearAdmission(
              currentBinding.composition.service,
              current,
              input.ref,
              currentBinding.scope.identity,
              requestId,
              clientNonce,
              clientSeq,
            )
            return error ? { kind: 'reject', error } : { kind: 'execute' }
          },
        }) as Awaited<ReturnType<AgentSessionConnection['clearQueue']>>
      },
      close,
    }
  }

  private async send(
    ref: AgentSessionRef,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    command: IdempotentAgentSend,
  ) {
    const binding = await this.bindingForSession(scope, claim, ref)
    const service = binding.composition.service
    if (command.kind === 'prompt') {
      return await this.sessionEffect(ref, claim, 'session.prompt', command.requestId, command as unknown as JsonValue, async () => {
        const receipt = await service.prompt(context(claim, command.requestId, binding.scope.identity), ref.sessionId, {
          message: command.content,
          displayMessage: command.displayContent,
          clientNonce: command.clientNonce,
          model: command.model,
          thinkingLevel: command.thinkingLevel,
          attachments: command.attachments ? [...command.attachments] : undefined,
        })
        this.runtime.activity.set(claim.workspaceScopeId, ref, 'running')
        return { ...receipt, disposition: 'prompt' as const }
      }, {
        duplicateReceipt: true,
        bindingKey: binding.key,
        classifySafeActionFailure: stableServiceActionFailure,
        guard: async () => await this.promptAdmission(
          scope,
          claim,
          ref,
          command.requestId,
          command.requireIdle === true,
        ),
      })
    }
    return await this.sessionEffect(ref, claim, 'session.followup', command.requestId, command as unknown as JsonValue, async () => {
      const receipt = await service.followUp(context(claim, command.requestId, binding.scope.identity), ref.sessionId, {
        message: command.content,
        displayMessage: command.displayContent,
        clientNonce: command.clientNonce,
        clientSeq: command.clientSeq,
      })
      return { ...receipt, disposition: 'followup' as const }
    }, {
      duplicateReceipt: true,
      bindingKey: binding.key,
      classifySafeActionFailure: stableServiceActionFailure,
    })
  }

  async renameSession(input: Parameters<AgentGateway['renameSession']>[0]) {
    const claim = await this.verify(input.scope)
    const binding = await this.bindingForSession(input.scope, claim, input.ref)
    return await this.sessionEffect(input.ref, claim, 'session.rename', input.requestId, { title: input.title }, async () => {
      const repository = binding.composition.sessionStore as typeof binding.composition.sessionStore & {
        rename?: (ctx: { workspaceId?: string }, sessionId: string, title: string) => Promise<{ title: string; createdAt: string; updatedAt: string }>
      }
      if (!repository.rename) {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE, 'session repository does not support rename')
      }
      const renamed = await repository.rename!(
        { workspaceId: claim.workspaceScopeId }, input.ref.sessionId, input.title,
      )
      return summaryFromLegacy(input.ref, renamed, this.runtime.activity.get(claim.workspaceScopeId, input.ref))
    }, { bindingKey: binding.key }) as AgentSessionSummary
  }

  async deleteSession(input: Parameters<AgentGateway['deleteSession']>[0]): Promise<void> {
    const claim = await this.verify(input.scope)
    const binding = await this.bindingForSession(input.scope, claim, input.ref)
    await this.sessionEffect(input.ref, claim, 'session.delete', input.requestId, {}, async () => {
      await binding.composition.service.deleteSession!(
        context(claim, input.requestId, binding.scope.identity), input.ref.sessionId,
      )
      // Keep the verified pin cached until Host shutdown so a same-process
      // idempotent delete retry can reach its completed ledger receipt.
      this.runtime.activity.delete(claim.workspaceScopeId, input.ref)
      return null
    }, { bindingKey: binding.key })
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
    const key = agentSessionKey(claim.workspaceScopeId, ref)
    const authority = await this.runtime.resolveSessionRuntime(
      ref.agentTypeId,
      scope,
      claim,
      ref.sessionId,
    )
    const cached = this.pins.get(key)
    if (!authority && !cached) {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    }
    const resolved = authority?.runtimeScope
      ?? await this.runtime.resolveAgentRuntimeScope(
        ref.agentTypeId,
        scope,
        claim,
        'existing-session',
        `session:${ref.sessionId}`,
        ref.sessionId,
      )
    let persistedPin = authority?.runtimeScopeIdentity
    let pinned = persistedPin ?? cached
    let preparedBinding: Awaited<ReturnType<AgentHostRuntime['resolveBinding']>> | undefined
    if (pinned && pinned !== resolved.identity) {
      const migrations = resolved.sessionIdentityMigrations ?? []
      const candidates = migrations.filter((migration) => (
        migration.schemaVersion === 1
        && migration.agentTypeId === ref.agentTypeId
        && migration.workspaceScopeId === claim.workspaceScopeId
        && migration.sessionNamespace === resolved.sessionNamespace
        && migration.fromIdentity === pinned
        && migration.toIdentity === resolved.identity
        && migration.fromIdentity !== UNAUTHORIZED_HISTORICAL_RUNTIME_IDENTITY
        && /^[a-f0-9]{64}$/.test(migration.fromIdentity)
        && /^[a-f0-9]{64}$/.test(migration.toIdentity)
        && /^[a-f0-9]{64}$/.test(migration.evidenceDigest)
      ))
      if (authority && candidates.length === 1) {
        try {
          preparedBinding = await this.runtime.resolveBinding(
            ref.agentTypeId,
            scope,
            claim,
            resolved,
            'current',
          )
          const result = await authority.migrateRuntimeScopeIdentity({
            expectedIdentity: candidates[0]!.fromIdentity,
            nextIdentity: candidates[0]!.toIdentity,
            evidenceDigest: candidates[0]!.evidenceDigest,
          })
          if (result === 'mismatch') throw new Error('runtime identity migration compare-and-swap failed')
        } catch (error) {
          // Fail closed, but keep the underlying migration failure diagnosable.
          const cause = error instanceof Error ? error : new Error(String(error))
          throw Object.assign(new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH,
            'session is pinned to a different runtime scope',
            {
              migrationFailure: cause.message,
              ...(typeof (cause as unknown as { code?: unknown }).code === 'string'
                ? { migrationFailureCode: (cause as unknown as { code: string }).code }
                : {}),
            },
          ), { cause })
        }
        persistedPin = resolved.identity
        pinned = resolved.identity
      }
    }
    const publishedPinned = pinned && typeof this.runtime.findPublishedBinding === 'function'
      ? this.runtime.findPublishedBinding(
          ref.agentTypeId,
          claim.workspaceScopeId,
          pinned,
        )
      : undefined
    if (publishedPinned && !this.unpinnedSessionFallbackPins.has(key)) {
      this.sessionRuntimeResolutionObserver?.({
        source: persistedPin ? 'persisted-runtime-pin' : 'unpinned-session-fallback',
        runtimeScopeIdentity: pinned!,
      })
      this.pins.set(key, pinned!)
      return publishedPinned
    }
    if (pinned && pinned !== resolved.identity) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH,
        'session is pinned to a different runtime scope',
      )
    }
    // Pre-AH0 transcripts have no pin. They use the first
    // current runtime for this Host lifetime without mutating historical JSONL.
    const runtimeScopeIdentity = pinned ?? resolved.identity
    this.sessionRuntimeResolutionObserver?.({
      source: persistedPin ? 'persisted-runtime-pin' : 'unpinned-session-fallback',
      runtimeScopeIdentity,
    })
    this.pins.set(key, runtimeScopeIdentity)
    if (!pinned) this.unpinnedSessionFallbackPins.add(key)
    return preparedBinding ?? await this.runtime.resolveBinding(
      ref.agentTypeId,
      scope,
      claim,
      resolved,
      pinned ? 'pinned' : 'current',
    )
  }

  private async loadSummary(
    service: PiChatSessionService,
    claim: VerifiedAgentScopeClaim,
    ref: AgentSessionRef,
    runtimeScopeIdentity: string,
  ) {
    const list = await service.listSessions?.(
      context(claim, randomUUID(), runtimeScopeIdentity),
      { includeId: ref.sessionId, includeEmpty: true },
    ) ?? []
    const summary = list.find((item) => item.id === ref.sessionId)
    if (!summary) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session was not found')
    return summary
  }

  private sessionEffect(
    ref: AgentSessionRef,
    claim: VerifiedAgentScopeClaim,
    operation: AgentGatewayEffect,
    requestId: string,
    payload: JsonValue,
    action: () => Promise<unknown>,
    options: SessionEffectOptions = {},
  ): Promise<unknown> {
    const { bindingKey, ...effectOptions } = options
    return this.effect(
      claim,
      operation,
      sessionTarget(ref),
      requestId,
      payload,
      action,
      {
        ...effectOptions,
        serialize: (effect) => this.withWriter(
          claim.workspaceScopeId,
          ref,
          () => bindingKey ? this.runtime.runBindingOperation(bindingKey, effect) : effect(),
        ),
      },
    )
  }

  private async effect(
    claim: VerifiedAgentScopeClaim,
    operation: AgentGatewayEffect,
    target: AgentRequestTarget,
    requestId: string,
    payload: JsonValue,
    action: () => Promise<unknown>,
    options: EffectOptions = {},
  ): Promise<unknown> {
    this.assertOpen()
    const {
      duplicateReceipt = false,
      serialize,
      guard,
      classify,
      serializedClassify,
      preflight,
      classifySafeActionFailure,
    } = options
    const key: AgentRequestKey = {
      workspaceScopeId: claim.workspaceScopeId,
      authSubjectId: claim.authSubjectId,
      operation,
      target,
      requestId,
    }
    const digest = canonicalDigest(payload)
    const prepared = await this.runtime.ledger.prepare(key, digest)
    const record = prepared.record
    if (record.state === 'completed') return this.replayReceipt(record.receipt, duplicateReceipt)
    if (record.state === 'rejected') throw this.failure(record.failure)
    if (record.state === 'outcome-unknown') throw gatewayError(record.error)
    const requestInProgress = () => new AgentGatewayError(
      AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS,
      'request is already in progress',
      {
        operation,
        target: target.kind === 'agent'
          ? { kind: 'agent', agentTypeId: target.agentTypeId }
          : {
              kind: 'session',
              ref: {
                agentTypeId: target.ref.agentTypeId,
                sessionId: target.ref.sessionId,
              },
            },
        requestId,
      },
    )
    if (prepared.ownership === 'existing' && !guard) throw requestInProgress()

    let effect: Promise<JsonValue>
    try {
      effect = this.runtime.startPreparedEffect(key, async (): Promise<JsonValue> => {
        if (classify) await this.applyClassification(key, classify)

        const admitted = await this.runtime.ledger.read(key)
        let admissionReceipt: string | undefined
        if (admitted?.state === 'pending-admission') {
          const admission = await this.runtime.effectAdmission.admit({ key, digest, scope: claim, operation, target })
          if (admission.type === 'retryable') throw gatewayError(admission.error)
          if (admission.type === 'rejected') {
            await this.runtime.ledger.reject(key, { kind: 'gateway', error: admission.error })
            throw gatewayError(admission.error)
          }
          admissionReceipt = admission.admissionReceipt
        }
        const runEffect = async (): Promise<JsonValue> => {
          const current = await this.runtime.ledger.read(key)
          if (current?.state === 'completed') return this.replayReceipt(current.receipt, duplicateReceipt)
          if (current?.state === 'rejected') throw this.failure(current.failure)
          if (current?.state === 'outcome-unknown') throw gatewayError(current.error)
          if (current?.state === 'admission-accepted' || current?.state === 'in-flight') {
            throw requestInProgress()
          }
          if (current?.state !== 'pending-admission') {
            throw new AgentGatewayError(
              AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
              'request ledger record was unavailable',
            )
          }
          if (admissionReceipt === undefined) {
            throw new AgentGatewayError(
              AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
              'request admission receipt was unavailable',
            )
          }
          if (serializedClassify) await this.applyClassification(key, serializedClassify)
          const retryableGuardError = await guard?.()
          if (retryableGuardError) throw gatewayError(retryableGuardError)
          await this.runtime.ledger.acceptAdmission(key, admissionReceipt)
          if (preflight) {
            try {
              await preflight()
              this.runtime.assertOpen()
            } catch (error) {
              if (error instanceof AgentGatewayError) {
                await this.runtime.ledger.reject(key, { kind: 'gateway', error: error.toJSON() }).catch(() => {})
                throw error
              }
              const unknown = new AgentGatewayError(
                AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
                'effect outcome could not be safely replayed',
              )
              await this.runtime.ledger.beginEffect(key).catch(() => {})
              await this.runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {})
              throw unknown
            }
          }
          await this.runtime.ledger.beginEffect(key)
          let actionResult: Promise<unknown>
          try {
            actionResult = action()
          } catch {
            const unknown = new AgentGatewayError(
              AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
              'effect outcome could not be safely replayed',
            )
            await this.runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {})
            throw unknown
          }
          let receipt: JsonValue
          try {
            receipt = await actionResult as JsonValue
          } catch (error) {
            const safeFailure = classifySafeActionFailure?.(error)
            if (safeFailure) {
              await this.runtime.ledger.reject(key, safeFailure)
              throw this.failure(safeFailure)
            }
            const unknown = new AgentGatewayError(
              AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
              'effect outcome could not be safely replayed',
            )
            await this.runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {})
            throw unknown
          }
          // Drain is an explicit Host generation fence: a late provider result
          // cannot publish, and the stable closure rejection is safe to replay.
          try {
            this.runtime.assertOpen()
          } catch (error) {
            if (error instanceof AgentGatewayError) {
              await this.runtime.ledger.reject(key, { kind: 'gateway', error: error.toJSON() }).catch(() => {})
            }
            throw error
          }
          try {
            await this.runtime.ledger.complete(key, receipt)
            return receipt
          } catch {
            const unknown = new AgentGatewayError(
              AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
              'effect outcome could not be safely replayed',
            )
            await this.runtime.ledger.markOutcomeUnknown(key, unknown.toJSON()).catch(() => {})
            throw unknown
          }
        }
        return serialize ? serialize(runEffect) : runEffect()
      })
    } catch (error) {
      const closed = error instanceof AgentGatewayError
        ? error
        : new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
      await this.runtime.ledger.reject(key, { kind: 'gateway', error: closed.toJSON() }).catch(() => {})
      throw error
    }
    return await effect
  }

  private async applyClassification(key: AgentRequestKey, classify: EffectClassifier): Promise<void> {
    let classification: EffectClassification
    try {
      classification = await classify()
    } catch (error) {
      const classifiedError = error instanceof AgentGatewayError
        ? error
        : new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
            error instanceof Error ? error.message : 'effect classification failed',
          )
      await this.runtime.ledger.reject(key, { kind: 'gateway', error: classifiedError.toJSON() })
      throw classifiedError
    }
    if (classification.kind === 'reject') {
      await this.runtime.ledger.reject(key, { kind: 'gateway', error: classification.error })
      throw gatewayError(classification.error)
    }
  }

  private replayReceipt(receipt: JsonValue, duplicate: boolean): JsonValue {
    if (!duplicate || receipt === null || Array.isArray(receipt) || typeof receipt !== 'object') return receipt
    return { ...(receipt as ReceiptObject), duplicate: true }
  }

  private failure(failure: AgentRequestFailure): Error {
    if (failure.kind === 'gateway') return gatewayError(failure.error)
    return Object.assign(new Error(failure.error.error.message), {
      code: failure.error.error.code,
      statusCode: failure.error.statusCode,
      ...(failure.error.error.retryable === undefined
        ? {}
        : { retryable: failure.error.error.retryable }),
    })
  }

  private async promptAdmission(
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    ref: AgentSessionRef,
    requestId: string,
    requireIdle: boolean,
  ): Promise<AgentGatewayErrorDTO | undefined> {
    const binding = await this.bindingForSession(scope, claim, ref)
    const snapshot = await binding.composition.service.readState(
      context(claim, requestId, binding.scope.identity),
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
    runtimeScopeIdentity: string,
    requestId: string,
    clientNonce?: string,
    clientSeq?: number,
  ): Promise<AgentGatewayErrorDTO | undefined> {
    if (clientNonce === undefined || clientSeq === undefined) return undefined
    const snapshot = await service.readState(
      context(claim, requestId, runtimeScopeIdentity), ref.sessionId,
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
    last: AgentSessionSummary,
  ): string {
    const payload = JSON.stringify({
      workspaceScopeId,
      agentTypeId: agentTypeId ?? null,
      limit,
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
  ): { updatedAt: number; agentTypeId: string; sessionId: string } {
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
        || typeof decoded.updatedAt !== 'number'
        || typeof decoded.lastAgentTypeId !== 'string'
        || typeof decoded.sessionId !== 'string'
      ) throw new Error('binding')
      return {
        updatedAt: decoded.updatedAt,
        agentTypeId: decoded.lastAgentTypeId,
        sessionId: decoded.sessionId,
      }
    } catch {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SESSION_CURSOR_INVALID, 'session cursor is invalid')
    }
  }
}
