import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentHarness, RunContext, SendMessageInput } from '../../../shared/harness'
import type { SessionStore } from '../../../shared/session'
import type { PiChatEvent } from '../../../shared/chat'
import { createInitialPiChatState, piChatReducer } from '../../../front/chat/pi/piChatReducer'
import { selectMessagesForRender } from '../../../front/chat/pi/selectors'
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
  load: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0, messages: [] })),
  delete: vi.fn(async () => {}),
}

type FakeAdapter = PiAgentSessionAdapter & {
  emit(event: AgentSessionEvent): void
}

function createAdapter(followUps: string[] = []): FakeAdapter {
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  const snapshot: PiAgentSessionSnapshot = {
    state: {},
    messages: [],
    isStreaming: true,
    isRetrying: false,
    retryAttempt: 0,
    pendingMessageCount: 0,
    steeringMessages: [],
    followUpMessages: followUps,
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
    clearQueue: vi.fn(() => {
      const cleared = [...snapshot.followUpMessages]
      snapshot.followUpMessages = []
      return { steering: [], followUp: cleared }
    }),
    abort: vi.fn(async () => {}),
    abortRetry: vi.fn(),
    continueQueuedFollowUp: vi.fn(async () => {
      snapshot.followUpMessages = snapshot.followUpMessages.slice(1)
    }),
    emit(event: AgentSessionEvent) {
      for (const listener of listeners) listener(event)
    },
  }
}

function createAdapterForNativeSession(nativeSessionId: string): FakeAdapter {
  const adapter = createAdapter()
  adapter.readSnapshot().sessionId = nativeSessionId
  return adapter
}

function createHarness(adapter: PiAgentSessionAdapter): AgentHarness & {
  getPiSessionAdapter: (input: SendMessageInput, ctx: RunContext) => Promise<PiAgentSessionAdapter>
} {
  const nativeFollowUps: Array<{ text: string; clientNonce?: string; clientSeq?: number }> = adapter.readSnapshot().followUpMessages.map((text) => ({ text }))
  const syncSnapshot = () => {
    adapter.readSnapshot().followUpMessages = nativeFollowUps.map((item) => item.text)
  }

  return {
    id: 'fake-pi',
    placement: 'server',
    sessions: sessionStore,
    async *sendMessage() {},
    getPiSessionAdapter: vi.fn(async () => adapter),
    followUp: vi.fn(async (_sessionId, text, _attachments, displayText, options) => {
      nativeFollowUps.push({ text: displayText ?? text, clientNonce: options?.clientNonce, clientSeq: options?.clientSeq })
      syncSnapshot()
    }),
    clearFollowUp: vi.fn((_sessionId, options) => {
      if (options?.clientNonce || options?.clientSeq !== undefined) {
        const index = nativeFollowUps.findIndex((item) => options.clientNonce
          ? item.clientNonce === options.clientNonce
          : item.clientSeq === options.clientSeq)
        if (index >= 0) nativeFollowUps.splice(index, 1)
      } else {
        nativeFollowUps.splice(0)
      }
      syncSnapshot()
    }),
  }
}

