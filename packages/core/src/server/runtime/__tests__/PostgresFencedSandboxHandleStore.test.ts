import { randomBytes } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { CoreConfig } from '../../../shared/types.js'
import { runMigrations } from '../../db/migrate.js'
import {
  createSandboxHandleCipher,
  type SandboxHandleKey,
  type SandboxHandleLease,
} from '../FencedSandboxHandleStore.js'
import { PostgresFencedSandboxHandleStore } from '../PostgresFencedSandboxHandleStore.js'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const HOST_SCOPE = `fenced-postgres-${process.pid}`
const KEY: SandboxHandleKey = {
  hostScope: HOST_SCOPE,
  workspaceId: 'workspace-1',
  provider: 'agentcore',
  mode: 'agentcore-remote-efs',
}
const SECRET = 'opaque-provider-handle'
const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array | null) => value && new TextDecoder().decode(value)
const fence = (lease: SandboxHandleLease) => ({
  key: lease.key,
  generation: lease.generation,
  leaseToken: lease.leaseToken,
})

const BASE_CONFIG: CoreConfig = {
  appId: 'fenced-postgres-test',
  appName: 'Fenced Postgres Test',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl: TEST_DB_URL,
  stores: 'postgres',
  defaultAgentTypeId: 'default',
  cors: { origins: ['http://localhost:3000'], credentials: true },
  bodyLimit: 16 * 1024 * 1024,
  logLevel: 'error',
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64),
    url: 'http://localhost:3000',
    sessionTtlSeconds: 3600,
    sessionCookieSecure: false,
  },
  features: {
    githubOauth: false,
    googleOauth: false,
    invitesEnabled: true,
    sendWelcomeEmail: true,
    inviteTtlDays: 7,
  },
}

let sqlA: postgres.Sql
let sqlB: postgres.Sql
const cipher = createSandboxHandleCipher(randomBytes(32))

function stores() {
  return {
    a: new PostgresFencedSandboxHandleStore(drizzle(sqlA), cipher),
    b: new PostgresFencedSandboxHandleStore(drizzle(sqlB), cipher),
  }
}

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlA = postgres(TEST_DB_URL, { max: 2 })
  sqlB = postgres(TEST_DB_URL, { max: 2 })
})

afterAll(async () => {
  if (sqlA) await sqlA`DELETE FROM fenced_sandbox_handles WHERE host_scope = ${HOST_SCOPE}`
  await Promise.all([sqlA?.end(), sqlB?.end()])
})

beforeEach(async () => {
  await sqlA`DELETE FROM fenced_sandbox_handles WHERE host_scope = ${HOST_SCOPE}`
})

