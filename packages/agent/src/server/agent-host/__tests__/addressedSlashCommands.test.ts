import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthorizedAgentScope } from '../../../shared/index'
import type { AgentCoreHarnessFactory, AgentSendInput, RunContext } from '../../../shared/harness'
import { liveSessionCacheKey, type SessionCtx, type SessionDetail, type SessionStore, type SessionSummary } from '../../../shared/session'
import type { PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../../pi-chat/PiAgentSessionAdapter'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { createAgentHost } from '../createAgentHost'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function temporaryRoot(prefix: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), prefix))
  roots.push(value)
  return value
}

interface HandleRecord {
  readonly owner: string
  readonly key: string
  subscriptions: number
}

interface Telemetry {
  readonly handles: HandleRecord[]
  readonly executions: Array<{ owner: string; name: string; key: string }>
}

class MemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionSummary>()
  private count = 0

  async list(): Promise<SessionSummary[]> {
    return [...this.records.values()]
  }

  async create(_ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    this.count += 1
    const id = `session-${this.count}`
    const now = new Date(1_000 + this.count).toISOString()
    const record: SessionSummary = {
      id,
      title: init?.title ?? 'Session',
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    }
    this.records.set(id, record)
    return record
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`Session not found: ${sessionId}`)
    return record
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    this.records.delete(sessionId)
  }
}

class FakeAdapter implements PiAgentSessionAdapter {
  private readonly subscribers = new Set<(event: never) => void>()

  constructor(private readonly record: HandleRecord) {}

  readSnapshot(): PiAgentSessionSnapshot {
    return {
      state: {},
      messages: [],
      isStreaming: false,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      followUpMode: 'one-at-a-time',
      sessionId: 'fake',
    }
  }

