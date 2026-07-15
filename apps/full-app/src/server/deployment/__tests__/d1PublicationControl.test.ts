import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  D1_PENDING_PUBLICATION_FILE,
  D1_PUBLICATION_SOCKET_FILE,
  createD1RootPublicationClient,
  parseD1PendingPublication,
  readD1PendingPublication,
  startD1PublicationControlServer,
  type D1PublicationControlAuthority,
} from '../d1PublicationControl.js'
import { D1HostErrorCode } from '../d1Plan.js'

const digest = (value: string) => `sha256:${value.repeat(64)}` as const
const roots: string[] = []
const pending = { schemaVersion: 1, operationId: 'operation-1', expectedRevision: 'r0000000001', expectedDigest: digest('a'),
  targetRevision: 'r0000000002', targetDigest: digest('b'), runtimeInputs: [], rollback: null, state: 'prepared' as const }

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'd1-control-')); roots.push(value); await chmod(value, 0o710); return value
}
async function exchange(socketPath: string, frame: string | readonly string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath); let output = ''
    socket.setEncoding('utf8'); socket.on('connect', () => {
      if (typeof frame === 'string') socket.end(frame)
      else { socket.write(frame[0]); setImmediate(() => socket.end(frame[1])) }
    }); socket.on('data', (chunk) => { output += chunk })
    socket.on('end', () => resolve(JSON.parse(output) as Record<string, unknown>)); socket.on('error', reject)
  })
}

