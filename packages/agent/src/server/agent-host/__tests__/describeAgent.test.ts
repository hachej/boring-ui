import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../../shared/index'
import {
  createAgentHostRuntimeCapabilityProjection,
  createAgentHostRuntimeCapabilityRoutes,
} from '../runtimeCapabilityProjection'
import type { McpGrant } from '../mcpGrants'

const agents = [
  {
    agentTypeId: 'concierge',
    definition: { instructions: 'You are the concierge.', label: 'Concierge' },
    instructionFiles: [{ filesystem: 'user', path: '.agents/personas/concierge-seat/instructions.md', role: 'persona' }],
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
} = {}) {
  const runtime = {
    options: {},
    compiledAgents: agents,
    compiledById: new Map(agents.map((agent) => [agent.agentTypeId, agent])),
    registerSubscription: () => () => {},
    verify: async () => ({ workspaceScopeId: 'ws-1', authSubjectId: 'user-1' }),
    resolveAgentRuntimeScope: async (agentTypeId: string) => (
      options.resolveAgentRuntimeScope
        ? await options.resolveAgentRuntimeScope(agentTypeId)
        : { identity: `scope:${agentTypeId}` }
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
  test('projects system prompt, model and instruction refs from the compiled spec', async () => {
    const projection = createProjection()
    const description = await projection.describeAgent({ request: {} as never, agentTypeId: 'concierge' })
    expect(description).toEqual({
      agentTypeId: 'concierge',
      systemPrompt: 'You are the concierge.',
      model: 'pi-large',
      mcpServers: [],
      // The seat directory is NOT derivable from the agent id; the Host is
      // the only component that knows it.
      instructionFiles: [{ filesystem: 'user', path: '.agents/personas/concierge-seat/instructions.md', role: 'persona' }],
    })
  })

  test('legacy default agent describes with no prompt or plugins', async () => {
    const projection = createProjection()
    const description = await projection.describeAgent({ request: {} as never, agentTypeId: 'default' })
    expect(description).toEqual({
      agentTypeId: 'default',
      systemPrompt: null,
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
    // read its authored prompt, model, instruction paths or granted MCP
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

  test('an unknown agent is rejected before the authorization hook is consulted', async () => {
    const seen: string[] = []
    const projection = createProjection({
      resolveAgentRuntimeScope: async (agentTypeId) => { seen.push(agentTypeId); return {} },
    })
    await expect(projection.describeAgent({ request: {} as never, agentTypeId: 'nope' }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN })
    expect(seen).toEqual([])
  })

  test('route serves the description and rejects unknown agents with a stable code', async () => {
    const app = Fastify({ logger: false })
    await app.register(createAgentHostRuntimeCapabilityRoutes(createProjection()))
    const ok = await app.inject({ method: 'GET', url: '/api/v1/agents/concierge/describe' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ agentTypeId: 'concierge', systemPrompt: 'You are the concierge.' })
    // Narrow on purpose: identity and plugin ids come from the fleet list.
    expect(ok.json()).not.toHaveProperty('label')
    expect(ok.json()).not.toHaveProperty('plugins')
    const missing = await app.inject({ method: 'GET', url: '/api/v1/agents/nope/describe' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ error: { code: AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN } })
    await app.close()
  })
})
