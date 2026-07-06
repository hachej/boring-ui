import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'

import Fastify from 'fastify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import {
  FULL_APP_MCP_MANAGED_AGENT_ENDPOINT,
  registerFullAppMcpManagedAgentRoutes,
  type FullAppMcpManagedAgentComposition,
} from '../src/server/mcpManagedAgent.js'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
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
import type { ManagedAgentCollectArtifactsInput } from '@hachej/boring-agent/server'

const WORKSPACE_ID = 'm1-smoke-workspace'
const USER_ID = 'm1-smoke-user'
const MCP_TOKEN = `m1-smoke-${randomUUID()}`
const CTX: SessionCtx = { workspaceId: WORKSPACE_ID, userId: USER_ID }
const BRIEF = [
  'Prepare a concise outreach-demo brief for a platform team evaluating boring-ui.',
  'Include target persona, pain points, proposed next step, and a Markdown artifact.',
].join(' ')

type ToolResult = {
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

type DelegateStatus = {
  delegationId: string
  status: 'running' | 'completed' | 'error'
  eventCount?: number
  progress?: Array<{ kind: string; message: string }>
  result?: {
    finalAssistantText?: string
    artifacts?: Array<{ path: string; mediaType?: string; content?: string; truncated?: boolean }>
    deliveryRule?: string
  }
}

async function main(): Promise<void> {
  const sdkVersion = readMcpSdkVersion()
  const workspaceRootBase = await mkdtemp(join(tmpdir(), 'full-app-mcp-managed-agent-smoke-workspaces-'))
  const agent = new FakeAgent()
  const app = routeHarness({
    agent,
    workspaceRootBase,
    collectArtifacts: (input) => writeSmokeArtifact(workspaceRootBase, input),
  })
  const endpoint = await listen(app)
  const client = new Client({ name: 'full-app-m1-stock-smoke', version: '0.0.0-smoke' })

  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } },
    }))

    const started = await callTool(client, 'delegate_task_start', { brief: BRIEF })
    if (started.isError) throw new Error(`delegate_task_start failed: ${JSON.stringify(started.structuredContent)}`)
    const startStatus = started.structuredContent as DelegateStatus
    const delegationId = startStatus.delegationId
    if (!delegationId) throw new Error('delegate_task_start did not return a delegationId')

    const running = await waitForStatus(client, delegationId, (status) => status.status === 'running' && Number(status.eventCount ?? 0) > 0)
    agent.releaseCompletion()
    const completed = await waitForStatus(client, delegationId, (status) => status.status === 'completed')
    const result = completed.result
    const artifact = result?.artifacts?.[0]
    if (!result?.finalAssistantText) throw new Error('completed status did not include finalAssistantText')
    if (!artifact?.path) throw new Error('completed status did not include an artifact path')
    if (artifact.path.startsWith('/') || artifact.path.includes('..')) {
      throw new Error(`artifact path is not workspace-relative: ${artifact.path}`)
    }

    const resolvedArtifactPath = join(workspaceRootBase, WORKSPACE_ID, artifact.path)
    const resolvedArtifactContent = await readFile(resolvedArtifactPath, 'utf8')
    if (!resolvedArtifactContent.includes('Outreach demo brief')) {
      throw new Error(`artifact did not resolve to expected Markdown content: ${resolvedArtifactPath}`)
    }

    printTranscript({
      sdkVersion,
      endpoint,
      started: startStatus,
      running,
      completed,
      artifactPath: artifact.path,
      resolvedArtifactPath,
      starts: agent.starts.length,
    })
  } finally {
    agent.releaseCompletion()
    await client.close().catch(() => undefined)
    await app.close().catch(() => undefined)
  }
}

function routeHarness(options: {
  agent: Agent
  workspaceRootBase: string
  collectArtifacts: FullAppMcpManagedAgentComposition['collectArtifacts']
}): CoreWorkspaceAgentServer {
  const app = Fastify({ logger: false }) as unknown as CoreWorkspaceAgentServer
  app.decorate('config', { appId: 'full-app-smoke' } as never)
  app.decorate('workspaceStore', {
    async get(workspaceId: string) {
      return workspaceId === CTX.workspaceId
        ? { id: workspaceId, appId: 'full-app-smoke', name: 'M1 smoke workspace', createdBy: CTX.userId, createdAt: '2026-07-06T00:00:00.000Z', deletedAt: null, isDefault: true }
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
      BORING_M1_MCP_BEARER_TOKEN: MCP_TOKEN,
      BORING_AGENT_WORKSPACE_ROOT: options.workspaceRootBase,
    } as NodeJS.ProcessEnv,
    composition: {
      agent: options.agent,
      collectArtifacts: options.collectArtifacts,
    },
  })
  return app
}

