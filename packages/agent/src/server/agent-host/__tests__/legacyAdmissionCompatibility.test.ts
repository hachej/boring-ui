import { describe, expect, it, vi } from 'vitest'
import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AuthorizedAgentScope,
} from '../../../shared/index'
import type {
  CommandReceipt,
  FollowUpReceipt,
  PiChatSnapshot,
  PromptReceipt,
  QueueClearReceipt,
  StopReceipt,
} from '../../../shared/chat'
import {
  AgentEffectAdmissionError,
  withAgentEffectAdmission,
  type AgentCoreSessionService,
  type AgentEffectAdmission,
} from '../../../core/piChatSessionService'
import { ErrorCode } from '../../../shared/error-codes'
import { EmbeddedAgentGateway } from '../embeddedGateway'
import { createLegacyPiChatCompatibilityService } from '../legacyPiChatCompatibility'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import type { AgentRequestKey } from '../types'

class RecordingLedger extends InMemoryAgentRequestLedger {
  readonly acceptances: string[] = []

  constructor(readonly events: string[]) {
    super()
  }

  override async prepare(key: AgentRequestKey, digest: string) {
    this.events.push(`prepare:${key.operation}`)
    return await super.prepare(key, digest)
  }

  override async acceptAdmission(key: AgentRequestKey, receipt: string) {
    this.events.push(`accept:${key.operation}`)
    this.acceptances.push(receipt)
    await super.acceptAdmission(key, receipt)
  }

  override async beginEffect(key: AgentRequestKey) {
    this.events.push(`begin:${key.operation}`)
    await super.beginEffect(key)
  }

  override async reject(key: AgentRequestKey, failure: Parameters<InMemoryAgentRequestLedger['reject']>[1]) {
    this.events.push(`reject:${key.operation}`)
    await super.reject(key, failure)
  }

  override async complete(key: AgentRequestKey, receipt: Parameters<InMemoryAgentRequestLedger['complete']>[1]) {
    this.events.push(`complete:${key.operation}`)
    await super.complete(key, receipt)
  }

  override async markOutcomeUnknown(
    key: AgentRequestKey,
    error: Parameters<InMemoryAgentRequestLedger['markOutcomeUnknown']>[1],
  ) {
    this.events.push(`unknown:${key.operation}`)
    await super.markOutcomeUnknown(key, error)
  }
}

const LEGACY_ADMISSION_CODE = 'AGENT_HOST_ADMISSION_RECORD_FAILED'

const scope = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
} as AuthorizedAgentScope

function context(requestId: string) {
  return { workspaceId: 'workspace-a', requestId }
}

