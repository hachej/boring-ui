import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FULL_APP_MCP_MANAGED_AGENT_ENDPOINT,
  FULL_APP_MCP_MANAGED_AGENT_SECRET_CANARY,
  createFullAppMcpManagedAgentComposition,
  readFullAppMcpManagedAgentConfig,
  registerFullAppMcpManagedAgentRoutes,
  type FullAppMcpManagedAgentComposition,
} from '../mcpManagedAgent'
import {
  MANAGED_AGENT_MCP_DELIVERY_RULE,
  MANAGED_AGENT_MCP_INLINE_ARTIFACT_CONTENT_MAX_CHARS,
  type AgentMeteringSink,
  type ManagedAgentCollectArtifactsInput,
} from '@hachej/boring-agent/server'
import type {
  Agent,
  AgentEvent,
  AgentReadiness,
  AgentResolveInputResponse,
  AgentSendInput,
  AgentStartReceipt,
  AgentStreamOptions,
  SessionCtx,
  SessionDetail,
  SessionStore,
  SessionSummary,
} from '@hachej/boring-agent/shared'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'

const WORKSPACE_ID = 'workspace-1'
const USER_ID = 'user-1'
const MCP_TOKEN = 'test-token'
const CTX: SessionCtx = { workspaceId: WORKSPACE_ID, userId: USER_ID }

const servers: CoreWorkspaceAgentServer[] = []

afterEach(async () => {
  while (servers.length) await servers.pop()!.close()
})

