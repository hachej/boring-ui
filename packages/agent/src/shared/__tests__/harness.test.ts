import { expectTypeOf, test } from 'vitest'

import type { AgentHarness, RunContext, SendMessageInput, MessageAttachment } from '../harness'
import type { SessionStore } from '../session'

test('AgentHarness contract', () => {
  expectTypeOf<AgentHarness>().toMatchTypeOf<{
    readonly id: string
    readonly placement: 'server' | 'browser'
    sessions: SessionStore
  }>()
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
    attachments?: MessageAttachment[]
  }>()

  expectTypeOf<SendMessageInput['thinkingLevel']>().toEqualTypeOf<
    'off' | 'low' | 'medium' | 'high' | undefined
  >()
  expectTypeOf<NonNullable<SendMessageInput['model']>>().toEqualTypeOf<{
    provider: string
    id: string
  }>()
  expectTypeOf<SendMessageInput['attachments']>().toEqualTypeOf<MessageAttachment[] | undefined>()
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
  }>()

  expectTypeOf<RunContext['abortSignal']>().toEqualTypeOf<AbortSignal>()
  expectTypeOf<RunContext['workdir']>().toEqualTypeOf<string>()
  expectTypeOf<RunContext['userId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['userEmail']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['userEmailVerified']>().toEqualTypeOf<boolean | undefined>()
  expectTypeOf<RunContext['workspaceId']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<RunContext['requestId']>().toEqualTypeOf<string | undefined>()
})
