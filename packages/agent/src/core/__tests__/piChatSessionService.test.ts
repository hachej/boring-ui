import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_EFFECT_METHODS,
  type AgentCoreSessionService,
  withAgentEffectAdmission,
} from '../piChatSessionService'

const CTX = { workspaceId: 'workspace:test', requestId: 'request:test' }

describe('withAgentEffectAdmission', () => {
  it('admits one scoped native start before its same-key retry only', async () => {
    const receipt = { accepted: true as const, cursor: 0, clientNonce: 'n', nativeSessionId: 's1', session: { id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 } }
    const promptNewSession = vi.fn(async () => receipt)
    let admits = 0
    let admissionAllowed = true
    const admitted = withAgentEffectAdmission({ promptNewSession } as unknown as AgentCoreSessionService, async () => {
      admits += 1
      if (!admissionAllowed) throw new Error('admission rejected')
    })
    const payload = { message: 'hi', clientNonce: 'n' }
    const scopedCtx = { ...CTX, authSubject: 'user-a', storageScope: 'scope-a' }

    await expect(admitted.promptNewSession!(scopedCtx, payload, { idempotencyKey: 'key', retry: false })).resolves.toBe(receipt)
    admissionAllowed = false
    await expect(admitted.promptNewSession!(scopedCtx, payload, { idempotencyKey: 'key', retry: true })).resolves.toBe(receipt)
    expect(admits).toBe(1)
    expect(promptNewSession).toHaveBeenCalledTimes(2)

    await expect(admitted.promptNewSession!(scopedCtx, payload, { idempotencyKey: 'unknown', retry: true })).rejects.toThrow('admission rejected')
    await expect(admitted.promptNewSession!({ ...scopedCtx, storageScope: 'scope-b' }, payload, { idempotencyKey: 'key', retry: true })).rejects.toThrow('admission rejected')
    admissionAllowed = true
    await expect(admitted.promptNewSession!(scopedCtx, payload, { idempotencyKey: 'unknown', retry: true })).resolves.toBe(receipt)
    expect(promptNewSession).toHaveBeenCalledTimes(3)
  })

  it('shares an in-flight scoped admission with a same-key retry', async () => {
    const receipt = { accepted: true as const, cursor: 0, clientNonce: 'n', nativeSessionId: 's1', session: { id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 } }
    const promptNewSession = vi.fn(async () => receipt)
    let releaseAdmission!: () => void
    let signalAdmissionStarted!: () => void
    const admissionGate = new Promise<void>((resolve) => { releaseAdmission = resolve })
    const admissionStarted = new Promise<void>((resolve) => { signalAdmissionStarted = resolve })
    const admit = vi.fn(async () => {
      signalAdmissionStarted()
      await admissionGate
    })
    const admitted = withAgentEffectAdmission({ promptNewSession } as unknown as AgentCoreSessionService, admit)
    const scopedCtx = { ...CTX, authSubject: 'user-a', storageScope: 'scope-a' }
    const payload = { message: 'hi', clientNonce: 'n' }

    const first = admitted.promptNewSession!(scopedCtx, payload, { idempotencyKey: 'key', retry: false })
    await admissionStarted
    const retry = admitted.promptNewSession!(scopedCtx, payload, { idempotencyKey: 'key', retry: true })

    expect(admit).toHaveBeenCalledTimes(1)
    expect(promptNewSession).not.toHaveBeenCalled()
    releaseAdmission()
    await expect(Promise.all([first, retry])).resolves.toEqual([receipt, receipt])
    expect(promptNewSession).toHaveBeenCalledTimes(2)
  })

  it('removes a rejected scoped admission so a later retry re-admits', async () => {
    const receipt = { accepted: true as const, cursor: 0, clientNonce: 'n', nativeSessionId: 's1', session: { id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 } }
    const promptNewSession = vi.fn(async () => receipt)
    let reject = true
    const admit = vi.fn(async () => {
      if (reject) throw new Error('admission rejected')
    })
    const admitted = withAgentEffectAdmission({ promptNewSession } as unknown as AgentCoreSessionService, admit)
    const scopedCtx = { ...CTX, authSubject: 'user-a', storageScope: 'scope-a' }
    const payload = { message: 'hi', clientNonce: 'n' }

    await expect(admitted.promptNewSession!(scopedCtx, payload, { idempotencyKey: 'key', retry: false })).rejects.toThrow('admission rejected')
    reject = false
    await expect(admitted.promptNewSession!(scopedCtx, payload, { idempotencyKey: 'key', retry: true })).resolves.toBe(receipt)

    expect(admit).toHaveBeenCalledTimes(2)
    expect(promptNewSession).toHaveBeenCalledTimes(1)
  })

  it('admits every mutation immediately before its effect and excludes reads and disposal', async () => {
    const events: string[] = []
    const effect = <T>(name: string, value: T) => async () => { events.push(name); return value }
    const service = {
      listSessions: effect('listSessions', []),
      createSession: effect('createSession', { id: 's1' }),
      promptNewSession: effect('promptNewSession', { accepted: true, cursor: 0, clientNonce: 'n', nativeSessionId: 's1', session: { id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 } }),
      renameSession: effect('renameSession', { id: 's1', title: 'Renamed', createdAt: '', updatedAt: '', turnCount: 0 }),
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
    let nativeStartCount = 0
    const mutations: Record<keyof typeof AGENT_EFFECT_METHODS, () => Promise<unknown>> = {
      createSession: () => admitted.createSession(CTX),
      promptNewSession: () => admitted.promptNewSession!(CTX, { message: 'hi', clientNonce: 'n' }, { idempotencyKey: `key-${nativeStartCount++}`, retry: false }),
      renameSession: () => admitted.renameSession!(CTX, 's1', 'Renamed'),
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
    await admitted.readState(CTX, 's1')
    await admitted.subscribe(CTX, 's1', 0, () => {})
    await admitted.dispose?.()
    expect(events).toEqual(['listSessions', 'readState', 'subscribe', 'dispose'])
  })
})