describe('full-app M1 MCP managed agent composition', () => {
  it('is dark by default and documents the shared inline cutoff in config', () => {
    const config = readFullAppMcpManagedAgentConfig({} as NodeJS.ProcessEnv)

    expect(config.enabled).toBe(false)
    expect(config.endpointPath).toBe(FULL_APP_MCP_MANAGED_AGENT_ENDPOINT)
    expect(config.inlineArtifactContentMaxChars).toBe(MANAGED_AGENT_MCP_INLINE_ARTIFACT_CONTENT_MAX_CHARS)
  })

  it('stores returned Markdown as a workspace-relative artifact when no tool-published artifact exists', async () => {
    const workspaceRootBase = await mkdtemp(join(tmpdir(), 'full-app-m1-workspaces-'))
    const config = readFullAppMcpManagedAgentConfig({
      BORING_M1_MCP_MANAGED_AGENT_ENABLED: '1',
      BORING_M1_MCP_WORKSPACE_ID: WORKSPACE_ID,
      BORING_M1_MCP_USER_ID: USER_ID,
      BORING_AGENT_WORKSPACE_ROOT: workspaceRootBase,
    } as NodeJS.ProcessEnv)
    const composition = createFullAppMcpManagedAgentComposition(config)

    const refs = await composition.collectArtifacts({
      delegationId: 'delegation-1',
      sessionId: 'session-1',
      ctx: CTX,
      finalAssistantText: '# Outreach result\n\nReady.',
      events: [],
    })

    const [ref] = refs
    expect(ref).toEqual({
      path: 'artifacts/mcp-managed-agent/session-1/delegation-1.md',
      mediaType: 'text/markdown',
      title: 'Delegated brief result',
      content: '# Outreach result\n\nReady.\n',
    })
    if (!ref?.path) throw new Error('expected artifact path')
    await expect(readFile(join(workspaceRootBase, WORKSPACE_ID, ref.path), 'utf8')).resolves.toBe('# Outreach result\n\nReady.\n')
    await composition.agent.dispose()
  })

  it('serves the vertical delegate endpoint to a stock Streamable HTTP MCP client', async () => {
    const agent = new FakeAgent()
    const collectCalls: ManagedAgentCollectArtifactsInput[] = []
    const app = routeHarness({
      agent,
      collectArtifacts: async (input) => {
        collectCalls.push(input)
        return [{ path: 'out/result.md', mediaType: 'text/markdown', content: '# Result\nDone.' }]
      },
    })
    const endpoint = await listen(app)
    const client = new Client({ name: 'full-app-m1-test-client', version: '0.0.0-test' })

    await connectClient(client, endpoint)
    const result = await client.callTool({
      name: 'delegate_task',
      arguments: { brief: 'prepare the outreach memo', workspaceId: 'caller-spoof' },
    })
    await client.close()

    expect(result.isError).not.toBe(true)
    expect(agent.starts).toHaveLength(1)
    expect(agent.starts[0]).toMatchObject({ ctx: CTX, originSurface: 'mcp-managed-agent' })
    expect(collectCalls[0]).toMatchObject({ delegationId: expect.any(String), sessionId: 'session-1', ctx: CTX })
    expect(result.structuredContent).toMatchObject({
      delegationId: expect.any(String),
      status: 'completed',
      finalAssistantText: 'Final answer',
      artifacts: [{ path: 'out/result.md', mediaType: 'text/markdown', content: '# Result\nDone.' }],
      inlineArtifactContentMaxChars: MANAGED_AGENT_MCP_INLINE_ARTIFACT_CONTENT_MAX_CHARS,
      deliveryRule: MANAGED_AGENT_MCP_DELIVERY_RULE,
    })
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/^\/|\/tmp|pi-sessions|shareUrl|shareLink|\/share\//i)
  })

  it('requires bearer auth without changing the stock MCP endpoint shape', async () => {
    const app = routeHarness({
      agent: new FakeAgent(),
      collectArtifacts: async () => [{ path: 'out/result.md', content: '# ok' }],
    })
    await app.ready()

    const rejected = await app.inject({
      method: 'POST',
      url: FULL_APP_MCP_MANAGED_AGENT_ENDPOINT,
      payload: {},
    })
    expect(rejected.statusCode).toBe(401)

    const endpoint = await listen(app)
    const client = new Client({ name: 'full-app-m1-auth-client', version: '0.0.0-test' })
    await connectClient(client, endpoint)
    const result = await client.callTool({ name: 'delegate_task', arguments: { brief: 'memo' } })
    await client.close()

    expect(result.isError).not.toBe(true)
  })

  it('requires a bearer token when the endpoint is enabled', () => {
    expect(() => routeHarness({
      bearerToken: null,
      agent: new FakeAgent(),
      collectArtifacts: async () => [{ path: 'out/result.md', content: '# ok' }],
    })).toThrow(/BORING_M1_MCP_BEARER_TOKEN is required/)
  })

  it('requires a host-selected user when metering is wired', () => {
    expect(() => routeHarness({
      agent: new FakeAgent(),
      collectArtifacts: async () => [{ path: 'out/result.md', content: '# ok' }],
      metering: fakeMetering(),
      env: { BORING_M1_MCP_USER_ID: undefined },
    })).toThrow(/BORING_M1_MCP_USER_ID is required/)
  })

  it('blocks configured secret canaries from caller-visible MCP results', async () => {
    const app = routeHarness({
      agent: new FakeAgent({ finalText: `contains ${FULL_APP_MCP_MANAGED_AGENT_SECRET_CANARY}` }),
      collectArtifacts: async () => [{ path: 'out/result.md', content: '# ok' }],
    })
    const endpoint = await listen(app)
    const client = new Client({ name: 'full-app-m1-leak-client', version: '0.0.0-test' })

    await connectClient(client, endpoint)
    const result = await client.callTool({ name: 'delegate_task', arguments: { brief: 'leak check' } })
    await client.close()

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.structuredContent)).not.toContain(FULL_APP_MCP_MANAGED_AGENT_SECRET_CANARY)
  })

  it('blocks host paths from caller-visible MCP results', async () => {
    const hostPath = process.cwd()
    const app = routeHarness({
      agent: new FakeAgent({ finalText: `contains ${hostPath}` }),
      collectArtifacts: async () => [{ path: 'out/result.md', content: '# ok' }],
    })
    const endpoint = await listen(app)
    const client = new Client({ name: 'full-app-m1-host-path-client', version: '0.0.0-test' })

    await connectClient(client, endpoint)
    const result = await client.callTool({ name: 'delegate_task', arguments: { brief: 'host path leak check' } })
    await client.close()

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.structuredContent)).not.toContain(hostPath)
  })
})

