import { createHash } from 'node:crypto'
import type { PiChatEvent, PiChatSnapshot } from '../../shared/chat'
import type { AgentSessionActivity, AgentSessionRef, AuthorizedAgentScope, VerifiedAgentScopeClaim } from '../../shared/index'
import type { SessionSummary } from '../../shared/session'
import { PiSessionStore } from '../harness/pi-coding-agent/sessions'
import { buildPiChatHistory } from '../pi-chat/piChatHistory'
import { agentSessionKey } from './agentSessionKey'
import type { CompiledAgentHostAgentSpec, ResolvedAgentRuntimeScope } from './types'

export interface AgentSessionRuntimeAuthority {
  readonly runtimeScope: ResolvedAgentRuntimeScope
  /** Absent only for a pre-AH0 transcript created before runtime pins existed. */
  readonly runtimeScopeIdentity?: string
}

function safeScopeSegment(scope: string): string {
  return createHash('sha256').update(scope).digest('hex').slice(0, 20)
}

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

  async list(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
  ): Promise<SessionSummary[]> {
    const resolved = await this.resolveStore(agentTypeId, scope, claim)
    if (!resolved) return []
    return await resolved.store.list({ workspaceId: claim.workspaceScopeId })
  }

  async resolveSessionRuntime(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    sessionId: string,
  ): Promise<AgentSessionRuntimeAuthority | undefined> {
    const resolved = await this.resolveStore(agentTypeId, scope, claim)
    if (!resolved) return undefined
    try {
      return {
        runtimeScope: resolved.runtimeScope,
        runtimeScopeIdentity: await resolved.store.readRuntimeScopeIdentity(
          { workspaceId: claim.workspaceScopeId },
          sessionId,
        ),
      }
    } catch (error) {
      if (error instanceof Error && error.message === `Session not found: ${sessionId}`) return undefined
      throw error
    }
  }

  /**
   * Reads a persisted transcript without constructing an executable runtime
   * binding. The store still enforces the workspace/user header before any
   * content is returned; the omitted runtime pin is deliberate because this
   * path can never expose a command-capable service.
   */
  async readPersistedSession(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
    sessionId: string,
  ): Promise<{ summary: SessionSummary; state: PiChatSnapshot } | undefined> {
    const resolved = await this.resolveStore(agentTypeId, scope, claim)
    if (!resolved) return undefined
    try {
      const ctx = { workspaceId: claim.workspaceScopeId }
      const [summary, entries] = await Promise.all([
        resolved.store.load(ctx, sessionId),
        resolved.store.loadEntries(ctx, sessionId),
      ])
      return {
        summary,
        state: {
          protocolVersion: 1,
          sessionId: entries.id,
          seq: 0,
          status: 'idle',
          messages: buildPiChatHistory(entries.messages, { sessionId: entries.id }),
          queue: { followUps: [] },
          followUpMode: 'one-at-a-time',
        },
      }
    } catch (error) {
      if (error instanceof Error && error.message === `Session not found: ${sessionId}`) return undefined
      throw error
    }
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
}

/** Process-lifetime live-turn projection. Reads never create activity rows. */
export class AgentSessionActivityIndex {
  private readonly activity = new Map<string, StoredAgentSessionActivity>()
  private readonly subscribers = new Map<string, Set<(update: AgentSessionActivityUpdate) => void>>()

  get(workspaceScopeId: string, ref: AgentSessionRef): AgentSessionActivity {
    return this.activity.get(agentSessionKey(workspaceScopeId, ref))?.status ?? 'idle'
  }

  set(workspaceScopeId: string, ref: AgentSessionRef, status: AgentSessionActivity): void {
    const key = agentSessionKey(workspaceScopeId, ref)
    if (this.activity.get(key)?.status === status) return
    const update = { ref, status }
    this.activity.set(key, { workspaceScopeId, ...update })
    for (const subscriber of this.subscribers.get(workspaceScopeId) ?? []) {
      try { subscriber(update) } catch { /* Activity observers cannot fail an Agent run. */ }
    }
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
    if (event.type === 'agent-start') this.set(workspaceScopeId, ref, 'running')
    if (event.type === 'agent-end') this.set(workspaceScopeId, ref, event.status === 'error' ? 'error' : 'idle')
    if (event.type === 'error') this.set(workspaceScopeId, ref, 'error')
  }
}
