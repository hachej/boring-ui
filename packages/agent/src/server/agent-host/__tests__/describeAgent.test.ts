import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Fastify from 'fastify'
import { beforeAll, describe, expect, test } from 'vitest'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../../shared/index'
import {
  createAgentHostRuntimeCapabilityProjection,
  createAgentHostRuntimeCapabilityRoutes,
} from '../runtimeCapabilityProjection'
import type { McpGrant } from '../mcpGrants'

/**
 * One persona tree on disk, reachable from two DIFFERENT served roots. The
 * fleet spec below is composed once and shared by both, which is exactly the
 * CLI hub's shape (gh-1189).
 */
let hubRoot = ''
/** The workspace that actually contains the persona package. */
let workspaceWithPersona = ''
/** A sibling workspace the same host also serves; the persona is outside it. */
let workspaceWithoutPersona = ''
let personaInstructionsPath = ''

beforeAll(async () => {
  hubRoot = await mkdtemp(join(tmpdir(), 'describe-agent-'))
  workspaceWithPersona = join(hubRoot, 'project-a')
  workspaceWithoutPersona = join(hubRoot, 'project-b')
  const personaDir = join(workspaceWithPersona, '.agents', 'personas', 'concierge-seat')
  await mkdir(personaDir, { recursive: true })
  await mkdir(workspaceWithoutPersona, { recursive: true })
  personaInstructionsPath = join(personaDir, 'instructions.md')
  await writeFile(personaInstructionsPath, 'You are the concierge.\n')
  return async () => { await rm(hubRoot, { recursive: true, force: true }) }
})

const agents = [
  {
    agentTypeId: 'concierge',
    definition: { instructions: 'You are the concierge.', label: 'Concierge' },
    get instructionSources() {
      return [{ absolutePath: personaInstructionsPath, role: 'persona' as const }]
    },
    plugins: [{ name: 'ask-user' }, { name: 'pr-review', config: { mode: 'strict' } }],
    model: { preferred: 'pi-large' },
  },
  { agentTypeId: 'default', legacyDefault: true as const },
]

function createProjection(options: {
  grants?: readonly McpGrant[]
  refs?: readonly string[]
  /** Host hook that decides whether THIS subject may reach THIS agentTypeId. */
  resolveAgentRuntimeScope?: (agentTypeId: string) => Promise<unknown>
  /** Mirrors createAgentHost: `verify` asserts the host is open first. */
  draining?: boolean
  /** Root the `user` filesystem serves for the request under test. */
  workspaceRoot?: string
} = {}) {
  const runtime = {
    options: {},
    compiledAgents: agents,
    compiledById: new Map(agents.map((agent) => [agent.agentTypeId, agent])),
    registerSubscription: () => () => {},
    verify: async () => {
      if (options.draining) {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
      }
      return { workspaceScopeId: 'ws-1', authSubjectId: 'user-1' }
    },
    resolveAgentRuntimeScope: async (agentTypeId: string) => (
      options.resolveAgentRuntimeScope
        ? await options.resolveAgentRuntimeScope(agentTypeId)
        : {
            identity: `scope:${agentTypeId}`,
            environment: { workspaceRoot: options.workspaceRoot ?? workspaceWithPersona },
          }
    ),
  }
  return createAgentHostRuntimeCapabilityProjection({
    runtime: runtime as never,
    gateway: {} as never,
    options: {
      authorizeAgentRequest: async () => ({ workspaceScopeId: 'ws-1', authSubjectId: 'user-1' }) as never,
    },
    ...(options.refs
      ? {
          mcpGrants: {
            store: { listGrants: async () => ({ grants: options.grants ?? [], diagnostics: [] }) } as never,
            getMcpServerRefs: () => options.refs,
          },
        }
      : {}),
  })
}

