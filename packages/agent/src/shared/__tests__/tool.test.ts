import { expectTypeOf, test } from 'vitest'

import type { AgentTool, JSONSchema, ToolExecContext, ToolReadinessRequirement, ToolResult } from '../tool'

test('AgentTool contract', () => {
  expectTypeOf<AgentTool>().toEqualTypeOf<{
    name: string
    description: string
    promptSnippet?: string
    readinessRequirements?: ToolReadinessRequirement[]
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
    sessionId?: string
  }>()

  expectTypeOf<ToolExecContext['onUpdate']>().toEqualTypeOf<
    ((partial: string) => void) | undefined
  >()
  expectTypeOf<ToolExecContext['sessionId']>().toEqualTypeOf<string | undefined>()
})

test('ToolResult contract', () => {
  expectTypeOf<ToolResult>().toEqualTypeOf<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
    details?: unknown
  }>()
})
