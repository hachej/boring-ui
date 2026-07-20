import { expectTypeOf, test } from 'vitest'

import type {
  SessionCtx,
  SessionDetail,
  SessionStore,
  SessionSummary,
  SessionListOptions,
} from '../session'

test('SessionStore contract', () => {
  expectTypeOf<SessionStore>().toHaveProperty('list')
  expectTypeOf<SessionStore>().toHaveProperty('create')
  expectTypeOf<SessionStore>().toHaveProperty('load')
  expectTypeOf<SessionStore>().toHaveProperty('delete')
  expectTypeOf<SessionStore>().toHaveProperty('rename')

  expectTypeOf<SessionStore['list']>().parameters.toEqualTypeOf<[ctx: SessionCtx, options?: SessionListOptions]>()
  expectTypeOf<SessionStore['list']>().returns.toEqualTypeOf<Promise<SessionSummary[]>>()
  expectTypeOf<SessionStore['create']>().parameters.toEqualTypeOf<
    [ctx: SessionCtx, init?: { title?: string }]
  >()
  expectTypeOf<SessionStore['load']>().parameters.toEqualTypeOf<
    [ctx: SessionCtx, sessionId: string]
  >()
  expectTypeOf<SessionStore['load']>().returns.toEqualTypeOf<Promise<SessionDetail>>()
  expectTypeOf<SessionStore['delete']>().returns.toEqualTypeOf<Promise<void>>()
})

test('Session shapes', () => {
  expectTypeOf<SessionCtx>().toEqualTypeOf<{
    workspaceId?: string
    userId?: string
  }>()

  expectTypeOf<SessionSummary>().toEqualTypeOf<{
    id: string
    title: string
    createdAt: string
    updatedAt: string
    turnCount: number
    nativeSessionId?: string
    hasAssistantReply?: boolean
    ephemeral?: boolean
  }>()

  expectTypeOf<SessionDetail>().toEqualTypeOf<SessionSummary>()
})
