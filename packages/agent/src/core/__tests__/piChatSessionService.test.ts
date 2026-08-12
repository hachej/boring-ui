import { describe, expect, it } from 'vitest'

import {
  AGENT_EFFECT_METHODS,
  type AgentCoreSessionService,
  withAgentEffectAdmission,
} from '../piChatSessionService'

const CTX = { workspaceId: 'workspace:test', requestId: 'request:test' }

describe('withAgentEffectAdmission', () => {
  it('admits every mutation immediately before its effect and excludes reads and disposal', async () => {
    const events: string[] = []
    const effect = <T>(name: string, value: T) => async () => { events.push(name); return value }
    const service = {
      listSessions: effect('listSessions', []),
      listSessionActivity: effect('listSessionActivity', []),
      createSession: effect('createSession', { id: 's1' }),
      deleteSession: effect('deleteSession', undefined),
      readState: effect('readState', {}),
      subscribe: effect('subscribe', { type: 'ok', unsubscribe() {} }),
      prompt: effect('prompt', {}),
      followUp: effect('followUp', {}),
      clearQueue: effect('clearQueue', {}),
      interrupt: effect('interrupt', {}),
      stop: effect('stop', {}),
      dispose: effect('dispose', undefined),
    } as unknown as AgentCoreSessionService
    let blocked = false
    const admitted = withAgentEffectAdmission(service, async (ctx) => {
      events.push('admit')
      expect(ctx).toEqual(CTX)
      if (blocked) throw new Error('blocked')
    })
    const mutations: Record<keyof typeof AGENT_EFFECT_METHODS, () => Promise<unknown>> = {
      createSession: () => admitted.createSession(CTX),
      deleteSession: () => admitted.deleteSession(CTX, 's1'),
      prompt: () => admitted.prompt(CTX, 's1', { message: 'hi', clientNonce: 'p' }),
      followUp: () => admitted.followUp(CTX, 's1', { message: 'next', clientNonce: 'f', clientSeq: 1 }),
      clearQueue: () => admitted.clearQueue(CTX, 's1', {}),
      interrupt: () => admitted.interrupt(CTX, 's1', {}),
      stop: () => admitted.stop(CTX, 's1', {}),
    }

    for (const method of Object.keys(AGENT_EFFECT_METHODS) as Array<keyof typeof AGENT_EFFECT_METHODS>) {
      events.length = 0
      await mutations[method]()
      expect(events).toEqual(['admit', method])
    }
    blocked = true
    for (const method of Object.keys(AGENT_EFFECT_METHODS) as Array<keyof typeof AGENT_EFFECT_METHODS>) {
      events.length = 0
      await expect(mutations[method]()).rejects.toThrow('blocked')
      expect(events).toEqual(['admit'])
    }
    blocked = false
    events.length = 0
    await admitted.listSessions?.(CTX)
    await admitted.listSessionActivity?.(CTX, { sessionIds: ['s1'] })
    await admitted.readState(CTX, 's1')
    await admitted.subscribe(CTX, 's1', 0, () => {})
    await admitted.dispose?.()
    expect(events).toEqual(['listSessions', 'listSessionActivity', 'readState', 'subscribe', 'dispose'])
  })
})
