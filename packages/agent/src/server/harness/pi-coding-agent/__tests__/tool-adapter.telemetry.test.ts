import { describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../../shared/error-codes'
import type { AgentTool } from '../../../../shared/tool'
import type { TelemetryEvent, TelemetrySink } from '../../../../shared/telemetry'
import { adaptToolForPi } from '../tool-adapter'

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

    await expect(executeAdapted(tool, recorder.telemetry)).rejects.toThrow('secret stderr output')

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