describe('describeAgent', () => {
  test('addresses instruction refs against the root serving THIS request', async () => {
    const projection = createProjection()
    const description = await projection.describeAgent({ request: {} as never, agentTypeId: 'concierge' })
    expect(description).toEqual({
      agentTypeId: 'concierge',
      model: 'pi-large',
      mcpServers: [],
      // The seat directory is NOT derivable from the agent id; the Host is
      // the only component that knows it.
      instructionFiles: [{ filesystem: 'user', path: '.agents/personas/concierge-seat/instructions.md', role: 'persona' }],
    })
  })

  test('the same spec serves a working ref to one workspace and withholds for another', async () => {
    // gh-1189: the CLI hub composes ONE fleet and serves a different root per
    // registered workspace. Fixing the ref at composition time made every hub
    // seat linkless; resolving per request makes the link work wherever the
    // persona is actually reachable, and withholds it where it is not.
    const served = await createProjection({ workspaceRoot: workspaceWithPersona })
      .describeAgent({ request: {} as never, agentTypeId: 'concierge' })
    expect(served.instructionFiles).toEqual([
      { filesystem: 'user', path: '.agents/personas/concierge-seat/instructions.md', role: 'persona' },
    ])

    // Same host, same compiled spec, a workspace the persona is outside of: a
    // ref here would be well-formed and dead, so it is withheld.
    const other = await createProjection({ workspaceRoot: workspaceWithoutPersona })
      .describeAgent({ request: {} as never, agentTypeId: 'concierge' })
    expect(other.instructionFiles).toEqual([])

    // The hub root itself contains both workspaces, so the ref is relative to
    // it instead — proof the path is a function of the request, not of boot.
    const atHubRoot = await createProjection({ workspaceRoot: hubRoot })
      .describeAgent({ request: {} as never, agentTypeId: 'concierge' })
    expect(atHubRoot.instructionFiles).toEqual([
      { filesystem: 'user', path: 'project-a/.agents/personas/concierge-seat/instructions.md', role: 'persona' },
    ])
  })

  test('a withheld ref is logged with the stable diagnostic code', async () => {
    const warnings: { code?: string }[] = []
    const request = { log: { warn: (payload: { code?: string }) => { warnings.push(payload) } } }
    const description = await createProjection({ workspaceRoot: workspaceWithoutPersona })
      .describeAgent({ request: request as never, agentTypeId: 'concierge' })

    expect(description.instructionFiles).toEqual([])
    expect(warnings).toEqual([expect.objectContaining({
      agentTypeId: 'concierge',
      code: 'AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE',
    })])
  })

  test('legacy default agent describes with no model or instruction refs', async () => {
    const projection = createProjection()
    const description = await projection.describeAgent({ request: {} as never, agentTypeId: 'default' })
    expect(description).toEqual({
      agentTypeId: 'default',
      model: null,
      mcpServers: [],
      instructionFiles: [],
    })
  })

  test('mcp servers are default-deny: only granted connectors surface', async () => {
    const projection = createProjection({
      refs: ['github', 'linear'],
      grants: [{
        workspaceId: 'ws-1',
        agentTypeId: 'concierge',
        connectorId: 'github',
        allowedTools: ['create_issue'],
      }],
    })
    const description = await projection.describeAgent({ request: {} as never, agentTypeId: 'concierge' })
    expect(description.mcpServers).toEqual([{ id: 'github', tools: ['create_issue'] }])
  })

  test('describe is gated by the SAME per-agent host hook as its sibling routes', async () => {
    // A subject authorized for the workspace but denied this agent must not
    // read its model, instruction paths or granted MCP
    // connectors. Workspace-scope authorization alone does not answer this.
    const seen: string[] = []
    const projection = createProjection({
      resolveAgentRuntimeScope: async (agentTypeId) => {
        seen.push(agentTypeId)
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'agent access denied')
      },
    })
    await expect(projection.describeAgent({ request: {} as never, agentTypeId: 'concierge' }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED })
    expect(seen).toEqual(['concierge'])
  })

  test('authorizes BEFORE checking existence, so it is not an agent-existence oracle', async () => {
    // A denied caller must not be able to distinguish "no such agent" from
    // "not yours" — both must fail at the authorization hook.
    const seen: string[] = []
    const projection = createProjection({
      resolveAgentRuntimeScope: async (agentTypeId) => {
        seen.push(agentTypeId)
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'agent access denied')
      },
    })
    await expect(projection.describeAgent({ request: {} as never, agentTypeId: 'nope' }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED })
    expect(seen).toEqual(['nope'])
  })

  test('an authorized caller still gets a stable code for an unknown agent', async () => {
    const projection = createProjection()
    await expect(projection.describeAgent({ request: {} as never, agentTypeId: 'nope' }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN })
  })

  test('stops serving during drain, like every sibling route', async () => {
    // describe does not materialize a binding, so it does not inherit
    // resolveBinding's assertOpen. It is still drain-gated because `authorize`
    // goes through `runtime.verify`, which asserts open first
    // (createAgentHost: `verify(scope) { runtime.assertOpen(); ... }`).
    // Pinned here so that property stops being an inherited accident.
    const projection = createProjection({ draining: true })
    await expect(projection.describeAgent({ request: {} as never, agentTypeId: 'concierge' }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED })
  })

  test('route serves the description and rejects unknown agents with a stable code', async () => {
    const app = Fastify({ logger: false })
    await app.register(createAgentHostRuntimeCapabilityRoutes(createProjection()))
    const ok = await app.inject({ method: 'GET', url: '/api/v1/agents/concierge/describe' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ agentTypeId: 'concierge', model: 'pi-large' })
    // Narrow on purpose: identity and plugin ids come from the fleet list, and
    // the composed prompt left the wire with the details section that read it.
    expect(ok.json()).not.toHaveProperty('label')
    expect(ok.json()).not.toHaveProperty('plugins')
    expect(ok.json()).not.toHaveProperty('systemPrompt')
    const missing = await app.inject({ method: 'GET', url: '/api/v1/agents/nope/describe' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ error: { code: AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN } })
    await app.close()
  })
})
