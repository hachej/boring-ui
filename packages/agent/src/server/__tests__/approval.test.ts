import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { createAgentRuntimeBridge } from '../createAgent'
import { SqliteEventStreamStore } from '../events/eventStreamStore'
import { openDatabase, type OpenDatabaseResult } from '../events/sqlStorage'
import { MemoryPendingInputStore } from '../events/pendingRequests'
import { HarnessPiChatService } from '../pi-chat/harnessPiChatService'
import type { AgentHarness, AgentHarnessFactoryInput, AgentSendInput, RunContext } from '../../shared/harness'
import type { AgentEvent } from '../../shared/events'
import type { SessionCtx, SessionDetail, SessionStore, SessionSummary } from '../../shared/session'
import type { AgentTool, ToolExecContext } from '../../shared/tool'
import type { PiAgentPromptInput, PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../pi-chat/PiAgentSessionAdapter'
import { ErrorCode } from '../../shared/error-codes'

const CTX = { workspaceId: 'workspace-a', userId: 'user-a' }

const databases: OpenDatabaseResult[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.db.close()
})

describe('approval inputs', () => {
  it('parks a needsApproval tool, publishes the request, and resumes from another subscriber', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const eventStore = new SqliteEventStreamStore(database.sql, database.runTransaction)
    const pendingInputs = new MemoryPendingInputStore()
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('approve', CTX)
    let executed = 0

    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => {
        executed += 1
        return { content: [{ type: 'text', text: 'approved-output' }] }
      })],
    }, {
      service: { eventStore, pendingInputs, workdir: '/workspace' },
    })

    const first = bridge.agent.stream('approve', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await bridge.agent.start({ sessionId: 'approve', content: 'run approved tool', ctx: CTX })
    const request = await nextEventOfType(first, 'data-approval-request')
    expect(request.chunk).toMatchObject({
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-1',
    })
    expect(executed).toBe(0)

    const runtime = await bridge.getRuntime()
    const state = await (runtime.service as HarnessPiChatService).readState({
      workspaceId: CTX.workspaceId,
      authSubject: CTX.userId,
      requestId: 'test',
    }, 'approve')
    expect(state.status).toBe('waiting')
    expect(state.seq).toBe(request.chunk.seq)
    const toolPart = state.messages.flatMap((message) => message.parts).find((part) => part.type === 'tool-call')
    expect(toolPart).toMatchObject({
      state: 'approval-requested',
      approvalRequestId: request.chunk.requestId,
    })

    const pending = await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'approve' })
    expect(pending).toEqual([expect.objectContaining({
      sessionId: 'approve',
      requestId: request.chunk.requestId,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-1',
    })])
    expect(JSON.stringify(pending)).not.toContain('SUPER_SECRET')

    const second = bridge.agent.stream('approve', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    const replayed = await nextEventOfType(second, 'data-approval-request')
    expect(replayed.chunk.requestId).toBe(request.chunk.requestId)

    await bridge.agent.resolveInput('approve', request.chunk.requestId, { kind: 'approval', decision: 'approve' }, CTX)
    const resolved = await nextEventOfType(first, 'data-approval-resolved')
    expect(resolved.chunk).toMatchObject({ requestId: request.chunk.requestId, decision: 'approve' })
    const result = await nextEventOfType(first, 'tool-result')
    expect(result.chunk.isError).toBe(false)
    expect(executed).toBe(1)
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'approve' })).toEqual([])

    await first.return?.()
    await second.return?.()
    await bridge.agent.dispose()
  })

  it('denies a parked approval without executing the underlying tool', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const eventStore = new SqliteEventStreamStore(database.sql, database.runTransaction)
    const pendingInputs = new MemoryPendingInputStore()
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('deny', CTX)
    let executed = 0

    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => {
        executed += 1
        return { content: [{ type: 'text', text: 'should-not-run' }] }
      })],
    }, {
      service: { eventStore, pendingInputs, workdir: '/workspace' },
    })

    const stream = bridge.agent.stream('deny', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await bridge.agent.start({ sessionId: 'deny', content: 'run denied tool', ctx: CTX })
    const request = await nextEventOfType(stream, 'data-approval-request')

    await bridge.agent.resolveInput('deny', request.chunk.requestId, {
      kind: 'approval',
      decision: 'deny',
      reason: 'not now',
    }, CTX)
    const result = await nextEventOfType(stream, 'tool-result')
    expect(result.chunk).toMatchObject({
      toolCallId: 'tool-1',
      isError: true,
    })
    expect(executed).toBe(0)
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'deny' })).toEqual([])

    await stream.return?.()
    await bridge.agent.dispose()
  })

  it('executes stored params before seeding an approved recovered request', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const eventStore = new SqliteEventStreamStore(database.sql, database.runTransaction)
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered',
      requestId: 'recover-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered',
      auth: { userEmail: 'approver@example.com', userEmailVerified: true },
      payload: { params: { secret: 'RECOVERED_SECRET' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('recovered', CTX)
    let executedParams: Record<string, unknown> | undefined
    let executedCtx: ToolExecContext | undefined

    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async (params, ctx) => {
        executedParams = params
        executedCtx = ctx
        return {
          content: [{ type: 'text', text: `ran:${params.secret}` }],
          details: { fileChanges: [{ op: 'write', path: 'approved.txt' }] },
        }
      })],
    }, {
      service: { eventStore, pendingInputs, workdir: '/workspace' },
    })

    const stream = bridge.agent.stream('recovered', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await bridge.agent.resolveInput('recovered', 'recover-1', { kind: 'approval', decision: 'approve' }, CTX)
    await waitUntil(() => fake.seeded.length === 1)
    const fileChanged = await nextEventOfType(stream, 'file-changed')
    expect(fileChanged.chunk).toMatchObject({ path: 'approved.txt', changeType: 'write' })
    const result = await nextEventOfType(stream, 'tool-result')
    expect(result.chunk).toMatchObject({
      toolCallId: 'tool-recovered',
      output: {
        content: [{ type: 'text', text: 'ran:RECOVERED_SECRET' }],
        details: { fileChanges: [{ op: 'write', path: 'approved.txt' }] },
      },
    })

    expect(executedParams).toEqual({ secret: 'RECOVERED_SECRET' })
    expect(executedCtx).toMatchObject({
      userEmail: 'approver@example.com',
      userEmailVerified: true,
    })
    expect(fake.seeded).toEqual([expect.objectContaining({
      request: expect.objectContaining({ requestId: 'recover-1', toolCallId: 'tool-recovered' }),
      response: { kind: 'approval', decision: 'approve' },
      toolResult: {
        content: [{ type: 'text', text: 'ran:RECOVERED_SECRET' }],
        details: { fileChanges: [{ op: 'write', path: 'approved.txt' }] },
      },
    })])
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'recovered' })).toEqual([])
    await stream.return?.()
    await bridge.agent.dispose()
  })

  it('accepts recovered approval resolution before a long-running tool finishes', async () => {
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered-slow',
      requestId: 'recover-slow-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered-slow',
      payload: { params: { secret: 'SLOW_SECRET' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('recovered-slow', CTX)
    const toolStarted = deferred<void>()
    const toolGate = deferred<Awaited<ReturnType<AgentTool['execute']>>>()

    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => {
        toolStarted.resolve()
        return toolGate.promise
      })],
    }, {
      service: { pendingInputs, workdir: '/workspace' },
    })

    const resolved = await nextOrTimeout(
      bridge.agent.resolveInput('recovered-slow', 'recover-slow-1', { kind: 'approval', decision: 'approve' }, CTX).then(() => 'resolved' as const),
      100,
    )

    expect(resolved).toBe('resolved')
    await nextOrTimeout(toolStarted.promise, 1_000)
    expect(fake.seeded).toEqual([])

    toolGate.resolve({ content: [{ type: 'text', text: 'slow-result' }] })
    await waitUntil(() => fake.seeded.length === 1)
    expect(fake.calls).toContain('seed')
    expect(fake.seeded[0]).toMatchObject({
      request: expect.objectContaining({ requestId: 'recover-slow-1' }),
      toolResult: { content: [{ type: 'text', text: 'slow-result' }] },
    })
    await bridge.agent.dispose()
  })

  it('consumes recovered approvals atomically under concurrent resolves', async () => {
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered-race',
      requestId: 'recover-race-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered-race',
      payload: { params: { secret: 'RACE_SECRET' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('recovered-race', CTX)
    let executed = 0
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => {
        executed += 1
        return { content: [{ type: 'text', text: 'race-result' }] }
      })],
    }, {
      service: { pendingInputs, workdir: '/workspace' },
    })

    const results = await Promise.allSettled([
      bridge.agent.resolveInput('recovered-race', 'recover-race-1', { kind: 'approval', decision: 'approve' }, CTX),
      bridge.agent.resolveInput('recovered-race', 'recover-race-1', { kind: 'approval', decision: 'approve' }, CTX),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await waitUntil(() => fake.seeded.length === 1)
    expect(executed).toBe(1)
    expect(await pendingInputs.list(CTX, { sessionId: 'recovered-race' })).toEqual([])
    await bridge.agent.dispose()
  })

  it('aborts recovered approved tool execution when the session is deleted', async () => {
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered-abort',
      requestId: 'recover-abort-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered-abort',
      payload: { params: { secret: 'ABORT_SECRET' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('recovered-abort', CTX)
    const toolStarted = deferred<void>()
    const toolAborted = deferred<void>()
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async (_params, ctx) => {
        toolStarted.resolve()
        return new Promise((_, reject) => {
          ctx.abortSignal.addEventListener('abort', () => {
            toolAborted.resolve()
            reject(new Error('aborted'))
          }, { once: true })
        })
      })],
    }, {
      service: { pendingInputs, workdir: '/workspace' },
    })

    await bridge.agent.resolveInput('recovered-abort', 'recover-abort-1', { kind: 'approval', decision: 'approve' }, CTX)
    await nextOrTimeout(toolStarted.promise, 1_000)
    await bridge.agent.sessions.delete(CTX, 'recovered-abort')
    await nextOrTimeout(toolAborted.promise, 1_000)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(fake.seeded).toEqual([])
    await bridge.agent.dispose()
  })

  it('stop clears a recovered pending approval and publishes an aborted resolution', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const eventStore = new SqliteEventStreamStore(database.sql, database.runTransaction)
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered-stop',
      requestId: 'recover-stop-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered-stop',
      payload: { params: { secret: 'STOP_SECRET' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('recovered-stop', CTX)
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => ({ content: [{ type: 'text', text: 'unused' }] }))],
    }, {
      service: { eventStore, pendingInputs, workdir: '/workspace' },
    })

    const stream = bridge.agent.stream('recovered-stop', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await bridge.agent.stop('recovered-stop', CTX)

    const resolved = await nextEventOfType(stream, 'data-approval-resolved')
    expect(resolved.chunk).toMatchObject({
      requestId: 'recover-stop-1',
      decision: 'deny',
    })
    const result = await nextEventOfType(stream, 'tool-result')
    expect(result.chunk).toMatchObject({
      toolCallId: 'tool-recovered-stop',
      isError: true,
    })
    expect(fake.seeded).toEqual([expect.objectContaining({
      request: expect.objectContaining({ requestId: 'recover-stop-1' }),
      response: { kind: 'approval', decision: 'deny', reason: 'aborted' },
      toolResult: expect.objectContaining({ isError: true }),
    })])
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'recovered-stop' })).toEqual([])
    const runtime = await bridge.getRuntime()
    const state = await (runtime.service as HarnessPiChatService).readState({
      workspaceId: CTX.workspaceId,
      authSubject: CTX.userId,
      requestId: 'test',
    }, 'recovered-stop')
    expect(state.status).toBe('idle')

    await stream.return?.()
    await bridge.agent.dispose()
  })

  it('restores recovered pending approvals without executing when recovery support is unavailable', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const eventStore = new SqliteEventStreamStore(database.sql, database.runTransaction)
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered-unavailable',
      requestId: 'recover-unavailable-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered-unavailable',
      payload: { params: { secret: 'UNAVAILABLE_SECRET' } },
    })
    const fake = createApprovalHarnessFactory({ noSeed: true })
    fake.sessions.seed('recovered-unavailable', CTX)
    let executed = 0
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => {
        executed += 1
        return { content: [{ type: 'text', text: 'should-not-run' }] }
      })],
    }, {
      service: { eventStore, pendingInputs, workdir: '/workspace' },
    })

    const stream = bridge.agent.stream('recovered-unavailable', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await bridge.agent.resolveInput('recovered-unavailable', 'recover-unavailable-1', { kind: 'approval', decision: 'approve' }, CTX)

    const restored = await nextEventOfType(stream, 'data-approval-request')
    expect(restored.chunk).toMatchObject({ requestId: 'recover-unavailable-1' })
    const error = await nextEventOfType(stream, 'error')
    expect(error.chunk.error.message).toBe('resolved input recovery is unavailable')
    await waitUntil(async () => (await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'recovered-unavailable' })).length === 1)
    expect(executed).toBe(0)
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'recovered-unavailable' })).toEqual([
      expect.objectContaining({ requestId: 'recover-unavailable-1' }),
    ])

    await stream.return?.()
    await bridge.agent.dispose()
  })

  it('aborts recovered approved tool execution when the bridge is disposed', async () => {
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered-dispose',
      requestId: 'recover-dispose-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered-dispose',
      payload: { params: { secret: 'DISPOSE_SECRET' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('recovered-dispose', CTX)
    const toolStarted = deferred<void>()
    const toolAborted = deferred<void>()
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async (_params, ctx) => {
        toolStarted.resolve()
        return new Promise((_, reject) => {
          ctx.abortSignal.addEventListener('abort', () => {
            toolAborted.resolve()
            reject(new Error('aborted'))
          }, { once: true })
        })
      })],
    }, {
      service: { pendingInputs, workdir: '/workspace' },
    })

    await bridge.agent.resolveInput('recovered-dispose', 'recover-dispose-1', { kind: 'approval', decision: 'approve' }, CTX)
    await nextOrTimeout(toolStarted.promise, 1_000)
    await bridge.agent.dispose()
    await nextOrTimeout(toolAborted.promise, 1_000)

    expect(fake.seeded).toEqual([])
  })

  it('does not restore recovered pending approvals after a tool result is produced', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const eventStore = new SqliteEventStreamStore(database.sql, database.runTransaction)
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered-fail',
      requestId: 'recover-fail-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered-fail',
      payload: { params: { secret: 'FAIL_SECRET' } },
    })
    const fake = createApprovalHarnessFactory({ failSeed: true })
    fake.sessions.seed('recovered-fail', CTX)
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => ({ content: [{ type: 'text', text: 'result-before-seed-failure' }] }))],
    }, {
      service: { eventStore, pendingInputs, workdir: '/workspace' },
    })

    const stream = bridge.agent.stream('recovered-fail', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await bridge.agent.resolveInput('recovered-fail', 'recover-fail-1', { kind: 'approval', decision: 'approve' }, CTX)

    const error = await nextEventOfType(stream, 'error')
    expect(error.chunk.error.message).toBe('seed failed')
    await waitUntil(async () => (await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'recovered-fail' })).length === 0)
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'recovered-fail' })).toEqual([])

    await stream.return?.()
    await bridge.agent.dispose()
  })

  it('fails closed when metering rejects a recovered continuation', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const eventStore = new SqliteEventStreamStore(database.sql, database.runTransaction)
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'recovered-metering',
      requestId: 'recover-metering-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-recovered-metering',
      payload: { params: { secret: 'METER_SECRET' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('recovered-metering', CTX)
    const metering = {
      isEnabled: () => true,
      reserveRun: vi.fn(async () => {
        throw new Error('credits exhausted')
      }),
      recordUsage: vi.fn(async () => ({ billedMicros: 0 })),
      settleRun: vi.fn(async () => {}),
      releaseRun: vi.fn(async () => {}),
    }
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      metering,
      tools: [approvalTool(async () => ({ content: [{ type: 'text', text: 'metered-result' }] }))],
    }, {
      service: { eventStore, pendingInputs, workdir: '/workspace' },
    })

    const stream = bridge.agent.stream('recovered-metering', { startIndex: 0, ctx: CTX })[Symbol.asyncIterator]()
    await bridge.agent.resolveInput('recovered-metering', 'recover-metering-1', { kind: 'approval', decision: 'approve' }, CTX)

    const error = await nextEventOfType(stream, 'error')
    expect(error.chunk.error.message).toBe('credits exhausted')
    expect(metering.reserveRun).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'recovered-metering',
      runId: 'pi-run:recovered-metering:prompt:resolved-input:recover-metering-1',
    }))
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'recovered-metering' })).toEqual([])

    await stream.return?.()
    await bridge.agent.dispose()
  })

  it('rejects mismatched response kinds without consuming the pending request', async () => {
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'mismatch',
      requestId: 'mismatch-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-mismatch',
      payload: { params: { secret: 'STILL_PENDING' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('mismatch', CTX)
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => ({ content: [{ type: 'text', text: 'unused' }] }))],
    }, {
      service: { pendingInputs, workdir: '/workspace' },
    })

    await expect(bridge.agent.resolveInput('mismatch', 'mismatch-1', {
      kind: 'input',
      values: { answer: 'wrong kind' },
    }, CTX)).rejects.toMatchObject({
      code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
    })
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'mismatch' })).toEqual([
      expect.objectContaining({ requestId: 'mismatch-1' }),
    ])
    await bridge.agent.dispose()
  })

  it('rejects resolveInput from a different session context without consuming the request', async () => {
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'wrong-ctx',
      requestId: 'wrong-ctx-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-wrong-ctx',
      payload: { params: { secret: 'CTX_SECRET' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('wrong-ctx', CTX)
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => ({ content: [{ type: 'text', text: 'unused' }] }))],
    }, {
      service: { pendingInputs, workdir: '/workspace' },
    })

    await expect(bridge.agent.resolveInput('wrong-ctx', 'wrong-ctx-1', {
      kind: 'approval',
      decision: 'approve',
    }, { workspaceId: 'workspace-b', userId: 'user-b' })).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
    expect(await bridge.agent.sessions.pendingInputs(CTX, { sessionId: 'wrong-ctx' })).toEqual([
      expect.objectContaining({ requestId: 'wrong-ctx-1' }),
    ])
    await bridge.agent.dispose()
  })

  it('clears durable pending approvals when deleting a session', async () => {
    const pendingInputs = new MemoryPendingInputStore()
    await pendingInputs.create({
      sessionId: 'delete-pending',
      requestId: 'delete-pending-1',
      ctx: CTX,
      kind: 'approval',
      toolName: 'sensitive_tool',
      toolCallId: 'tool-delete-pending',
      payload: { params: { secret: 'DELETE_ME' } },
    })
    const fake = createApprovalHarnessFactory()
    fake.sessions.seed('delete-pending', CTX)
    const bridge = createAgentRuntimeBridge({
      runtime: 'none',
      harnessFactory: fake.factory,
      sessions: fake.sessions,
      tools: [approvalTool(async () => ({ content: [{ type: 'text', text: 'unused' }] }))],
    }, {
      service: { pendingInputs, workdir: '/workspace' },
    })

    await bridge.agent.sessions.delete(CTX, 'delete-pending')

    expect(await pendingInputs.list(CTX, { sessionId: 'delete-pending' })).toEqual([])
    await bridge.agent.dispose()
  })
})

