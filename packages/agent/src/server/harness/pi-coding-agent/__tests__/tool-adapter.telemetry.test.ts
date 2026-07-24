import { describe, expect, it, vi, beforeEach } from 'vitest'

const { createdCustomTools, promptGate } = vi.hoisted(() => {
  const createdCustomTools: Array<{ execute: (...args: any[]) => Promise<unknown> }> = []
  let resolvePrompts: Array<() => void> = []
  let releaseToolCalls: Array<() => void> = []
  let toolCallDone: Array<Promise<void>> = []
  return {
    createdCustomTools,
    promptGate: {
      reset() {
        resolvePrompts = []
        releaseToolCalls = []
        toolCallDone = []
      },
      wait() {
        return new Promise<void>((resolve) => { resolvePrompts.push(resolve) })
      },
      resolve() {
        resolvePrompts.shift()?.()
      },
      waitForToolCall() {
        let release!: () => void
        const released = new Promise<void>((resolve) => { release = resolve })
        let done!: () => void
        const completed = new Promise<void>((resolve) => { done = resolve })
        releaseToolCalls.push(release)
        toolCallDone.push(completed)
        return { released, done }
      },
      releaseToolCall() {
        const release = releaseToolCalls.shift()
        const completed = toolCallDone.shift()
        if (!release || !completed) throw new Error('no pending tool call')
        release()
        return completed
      },
    },
  }
})

vi.mock('@mariozechner/pi-coding-agent', () => {
  let loaderSeq = 0
  return {
  createAgentSession: vi.fn(async (config: { customTools?: Array<{ execute: (...args: any[]) => Promise<unknown> }> }) => {
    createdCustomTools.splice(0, createdCustomTools.length, ...(config.customTools ?? []))
    const subscribers: Array<(event: any) => void> = []
    const followUpMessages: Array<{ role: 'user'; content: Array<{ type: 'text'; text: string }>; timestamp: number }> = []
    const emit = (event: any) => {
      for (const subscriber of subscribers) subscriber(event)
    }
    const agent = {
      followUpQueue: { messages: followUpMessages },
      followUp: vi.fn((message: { role: 'user'; content: Array<{ type: 'text'; text: string }>; timestamp: number }) => {
        followUpMessages.push(message)
      }),
      clearFollowUpQueue: vi.fn(() => { followUpMessages.length = 0 }),
    }
    const session = {
      state: {},
      messages: [],
      isStreaming: false,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 0,
      followUpMode: 'one-at-a-time' as const,
      sessionId: 'native-session',
      agent,
      _emitQueueUpdate: vi.fn(),
      getSteeringMessages: () => [],
      getFollowUpMessages: () => followUpMessages.map((message) => message.content.map((part) => part.text).join('')),
      subscribe: vi.fn((listener: (event: any) => void) => {
        subscribers.push(listener)
        return () => {
          const index = subscribers.indexOf(listener)
          if (index >= 0) subscribers.splice(index, 1)
        }
      }),
      prompt: vi.fn(async () => {
        const toolCall = promptGate.waitForToolCall()
        await toolCall.released
        await createdCustomTools[0]?.execute('prompt-tool-call', {}, undefined, undefined, {} as never)
        toolCall.done()
        await promptGate.wait()
        const followUp = followUpMessages.shift()
        if (followUp) {
          emit({ type: 'message_start', message: followUp })
          const followUpToolCall = promptGate.waitForToolCall()
          await followUpToolCall.released
          await createdCustomTools[0]?.execute('follow-up-tool-call', {}, undefined, undefined, {} as never)
          followUpToolCall.done()
          await promptGate.wait()
          emit({ type: 'agent_end', messages: [] })
        }
      }),
      followUp: vi.fn(async (text: string) => {
        agent.followUp({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() })
      }),
      abort: vi.fn(async () => {}),
      dispose: vi.fn(),
      reload: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setThinkingLevel: vi.fn(),
      extensionRunner: {
        getCommand: vi.fn(() => undefined),
        createCommandContext: vi.fn(() => ({})),
      },
      get systemPrompt() { return 'mock prompt' },
      get model() { return undefined },
    }
    return { session }
  }),
  SessionManager: {
    create: () => ({ getSessionFile: () => null, getSessionId: () => 'native-session' }),
    open: () => ({ getSessionFile: () => null, getSessionId: () => 'native-session' }),
  },
  AuthStorage: { create: () => ({}) },
  ModelRegistry: { create: () => ({ find: vi.fn(), getAvailable: () => [], registerProvider: vi.fn() }) },
  DefaultResourceLoader: class {
    private readonly commandName = `cmd-${++loaderSeq}`
    async reload() {}
    getSkills() { return { diagnostics: [] } }
    getExtensions() { return { runtime: { getCommands: () => [{ name: this.commandName, source: 'extension' }] }, errors: [] } }
  },
  SettingsManager: { create: () => ({ getDefaultProvider: () => undefined, getDefaultModel: () => undefined }) },
  getAgentDir: () => '/tmp/mock-agent-dir',
  loadSkills: () => ({ skills: [], diagnostics: [] }),
  }
})

