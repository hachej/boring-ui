import { describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../../shared/error-codes'
import type { AgentTool } from '../../../../shared/tool'
import type { TelemetryEvent, TelemetrySink } from '../../../../shared/telemetry'
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

describe('tool adapter telemetry', () => {
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

  it('reads the latest run context for reused Pi sessions', async () => {
    const seenUsers: Array<string | undefined> = []
    let currentUserId = 'alpha'
    const tool = createTool({
      async execute(_params, ctx) {
        seenUsers.push(ctx.userId)
        return { content: [{ type: 'text', text: ctx.userId ?? 'missing' }] }
      },
    })
    const adapted = adaptToolForPi(tool, 'sess-tool', undefined, () => ({
      abortSignal: new AbortController().signal,
      workdir: '/workspace',
      userId: currentUserId,
    }))

    const first = await adapted.execute('call-1', {}, undefined, undefined, {} as never)
    currentUserId = 'beta'
    const second = await adapted.execute('call-2', {}, undefined, undefined, {} as never)

    expect(first.content).toEqual([{ type: 'text', text: 'alpha' }])
    expect(second.content).toEqual([{ type: 'text', text: 'beta' }])
    expect(seenUsers).toEqual(['alpha', 'beta'])
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
