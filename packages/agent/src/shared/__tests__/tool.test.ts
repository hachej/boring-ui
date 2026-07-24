import { expectTypeOf, test } from 'vitest'

import type { AgentTool, JSONSchema, ToolExecContext, ToolReadinessRequirement, ToolResult } from '../tool'

test('AgentTool contract', () => {
  expectTypeOf<AgentTool>().toEqualTypeOf<{
    name: string
    description: string
    promptSnippet?: string
    readinessRequirements?: ToolReadinessRequirement[]
    executionMode?: 'sequential' | 'parallel'
    currentRunDetailKinds?: readonly string[]
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
    userId?: string
    userEmail?: string
    userEmailVerified?: boolean
    workspaceId?: string
    requestId?: string
    currentRunStructuredDetails?: readonly import('../tool').ToolStructuredDetail[]
  }>()

  expectTypeOf<ToolExecContext['onUpdate']>().toEqualTypeOf<
    ((partial: string) => void) | undefined
  >()
  expectTypeOf<ToolExecContext['sessionId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<ToolExecContext['userId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<ToolExecContext['userEmail']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<ToolExecContext['userEmailVerified']>().toEqualTypeOf<boolean | undefined>()
  expectTypeOf<ToolExecContext['workspaceId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<ToolExecContext['requestId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<ToolExecContext['currentRunStructuredDetails']>().toEqualTypeOf<readonly import('../tool').ToolStructuredDetail[] | undefined>()
})

test('ToolResult contract', () => {
  expectTypeOf<ToolResult>().toEqualTypeOf<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
    details?: unknown
  }>()
})
