import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { createEmbeddedGatewayFixture } from './embeddedGatewayFixture'

describe('embedded session isolation', () => {
  it('keeps two workspace scopes and two agent types partitioned', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scopeA = fixture.issueScope({ workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' })
    const scopeB = fixture.issueScope({ workspaceScopeId: 'workspace-b', authSubjectId: 'subject-b' })
    const alphaA = await fixture.gateway.createSession({ scope: scopeA, agentTypeId: 'alpha', requestId: 'alpha-a', title: 'alpha-a' })
    const betaA = await fixture.gateway.createSession({ scope: scopeA, agentTypeId: 'beta', requestId: 'beta-a', title: 'beta-a' })
    const alphaB = await fixture.gateway.createSession({ scope: scopeB, agentTypeId: 'alpha', requestId: 'alpha-b', title: 'alpha-b' })

    expect((await fixture.gateway.listSessions({ scope: scopeA })).sessions.map((row) => row.ref))
      .toEqual(expect.arrayContaining([alphaA, betaA]))
    expect((await fixture.gateway.listSessions({ scope: scopeA })).sessions.map((row) => row.ref)).not.toContainEqual(alphaB)
    await expect(fixture.gateway.readSessionState({ scope: scopeB, ref: alphaA })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND,
    })
  })

  it('coalesces concurrent retries into one session and one receipt', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scope = fixture.issueScope()
    const [first, retry] = await Promise.all([
      fixture.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'same-request' }),
      fixture.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'same-request' }),
    ])
    expect(retry).toEqual(first)
    expect((await fixture.gateway.listSessions({ scope, agentTypeId: 'alpha' })).sessions).toHaveLength(1)
  })
})
