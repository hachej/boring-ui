import { expectTypeOf, test } from 'vitest'

import type { AgentTool, JSONSchema, ToolExecContext, ToolResult } from '../tool'

test('AgentTool contract', () => {
  expectTypeOf<AgentTool>().toEqualTypeOf<{
    name: string
    description: string
    parameters: JSONSchema
    execute: (
      params: Record<string, unknown>,
      ctx: ToolExecContext,
    ) => Promise<ToolResult>
  }>()
})

test('ToolExecContext contract', () => {
  expectTypeOf<ToolExecContext>().toEqualTypeOf<{
    abortSignal: AbortSignal
    toolCallId: string
    onUpdate?: (partial: string) => void
  }>()

  expectTypeOf<ToolExecContext['onUpdate']>().toEqualTypeOf<
    ((partial: string) => void) | undefined
  >()
})

test('ToolResult contract', () => {
  expectTypeOf<ToolResult>().toEqualTypeOf<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
    details?: unknown
  }>()
})
