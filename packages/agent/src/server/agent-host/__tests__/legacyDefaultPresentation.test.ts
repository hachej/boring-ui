import { describe, expect, it } from 'vitest'
import type { AgentHostAgentSpec } from '../types'
import { createEmbeddedGatewayFixture } from './embeddedGatewayFixture'

const LEGACY_DEFAULT = { agentTypeId: 'default', legacyDefault: true } as const
const CONFIGURED_FLEET: readonly AgentHostAgentSpec[] = [
  LEGACY_DEFAULT,
  { agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } },
  { agentTypeId: 'beta', definition: { instructions: 'beta', label: 'Beta' } },
]

describe('legacy default presentation (gh-1296)', () => {
  it('labels the legacy default as the fallback, not as an authored seat', async () => {
    const fixture = await createEmbeddedGatewayFixture({ agents: CONFIGURED_FLEET })
    const scope = fixture.issueScope({ workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' })

    expect(await fixture.gateway.listAgents({ scope })).toEqual([
      { agentTypeId: 'default', label: 'default', legacy: true },
      { agentTypeId: 'alpha', label: 'Alpha' },
      { agentTypeId: 'beta', label: 'Beta' },
    ])
  })

  it('keeps the single-agent boot byte-identical and creation-capable', async () => {
    const fixture = await createEmbeddedGatewayFixture({ agents: [LEGACY_DEFAULT] })
    const scope = fixture.issueScope({ workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' })

    expect(await fixture.gateway.listAgents({ scope })).toEqual([{ agentTypeId: 'default', label: 'Agent' }])
    await expect(fixture.gateway.createSession({
      scope,
      agentTypeId: 'default',
      requestId: 'fallback-only-create',
    })).resolves.toMatchObject({ agentTypeId: 'default' })
  })

  it('rejects direct creation on the history-only fallback beside an authored fleet', async () => {
    const fixture = await createEmbeddedGatewayFixture({ agents: CONFIGURED_FLEET })
    const scope = fixture.issueScope({ workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' })

    await expect(fixture.gateway.createSession({
      scope,
      agentTypeId: 'default',
      requestId: 'forbidden-legacy-create',
    })).rejects.toMatchObject({
      code: 'AGENT_COMMAND_INVALID_STATE',
      message: 'legacy default agent is available for history only',
    })
    await expect(fixture.gateway.listSessions({ scope, agentTypeId: 'default' }))
      .resolves.toEqual({ sessions: [] })
  })

  it('keeps sessions bound to `default` addressable, listed and readable beside a fleet', async () => {
    const fixture = await createEmbeddedGatewayFixture({ agents: CONFIGURED_FLEET })
    const scope = fixture.issueScope({ workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' })
    // Seed a chat created before the authored fleet existed without using the
    // now-forbidden public creation path.
    const legacyRef = await fixture.seedSession({
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'default',
      title: 'Legacy chat',
    })
    const seatRef = await fixture.gateway.createSession({
      scope,
      agentTypeId: 'alpha',
      requestId: 'seat-chat',
      title: 'Seat chat',
    })

    // The presentation change must not touch reachability: the legacy chat is
    // still enumerated fleet-wide, still enumerated under its own agent, and
    // still opens.
    const all = await fixture.gateway.listSessions({ scope })
    expect(all.sessions.map((row) => row.ref)).toEqual(expect.arrayContaining([legacyRef, seatRef]))
    const addressed = await fixture.gateway.listSessions({ scope, agentTypeId: 'default' })
    expect(addressed.sessions.map((row) => row.ref)).toEqual([legacyRef])
    await expect(fixture.gateway.readSessionState({ scope, ref: legacyRef })).resolves.toMatchObject({
      ref: legacyRef,
    })
  })
})
