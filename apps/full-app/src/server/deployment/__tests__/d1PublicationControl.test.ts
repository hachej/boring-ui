import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  D1_PENDING_PUBLICATION_FILE,
  D1_PUBLICATION_SOCKET_FILE,
  parseD1PendingPublication,
  readD1PendingPublication,
  startD1PublicationControlServer,
  type D1PublicationControlAuthority,
} from '../d1PublicationControl.js'
import { D1HostErrorCode } from '../d1Plan.js'

const digest = (value: string) => `sha256:${value.repeat(64)}` as const
const roots: string[] = []
const pending = { schemaVersion: 1, operationId: 'operation-1', expectedRevision: 'r0000000001', expectedDigest: digest('a'),
  targetRevision: 'r0000000002', targetDigest: digest('b'), runtimeInputs: [] }

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
    const authority = { prepare: vi.fn(async () => status), commit: vi.fn(async () => status), status: vi.fn(async () => status) } satisfies D1PublicationControlAuthority
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
