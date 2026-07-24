import { createHash } from 'node:crypto'
import type { PiChatEvent } from '../../shared/chat'
import type { AgentSessionActivity, AgentSessionRef, AuthorizedAgentScope, VerifiedAgentScopeClaim } from '../../shared/index'
import type { SessionSummary } from '../../shared/session'
import { PiSessionStore } from '../harness/pi-coding-agent/sessions'
import type { CompiledAgentHostAgentSpec, CreateAgentHostOptions, ResolvedAgentRuntimeScope } from './types'

interface InventoryRuntimeScope extends ResolvedAgentRuntimeScope {
  readonly compatibility?: {
    readonly sessionDir?: string
  }
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
    private readonly options: Pick<CreateAgentHostOptions, 'resolveRuntimeScope' | 'sessionRoot'>,
    private readonly compiledById: ReadonlyMap<string, CompiledAgentHostAgentSpec>,
  ) {}

  async list(
    agentTypeId: string,
    scope: AuthorizedAgentScope,
    claim: VerifiedAgentScopeClaim,
  ): Promise<SessionSummary[]> {
    const agent = this.compiledById.get(agentTypeId)
    if (!agent) return []
    const resolved = await this.options.resolveRuntimeScope({ agentTypeId, scope }) as InventoryRuntimeScope
    const sessionNamespace = sessionNamespaceForAgent(agent, claim.workspaceScopeId, resolved.sessionNamespace)
    const candidate = new PiSessionStore(resolved.environment.workspaceRoot, {
      sessionDir: resolved.compatibility?.sessionDir,
      sessionNamespace,
      sessionRoot: this.options.sessionRoot,
      storageCwd: resolved.environment.workspaceRoot,
    })
    const key = JSON.stringify([agentTypeId, claim.workspaceScopeId, candidate.getSessionDir()])
    let store = this.stores.get(key)
    if (!store) {
      store = candidate
      this.stores.set(key, store)
    }
    return await store.list({ workspaceId: claim.workspaceScopeId })
  }
}

/** Process-lifetime live-turn projection. Reads never create activity rows. */
export class AgentSessionActivityIndex {
  private readonly activity = new Map<string, AgentSessionActivity>()

  get(workspaceScopeId: string, ref: AgentSessionRef): AgentSessionActivity {
    return this.activity.get(activityKey(workspaceScopeId, ref)) ?? 'idle'
  }

  set(workspaceScopeId: string, ref: AgentSessionRef, activity: AgentSessionActivity): void {
    this.activity.set(activityKey(workspaceScopeId, ref), activity)
  }

  delete(workspaceScopeId: string, ref: AgentSessionRef): void {
    this.activity.delete(activityKey(workspaceScopeId, ref))
  }

  observe(workspaceScopeId: string, ref: AgentSessionRef, event: PiChatEvent): void {
    if (event.type === 'agent-start') this.set(workspaceScopeId, ref, 'running')
    if (event.type === 'agent-end') this.set(workspaceScopeId, ref, event.status === 'error' ? 'error' : 'idle')
    if (event.type === 'error') this.set(workspaceScopeId, ref, 'error')
  }
}

function activityKey(workspaceScopeId: string, ref: AgentSessionRef): string {
  return JSON.stringify([workspaceScopeId, ref.agentTypeId, ref.sessionId])
}
