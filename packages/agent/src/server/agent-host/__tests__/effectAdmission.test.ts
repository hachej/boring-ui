import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import type { AgentGatewayEffect } from '../types'
import { createEmbeddedGatewayFixture } from './embeddedGatewayFixture'

const denied = { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED }

async function createSession() {
  const fixture = await createEmbeddedGatewayFixture()
  const scope = fixture.issueScope()
  const ref = await fixture.gateway.createSession({
    scope,
    agentTypeId: 'alpha',
    requestId: 'create-session',
    title: 'Original title',
  })
  return { fixture, scope, ref }
}

describe('Embedded Agent Gateway strong effect admission', () => {
  it('records a strong create rejection before mutation and replays it without readmission', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scope = fixture.issueScope()
    fixture.queueAdmission('session.create', 'strong-reject')

    const input = { scope, agentTypeId: 'alpha', requestId: 'denied-create' }
    await expect(fixture.gateway.createSession(input)).rejects.toMatchObject(denied)
    await expect(fixture.gateway.createSession(input)).rejects.toMatchObject(denied)
    await expect(fixture.gateway.listSessions({ scope, agentTypeId: 'alpha' })).resolves.toEqual({ sessions: [] })
  })

  it('leaves retryable admission pending so the same request can be safely admitted later', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scope = fixture.issueScope()
    fixture.queueAdmission('session.create', 'retryable')
    const input = { scope, agentTypeId: 'alpha', requestId: 'retry-create' }

    await expect(fixture.gateway.createSession(input)).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
    })
    const accepted = await fixture.gateway.createSession(input)
    await expect(fixture.gateway.createSession(input)).resolves.toEqual(accepted)
    await expect(fixture.gateway.listSessions({ scope, agentTypeId: 'alpha' })).resolves.toMatchObject({
      sessions: [expect.objectContaining({ ref: accepted })],
    })
  })

  it('admits rename and delete before either session mutation', async () => {
    const { fixture, scope, ref } = await createSession()
    fixture.queueAdmission('session.rename', 'strong-reject')
    await expect(fixture.gateway.renameSession({
      scope,
      ref,
      requestId: 'denied-rename',
      title: 'Forbidden title',
    })).rejects.toMatchObject(denied)
    await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({
      summary: { title: 'Original title' },
    })

    fixture.queueAdmission('session.delete', 'strong-reject')
    await expect(fixture.gateway.deleteSession({
      scope,
      ref,
      requestId: 'denied-delete',
    })).rejects.toMatchObject(denied)
    await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({ ref })
  })

  it('keeps active runtime activity running when Resume is admitted as a no-op', async () => {
    const { fixture, scope, ref } = await createSession()
    const connection = await fixture.gateway.connectSession({ scope, ref })
    fixture.setActivity(ref, 'running')

    try {
      await expect(connection.interrupt({ requestId: 'active-resume', queueAction: 'resume' })).resolves.toMatchObject({
        accepted: true,
      })
      await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({
        summary: { status: 'running' },
        state: { status: 'streaming' },
      })
    } finally {
      await connection.close()
    }
  })

  it('applies strong admission to prompt, follow-up, interrupt, stop, and queue clear', async () => {
    const { fixture, scope, ref } = await createSession()
    const connection = await fixture.gateway.connectSession({ scope, ref })
    const effects: Array<{
      effect: AgentGatewayEffect
      run: () => Promise<unknown>
    }> = [
      {
        effect: 'session.prompt',
        run: () => connection.send({
          kind: 'prompt',
          requestId: 'denied-prompt',
          clientNonce: 'prompt-nonce',
          content: 'prompt',
        }),
      },
      {
        effect: 'session.followup',
        run: () => connection.send({
          kind: 'followup',
          requestId: 'denied-followup',
          clientNonce: 'followup-nonce',
          clientSeq: 1,
          content: 'follow up',
        }),
      },
      {
        effect: 'session.interrupt',
        run: () => connection.interrupt({ requestId: 'denied-interrupt' }),
      },
      {
        effect: 'session.stop',
        run: () => connection.stop({ requestId: 'denied-stop' }),
      },
      {
        effect: 'session.queue.clear',
        run: () => connection.clearQueue({ requestId: 'denied-clear' }),
      },
    ]

    try {
      for (const entry of effects) {
        fixture.queueAdmission(entry.effect, 'strong-reject')
        await expect(entry.run()).rejects.toMatchObject(denied)
      }
      expect(fixture.modelLoopStarts(ref)).toBe(0)
      await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({
        state: { status: 'idle', queue: { followUps: [] } },
      })
    } finally {
      await connection.close()
    }
  })
})