async function writeSmokeArtifact(
  workspaceRootBase: string,
  input: ManagedAgentCollectArtifactsInput,
): Promise<Array<{ path: string; mediaType: string; title: string; content: string }>> {
  const artifactPath = `artifacts/mcp-managed-agent/${input.sessionId}/outreach-demo.md`
  const content = [
    '# Outreach demo brief',
    '',
    input.finalAssistantText,
    '',
    '- Persona: platform engineering lead',
    '- Pain point: proving delegated agent workflows without exposing host internals',
    '- Next step: review the delivery v0 artifact reference in the MCP result',
    '',
  ].join('\n')
  if (!input.ctx.workspaceId) throw new Error('smoke artifact collection requires a workspaceId')
  const absolutePath = join(workspaceRootBase, input.ctx.workspaceId, artifactPath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
  return [{ path: artifactPath, mediaType: 'text/markdown', title: 'Outreach demo brief', content }]
}

async function listen(app: CoreWorkspaceAgentServer): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 })
  const { port } = app.server.address() as AddressInfo
  return `http://127.0.0.1:${port}${FULL_APP_MCP_MANAGED_AGENT_ENDPOINT}`
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return await client.callTool({ name, arguments: args }) as ToolResult
}

async function waitForStatus(
  client: Client,
  delegationId: string,
  predicate: (status: DelegateStatus) => boolean,
): Promise<DelegateStatus> {
  const started = Date.now()
  let lastStatus: DelegateStatus | undefined
  while (Date.now() - started < 5_000) {
    const result = await callTool(client, 'delegate_task_status', { delegationId })
    if (result.isError) throw new Error(`delegate_task_status failed: ${JSON.stringify(result.structuredContent)}`)
    lastStatus = result.structuredContent as DelegateStatus
    if (predicate(lastStatus)) return lastStatus
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for delegate status; last=${JSON.stringify(lastStatus)}`)
}

function printTranscript(input: {
  sdkVersion: string
  endpoint: string
  started: DelegateStatus
  running: DelegateStatus
  completed: DelegateStatus
  artifactPath: string
  resolvedArtifactPath: string
  starts: number
}): void {
  const url = new URL(input.endpoint)
  const redactedEndpoint = `${url.protocol}//${url.hostname}:<port>${url.pathname}`
  const result = input.completed.result
  console.log('BBM1-003 MCP managed-agent smoke: PASS')
  console.log(`client: @modelcontextprotocol/sdk ${input.sdkVersion} StreamableHTTPClientTransport`)
  console.log(`url_shape: ${redactedEndpoint}`)
  console.log('auth: Bearer [redacted]')
  console.log(`delegate_task_start: delegationId=${input.started.delegationId} status=${input.started.status}`)
  console.log(`progress_poll: status=${input.running.status} eventCount=${input.running.eventCount ?? 0} messages=${JSON.stringify((input.running.progress ?? []).map((item) => item.message))}`)
  console.log(`result: status=${input.completed.status} finalAssistantText=${JSON.stringify(result?.finalAssistantText)} deliveryRule=${JSON.stringify(result?.deliveryRule)}`)
  console.log(`artifact_ref: ${input.artifactPath}`)
  console.log(`artifact_resolved: ${input.resolvedArtifactPath}`)
  console.log(`agent_starts: ${input.starts}`)
}

function readMcpSdkVersion(): string {
  const require = createRequire(import.meta.url)
  try {
    let current = dirname(require.resolve('@modelcontextprotocol/sdk/client/index.js'))
    for (let i = 0; i < 6; i += 1) {
      const candidate = join(current, 'package.json')
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string }
        if (parsed.name === '@modelcontextprotocol/sdk') return parsed.version ?? 'unknown'
      }
      current = dirname(current)
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
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
  private readonly completionGate = deferred<void>()
  private created = 0

  releaseCompletion(): void {
    this.completionGate.resolve()
  }

  async start(input: AgentSendInput): Promise<AgentStartReceipt> {
    this.starts.push(input)
    this.created += 1
    return { sessionId: `session-${this.created}`, startIndex: 0 }
  }

  async *stream(sessionId: string, _options: AgentStreamOptions): AsyncIterable<AgentEvent> {
    yield event(0, sessionId, { type: 'agent-start', seq: 0, turnId: 'turn-1' })
    await this.completionGate.promise
    yield event(1, sessionId, {
      type: 'message-end',
      seq: 1,
      messageId: 'a1',
      final: {
        id: 'a1',
        role: 'assistant',
        status: 'done',
        parts: [{ type: 'text', text: 'Final answer for the representative outreach-demo brief.' }],
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

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolved = false
  let resolveValue!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return {
    promise,
    resolve(value: T): void {
      if (resolved) return
      resolved = true
      resolveValue(value)
    },
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
