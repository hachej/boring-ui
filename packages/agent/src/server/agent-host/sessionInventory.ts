import { createHash } from 'node:crypto'
import type { PiChatEvent } from '../../shared/chat'
import { ErrorCode, type AgentSessionActivity, type AgentSessionRef, type AuthorizedAgentScope, type VerifiedAgentScopeClaim } from '../../shared/index'
import type { SessionListOptions, SessionSummary } from '../../shared/session'
import { PiSessionStore } from '../harness/pi-coding-agent/sessions'
import { agentSessionKey } from './agentSessionKey'
import type { CompiledAgentHostAgentSpec, ResolvedAgentRuntimeScope } from './types'

function safeScopeSegment(scope: string): string {
  return createHash('sha256').update(scope).digest('hex').slice(0, 20)
}

/**
 * Storage namespace for a seat, or `undefined` to keep the store's cwd-derived
 * default directory.
 *
 * `undefined` is a DELIBERATE result, not a gap. It happens for the
 * `legacyDefault` seat on hosts that resolve an empty runtime
 * `sessionNamespace` (the CLI hub and the workspace app both pass `""`), and it
 * routes that seat to {@link PiSessionStore}'s path-derived directory
 * (`<sessionRoot>/--<workspaceRoot with separators flattened>--`). That
 * directory is the trusted-local store terminal `pi` writes for the same cwd,
 * and `PiSessionStore.pathDerivedLegacyAccess` exists precisely so the local
 * app and terminal `pi` can read each other's unpinned transcripts there.
 *
 * Naming that seat would relocate its lookup and orphan every session a user
 * already has, so this function MUST stay the single source of truth for both
 * sides: `buildAgentComposition` uses it to place the writing harness and
 * `AgentSessionInventory` uses it to place the reading store. Read and write
 * therefore always resolve the same directory. Hosts that do want an isolated
 * per-workspace store (core passes `ctx.workspaceId`) get one from the same
 * branch, because a non-empty namespace is honoured as-is.
 */
export function sessionNamespaceForAgent(
  agent: CompiledAgentHostAgentSpec,
  workspaceScopeId: string,
  sessionNamespace: string,
): string | undefined {
  if ('legacyDefault' in agent) return sessionNamespace || undefined
  return [agent.agentTypeId, safeScopeSegment(workspaceScopeId), sessionNamespace]
    .filter(Boolean)
    .join('--')
}

/**
 * Storage-only session inventory. It resolves storage coordinates and reads
 * transcript metadata directly; it never acquires an Environment lease or
 * constructs an Agent runtime binding.
 */
export class AgentSessionInventory {
  private readonly stores = new Map<string, PiSessionStore>()

  constructor(
    private readonly sessionRoot: string | undefined,
    private readonly compiledById: ReadonlyMap<string, CompiledAgentHostAgentSpec>,
    private readonly resolveAgentRuntimeScope: (
      agentTypeId: string,
      scope: AuthorizedAgentScope,
      claim: VerifiedAgentScopeClaim,
    ) => Promise<ResolvedAgentRuntimeScope>,
  ) {}

  /**
   * Lists a seat's sessions. `options` is threaded straight into the store so a
   * bounded page reads a bounded number of transcripts: an unbounded call makes
   * the store stream and parse EVERY native transcript it holds (see
   * `summarizeNativeTranscript`, whose result is intentionally never cached),
   * which is what made a per-seat boot listing cost tens of seconds (#1338).
   */
  async list(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    options?: SessionListOptions,
  ): Promise<SessionSummary[]> {
    const resolved = await this.resolveStore(agentTypeId, scope, claim)
    if (!resolved) return []
    return await resolved.store.list({ workspaceId: claim.workspaceScopeId }, options)
  }

  async resolveSessionRuntime(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    sessionId: string,
  ): Promise<ResolvedAgentRuntimeScope | undefined> {
    const resolved = await this.resolveStore(agentTypeId, scope, claim)
    if (!resolved) return undefined
    return await resolved.store.has({ workspaceId: claim.workspaceScopeId }, sessionId)
      ? resolved.runtimeScope
      : undefined
  }

  private async resolveStore(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
  ): Promise<{ runtimeScope: ResolvedAgentRuntimeScope; store: PiSessionStore } | undefined> {
    const agent = this.compiledById.get(agentTypeId)
    if (!agent) return undefined
    const runtimeScope = await this.resolveAgentRuntimeScope(agentTypeId, scope, claim)
    const sessionNamespace = sessionNamespaceForAgent(agent, claim.workspaceScopeId, runtimeScope.sessionNamespace)
    const candidate = new PiSessionStore(runtimeScope.environment.workspaceRoot, {
      sessionDir: runtimeScope.sessionDir,
      sessionNamespace,
      sessionRoot: this.sessionRoot,
      storageCwd: runtimeScope.environment.workspaceRoot,
    })
    const key = JSON.stringify([agentTypeId, claim.workspaceScopeId, candidate.getSessionDir()])
    let store = this.stores.get(key)
    if (!store) {
      store = candidate
      this.stores.set(key, store)
    }
    return { runtimeScope, store }
  }
}

export interface AgentSessionActivityUpdate {
  readonly ref: AgentSessionRef
  readonly status: AgentSessionActivity
}

interface StoredAgentSessionActivity extends AgentSessionActivityUpdate {
  readonly workspaceScopeId: string
  readonly activeTurnId?: string
  readonly pendingRun: boolean
  readonly generation: number
}