function createService(adapter = createAdapter()) {
  const harness = createHarness(adapter)
  const service = new HarnessPiChatService({
    harness,
    sessionStore,
    workdir: '/workspace',
  })
  return { service, harness, adapter }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function renderMessagesFromEvents(events: PiChatEvent[]) {
  const state = events.reduce((current, event) => (
    piChatReducer(current, { type: 'event', event })
  ), createInitialPiChatState({ sessionId: 's1', storageScope: 'scope-a' }))

  return selectMessagesForRender(state)
}

describe('HarnessPiChatService', () => {
  it('threads prompt clientNonce through the first matching user message event', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'prompt text',
      clientNonce: 'nonce-prompt',
    })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'prompt text' }] },
    } as unknown as AgentSessionEvent)

    expect(events.at(-1)).toMatchObject({
      type: 'message-start',
      role: 'user',
      clientNonce: 'nonce-prompt',
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('forwards prompt model, thinking, and image attachments through the Pi-native adapter path', async () => {
    const adapter = createAdapter()
    const { service, harness } = createService(adapter)
    const attachments = [
      { filename: 'diagram.png', mediaType: 'image/png', url: 'data:image/png;base64,abc123' },
      { filename: 'notes.txt', mediaType: 'text/plain', url: 'data:text/plain;base64,bm90ZXM=' },
    ]

    await service.prompt(ctx, 's1', {
      message: 'prompt text',
      clientNonce: 'nonce-prompt',
      model: { provider: 'anthropic', id: 'claude-sonnet' },
      thinkingLevel: 'high',
      attachments,
    })

    expect(harness.getPiSessionAdapter).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1',
      message: 'prompt text',
      model: { provider: 'anthropic', id: 'claude-sonnet' },
      thinkingLevel: 'high',
      attachments,
    }), expect.any(Object))
    expect(adapter.prompt).toHaveBeenCalledWith({
      text: 'prompt text',
      options: {
        images: [{ type: 'image', mimeType: 'image/png', data: 'abc123' }],
      },
    })
  })

  it('acknowledges prompt acceptance before the active run settles', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { service } = createService(adapter)

    const receipt = await service.prompt(ctx, 's1', {
      message: 'long running prompt',
      clientNonce: 'nonce-running',
    })

    expect(receipt).toMatchObject({ accepted: true, clientNonce: 'nonce-running', cursor: 1 })
    expect(adapter.prompt).toHaveBeenCalledWith('long running prompt')
    run.resolve()
    await run.promise
  })

  it('publishes an error event when an accepted prompt run rejects before streaming events arrive', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const receipt = await service.prompt(ctx, 's1', {
      message: 'will fail',
      clientNonce: 'nonce-fail',
    })

    run.reject(new Error('provider down'))
    await run.promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receipt).toMatchObject({ accepted: true, cursor: 1, clientNonce: 'nonce-fail' })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message-start',
        seq: 1,
        role: 'user',
        text: 'will fail',
        clientNonce: 'nonce-fail',
      }),
      expect.objectContaining({
        type: 'error',
        seq: 2,
        error: expect.objectContaining({ message: 'provider down', retryable: false }),
      }),
    ]))
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      seq: 2,
      status: 'error',
      error: expect.objectContaining({ message: 'provider down', retryable: false }),
      messages: [
        expect.objectContaining({
          role: 'user',
          clientNonce: 'nonce-fail',
          parts: [expect.objectContaining({ type: 'text', text: 'will fail' })],
        }),
      ],
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('does not synthesize a prompt rejection after the prompt user message is consumed', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const receipt = await service.prompt(ctx, 's1', {
      message: 'started then failed',
      clientNonce: 'nonce-started',
    })
    adapter.emit({ type: 'agent_start', turnId: 'turn-started' } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_start',
      message: { id: 'u-started', role: 'user', content: [{ type: 'text', text: 'started then failed' }] },
    } as unknown as AgentSessionEvent)

    run.reject(new Error('provider down after start'))
    await run.promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receipt).toMatchObject({ accepted: true, cursor: 1 })
    expect(events).toEqual([
      expect.objectContaining({ type: 'agent-start', seq: 1, turnId: 'turn-started' }),
      expect.objectContaining({ type: 'message-start', seq: 2, messageId: 'u-started', role: 'user', clientNonce: 'nonce-started' }),
    ])

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('still publishes prompt rejection after unrelated events advance the stream', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const receipt = await service.prompt(ctx, 's1', {
      message: 'fails after queue noise',
      clientNonce: 'nonce-noise',
    })
    adapter.emit({ type: 'queue_update', followUp: ['unrelated queued'] } as unknown as AgentSessionEvent)

    run.reject(new Error('provider down after queue event'))
    await run.promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receipt).toMatchObject({ accepted: true, cursor: 1 })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'queue-updated', seq: 1 }),
      expect.objectContaining({ type: 'message-start', seq: 2, role: 'user', text: 'fails after queue noise', clientNonce: 'nonce-noise' }),
      expect.objectContaining({ type: 'error', seq: 3, error: expect.objectContaining({ message: 'provider down after queue event' }) }),
    ]))

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps mapper sequence aligned after a pre-stream prompt rejection', async () => {
    const adapter = createAdapter()
    const failedRun = deferred<void>()
    const retryRun = deferred<void>()
    adapter.prompt = vi.fn()
      .mockImplementationOnce(() => failedRun.promise)
      .mockImplementationOnce(() => retryRun.promise)
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'first try',
      clientNonce: 'nonce-first',
    })
    failedRun.reject(new Error('provider down'))
    await failedRun.promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(service.prompt(ctx, 's1', {
      message: 'retry',
      clientNonce: 'nonce-retry',
    })).resolves.toMatchObject({ accepted: true, cursor: 3, clientNonce: 'nonce-retry' })
    expect(() => {
      adapter.emit({ type: 'agent_start', turnId: 'turn-retry' } as unknown as AgentSessionEvent)
      adapter.emit({
        type: 'message_start',
        message: { id: 'retry-user', role: 'user', content: [{ type: 'text', text: 'retry' }] },
      } as unknown as AgentSessionEvent)
    }).not.toThrow()
    retryRun.resolve()
    await retryRun.promise

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message-start', seq: 1, role: 'user', text: 'first try', clientNonce: 'nonce-first' }),
      expect.objectContaining({ type: 'error', seq: 2 }),
      expect.objectContaining({ type: 'agent-start', seq: 3, turnId: 'turn-retry' }),
      expect.objectContaining({ type: 'message-start', seq: 4, messageId: 'retry-user', role: 'user', clientNonce: 'nonce-retry' }),
    ]))

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('prefers prompt metadata over queued follow-up metadata for repeated user text events', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'same text',
      clientNonce: 'nonce-prompt',
    })
    await service.followUp(ctx, 's1', {
      message: 'same text',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'same text' }] },
    } as unknown as AgentSessionEvent)
    expect(events.at(-1)).toMatchObject({
      type: 'message-start',
      role: 'user',
      clientNonce: 'nonce-prompt',
    })
    expect(events.at(-1)).not.toMatchObject({ clientSeq: 3 })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'same text' }] },
    } as unknown as AgentSessionEvent)
    expect(events.at(-1)).toMatchObject({
      type: 'message-start',
      role: 'user',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps Pi mapper context across tool call and tool result events', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', content: [] },
    } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        partial: { id: 'a1' },
        toolCall: { id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } },
      },
    } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      result: { content: '/workspace' },
    } as unknown as AgentSessionEvent)

    expect(events).toEqual([
      expect.objectContaining({ type: 'agent-start', seq: 1, turnId: 'turn-1' }),
      expect.objectContaining({ type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' }),
      expect.objectContaining({ type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'tool-1' }),
      expect.objectContaining({ type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'tool-1' }),
    ])

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('projects enriched prompt echoes with raw display text and nonce metadata', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'raw prompt\n\n@files: src/app.ts',
      displayMessage: 'raw prompt',
      clientNonce: 'nonce-1',
    })
    adapter.emit({
      type: 'message_start',
      message: { role: 'user', content: [{ type: 'text', text: 'raw prompt\n\n@files: src/app.ts' }] },
    } as unknown as AgentSessionEvent)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message-start',
      role: 'user',
      text: 'raw prompt',
      clientNonce: 'nonce-1',
    }))

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('includes the active live turn id in state snapshots during streaming reload', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const subscription = await service.subscribe(ctx, 's1', 0, () => {})
    expect(subscription.type).toBe('ok')

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)

    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      status: 'streaming',
      activeTurnId: 'turn-1',
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('does not stamp the active turn id onto older snapshot rows during streaming reload', async () => {
    const adapter = createAdapter()
    const messages = adapter.readSnapshot().messages as unknown[]
    messages.push(
      { id: 'old-user', message: { role: 'user', content: 'old prompt', timestamp: 1 } },
      { id: 'old-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'old answer' }], stopReason: 'stop', timestamp: 2 } },
      { id: 'active-user', message: { role: 'user', content: 'active prompt', timestamp: 3 } },
      { id: 'active-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }], timestamp: 4 } },
    )
    const { service } = createService(adapter)
    const subscription = await service.subscribe(ctx, 's1', 0, () => {})
    expect(subscription.type).toBe('ok')

    adapter.emit({ type: 'agent_start', turnId: 'turn-active' } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_start',
      message: { id: 'active-user', role: 'user', content: [{ type: 'text', text: 'active prompt' }] },
    } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_start',
      message: { id: 'active-assistant', role: 'assistant', content: [] },
    } as unknown as AgentSessionEvent)

    const snapshot = await service.readState(ctx, 's1')

    expect(snapshot).toMatchObject({
      status: 'streaming',
      activeTurnId: 'turn-active',
    })
    expect(snapshot.messages.map((message) => [message.id, message.turnId])).toEqual([
      ['old-user', undefined],
      ['old-assistant', undefined],
      ['active-user', 'turn-active'],
      ['active-assistant', 'turn-active'],
    ])

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('uses enriched server text when interrupt auto-post falls back to reposting a queued follow-up', async () => {
    const adapter = createAdapter()
    adapter.continueQueuedFollowUp = undefined
    const { service, harness } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'queued raw text\n\n@files: src/app.ts',
      displayMessage: 'queued raw text',
      clientNonce: 'queued-nonce',
      clientSeq: 1,
    })
    expect(harness.followUp).toHaveBeenCalledWith('s1', 'queued raw text\n\n@files: src/app.ts', undefined, 'queued raw text', {
      clientNonce: 'queued-nonce',
      clientSeq: 1,
    })
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [expect.objectContaining({ displayText: 'queued raw text' })] },
    })

    await service.interrupt(ctx, 's1', {})

    expect(adapter.prompt).toHaveBeenCalledWith('queued raw text\n\n@files: src/app.ts')
  })

  it('rejects interrupt instead of silently skipping fallback auto-post when one queued item cannot be safely consumed', async () => {
    const adapter = createAdapter(['first queued', 'second queued'])
    adapter.continueQueuedFollowUp = undefined
    const { service, harness } = createService(adapter)
    harness.clearFollowUp = undefined

    await expect(service.interrupt(ctx, 's1', {})).rejects.toThrow('Cannot auto-post queued follow-up')

    expect(adapter.prompt).not.toHaveBeenCalled()
    expect(adapter.readSnapshot().followUpMessages).toEqual(['first queued', 'second queued'])
  })

  it('preserves the queued follow-up when fallback reposting fails', async () => {
    const adapter = createAdapter(['queued raw text'])
    adapter.continueQueuedFollowUp = undefined
    adapter.prompt = vi.fn(async () => { throw new Error('provider down') })
    const { service, harness } = createService(adapter)
    harness.clearFollowUp = undefined

    await expect(service.interrupt(ctx, 's1', {})).rejects.toThrow('provider down')

    expect(adapter.readSnapshot().followUpMessages).toEqual(['queued raw text'])
  })

  it('projects id-less Pi live turns into one render row per user and assistant message', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const user = { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1_700_000_000_000 }
    const assistant = { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 1_700_000_000_001 }

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'message_start', message: user } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'message_end', message: user } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'message_start', message: { role: 'assistant', content: [] } } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'message_end', message: assistant } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'agent_end', messages: [user, assistant], willRetry: false } as unknown as AgentSessionEvent)

    const messageStarts = events.filter((event) => event.type === 'message-start')
    const messageEnds = events.filter((event) => event.type === 'message-end')
    const rendered = renderMessagesFromEvents(events)

    expect(messageStarts).toEqual([
      expect.objectContaining({ type: 'message-start', role: 'user' }),
      expect.objectContaining({ type: 'message-start', role: 'assistant' }),
    ])
    expect(messageEnds).toEqual([
      expect.objectContaining({ type: 'message-end', messageId: messageStarts[0]?.messageId }),
      expect.objectContaining({ type: 'message-end', messageId: messageStarts[1]?.messageId }),
    ])
    expect(events.filter((event) => event.type === 'agent-end')).toHaveLength(1)
    expect(rendered.map((message) => ({ id: message.id, role: message.role }))).toEqual([
      { id: messageStarts[0]?.messageId, role: 'user' },
      { id: messageStarts[1]?.messageId, role: 'assistant' },
    ])
    expect(new Set(rendered.map((message) => message.id)).size).toBe(2)

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('queues follow-ups through the harness metadata path when available', async () => {
    const { service, harness, adapter } = createService()

    await expect(service.followUp(ctx, 's1', {
      message: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })).resolves.toMatchObject({ accepted: true, queued: true, clientNonce: 'nonce-q', clientSeq: 3 })

    expect(harness.followUp).toHaveBeenCalledWith('s1', 'queued', undefined, 'queued', {
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })
    expect(adapter.followUp).not.toHaveBeenCalled()
  })

  it('enriches queue events emitted during follow-up enqueue', async () => {
    const adapter = createAdapter()
    const { service, harness } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')
    harness.followUp = vi.fn(async () => {
      adapter.emit({ type: 'queue_update', followUp: ['queued'] } as unknown as AgentSessionEvent)
    })

    await service.followUp(ctx, 's1', {
      message: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    expect(events.at(-1)).toMatchObject({
      type: 'queue-updated',
      queue: { followUps: [{ displayText: 'queued', clientNonce: 'nonce-q', clientSeq: 3 }] },
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('threads queued follow-up selectors through recovered state and queue events', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [{ displayText: 'queued', clientNonce: 'nonce-q', clientSeq: 3 }] },
    })

    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    adapter.emit({ type: 'queue_update', followUp: ['queued'] } as unknown as AgentSessionEvent)
    expect(events.at(-1)).toMatchObject({
      type: 'queue-updated',
      queue: { followUps: [{ displayText: 'queued', clientNonce: 'nonce-q', clientSeq: 3 }] },
    })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'queued' }] },
    } as unknown as AgentSessionEvent)
    expect(events.at(-1)).toMatchObject({
      type: 'message-start',
      role: 'user',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps /state scoped to the requested browser-visible session id when Pi reports a linked native id', async () => {
    const adapter = createAdapterForNativeSession('native-pi-session')
    const { service } = createService(adapter)

    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      sessionId: 's1',
      queue: { followUps: [] },
    })
  })

  it('threads prompt and follow-up selectors through only new recovered snapshot messages', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)

    await service.prompt(ctx, 's1', {
      message: 'same text',
      clientNonce: 'nonce-prompt',
    })
    await service.followUp(ctx, 's1', {
      message: 'same text',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    const currentTimestamp = Date.now() + 1000
    adapter.readSnapshot().messages = [
      { id: 'old-duplicate', role: 'user', content: [{ type: 'text', text: 'same text' }], timestamp: 1 },
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'same text' }], timestamp: currentTimestamp },
      { id: 'u2', role: 'user', content: [{ type: 'text', text: 'same text' }], timestamp: currentTimestamp + 1 },
    ]

    const state = await service.readState(ctx, 's1')
    expect(state).toMatchObject({
      messages: [
        { id: 'old-duplicate' },
        { id: 'u1', clientNonce: 'nonce-prompt' },
        { id: 'u2', clientNonce: 'nonce-q', clientSeq: 3 },
      ],
    })
    expect(state.messages[0]?.clientNonce).toBeUndefined()
    expect(state.messages[0]?.clientSeq).toBeUndefined()
  })

  it('delegates selected queue clears to the harness follow-up selector', async () => {
    const adapter = createAdapter()
    const { service, harness } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })
    await expect(service.clearQueue(ctx, 's1', {
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })).resolves.toMatchObject({ accepted: true, cleared: 1 })

    expect(harness.clearFollowUp).toHaveBeenCalledWith('s1', {
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })
    expect(adapter.clearQueue).not.toHaveBeenCalled()
  })

  it('prefers nonce over colliding clientSeq when removing selected metadata', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)

    await service.followUp(ctx, 's1', { message: 'first', clientNonce: 'nonce-1', clientSeq: 1 })
    await service.followUp(ctx, 's1', { message: 'second', clientNonce: 'nonce-2', clientSeq: 1 })

    await expect(service.clearQueue(ctx, 's1', { clientNonce: 'nonce-2', clientSeq: 1 })).resolves.toMatchObject({ accepted: true, cleared: 1 })
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [{ displayText: 'first', clientNonce: 'nonce-1', clientSeq: 1 }] },
    })
  })

  it('does not turn selected clears into full clears without harness selector support', async () => {
    const adapter = createAdapter(['first', 'second'])
    const { service, harness } = createService(adapter)
    harness.clearFollowUp = undefined

    await expect(service.clearQueue(ctx, 's1', {
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })).resolves.toMatchObject({ accepted: true, cleared: 0 })

    expect(adapter.clearQueue).not.toHaveBeenCalled()
  })

  it('interrupts the active run and auto-posts the next queued follow-up', async () => {
    const adapter = createAdapter()
    const { service, harness } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'next queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })
    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })

    expect(adapter.abortRetry).toHaveBeenCalledTimes(1)
    expect(adapter.abort).toHaveBeenCalledTimes(1)
    expect(harness.clearFollowUp).not.toHaveBeenCalled()
    expect(adapter.continueQueuedFollowUp).toHaveBeenCalledTimes(1)
    expect(adapter.prompt).not.toHaveBeenCalled()
    expect(adapter.clearQueue).not.toHaveBeenCalled()
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [] },
    })
  })

  it('does not auto-post queued follow-ups when interrupting an idle session', async () => {
    const adapter = createAdapter()
    adapter.readSnapshot().isStreaming = false
    adapter.readSnapshot().isRetrying = false
    const { service } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'idle queued',
      clientNonce: 'nonce-idle',
      clientSeq: 7,
    })
    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })

    expect(adapter.abortRetry).toHaveBeenCalledTimes(1)
    expect(adapter.abort).not.toHaveBeenCalled()
    expect(adapter.continueQueuedFollowUp).not.toHaveBeenCalled()
    expect(adapter.prompt).not.toHaveBeenCalled()
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [{ displayText: 'idle queued', clientNonce: 'nonce-idle', clientSeq: 7 }] },
    })
  })

  it('interrupts retry backoff and auto-posts the next queued follow-up', async () => {
    const adapter = createAdapter()
    adapter.readSnapshot().isStreaming = false
    adapter.readSnapshot().isRetrying = true
    const { service } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'queued during retry',
      clientNonce: 'nonce-retry',
      clientSeq: 4,
    })
    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })

    expect(adapter.abortRetry).toHaveBeenCalledTimes(1)
    expect(adapter.abort).toHaveBeenCalledTimes(1)
    expect(adapter.continueQueuedFollowUp).toHaveBeenCalledTimes(1)
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [] },
    })
  })

  it('preserves consuming metadata when fallback repost fails after interrupt', async () => {
    const adapter = createAdapter()
    delete adapter.continueQueuedFollowUp
    adapter.prompt = vi.fn(async () => {
      throw new Error('fallback failed')
    })
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.followUp(ctx, 's1', {
      message: 'same text later',
      clientNonce: 'nonce-fallback',
      clientSeq: 8,
    })
    await expect(service.interrupt(ctx, 's1', {})).rejects.toThrow('fallback failed')

    adapter.emit({
      type: 'message_start',
      message: { id: 'u-later', role: 'user', content: [{ type: 'text', text: 'same text later' }] },
    } as unknown as AgentSessionEvent)

    const laterUser = events.at(-1)
    expect(laterUser).toMatchObject({ type: 'message-start', role: 'user', messageId: 'u-later' })
    expect(laterUser).toMatchObject({ clientNonce: 'nonce-fallback', clientSeq: 8 })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('clears the selected follow-up before fallback repost when native continue is unavailable', async () => {
    const adapter = createAdapter()
    delete adapter.continueQueuedFollowUp
    const { service, harness } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'fallback queued',
      clientNonce: 'nonce-fallback',
      clientSeq: 5,
    })
    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })

    expect(harness.clearFollowUp).toHaveBeenCalledWith('s1', {
      clientNonce: 'nonce-fallback',
      clientSeq: 5,
    })
    expect(adapter.prompt).toHaveBeenCalledWith('fallback queued')
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [] },
    })
  })

  it('clears the harness metadata queue on full clear and stop', async () => {
    const adapter = createAdapter(['first', 'second'])
    const { service, harness } = createService(adapter)

    await expect(service.clearQueue(ctx, 's1', {})).resolves.toMatchObject({ accepted: true, cleared: 2 })
    expect(harness.clearFollowUp).toHaveBeenCalledWith('s1')
    expect(adapter.clearQueue).not.toHaveBeenCalled()

    const stopAdapter = createAdapter(['stop queued'])
    const stop = createService(stopAdapter)
    await expect(stop.service.stop(ctx, 's1', {})).resolves.toMatchObject({
      accepted: true,
      stopped: true,
      clearedQueue: [{ id: expect.stringContaining('queue:s1:followup'), kind: 'followup', displayText: 'stop queued' }],
    })

    expect(stop.harness.clearFollowUp).toHaveBeenCalledWith('s1')
    expect(stopAdapter.clearQueue).not.toHaveBeenCalled()
    expect(stopAdapter.abort).toHaveBeenCalledTimes(1)
  })
})
