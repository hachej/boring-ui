import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentSessionActivity,
  type AgentSessionRef,
  type AuthorizedAgentScope,
} from '../../../shared/index'
import { EmbeddedAgentGateway } from '../embeddedGateway'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { AgentSessionActivityIndex } from '../sessionInventory'
import { InMemoryHarnessBackend } from '../testing/inMemoryHarnessBackend'
import type { AgentGatewayEffect, AgentHostAgentSpec } from '../types'
import type { GatewayConformanceFixture } from '../testing/gatewayConformance'

interface EmbeddedGatewayFixture extends GatewayConformanceFixture {
  modelLoopStarts(ref: AgentSessionRef): number
  blockAdmission(operation: AgentGatewayEffect): {
    entered: Promise<void>
    release(): void
  }
  rejectNextPrompt(error: Error): void
  disableArchiveCapability(): void
}

export async function createEmbeddedGatewayFixture(): Promise<EmbeddedGatewayFixture> {
  const issued = new WeakSet<object>()
  const revoked = new WeakSet<object>()
  const backends = new Map<string, InMemoryHarnessBackend>()
  type AdmissionDisposition = 'strong-reject' | 'retryable' | {
    entered(): void
    wait: Promise<void>
  }
  const admission = new Map<AgentGatewayEffect, AdmissionDisposition[]>()
  const agents: readonly AgentHostAgentSpec[] = [
    { agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } },
    { agentTypeId: 'beta', definition: { instructions: 'beta', label: 'Beta' } },
  ]
  const backendFor = (workspaceScopeId: string, agentTypeId: string) => {
    const key = `${workspaceScopeId}:${agentTypeId}`
    let backend = backends.get(key)
    if (!backend) {
      backend = new InMemoryHarnessBackend()
      backends.set(key, backend)
    }
    return backend
  }
  const activity = new AgentSessionActivityIndex()
  const runtime = {
    options: {},
    compiledAgents: agents,
    compiledById: new Map(agents.map((agent) => [agent.agentTypeId, agent])),
    ledger: new InMemoryAgentRequestLedger(),
    activity,
    mintChildEffectCapability(key: import('../types').AgentRequestKey) {
      if (key.operation !== 'session.prompt' && key.operation !== 'session.followup') {
        throw new TypeError(`unexpected child-effect operation: ${key.operation}`)
      }
      if (key.target.kind !== 'session') throw new TypeError('child-effect capability requires a session')
      return {
        agentTypeId: key.target.ref.agentTypeId,
        runOperation: key.operation,
        async admit() {},
        async begin() {},
        async pause() {},
        async settle() {},
        async markOutcomeUnknown() {},
      }
    },
    async listSessionSummaries(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }, options?: { archived?: 'active' | 'archived' | 'all' }) {
      return await backendFor(claim.workspaceScopeId, agentTypeId).listSessions({
        workspaceScopeId: claim.workspaceScopeId,
        agentTypeId,
      }, {
        authSubjectId: 'inventory',
        requestId: 'inventory-list',
      }, options)
    },
    async setSessionArchived(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }, sessionId: string, archived: boolean) {
      return await backendFor(claim.workspaceScopeId, agentTypeId).setArchived({
        workspaceScopeId: claim.workspaceScopeId,
        ref: { agentTypeId, sessionId },
      }, archived)
    },
    effectAdmission: {
      async admit({ operation }: { operation: AgentGatewayEffect }) {
        const disposition = admission.get(operation)?.shift()
        if (typeof disposition === 'object') {
          disposition.entered()
          await disposition.wait
        }
        if (disposition === 'strong-reject') return {
          type: 'rejected' as const,
          error: new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'denied').toJSON(),
        }
        if (disposition === 'retryable') return {
          type: 'retryable' as const,
          error: new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'retry').toJSON(),
        }
        return { type: 'accepted' as const, admissionReceipt: 'accepted' }
      },
    },
    isDraining: () => false,
    assertOpen() {},
    async verify(scope: AuthorizedAgentScope) {
      if (!issued.has(scope as object) || revoked.has(scope as object)) {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'denied')
      }
      return { workspaceScopeId: scope.workspaceScopeId, authSubjectId: scope.authSubjectId }
    },
    async resolveSessionRuntime(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }, sessionId: string) {
      return backendFor(claim.workspaceScopeId, agentTypeId).hasSession(claim.workspaceScopeId, sessionId)
        ? { identity: 'shared-runtime' }
        : undefined
    },
    async resolveAgentRuntimeScope() {
      return { identity: 'shared-runtime' }
    },
    async resolveBinding(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }) {
      const backend = backendFor(claim.workspaceScopeId, agentTypeId)
      return {
        key: `${claim.workspaceScopeId}:${agentTypeId}`,
        scope: { identity: 'shared-runtime' },
        environmentLease: { bundle: {}, release() {} },
        composition: {
          backend,
        },
      }
    },
    startDrain() {},
    registerSubscription() { return () => {} },
    startPreparedEffect<T>(_key: import('../types').AgentRequestKey, effect: () => Promise<T>) { return effect() },
    runBindingOperation<T>(_bindingKey: string, operation: () => Promise<T>) { return operation() },
    async closeRuntime() {},
  }
  const embedded = new EmbeddedAgentGateway(runtime as never)

  function issueScope(input: { workspaceScopeId?: string; authSubjectId?: string; issuer?: 'primary' | 'foreign' } = {}) {
    const scope = {
      workspaceScopeId: input.workspaceScopeId ?? 'workspace',
      authSubjectId: input.authSubjectId ?? 'subject',
    } as AuthorizedAgentScope
    if (input.issuer !== 'foreign') issued.add(scope as object)
    return scope
  }

  return {
    gateway: embedded,
    issueScope,
    revoke(scope) { revoked.add(scope as object) },
    setActivity(ref: AgentSessionRef, activity: AgentSessionActivity) {
      for (const [key, backend] of backends) {
        if (!key.endsWith(`:${ref.agentTypeId}`)) continue
        const workspaceScopeId = key.slice(0, -(ref.agentTypeId.length + 1))
        if (!backend.hasSession(workspaceScopeId, ref.sessionId)) continue
        backend.setActivity(workspaceScopeId, ref.sessionId, activity)
        embedded.setActivityForTesting(workspaceScopeId, ref, activity)
      }
    },
    moveSession(ref, updatedAt) {
      for (const [key, backend] of backends) {
        if (!key.endsWith(`:${ref.agentTypeId}`)) continue
        const workspaceScopeId = key.slice(0, -(ref.agentTypeId.length + 1))
        if (backend.hasSession(workspaceScopeId, ref.sessionId)) backend.move(workspaceScopeId, ref.sessionId, updatedAt)
      }
    },
    rejectNextPrompt(error) {
      for (const backend of backends.values()) backend.nextPromptError = error
    },
    disableArchiveCapability() {
      Reflect.deleteProperty(runtime, 'setSessionArchived')
    },
    modelLoopStarts(ref) {
      for (const backend of backends.values()) {
        const record = [...backend.records.values()].find((candidate) => candidate.id === ref.sessionId)
        if (record) return record.events.filter((event) => event.type === 'agent-start').length
      }
      return 0
    },
    queueAdmission(operation, disposition) {
      const queue = admission.get(operation) ?? []
      queue.push(disposition)
      admission.set(operation, queue)
    },
    blockAdmission(operation) {
      let release!: () => void
      let markEntered!: () => void
      const wait = new Promise<void>((resolve) => { release = resolve })
      const entered = new Promise<void>((resolve) => { markEntered = resolve })
      const queue = admission.get(operation) ?? []
      queue.push({ entered: markEntered, wait })
      admission.set(operation, queue)
      return { entered, release }
    },
  }
}
