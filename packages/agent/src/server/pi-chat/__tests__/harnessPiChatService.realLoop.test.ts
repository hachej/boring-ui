import { describe, expect, it, vi } from 'vitest'
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  SessionManager,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import type { AgentHarness, RunContext, SendMessageInput } from '../../../shared/harness'
import type { PiChatEvent } from '../../../shared/chat'
import type { SessionStore } from '../../../shared/session'
import type { PiAgentSessionAdapter } from '../PiAgentSessionAdapter'
import { createPiAgentSessionAdapter } from '../PiAgentSessionAdapter'
import { HarnessPiChatService } from '../harnessPiChatService'
import type { PiSessionRequestContext } from '../piSessionIdentity'

type ProviderConfig = Parameters<ModelRegistry['registerProvider']>[1]
type ProviderStream = ReturnType<NonNullable<ProviderConfig['streamSimple']>>
type ProviderStreamEvent = {
  type: string
  [key: string]: unknown
}
type RequestedToolCall = {
  type: 'toolCall'
  id: string
  name: 'probe_tool'
  arguments: { query: string }
}

interface RealPiAdapterOptions {
  assistantToolMessageId?: string
  finalMessageId?: string
  finalText?: string
  requestedToolCalls?: RequestedToolCall[]
  abortFinalMessageId?: string
}

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

function createProviderStream(events: ProviderStreamEvent[], finalMessage: unknown): ProviderStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        await Promise.resolve()
        yield event
      }
    },
    async result() {
      return finalMessage
    },
  } as unknown as ProviderStream
}

function usage() {
  return {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  }
}

function assistantMessage(id: string, content: unknown[], stopReason: 'toolUse' | 'stop' | 'aborted', errorMessage?: string) {
  return {
    id,
    role: 'assistant',
    content,
    api: 'boring-test',
    provider: 'boring-test',
    model: 'loop-model',
    usage: usage(),
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  }
}

function createEmptyResourceLoader() {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() }
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
}

function requestedToolCall(id: string, query: string): RequestedToolCall {
  return { type: 'toolCall', id, name: 'probe_tool', arguments: { query } }
}

