import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import { createEmbeddedGatewayFixture } from './embeddedGatewayFixture'

describe('EmbeddedAgentGateway safe action failures', () => {
  it('replays a stable pre-dispatch payment rejection instead of outcome-unknown', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scope = fixture.issueScope()
    const ref = await fixture.gateway.createSession({
      scope,
      agentTypeId: 'alpha',
      requestId: 'create-payment-session',
    })
    const connection = await fixture.gateway.connectSession({ scope, ref })
    fixture.rejectNextPrompt(Object.assign(new Error('Top up credits to continue.'), {
      code: ErrorCode.enum.PAYMENT_REQUIRED,
      statusCode: 402,
    }))
    const command = {
      kind: 'prompt' as const,
      requestId: 'payment-prompt',
      clientNonce: 'payment-prompt',
      content: 'hello',
    }

    await expect(connection.send(command)).rejects.toMatchObject({
      code: ErrorCode.enum.PAYMENT_REQUIRED,
      statusCode: 402,
      message: 'Top up credits to continue.',
    })
    await expect(connection.send(command)).rejects.toMatchObject({
      code: ErrorCode.enum.PAYMENT_REQUIRED,
      statusCode: 402,
    })
    expect(fixture.modelLoopStarts(ref)).toBe(0)
    await connection.close()
    await fixture.gateway.close()
  })
})
