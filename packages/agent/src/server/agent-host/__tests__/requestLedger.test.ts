import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import type { AgentRequestKey } from '../types'

const key: AgentRequestKey = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
  operation: 'session.create',
  target: { kind: 'agent', agentTypeId: 'alpha' },
  requestId: 'request-a',
}

describe('InMemoryAgentRequestLedger', () => {
  it('implements pending → accepted → in-flight → completed and acknowledgement replay', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const [first, retry] = await Promise.all([
      ledger.prepare(key, 'digest-a'),
      ledger.prepare(key, 'digest-a'),
    ])
    expect(first.state).toBe('pending-admission')
    expect(retry).toEqual(first)
    await ledger.acceptAdmission(key, 'admission-a')
    await ledger.beginEffect(key)
    await ledger.complete(key, { accepted: true })
    expect(await ledger.prepare(key, 'digest-a')).toMatchObject({
      state: 'completed',
      receipt: { accepted: true },
    })
    await expect(ledger.prepare(key, 'digest-b')).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
  })

  it('retains stable strong rejection while retryable admission leaves pending', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    await ledger.prepare(key, 'digest-a')
    expect((await ledger.read(key))?.state).toBe('pending-admission')
    await ledger.reject(key, {
      kind: 'gateway',
      error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
    })
    expect(await ledger.read(key)).toMatchObject({ state: 'rejected' })
  })

  it('permits outcome-unknown only from in-flight', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    await ledger.prepare(key, 'digest-a')
    await expect(ledger.markOutcomeUnknown(key, {
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
      message: 'unknown',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    await ledger.acceptAdmission(key, 'admission-a')
    await ledger.beginEffect(key)
    await ledger.markOutcomeUnknown(key, {
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
      message: 'unknown',
    })
    expect(await ledger.read(key)).toMatchObject({ state: 'outcome-unknown' })
  })
})
