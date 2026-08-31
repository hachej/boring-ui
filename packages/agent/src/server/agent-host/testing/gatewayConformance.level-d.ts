import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import type { GatewayConformanceFixture } from './gatewayConformance'

/** A future Level-D fixture opts in explicitly; the Level-B type remains untouched. */
export interface GatewayLevelDFixture extends GatewayConformanceFixture {
  restart(): Promise<GatewayLevelDFixture>
  /** Deterministically pauses after durable beginEffect and before completion. */
  holdNextEffectInFlight(): Promise<{ reached: Promise<void>; release(): void }>
}

export function gatewayLevelDRequestLedgerConformance(
  createFixture: () => Promise<GatewayLevelDFixture>,
): void {
  const sameScope = (fixture: GatewayLevelDFixture): AuthorizedAgentScope => fixture.issueScope({
    workspaceScopeId: 'workspace-a',
    authSubjectId: 'subject-a',
  })

  describe('AgentGateway Level D durable request ledger', () => {
    it('replays receipts and create/delete tombstones across restart', async () => {
      let fixture = await createFixture()
      let scope = sameScope(fixture)
      const createInput = { scope, agentTypeId: 'alpha', requestId: 'durable-create', title: 'Durable' }
      const ref = await fixture.gateway.createSession(createInput)

      fixture = await fixture.restart()
      scope = sameScope(fixture)
      await expect(fixture.gateway.createSession({ ...createInput, scope })).resolves.toEqual(ref)
      await fixture.gateway.deleteSession({ scope, ref, requestId: 'durable-delete' })

      fixture = await fixture.restart()
      scope = sameScope(fixture)
      await expect(fixture.gateway.deleteSession({ scope, ref, requestId: 'durable-delete' })).resolves.toBeUndefined()
      await expect(fixture.gateway.readSessionState({ scope, ref })).rejects.toMatchObject({
        code: AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND,
      })
    })

    it('replays acknowledged work and fences a crashed in-flight effect as outcome-unknown', async () => {
      let fixture = await createFixture()
      let scope = sameScope(fixture)
      const ref = await fixture.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'matrix-create' })
      let connection = await fixture.gateway.connectSession({ scope, ref })
      const acknowledged = { kind: 'prompt' as const, requestId: 'matrix-ack', clientNonce: 'matrix-ack', content: 'acknowledged' }
      const receipt = await connection.send(acknowledged)
      await connection.close()

      fixture = await fixture.restart()
      scope = sameScope(fixture)
      connection = await fixture.gateway.connectSession({ scope, ref })
      await expect(connection.send(acknowledged)).resolves.toMatchObject({ ...receipt, duplicate: true })

      const hold = await fixture.holdNextEffectInFlight()
      const crashed = { kind: 'followup' as const, requestId: 'matrix-crash', clientNonce: 'matrix-crash', clientSeq: 1, content: 'crash' }
      const pending = connection.send(crashed)
      await hold.reached
      fixture = await fixture.restart()
      hold.release()
      await pending.catch(() => undefined)
      scope = sameScope(fixture)
      connection = await fixture.gateway.connectSession({ scope, ref })
      await expect(connection.send(crashed)).rejects.toMatchObject({
        code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
      })
      await connection.close()
    })
  })
}
