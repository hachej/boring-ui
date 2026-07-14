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
  expectTypeOf<SessionStore>().toHaveProperty('rename')
  expectTypeOf<SessionStore>().toHaveProperty('delete')

  expectTypeOf<SessionStore['list']>().parameters.toEqualTypeOf<[ctx: SessionCtx, options?: SessionListOptions]>()
  expectTypeOf<SessionStore['list']>().returns.toEqualTypeOf<Promise<SessionSummary[]>>()
  expectTypeOf<SessionStore['create']>().parameters.toEqualTypeOf<
    [ctx: SessionCtx, init?: { title?: string }]
  >()
  expectTypeOf<SessionStore['load']>().parameters.toEqualTypeOf<
    [ctx: SessionCtx, sessionId: string]
  >()
  expectTypeOf<SessionStore['load']>().returns.toEqualTypeOf<Promise<SessionDetail>>()
  expectTypeOf<SessionStore['rename']>().parameters.toEqualTypeOf<
    [ctx: SessionCtx, sessionId: string, title: string]
  >()
  expectTypeOf<SessionStore['rename']>().returns.toEqualTypeOf<Promise<SessionSummary>>()
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
    canRename?: boolean
  }>()

  expectTypeOf<SessionDetail>().toEqualTypeOf<SessionSummary>()
})
