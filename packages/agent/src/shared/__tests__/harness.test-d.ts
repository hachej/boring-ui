import { expectTypeOf, test } from 'vitest'
import type { AgentHarness, SendMessageInput, RunContext } from '../harness'

test('checking AgentHarness contract', () => {
  expectTypeOf<AgentHarness>().toHaveProperty('id')
  expectTypeOf<AgentHarness>().toHaveProperty('placement')
  expectTypeOf<AgentHarness>().toHaveProperty('sessions')

  expectTypeOf<AgentHarness['id']>().toEqualTypeOf<string>()
  expectTypeOf<AgentHarness['placement']>().toEqualTypeOf<'server' | 'browser'>()
})

test('checking SendMessageInput contract', () => {
  expectTypeOf<SendMessageInput>().toHaveProperty('sessionId')
  expectTypeOf<SendMessageInput>().toHaveProperty('message')
  expectTypeOf<SendMessageInput>().toHaveProperty('thinkingLevel')
  expectTypeOf<SendMessageInput>().toHaveProperty('model')

  expectTypeOf<SendMessageInput['sessionId']>().toEqualTypeOf<string>()
  expectTypeOf<SendMessageInput['message']>().toEqualTypeOf<string>()
})

test('checking RunContext contract', () => {
  expectTypeOf<RunContext>().toHaveProperty('abortSignal')
  expectTypeOf<RunContext>().toHaveProperty('workdir')
  expectTypeOf<RunContext>().toHaveProperty('userId')

  expectTypeOf<RunContext['abortSignal']>().toEqualTypeOf<AbortSignal>()
  expectTypeOf<RunContext['workdir']>().toEqualTypeOf<string>()
})
