import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import Fastify from 'fastify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { ErrorCode } from '@hachej/boring-agent/shared'
import type {
  AgentEvent,
  AgentSendInput,
  Stat,
  Workspace,
  WorkspaceAgentDispatcher,
  WorkspaceAgentDispatcherContext,
} from '@hachej/boring-agent/shared'
import type {
  WorkspaceAgentDispatcherBinding,
  WorkspaceAgentDispatcherResolver,
} from '@hachej/boring-agent/server'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import type { WorkspaceStore } from '@hachej/boring-core/server'

import {
  FULL_APP_MANAGED_AGENT_MCP_PATH,
  registerFullAppManagedAgentMcpRoutes,
} from '../src/server/managedAgentMcp'

const TOKEN = 'managed-agent-smoke-token'
const WORKSPACE_ID = 'managed-smoke-workspace'
const USER_ID = 'managed-smoke-user'
const APP_ID = 'managed-smoke-app'
const HOST_ROOT = '/host/private/managed-smoke-workspaces'
const SESSION_ROOT = '/host/private/managed-smoke-sessions'
const FINAL_TEXT = 'Managed agent final text.'
const ARTIFACT_PATH = 'reports/managed-agent-smoke.md'
const ARTIFACT_CONTENT = '# Managed Agent Smoke\n\nAuthorized Markdown content is complete.\n'

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8')

async function main(): Promise<void> {
  const gate = deferred<void>()
  const workspace = fakeWorkspace({ [ARTIFACT_PATH]: ARTIFACT_CONTENT })
  const resolver = fakeResolver({ workspace, gate })
  const app = await listen(resolver)
  let validClient: Client | undefined
  let quotaClient: Client | undefined
  let invalidClient: Client | undefined

  try {
    const endpoint = endpointFor(app)

    invalidClient = newClient('invalid-bearer')
    await assert.rejects(
      () => invalidClient!.connect(transport(endpoint, 'wrong-token')),
      /Unauthorized|401/i,
    )
    assert.equal(resolver.dispatcherSends.length, 0, 'invalid bearer must reject before dispatcher send')

    validClient = newClient('valid')
    await validClient.connect(transport(endpoint, TOKEN))

    const started = await validClient.callTool({
      name: 'delegate_task_start',
      arguments: { brief: 'Create the deterministic managed-agent smoke report.' },
    })
    const startedContent = record(started.structuredContent)
    assert.equal(started.isError, undefined)
    assert.equal(startedContent.status, 'running')
    assert.equal(typeof startedContent.delegationId, 'string')

    const running = await waitForStatus(validClient, String(startedContent.delegationId), (status) => {
      const progress = Array.isArray(status.progress) ? status.progress : []
      return status.status === 'running' && progress.length > 0
    })
    assert.equal(running.status, 'running')
    assert.ok(Array.isArray(running.progress) && running.progress.length > 0, 'running status must expose progress')

    gate.resolve()
    const completed = await waitForStatus(validClient, String(startedContent.delegationId), (status) => {
      return status.status === 'completed'
    })
    const result = record(completed.result)
    const artifact = record(result.artifact)
    assert.equal(result.status, 'completed')
    assert.equal(result.finalAssistantText, FINAL_TEXT)
    assert.equal(artifact.content, ARTIFACT_CONTENT)
    assert.equal(artifact.sha256, sha256(ARTIFACT_CONTENT))
    assert.equal(artifact.byteSize, byteSize(ARTIFACT_CONTENT))
    assert.equal(artifact.mediaType, 'text/markdown')
    assert.equal(resolver.dispatcherSends.length, 1)
    assert.deepEqual([...resolver.sessionIds], ['managed-smoke-session-1'])
    assert.equal(resolver.resolveContexts.length, 1)
    assert.deepEqual(resolver.resolveContexts[0], { workspaceId: WORKSPACE_ID, userId: USER_ID })
    assert.equal(workspace.reads.length, 1)
    assertNoPrivateFields(completed)
    assertNoPrivateFields(result)
    assert.equal(record(resolver.dispatcherSends[0]).model, undefined, 'fake binding must not inject a model key')

    quotaClient = newClient('quota')
    await quotaClient.connect(transport(endpoint, TOKEN))
    const quota = await quotaClient.callTool({
      name: 'delegate_task',
      arguments: { brief: 'quota-exceeded' },
    })
    assert.equal(quota.isError, true)
    assert.deepEqual(record(quota.structuredContent).error, {
      code: ErrorCode.enum.MODEL_BUDGET_EXCEEDED,
      message: 'agent turn failed',
    })
    assertNoArtifactBytes(quota.structuredContent)
    assert.equal(workspace.reads.length, 1, 'quota failure must not read artifact bytes')
    assertNoPrivateFields(quota.structuredContent)

    console.log(`managed-agent MCP smoke passed: ${endpoint}`)
  } finally {
    await invalidClient?.close().catch(() => undefined)
    await validClient?.close().catch(() => undefined)
    await quotaClient?.close().catch(() => undefined)
    await app.close()
  }
}

