import { expectTypeOf, test } from 'vitest'
import type { AgentConfig } from '../events'
import type { AgentCoreHarnessFactory, AgentHarness, AgentHarnessFactory, AgentSendInput, RunContext } from '../harness'

test('checking AgentHarness contract', () => {
  expectTypeOf<AgentHarness>().toHaveProperty('id')
  expectTypeOf<AgentHarness>().toHaveProperty('placement')
  expectTypeOf<AgentHarness>().toHaveProperty('sessions')

  expectTypeOf<AgentHarness['id']>().toEqualTypeOf<string>()
  expectTypeOf<AgentHarness['placement']>().toEqualTypeOf<'server' | 'browser'>()
})

test('checking AgentSendInput contract', () => {
  expectTypeOf<AgentSendInput>().toHaveProperty('sessionId')
  expectTypeOf<AgentSendInput>().toHaveProperty('content')
  expectTypeOf<AgentSendInput>().toHaveProperty('thinkingLevel')
  expectTypeOf<AgentSendInput>().toHaveProperty('model')

  expectTypeOf<AgentSendInput['sessionId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<AgentSendInput['content']>().toEqualTypeOf<string | Array<{ type: string; text?: string; [key: string]: unknown }> | undefined>()
})

test('checking AgentConfig core harness contract', () => {
  expectTypeOf<NonNullable<AgentConfig['harnessFactory']>>().toEqualTypeOf<AgentCoreHarnessFactory>()
  expectTypeOf<AgentHarnessFactory>().not.toMatchTypeOf<AgentCoreHarnessFactory>()
})

test('checking RunContext contract', () => {
  expectTypeOf<RunContext>().toHaveProperty('abortSignal')
  expectTypeOf<RunContext>().toHaveProperty('workdir')
  expectTypeOf<RunContext>().toHaveProperty('workspaceId')
  expectTypeOf<RunContext>().toHaveProperty('userId')

  expectTypeOf<RunContext['abortSignal']>().toEqualTypeOf<AbortSignal>()
  expectTypeOf<RunContext['workdir']>().toEqualTypeOf<string>()
  expectTypeOf<RunContext['workspaceId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['userId']>().toEqualTypeOf<string | undefined>()
})
