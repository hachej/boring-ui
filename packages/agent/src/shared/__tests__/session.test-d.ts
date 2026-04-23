import { expectTypeOf, test } from 'vitest'
import type { SessionStore, SessionCtx, SessionSummary, SessionDetail } from '../session'

test('checking SessionStore contract', () => {
  expectTypeOf<SessionStore>().toHaveProperty('list')
  expectTypeOf<SessionStore>().toHaveProperty('create')
  expectTypeOf<SessionStore>().toHaveProperty('load')
  expectTypeOf<SessionStore>().toHaveProperty('delete')

  expectTypeOf<SessionStore['list']>().toBeFunction()
  expectTypeOf<SessionStore['create']>().toBeFunction()
  expectTypeOf<SessionStore['load']>().toBeFunction()
  expectTypeOf<SessionStore['delete']>().toBeFunction()
})

test('checking SessionCtx contract', () => {
  expectTypeOf<SessionCtx>().toHaveProperty('workspaceId')
  expectTypeOf<SessionCtx>().toHaveProperty('userId')

  expectTypeOf<SessionCtx['workspaceId']>().toEqualTypeOf<string>()
})

test('checking SessionSummary contract', () => {
  expectTypeOf<SessionSummary>().toHaveProperty('id')
  expectTypeOf<SessionSummary>().toHaveProperty('title')
  expectTypeOf<SessionSummary>().toHaveProperty('createdAt')
  expectTypeOf<SessionSummary>().toHaveProperty('updatedAt')
  expectTypeOf<SessionSummary>().toHaveProperty('turnCount')

  expectTypeOf<SessionSummary['id']>().toEqualTypeOf<string>()
  expectTypeOf<SessionSummary['turnCount']>().toEqualTypeOf<number>()
})

test('checking SessionDetail extends SessionSummary', () => {
  expectTypeOf<SessionDetail>().toMatchTypeOf<SessionSummary>()
  expectTypeOf<SessionDetail>().toHaveProperty('messages')
})
