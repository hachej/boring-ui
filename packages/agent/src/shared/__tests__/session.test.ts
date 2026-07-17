import { expectTypeOf, test } from 'vitest'

import type {
  SessionCtx,
  SessionDetail,
  SessionStore,
  SessionSummary,
  SessionListOptions,
} from '../session'
import { SessionSummarySchema } from '../session'

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
  expectTypeOf<NonNullable<SessionStore['rename']>>().parameters.toEqualTypeOf<[ctx: SessionCtx, sessionId: string, title: string]>()
  expectTypeOf<NonNullable<SessionStore['rename']>>().returns.toEqualTypeOf<Promise<SessionSummary>>()
  expectTypeOf<SessionStore['delete']>().returns.toEqualTypeOf<Promise<void>>()
})

test('Session shapes', () => {
  expectTypeOf<SessionCtx>().toEqualTypeOf<{
    workspaceId?: string
    userId?: string
  }>()

  expectTypeOf<SessionSummary>().toEqualTypeOf<
    | {
      id: string
      title: string
      createdAt: string
      updatedAt: string
      turnCount: number
      nativeSessionId: string
      hasAssistantReply: boolean
    }
    | {
      id: string
      title: string
      createdAt: string
      updatedAt: string
      turnCount: number
      nativeSessionId?: undefined
      hasAssistantReply?: undefined
    }
  >()

  expectTypeOf<SessionDetail>().toEqualTypeOf<SessionSummary>()
})

test('SessionSummary rejects assistant eligibility without direct native identity', () => {
  expect(SessionSummarySchema.safeParse({
    id: 'legacy', title: 'Legacy', createdAt: '', updatedAt: '', turnCount: 0, hasAssistantReply: true,
  }).success).toBe(false)
  expect(SessionSummarySchema.safeParse({
    id: 'native', nativeSessionId: 'native', title: 'Native', createdAt: '', updatedAt: '', turnCount: 0, hasAssistantReply: false,
  }).success).toBe(true)
})
