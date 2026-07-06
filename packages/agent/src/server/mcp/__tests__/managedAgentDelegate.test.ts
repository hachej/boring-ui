import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MANAGED_AGENT_MCP_DELIVERY_RULE,
  MANAGED_AGENT_MCP_ORIGIN_SURFACE,
  ManagedAgentMcpError,
  createManagedAgentMcpDelegateController,
  createManagedAgentMcpHttpHandler,
  type ManagedAgentMcpDelegateOptions,
} from '../index'
import type {
  Agent,
  AgentEvent,
  AgentReadiness,
  AgentResolveInputResponse,
  AgentSendInput,
  AgentStartReceipt,
  AgentStreamOptions,
} from '../../../shared/events'
import { ErrorCode, type ErrorCode as StableErrorCode } from '../../../shared/error-codes'
import type { SessionCtx, SessionDetail, SessionListOptions, SessionStore, SessionSummary } from '../../../shared/session'

const CTX: SessionCtx = { workspaceId: 'workspace-1', userId: 'user-1' }

const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  while (servers.length) await servers.pop()!.close()
})

describe('ManagedAgentMcpDelegateController', () => {
  it('starts one host-tenanted agent session per delegation and returns the amended delivery payload', async () => {
    const agent = new FakeAgent()
    const progressMessages: string[] = []
    const controller = createManagedAgentMcpDelegateController(options(agent, {
      collectArtifacts: async () => [{
        path: 'reports/final.md',
        mediaType: 'text/markdown',
        title: 'Final report',
        content: '# Final report\nDone.',
      }],
    }))

    const first = await controller.delegateTask({
      brief: 'write the report',
      onProgress: (progress) => {
        progressMessages.push(progress.message)
      },
    })
    const second = await controller.delegateTask({ brief: 'write another report' })

    expect(agent.starts).toHaveLength(2)
    expect(agent.starts.map((start) => start.sessionId)).toEqual([undefined, undefined])
    expect(agent.starts.map((start) => start.ctx)).toEqual([CTX, CTX])
    expect(agent.starts.map((start) => start.originSurface)).toEqual([
      MANAGED_AGENT_MCP_ORIGIN_SURFACE,
      MANAGED_AGENT_MCP_ORIGIN_SURFACE,
    ])
    expect(first).toEqual({
      delegationId: 'delegation-1',
      status: 'completed',
      finalAssistantText: 'Final answer',
      artifacts: [{
        path: 'reports/final.md',
        mediaType: 'text/markdown',
        title: 'Final report',
        content: '# Final report\nDone.',
      }],
      deliveryRule: MANAGED_AGENT_MCP_DELIVERY_RULE,
    })
    expect(second.delegationId).toBe('delegation-2')
    expect(first).not.toHaveProperty('shareUrl')
    expect(first).not.toHaveProperty('shareLink')
    expect(JSON.stringify(first)).not.toMatch(/\/share\//i)
    expect(progressMessages).toContain('Agent turn started.')
  })

  it('exposes redacted polling status while a delegation is running', async () => {
    const gate = deferred<void>()
    const agent = new FakeAgent({ gate })
    const controller = createManagedAgentMcpDelegateController(options(agent))
    const running = controller.delegateTask({ brief: 'slow brief' })

    await agent.waitForStreamStart()
    const status = await waitForStatus(controller, 'delegation-1', CTX, (current) => current.eventCount > 0)
    expect(status.status).toBe('running')
    expect(status.eventCount).toBeGreaterThan(0)
    expect(status.progress.map((progress) => progress.message)).toContain('Agent turn started.')

    gate.resolve()
    await expect(running).resolves.toMatchObject({
      delegationId: 'delegation-1',
      status: 'completed',
      finalAssistantText: 'Final answer',
    })
    expect(controller.getStatus('delegation-1', CTX).status).toBe('completed')
  })

  it('expires terminal delegation records after the configured retention window', async () => {
    let now = new Date('2026-07-06T00:00:00.000Z')
    const controller = createManagedAgentMcpDelegateController(options(new FakeAgent(), {
      now: () => now,
      terminalRetentionMs: 1,
    }))

    await controller.delegateTask({ brief: 'short-lived status' })
    expect(controller.getStatus('delegation-1', CTX).status).toBe('completed')

    now = new Date('2026-07-06T00:00:00.001Z')
    expect(() => controller.getStatus('delegation-1', CTX)).toThrow(ManagedAgentMcpError)
    try {
      controller.getStatus('delegation-1', CTX)
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND })
    }
  })

  it('rejects new starts instead of evicting running delegations when capacity is full', async () => {
    const gate = deferred<void>()
    const agent = new FakeAgent({ gate })
    const controller = createManagedAgentMcpDelegateController(options(agent, {
      maxDelegations: 1,
    }))
    const first = controller.delegateTask({ brief: 'first slow task' })

    await agent.waitForStreamStart()
    await expect(controller.delegateTask({ brief: 'second slow task' })).rejects.toMatchObject({
      code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
      message: 'too many running delegated tasks',
    })
    expect(controller.getStatus('delegation-1', CTX).status).toBe('running')

    gate.resolve()
    await expect(first).resolves.toMatchObject({ delegationId: 'delegation-1', status: 'completed' })
  })

  it('returns stable errors for unknown delegation ids', () => {
    const controller = createManagedAgentMcpDelegateController(options(new FakeAgent()))

    expect(() => controller.getStatus('missing', CTX)).toThrow(ManagedAgentMcpError)
    try {
      controller.getStatus('missing', CTX)
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND, message: 'delegation not found' })
    }
  })

  it('does not expose status across SessionCtx boundaries', async () => {
    const controller = createManagedAgentMcpDelegateController(options(new FakeAgent()))
    await controller.delegateTask({ brief: 'scoped brief' })

    expect(() => controller.getStatus('delegation-1', { workspaceId: 'workspace-2', userId: 'user-1' })).toThrow(ManagedAgentMcpError)
    try {
      controller.getStatus('delegation-1', { workspaceId: 'workspace-2', userId: 'user-1' })
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND, message: 'delegation not found' })
    }
  })

  it('reports non-ok agent terminal events as failed delegations', async () => {
    const controller = createManagedAgentMcpDelegateController(options(new FakeAgent({ terminalStatus: 'error' })))

    await expect(controller.delegateTask({ brief: 'failing brief' })).rejects.toMatchObject({
      code: ErrorCode.enum.INTERNAL_ERROR,
      message: 'agent turn failed',
    })
    expect(controller.getStatus('delegation-1', CTX)).toMatchObject({
      status: 'error',
      error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'agent turn failed' },
    })
  })

  it('does not expose raw agent stream error messages on failed turns', async () => {
    const controller = createManagedAgentMcpDelegateController(options(new FakeAgent({
      terminalStatus: 'error',
      streamError: {
        code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
        message: 'provider failed while reading /srv/private/tool-token',
      },
    })))

    await expect(controller.delegateTask({ brief: 'failing brief' })).rejects.toMatchObject({
      code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
      message: 'agent turn failed',
    })
    const status = controller.getStatus('delegation-1', CTX)
    expect(status.error).toEqual({
      code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
      message: 'agent turn failed',
    })
    expect(JSON.stringify(status)).not.toContain('/srv/private/tool-token')
  })

  it('stops the delegated session when the MCP request is cancelled', async () => {
    const gate = deferred<void>()
    const abort = new AbortController()
    const agent = new FakeAgent({ gate })
    const controller = createManagedAgentMcpDelegateController(options(agent))
    const running = controller.delegateTask({ brief: 'cancel me', signal: abort.signal })

    await agent.waitForStreamStart()
    abort.abort()
    gate.resolve()

    await expect(running).rejects.toMatchObject({ code: ErrorCode.enum.ABORTED })
    expect(agent.stops).toEqual([{ sessionId: 'session-1', ctx: CTX }])
  })

  it('does not create an unreachable delegation when cancelled before tenancy resolves', async () => {
    const ctxGate = deferred<SessionCtx>()
    const abort = new AbortController()
    const agent = new FakeAgent()
    const controller = createManagedAgentMcpDelegateController(options(agent, {
      resolveSessionCtx: async () => ctxGate.promise,
    }))
    const running = controller.delegateTask({ brief: 'cancel before tenancy', signal: abort.signal })

    abort.abort()
    ctxGate.resolve(CTX)

    await expect(running).rejects.toMatchObject({ code: ErrorCode.enum.ABORTED })
    expect(agent.starts).toHaveLength(0)
    expect(() => controller.getStatus('delegation-1', CTX)).toThrow(ManagedAgentMcpError)
  })

  it('blocks configured secret canaries from caller-visible results', async () => {
    const agent = new FakeAgent({ finalText: 'contains SECRET_CANARY' })
    const controller = createManagedAgentMcpDelegateController(options(agent, {
      redactionCanaries: ['SECRET_CANARY'],
    }))

    await expect(controller.delegateTask({ brief: 'leak check' })).rejects.toMatchObject({
      code: ErrorCode.enum.INTERNAL_ERROR,
      message: 'MCP delegate payload failed secret redaction guard',
    })
    const status = controller.getStatus('delegation-1', CTX)
    expect(JSON.stringify(status)).not.toContain('SECRET_CANARY')
  })

  it('redacts configured secret canaries from progress before notification or polling exposure', async () => {
    const progressMessages: string[] = []
    const controller = createManagedAgentMcpDelegateController(options(new FakeAgent({
      toolName: 'SECRET_CANARY_tool',
    }), {
      redactionCanaries: ['SECRET_CANARY'],
    }))

    await controller.delegateTask({
      brief: 'progress leak check',
      onProgress: (progress) => {
        progressMessages.push(progress.message)
      },
    })

    expect(progressMessages).toContain('Agent progress updated.')
    expect(progressMessages.join('\n')).not.toContain('SECRET_CANARY')
    expect(JSON.stringify(controller.getStatus('delegation-1', CTX))).not.toContain('SECRET_CANARY')
  })

  it('rejects host configurations that do not resolve real workspace tenancy', async () => {
    const controller = createManagedAgentMcpDelegateController({
      ...options(new FakeAgent()),
      resolveSessionCtx: () => ({}),
    })

    await expect(controller.delegateTask({ brief: 'brief' })).rejects.toMatchObject({
      code: ErrorCode.enum.CONFIG_INVALID,
    })
    expect(() => controller.getStatus('delegation-1', CTX)).toThrow(ManagedAgentMcpError)
    try {
      controller.getStatus('delegation-1', CTX)
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND })
    }
  })

  it('redacts status tenancy resolver errors before returning them to MCP callers', async () => {
    const controller = createManagedAgentMcpDelegateController({
      ...options(new FakeAgent()),
      redactionCanaries: ['SECRET_CANARY'],
      resolveSessionCtx: () => {
        throw new Error('auth backend leaked SECRET_CANARY')
      },
    })

    await expect(controller.getStatusForRequest('delegation-1', {})).rejects.toMatchObject({
      code: ErrorCode.enum.INTERNAL_ERROR,
      message: 'MCP delegate task failed',
    })
  })

  it('does not expose unknown host error messages to MCP callers', async () => {
    const controller = createManagedAgentMcpDelegateController(options(new FakeAgent(), {
      collectArtifacts: async () => {
        throw new Error('host filesystem failed at /srv/private/token-store')
      },
    }))

    await expect(controller.delegateTask({ brief: 'host error' })).rejects.toMatchObject({
      code: ErrorCode.enum.INTERNAL_ERROR,
      message: 'MCP delegate task failed',
    })
    const status = controller.getStatus('delegation-1', CTX)
    expect(status.error).toEqual({
      code: ErrorCode.enum.INTERNAL_ERROR,
      message: 'MCP delegate task failed',
    })
    expect(JSON.stringify(status)).not.toContain('/srv/private/token-store')
  })
})

