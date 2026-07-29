import { describe, expect, expectTypeOf, test } from 'vitest'

import { isValidClientNativeSessionId } from '../session'
import type {
  SessionCtx,
  SessionDetail,
  SessionStore,
  SessionSummary,
  SessionListOptions,
} from '../session'

describe('client native session id validation', () => {
  test.each([
    ['', 'Pi requires a non-empty id'],
    ['native@session', 'Pi character rule'],
    ['native session', 'Pi character rule'],
    ['-native', 'alphanumeric start'],
    ['native_', 'alphanumeric end'],
    ['native/session', 'forward path separator'],
    ['native\\session', 'backward path separator'],
    ['native..session', 'explicit parent segment'],
    ['a'.repeat(129), 'length bound'],
  ])('rejects %s (%s)', (sessionId) => {
    expect(isValidClientNativeSessionId(sessionId)).toBe(false)
  })

  test.each([
    'a',
    'native-session_1',
    '123e4567-e89b-42d3-a456-426614174000',
    'native.session',
  ])('accepts Pi-safe id %s', (sessionId) => {
    expect(isValidClientNativeSessionId(sessionId)).toBe(true)
  })
})

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
    liveSessionScopeId?: string
  }>()

  expectTypeOf<SessionSummary>().toEqualTypeOf<{
    id: string
    title: string
    createdAt: string
    updatedAt: string
    turnCount: number
    agentTypeId?: string
    nativeSessionId?: string
    hasAssistantReply?: boolean
    ephemeral?: boolean
  }>()

  expectTypeOf<SessionDetail>().toEqualTypeOf<SessionSummary>()
})