import { ErrorCode } from '../../../../shared/error-codes'
import type { RunContext } from '../../../../shared/harness'
import type { AgentTool, ToolExecContext } from '../../../../shared/tool'
import type { TelemetryEvent, TelemetrySink } from '../../../../shared/telemetry'
import { createPiCodingAgentHarness } from '../createHarness'
import { adaptToolForPi, unmarkToolResultErrorDetails } from '../tool-adapter'

function createTelemetryRecorder(): { telemetry: TelemetrySink; events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = []
  return {
    events,
    telemetry: {
      capture(event) {
        events.push(event)
      },
    },
  }
}

function createTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'bash',
    description: 'test tool',
    parameters: {},
    async execute() {
      return { content: [{ type: 'text', text: 'ok output' }] }
    },
    ...overrides,
  }
}

async function executeAdapted(tool: AgentTool, telemetry: TelemetrySink) {
  const adapted = adaptToolForPi(tool, 'sess-tool', telemetry)
  return await adapted.execute(
    'tool-call-1',
    { command: 'cat .env', path: '/tmp/private-path' },
    new AbortController().signal,
    undefined,
    {} as never,
  )
}

function makeRunContext(userId: string): RunContext {
  return {
    abortSignal: new AbortController().signal,
    workdir: '/tmp/test-workspace',
    workspaceId: 'workspace-a',
    userId,
    userEmail: `${userId}@example.com`,
    userEmailVerified: true,
    requestId: `req-${userId}`,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  createdCustomTools.length = 0
  promptGate.reset()
})