function approvalTool(execute: AgentTool['execute']): AgentTool {
  return {
    name: 'sensitive_tool',
    description: 'Needs approval before execution.',
    needsApproval: true,
    parameters: { type: 'object' },
    execute,
  }
}

function createApprovalHarnessFactory(options: { failSeed?: boolean; noSeed?: boolean } = {}) {
  const sessions = new MemorySessionStore()
  const seeded: Array<{ request: unknown; response: unknown; toolResult?: unknown }> = []
  const calls: string[] = []
  let tools: AgentTool[] = []
  const adapters = new Map<string, ApprovalAdapter>()
  const adapter = (sessionId: string, ctx: RunContext) => {
    let existing = adapters.get(sessionId)
    if (!existing) {
      existing = new ApprovalAdapter(sessionId)
      adapters.set(sessionId, existing)
    }
    existing.bind(tools[0]!, ctx)
    return existing
  }
  const factory = async (input: AgentHarnessFactoryInput): Promise<AgentHarness & {
    getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<PiAgentSessionAdapter>
  }> => {
    tools = input.tools
    const harness: AgentHarness & {
      getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<PiAgentSessionAdapter>
    } = {
      id: 'approval-harness',
      placement: 'server',
      sessions,
      async getPiSessionAdapter(input, ctx) {
        calls.push('adapter')
        if (!input.sessionId) throw new Error('sessionId required')
        await sessions.ensure(input.sessionId, input.ctx)
        return adapter(input.sessionId, ctx)
      },
    }
    if (!options.noSeed) {
      harness.seedResolvedInput = async (_sessionId, _ctx, input) => {
        if (options.failSeed) throw new Error('seed failed')
        calls.push('seed')
        seeded.push(input)
      }
    }
    return harness
  }
  return { factory, sessions, seeded, calls }
}

