import { describe, expect, it, vi } from 'vitest'

import type { AgentTool, ToolExecContext } from '@hachej/boring-agent/shared'
import { withSandboxTarget } from '../runtimeTarget'

const ctx = {
  abortSignal: new AbortController().signal,
  toolCallId: 'call-1',
  sessionId: 'session-1',
} as ToolExecContext

function primary(): AgentTool {
  return {
    name: 'bash',
    description: 'primary bash',
    readinessRequirements: ['sandbox-exec'],
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
    execute: vi.fn(async (params) => ({
      content: [{ type: 'text' as const, text: `primary:${String(params.command)}` }],
      details: { primary: true },
    })),
  }
}

describe('withSandboxTarget', () => {
  it('delegates omitted sandbox to the original tool unchanged', async () => {
    const tool = primary()
    const targeted = vi.fn()
    const routed = withSandboxTarget(tool, { executeTargeted: targeted })
    const params = { command: 'pwd' }

    await expect(routed.execute(params, ctx)).resolves.toMatchObject({ details: { primary: true } })
    expect(tool.execute).toHaveBeenCalledWith(params, ctx)
    expect(targeted).not.toHaveBeenCalled()
    expect(routed.readinessRequirements).toEqual(tool.readinessRequirements)
  })

  it('adds one optional sandbox schema and routes after stripping it', async () => {
    const tool = primary()
    const targeted = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'remote' }] }))
    const routed = withSandboxTarget(tool, { executeTargeted: targeted })

    await expect(routed.execute({ command: 'pwd', sandbox: 'lease-handle-0001' }, ctx))
      .resolves.toMatchObject({ content: [{ text: 'remote' }] })
    expect(targeted).toHaveBeenCalledWith('lease-handle-0001', { command: 'pwd' }, ctx)
    expect(tool.execute).not.toHaveBeenCalled()
    expect((routed.parameters.properties as Record<string, unknown>).sandbox).toMatchObject({ type: 'string' })
  })

  it('rejects malformed handles and named filesystem combinations before target resolution', async () => {
    const targeted = vi.fn()
    const routed = withSandboxTarget(primary(), { executeTargeted: targeted })

    await expect(routed.execute({ command: 'pwd', sandbox: '../escape' }, ctx))
      .resolves.toMatchObject({ isError: true, details: { code: 'SANDBOX_TARGET_INVALID' } })
    await expect(routed.execute({ command: 'pwd', sandbox: 'lease-handle-0001', filesystem: 'knowledge' }, ctx))
      .resolves.toMatchObject({ isError: true, details: { code: 'SANDBOX_TARGET_INVALID' } })
    expect(targeted).not.toHaveBeenCalled()
  })
})