async function createRealPiAdapter(options: RealPiAdapterOptions = {}) {
  const requestedToolCalls = options.requestedToolCalls ?? [requestedToolCall('tool-1', 'status')]
  const assistantToolMessageId = options.assistantToolMessageId ?? 'assistant-tool'
  const finalMessageId = options.finalMessageId ?? 'assistant-final'
  const finalText = options.finalText ?? 'REAL_LOOP_DONE'
  const abortFinalMessageId = options.abortFinalMessageId ?? 'assistant-aborted'
  const providerCalls: unknown[] = []
  const toolCalls: Array<{ toolCallId: string; params: Record<string, unknown> }> = []
  const toolCallWaiters: Array<() => void> = []
  const authStorage = AuthStorage.inMemory()
  const modelRegistry = ModelRegistry.inMemory(authStorage)

  modelRegistry.registerProvider('boring-test', {
    name: 'Boring Test Provider',
    api: 'boring-test',
    baseUrl: 'https://example.invalid',
    apiKey: 'test-key',
    models: [
      {
        id: 'loop-model',
        name: 'Loop Model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_000_000,
        maxTokens: 128,
      },
    ],
    streamSimple(_model, context, streamOptions) {
      providerCalls.push(context)
      if (streamOptions?.signal?.aborted) {
        const aborted = assistantMessage(abortFinalMessageId, [{ type: 'text', text: '' }], 'aborted', 'Aborted')
        return createProviderStream([
          { type: 'error', reason: 'aborted', error: aborted },
        ], aborted)
      }

      const toolResultIds = new Set(context.messages.flatMap((message) => {
        if (typeof message !== 'object' || message === null) return []
        if ((message as { role?: unknown }).role !== 'toolResult') return []
        const toolCallId = (message as { toolCallId?: unknown }).toolCallId
        return typeof toolCallId === 'string' ? [toolCallId] : []
      }))
      const sawAllToolResults = requestedToolCalls.every((toolCall) => toolResultIds.has(toolCall.id))

      if (sawAllToolResults) {
        const partial = assistantMessage(finalMessageId, [], 'stop')
        const final = assistantMessage(finalMessageId, [{ type: 'text', text: finalText }], 'stop')
        return createProviderStream([
          { type: 'start', partial },
          { type: 'text_delta', contentIndex: 0, delta: finalText, partial: final },
          { type: 'text_end', contentIndex: 0, content: finalText, partial: final },
          { type: 'done', reason: 'stop', message: final },
        ], final)
      }

      const partial = assistantMessage(assistantToolMessageId, [], 'toolUse')
      const final = assistantMessage(assistantToolMessageId, requestedToolCalls, 'toolUse')
      return createProviderStream([
        { type: 'start', partial },
        ...requestedToolCalls.map((toolCall, index) => ({ type: 'toolcall_end', contentIndex: index, toolCall, partial: final })),
        { type: 'done', reason: 'toolUse', message: final },
      ], final)
    },
  })

  const model = modelRegistry.find('boring-test', 'loop-model')
  expect(model).toBeDefined()

  const probeTool: ToolDefinition = {
    name: 'probe_tool',
    label: 'Probe tool',
    description: 'Records a probe query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    } as ToolDefinition['parameters'],
    async execute(toolCallId, params, signal, onUpdate) {
      toolCalls.push({ toolCallId, params: params as Record<string, unknown> })
      toolCallWaiters.splice(0).forEach((resolve) => resolve())
      if ((params as { query?: unknown }).query === 'wait-abort') {
        if (!signal) throw new Error('abort signal missing')
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        throw new Error('probe aborted')
      }
      if ((params as { query?: unknown }).query === 'fail') throw new Error('probe failed')
      onUpdate?.({ content: [{ type: 'text', text: 'probe progress' }], details: { phase: 'progress' } })
      return {
        content: [{ type: 'text', text: `probe result: ${String((params as { query?: unknown }).query)}` }],
        details: { phase: 'done' },
      }
    },
  }

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    authStorage,
    modelRegistry,
    model,
    noTools: 'builtin',
    customTools: [probeTool],
    resourceLoader: createEmptyResourceLoader(),
    sessionManager: SessionManager.inMemory(process.cwd()),
    thinkingLevel: 'off',
  })

  return {
    adapter: createPiAgentSessionAdapter(session, {
      ...(session.agent && typeof session.agent.continue === 'function'
        ? { continueQueuedFollowUp: () => session.agent!.continue() }
        : {}),
    }),
    providerCalls,
    toolCalls,
    waitForToolCall: () => toolCalls.length > 0 ? Promise.resolve() : new Promise<void>((resolve) => toolCallWaiters.push(resolve)),
  }
}

function createHarness(adapter: PiAgentSessionAdapter): AgentHarness & {
  getPiSessionAdapter: (input: SendMessageInput, ctx: RunContext) => Promise<PiAgentSessionAdapter>
} {
  return {
    id: 'real-pi-loop',
    placement: 'server',
    sessions: sessionStore,
    async *sendMessage() {},
    getPiSessionAdapter: vi.fn(async () => adapter),
  }
}

async function waitForEvents(events: PiChatEvent[], label: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const summary = events.map((event) => ({
    type: event.type,
    seq: event.seq,
    ...('role' in event ? { role: event.role } : {}),
    ...('status' in event ? { status: event.status } : {}),
    ...('messageId' in event ? { messageId: event.messageId } : {}),
    ...('text' in event ? { text: event.text } : {}),
    ...('kind' in event ? { kind: event.kind } : {}),
  }))
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(summary)}`)
}

async function waitForState(
  service: HarnessPiChatService,
  label: string,
  predicate: (state: Awaited<ReturnType<HarnessPiChatService['readState']>>) => boolean,
): Promise<Awaited<ReturnType<HarnessPiChatService['readState']>>> {
  const deadline = Date.now() + 1_000
  let latest = await service.readState(ctx, 's1')
  while (Date.now() < deadline) {
    latest = await service.readState(ctx, 's1')
    if (predicate(latest)) return latest
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({
    status: latest.status,
    messages: latest.messages.map((message) => ({
      id: message.id,
      role: message.role,
      status: message.status,
      parts: message.parts.map((part) => part.type),
    })),
  })}`)
}

