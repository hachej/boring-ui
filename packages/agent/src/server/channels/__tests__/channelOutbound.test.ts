import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentHarness, AgentSendInput, RunContext } from '../../../shared/harness'
import type { PiChatEvent } from '../../../shared/chat'
import type { SessionStore } from '../../../shared/session'
import { ErrorCode } from '../../../shared/error-codes'
import { openDatabase } from '../../events/sqlStorage'
import { SqliteEventStreamStore } from '../../events/eventStreamStore'
import { HarnessPiChatService } from '../../pi-chat/harnessPiChatService'
import type { PiAgentSessionAdapter } from '../../pi-chat/PiAgentSessionAdapter'
import { ChannelBindingStore } from '../channelBindingStore'
import { ChannelInboundService, type ChannelAgentInvoker } from '../channelInboundService'
import {
  ChannelOutboundService,
  assembleNextTurn,
  shapeChannelText,
  type ChannelOutboundAdapter,
} from '../channelOutboundService'

const bindingInput = {
  channel: 'whatsapp',
  conversationKey: '+41790000000',
  agentTypeId: 'default',
  workspaceId: 'workspace-1',
  authSubjectId: 'user-1',
  sessionKey: 'session-1',
} as const

async function withChannel(run: (input: {
  bindings: ChannelBindingStore
  events: SqliteEventStreamStore
  path: string
  append: (chunk: PiChatEvent, timestamp?: number) => Promise<string>
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'boring-channel-outbound-'))
  const db = openDatabase(join(dir, 'channel.sqlite'))
  const bindings = new ChannelBindingStore(db.sql, db.runTransaction)
  const events = new SqliteEventStreamStore(db.sql, db.runTransaction)
  const stream = await events.createSessionStream(
    { workspaceScopeId: bindingInput.workspaceId, sessionId: bindingInput.sessionKey },
    { agentTypeId: bindingInput.agentTypeId, authSubjectId: bindingInput.authSubjectId },
  )
  let key = 0
  try {
    await run({
      bindings,
      events,
      path: stream.path,
      append: (chunk, timestamp) => events.appendEvent(stream.path, {
        v: 1,
        eventIndex: key++,
        timestamp: timestamp ?? Date.now(),
        sessionId: bindingInput.sessionKey,
        chunk,
      }),
    })
  } finally {
    db.db.close()
    await rm(dir, { recursive: true, force: true })
  }
}

function fakeAdapter(sent: string[], templates: string[] = [], serviceWindowMs?: number): ChannelOutboundAdapter<string> {
  return {
    ...(serviceWindowMs === undefined ? {} : { serviceWindowMs }),
    renderOutbound: (turn) => [turn.text],
    send: async ({ message }) => { sent.push(message) },
    sendWindowTemplate: async ({ conversationKey }) => { templates.push(conversationKey) },
  }
}

function runtime(path: string) {
  return {
    resolveStreamPath: vi.fn(async () => path),
    createSession: vi.fn(async () => 'replacement-session'),
  }
}

async function appendTurn(
  append: (chunk: PiChatEvent, timestamp?: number) => Promise<string>,
  turnId: string,
  text: string,
  status: 'ok' | 'aborted' | 'error' = 'ok',
  timestamp?: number,
) {
  await append({ type: 'agent-start', seq: 1, turnId }, timestamp)
  await append({
    type: 'message-end',
    seq: 2,
    messageId: `${turnId}-assistant`,
    final: {
      id: `${turnId}-assistant`,
      role: 'assistant',
      turnId,
      parts: [
        { type: 'reasoning', id: 'hidden', text: 'secret', state: 'done' },
        { type: 'text', text },
        { type: 'tool-call', id: 'tool', toolName: 'read', state: 'output-available' },
      ],
    },
  }, timestamp)
  return append({ type: 'agent-end', seq: 3, turnId, status }, timestamp)
}

