import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '@hachej/boring-agent/shared'
import type {
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
  readFullAppManagedAgentMcpConfig,
  registerFullAppManagedAgentMcpRoutes,
} from '../managedAgentMcp'
import type { AgentEvent, AgentSendInput } from '@hachej/boring-agent/shared'
import type { Workspace, Stat } from '@hachej/boring-agent/shared'

const TOKEN = 'managed-agent-token'
const LOCAL_TOKEN = 'local-trusted-token'
const WORKSPACE_ID = 'workspace-1'
const USER_ID = 'user-1'
const APP_ID = 'full-app-test'
const WORKSPACE_TYPE_ID = 'default'
const NON_LOOPBACK_ADDRESS = '203.0.113.5'
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8')

const apps: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  while (apps.length) await apps.pop()!.close()
})

describe('full-app managed-agent MCP route', () => {
  it('is dark by default', async () => {
    const resolver = fakeResolver()
    const app = await makeApp({}, resolver)

    const response = await app.inject({ method: 'GET', url: FULL_APP_MANAGED_AGENT_MCP_PATH })

    expect(response.statusCode).toBe(404)
    expect(resolver.resolveWithWorkspace).not.toHaveBeenCalled()
  })

  it('requires all configured values when enabled', () => {
    expect(readFullAppManagedAgentMcpConfig({ BORING_MANAGED_AGENT_MCP_ENABLED: '0' } as NodeJS.ProcessEnv).enabled).toBe(false)
    expect(readFullAppManagedAgentMcpConfig({} as NodeJS.ProcessEnv).redactionCanaries).toContain(process.cwd())
    expect(() => readFullAppManagedAgentMcpConfig({
      BORING_MANAGED_AGENT_MCP_ENABLED: '1',
      BORING_MANAGED_AGENT_MCP_BEARER_TOKEN: TOKEN,
      BORING_MANAGED_AGENT_MCP_WORKSPACE_ID: WORKSPACE_ID,
    } as NodeJS.ProcessEnv)).toThrow(/BORING_MANAGED_AGENT_MCP_USER_ID/)
  })

  it('rejects an invalid bearer before authorization or agent work', async () => {
    const resolver = fakeResolver()
    const app = await makeApp(enabledEnv(), resolver)

    const response = await app.inject({
      method: 'POST',
      url: FULL_APP_MANAGED_AGENT_MCP_PATH,
      headers: { authorization: 'Bearer wrong-token' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({
      error: { code: ErrorCode.enum.UNAUTHORIZED, message: 'unauthorized' },
    })
    expect(app.workspaceStore.get).not.toHaveBeenCalled()
    expect(app.workspaceStore.isMember).not.toHaveBeenCalled()
    expect(resolver.resolveWithWorkspace).not.toHaveBeenCalled()
  })

  it('rejects non-member and app-mismatched config before dispatch', async () => {
    const nonMemberResolver = fakeResolver()
    const nonMember = await makeApp(enabledEnv(), nonMemberResolver, { member: false })
    const nonMemberResult = await callDelegate(nonMember, { brief: 'make a report' })
    expect(nonMemberResult.isError).toBe(true)
    expect(nonMemberResult.structuredContent).toMatchObject({
      error: { code: ErrorCode.enum.UNAUTHORIZED },
    })
    expect(nonMemberResolver.resolveWithWorkspace).not.toHaveBeenCalled()

    const mismatchResolver = fakeResolver()
    const mismatch = await makeApp(enabledEnv(), mismatchResolver, { workspaceAppId: 'other-app' })
    const mismatchResult = await callDelegate(mismatch, { brief: 'make a report' })
    expect(mismatchResult.isError).toBe(true)
    expect(mismatchResult.structuredContent).toMatchObject({
      error: { code: ErrorCode.enum.UNAUTHORIZED },
    })
    expect(mismatchResolver.resolveWithWorkspace).not.toHaveBeenCalled()
  })

  it('ignores caller workspace spoofing and returns bytes from the exact bound Workspace', async () => {
    const artifact = '# Bound report\n\nComplete.'
    const workspace = fakeWorkspace({ 'reports/final.md': artifact })
    const resolver = fakeResolver({ workspace })
    const app = await makeApp(enabledEnv(), resolver)

    const result = await callDelegate(app, {
      brief: 'make a report',
      workspaceId: 'spoof-workspace',
      userId: 'spoof-user',
    })

    expect(result.isError).not.toBe(true)
    expect(resolver.resolveWithWorkspace).toHaveBeenCalledOnce()
    expect(((resolver.resolveWithWorkspace.mock.calls[0] ?? []) as unknown[])[1]).toMatchObject({
      request: expect.any(Object),
    })
    expect(resolver.resolve).not.toHaveBeenCalled()
    expect(resolver.contexts).toEqual([{ workspaceId: WORKSPACE_ID, userId: USER_ID }])
    expect(resolver.dispatcherSends).toHaveLength(1)
    expect(resolver.dispatcherSends[0]).toMatchObject({
      content: 'make a report',
      originSurface: 'mcp-managed-agent',
    })
    expect(workspace.reads).toEqual(['reports/final.md'])
    expect(result.structuredContent).toMatchObject({
      status: 'completed',
      finalAssistantText: 'Final answer',
      artifact: {
        content: artifact,
        sha256: sha256(artifact),
        byteSize: byteSize(artifact),
        mediaType: 'text/markdown',
      },
    })
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/"path"|"truncated"|\/srv\/private|managed-agent-token/)
  })

  it('serves a stock SDK client a self-contained artifact without a second runtime composition', async () => {
    const artifact = '# SDK report'
    const resolver = fakeResolver({ workspace: fakeWorkspace({ 'reports/final.md': artifact }) })
    const app = await makeApp(enabledEnv({
      BORING_AGENT_WORKSPACE_ROOT: '/srv/private/workspaces',
      BORING_AGENT_SESSION_ROOT: '/srv/private/pi-sessions',
    }), resolver)

    const result = await callDelegate(app, { brief: 'make an SDK report' })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      artifact: {
        content: artifact,
        sha256: sha256(artifact),
        byteSize: byteSize(artifact),
      },
    })
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/"path"|"truncated"|\/srv\/private|managed-agent-token/)
    expect(resolver.resolveWithWorkspace).toHaveBeenCalledTimes(1)
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('denies a workspace whose persisted type does not match the configured type', async () => {
    const resolver = fakeResolver()
    const app = await makeApp(enabledEnv(), resolver, { workspaceTypeId: 'other-type' })

    const result = await callDelegate(app, { brief: 'make a report' })

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ error: { code: ErrorCode.enum.UNAUTHORIZED } })
    expect(resolver.resolveWithWorkspace).not.toHaveBeenCalled()
  })
})