describe('createManagedAgentMcpHttpHandler', () => {
  it('serves delegate_task to a stock MCP Streamable HTTP client', async () => {
    const agent = new FakeAgent()
    const handler = createManagedAgentMcpHttpHandler(options(agent, {
      collectArtifacts: async () => [{ path: 'out/result.md', content: 'Final artifact' }],
    }))
    const endpoint = await listen(handler)
    const client = new Client({ name: 'managed-agent-test-client', version: '0.0.0-test' })

    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    const result = await client.callTool({ name: 'delegate_task', arguments: { brief: 'make a result' } })
    await client.close()

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      delegationId: 'delegation-1',
      status: 'completed',
      finalAssistantText: 'Final answer',
      artifacts: [{ path: 'out/result.md', content: 'Final artifact' }],
      deliveryRule: MANAGED_AGENT_MCP_DELIVERY_RULE,
    })
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/shareUrl|shareLink|\/share\//i)
  })

  it('serves delegate_task_start and delegate_task_status to a stock MCP Streamable HTTP client', async () => {
    const gate = deferred<void>()
    const agent = new FakeAgent({ gate })
    const handler = createManagedAgentMcpHttpHandler(options(agent))
    const endpoint = await listen(handler)
    const client = new Client({ name: 'managed-agent-test-client', version: '0.0.0-test' })

    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    const started = await client.callTool({ name: 'delegate_task_start', arguments: { brief: 'make a slow result' } })
    expect(started.isError).not.toBe(true)
    expect(started.structuredContent).toMatchObject({
      delegationId: 'delegation-1',
      status: 'running',
    })

    const running = await client.callTool({ name: 'delegate_task_status', arguments: { delegationId: 'delegation-1' } })
    expect(running.isError).not.toBe(true)
    expect(running.structuredContent).toMatchObject({
      delegationId: 'delegation-1',
      status: 'running',
    })

    gate.resolve()
    const completed = await waitForClientStatus(client, 'delegation-1', (status) => status.status === 'completed')
    await client.close()

    expect(completed).toMatchObject({
      delegationId: 'delegation-1',
      status: 'completed',
      result: {
        finalAssistantText: 'Final answer',
        deliveryRule: MANAGED_AGENT_MCP_DELIVERY_RULE,
      },
    })
    expect(JSON.stringify(completed)).not.toMatch(/shareUrl|shareLink|\/share\//i)
  })

  it('uses the configured brief length limit in the MCP input schema', async () => {
    const agent = new FakeAgent()
    const handler = createManagedAgentMcpHttpHandler(options(agent, {
      maxBriefChars: 12_005,
    }))
    const endpoint = await listen(handler)
    const client = new Client({ name: 'managed-agent-test-client', version: '0.0.0-test' })

    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    const result = await client.callTool({ name: 'delegate_task', arguments: { brief: 'x'.repeat(12_001) } })
    await client.close()

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      delegationId: 'delegation-1',
      status: 'completed',
      finalAssistantText: 'Final answer',
    })
  })
})