describe('durable channel outbound', () => {
  test('assembles completed assistant text only and ignores retry terminals', () => {
    const entries = [
      envelope({ type: 'agent-start', seq: 1, turnId: 'turn-1' }, '0'),
      envelope({ type: 'tool-call', seq: 2, messageId: 'a', toolCallId: 'x', toolName: 'read', input: {} }, '1'),
      envelope({
        type: 'message-end', seq: 3, messageId: 'a',
        final: { id: 'a', role: 'assistant', turnId: 'turn-1', parts: [{ type: 'text', text: 'done' }] },
      }, '2'),
      envelope({ type: 'agent-end', seq: 4, turnId: 'turn-1', status: 'error', willRetry: true }, '3'),
      envelope({ type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'ok' }, '4'),
    ]
    expect(assembleNextTurn(entries)).toEqual({
      terminalOffset: '4',
      turn: { turnId: 'turn-1', status: 'ok', text: 'done' },
    })
  })

  test('treats a synthetic error event as terminal without leaking its details', () => {
    const entries = [
      envelope({
        type: 'error', seq: 2, retryable: false,
        error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'private provider detail', retryable: false },
      }, '1'),
    ]
    expect(assembleNextTurn(entries)).toEqual({
      terminalOffset: '1',
      turn: {
        turnId: 'error:1', status: 'error',
        text: 'I could not complete that request. Please try again.',
      },
    })
  })

  test('persists the cursor across restart and sends each terminal turn once', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.1', text: 'hello', receivedAt: Date.now(),
      }, 'default')
      await appendTurn(append, 'turn-1', 'first reply')
      const sent: string[] = []
      const first = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', fakeAdapter(sent)]]))
      first.start()
      await first.waitForIdle()
      await first.dispose()
      expect(sent).toEqual(['first reply'])
      expect(bindings.getBinding('whatsapp', bindingInput.conversationKey, 'default')?.outboundCursor).not.toBe('-1')

      const second = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', fakeAdapter(sent)]]))
      second.start()
      await second.waitForIdle()
      expect(sent).toEqual(['first reply'])
      await appendTurn(append, 'turn-2', 'second reply')
      await second.waitForIdle()
      expect(sent).toEqual(['first reply', 'second reply'])
      await second.dispose()
    })
  })

  test('graceful disposal waits for an in-flight send and prevents restart duplicates', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.graceful', text: 'hello', receivedAt: Date.now(),
      }, 'default')
      await appendTurn(append, 'turn-graceful', 'one reply')
      const sent: string[] = []
      let release!: () => void
      let started!: () => void
      const blocked = new Promise<void>((resolve) => { release = resolve })
      const sending = new Promise<void>((resolve) => { started = resolve })
      const adapter = fakeAdapter(sent)
      adapter.send = vi.fn(async ({ message }) => {
        started()
        await blocked
        sent.push(message)
      })
      const first = new ChannelOutboundService(bindings, events, runtime(path), new Map([['whatsapp', adapter]]))
      first.start()
      await sending
      let disposed = false
      const disposal = first.dispose().then(() => { disposed = true })
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(disposed).toBe(false)
      release()
      await disposal

      const second = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', fakeAdapter(sent)]]))
      second.start()
      await second.waitForIdle()
      await second.dispose()
      expect(sent).toEqual(['one reply'])
    })
  })

  test('disposal removes a subscription installed by an in-flight path resolution', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      let release!: () => void
      let resolving!: () => void
      const blocked = new Promise<void>((resolve) => { release = resolve })
      const started = new Promise<void>((resolve) => { resolving = resolve })
      const sent: string[] = []
      const service = new ChannelOutboundService(bindings, events, {
        async resolveStreamPath() {
          resolving()
          await blocked
          return path
        },
        createSession: async () => bindingInput.sessionKey,
      }, new Map([['whatsapp', fakeAdapter(sent)]]))
      service.start()
      await started
      const disposal = service.dispose()
      release()
      await disposal
      await appendTurn(append, 'turn-after-dispose', 'must not send')
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(sent).toEqual([])
    })
  })

  test('reclaims an expired crash lease without requiring another inbound wake', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      const binding = bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.crash-lease', text: 'hello', receivedAt: Date.now(),
      }, 'default')
      await appendTurn(append, 'turn-crash-lease', 'recovered reply')
      expect(bindings.claimOutbound(binding, 'crashed-process', 15)).toBe(true)
      const sent: string[] = []
      const service = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', fakeAdapter(sent)]]), { outboundClaimTtlMs: 15 })
      service.start()
      await new Promise((resolve) => setTimeout(resolve, 30))
      await service.waitForIdle()
      expect(sent).toEqual(['recovered reply'])
      await service.dispose()
    })
  })

  test('documents accepted at-least-once replay after send-before-CAS failure', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.replay', text: 'hello', receivedAt: Date.now(),
      }, 'default')
      await appendTurn(append, 'turn-replay', 'deliver me')
      const sent: string[] = []
      const cas = bindings.compareAndSetOutboundCursor.bind(bindings)
      vi.spyOn(bindings, 'compareAndSetOutboundCursor').mockImplementationOnce(() => false).mockImplementation(cas)
      const first = new ChannelOutboundService(bindings, events, runtime(path), new Map([['whatsapp', fakeAdapter(sent)]]))
      first.start()
      await first.waitForIdle()
      await first.dispose()
      const second = new ChannelOutboundService(bindings, events, runtime(path), new Map([['whatsapp', fakeAdapter(sent)]]))
      second.start()
      await second.waitForIdle()
      await second.dispose()
      expect(sent).toEqual(['deliver me', 'deliver me'])
      expect(bindings.getBinding('whatsapp', bindingInput.conversationKey, 'default')?.outboundCursor).not.toBe('-1')
    })
  })

  test('holds content outside 24 hours, sends one template, then releases after inbound', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      let now = 100_000
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.old', text: 'old', receivedAt: 1,
      }, 'default')
      await appendTurn(append, 'turn-window', 'held reply')
      const sent: string[] = []
      const templates: string[] = []
      const service = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', fakeAdapter(sent, templates, 10)]]), { now: () => now })
      service.start()
      await service.waitForIdle()
      service.start()
      await service.waitForIdle()
      expect(templates).toHaveLength(1)
      expect(sent).toEqual([])
      expect(bindings.getBinding('whatsapp', bindingInput.conversationKey, 'default')?.outboundCursor).toBe('-1')

      now += 1
      const accepted = bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.fresh', text: 'continue', receivedAt: now,
      }, 'default')
      if (accepted.disposition !== 'enqueued') throw new Error('expected enqueue')
      service.notifyInbound(accepted.binding)
      await service.waitForIdle()
      expect(sent).toEqual(['held reply'])
      await service.dispose()
    })
  })

  test('parks a permanently unsendable turn without wedging the next turn', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.park', text: 'hello', receivedAt: Date.now(),
      }, 'default')
      await appendTurn(append, 'turn-bad', 'bad reply')
      await appendTurn(append, 'turn-good', 'good reply')
      const sent: string[] = []
      const adapter = fakeAdapter(sent)
      adapter.send = vi.fn(async ({ message }) => {
        if (message === 'bad reply') throw Object.assign(new Error('rejected'), { code: ErrorCode.enum.INTERNAL_ERROR, retryable: false })
        sent.push(message)
      })
      const service = new ChannelOutboundService(bindings, events, runtime(path), new Map([['whatsapp', adapter]]))
      service.start()
      await service.waitForIdle()
      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(sent).toEqual(['good reply'])
      await service.dispose()
    })
  })

  test('bounds fallback-template retries while preserving held content', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.template-retry', text: 'old', receivedAt: 1,
      }, 'default')
      await appendTurn(append, 'turn-template', 'held reply')
      const sent: string[] = []
      const adapter = fakeAdapter(sent, [], 10)
      adapter.sendWindowTemplate = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('temporary'), { retryable: true }))
        .mockResolvedValue(undefined)
      const service = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', adapter]]), { retryDelayMs: 1, now: () => 100 })
      service.start()
      await service.waitForIdle()
      expect(adapter.sendWindowTemplate).toHaveBeenCalledTimes(2)
      expect(sent).toEqual([])
      expect(bindings.getBinding('whatsapp', bindingInput.conversationKey, 'default')?.outboundCursor).toBe('-1')
      await service.dispose()
    })
  })

  test('parks a permanently failing fallback without discarding held content', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.template-park', text: 'old', receivedAt: 1,
      }, 'default')
      await appendTurn(append, 'turn-template-park', 'held reply')
      const adapter = fakeAdapter([], [], 10)
      adapter.sendWindowTemplate = vi.fn(async () => {
        throw Object.assign(new Error('permanent'), { code: ErrorCode.enum.INTERNAL_ERROR, retryable: false })
      })
      const service = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', adapter]]), { now: () => 100 })
      service.start()
      await service.waitForIdle()
      expect(bindings.getBinding('whatsapp', bindingInput.conversationKey, 'default')).toMatchObject({
        outboundCursor: '-1', outboundStatus: 'parked',
      })
      await service.dispose()
    })
  })

  test('renders abort and stall notices and parks their offsets', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.failure', text: 'hello', receivedAt: 100,
      }, 'default')
      await appendTurn(append, 'turn-abort', 'partial secret', 'aborted', 100)
      await append({ type: 'agent-start', seq: 4, turnId: 'turn-stall' }, 100)
      const sent: string[] = []
      const service = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', fakeAdapter(sent)]]), { stallTimeoutMs: 5, now: () => 200 })
      service.start()
      await service.waitForIdle()
      expect(sent).toEqual([
        'That request was stopped before it completed. Please try again.',
        'That request did not finish in time. Please try again.',
      ])
      await service.dispose()
    })
  })

  test('parks a stale incomplete turn without skipping a later completed turn', async () => {
    await withChannel(async ({ bindings, events, path, append }) => {
      bindings.provision(bindingInput)
      bindings.enqueueInbound({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.stale-boundary', text: 'hello', receivedAt: 200,
      }, 'default')
      await append({ type: 'agent-start', seq: 1, turnId: 'turn-stale' }, 1)
      await appendTurn(append, 'turn-after-stale', 'later reply', 'ok', 100)
      const sent: string[] = []
      const service = new ChannelOutboundService(bindings, events, runtime(path),
        new Map([['whatsapp', fakeAdapter(sent)]]), { stallTimeoutMs: 5, now: () => 200 })
      service.start()
      await service.waitForIdle()
      expect(sent).toEqual([
        'That request did not finish in time. Please try again.',
        'later reply',
      ])
      await service.dispose()
    })
  })

  test('replaces a gone session and emits one reset greeting', async () => {
    await withChannel(async ({ bindings, events }) => {
      bindings.provision(bindingInput)
      const sent: string[] = []
      const goneRuntime = {
        resolveStreamPath: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValue('sessions/workspace-1/replacement-session'),
        createSession: vi.fn(async () => 'replacement-session'),
      }
      const service = new ChannelOutboundService(bindings, events, goneRuntime,
        new Map([['whatsapp', fakeAdapter(sent)]]))
      service.start()
      await service.waitForIdle()
      expect(goneRuntime.createSession).toHaveBeenCalledOnce()
      expect(bindings.getBinding('whatsapp', bindingInput.conversationKey, 'default')).toMatchObject({
        sessionKey: 'replacement-session', outboundCursor: '-1', sessionResetPending: false,
      })
      expect(sent).toEqual(['The previous session is no longer available. I started a new conversation.'])
      await service.dispose()
    })
  })
})