describe('full-app managed-agent MCP two-tier auth modes', () => {
  it('requires the local token when local-trusted is enabled', () => {
    expect(() => readFullAppManagedAgentMcpConfig({
      BORING_MANAGED_AGENT_MCP_ENABLED: '1',
      BORING_MANAGED_AGENT_MCP_AUTH_MODE: 'local-trusted',
      BORING_MANAGED_AGENT_MCP_WORKSPACE_ID: WORKSPACE_ID,
      BORING_MANAGED_AGENT_MCP_USER_ID: USER_ID,
    } as NodeJS.ProcessEnv)).toThrow(/BORING_MANAGED_AGENT_MCP_LOCAL_TOKEN/)
  })

  it('rejects an unknown auth mode', () => {
    expect(() => readFullAppManagedAgentMcpConfig({
      BORING_MANAGED_AGENT_MCP_ENABLED: '1',
      BORING_MANAGED_AGENT_MCP_AUTH_MODE: 'oauth',
      BORING_MANAGED_AGENT_MCP_BEARER_TOKEN: TOKEN,
      BORING_MANAGED_AGENT_MCP_WORKSPACE_ID: WORKSPACE_ID,
      BORING_MANAGED_AGENT_MCP_USER_ID: USER_ID,
    } as NodeJS.ProcessEnv)).toThrow(/hosted.*local-trusted|AUTH_MODE/)
  })

  it('accepts a loopback local-trusted caller and reaches the bound dispatcher', async () => {
    const resolver = fakeResolver()
    const app = await makeApp(localTrustedEnv(), resolver)

    const result = await callDelegate(app, { brief: 'make a report' }, { token: LOCAL_TOKEN })

    expect(result.isError).not.toBe(true)
    expect(resolver.resolveWithWorkspace).toHaveBeenCalledOnce()
    expect(resolver.contexts).toEqual([{ workspaceId: WORKSPACE_ID, userId: USER_ID }])
  })

  it('denies a local-trusted caller presenting the wrong local token', async () => {
    const resolver = fakeResolver()
    const app = await makeApp(localTrustedEnv(), resolver)

    const response = await app.inject({
      method: 'POST',
      url: FULL_APP_MANAGED_AGENT_MCP_PATH,
      headers: { authorization: 'Bearer wrong-local-token' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: { code: ErrorCode.enum.UNAUTHORIZED, message: 'unauthorized' } })
    expect(resolver.resolveWithWorkspace).not.toHaveBeenCalled()
  })

  it('denies a non-loopback caller even with the correct local token', async () => {
    const resolver = fakeResolver()
    const app = await makeApp(localTrustedEnv(), resolver)

    const response = await app.inject({
      method: 'POST',
      url: FULL_APP_MANAGED_AGENT_MCP_PATH,
      remoteAddress: NON_LOOPBACK_ADDRESS,
      headers: { authorization: `Bearer ${LOCAL_TOKEN}` },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: { code: ErrorCode.enum.UNAUTHORIZED, message: 'unauthorized' } })
    expect(resolver.resolveWithWorkspace).not.toHaveBeenCalled()
  })

  it('denies a spoofed X-Forwarded-For loopback header from a non-loopback socket', async () => {
    const resolver = fakeResolver()
    const app = await makeApp(localTrustedEnv(), resolver)

    // The raw socket peer is remote; only a spoofable proxy header claims
    // loopback. Auth must ignore the header and deny.
    const response = await app.inject({
      method: 'POST',
      url: FULL_APP_MANAGED_AGENT_MCP_PATH,
      remoteAddress: NON_LOOPBACK_ADDRESS,
      headers: {
        authorization: `Bearer ${LOCAL_TOKEN}`,
        'x-forwarded-for': '127.0.0.1',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })

    expect(response.statusCode).toBe(401)
    expect(resolver.resolveWithWorkspace).not.toHaveBeenCalled()
  })

  it('does not accept the hosted bearer as a local-trusted credential shape when non-loopback', async () => {
    const resolver = fakeResolver()
    const app = await makeApp(localTrustedEnv(), resolver)

    // A hosted bearer is a bearer just like the local token; loopback is what
    // gates the local-trusted mode. Prove a non-loopback peer is denied.
    const response = await app.inject({
      method: 'POST',
      url: FULL_APP_MANAGED_AGENT_MCP_PATH,
      remoteAddress: NON_LOOPBACK_ADDRESS,
      headers: { authorization: `Bearer ${LOCAL_TOKEN}` },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })

    expect(response.statusCode).toBe(401)
    expect(resolver.resolveWithWorkspace).not.toHaveBeenCalled()
  })
})

function enabledEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    BORING_MANAGED_AGENT_MCP_ENABLED: '1',
    BORING_MANAGED_AGENT_MCP_BEARER_TOKEN: TOKEN,
    BORING_MANAGED_AGENT_MCP_WORKSPACE_ID: WORKSPACE_ID,
    BORING_MANAGED_AGENT_MCP_USER_ID: USER_ID,
    ...extra,
  } as NodeJS.ProcessEnv
}

function localTrustedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    BORING_MANAGED_AGENT_MCP_ENABLED: '1',
    BORING_MANAGED_AGENT_MCP_AUTH_MODE: 'local-trusted',
    BORING_MANAGED_AGENT_MCP_LOCAL_TOKEN: LOCAL_TOKEN,
    BORING_MANAGED_AGENT_MCP_WORKSPACE_ID: WORKSPACE_ID,
    BORING_MANAGED_AGENT_MCP_USER_ID: USER_ID,
    ...extra,
  } as NodeJS.ProcessEnv
}

async function makeApp(
  env: NodeJS.ProcessEnv,
  resolver: ReturnType<typeof fakeResolver>,
  options: { member?: boolean; workspaceAppId?: string; workspaceTypeId?: string } = {},
): Promise<CoreWorkspaceAgentServer> {
  const app = Fastify()
  app.decorate('config', { appId: APP_ID } as never)
  app.decorate('workspaceStore', {
    get: vi.fn(async (workspaceId: string) => {
      if (workspaceId !== WORKSPACE_ID) return null
      return {
        id: workspaceId,
        appId: options.workspaceAppId ?? APP_ID,
        workspaceTypeId: options.workspaceTypeId ?? WORKSPACE_TYPE_ID,
        name: 'Managed workspace',
        createdBy: USER_ID,
        createdAt: '2026-07-11T00:00:00.000Z',
        deletedAt: null,
        isDefault: true,
      }
    }),
    isMember: vi.fn(async (workspaceId: string, userId: string) => {
      return workspaceId === WORKSPACE_ID && userId === USER_ID && options.member !== false
    }),
  } as Partial<WorkspaceStore> as never)
  registerFullAppManagedAgentMcpRoutes(app as unknown as CoreWorkspaceAgentServer, {
    env,
    dispatcherResolver: resolver,
  })
  await app.ready()
  apps.push(app)
  return app as unknown as CoreWorkspaceAgentServer
}

