import type { FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../shared/error-codes'
import type { AgentGateway, AgentSessionEvent, AuthorizedAgentScope } from '../../shared'
import {
  assertWorkspaceAgentDispatcherRequestContext,
  createBoundWorkspaceAgentDispatcher,
} from '../workspaceAgentDispatcher'

const CTX = { workspaceId: 'workspace-1', userId: 'user-1' }
const scope = { workspaceScopeId: 'workspace-1', authSubjectId: 'user-1' } as AuthorizedAgentScope

function createFakeGateway(): AgentGateway & {
  createSession: ReturnType<typeof vi.fn>
  connectSession: ReturnType<typeof vi.fn>
  sends: unknown[]
} {
  const sends: unknown[] = []
  const events: AgentSessionEvent[] = [
    { ref: { agentTypeId: 'default', sessionId: 'session-1' }, seq: 1, event: { type: 'agent-start', seq: 1, turnId: 'turn-1' } },
    { ref: { agentTypeId: 'default', sessionId: 'session-1' }, seq: 2, event: { type: 'agent-end', seq: 2, turnId: 'turn-1', status: 'ok' } },
  ]
  const createSession = vi.fn(async () => ({ agentTypeId: 'default', sessionId: 'session-1' }))
  const connectSession = vi.fn(async ({ ref }: { ref: { agentTypeId: string; sessionId: string } }) => ({
    ref,
    events: (async function* () { yield* events.map((event) => ({ ...event, ref })) })(),
    async send(input: unknown) {
      sends.push(input)
      return { accepted: true as const, cursor: 1, disposition: 'prompt' as const, clientNonce: (input as { clientNonce: string }).clientNonce }
    },
    async interrupt() { return { accepted: true as const, cursor: 2 } },
    async stop() { return { accepted: true as const, cursor: 2, stopped: true, clearedQueue: [] } },
    async clearQueue() { return { accepted: true as const, cursor: 2, cleared: 0 } },
    async close() {},
  }))
  return {
    sends,
    createSession,
    connectSession,
    async listAgents() { return [] },
    async listSessions() { return { sessions: [] } },
    async readSessionState() { throw new Error('not implemented') },
    async renameSession() { throw new Error('not implemented') },
    async setSessionArchived() { throw new Error('not implemented') },
    async deleteSession() {},
    async close() {},
  }
}

describe('workspace agent dispatcher', () => {
  it('uses addressed Gateway operations and returns the durable dispatch receipt before events', async () => {
    const gateway = createFakeGateway()
    const dispatcher = createBoundWorkspaceAgentDispatcher({ gateway, scope, agentTypeId: 'default' }, CTX)

    const dispatched = await dispatcher.dispatch!({
      requestId: 'run-1',
      title: 'Automation Daily summary: run this',
      content: 'run this',
      model: { provider: 'test', id: 'gpt-5.5' },
    })
    expect(dispatched).toMatchObject({
      ref: { agentTypeId: 'default', sessionId: 'session-1' },
      receipt: { accepted: true, disposition: 'prompt', clientNonce: 'run-1' },
    })
    expect(gateway.createSession).toHaveBeenCalledWith(expect.objectContaining({
      scope,
      agentTypeId: 'default',
      requestId: 'run-1',
      title: 'Automation Daily summary: run this',
    }))
    expect(gateway.sends).toEqual([expect.objectContaining({ kind: 'prompt', requestId: 'run-1', clientNonce: 'run-1' })])

    const received = []
    for await (const item of dispatched.events) received.push(item)
    expect(received.map((item) => [item.sessionId, item.chunk.type])).toEqual([
      ['session-1', 'agent-start'],
      ['session-1', 'agent-end'],
    ])
  })

  it('addresses follow-ups to an existing session and serializes Gateway admission', async () => {
    const gateway = createFakeGateway()
    const dispatcher = createBoundWorkspaceAgentDispatcher({ gateway, scope, agentTypeId: 'default' }, CTX)
    const first = dispatcher.dispatch!({ requestId: 'follow-1', sessionId: 'shared', content: 'one', kind: 'followup', clientSeq: 1 })
    const second = dispatcher.dispatch!({ requestId: 'follow-2', sessionId: 'shared', content: 'two', kind: 'followup', clientSeq: 2 })
    await Promise.all([first, second])

    expect(gateway.createSession).not.toHaveBeenCalled()
    expect(gateway.connectSession).toHaveBeenCalledTimes(2)
    expect(gateway.sends).toEqual([
      expect.objectContaining({ kind: 'followup', requestId: 'follow-1', clientSeq: 1 }),
      expect.objectContaining({ kind: 'followup', requestId: 'follow-2', clientSeq: 2 }),
    ])
  })

  it('uses addressed control operations and returns typed receipts', async () => {
    const gateway = createFakeGateway()
    const dispatcher = createBoundWorkspaceAgentDispatcher({ gateway, scope, agentTypeId: 'default' }, CTX)
    await expect(dispatcher.interrupt('session-1')).resolves.toEqual({ accepted: true, cursor: 2 })
    await expect(dispatcher.stop('session-1')).resolves.toEqual({ accepted: true, cursor: 2, stopped: true, clearedQueue: [] })
  })

  it('fails closed when a supplied request belongs to another workspace', () => {
    const request = { workspaceContext: { workspaceId: 'workspace-2', authenticated: true } } as FastifyRequest
    expect(() => assertWorkspaceAgentDispatcherRequestContext(CTX, request)).toThrow(expect.objectContaining({ code: ErrorCode.enum.UNAUTHORIZED }))
  })

  it('fails closed when trusted workspace or user context is unavailable', () => {
    const gateway = createFakeGateway()
    expect(() => createBoundWorkspaceAgentDispatcher({ gateway, scope, agentTypeId: 'default' }, { workspaceId: ' ', userId: 'user-1' })).toThrow(expect.objectContaining({ code: ErrorCode.enum.WORKSPACE_UNINITIALIZED }))
    expect(() => createBoundWorkspaceAgentDispatcher({ gateway, scope, agentTypeId: 'default' }, { workspaceId: 'workspace-1', userId: ' ' })).toThrow(expect.objectContaining({ code: ErrorCode.enum.UNAUTHORIZED }))
  })
})