describe('D1 core publication control', () => {
  it('accepts only the canonical root-owned pending identity', async () => {
    expect(parseD1PendingPublication(pending)).toEqual(pending)
    expect(() => parseD1PendingPublication({ ...pending, path: '/private' })).toThrow()
    expect(() => parseD1PendingPublication({ ...pending, expectedDigest: null })).toThrow()
    const controlRoot = await root(); const file = path.join(controlRoot, D1_PENDING_PUBLICATION_FILE)
    await writeFile(file, JSON.stringify(pending)); await chmod(file, 0o440)
    await expect(readD1PendingPublication({ root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })).resolves.toEqual(pending)
    await chmod(file, 0o644)
    await expect(readD1PendingPublication({ root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() }))
      .rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
  })

  it('dispatches one bounded fixed-action frame and returns redacted status', async () => {
    const controlRoot = await root(); await chmod(controlRoot, 0o730); const status = { durableRevision: 'r0000000002', servedRevision: 'r0000000001', pendingOperation: 'operation-1' }
    const authority = { prepare: vi.fn(async () => status), commit: vi.fn(async () => status), discard: vi.fn(async () => status), status: vi.fn(async () => status) } satisfies D1PublicationControlAuthority
    const server = await startD1PublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    try {
      const socket = path.join(controlRoot, D1_PUBLICATION_SOCKET_FILE)
      await expect(exchange(socket, '{"action":"prepare","operationId":"operation-1"}\n')).resolves.toEqual({ ok: true, status })
      expect(authority.prepare).toHaveBeenCalledWith('operation-1')
      await expect(exchange(socket, '{"action":"status"}\n')).resolves.toEqual({ ok: true, status })
      expect(JSON.stringify(await exchange(socket, '{"action":"commit","operationId":"operation-1","path":"/private"}\n')))
        .not.toContain('/private')
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it('publishes pending before prepare and removes it only after exact served commit', async () => {
    const hostRoot = await root(); const controlRoot = await root(); await chmod(controlRoot, 0o730)
    let active: { schemaVersion: 1; revisionId: string; desiredStateDigest: ReturnType<typeof digest> } | null = null
    const target = { schemaVersion: 1 as const, revisionId: 'r0000000002', desiredStateDigest: digest('b') }
    const status = () => ({ durableRevision: active?.revisionId ?? null, servedRevision: active?.revisionId ?? null, pendingOperation: 'operation-1' })
    const authority = { prepare: vi.fn(async () => ({ durableRevision: null, servedRevision: null, pendingOperation: 'operation-1' })),
      commit: vi.fn(async () => status()), discard: vi.fn(async () => status()), status: vi.fn(async () => status()) } satisfies D1PublicationControlAuthority
    const server = await startD1PublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    const startCore = vi.fn(async () => {}); const startIngress = vi.fn(async () => {
      expect(JSON.parse(await readFile(path.join(hostRoot, D1_PENDING_PUBLICATION_FILE), 'utf8'))).toMatchObject({ state: 'committed' })
    })
    const desired = { schemaVersion: 1, domain: 'boring-d1-desired:v1', plan: { schemaVersion: 1, hostId: 'host-1', hostAppImageDigest: digest('f'),
      runtimeProfileRef: 'runsc', databaseRef: 'database', workspaceRootPolicyRef: 'workspaces', sessionRootPolicyRef: 'sessions', bindings: [] }, resolvedBindings: [] }
    const candidate = { ...target, desired, secretRefs: { schemaVersion: 1, domain: 'boring-d1-secret-refs:v1', bindings: [] } } as never
    const store = { readActive: vi.fn(async () => active) } as never
    const client = createD1RootPublicationClient({ hostId: 'host-1', hostRoot, controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!(),
      operationId: 'operation-1', revisionStore: store, startCore, startIngress })
    try {
      await client.preload(candidate, []); expect(startCore).toHaveBeenCalledOnce()
      expect(await lstat(path.join(hostRoot, D1_PENDING_PUBLICATION_FILE))).toMatchObject({ mode: expect.any(Number) })
      active = target; await client.verifyActive(target); expect(startIngress).toHaveBeenCalledOnce()
      await expect(lstat(path.join(hostRoot, D1_PENDING_PUBLICATION_FILE))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it('retries exact initial core startup when pending exists before any socket', async () => {
    const hostRoot = await root(); const controlRoot = await root(); const first = { ...pending, expectedRevision: null, expectedDigest: null }
    await writeFile(path.join(hostRoot, D1_PENDING_PUBLICATION_FILE), JSON.stringify(first)); await chmod(path.join(hostRoot, D1_PENDING_PUBLICATION_FILE), 0o440)
    const status = { durableRevision: null, servedRevision: null, pendingOperation: first.operationId }
    const authority = { prepare: vi.fn(), commit: vi.fn(), discard: vi.fn(async () => status), status: vi.fn(async () => status) } as unknown as D1PublicationControlAuthority
    let server: Awaited<ReturnType<typeof startD1PublicationControlServer>> | undefined
    const startCore = vi.fn(async () => { server = await startD1PublicationControlServer(authority, {
      root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!(),
    }) })
    const client = createD1RootPublicationClient({ hostId: 'host-1', hostRoot, controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!(),
      operationId: 'new-operation', revisionStore: { readCandidate: vi.fn(async () => ({ revisionId: first.targetRevision, desiredStateDigest: first.targetDigest })),
        readComplete: vi.fn(async () => null) } as never, startCore, timeoutMs: 20 })
    try { await client.recover(); expect(startCore).toHaveBeenCalledOnce() }
    finally { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())) }
  })

  it('discards a pre-journal destructive prepare without publishing its COMPLETE target', async () => {
    const hostRoot = await root(); const controlRoot = await root(); await chmod(controlRoot, 0o730)
    const rollback = { operationId: 'operation-1', hostId: 'host-1', expectedRevision: 'r0000000001', expectedDigest: digest('a'),
      targetRevision: 'r0000000002', targetDigest: digest('b'), removalBindingIds: ['removed'] }
    await writeFile(path.join(hostRoot, D1_PENDING_PUBLICATION_FILE), JSON.stringify({ schemaVersion: 1, operationId: rollback.operationId,
      expectedRevision: rollback.expectedRevision, expectedDigest: rollback.expectedDigest, targetRevision: rollback.targetRevision,
      targetDigest: rollback.targetDigest, runtimeInputs: [], rollback, state: 'prepared' }));
    await chmod(path.join(hostRoot, D1_PENDING_PUBLICATION_FILE), 0o440)
    const status = { durableRevision: rollback.expectedRevision, servedRevision: rollback.expectedRevision, pendingOperation: rollback.operationId }
    const authority = { prepare: vi.fn(), commit: vi.fn(), discard: vi.fn(async () => status), status: vi.fn(async () => status) } as unknown as D1PublicationControlAuthority
    const server = await startD1PublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    const publishActive = vi.fn(); const client = createD1RootPublicationClient({ hostId: 'host-1', hostRoot, controlRoot,
      ownerUid: process.geteuid!(), appGid: process.getegid!(), operationId: 'new-operation', revisionStore: { publishActive } as never })
    try { await client.recover(); expect(publishActive).not.toHaveBeenCalled() }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it('bounds a silent control response', async () => {
    const controlRoot = await root(); await chmod(controlRoot, 0o730)
    const authority = { prepare: vi.fn(), commit: vi.fn(), status: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({
      durableRevision: null, servedRevision: null, pendingOperation: null,
    }), 50))) } as unknown as D1PublicationControlAuthority
    const server = await startD1PublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    const client = createD1RootPublicationClient({ hostId: 'host-1', hostRoot: await root(), controlRoot, ownerUid: process.geteuid!(),
      appGid: process.getegid!(), operationId: 'operation-1', revisionStore: {} as never, timeoutMs: 20 })
    try { await expect(client.status()).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED }) }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it.each([
    '{"action":"status"}\n{"action":"status"}\n',
    ['{"action":"status"}\n', '{"action":"status"}\n'],
    `${JSON.stringify({ action: 'prepare', operationId: 'x'.repeat(600) })}\n`,
    '{"action":"prepare","operationId":"operation-1","digest":"sha256:x"}\n',
  ])('rejects multiple, oversized, or caller-selected identity frames', async (frame) => {
    const controlRoot = await root(); await chmod(controlRoot, 0o730); const authority = { prepare: vi.fn(), commit: vi.fn(), status: vi.fn() } as unknown as D1PublicationControlAuthority
    const server = await startD1PublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    try {
      const result = await exchange(path.join(controlRoot, D1_PUBLICATION_SOCKET_FILE), frame)
      expect(result).toMatchObject({ ok: false, error: { code: D1HostErrorCode.PUBLICATION_FAILED } })
      expect(authority.prepare).not.toHaveBeenCalled()
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
