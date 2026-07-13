import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, test } from 'vitest'

import { sha256Bytes } from '../../../shared/digest'
import { InMemoryShareEntryStore, type ShareEntryStore } from '../../../shared/share-entry'
import type { SessionCtx } from '../../../shared/session'
import type { Stat, Workspace } from '../../../shared/workspace'
import { createManagedAgentMcpHttpHandler, type ManagedAgentMcpHttpHandlerOptions } from '../managedAgentMcpServer'
import { shareResourceUri } from '../shareEntryResources'

const WORKSPACE_A: SessionCtx = { workspaceId: 'workspace-a', userId: 'user-a' }
const WORKSPACE_B: SessionCtx = { workspaceId: 'workspace-b', userId: 'user-b' }

const utf8Encoder = new TextEncoder()

const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('AR1-004 MCP share resources', () => {
  test('lists only the authenticated workspace\'s shares', async () => {
    const store = new InMemoryShareEntryStore()
    const ownEntry = await store.create({
      workspaceId: 'workspace-a',
      path: 'notes.md',
      provenance: { producerPrincipalRef: 'user-a' },
    })
    await store.create({
      workspaceId: 'workspace-b',
      path: 'secret.md',
      provenance: { producerPrincipalRef: 'user-b' },
    })

    const client = await connect(store, () => WORKSPACE_A, () => fakeWorkspace({ 'notes.md': '# Notes' }))
    const result = await client.listResources()
    await client.close()

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]).toMatchObject({ uri: shareResourceUri(ownEntry.id), name: ownEntry.id })
  })

  test('reads a live share with exact bytes and a digest', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create({
      workspaceId: 'workspace-a',
      path: 'notes.md',
      provenance: { producerPrincipalRef: 'user-a' },
    })
    const workspace = fakeWorkspace({ 'notes.md': '# Notes\n\nhello' })

    const client = await connect(store, () => WORKSPACE_A, () => workspace)
    const result = await client.readResource({ uri: shareResourceUri(entry.id) })
    await client.close()

    expect(result.contents).toHaveLength(1)
    const content = result.contents[0] as { text: string; _meta?: Record<string, unknown> }
    expect(content.text).toBe('# Notes\n\nhello')
    expect(content._meta?.status).toBe('ok')
    expect(content._meta?.digest).toBe(await sha256Bytes(utf8Encoder.encode('# Notes\n\nhello')))
    expect(content._meta?.byteSize).toBe(utf8Encoder.encode('# Notes\n\nhello').byteLength)
    // Never leak the server-internal path.
    expect(JSON.stringify(result)).not.toMatch(/notes\.md/)
  })

  test('renders a path-free tombstone when the target file is gone', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create({
      workspaceId: 'workspace-a',
      path: 'gone.md',
      provenance: { producerPrincipalRef: 'user-a' },
    })
    const workspace = fakeWorkspace({})

    const client = await connect(store, () => WORKSPACE_A, () => workspace)
    const result = await client.readResource({ uri: shareResourceUri(entry.id) })
    await client.close()

    const content = result.contents[0] as { text: string }
    const body = JSON.parse(content.text) as { status: string; error: { code: string } }
    expect(body.status).toBe('tombstoned')
    expect(body.error.code).toBe('AR1_SHARE_TOMBSTONED')
    expect(JSON.stringify(result)).not.toMatch(/gone\.md/)
  })

  test('renders AR1_SHARE_NOT_FOUND for an unknown id', async () => {
    const store = new InMemoryShareEntryStore()
    const client = await connect(store, () => WORKSPACE_A, () => fakeWorkspace({}))
    const result = await client.readResource({ uri: shareResourceUri('does-not-exist') })
    await client.close()

    const content = result.contents[0] as { text: string }
    const body = JSON.parse(content.text) as { status: string; error: { code: string } }
    expect(body.status).toBe('not_found')
    expect(body.error.code).toBe('AR1_SHARE_NOT_FOUND')
  })

  test('a non-member workspace sees an id as indistinguishable from not-found', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create({
      workspaceId: 'workspace-a',
      path: 'notes.md',
      provenance: { producerPrincipalRef: 'user-a' },
    })

    const memberClient = await connect(store, () => WORKSPACE_A, () => fakeWorkspace({ 'notes.md': '# Notes' }))
    const memberResult = await memberClient.readResource({ uri: shareResourceUri(entry.id) })
    await memberClient.close()

    const otherClient = await connect(store, () => WORKSPACE_B, () => fakeWorkspace({}))
    const otherResult = await otherClient.readResource({ uri: shareResourceUri(entry.id) })
    const missingResult = await otherClient.readResource({ uri: shareResourceUri('totally-unknown-id') })
    const otherList = await otherClient.listResources()
    await otherClient.close()

    const memberBody = memberResult.contents[0] as { _meta?: Record<string, unknown> }
    expect(memberBody._meta?.status).toBe('ok')

    const otherBody = JSON.parse((otherResult.contents[0] as { text: string }).text) as { status: string; error: { code: string } }
    const missingBody = JSON.parse((missingResult.contents[0] as { text: string }).text) as { status: string; error: { code: string } }
    expect(otherBody).toEqual(missingBody)
    expect(otherBody.status).toBe('not_found')

    // The non-member list must never include workspace-a's share.
    expect(otherList.resources).toEqual([])
  })

  test('rejects an oversize share target with a stable code', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create({
      workspaceId: 'workspace-a',
      path: 'big.md',
      provenance: { producerPrincipalRef: 'user-a' },
    })
    const workspace = fakeWorkspace({ 'big.md': 'x'.repeat(256 * 1024 + 1) })

    const client = await connect(store, () => WORKSPACE_A, () => workspace)
    await expect(client.readResource({ uri: shareResourceUri(entry.id) })).rejects.toThrow(/must be 262144 bytes or fewer/)
    await client.close()
  })
})