function options(
  agent: Agent,
  overrides: Partial<ManagedAgentMcpDelegateOptions> = {},
): ManagedAgentMcpDelegateOptions {
  let ids = 0
  return {
    agent,
    createDelegationId: () => {
      ids += 1
      return `delegation-${ids}`
    },
    now: () => new Date('2026-07-06T00:00:00.000Z'),
    resolveSessionCtx: () => CTX,
    ...overrides,
  }
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, parsedBody?: unknown) => Promise<void>,
): Promise<string> {
  const server = createServer(async (req, res) => {
    const body = await readJson(req)
    await handler(req, res, body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  servers.push({
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  })
  return `http://127.0.0.1:${port}/mcp`
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function event(eventIndex: number, chunk: AgentEvent['chunk']): AgentEvent {
  return {
    v: 1,
    eventIndex,
    timestamp: Date.parse('2026-07-06T00:00:00.000Z') + eventIndex,
    sessionId: 'session-1',
    chunk,
  }
}

class FakeAgent implements Agent {
  readonly starts: AgentSendInput[] = []
  readonly stops: Array<{ sessionId: string; ctx?: SessionCtx }> = []
  readonly sessions: SessionStore = new FakeSessionStore()
  readonly readiness: AgentReadiness = { requirements: [], status: async () => [] }
  private streamStarted = deferred<void>()
  private created = 0

  constructor(
    private readonly options: {
      finalText?: string
      gate?: Deferred<void>
      streamError?: { code: StableErrorCode; message: string }
      terminalStatus?: 'ok' | 'aborted' | 'error'
      toolName?: string
    } = {},
  ) {}

  async start(input: AgentSendInput): Promise<AgentStartReceipt> {
    this.starts.push(input)
    this.created += 1
    return { sessionId: `session-${this.created}`, startIndex: 0 }
  }

  async *stream(sessionId: string, _options: AgentStreamOptions): AsyncIterable<AgentEvent> {
    this.streamStarted.resolve()
    yield { ...event(0, { type: 'agent-start', seq: 0, turnId: 'turn-1' }), sessionId }
    yield {
      ...event(1, {
        type: 'message-start',
        seq: 1,
        messageId: 'a1',
        role: 'assistant',
      }),
      sessionId,
    }
    await this.options.gate?.promise
    let nextEventIndex = 2
    if (this.options.streamError) {
      yield {
        ...event(nextEventIndex, {
          type: 'error',
          seq: nextEventIndex,
          error: this.options.streamError,
        }),
        sessionId,
      }
      nextEventIndex += 1
    }
    if (this.options.toolName) {
      yield {
        ...event(nextEventIndex, {
          type: 'tool-call',
          seq: nextEventIndex,
          messageId: 'a1',
          toolCallId: 'tool-1',
          toolName: this.options.toolName,
          input: {},
        }),
        sessionId,
      }
      nextEventIndex += 1
    }
    yield {
      ...event(nextEventIndex, {
        type: 'message-end',
        seq: nextEventIndex,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [{ type: 'text', text: this.options.finalText ?? 'Final answer' }],
        },
      }),
      sessionId,
    }
    nextEventIndex += 1
    yield {
      ...event(nextEventIndex, {
        type: 'agent-end',
        seq: nextEventIndex,
        turnId: 'turn-1',
        status: this.options.terminalStatus ?? 'ok',
      }),
      sessionId,
    }
  }

  async *send(input: AgentSendInput): AsyncIterable<AgentEvent> {
    const receipt = await this.start(input)
    yield* this.stream(receipt.sessionId, { startIndex: receipt.startIndex, ctx: input.ctx })
  }

  async resolveInput(_sessionId: string, _requestId: string, _response: AgentResolveInputResponse): Promise<never> {
    throw new Error('not implemented') as never
  }

  async interrupt(): Promise<unknown> {
    return undefined
  }

  async stop(sessionId: string, ctx?: SessionCtx): Promise<unknown> {
    this.stops.push({ sessionId, ctx })
    return undefined
  }

  async dispose(): Promise<void> {}

  waitForStreamStart(): Promise<void> {
    return this.streamStarted.promise
  }
}

class FakeSessionStore implements SessionStore {
  async list(_ctx: SessionCtx, _options?: SessionListOptions): Promise<SessionSummary[]> {
    return []
  }

  async create(_ctx: SessionCtx): Promise<SessionSummary> {
    return summary('session')
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    return summary(sessionId)
  }

  async delete(): Promise<void> {}
}

function summary(id: string): SessionSummary {
  return {
    id,
    title: id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    turnCount: 0,
  }
}

async function waitForStatus(
  controller: ReturnType<typeof createManagedAgentMcpDelegateController>,
  delegationId: string,
  ctx: SessionCtx,
  predicate: (status: ReturnType<typeof controller.getStatus>) => boolean,
): Promise<ReturnType<typeof controller.getStatus>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = controller.getStatus(delegationId, ctx)
    if (predicate(status)) return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return controller.getStatus(delegationId, ctx)
}

async function waitForClientStatus(
  client: Client,
  delegationId: string,
  predicate: (status: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await client.callTool({ name: 'delegate_task_status', arguments: { delegationId } })
    const status = result.structuredContent as Record<string, unknown>
    if (predicate(status)) return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const result = await client.callTool({ name: 'delegate_task_status', arguments: { delegationId } })
  return result.structuredContent as Record<string, unknown>
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
