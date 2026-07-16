import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AGENT_HOST_PENDING_PUBLICATION_FILE,
  AGENT_HOST_PUBLICATION_SOCKET_FILE,
  createAgentHostRootPublicationClient,
  parseAgentHostPendingPublication,
  readAgentHostPendingPublication,
  startAgentHostPublicationControlServer,
  type AgentHostPublicationControlAuthority,
} from '../agentHostPublicationControl.js'
import { AgentHostErrorCode } from '../agentHostPlan.js'

const digest = (value: string) => `sha256:${value.repeat(64)}` as const
const roots: string[] = []
const pending = { schemaVersion: 1, operationId: 'operation-1', expectedRevision: 'r0000000001', expectedDigest: digest('a'),
  targetRevision: 'r0000000002', targetDigest: digest('b'), runtimeInputs: [], rollback: null, state: 'prepared' as const }

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'agent-host-control-')); roots.push(value); await chmod(value, 0o710); return value
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

describe('AgentHost core publication control', () => {
  it('accepts only the canonical root-owned pending identity', async () => {
    expect(parseAgentHostPendingPublication(pending)).toEqual(pending)
    expect(() => parseAgentHostPendingPublication({ ...pending, path: '/private' })).toThrow()
    expect(() => parseAgentHostPendingPublication({ ...pending, expectedDigest: null })).toThrow()
    const controlRoot = await root(); const file = path.join(controlRoot, AGENT_HOST_PENDING_PUBLICATION_FILE)
    await writeFile(file, JSON.stringify(pending)); await chmod(file, 0o440)
    await expect(readAgentHostPendingPublication({ root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })).resolves.toEqual(pending)
    await chmod(file, 0o644)
    await expect(readAgentHostPendingPublication({ root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() }))
      .rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
  })

  it('dispatches one bounded fixed-action frame and returns redacted status', async () => {
    const controlRoot = await root(); await chmod(controlRoot, 0o730); const status = { durableRevision: 'r0000000002', servedRevision: 'r0000000001', pendingOperation: 'operation-1' }
    const authority = { prepare: vi.fn(async () => status), commit: vi.fn(async () => status), discard: vi.fn(async () => status), status: vi.fn(async () => status) } satisfies AgentHostPublicationControlAuthority
    const server = await startAgentHostPublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    try {
      const socket = path.join(controlRoot, AGENT_HOST_PUBLICATION_SOCKET_FILE)
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
      commit: vi.fn(async () => status()), discard: vi.fn(async () => status()), status: vi.fn(async () => status()) } satisfies AgentHostPublicationControlAuthority
    let started: Promise<Awaited<ReturnType<typeof startAgentHostPublicationControlServer>>> | undefined
    const startCore = vi.fn(async () => { started = new Promise((resolve) => setTimeout(() => {
      startAgentHostPublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() }).then(resolve)
    }, 30)) }); const startIngress = vi.fn(async () => {
      expect(JSON.parse(await readFile(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE), 'utf8'))).toMatchObject({ state: 'committed' })
    })
    const desired = { schemaVersion: 1, domain: 'boring-agent-host-desired:v1', plan: { schemaVersion: 1, hostId: 'host-1', hostAppImageDigest: digest('f'),
      runtimeProfileRef: 'runsc', databaseRef: 'database', workspaceRootPolicyRef: 'workspaces', sessionRootPolicyRef: 'sessions', bindings: [] }, resolvedBindings: [] }
    const candidate = { ...target, desired, secretRefs: { schemaVersion: 1, domain: 'boring-agent-host-secret-refs:v1', bindings: [] } } as never
    const store = { readActive: vi.fn(async () => active) } as never
    const client = createAgentHostRootPublicationClient({ hostId: 'host-1', hostRoot, controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!(),
      operationId: 'operation-1', revisionStore: store, startCore, startIngress, startupTimeoutMs: 200 })
    try {
      await client.preload(candidate, []); expect(startCore).toHaveBeenCalledOnce()
      expect(await lstat(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE))).toMatchObject({ mode: expect.any(Number) })
      active = target; await client.verifyActive(target); expect(startIngress).toHaveBeenCalledOnce()
      await expect(lstat(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { if (started) { const server = await started; await new Promise<void>((resolve) => server.close(() => resolve())) } }
  })

  it('retries exact initial core startup when pending exists before any socket', async () => {
    const hostRoot = await root(); const controlRoot = await root(); const first = { ...pending, expectedRevision: null, expectedDigest: null }
    await writeFile(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE), JSON.stringify(first)); await chmod(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE), 0o440)
    const status = { durableRevision: null, servedRevision: null, pendingOperation: first.operationId }
    const authority = { prepare: vi.fn(), commit: vi.fn(), discard: vi.fn(async () => status), status: vi.fn(async () => status) } as unknown as AgentHostPublicationControlAuthority
    let started: Promise<Awaited<ReturnType<typeof startAgentHostPublicationControlServer>>> | undefined
    const startCore = vi.fn(async () => { started = new Promise((resolve) => setTimeout(() => {
      startAgentHostPublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() }).then(resolve)
    }, 30)) })
    const client = createAgentHostRootPublicationClient({ hostId: 'host-1', hostRoot, controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!(),
      operationId: 'new-operation', revisionStore: { readCandidate: vi.fn(async () => ({ revisionId: first.targetRevision, desiredStateDigest: first.targetDigest })),
        readComplete: vi.fn(async () => null) } as never, startCore, timeoutMs: 20, startupTimeoutMs: 200 })
    try { await client.recover(); expect(startCore).toHaveBeenCalledOnce() }
    finally { if (started) { const server = await started; await new Promise<void>((resolve) => server.close(() => resolve())) } }
  })

  it('discards a pre-journal destructive prepare without publishing its COMPLETE target', async () => {
    const hostRoot = await root(); const controlRoot = await root(); await chmod(controlRoot, 0o730)
    const rollback = { operationId: 'operation-1', hostId: 'host-1', expectedRevision: 'r0000000001', expectedDigest: digest('a'),
      targetRevision: 'r0000000002', targetDigest: digest('b'), removalBindingIds: ['removed'] }
    await writeFile(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE), JSON.stringify({ schemaVersion: 1, operationId: rollback.operationId,
      expectedRevision: rollback.expectedRevision, expectedDigest: rollback.expectedDigest, targetRevision: rollback.targetRevision,
      targetDigest: rollback.targetDigest, runtimeInputs: [], rollback, state: 'prepared' }));
    await chmod(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE), 0o440)
    const status = { durableRevision: rollback.expectedRevision, servedRevision: rollback.expectedRevision, pendingOperation: rollback.operationId }
    const authority = { prepare: vi.fn(), commit: vi.fn(), discard: vi.fn(async () => status), status: vi.fn(async () => status) } as unknown as AgentHostPublicationControlAuthority
    const server = await startAgentHostPublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    const publishActive = vi.fn(); const client = createAgentHostRootPublicationClient({ hostId: 'host-1', hostRoot, controlRoot,
      ownerUid: process.geteuid!(), appGid: process.getegid!(), operationId: 'new-operation', revisionStore: { publishActive } as never })
    try { await client.recover(); expect(publishActive).not.toHaveBeenCalled() }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it('bounds a silent control response', async () => {
    const controlRoot = await root(); await chmod(controlRoot, 0o730)
    const authority = { prepare: vi.fn(), commit: vi.fn(), status: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({
      durableRevision: null, servedRevision: null, pendingOperation: null,
    }), 50))) } as unknown as AgentHostPublicationControlAuthority
    const server = await startAgentHostPublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    const hostRoot = await root(); const initial = { ...pending, expectedRevision: null, expectedDigest: null }
    await writeFile(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE), JSON.stringify(initial)); await chmod(path.join(hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE), 0o440)
    const startCore = vi.fn(); const client = createAgentHostRootPublicationClient({ hostId: 'host-1', hostRoot, controlRoot, ownerUid: process.geteuid!(),
      appGid: process.getegid!(), operationId: 'operation-1', revisionStore: {} as never, startCore, timeoutMs: 20 })
    try { await expect(client.recover()).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED }); expect(startCore).not.toHaveBeenCalled() }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it.each([
    '{"action":"status"}\n{"action":"status"}\n',
    ['{"action":"status"}\n', '{"action":"status"}\n'],
    `${JSON.stringify({ action: 'prepare', operationId: 'x'.repeat(600) })}\n`,
    '{"action":"prepare","operationId":"operation-1","digest":"sha256:x"}\n',
  ])('rejects multiple, oversized, or caller-selected identity frames', async (frame) => {
    const controlRoot = await root(); await chmod(controlRoot, 0o730); const authority = { prepare: vi.fn(), commit: vi.fn(), status: vi.fn() } as unknown as AgentHostPublicationControlAuthority
    const server = await startAgentHostPublicationControlServer(authority, { root: controlRoot, ownerUid: process.geteuid!(), appGid: process.getegid!() })
    try {
      const result = await exchange(path.join(controlRoot, AGENT_HOST_PUBLICATION_SOCKET_FILE), frame)
      expect(result).toMatchObject({ ok: false, error: { code: AgentHostErrorCode.PUBLICATION_FAILED } })
      expect(authority.prepare).not.toHaveBeenCalled()
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
