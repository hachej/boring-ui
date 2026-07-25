import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'
import { createSandboxRuntimeModeAdapter } from '@hachej/boring-agent/server'
import type {
  AgentCoreHarness,
  AgentCoreHarnessFactory,
  AgentCoreSessionAdapter,
  SessionDetail,
  SessionStore,
  SessionSummary,
} from '@hachej/boring-agent/shared'

import {
  createAgentPlaygroundRuntime,
  PLAYGROUND_AGENT_TYPE_ID,
} from '../agentHost.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

class SmokeSessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionSummary>()
  private nextId = 0

  async list(): Promise<SessionSummary[]> {
    return [...this.sessions.values()]
  }

  async create(_ctx: unknown, init?: { title?: string }): Promise<SessionSummary> {
    const id = `playground-smoke-${++this.nextId}`
    const now = new Date(1_000 + this.nextId).toISOString()
    const summary = { id, title: init?.title ?? 'New session', createdAt: now, updatedAt: now, turnCount: 0 }
    this.sessions.set(id, summary)
    return summary
  }

  async load(_ctx: unknown, sessionId: string): Promise<SessionDetail> {
    const summary = this.sessions.get(sessionId)
    if (!summary) throw new Error(`Session not found: ${sessionId}`)
    return summary
  }

  async delete(_ctx: unknown, sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
  }
}

class SmokeSessionAdapter implements AgentCoreSessionAdapter {
  private readonly listeners = new Set<Parameters<AgentCoreSessionAdapter['subscribe']>[0]>()
  private streaming = false
  private finishPrompt: (() => void) | undefined

  readSnapshot() {
    return {
      state: {},
      messages: [],
      isStreaming: this.streaming,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      followUpMode: 'one-at-a-time' as const,
      sessionId: 'playground-smoke-1',
    }
  }

  subscribe(listener: Parameters<AgentCoreSessionAdapter['subscribe']>[0]): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt(): Promise<void> {
    this.streaming = true
    this.emit({ type: 'agent_start', turnId: 'smoke-turn' })
    await new Promise<void>((resolve) => { this.finishPrompt = resolve })
  }

  async followUp(): Promise<void> {}
  clearFollowUp(): void {}

  async abort(): Promise<void> {
    if (!this.streaming) return
    this.streaming = false
    this.emit({
      type: 'agent_end',
      status: 'aborted',
      messages: [{ role: 'assistant', stopReason: 'aborted' }],
      willRetry: false,
    })
    this.finishPrompt?.()
    this.finishPrompt = undefined
  }

  private emit(event: unknown): void {
    for (const listener of this.listeners) {
      listener(event as Parameters<Parameters<AgentCoreSessionAdapter['subscribe']>[0]>[0])
    }
  }
}

function createSmokeHarnessFactory(): AgentCoreHarnessFactory {
  return async (): Promise<AgentCoreHarness> => {
    const sessions = new SmokeSessionStore()
    const adapters = new Map<string, SmokeSessionAdapter>()
    return {
      id: 'agent-playground-smoke',
      placement: 'server',
      sessions,
      async getPiSessionAdapter({ sessionId }) {
        if (!sessionId) throw new Error('sessionId is required')
        let adapter = adapters.get(sessionId)
        if (!adapter) {
          adapter = new SmokeSessionAdapter()
          adapters.set(sessionId, adapter)
        }
        return adapter
      },
    }
  }
}

describe('agent-playground AgentGateway reference composition', () => {
  test('runs create, connect, prompt, event, stop, unsubscribe, and bounded shutdown through one Host', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'agent-playground-gateway-'))
    tempDirs.push(sessionRoot)
    const directMode = createSandboxRuntimeModeAdapter('direct')
    const disposeRuntime = vi.fn(async () => await directMode.dispose?.())
    const runtime = await createAgentPlaygroundRuntime({
      workspaceRoot: sessionRoot,
      sessionRoot,
      runtimeModeAdapter: { ...directMode, dispose: disposeRuntime },
      harnessFactory: createSmokeHarnessFactory(),
      logger: false,
    })

    const modelsResponse = await runtime.app.inject({ method: 'GET', url: '/api/v1/agent/models' })
    expect(modelsResponse.statusCode).toBe(200)
    expect(modelsResponse.json()).toMatchObject({ models: expect.any(Array) })

    const agents = await runtime.gateway.listAgents({ scope: runtime.scope })
    expect(agents).toEqual([expect.objectContaining({ agentTypeId: PLAYGROUND_AGENT_TYPE_ID })])

    const ref = await runtime.gateway.createSession({
      scope: runtime.scope,
      agentTypeId: PLAYGROUND_AGENT_TYPE_ID,
      requestId: 'smoke-create',
      title: 'Gateway smoke',
    })
    const connection = await runtime.gateway.connectSession({ scope: runtime.scope, ref })
    const iterator = connection.events[Symbol.asyncIterator]()
    const nextEvent = iterator.next()

    await expect(connection.send({
      kind: 'prompt',
      requestId: 'smoke-prompt',
      clientNonce: 'smoke-nonce',
      content: 'exercise the reference composition',
    })).resolves.toMatchObject({ accepted: true, disposition: 'prompt' })
    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: expect.objectContaining({
        ref,
        event: expect.objectContaining({ type: 'agent-start' }),
      }),
    })
    await expect(connection.stop({ requestId: 'smoke-stop' })).resolves.toMatchObject({
      accepted: true,
      stopped: true,
    })

    await connection.close()
    await runtime.gateway.close()
    await runtime.created.host.drain()
    await runtime.created.host.close()
    await runtime.close()
    await runtime.close()

    await expect(runtime.created.host.describe()).resolves.toMatchObject({ draining: true })
    expect(disposeRuntime).toHaveBeenCalledOnce()
  })
})