class ApprovalAdapter implements PiAgentSessionAdapter {
  private readonly subscribers = new Set<(event: AgentSessionEvent) => void>()
  private tool: AgentTool | undefined
  private ctx: RunContext | undefined
  private streaming = false
  private turn = 0
  private messages: unknown[] = []

  constructor(private readonly sessionId: string) {}

  bind(tool: AgentTool, ctx: RunContext): void {
    this.tool = tool
    this.ctx = ctx
  }

  readSnapshot(): PiAgentSessionSnapshot {
    return {
      state: {},
      messages: this.messages,
      isStreaming: this.streaming,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      followUpMode: 'one-at-a-time',
      sessionId: this.sessionId,
    }
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  prompt(_input: PiAgentPromptInput): Promise<void> {
    const tool = this.tool
    const ctx = this.ctx
    if (!tool || !ctx) throw new Error('tool not bound')
    this.turn += 1
    const toolCallId = `tool-${this.turn}`
    const assistantId = `assistant-${this.turn}`
    const run = this.runToolTurn(tool, ctx, toolCallId, assistantId)
    run.catch(() => {})
    return run
  }

  async followUp(): Promise<void> {}

  async continueQueuedFollowUp(): Promise<void> {
    this.emit({ type: 'agent_start', turnId: `recovered-${this.turn + 1}` } as AgentSessionEvent)
    this.emit({ type: 'agent_end', messages: [], willRetry: false } as AgentSessionEvent)
  }

  clearFollowUp(): void {}

  async abort(): Promise<void> {
    this.streaming = false
  }

  private async runToolTurn(tool: AgentTool, ctx: RunContext, toolCallId: string, assistantId: string): Promise<void> {
    this.streaming = true
    const assistantMessage = {
      id: assistantId,
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: toolCallId,
        name: tool.name,
        arguments: { secret: 'SUPER_SECRET' },
        state: 'input-available',
      }],
      stopReason: 'toolUse',
      timestamp: Date.now(),
    }
    this.messages = [assistantMessage]
    this.emit({ type: 'agent_start', turnId: `turn-${this.turn}` } as AgentSessionEvent)
    this.emit({
      type: 'message_start',
      message: assistantMessage,
    } as unknown as AgentSessionEvent)
    this.emit({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 0,
        partial: { id: assistantId },
        toolCall: {
          id: toolCallId,
          name: tool.name,
          arguments: { secret: 'SUPER_SECRET' },
        },
      },
    } as unknown as AgentSessionEvent)

    const result = await tool.execute({ secret: 'SUPER_SECRET' }, toolContext(ctx, this.sessionId, toolCallId))
    this.emit({
      type: 'tool_execution_end',
      toolCallId,
      result,
      isError: result.isError === true,
    } as AgentSessionEvent)
    this.streaming = false
    this.emit({ type: 'agent_end', messages: [], willRetry: false } as AgentSessionEvent)
  }

  private emit(event: AgentSessionEvent): void {
    for (const subscriber of this.subscribers) subscriber(event)
  }
}