describe('fake-channel conformance', () => {
  test('drives inbound through HarnessPiChatService durable events and resumes from the persisted outbound cursor', async () => {
    await withChannel(async ({ bindings, events, path }) => {
      const listeners = new Set<(event: AgentSessionEvent) => void>()
      const promptRun = vi.fn(async () => {})
      const piAdapter = {
        readSnapshot: () => ({
          state: {}, messages: [], isStreaming: false, isRetrying: false, retryAttempt: 0,
          pendingMessageCount: 0, steeringMessages: [], followUpMessages: [],
          followUpMode: 'one-at-a-time', sessionId: bindingInput.sessionKey,
        }),
        subscribe(listener: (event: AgentSessionEvent) => void) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        prompt: promptRun,
        followUp: vi.fn(async () => {}),
        clearFollowUp: vi.fn(),
        abort: vi.fn(async () => {}),
        abortRetry: vi.fn(),
      } as unknown as PiAgentSessionAdapter
      const sessions: SessionStore = {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: bindingInput.sessionKey, title: 'Channel', createdAt: '', updatedAt: '', turnCount: 0 })),
        load: vi.fn(async () => ({ id: bindingInput.sessionKey, title: 'Channel', createdAt: '', updatedAt: '', turnCount: 0 })),
        delete: vi.fn(async () => {}),
      }
      const harness = {
        id: 'fake-channel-harness',
        placement: 'server',
        sessions,
        hasPiSession: vi.fn(() => false),
        getPiSessionAdapter: vi.fn(async (_input: AgentSendInput, _ctx: RunContext) => piAdapter),
      } as AgentHarness & {
        hasPiSession(sessionId: string): boolean
        getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<PiAgentSessionAdapter>
      }
      const pi = new HarnessPiChatService({
        agentTypeId: 'default', harness, sessionStore: sessions, workdir: '/workspace', eventStore: events,
      })
      const ctx = {
        workspaceId: bindingInput.workspaceId,
        authSubject: bindingInput.authSubjectId,
        sessionAuthority: 'workspace-scope' as const,
        requestId: 'channel-conformance',
      }
      await pi.subscribe(ctx, bindingInput.sessionKey, 0, () => {})
      bindings.provision(bindingInput)
      const sent: string[] = []
      const outbound = new ChannelOutboundService(bindings, events, {
        resolveStreamPath: (binding) => pi.resolveSessionStreamPath(ctx, binding.sessionKey!),
        createSession: async () => bindingInput.sessionKey,
      }, new Map([['whatsapp', fakeAdapter(sent)]]))
      outbound.start()
      const invoker: ChannelAgentInvoker = {
        createSession: async () => bindingInput.sessionKey,
        isSessionBusy: async () => false,
        async prompt(input) {
          if (input.text === 'fail before stream') promptRun.mockRejectedValueOnce(new Error('private provider outage'))
          await pi.prompt({ ...ctx, requestId: input.requestId }, input.sessionKey, {
            message: input.text, clientNonce: input.requestId,
          })
          if (input.text === 'fail before stream') return
          for (const listener of listeners) listener({ type: 'agent_start', turnId: 'turn-conformance' } as AgentSessionEvent)
          for (const listener of listeners) listener({
            type: 'agent_end',
            messages: [{
              id: 'assistant-conformance', role: 'assistant',
              content: [{ type: 'text', text: 'CONFORMANCE_OK' }], stopReason: 'stop', timestamp: Date.now(),
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            }],
            willRetry: false,
          } as unknown as AgentSessionEvent)
        },
        followUp: async () => {},
      }
      const inbound = new ChannelInboundService(bindings, invoker)
      expect(inbound.accept({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.conformance', text: 'hello', receivedAt: Date.now(),
      }, 'default')).toMatchObject({ accepted: true })
      await inbound.waitForIdle()
      await eventually(() => sent.length === 1)
      await outbound.waitForIdle()
      expect(sent).toEqual(['CONFORMANCE_OK'])
      const cursor = bindings.getBinding('whatsapp', bindingInput.conversationKey, 'default')?.outboundCursor
      expect(cursor).not.toBe('-1')

      expect(inbound.accept({
        channel: 'whatsapp', conversationKey: bindingInput.conversationKey,
        providerMessageId: 'wamid.conformance-failure', text: 'fail before stream', receivedAt: Date.now(),
      }, 'default')).toMatchObject({ accepted: true })
      await inbound.waitForIdle()
      await eventually(() => sent.length === 2)
      expect(sent[1]).toBe('I could not complete that request. Please try again.')

      await outbound.dispose()
      const restarted = new ChannelOutboundService(bindings, events, {
        resolveStreamPath: async () => path,
        createSession: async () => bindingInput.sessionKey,
      }, new Map([['whatsapp', fakeAdapter(sent)]]))
      restarted.start()
      await restarted.waitForIdle()
      expect(sent).toEqual(['CONFORMANCE_OK', 'I could not complete that request. Please try again.'])
      await restarted.dispose()
      await pi.dispose()
    })
  })
})

describe('channel shaping', () => {
  test('uses WhatsApp markdown and closes/reopens fences across bounded chunks', () => {
    const chunks = shapeChannelText(`## Heading\n\n**bold** and *italic*\n\n| A | B |\n| --- | --- |\n| one | two |\n\n\`\`\`ts\n${'x'.repeat(40)}\n\`\`\``, 'whatsapp/markdown', 30)
    expect(chunks.every((chunk) => chunk.length <= 30)).toBe(true)
    expect(chunks.join('\n')).toContain('Heading')
    expect(chunks.join('\n')).toContain('*bold* and _italic_')
    expect(chunks.join('\n')).toContain('A — B')
    expect(chunks.join('\n')).not.toContain('| --- |')
    const closedFence = chunks.findIndex((chunk, index) => chunk.endsWith('```') && chunks[index + 1]?.startsWith('```'))
    expect(closedFence).toBeGreaterThanOrEqual(0)
  })
})

async function eventually(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for channel condition.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function envelope(chunk: PiChatEvent, offset: string) {
  return {
    offset,
    data: { v: 1 as const, eventIndex: Number(offset), timestamp: 1, sessionId: 'session-1', chunk },
  }
}