describe('HarnessPiChatService real Pi loop', () => {
  it('projects Pi provider tool-use, tool result, and continued final text through the service', async () => {
    const { adapter, providerCalls, toolCalls } = await createRealPiAdapter()
    const harness = createHarness(adapter)
    const service = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: process.cwd(),
    })
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'run the probe',
      clientNonce: 'nonce-real-loop',
    })
    await waitForEvents(events, 'real Pi loop final text', () => events.some((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-final' &&
      event.kind === 'text' &&
      event.text === 'REAL_LOOP_DONE'
    ))

    expect(providerCalls).toHaveLength(2)
    expect(toolCalls).toEqual([{ toolCallId: 'tool-1', params: { query: 'status' } }])
    expect(events.filter((event) => event.type === 'tool-call')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'tool-result')).toHaveLength(1)

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message-start', role: 'user', text: 'run the probe', clientNonce: 'nonce-real-loop' }),
      expect.objectContaining({ type: 'tool-call', messageId: 'assistant-tool', toolCallId: 'tool-1', toolName: 'probe_tool' }),
      expect.objectContaining({ type: 'tool-result', messageId: 'assistant-tool', toolCallId: 'tool-1', isError: false }),
      expect.objectContaining({ type: 'message-delta', messageId: 'assistant-final', kind: 'text', delta: 'REAL_LOOP_DONE' }),
      expect.objectContaining({ type: 'message-part-end', messageId: 'assistant-final', kind: 'text', text: 'REAL_LOOP_DONE' }),
      expect.objectContaining({ type: 'agent-end', status: 'ok' }),
    ]))

    const toolCallIndex = events.findIndex((event) => event.type === 'tool-call')
    const toolResultIndex = events.findIndex((event) => event.type === 'tool-result')
    const finalTextIndex = events.findIndex((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-final' &&
      event.kind === 'text'
    )
    expect(toolCallIndex).toBeGreaterThan(-1)
    expect(toolResultIndex).toBeGreaterThan(toolCallIndex)
    expect(finalTextIndex).toBeGreaterThan(toolResultIndex)

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('projects failed Pi tool executions as errored tool results on the same assistant message', async () => {
    const { adapter, providerCalls, toolCalls } = await createRealPiAdapter({
      assistantToolMessageId: 'assistant-error',
      finalMessageId: 'assistant-after-error',
      finalText: 'ERROR_LOOP_DONE',
      requestedToolCalls: [requestedToolCall('tool-error', 'fail')],
    })
    const harness = createHarness(adapter)
    const service = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: process.cwd(),
    })
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'run the failing probe',
      clientNonce: 'nonce-real-loop-error',
    })
    await waitForEvents(events, 'failed real Pi tool loop final text', () => events.some((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-after-error' &&
      event.kind === 'text' &&
      event.text === 'ERROR_LOOP_DONE'
    ))

    expect(providerCalls).toHaveLength(2)
    expect(toolCalls).toEqual([{ toolCallId: 'tool-error', params: { query: 'fail' } }])
    const toolResults = events.filter((event) => event.type === 'tool-result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({
      type: 'tool-result',
      messageId: 'assistant-error',
      toolCallId: 'tool-error',
      isError: true,
      errorText: 'probe failed',
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-call', messageId: 'assistant-error', toolCallId: 'tool-error', toolName: 'probe_tool' }),
      expect.objectContaining({ type: 'message-part-end', messageId: 'assistant-after-error', kind: 'text', text: 'ERROR_LOOP_DONE' }),
      expect.objectContaining({ type: 'agent-end', status: 'ok' }),
    ]))
    const toolResultIndex = events.findIndex((event) => event.type === 'tool-result' && event.toolCallId === 'tool-error')
    const finalTextIndex = events.findIndex((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-after-error' &&
      event.kind === 'text'
    )
    expect(toolResultIndex).toBeGreaterThan(-1)
    expect(finalTextIndex).toBeGreaterThan(toolResultIndex)

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps multiple real Pi tool results attached to the requesting assistant message', async () => {
    const { adapter, providerCalls, toolCalls } = await createRealPiAdapter({
      assistantToolMessageId: 'assistant-tools',
      finalMessageId: 'assistant-after-tools',
      finalText: 'MULTI_LOOP_DONE',
      requestedToolCalls: [
        requestedToolCall('tool-1', 'status'),
        requestedToolCall('tool-2', 'config'),
      ],
    })
    const harness = createHarness(adapter)
    const service = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: process.cwd(),
    })
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'run both probes',
      clientNonce: 'nonce-real-loop-multi',
    })
    await waitForEvents(events, 'multi-tool real Pi loop final text', () => events.some((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-after-tools' &&
      event.kind === 'text' &&
      event.text === 'MULTI_LOOP_DONE'
    ))

    expect(providerCalls).toHaveLength(2)
    expect(toolCalls).toEqual(expect.arrayContaining([
      { toolCallId: 'tool-1', params: { query: 'status' } },
      { toolCallId: 'tool-2', params: { query: 'config' } },
    ]))
    expect(toolCalls).toHaveLength(2)

    const toolCallEvents = events.filter((event) => event.type === 'tool-call')
    const toolResultEvents = events.filter((event) => event.type === 'tool-result')
    expect(toolCallEvents).toHaveLength(2)
    expect(toolResultEvents).toHaveLength(2)
    expect(toolCallEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: 'assistant-tools', toolCallId: 'tool-1', toolName: 'probe_tool' }),
      expect.objectContaining({ messageId: 'assistant-tools', toolCallId: 'tool-2', toolName: 'probe_tool' }),
    ]))
    expect(toolResultEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: 'assistant-tools', toolCallId: 'tool-1', isError: false }),
      expect.objectContaining({ messageId: 'assistant-tools', toolCallId: 'tool-2', isError: false }),
    ]))

    const lastToolResultIndex = Math.max(...toolResultEvents.map((event) => events.indexOf(event)))
    const finalTextIndex = events.findIndex((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-after-tools' &&
      event.kind === 'text'
    )
    expect(finalTextIndex).toBeGreaterThan(lastToolResultIndex)

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('settles a real Pi tool result and aborts the turn when interrupted during tool execution', async () => {
    const { adapter, providerCalls, toolCalls, waitForToolCall } = await createRealPiAdapter({
      assistantToolMessageId: 'assistant-abort-tool',
      finalMessageId: 'assistant-after-abort',
      finalText: 'SHOULD_NOT_RENDER',
      requestedToolCalls: [requestedToolCall('tool-abort', 'wait-abort')],
    })
    const harness = createHarness(adapter)
    const service = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: process.cwd(),
    })
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const promptPromise = service.prompt(ctx, 's1', {
      message: 'run and interrupt the probe',
      clientNonce: 'nonce-real-loop-abort',
    })
    await waitForToolCall()

    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })
    await promptPromise
    await waitForEvents(events, 'interrupted real Pi tool abort', () => events.some((event) =>
      event.type === 'agent-end' &&
      event.status === 'aborted'
    ))

    expect(providerCalls).toHaveLength(2)
    expect(toolCalls).toEqual([{ toolCallId: 'tool-abort', params: { query: 'wait-abort' } }])
    const toolResults = events.filter((event) => event.type === 'tool-result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({
      type: 'tool-result',
      messageId: 'assistant-abort-tool',
      toolCallId: 'tool-abort',
      isError: true,
      errorText: 'probe aborted',
    })
    expect(events.some((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-after-abort' &&
      event.kind === 'text'
    )).toBe(false)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-call', messageId: 'assistant-abort-tool', toolCallId: 'tool-abort', toolName: 'probe_tool' }),
      expect.objectContaining({ type: 'agent-end', status: 'aborted' }),
    ]))

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps a queued follow-up through interrupt and posts it as the next real Pi turn', async () => {
    const queuedText = 'real loop queued after escape'
    const { adapter, providerCalls, toolCalls, waitForToolCall } = await createRealPiAdapter({
      assistantToolMessageId: 'assistant-escape-tool',
      finalMessageId: 'assistant-after-escape-queue',
      finalText: 'ESCAPE_QUEUE_LOOP_DONE',
      requestedToolCalls: [requestedToolCall('tool-escape', 'wait-abort')],
    })
    const harness = createHarness(adapter)
    const service = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: process.cwd(),
    })
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const promptPromise = service.prompt(ctx, 's1', {
      message: 'start then escape with queued follow-up',
      clientNonce: 'nonce-real-loop-escape-active',
    })
    await waitForToolCall()

    await service.followUp(ctx, 's1', {
      message: queuedText,
      clientNonce: 'nonce-real-loop-escape-queued',
      clientSeq: 7,
    })
    const queuedState = await service.readState(ctx, 's1')
    expect(queuedState.queue.followUps).toEqual([
      expect.objectContaining({
        displayText: queuedText,
        clientNonce: 'nonce-real-loop-escape-queued',
        clientSeq: 7,
      }),
    ])

    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })
    await promptPromise
    await waitForEvents(events, 'queued follow-up completion after interrupt', () => events.some((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-after-escape-queue' &&
      event.kind === 'text' &&
      event.text === 'ESCAPE_QUEUE_LOOP_DONE'
    ))

    expect(providerCalls).toHaveLength(3)
    expect(toolCalls).toEqual([{ toolCallId: 'tool-escape', params: { query: 'wait-abort' } }])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'queue-updated',
        queue: {
          followUps: [
            expect.objectContaining({
              displayText: queuedText,
              clientNonce: 'nonce-real-loop-escape-queued',
              clientSeq: 7,
            }),
          ],
        },
      }),
      expect.objectContaining({ type: 'agent-end', status: 'aborted' }),
      expect.objectContaining({
        type: 'message-start',
        role: 'user',
        text: queuedText,
        clientNonce: 'nonce-real-loop-escape-queued',
        clientSeq: 7,
      }),
      expect.objectContaining({
        type: 'message-part-end',
        messageId: 'assistant-after-escape-queue',
        kind: 'text',
        text: 'ESCAPE_QUEUE_LOOP_DONE',
      }),
      expect.objectContaining({ type: 'agent-end', status: 'ok' }),
    ]))

    const abortedIndex = events.findIndex((event) => event.type === 'agent-end' && event.status === 'aborted')
    const queuedUserIndex = events.findIndex((event) => event.type === 'message-start' && event.role === 'user' && event.text === queuedText)
    const finalTextIndex = events.findIndex((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-after-escape-queue' &&
      event.kind === 'text'
    )
    expect(abortedIndex).toBeGreaterThan(-1)
    expect(queuedUserIndex).toBeGreaterThan(abortedIndex)
    expect(finalTextIndex).toBeGreaterThan(queuedUserIndex)

    const finalState = await service.readState(ctx, 's1')
    expect(finalState.queue.followUps).toEqual([])
    expect(finalState.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        parts: expect.arrayContaining([expect.objectContaining({ type: 'text', text: queuedText })]),
      }),
      expect.objectContaining({
        role: 'assistant',
        parts: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'ESCAPE_QUEUE_LOOP_DONE' })]),
      }),
    ]))

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('clears queued follow-ups on Stop without auto-posting them after a real Pi tool abort', async () => {
    const firstQueuedText = 'real loop stop queued one'
    const secondQueuedText = 'real loop stop queued two'
    const { adapter, providerCalls, toolCalls, waitForToolCall } = await createRealPiAdapter({
      assistantToolMessageId: 'assistant-stop-tool',
      finalMessageId: 'assistant-after-stop',
      finalText: 'SHOULD_NOT_RENDER_AFTER_STOP',
      requestedToolCalls: [requestedToolCall('tool-stop', 'wait-abort')],
    })
    const harness = createHarness(adapter)
    const service = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: process.cwd(),
    })
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const promptPromise = service.prompt(ctx, 's1', {
      message: 'start then stop with queued follow-ups',
      clientNonce: 'nonce-real-loop-stop-active',
    })
    await waitForToolCall()

    await service.followUp(ctx, 's1', {
      message: firstQueuedText,
      clientNonce: 'nonce-real-loop-stop-queued-1',
      clientSeq: 8,
    })
    await service.followUp(ctx, 's1', {
      message: secondQueuedText,
      clientNonce: 'nonce-real-loop-stop-queued-2',
      clientSeq: 9,
    })
    const queuedState = await service.readState(ctx, 's1')
    expect(queuedState.queue.followUps.map((followUp) => followUp.displayText)).toEqual([
      firstQueuedText,
      secondQueuedText,
    ])

    const stop = await service.stop(ctx, 's1', {})
    expect(stop).toMatchObject({
      accepted: true,
      stopped: true,
      clearedQueue: [
        expect.objectContaining({ displayText: firstQueuedText }),
        expect.objectContaining({ displayText: secondQueuedText }),
      ],
    })
    await promptPromise
    await waitForEvents(events, 'stop abort event after queued clear', () => events.some((event) =>
      event.type === 'agent-end' &&
      event.status === 'aborted'
    ))

    expect(providerCalls).toHaveLength(2)
    expect(toolCalls).toEqual([{ toolCallId: 'tool-stop', params: { query: 'wait-abort' } }])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'queue-updated',
        queue: {
          followUps: [
            expect.objectContaining({
              displayText: firstQueuedText,
              clientNonce: 'nonce-real-loop-stop-queued-1',
              clientSeq: 8,
            }),
          ],
        },
      }),
      expect.objectContaining({
        type: 'queue-updated',
        queue: {
          followUps: [
            expect.objectContaining({ displayText: firstQueuedText }),
            expect.objectContaining({
              displayText: secondQueuedText,
              clientNonce: 'nonce-real-loop-stop-queued-2',
              clientSeq: 9,
            }),
          ],
        },
      }),
      expect.objectContaining({
        type: 'tool-result',
        messageId: 'assistant-stop-tool',
        toolCallId: 'tool-stop',
        isError: true,
        errorText: 'probe aborted',
      }),
      expect.objectContaining({ type: 'agent-end', status: 'aborted' }),
    ]))
    expect(events.some((event) =>
      event.type === 'message-start' &&
      event.role === 'user' &&
      (event.text === firstQueuedText || event.text === secondQueuedText)
    )).toBe(false)
    expect(events.some((event) =>
      event.type === 'message-part-end' &&
      event.messageId === 'assistant-after-stop' &&
      event.kind === 'text'
    )).toBe(false)

    const finalState = await service.readState(ctx, 's1')
    expect(finalState.queue.followUps).toEqual([])
    expect(finalState.messages.some((message) =>
      message.role === 'user' &&
      message.parts.some((part) => part.type === 'text' && (
        part.text === firstQueuedText ||
        part.text === secondQueuedText
      ))
    )).toBe(false)
    expect(finalState.messages.flatMap((message) => message.parts).some((part) =>
      part.type === 'text' &&
      part.text === 'SHOULD_NOT_RENDER_AFTER_STOP'
    )).toBe(false)

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('hydrates a completed real Pi tool result from fresh service state after reload', async () => {
    const { adapter } = await createRealPiAdapter({
      assistantToolMessageId: 'assistant-reload-tool',
      finalMessageId: 'assistant-after-reload-tool',
      finalText: 'RELOAD_LOOP_DONE',
      requestedToolCalls: [requestedToolCall('tool-reload', 'status')],
    })
    const harness = createHarness(adapter)
    const service = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: process.cwd(),
    })
    await service.prompt(ctx, 's1', {
      message: 'run then reload',
      clientNonce: 'nonce-real-loop-reload',
    })
    await waitForState(service, 'completed real Pi loop before reload', (state) =>
      state.status === 'idle' &&
      state.messages.some((message) =>
        message.id === 'assistant-after-reload-tool' &&
        message.parts.some((part) => part.type === 'text' && part.text === 'RELOAD_LOOP_DONE')
      )
    )

    // This simulates browser/service reload over the same live Pi session. It
    // does not prove JSONL cold-restart persistence.
    const reloadedService = new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: process.cwd(),
    })
    const state = await reloadedService.readState(ctx, 's1')

    expect(state.status).toBe('idle')
    expect(state.queue.followUps).toEqual([])
    expect(state.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(state.messages.map((message) => message.id)).toContain('assistant-reload-tool')
    expect(state.messages.map((message) => message.id)).toContain('assistant-after-reload-tool')

    const assistantTool = state.messages.find((message) => message.id === 'assistant-reload-tool')
    expect(assistantTool).toMatchObject({
      role: 'assistant',
      status: 'done',
      parts: [
        {
          type: 'tool-call',
          id: 'tool-reload',
          toolName: 'probe_tool',
          state: 'output-available',
          input: { query: 'status' },
          output: {
            content: [{ type: 'text', text: 'probe result: status' }],
            details: { phase: 'done' },
          },
        },
      ],
    })

    const finalAssistant = state.messages.find((message) => message.id === 'assistant-after-reload-tool')
    expect(finalAssistant).toMatchObject({
      role: 'assistant',
      status: 'done',
      parts: [{ type: 'text', text: 'RELOAD_LOOP_DONE' }],
    })
    expect(state.messages.flatMap((message) => message.parts).filter((part) => part.type === 'tool-call')).toHaveLength(1)
  })
})