function toolContext(ctx: RunContext, sessionId: string, toolCallId: string): ToolExecContext {
  return {
    abortSignal: ctx.abortSignal,
    toolCallId,
    sessionId,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    requestId: ctx.requestId,
  }
}

async function nextEventOfType<T extends AgentEvent['chunk']['type']>(
  stream: AsyncIterator<AgentEvent>,
  type: T,
): Promise<AgentEvent & { chunk: Extract<AgentEvent['chunk'], { type: T }> }> {
  const deadline = Date.now() + 1_500
  while (Date.now() < deadline) {
    const next = await nextOrTimeout(stream.next(), Math.max(1, deadline - Date.now()))
    if (next === 'timeout') break
    if (next.done) break
    if (next.value.chunk.type === type) {
      return next.value as AgentEvent & { chunk: Extract<AgentEvent['chunk'], { type: T }> }
    }
  }
  throw new Error(`timed out waiting for ${type}`)
}

async function nextOrTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('timed out waiting for condition')
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

class MemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionSummary>()
  private readonly owners = new Map<string, SessionCtx | undefined>()

  seed(sessionId: string, ctx?: SessionCtx): SessionSummary {
    const record = sessionRecord(sessionId)
    this.records.set(sessionId, record)
    this.owners.set(sessionId, normalizeCtx(ctx))
    return record
  }

  async ensure(sessionId: string, ctx?: SessionCtx): Promise<SessionSummary> {
    return this.records.get(sessionId) ?? this.seed(sessionId, ctx)
  }

  async list(ctx: SessionCtx): Promise<SessionSummary[]> {
    return [...this.records.values()].filter((record) => sameCtx(this.owners.get(record.id), ctx))
  }

  async create(ctx: SessionCtx): Promise<SessionSummary> {
    return this.seed(`session-${this.records.size + 1}`, ctx)
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId)
    if (!record) throw Object.assign(new Error('session not found'), { code: ErrorCode.enum.SESSION_NOT_FOUND })
    if (!sameCtx(this.owners.get(sessionId), ctx)) {
      throw Object.assign(new Error('session context mismatch'), { code: ErrorCode.enum.UNAUTHORIZED })
    }
    return record
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    this.records.delete(sessionId)
    this.owners.delete(sessionId)
  }
}

function sessionRecord(id: string): SessionSummary {
  return {
    id,
    title: id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    turnCount: 0,
  }
}

function normalizeCtx(ctx: SessionCtx | undefined): SessionCtx | undefined {
  if (!ctx?.workspaceId && !ctx?.userId) return undefined
  return { workspaceId: ctx.workspaceId, userId: ctx.userId }
}

function sameCtx(a: SessionCtx | undefined, b: SessionCtx | undefined): boolean {
  return (a?.workspaceId ?? '') === (b?.workspaceId ?? '') && (a?.userId ?? '') === (b?.userId ?? '')
}