interface PendingAgentSessionRun {
  readonly generation: number
  readonly previous?: Pick<StoredAgentSessionActivity, 'status' | 'activeTurnId' | 'pendingRun'>
}

/** Process-lifetime live-turn projection. Reads never create activity rows. */
export class AgentSessionActivityIndex {
  private readonly activity = new Map<string, StoredAgentSessionActivity>()
  private readonly subscribers = new Map<string, Set<(update: AgentSessionActivityUpdate) => void>>()
  private nextGeneration = 0

  get(workspaceScopeId: string, ref: AgentSessionRef): AgentSessionActivity {
    return this.activity.get(agentSessionKey(workspaceScopeId, ref))?.status ?? 'idle'
  }

  set(workspaceScopeId: string, ref: AgentSessionRef, status: AgentSessionActivity): void {
    const existing = this.activity.get(agentSessionKey(workspaceScopeId, ref))
    const activeTurnId = status === 'running' || status === 'aborting'
      ? existing?.activeTurnId
      : undefined
    const pendingRun = status === 'running'
      ? activeTurnId === undefined
      : status === 'aborting'
        ? existing?.pendingRun ?? false
        : false
    this.setForTurn(workspaceScopeId, ref, status, activeTurnId, pendingRun)
  }

  beginPendingRun(workspaceScopeId: string, ref: AgentSessionRef): PendingAgentSessionRun {
    const existing = this.activity.get(agentSessionKey(workspaceScopeId, ref))
    const previous = existing
      ? { status: existing.status, activeTurnId: existing.activeTurnId, pendingRun: existing.pendingRun }
      : undefined
    const generation = this.setForTurn(workspaceScopeId, ref, 'running', undefined, true, true)
    return { generation, previous }
  }

  rollbackPendingRun(workspaceScopeId: string, ref: AgentSessionRef, run: PendingAgentSessionRun): void {
    const existing = this.activity.get(agentSessionKey(workspaceScopeId, ref))
    // Native events or a newer command own any later generation.
    if (existing?.generation !== run.generation || !existing.pendingRun) return
    this.setForTurn(
      workspaceScopeId,
      ref,
      run.previous?.status ?? 'idle',
      run.previous?.activeTurnId,
      run.previous?.pendingRun ?? false,
      true,
    )
  }

  private setForTurn(
    workspaceScopeId: string,
    ref: AgentSessionRef,
    status: AgentSessionActivity,
    activeTurnId: string | undefined,
    pendingRun: boolean,
    replaceGeneration = false,
  ): number {
    const key = agentSessionKey(workspaceScopeId, ref)
    const existing = this.activity.get(key)
    if (
      !replaceGeneration
      && existing?.status === status
      && existing.activeTurnId === activeTurnId
      && existing.pendingRun === pendingRun
    ) return existing.generation
    const update = { ref, status }
    const generation = ++this.nextGeneration
    this.activity.set(key, { workspaceScopeId, ...update, activeTurnId, pendingRun, generation })
    // An agent-start can replace an optimistic pending run with active turn
    // identity without publishing a duplicate status transition.
    if (existing?.status === status) return generation
    for (const subscriber of this.subscribers.get(workspaceScopeId) ?? []) {
      try { subscriber(update) } catch { /* Activity observers cannot fail an Agent run. */ }
    }
    return generation
  }

  snapshot(workspaceScopeId: string): AgentSessionActivityUpdate[] {
    return [...this.activity.values()]
      .filter((item) => item.workspaceScopeId === workspaceScopeId)
      .map(({ ref, status }) => ({ ref, status }))
  }

  subscribe(workspaceScopeId: string, subscriber: (update: AgentSessionActivityUpdate) => void): () => void {
    const subscribers = this.subscribers.get(workspaceScopeId) ?? new Set()
    subscribers.add(subscriber)
    this.subscribers.set(workspaceScopeId, subscribers)
    return () => {
      subscribers.delete(subscriber)
      if (subscribers.size === 0) this.subscribers.delete(workspaceScopeId)
    }
  }

  delete(workspaceScopeId: string, ref: AgentSessionRef): void {
    this.activity.delete(agentSessionKey(workspaceScopeId, ref))
  }

  observe(workspaceScopeId: string, ref: AgentSessionRef, event: PiChatEvent): void {
    const key = agentSessionKey(workspaceScopeId, ref)
    if (event.type === 'agent-start') {
      this.setForTurn(workspaceScopeId, ref, 'running', event.turnId, false)
      return
    }
    if (event.type === 'agent-end') {
      if (event.willRetry === true || this.activity.get(key)?.activeTurnId !== event.turnId) return
      const status = event.status === 'error' ? 'error' : event.status === 'aborted' ? 'aborted' : 'idle'
      this.setForTurn(workspaceScopeId, ref, status, undefined, false)
      return
    }
    if (event.type === 'error') {
      const existing = this.activity.get(key)
      const belongsToActiveTurn = event.turnId !== undefined && event.turnId === existing?.activeTurnId
      const belongsToPendingRun = event.turnId === undefined && existing?.pendingRun === true && existing.activeTurnId === undefined
      if (!belongsToActiveTurn && !belongsToPendingRun) return
      // Pi emits an ABORTED error immediately before agent-end:aborted. Treat
      // both frames as one cancellation so the list never flashes `failed`.
      const status = event.error.code === ErrorCode.enum.ABORTED ? 'aborted' : 'error'
      this.setForTurn(workspaceScopeId, ref, status, undefined, false)
    }
  }
}