function createFixture(options: {
  readonly admit?: AgentEffectAdmission
  readonly failPromptAfterMutation?: boolean
  readonly failPromptBusy?: boolean
  readonly failPromptSynchronously?: boolean
} = {}) {
  const events: string[] = []
  const ledger = new RecordingLedger(events)
  const mutations = new Map<string, number>()
  let promptAttempts = 0
  const mutate = (operation: string) => {
    events.push(`mutation:${operation}`)
    mutations.set(operation, (mutations.get(operation) ?? 0) + 1)
  }
  const snapshot: PiChatSnapshot = {
    protocolVersion: 1,
    sessionId: 'session-a',
    seq: 0,
    status: 'idle',
    messages: [],
    queue: { followUps: [] },
    followUpMode: 'one-at-a-time',
  }
  const base: AgentCoreSessionService = {
    async listSessions() { return [] },
    async createSession() {
      mutate('session.create')
      return { id: 'session-created', title: 'Created', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', turnCount: 0 }
    },
    async deleteSession() { mutate('session.delete') },
    async readState() { return snapshot },
    async subscribe() { return { type: 'ok', unsubscribe() {} } },
    async prompt(_ctx, _sessionId, payload): Promise<PromptReceipt> {
      promptAttempts += 1
      if (options.failPromptBusy) {
        throw Object.assign(new Error('session is busy'), {
          statusCode: 409,
          code: ErrorCode.enum.SESSION_LOCKED,
          retryable: true,
          details: { owner: 'existing-turn' },
        })
      }
      mutate('session.prompt')
      if (options.failPromptAfterMutation) throw new Error('connection dropped after dispatch')
      return { accepted: true, cursor: 1, clientNonce: payload.clientNonce }
    },
    async followUp(_ctx, _sessionId, payload): Promise<FollowUpReceipt> {
      mutate('session.followup')
      return { accepted: true, cursor: 2, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true }
    },
    async clearQueue(): Promise<QueueClearReceipt> {
      mutate('session.queue.clear')
      return { accepted: true, cursor: 3, cleared: 1 }
    },
    async interrupt(): Promise<CommandReceipt> {
      mutate('session.interrupt')
      return { accepted: true, cursor: 4 }
    },
    async stop(): Promise<StopReceipt> {
      mutate('session.stop')
      return { accepted: true, cursor: 5, stopped: true, clearedQueue: [] }
    },
  }
  if (options.failPromptSynchronously) {
    base.prompt = (() => {
      promptAttempts += 1
      throw new TypeError('legacy prompt validation failed')
    }) as AgentCoreSessionService['prompt']
  }
  const admit = options.admit ?? (async (ctx) => { events.push(`callback:${ctx.requestId}`) })
  const service = withAgentEffectAdmission(base, admit)
  const gateway = new EmbeddedAgentGateway({
    ledger,
    effectAdmission: {
      async admit() {
        return { type: 'accepted', admissionReceipt: 'legacy-at-most-once' }
      },
    },
    assertOpen() {},
    async verify(input: AuthorizedAgentScope) {
      if (input !== scope) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'denied')
      return { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' }
    },
    trackEffect<T>(effect: Promise<T>) { return effect },
  } as never)
  const compatibility = createLegacyPiChatCompatibilityService({
    gateway,
    service,
    scope,
    agentTypeId: 'default',
  })
  return { compatibility, events, gateway, ledger, mutations, promptAttempts: () => promptAttempts }
}

async function exactReplay<T>(operation: () => Promise<T>): Promise<T> {
  const first = await operation()
  expect(await operation()).toEqual(first)
  return first
}

describe('legacy admitEffect Level-B compatibility', () => {
  it('covers every legacy effect with prepare → beginEffect → callback → mutation and exact at-most-once replay', async () => {
    const fixture = createFixture()

    await exactReplay(() => fixture.compatibility.createSession!(context('create-request'), { title: 'Created' }))
    expect(fixture.events.slice(0, 7)).toEqual([
      'prepare:session.create',
      'accept:session.create',
      'begin:session.create',
      'callback:create-request',
      'mutation:session.create',
      'complete:session.create',
      'prepare:session.create',
    ])

    await exactReplay(() => fixture.compatibility.deleteSession!(context('delete-request'), 'session-a'))
    await exactReplay(() => fixture.compatibility.prompt(context('prompt-http-request'), 'session-a', {
      message: 'hello',
      clientNonce: 'prompt-request',
    }))
    await exactReplay(() => fixture.compatibility.followUp(context('followup-http-request'), 'session-a', {
      message: 'next',
      clientNonce: 'followup-request',
      clientSeq: 1,
    }))
    await exactReplay(() => fixture.compatibility.interrupt(context('interrupt-request'), 'session-a', {}))
    await exactReplay(() => fixture.compatibility.stop(context('stop-request'), 'session-a', {}))
    await exactReplay(() => fixture.compatibility.clearQueue(context('clear-http-request'), 'session-a', {
      clientNonce: 'clear-request',
      clientSeq: 1,
    }))

    expect(fixture.ledger.acceptances).toEqual(Array(7).fill('legacy-at-most-once'))
    expect([...fixture.mutations.entries()].sort()).toEqual([
      ['session.create', 1],
      ['session.delete', 1],
      ['session.followup', 1],
      ['session.interrupt', 1],
      ['session.prompt', 1],
      ['session.queue.clear', 1],
      ['session.stop', 1],
    ])
    expect(fixture.events.filter((event) => event.startsWith('callback:'))).toEqual([
      'callback:create-request',
      'callback:delete-request',
      'callback:prompt-http-request',
      'callback:followup-http-request',
      'callback:interrupt-request',
      'callback:stop-request',
      'callback:clear-http-request',
    ])

    await expect(fixture.compatibility.prompt(context('other-http-request'), 'session-a', {
      message: 'conflicting payload',
      clientNonce: 'prompt-request',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    expect(fixture.mutations.get('session.prompt')).toBe(1)
  })

  it('distinguishes the reversible follow-up nonce/sequence tuple while replaying each tuple at most once', async () => {
    const fixture = createFixture()
    const invoke = (clientSeq: number) => fixture.compatibility.followUp(context(`http-${clientSeq}`), 'session-a', {
      message: `next-${clientSeq}`,
      clientNonce: 'shared-nonce',
      clientSeq,
    })

    const first = await invoke(1)
    const second = await invoke(2)
    expect(await invoke(1)).toEqual(first)
    expect(await invoke(2)).toEqual(second)
    expect(fixture.mutations.get('session.followup')).toBe(2)
  })

  it('persists and exactly replays canonical legacy admission failures without widening Gateway codes', async () => {
    const admit = vi.fn(async () => {
      throw new AgentEffectAdmissionError(LEGACY_ADMISSION_CODE, {
        field: 'admission',
        omitted: undefined,
      })
    })
    const fixture = createFixture({ admit })
    const invoke = () => fixture.compatibility.prompt(context('admission-http-request'), 'session-a', {
      message: 'hello',
      clientNonce: 'admission-request',
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(invoke()).rejects.toMatchObject({
        name: 'AgentEffectAdmissionError',
        code: LEGACY_ADMISSION_CODE,
        statusCode: 500,
        message: LEGACY_ADMISSION_CODE,
        details: { field: 'admission' },
      })
    }
    expect(admit).toHaveBeenCalledOnce()
    expect(fixture.mutations.get('session.prompt')).toBeUndefined()
    expect(await fixture.ledger.read({
      workspaceScopeId: 'workspace-a',
      authSubjectId: 'subject-a',
      operation: 'session.prompt',
      target: { kind: 'session', ref: { agentTypeId: 'default', sessionId: 'session-a' } },
      requestId: 'admission-request',
    })).toMatchObject({
      state: 'rejected',
      failure: {
        kind: 'legacy-admission',
        code: LEGACY_ADMISSION_CODE,
        statusCode: 500,
        message: LEGACY_ADMISSION_CODE,
        details: { field: 'admission' },
      },
    })
    expect(AgentGatewayErrorCode).not.toHaveProperty(LEGACY_ADMISSION_CODE)
  })

  it('preserves and replays observed busy and synchronous legacy service errors exactly', async () => {
    const busy = createFixture({ failPromptBusy: true })
    const invokeBusy = () => busy.compatibility.prompt(context('busy-http-request'), 'session-a', {
      message: 'hello',
      clientNonce: 'busy-request',
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(invokeBusy()).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCode.enum.SESSION_LOCKED,
        message: 'session is busy',
        retryable: true,
        details: { owner: 'existing-turn' },
      })
    }
    expect(busy.promptAttempts()).toBe(1)

    const synchronous = createFixture({ failPromptSynchronously: true })
    const invokeSynchronous = () => synchronous.compatibility.prompt(context('sync-http-request'), 'session-a', {
      message: 'hello',
      clientNonce: 'sync-request',
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(invokeSynchronous()).rejects.toMatchObject({
        name: 'TypeError',
        message: 'legacy prompt validation failed',
      })
    }
    expect(synchronous.promptAttempts()).toBe(1)
  })

  it('makes ambiguous completion outcome-unknown and never retries callback or mutation', async () => {
    const fixture = createFixture({ failPromptAfterMutation: true })
    const invoke = () => fixture.compatibility.prompt(context('ambiguous-http-request'), 'session-a', {
      message: 'hello',
      clientNonce: 'ambiguous-request',
    })

    await expect(invoke()).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN })
    await expect(invoke()).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN })
    expect(fixture.events.filter((event) => event === 'callback:ambiguous-http-request')).toHaveLength(1)
    expect(fixture.mutations.get('session.prompt')).toBe(1)
  })

  it('documents the Level-B process-lifetime boundary by clearing records with a new ledger', async () => {
    const first = createFixture()
    await first.compatibility.prompt(context('restart-http-request'), 'session-a', {
      message: 'hello',
      clientNonce: 'restart-request',
    })
    const restarted = createFixture()
    await restarted.compatibility.prompt(context('restart-http-request'), 'session-a', {
      message: 'hello',
      clientNonce: 'restart-request',
    })

    expect(first.mutations.get('session.prompt')).toBe(1)
    expect(restarted.mutations.get('session.prompt')).toBe(1)
  })
})
