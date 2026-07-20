import { expectTypeOf, test } from 'vitest'

import type { AgentConfig } from '../events'
import type { AgentCoreHarnessFactory, AgentHarness, AgentHarnessFactory, RunContext, AgentSendInput, MessageAttachment } from '../harness'
import type { SessionStore } from '../session'

test('AgentHarness contract', () => {
  expectTypeOf<AgentHarness>().toMatchTypeOf<{
    readonly id: string
    readonly placement: 'server' | 'browser'
    sessions: SessionStore
  }>()
  expectTypeOf<AgentHarness>().not.toHaveProperty('reconnect')
})

test('AgentSendInput contract', () => {
  expectTypeOf<AgentSendInput>().toEqualTypeOf<{
    sessionId?: string
    content?: string | Array<{ type: string; text?: string; [key: string]: unknown }>
    message?: string
    thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
    model?: {
      provider: string
      id: string
    }
    attachments?: MessageAttachment[]
    actor?: { id?: string; name?: string }
    ctx?: { workspaceId?: string; userId?: string }
    originSurface?: string
    sessionTitle?: string
    strictModel?: boolean
  }>()

  expectTypeOf<AgentSendInput['thinkingLevel']>().toEqualTypeOf<
    'off' | 'low' | 'medium' | 'high' | undefined
  >()
  expectTypeOf<NonNullable<AgentSendInput['model']>>().toEqualTypeOf<{
    provider: string
    id: string
  }>()
  expectTypeOf<AgentSendInput['attachments']>().toEqualTypeOf<MessageAttachment[] | undefined>()
})

test('AgentConfig core harness contract', () => {
  expectTypeOf<NonNullable<AgentConfig['harnessFactory']>>().toEqualTypeOf<AgentCoreHarnessFactory>()
  expectTypeOf<AgentHarnessFactory>().not.toMatchTypeOf<AgentCoreHarnessFactory>()
})

test('RunContext contract', () => {
  expectTypeOf<RunContext>().toEqualTypeOf<{
    abortSignal: AbortSignal
    workdir: string
    workspaceId?: string
    requestId?: string
    userId?: string
    userEmail?: string
    userEmailVerified?: boolean
    allowPromptDispatch?: boolean
  }>()

  expectTypeOf<RunContext['abortSignal']>().toEqualTypeOf<AbortSignal>()
  expectTypeOf<RunContext['workdir']>().toEqualTypeOf<string>()
  expectTypeOf<RunContext['workspaceId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['userId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['userEmail']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['userEmailVerified']>().toEqualTypeOf<boolean | undefined>()
  expectTypeOf<RunContext['workspaceId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['requestId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['allowPromptDispatch']>().toEqualTypeOf<boolean | undefined>()
})