async function callDelegate(
  app: CoreWorkspaceAgentServer,
  args: Record<string, unknown>,
  options: { headers?: Record<string, string>; token?: string } = {},
): Promise<Awaited<ReturnType<Client['callTool']>>> {
  const client = new Client({ name: 'full-app-managed-agent-test', version: '0.0.0-test' })
  try {
    await client.connect(new FastifyInjectMcpTransport(app, options.headers ?? {}, options.token ?? TOKEN))
    return await client.callTool({ name: 'delegate_task', arguments: args })
  } finally {
    await client.close().catch(() => undefined)
  }
}

class FastifyInjectMcpTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(
    private readonly app: CoreWorkspaceAgentServer,
    private readonly headers: Record<string, string> = {},
    private readonly token: string = TOKEN,
  ) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    const response = await this.app.inject({
      method: 'POST',
      url: FULL_APP_MANAGED_AGENT_MCP_PATH,
      headers: {
        ...this.headers,
        authorization: `Bearer ${this.token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: message,
    })
    if (response.statusCode >= 400) {
      const error = new Error(`MCP inject request failed with ${response.statusCode}`)
      this.onerror?.(error)
      throw error
    }
    for (const item of parseMcpResponseMessages(response.payload)) {
      this.onmessage?.(item)
    }
  }

  async close(): Promise<void> {
    this.onclose?.()
  }
}

function parseMcpResponseMessages(payload: string): JSONRPCMessage[] {
  const trimmed = payload.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    return trimmed
      .split(/\n\n+/)
      .flatMap((eventText) => eventText
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .filter((line) => line && line !== '[DONE]')
        .flatMap((line) => normalizeJsonRpcMessages(JSON.parse(line))))
  }
  return normalizeJsonRpcMessages(JSON.parse(trimmed))
}

function normalizeJsonRpcMessages(value: unknown): JSONRPCMessage[] {
  return Array.isArray(value) ? value as JSONRPCMessage[] : [value as JSONRPCMessage]
}

function fakeResolver(options: {
  workspace?: FakeWorkspace
} = {}) {
  const workspace = options.workspace ?? fakeWorkspace({ 'reports/final.md': '# Final' })
  const contexts: WorkspaceAgentDispatcherContext[] = []
  const dispatcherSends: AgentSendInput[] = []
  const dispatcher: WorkspaceAgentDispatcher = {
    send(input) {
      dispatcherSends.push(input as AgentSendInput)
      return fakeAgentEvents()
    },
    async interrupt() {
      return { accepted: true, cursor: 1 }
    },
    async stop() {
      return { accepted: true, cursor: 1, stopped: true, clearedQueue: [] }
    },
  }
  const resolve = vi.fn(async (): Promise<WorkspaceAgentDispatcher> => {
    throw new Error('resolve should not be used by managed-agent MCP')
  })
  const resolveWithWorkspace = vi.fn(async (ctx: WorkspaceAgentDispatcherContext): Promise<WorkspaceAgentDispatcherBinding> => {
    contexts.push(ctx)
    return { dispatcher, workspace }
  })
  return { resolve, resolveWithWorkspace, contexts, dispatcherSends }
}

async function* fakeAgentEvents(): AsyncIterable<AgentEvent> {
  yield event(0, { type: 'agent-start', seq: 0, turnId: 'turn-1' })
  yield event(1, { type: 'message-start', seq: 1, messageId: 'a1', role: 'assistant' })
  yield event(2, {
    type: 'message-end',
    seq: 2,
    messageId: 'a1',
    final: {
      id: 'a1',
      role: 'assistant',
      status: 'done',
      parts: [
        { type: 'text', text: 'Final answer' },
        { type: 'file', path: 'reports/final.md', filename: 'final.md', mediaType: 'text/markdown' },
      ],
    },
  })
  yield event(3, { type: 'agent-end', seq: 3, turnId: 'turn-1', status: 'ok' })
}

function event(eventIndex: number, chunk: AgentEvent['chunk']): AgentEvent {
  return {
    v: 1,
    eventIndex,
    timestamp: Date.parse('2026-07-11T00:00:00.000Z') + eventIndex,
    sessionId: 'session-1',
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
    if (!entry) throw new Error('missing artifact')
    return entry.bytes.slice()
  }
  return {
    root: '/srv/private/workspaces/workspace-1',
    runtimeContext: { runtimeCwd: '/workspace' },
    reads,
    async stat(path: string): Promise<Stat> {
      const entry = entries.get(path)
      if (!entry) throw new Error('missing artifact')
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

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(utf8Encoder.encode(content)).digest('hex')}`
}

function byteSize(content: string): number {
  return utf8Encoder.encode(content).byteLength
}
