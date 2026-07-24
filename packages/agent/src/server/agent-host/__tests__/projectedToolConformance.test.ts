import { describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '../../../shared/tool'
import { adaptToolForPi } from '../../harness/pi-coding-agent/tool-adapter'

describe('in-process projected tool conformance', () => {
  it('preserves onUpdate and AbortSignal through schema projection', async () => {
    const controller = new AbortController()
    const updates: string[] = []
    const execute = vi.fn<AgentTool['execute']>(async (_params, ctx) => {
      expect(ctx.abortSignal).toBe(controller.signal)
      ctx.onUpdate?.('working')
      controller.abort()
      expect(ctx.abortSignal.aborted).toBe(true)
      return { content: [{ type: 'text', text: 'done' }] }
    })
    const projected = adaptToolForPi({
      name: 'projected',
      description: 'projected tool',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      execute,
    })

    const result = await projected.execute(
      'tool-call-1',
      { value: 'hello' },
      controller.signal,
      (partial) => updates.push(partial.content[0]?.type === 'text' ? partial.content[0].text : ''),
      undefined as never,
    )
    expect(execute).toHaveBeenCalledOnce()
    expect(updates).toEqual(['working'])
    expect(result.content).toEqual([{ type: 'text', text: 'done' }])
  })
})