describe('tool adapter telemetry', () => {
  it('forwards sequential execution and only immutable opted-in current-run details', async () => {
    const operation = { kind: 'boring.handover.operation', wireVersion: 1, operation: { action: 'remove', artifactId: 'old' } }
    const entries = [
      { type: 'message', id: 'old-user', message: { role: 'user' } },
      { type: 'message', id: 'old-result', message: { role: 'toolResult', details: operation } },
      { type: 'message', id: 'user-1', message: { role: 'user' } },
      { type: 'message', id: 'secret', message: { role: 'toolResult', details: { kind: 'secret.result', token: 'hidden' } } },
      { type: 'message', id: 'operation', message: { role: 'toolResult', toolName: 'manage_handover', details: operation } },
    ]
    let seenDetails: ToolExecContext['currentRunStructuredDetails']
    const adapted = adaptToolForPi(createTool({
      executionMode: 'sequential',
      currentRunDetailKinds: ['boring.handover.operation'],
      async execute(_params, context) {
        seenDetails = context.currentRunStructuredDetails
        return { content: [{ type: 'text', text: 'ok' }] }
      },
    }), 'sess-tool')

    expect(adapted.executionMode).toBe('sequential')
    await adapted.execute('call', {}, undefined, undefined, {
      sessionManager: { getBranch: () => entries },
    } as never)
    expect(seenDetails).toEqual([{ entryId: 'operation', toolName: 'manage_handover', kind: 'boring.handover.operation', detail: operation }])
    expect(seenDetails?.[0]?.detail).not.toBe(operation)
    expect(Object.isFrozen(seenDetails)).toBe(true)
    expect(Object.isFrozen(seenDetails?.[0]?.detail)).toBe(true)
  })

  it('emits safe agent.tool.completed telemetry without args or output', async () => {
    const recorder = createTelemetryRecorder()

    await executeAdapted(createTool(), recorder.telemetry)

    expect(recorder.events).toHaveLength(1)
    expect(recorder.events[0]).toEqual({
      name: 'agent.tool.completed',
      properties: {
        toolName: 'bash',
        sessionId: 'sess-tool',
        status: 'ok',
        durationMs: expect.any(Number),
      },
    })
    const serialized = JSON.stringify(recorder.events)
    expect(serialized).not.toContain('cat .env')
    expect(serialized).not.toContain('private-path')
    expect(serialized).not.toContain('ok output')
  })

  it('emits safe agent.tool.failed telemetry for tool error results', async () => {
    const recorder = createTelemetryRecorder()
    const tool = createTool({
      async execute() {
        return {
          isError: true,
          content: [{ type: 'text', text: 'secret stderr output' }],
          details: { code: ErrorCode.enum.TOOL_EXECUTION_ERROR, command: 'cat .env' },
        }
      },
    })

    const result = await executeAdapted(tool, recorder.telemetry)
    const unmarked = unmarkToolResultErrorDetails(result.details)

    expect(result.content).toEqual([{ type: 'text', text: 'secret stderr output' }])
    expect(unmarked).toEqual({
      isMarked: true,
      details: { code: ErrorCode.enum.TOOL_EXECUTION_ERROR, command: 'cat .env' },
    })

    expect(recorder.events).toHaveLength(1)
    expect(recorder.events[0]).toEqual({
      name: 'agent.tool.failed',
      properties: {
        toolName: 'bash',
        sessionId: 'sess-tool',
        status: 'error',
        durationMs: expect.any(Number),
        errorCode: ErrorCode.enum.TOOL_EXECUTION_ERROR,
      },
    })
    const serialized = JSON.stringify(recorder.events)
    expect(serialized).not.toContain('secret stderr output')
    expect(serialized).not.toContain('cat .env')
  })

  it('emits safe agent.tool.failed telemetry for thrown tool errors', async () => {
    const recorder = createTelemetryRecorder()
    const tool = createTool({
      async execute() {
        throw new Error('raw stack /tmp/private-path secret')
      },
    })

    await expect(executeAdapted(tool, recorder.telemetry)).rejects.toThrow('raw stack')

    expect(recorder.events).toHaveLength(1)
    expect(recorder.events[0]).toEqual({
      name: 'agent.tool.failed',
      properties: {
        toolName: 'bash',
        sessionId: 'sess-tool',
        status: 'error',
        durationMs: expect.any(Number),
        errorCode: ErrorCode.enum.TOOL_EXECUTION_ERROR,
      },
    })
    expect(JSON.stringify(recorder.events)).not.toContain('private-path')
  })

  it('keeps in-flight run identity stable across read-only lookups and queued follow-ups', async () => {
    const seenContexts: Array<{
      userId?: string
      userEmail?: string
      userEmailVerified?: boolean
      workspaceId?: string
      requestId?: string
    }> = []
    const tool = createTool({
      async execute(_params, ctx) {
        seenContexts.push({
          userId: ctx.userId,
          userEmail: ctx.userEmail,
          userEmailVerified: ctx.userEmailVerified,
          workspaceId: ctx.workspaceId,
          requestId: ctx.requestId,
        })
        return { content: [{ type: 'text', text: ctx.userId ?? 'missing' }] }
      },
    })
    const harness = createPiCodingAgentHarness({ tools: [tool], cwd: '/tmp/test-workspace' })
    const userA = makeRunContext('alpha')
    const userB = makeRunContext('beta')

    const adapterA = await harness.getPiSessionAdapter({ sessionId: 'sess-tool', message: 'start' }, userA)
    const promptPromiseA = adapterA.prompt('start')
    await Promise.resolve()

    const adapterB = await harness.getPiSessionAdapter({ sessionId: 'sess-tool', message: '' }, userB)
    adapterB.readSnapshot()
    await adapterB.followUp('follow beta')

    await promptGate.releaseToolCall()
    promptGate.resolve()
    await Promise.resolve()
    await promptGate.releaseToolCall()
    promptGate.resolve()
    await promptPromiseA

    expect(seenContexts).toEqual([
      {
        userId: 'alpha',
        userEmail: 'alpha@example.com',
        userEmailVerified: true,
        workspaceId: 'workspace-a',
        requestId: 'req-alpha',
      },
      {
        userId: 'beta',
        userEmail: 'beta@example.com',
        userEmailVerified: true,
        workspaceId: 'workspace-a',
        requestId: 'req-beta',
      },
    ])
  })

  it('uses the authoritative Pi ID for native-first tool context and telemetry', async () => {
    const recorder = createTelemetryRecorder()
    const sessionIds: Array<string | undefined> = []
    const tool = createTool({
      async execute(_params, context) {
        sessionIds.push(context.sessionId)
        return { content: [{ type: 'text', text: 'ok' }] }
      },
    })
    const harness = createPiCodingAgentHarness({
      tools: [tool],
      cwd: '/tmp/test-workspace',
      sessionRoot: '/tmp/test-native-tool-session',
      nativeSessionStartEnabled: true,
      telemetry: recorder.telemetry,
    })
    const created = await harness.createNativePiSessionAdapter?.({ message: 'start' }, makeRunContext('alpha'))
    expect(created?.sessionId).toBe('native-session')

    const prompt = created?.adapter.prompt('start')
    await Promise.resolve()
    await promptGate.releaseToolCall()
    promptGate.resolve()
    await prompt

    expect(sessionIds).toEqual(['native-session'])
    expect(recorder.events).toContainEqual(expect.objectContaining({
      name: 'agent.tool.completed',
      properties: expect.objectContaining({ sessionId: 'native-session' }),
    }))
  })

  it('scopes slash command sessions by run context', async () => {
    const harness = createPiCodingAgentHarness({ tools: [createTool()], cwd: '/tmp/test-workspace' })
    const commandsA = await harness.getSlashCommands?.('sess-command', makeRunContext('alpha'))
    const commandsB = await harness.getSlashCommands?.('sess-command', makeRunContext('beta'))

    expect(commandsA?.[0]?.name).toMatch(/^cmd-/)
    expect(commandsB?.[0]?.name).toMatch(/^cmd-/)
    expect(commandsB?.[0]?.name).not.toBe(commandsA?.[0]?.name)
  })

  it('keeps duplicate follow-up contexts aligned after selective clear', async () => {
    const seenUsers: Array<string | undefined> = []
    const tool = createTool({
      async execute(_params, ctx) {
        seenUsers.push(ctx.userId)
        return { content: [{ type: 'text', text: ctx.userId ?? 'missing' }] }
      },
    })
    const harness = createPiCodingAgentHarness({ tools: [tool], cwd: '/tmp/test-workspace' })
    const adapterA = await harness.getPiSessionAdapter({ sessionId: 'sess-tool', message: 'start' }, makeRunContext('alpha'))
    const promptPromiseA = adapterA.prompt('start')
    await Promise.resolve()

    const adapterB = await harness.getPiSessionAdapter({ sessionId: 'sess-tool', message: '' }, makeRunContext('beta'))
    const adapterC = await harness.getPiSessionAdapter({ sessionId: 'sess-tool', message: '' }, makeRunContext('gamma'))
    await adapterB.followUp('same text', { clientNonce: 'nonce-beta' })
    await adapterC.followUp('same text', { clientNonce: 'nonce-gamma' })
    adapterB.clearFollowUp({ clientNonce: 'nonce-beta' })

    await promptGate.releaseToolCall()
    promptGate.resolve()
    await Promise.resolve()
    await promptGate.releaseToolCall()
    promptGate.resolve()
    await promptPromiseA

    expect(seenUsers).toEqual(['alpha', 'gamma'])
  })

  it('telemetry sink failures do not change tool behavior', async () => {
    const result = await executeAdapted(createTool(), {
      capture() {
        throw new Error('telemetry down')
      },
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: 'ok output' }],
      details: undefined,
    })
  })
})