async function connect(
  store: ShareEntryStore,
  resolveShareSessionCtx: () => SessionCtx,
  resolveShareWorkspace: () => Workspace,
): Promise<Client> {
  const options: ManagedAgentMcpHttpHandlerOptions = {
    resolveSessionCtx: () => resolveShareSessionCtx(),
    shareEntryStore: store,
    resolveShareSessionCtx: () => resolveShareSessionCtx(),
    resolveShareWorkspace: () => resolveShareWorkspace(),
  }
  const handler = createManagedAgentMcpHttpHandler(options)
  const endpoint = await listen(handler)
  const client = new Client({ name: 'share-resource-test-client', version: '0.0.0-test' })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
  return client
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, parsedBody?: unknown) => Promise<void>,
): Promise<string> {
  const server = createServer(async (req, res) => {
    const body = await readJson(req)
    await handler(req, res, body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  servers.push({
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    }),
  })
  return `http://127.0.0.1:${port}/mcp`
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function fakeWorkspace(files: Record<string, string>): Workspace {
  const entries = new Map(
    Object.entries(files).map(([path, content]) => [
      path,
      { bytes: utf8Encoder.encode(content), mtimeMs: Date.parse('2026-07-13T00:00:00.000Z') },
    ]),
  )
  return {
    root: '/srv/private/workspaces/fake',
    runtimeContext: { runtimeCwd: '/workspace' },
    async stat(path: string): Promise<Stat> {
      const entry = entries.get(path)
      if (!entry) throw new Error(`missing ${path}`)
      return { kind: 'file', size: entry.bytes.byteLength, mtimeMs: entry.mtimeMs }
    },
    async readBinaryFile(path: string): Promise<Uint8Array> {
      const entry = entries.get(path)
      if (!entry) throw new Error(`missing ${path}`)
      return entry.bytes.slice()
    },
    async readFile(path: string): Promise<string> {
      const entry = entries.get(path)
      if (!entry) throw new Error(`missing ${path}`)
      return new TextDecoder().decode(entry.bytes)
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
