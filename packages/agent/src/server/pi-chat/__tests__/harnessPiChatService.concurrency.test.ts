import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentHarness, RunContext, SendMessageInput } from '../../../shared/harness'
import type { SessionStore } from '../../../shared/session'
import type { PiChatEvent } from '../../../shared/chat'
import type { PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../PiAgentSessionAdapter'
import { HarnessPiChatService } from '../harnessPiChatService'
import type { PiSessionRequestContext } from '../piSessionIdentity'

const ctx: PiSessionRequestContext = {
  workspaceId: 'workspace-a',
  storageScope: 'scope-a',
  authSubject: 'user-a',
  requestId: 'request-a',
}

const sessionStore: SessionStore = {
  list: vi.fn(async () => []),
  create: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })),
  load: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })),
  delete: vi.fn(async () => {}),
}

type FakeAdapter = PiAgentSessionAdapter & { emit(event: AgentSessionEvent): void; listenerCount(): number }

function createAdapter(): FakeAdapter {
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  const snapshot: PiAgentSessionSnapshot = {
    state: {},
    messages: [],
    isStreaming: false,
    isRetrying: false,
    retryAttempt: 0,
    pendingMessageCount: 0,
    steeringMessages: [],
    followUpMessages: [],
    followUpMode: 'one-at-a-time',
    sessionId: 's1',
  }
  return {
    readSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    prompt: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    clearFollowUp: vi.fn(),
    abort: vi.fn(async () => {}),
    abortRetry: vi.fn(),
    emit(event: AgentSessionEvent) {
      for (const listener of listeners) listener(event)
    },
    listenerCount: () => listeners.size,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

/**
 * Build a service whose getPiSessionAdapter resolves only when the returned
 * `release` is called, so we can force two concurrent cold callers to overlap
 * inside getChannel/getAdapter.
 */
function createGatedService() {
  const adapter = createAdapter()
  const gates: Array<() => void> = []
  const harness: AgentHarness & {
    getPiSessionAdapter: (input: SendMessageInput, ctx: RunContext) => Promise<PiAgentSessionAdapter>
    hasPiSession: (sessionId: string) => boolean
  } = {
    id: 'fake-pi',
    placement: 'server',
    sessions: sessionStore,
    hasPiSession: vi.fn(() => false),
    getPiSessionAdapter: vi.fn(async () => {
      const gate = deferred<void>()
      gates.push(gate.resolve)
      await gate.promise
      return adapter
    }),
  }
  const service = new HarnessPiChatService({ harness, sessionStore, workdir: '/workspace' })
  return { service, adapter, harness, releaseNext: () => gates.shift()?.() }
}

describe('HarnessPiChatService concurrent clients on the same session', () => {
  it('fans a live event out to two concurrent cold subscribers (single shared channel)', async () => {
    const { service, adapter, releaseNext } = createGatedService()
    const aEvents: PiChatEvent[] = []
    const bEvents: PiChatEvent[] = []

    const subA = service.subscribe(ctx, 's1', 0, (e) => aEvents.push(e))
    const subB = service.subscribe(ctx, 's1', 0, (e) => bEvents.push(e))

    // Both cold callers are now parked inside getAdapter; release both so they
    // race through ensureChannel.
    releaseNext()
    releaseNext()
    const resultA = await subA
    const resultB = await subB
    expect(resultA.type).toBe('ok')
    expect(resultB.type).toBe('ok')

    // Exactly one live channel must own the adapter subscription.
    expect(adapter.listenerCount()).toBe(1)

    // A single underlying event must reach BOTH subscribers. `agent_start` is
    // the raw Pi event the adapter emits; the mapper turns it into an
    // `agent-start` PiChatEvent that the channel buffer fans out.
    adapter.emit({ type: 'agent_start', turnId: 't1' } as unknown as AgentSessionEvent)

    expect(aEvents.length).toBeGreaterThan(0)
    expect(bEvents.length).toBeGreaterThan(0)
  })

  it('readState resolves while a long-lived subscription is open', async () => {
    const { service, releaseNext } = createGatedService()
    const sub = service.subscribe(ctx, 's1', 0, () => {})
    releaseNext() // let subscribe finish creating the channel
    await sub

    // readState reuses the warm channel; release its getAdapter immediately.
    const statePromise = service.readState(ctx, 's1')
    releaseNext()
    const snapshot = await statePromise
    expect(snapshot.sessionId).toBe('s1')
  })
})