describe('PostgresFencedSandboxHandleStore', () => {
  it('atomically admits one of two independently connected claimers and survives restart encrypted at rest', async () => {
    const { a, b } = stores()
    const claims = await Promise.all([
      a.claim({ key: KEY, leaseOwner: 'process-a', leaseForMs: 10_000 }),
      b.claim({ key: KEY, leaseOwner: 'process-b', leaseForMs: 10_000 }),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const winner = claims.find((claim): claim is SandboxHandleLease => claim !== null)
    if (!winner) throw new Error('expected a winning claim')
    expect(winner.generation).toBe(1)

    await (winner.leaseOwner === 'process-a' ? a : b).update(fence(winner), bytes(SECRET), 7)
    const restarted = new PostgresFencedSandboxHandleStore(drizzle(sqlB), cipher)
    expect(text((await restarted.get(KEY))!.handle)).toBe(SECRET)

    const [raw] = await sqlA<{
      encrypted_handle: Uint8Array
      encryption_nonce: Uint8Array
      encryption_auth_tag: Uint8Array
      encryption_version: number
      handle_version: number
    }[]>`
      SELECT encrypted_handle, encryption_nonce, encryption_auth_tag, encryption_version, handle_version
      FROM fenced_sandbox_handles
      WHERE host_scope = ${KEY.hostScope}
        AND workspace_id = ${KEY.workspaceId}
        AND provider = ${KEY.provider}
        AND mode = ${KEY.mode}
    `
    expect(raw).toMatchObject({ encryption_version: 1, handle_version: 7 })
    expect(Buffer.from(raw!.encrypted_handle).includes(Buffer.from(SECRET))).toBe(false)
    expect(raw!.encryption_nonce).toHaveLength(12)
    expect(raw!.encryption_auth_tag).toHaveLength(16)
  })

  it('increments generation on expiry takeover and fences the stale writer, releaser, and deleter', async () => {
    const { a, b } = stores()
    const oldLease = (await a.claim({ key: KEY, leaseOwner: 'old-process', leaseForMs: 10_000 }))!
    await a.update(fence(oldLease), bytes(SECRET), 1)
    await sqlA`
      UPDATE fenced_sandbox_handles
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE host_scope = ${KEY.hostScope}
        AND workspace_id = ${KEY.workspaceId}
        AND provider = ${KEY.provider}
        AND mode = ${KEY.mode}
    `

    const nextLease = (await b.claim({ key: KEY, leaseOwner: 'new-process', leaseForMs: 10_000 }))!
    expect(nextLease.generation).toBe(oldLease.generation + 1)
    expect(text(nextLease.handle)).toBe(SECRET)
    await expect(a.renew(fence(oldLease), 10_000)).resolves.toBeNull()
    await expect(a.update(fence(oldLease), bytes('stale-write'), 2)).resolves.toBeNull()
    await expect(a.release(fence(oldLease))).resolves.toBe(false)
    await expect(a.delete(fence(oldLease), {
      outcome: 'succeeded',
      recordedAt: new Date().toISOString(),
    })).resolves.toBe(false)
    expect((await b.get(KEY))?.leaseToken).toBe(nextLease.leaseToken)
    expect(text((await b.get(KEY))!.handle)).toBe(SECRET)
  })

  it('isolates provider and mode, rejects AAD replay, and persists cleanup debt before deletion', async () => {
    const { a, b } = stores()
    const lease = (await a.claim({ key: KEY, leaseOwner: 'cleanup-process', leaseForMs: 10_000 }))!
    await a.update(fence(lease), bytes(SECRET), 4)

    const otherKey = { ...KEY, provider: 'ecs', mode: 'ecs-local-efs' }
    const otherLease = (await b.claim({ key: otherKey, leaseOwner: 'other-process', leaseForMs: 10_000 }))!
    expect(otherLease.leaseToken).not.toBe(lease.leaseToken)
    await sqlA`
      UPDATE fenced_sandbox_handles AS target
      SET encrypted_handle = source.encrypted_handle,
          encryption_nonce = source.encryption_nonce,
          encryption_auth_tag = source.encryption_auth_tag,
          encryption_version = source.encryption_version,
          handle_version = source.handle_version
      FROM fenced_sandbox_handles AS source
      WHERE target.host_scope = ${otherKey.hostScope}
        AND target.workspace_id = ${otherKey.workspaceId}
        AND target.provider = ${otherKey.provider}
        AND target.mode = ${otherKey.mode}
        AND source.host_scope = ${KEY.hostScope}
        AND source.workspace_id = ${KEY.workspaceId}
        AND source.provider = ${KEY.provider}
        AND source.mode = ${KEY.mode}
    `
    await expect(b.get(otherKey)).rejects.toThrow()

    await expect(a.delete(fence(lease), {
      outcome: 'ambiguous',
      detail: 'provider timeout',
      recordedAt: '2026-09-14T00:00:01.000Z',
    })).resolves.toBe(false)
    expect((await a.get(KEY))?.cleanup).toEqual({
      outcome: 'ambiguous',
      detail: 'provider timeout',
      recordedAt: '2026-09-14T00:00:01.000Z',
    })
    await expect(a.delete(fence(lease), {
      outcome: 'failed',
      detail: 'provider unavailable',
      recordedAt: '2026-09-14T00:00:02.000Z',
    })).resolves.toBe(false)
    const [debt] = await sqlA<{ cleanup_outcome: string; cleanup_detail: string }[]>`
      SELECT cleanup_outcome, cleanup_detail
      FROM fenced_sandbox_handles
      WHERE host_scope = ${KEY.hostScope}
        AND workspace_id = ${KEY.workspaceId}
        AND provider = ${KEY.provider}
        AND mode = ${KEY.mode}
    `
    expect(debt).toEqual({ cleanup_outcome: 'failed', cleanup_detail: 'provider unavailable' })

    await expect(a.delete(fence(lease), {
      outcome: 'succeeded',
      detail: 'provider confirmed deletion',
      recordedAt: '2026-09-14T00:00:03.000Z',
    })).resolves.toBe(true)
    await expect(a.get(KEY)).resolves.toBeNull()
  })
})