  subscribe(listener: (event: never) => void): () => void {
    this.record.subscriptions += 1
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  async prompt(): Promise<void> {}
  async followUp(): Promise<void> {}
  clearFollowUp(): void {}
  async abort(): Promise<void> {}
}

/**
 * Keys pi handles exactly the way the real harness does, so this fixture proves
 * the WIRE contract: whatever identity the commands route and the prompt route
 * hand the harness must be the same one, under the right agent owner.
 */
function keyedCommandHarnessFactory(telemetry: Telemetry): AgentCoreHarnessFactory {
  return (input) => {
    const owner = input.systemPromptAppend ?? 'unknown'
    const sessions = new MemorySessionStore()
    const handles = new Map<string, { record: HandleRecord; adapter: FakeAdapter }>()
    const resolve = (sessionId: string, ctx: SessionCtx) => {
      const key = liveSessionCacheKey(sessionId, ctx)
      const existing = handles.get(key)
      if (existing) return existing
      const record: HandleRecord = { owner, key, subscriptions: 0 }
      const created = { record, adapter: new FakeAdapter(record) }
      handles.set(key, created)
      telemetry.handles.push(record)
      return created
    }
    return {
      id: 'keyed-command-harness',
      placement: 'server',
      sessions,
      async getPiSessionAdapter(send: AgentSendInput) {
        if (!send.sessionId) throw new Error('sessionId is required')
        return resolve(send.sessionId, send.ctx ?? {}).adapter
      },
      hasPiSession(sessionId: string, ctx?: SessionCtx) {
        return ctx
          ? handles.has(liveSessionCacheKey(sessionId, ctx))
          : [...handles.values()].length > 0
      },
      async getSlashCommands(sessionId: string, ctx: RunContext) {
        resolve(sessionId, sessionCtxOf(ctx))
        return [{ name: `${owner}_cmd`, source: 'extension' as const }]
      },
      async executeSlashCommand(sessionId: string, name: string, _args: string, ctx: RunContext) {
        const handle = resolve(sessionId, sessionCtxOf(ctx))
        telemetry.executions.push({ owner, name, key: handle.record.key })
      },
    }
  }
}

function sessionCtxOf(ctx: RunContext): SessionCtx {
  return ctx.sessionCtx ?? { workspaceId: ctx.workspaceId, userId: ctx.userId }
}

const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' } as AuthorizedAgentScope

async function createHostApp(telemetry: Telemetry) {
  const sessionRoot = await temporaryRoot('addressed-commands-sessions-')
  const workspaceRoot = await temporaryRoot('addressed-commands-workspace-')
  const created = await createAgentHost({
    agents: [
      { agentTypeId: 'alpha', definition: { label: 'Alpha', instructions: 'alpha' } },
      { agentTypeId: 'beta', definition: { label: 'Beta', instructions: 'beta' } },
    ],
    fleetCompiler: { compile: async ({ agents }) => agents },
    hostId: 'addressed-commands-host',
    scopeVerifier: {
      verify: async (value) => ({ workspaceScopeId: value.workspaceScopeId, authSubjectId: value.authSubjectId }),
    },
    runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
    sessionRoot,
    harnessFactory: keyedCommandHarnessFactory(telemetry),
    resolveRuntimeScope: async ({ agentTypeId }) => ({
      identity: `runtime-${agentTypeId}`,
      environment: {
        placementIdentity: 'direct-a',
        workspaceRoot,
        provisioningFingerprint: 'provision-a',
      },
      sessionNamespace: `ns-${agentTypeId}`,
    }),
  })
  const app = Fastify({ logger: false })
  await app.register(created.registerRoutes({
    defaultAgentTypeId: 'alpha',
    authorizeRequest: async () => scope,
  }))
  await app.ready()
  return app
}

describe('addressed slash commands', () => {
  it('serves and executes commands from the addressed owner on ONE pi handle', async () => {
    const telemetry: Telemetry = { handles: [], executions: [] }
    const app = await createHostApp(telemetry)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/beta/sessions',
        payload: { requestId: 'create-1', title: 'Beta chat' },
      })
      expect(created.statusCode).toBe(201)
      const sessionId = created.json<{ sessionId: string }>().sessionId

      // 1. Discovery FIRST — historically this opened a second AgentSession
      //    under a different key, and answered from the DEFAULT agent.
      const discovered = await app.inject({
        method: 'GET',
        url: `/api/v1/agents/beta/sessions/${sessionId}/commands`,
      })
      expect(discovered.statusCode).toBe(200)
      expect(discovered.json<{ commands: Array<{ name: string }> }>().commands)
        .toEqual([{ name: 'beta_cmd', source: 'extension' }])

      // 2. Addressed prompt on the same session.
      const prompted = await app.inject({
        method: 'POST',
        url: `/api/v1/agents/beta/sessions/${sessionId}/prompt`,
        payload: { requestId: 'prompt-1', clientNonce: 'nonce-1', content: 'hello' },
      })
      expect(prompted.statusCode).toBe(202)

      // 3. Execution last.
      const executed = await app.inject({
        method: 'POST',
        url: `/api/v1/agents/beta/sessions/${sessionId}/commands/execute`,
        payload: { requestId: 'command-1', name: 'beta_cmd', args: '' },
      })
      expect(executed.statusCode).toBe(200)

      expect(telemetry.executions).toEqual([
        { owner: 'beta', name: 'beta_cmd', key: telemetry.handles[0]?.key },
      ])
      expect(telemetry.handles.map((handle) => handle.owner)).toEqual(['beta'])
      expect(telemetry.handles[0]?.subscriptions).toBe(1)
    } finally {
      await app.close()
    }
  })

  it('keeps a non-default pane off the default agent binding', async () => {
    const telemetry: Telemetry = { handles: [], executions: [] }
    const app = await createHostApp(telemetry)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/beta/sessions',
        payload: { requestId: 'create-1' },
      })
      const sessionId = created.json<{ sessionId: string }>().sessionId
      const discovered = await app.inject({
        method: 'GET',
        url: `/api/v1/agents/beta/sessions/${sessionId}/commands`,
      })
      // 'alpha' is the host default: the legacy route would have answered with it.
      expect(discovered.json<{ commands: Array<{ name: string }> }>().commands[0]?.name).toBe('beta_cmd')
    } finally {
      await app.close()
    }
  })
})
