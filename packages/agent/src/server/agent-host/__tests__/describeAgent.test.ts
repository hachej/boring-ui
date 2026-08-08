import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import {
  createAgentHostRuntimeCapabilityProjection,
  createAgentHostRuntimeCapabilityRoutes,
} from '../runtimeCapabilityProjection'
import type { McpGrant } from '../mcpGrants'

const agents = [
  {
    agentTypeId: 'concierge',
    definition: { instructions: 'You are the concierge.', label: 'Concierge' },
    plugins: [{ name: 'ask-user' }, { name: 'pr-review', config: { mode: 'strict' } }],
    model: { preferred: 'pi-large' },
  },
  { agentTypeId: 'default', legacyDefault: true as const },
]

function createProjection(options: {
  grants?: readonly McpGrant[]
  refs?: readonly string[]
} = {}) {
  const runtime = {
    options: {},
    compiledAgents: agents,
    compiledById: new Map(agents.map((agent) => [agent.agentTypeId, agent])),
    registerSubscription: () => () => {},
    verify: async () => ({ workspaceScopeId: 'ws-1', authSubjectId: 'user-1' }),
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
  test('projects system prompt and plugins from the compiled spec', async () => {
    const projection = createProjection()
    const description = await projection.describeAgent({ request: {} as never, agentTypeId: 'concierge' })
    expect(description).toEqual({
      agentTypeId: 'concierge',
      label: 'Concierge',
      systemPrompt: 'You are the concierge.',
      model: 'pi-large',
      plugins: [{ id: 'ask-user' }, { id: 'pr-review' }],
      mcpServers: [],
    })
  })

  test('legacy default agent describes with no prompt or plugins', async () => {
    const projection = createProjection()
    const description = await projection.describeAgent({ request: {} as never, agentTypeId: 'default' })
    expect(description).toEqual({
      agentTypeId: 'default',
      label: 'Agent',
      systemPrompt: null,
      model: null,
      plugins: [],
      mcpServers: [],
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

  test('route serves the description and rejects unknown agents with a stable code', async () => {
    const app = Fastify({ logger: false })
    await app.register(createAgentHostRuntimeCapabilityRoutes(createProjection()))
    const ok = await app.inject({ method: 'GET', url: '/api/v1/agents/concierge/describe' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ agentTypeId: 'concierge', label: 'Concierge' })
    const missing = await app.inject({ method: 'GET', url: '/api/v1/agents/nope/describe' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ error: { code: AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN } })
    await app.close()
  })
})
