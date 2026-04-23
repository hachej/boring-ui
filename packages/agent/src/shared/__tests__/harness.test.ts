import { expectTypeOf, test } from 'vitest'

import type { AgentHarness, RunContext, SendMessageInput } from '../harness'

test('AgentHarness contract', () => {
  expectTypeOf<AgentHarness>().toMatchTypeOf<{
    readonly id: string
    readonly placement: 'server' | 'browser'
    sessions: unknown
  }>()
  expectTypeOf<AgentHarness['sendMessage']>().parameters.toEqualTypeOf<
    [input: SendMessageInput, ctx: RunContext]
  >()
  expectTypeOf<AgentHarness['sendMessage']>().returns.toEqualTypeOf<AsyncIterable<unknown>>()
  expectTypeOf<AgentHarness>().not.toHaveProperty('reconnect')
})

test('SendMessageInput contract', () => {
  expectTypeOf<SendMessageInput>().toEqualTypeOf<{
    sessionId: string
    message: string
    thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
    model?: {
      provider: string
      id: string
    }
  }>()

  expectTypeOf<SendMessageInput['thinkingLevel']>().toEqualTypeOf<
    'off' | 'low' | 'medium' | 'high' | undefined
  >()
  expectTypeOf<NonNullable<SendMessageInput['model']>>().toEqualTypeOf<{
    provider: string
    id: string
  }>()
})

test('RunContext contract', () => {
  expectTypeOf<RunContext>().toEqualTypeOf<{
    abortSignal: AbortSignal
    workdir: string
    userId?: string
  }>()

  expectTypeOf<RunContext['abortSignal']>().toEqualTypeOf<AbortSignal>()
  expectTypeOf<RunContext['workdir']>().toEqualTypeOf<string>()
  expectTypeOf<RunContext['userId']>().toEqualTypeOf<string | undefined>()
})