function newClient(suffix: string): Client {
  return new Client({ name: `full-app-managed-agent-smoke-${suffix}`, version: '0.0.0-smoke' })
}

function transport(endpoint: string, token: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  })
}

async function listen(resolver: ReturnType<typeof fakeResolver>): Promise<CoreWorkspaceAgentServer> {
  const app = Fastify({ logger: false })
  app.decorate('config', { appId: APP_ID } as never)
  app.decorate('workspaceStore', {
    async get(workspaceId: string) {
      if (workspaceId !== WORKSPACE_ID) return null
      return {
        id: workspaceId,
        appId: APP_ID,
        name: 'Managed smoke workspace',
        createdBy: USER_ID,
        createdAt: '2026-07-11T00:00:00.000Z',
        deletedAt: null,
        isDefault: true,
      }
    },
    async isMember(workspaceId: string, userId: string) {
      return workspaceId === WORKSPACE_ID && userId === USER_ID
    },
  } as Partial<WorkspaceStore> as never)
  registerFullAppManagedAgentMcpRoutes(app as unknown as CoreWorkspaceAgentServer, {
    env: {
      BORING_MANAGED_AGENT_MCP_ENABLED: '1',
      BORING_MANAGED_AGENT_MCP_BEARER_TOKEN: TOKEN,
      BORING_MANAGED_AGENT_MCP_WORKSPACE_ID: WORKSPACE_ID,
      BORING_MANAGED_AGENT_MCP_USER_ID: USER_ID,
      BORING_AGENT_WORKSPACE_ROOT: HOST_ROOT,
      BORING_AGENT_SESSION_ROOT: SESSION_ROOT,
    } as NodeJS.ProcessEnv,
    dispatcherResolver: resolver,
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  return app as unknown as CoreWorkspaceAgentServer
}

function endpointFor(app: CoreWorkspaceAgentServer): string {
  const address = app.server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}${FULL_APP_MANAGED_AGENT_MCP_PATH}`
}

function fakeResolver(options: {
  workspace: FakeWorkspace
  gate: Deferred<void>
}) {
  const dispatcherSends: AgentSendInput[] = []
  const resolveContexts: WorkspaceAgentDispatcherContext[] = []
  const sessionIds = new Set<string>()
  let runCount = 0
  const dispatcher: WorkspaceAgentDispatcher = {
    send(input) {
      dispatcherSends.push(input as AgentSendInput)
      runCount += 1
      const sessionId = `managed-smoke-session-${runCount}`
      sessionIds.add(sessionId)
      return String(input.content) === 'quota-exceeded'
        ? quotaEvents(sessionId)
        : successfulEvents(sessionId, options.gate)
    },
    async interrupt() {
      return { accepted: true, cursor: 1 }
    },
    async stop() {
      return { accepted: true, cursor: 1, stopped: true, clearedQueue: [] }
    },
  }
  const resolver: WorkspaceAgentDispatcherResolver & {
    dispatcherSends: AgentSendInput[]
    resolveContexts: WorkspaceAgentDispatcherContext[]
    sessionIds: Set<string>
  } = {
    dispatcherSends,
    resolveContexts,
    sessionIds,
    async resolve(): Promise<WorkspaceAgentDispatcher> {
      throw new Error('managed-agent smoke must use resolveWithWorkspace')
    },
    async resolveWithWorkspace(ctx: WorkspaceAgentDispatcherContext): Promise<WorkspaceAgentDispatcherBinding> {
      resolveContexts.push({ ...ctx })
      return { dispatcher, workspace: options.workspace }
    },
  }
  return resolver
}

async function* successfulEvents(sessionId: string, gate: Deferred<void>): AsyncIterable<AgentEvent> {
  yield event(sessionId, 0, { type: 'agent-start', seq: 0, turnId: 'turn-1' })
  yield event(sessionId, 1, { type: 'message-start', seq: 1, messageId: 'a1', role: 'assistant' })
  await gate.promise
  yield event(sessionId, 2, {
    type: 'message-end',
    seq: 2,
    messageId: 'a1',
    final: {
      id: 'a1',
      role: 'assistant',
      status: 'done',
      parts: [
        { type: 'text', text: FINAL_TEXT },
        { type: 'file', path: ARTIFACT_PATH, filename: 'managed-agent-smoke.md', mediaType: 'text/markdown' },
      ],
    },
  })
  yield event(sessionId, 3, { type: 'agent-end', seq: 3, turnId: 'turn-1', status: 'ok' })
}

async function* quotaEvents(sessionId: string): AsyncIterable<AgentEvent> {
  yield event(sessionId, 0, { type: 'agent-start', seq: 0, turnId: 'turn-1' })
  yield event(sessionId, 1, {
    type: 'error',
    seq: 1,
    error: {
      code: ErrorCode.enum.MODEL_BUDGET_EXCEEDED,
      message: 'deterministic quota exceeded',
    },
  })
  yield event(sessionId, 2, { type: 'agent-end', seq: 2, turnId: 'turn-1', status: 'error' })
}

function event(sessionId: string, eventIndex: number, chunk: AgentEvent['chunk']): AgentEvent {
  return {
    v: 1,
    eventIndex,
    timestamp: Date.parse('2026-07-11T00:00:00.000Z') + eventIndex,
    sessionId,
    chunk,
  }
}

interface FakeWorkspace extends Workspace {
  readonly reads: string[]
}

function fakeWorkspace(files: Record<string, string | Uint8Array>): FakeWorkspace {
  const entries = new Map(Object.entries(files).map(([path, content]) => [
    path,
    {
      bytes: typeof content === 'string' ? utf8Encoder.encode(content) : content,
      mtimeMs: Date.parse('2026-07-11T00:00:00.000Z'),
    },
  ]))
  const reads: string[] = []
  const readBytes = (path: string): Uint8Array => {
    reads.push(path)
    const entry = entries.get(path)
    if (!entry) throw new Error(`missing ${path}`)
    return entry.bytes.slice()
  }
  return {
    root: HOST_ROOT,
    runtimeContext: { runtimeCwd: '/workspace' },
    reads,
    async stat(path: string): Promise<Stat> {
      const entry = entries.get(path)
      if (!entry) throw new Error(`missing ${path}`)
      return { kind: 'file', size: entry.bytes.byteLength, mtimeMs: entry.mtimeMs }
    },
    async readBinaryFile(path: string): Promise<Uint8Array> {
      return readBytes(path)
    },
    async readFile(path: string): Promise<string> {
      return utf8Decoder.decode(readBytes(path))
    },
    async writeFile(): Promise<void> {
      throw new Error('not implemented')
    },
    async unlink(): Promise<void> {
      throw new Error('not implemented')
    },
    async readdir(): Promise<never[]> {
      return []
    },
    async mkdir(): Promise<void> {
      throw new Error('not implemented')
    },
    async rename(): Promise<void> {
      throw new Error('not implemented')
    },
  }
}

async function waitForStatus(
  client: Client,
  delegationId: string,
  predicate: (status: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await client.callTool({ name: 'delegate_task_status', arguments: { delegationId } })
    const status = record(result.structuredContent)
    if (predicate(status)) return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for status ${delegationId}`)
}

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  return value as Record<string, unknown>
}

function assertNoPrivateFields(value: unknown): void {
  const serialized = JSON.stringify(value)
  assert.ok(!serialized.includes('"path"'), 'payload must not expose artifact path')
  assert.ok(!serialized.includes('"truncated"'), 'payload must not expose truncation flag')
  assert.ok(!serialized.includes(HOST_ROOT), 'payload must not expose host workspace root')
  assert.ok(!serialized.includes(SESSION_ROOT), 'payload must not expose host session root')
  assert.ok(!serialized.includes(process.cwd()), 'payload must not expose process cwd')
  assert.ok(!serialized.includes(TOKEN), 'payload must not expose bearer token')
  assert.ok(!/token/i.test(serialized), 'payload must not expose token fields')
}

function assertNoArtifactBytes(value: unknown): void {
  const serialized = JSON.stringify(value)
  assert.ok(!serialized.includes(ARTIFACT_CONTENT), 'quota error must not include artifact bytes')
  assert.ok(!serialized.includes('"artifact"'), 'quota error must not include an artifact payload')
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(utf8Encoder.encode(content)).digest('hex')}`
}

function byteSize(content: string): number {
  return utf8Encoder.encode(content).byteLength
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
