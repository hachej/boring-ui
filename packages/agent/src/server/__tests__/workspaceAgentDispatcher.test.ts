import type { FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../shared/error-codes'
import type { Agent, AgentEvent, AgentSendInput, AgentStartReceipt, AgentStreamOptions, AgentResolveInputResponse } from '../../shared/events'
import type { SessionCtx, SessionStore } from '../../shared/session'
import {
  assertWorkspaceAgentDispatcherRequestContext,
  createBoundWorkspaceAgentDispatcher,
} from '../workspaceAgentDispatcher'

const CTX = { workspaceId: 'workspace-1', userId: 'user-1' }

function event(index: number, chunk: AgentEvent['chunk']): AgentEvent {
  return {
    v: 1,
    eventIndex: index,
    timestamp: 1_800_000_000_000 + index,
    sessionId: 'session-1',
    chunk,
  }
}

describe('workspace agent dispatcher', () => {
  it('injects trusted context, forwards model, streams all chunks, and returns typed control receipts', async () => {
    const streamed = [
      event(0, { type: 'tool-call', seq: 1, messageId: 'm1', toolCallId: 't1', toolName: 'read', input: { path: 'README.md' } }),
      event(1, { type: 'tool-result', seq: 2, messageId: 'm1', toolCallId: 't1', output: { ok: true } }),
      event(2, { type: 'usage', seq: 3, usage: { inputTokens: 1, outputTokens: 2 } }),
      event(3, { type: 'agent-end', seq: 4, turnId: 'turn-1', status: 'ok' }),
    ]
    const agent = createFakeAgent(streamed)
    const dispatcher = createBoundWorkspaceAgentDispatcher(agent, CTX)

    const received = []
    for await (const item of dispatcher.send({
      content: 'run this',
      model: { provider: 'test', id: 'gpt-5.5' },
    })) {
      received.push(item)
    }

    expect(received).toEqual(streamed)
    expect(agent.send).toHaveBeenCalledWith({
      content: 'run this',
      model: { provider: 'test', id: 'gpt-5.5' },
      ctx: CTX,
    })
    await expect(dispatcher.interrupt('session-1')).resolves.toEqual({ accepted: true, cursor: 4 })
    await expect(dispatcher.stop('session-1')).resolves.toEqual({ accepted: true, cursor: 5, stopped: true, clearedQueue: [] })
    expect(agent.interrupt).toHaveBeenCalledWith('session-1', CTX)
    expect(agent.stop).toHaveBeenCalledWith('session-1', CTX)
  })

  it('rejects malformed interrupt and stop receipts with a stable error', async () => {
    const malformedInterruptAgent = createFakeAgent([])
    vi.mocked(malformedInterruptAgent.interrupt).mockResolvedValue({ accepted: false } as never)
    await expect(createBoundWorkspaceAgentDispatcher(malformedInterruptAgent, CTX).interrupt('session-1')).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_CONTROL_RECEIPT_INVALID,
    })

    const malformedStopAgent = createFakeAgent([])
    vi.mocked(malformedStopAgent.stop).mockResolvedValue({ accepted: true, cursor: 1, stopped: true } as never)
    await expect(createBoundWorkspaceAgentDispatcher(malformedStopAgent, CTX).stop('session-1')).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_CONTROL_RECEIPT_INVALID,
    })
  })

  it('fails closed when a supplied request belongs to another workspace', () => {
    const request = {
      workspaceContext: { workspaceId: 'workspace-2', authenticated: true },
    } as FastifyRequest

    expect(() => assertWorkspaceAgentDispatcherRequestContext(CTX, request)).toThrow(expect.objectContaining({
      code: ErrorCode.enum.UNAUTHORIZED,
    }))
  })

  it('fails closed when trusted workspace or user context is unavailable', () => {
    const agent = createFakeAgent([])
    expect(() => createBoundWorkspaceAgentDispatcher(agent, { workspaceId: ' ', userId: 'user-1' })).toThrow(expect.objectContaining({
      code: ErrorCode.enum.WORKSPACE_UNINITIALIZED,
    }))
    expect(() => createBoundWorkspaceAgentDispatcher(agent, { workspaceId: 'workspace-1', userId: ' ' })).toThrow(expect.objectContaining({
      code: ErrorCode.enum.UNAUTHORIZED,
    }))
  })
})

function createFakeAgent(events: AgentEvent[]): Agent & {
  send: ReturnType<typeof vi.fn<(input: AgentSendInput) => AsyncIterable<AgentEvent>>>
  interrupt: ReturnType<typeof vi.fn<(sessionId: string, ctx?: SessionCtx) => Promise<{ accepted: true; cursor: number }>>>
  stop: ReturnType<typeof vi.fn<(sessionId: string, ctx?: SessionCtx) => Promise<{ accepted: true; cursor: number; stopped: boolean; clearedQueue: [] }>>>
} {
  const send = vi.fn((_input: AgentSendInput) => (async function* () {
    yield* events
  })())
  const interrupt = vi.fn(async () => ({ accepted: true as const, cursor: 4 }))
  const stop = vi.fn(async (): Promise<{ accepted: true; cursor: number; stopped: boolean; clearedQueue: [] }> => ({
    accepted: true,
    cursor: 5,
    stopped: true,
    clearedQueue: [],
  }))
  return {
    start: async (): Promise<AgentStartReceipt> => ({ sessionId: 'session-1', startIndex: 0 }),
    stream(_sessionId: string, _options: AgentStreamOptions): AsyncIterable<AgentEvent> {
      return (async function* () { yield* events })()
    },
    send,
    async resolveInput(_sessionId: string, _requestId: string, _response: AgentResolveInputResponse): Promise<never> {
      throw new Error('not implemented')
    },
    interrupt,
    stop,
    sessions: {} as SessionStore,
    readiness: { requirements: [], async status() { return [] } },
    async dispose() {},
  }
}