function routeHarness(options: {
  agent: Agent
  collectArtifacts: FullAppMcpManagedAgentComposition['collectArtifacts']
  bearerToken?: string | null
  metering?: AgentMeteringSink
  env?: NodeJS.ProcessEnv
}): CoreWorkspaceAgentServer {
  const app = Fastify({ logger: false }) as unknown as CoreWorkspaceAgentServer
  app.decorate('config', { appId: 'full-app-test' } as never)
  app.decorate('workspaceStore', {
    async get(workspaceId: string) {
      return workspaceId === CTX.workspaceId
        ? { id: workspaceId, appId: 'full-app-test', name: 'Workspace', createdBy: CTX.userId, createdAt: '2026-07-06T00:00:00.000Z', deletedAt: null, isDefault: true }
        : null
    },
    async getMemberRole(workspaceId: string, userId: string) {
      return workspaceId === CTX.workspaceId && userId === CTX.userId ? 'owner' : null
    },
  } as never)
  registerFullAppMcpManagedAgentRoutes(app, {
    env: {
      BORING_M1_MCP_MANAGED_AGENT_ENABLED: '1',
      BORING_M1_MCP_WORKSPACE_ID: WORKSPACE_ID,
      BORING_M1_MCP_USER_ID: USER_ID,
      ...(options.bearerToken !== null ? { BORING_M1_MCP_BEARER_TOKEN: options.bearerToken ?? MCP_TOKEN } : {}),
      ...(options.env ?? {}),
    } as NodeJS.ProcessEnv,
    metering: options.metering,
    composition: {
      agent: options.agent,
      collectArtifacts: options.collectArtifacts,
    },
  })
  return app
}

async function connectClient(client: Client, endpoint: string, token = MCP_TOKEN): Promise<void> {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }))
}

function fakeMetering(): AgentMeteringSink {
  return {
    reserveRun: async () => ({}),
    recordUsage: async () => ({ billedMicros: 0 }),
    settleRun: async () => {},
    releaseRun: async () => {},
  }
}

async function listen(app: CoreWorkspaceAgentServer): Promise<string> {
  if (!app.server.listening) {
    await app.listen({ host: '127.0.0.1', port: 0 })
    servers.push(app)
  }
  const { port } = app.server.address() as AddressInfo
  return `http://127.0.0.1:${port}${FULL_APP_MCP_MANAGED_AGENT_ENDPOINT}`
}

function event(eventIndex: number, sessionId: string, chunk: AgentEvent['chunk']): AgentEvent {
  return {
    v: 1,
    eventIndex,
    timestamp: Date.parse('2026-07-06T00:00:00.000Z') + eventIndex,
    sessionId,
    chunk,
  }
}

class FakeAgent implements Agent {
  readonly starts: AgentSendInput[] = []
  readonly sessions: SessionStore = new FakeSessionStore()
  readonly readiness: AgentReadiness = { requirements: [], status: async () => [] }
  private created = 0

  constructor(private readonly options: { finalText?: string } = {}) {}

  async start(input: AgentSendInput): Promise<AgentStartReceipt> {
    this.starts.push(input)
    this.created += 1
    return { sessionId: `session-${this.created}`, startIndex: 0 }
  }

  async *stream(sessionId: string, _options: AgentStreamOptions): AsyncIterable<AgentEvent> {
    yield event(0, sessionId, { type: 'agent-start', seq: 0, turnId: 'turn-1' })
    yield event(1, sessionId, {
      type: 'message-end',
      seq: 1,
      messageId: 'a1',
      final: {
        id: 'a1',
        role: 'assistant',
        status: 'done',
        parts: [{ type: 'text', text: this.options.finalText ?? 'Final answer' }],
      },
    })
    yield event(2, sessionId, { type: 'agent-end', seq: 2, turnId: 'turn-1', status: 'ok' })
  }

  async *send(input: AgentSendInput): AsyncIterable<AgentEvent> {
    const receipt = await this.start(input)
    yield* this.stream(receipt.sessionId, { startIndex: receipt.startIndex, ctx: input.ctx })
  }

  async resolveInput(_sessionId: string, _requestId: string, _response: AgentResolveInputResponse): Promise<never> {
    throw new Error('not implemented') as never
  }

  async interrupt(): Promise<unknown> {
    return undefined
  }

  async stop(): Promise<unknown> {
    return undefined
  }

  async dispose(): Promise<void> {}
}

class FakeSessionStore implements SessionStore {
  async list(_ctx: SessionCtx, _options?: Parameters<SessionStore['list']>[1]): Promise<SessionSummary[]> {
    return []
  }

  async create(_ctx: SessionCtx): Promise<SessionSummary> {
    return summary('session')
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    return summary(sessionId)
  }

  async delete(): Promise<void> {}
}

function summary(id: string): SessionSummary {
  return {
    id,
    title: id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    turnCount: 0,
  }
}
