import { describe, expect, it } from 'vitest'

import { createEmbeddedGatewayFixture } from '../../__tests__/embeddedGatewayFixture'
import { gatewayConformance } from '../gatewayConformance'

gatewayConformance({
  createFixture: createEmbeddedGatewayFixture,
  replayLevel: 'B',
  paginationLevel: 'keyset',
})

describe('EmbeddedAgentGateway admission liveness', () => {
  it.each(['stop', 'interrupt'] as const)(
    'does not hold the session writer against %s while prompt effect admission is pending',
    async (control) => {
      const fixture = await createEmbeddedGatewayFixture()
      const scope = fixture.issueScope()
      const ref = await fixture.gateway.createSession({
        scope,
        agentTypeId: 'alpha',
        requestId: 'create-admission-liveness',
      })
      const connection = await fixture.gateway.connectSession({ scope, ref })
      const blocked = fixture.blockAdmission('session.prompt')
      const prompt = connection.send({
        kind: 'prompt',
        requestId: 'blocked-prompt',
        clientNonce: 'blocked-prompt',
        content: 'wait for admission',
        requireIdle: true,
      })
      await blocked.entered

      await expect(connection[control]({ requestId: `${control}-while-prompt-admission-pends` }))
        .resolves.toMatchObject({ accepted: true })

      blocked.release()
      await expect(prompt).resolves.toMatchObject({ accepted: true, disposition: 'prompt' })
      await connection.close()
      await fixture.gateway.close()
    },
  )
})
