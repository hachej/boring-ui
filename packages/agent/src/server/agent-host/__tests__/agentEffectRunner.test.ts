import { describe, expect, it } from 'vitest'
import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type VerifiedAgentScopeClaim,
} from '../../../shared/index'
import { runAgentEffect } from '../agentEffectRunner'
import type { AgentHostRuntime } from '../createAgentHost'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import type { AgentRequestKey } from '../types'

const claim: VerifiedAgentScopeClaim = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
}

function requestKey(requestId: string): AgentRequestKey {
  return {
    ...claim,
    operation: 'session.create',
    target: { kind: 'agent', agentTypeId: 'general' },
    requestId,
  }
}

describe('runAgentEffect', () => {
  it('persists a provider receipt when drain begins as the completed action returns', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    let draining = false
    const runtime = {
      ledger,
      effectPolicy: { async evaluate() { return undefined } },
      effectAdmission: {
        async admit() {
          return { type: 'accepted' as const, admissionReceipt: 'accepted' }
        },
      },
      assertOpen() {
        if (draining) {
          throw new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
            'agent host is closing',
          )
        }
      },
      startPreparedEffect: async <T>(_key: AgentRequestKey, effect: () => Promise<T>) => await effect(),
    } as unknown as AgentHostRuntime
    const requestId = 'provider-completed-before-drain'
    const receipt = { agentTypeId: 'general', sessionId: 'session-a' }

    await expect(runAgentEffect(runtime, {
      claim,
      operation: 'session.create',
      target: { kind: 'agent', agentTypeId: 'general' },
      requestId,
      payload: { agentTypeId: 'general' },
      plan: {
        replay: 'exact',
        runExclusive: async (effect) => await effect(),
        prepare: async () => ({ kind: 'ready', context: undefined }),
        execute: async () => {
          // The provider result exists. Starting drain here makes the runner's
          // continuation observe a closing Host before publishing the receipt.
          draining = true
          return receipt
        },
      },
    })).resolves.toEqual(receipt)

    await expect(ledger.read(requestKey(requestId))).resolves.toMatchObject({
      state: 'completed',
      receipt,
    })
  })
})
