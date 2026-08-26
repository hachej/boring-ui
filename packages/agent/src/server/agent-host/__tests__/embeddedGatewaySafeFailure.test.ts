import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import { createEmbeddedGatewayFixture } from './embeddedGatewayFixture'

describe('EmbeddedAgentGateway safe action failures', () => {
  it('does not let a connection replay of an old completed turn settle a newer run', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scope = fixture.issueScope()
    const ref = await fixture.gateway.createSession({
      scope,
      agentTypeId: 'alpha',
      requestId: 'create-replay-session',
    })
    fixture.emitSessionEvent(ref, { type: 'agent-start', seq: 0, turnId: 'old-turn' })
    fixture.emitSessionEvent(ref, { type: 'agent-end', seq: 0, turnId: 'old-turn', status: 'ok' })
    // Model the race where the canonical source has delivered a newer start
    // while this connection still has only the old completed turn to replay.
    fixture.observeSessionEvent(ref, { type: 'agent-start', seq: 3, turnId: 'new-turn' })

    const connection = await fixture.gateway.connectSession({ scope, ref, cursor: 0 })

    const summary = (await fixture.gateway.listSessions({ scope, agentTypeId: 'alpha' })).sessions
      .find((session) => session.ref.sessionId === ref.sessionId)
    expect(summary?.status).toBe('running')
    await connection.close()
    await fixture.gateway.close()
  })

  it('replays a stable pre-dispatch payment rejection instead of outcome-unknown', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scope = fixture.issueScope()
    const ref = await fixture.gateway.createSession({
      scope,
      agentTypeId: 'alpha',
      requestId: 'create-payment-session',
    })
    const connection = await fixture.gateway.connectSession({ scope, ref })
    const published: string[] = []
    const unsubscribeActivity = fixture.subscribeActivity(scope, (update) => {
      if (update.ref.agentTypeId === ref.agentTypeId && update.ref.sessionId === ref.sessionId) {
        published.push(update.status)
      }
    })
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
    expect(published).toEqual([])
    expect((await fixture.gateway.readSessionState({ scope, ref })).summary.status).toBe('idle')
    unsubscribeActivity()
    await connection.close()
    await fixture.gateway.close()
  })
})
