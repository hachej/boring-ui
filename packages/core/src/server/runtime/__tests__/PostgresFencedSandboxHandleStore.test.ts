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
import {
  PostgresFencedSandboxHandleAdmin,
  PostgresFencedSandboxHandleForceAdmin,
  PostgresFencedSandboxHandleStore,
} from '../PostgresFencedSandboxHandleStore.js'

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
const evidence = (auditId: string) => ({
  auditId,
  operatorId: 'operator@example.test',
  detail: 'provider request log and console inspected',
  recordedAt: '2026-09-14T00:00:04.000Z',
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
    admin: new PostgresFencedSandboxHandleAdmin(drizzle(sqlA)),
    forceAdmin: new PostgresFencedSandboxHandleForceAdmin(drizzle(sqlA)),
  }
}

async function claim(
  store: PostgresFencedSandboxHandleStore,
  key = KEY,
  leaseOwner = 'process-a',
  leaseForMs = 10_000,
): Promise<SandboxHandleLease> {
  const result = await store.claim({ key, leaseOwner, leaseForMs })
  if (!result || result.status !== 'claimed') throw new Error('expected successful claim')
  return result
}

async function expireLease(sql: postgres.Sql, key = KEY) {
  await sql`
    UPDATE fenced_sandbox_handles
    SET lease_expires_at = clock_timestamp() - interval '1 second'
    WHERE host_scope = ${key.hostScope}
      AND workspace_id = ${key.workspaceId}
      AND provider = ${key.provider}
      AND mode = ${key.mode}
  `
}

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlA = postgres(TEST_DB_URL, { max: 2 })
  sqlB = postgres(TEST_DB_URL, { max: 2 })
})

afterAll(async () => {
  if (sqlA) {
    await sqlA`DELETE FROM fenced_sandbox_handle_audit WHERE host_scope = ${HOST_SCOPE}`
    await sqlA`DELETE FROM fenced_sandbox_handles WHERE host_scope = ${HOST_SCOPE}`
  }
  await Promise.all([sqlA?.end(), sqlB?.end()])
})

beforeEach(async () => {
  await sqlA`DELETE FROM fenced_sandbox_handle_audit WHERE host_scope = ${HOST_SCOPE}`
  await sqlA`DELETE FROM fenced_sandbox_handles WHERE host_scope = ${HOST_SCOPE}`
})

describe('PostgresFencedSandboxHandleStore', () => {
  it('atomically admits one claimer and exposes plaintext/token only from that successful claim', async () => {
    const { a, b, admin } = stores()
    const claims = await Promise.all([
      a.claim({ key: KEY, leaseOwner: 'process-a', leaseForMs: 10_000 }),
      b.claim({ key: KEY, leaseOwner: 'process-b', leaseForMs: 10_000 }),
    ])
    const winners = claims.filter((result): result is SandboxHandleLease => result?.status === 'claimed')
    expect(winners).toHaveLength(1)
    expect(claims).toContain(null)
    expect(winners[0]!.generation).toBe(1)
    expect(a).not.toHaveProperty('get')
    expect(a).not.toHaveProperty('reconcileDelete')

    const inspection = await admin.inspect(KEY)
    expect(inspection).toMatchObject({ generation: 1, hasHandle: false })
    expect(inspection).not.toHaveProperty('leaseToken')
    expect(inspection).not.toHaveProperty('handle')
  })

  it('survives restart encrypted at rest and fences stale mutations after expiry takeover', async () => {
    const { a, b } = stores()
    const oldLease = await claim(a, KEY, 'old-process')
    const attempt = await a.beginCreate(fence(oldLease))
    expect(attempt?.status).toBe('started')
    await a.update(fence(oldLease), bytes(SECRET), 7)

    const [raw] = await sqlA<{
      encrypted_handle: Uint8Array
      encryption_nonce: Uint8Array
      encryption_auth_tag: Uint8Array
      encryption_version: number
      handle_version: number
      create_attempt_idempotency_key: string
      create_attempt_state: string
    }[]>`
      SELECT encrypted_handle, encryption_nonce, encryption_auth_tag, encryption_version,
             handle_version, create_attempt_idempotency_key, create_attempt_state
      FROM fenced_sandbox_handles
      WHERE host_scope = ${KEY.hostScope}
        AND workspace_id = ${KEY.workspaceId}
        AND provider = ${KEY.provider}
        AND mode = ${KEY.mode}
    `
    expect(raw).toMatchObject({
      encryption_version: 1,
      handle_version: 7,
      create_attempt_idempotency_key: attempt?.idempotencyKey,
      create_attempt_state: 'completed',
    })
    expect(Buffer.from(raw!.encrypted_handle).includes(Buffer.from(SECRET))).toBe(false)
    expect(raw!.encryption_nonce).toHaveLength(12)
    expect(raw!.encryption_auth_tag).toHaveLength(16)

    await expireLease(sqlA)
    const restarted = new PostgresFencedSandboxHandleStore(drizzle(sqlB), cipher)
    const nextLease = await claim(restarted, KEY, 'new-process')
    expect(nextLease.generation).toBe(oldLease.generation + 1)
    expect(text(nextLease.handle)).toBe(SECRET)
    await expect(a.renew(fence(oldLease), 10_000)).resolves.toBe(false)
    await expect(a.update(fence(oldLease), bytes('stale-write'), 2)).resolves.toBe(false)
    await expect(a.release(fence(oldLease))).resolves.toBe(false)
    await expect(a.delete(fence(oldLease), {
      outcome: 'succeeded',
      recordedAt: new Date().toISOString(),
    })).resolves.toBe(false)
  })

  it('returns create-ambiguous after provider success crashes before handle persistence', async () => {
    const { a, b, admin } = stores()
    const lease = await claim(a, KEY, 'crashing-process')
    const attempt = await a.beginCreate(fence(lease))
    expect(attempt).toMatchObject({ status: 'started', idempotencyKey: expect.any(String) })
    expect((await admin.inspect(KEY))?.createAttempt).toMatchObject({
      state: 'started',
      idempotencyKey: attempt?.idempotencyKey,
    })

    // The provider accepted create(attempt.idempotencyKey), then this owner crashed.
    expect(await admin.reconcileCreateAbsent(KEY, evidence('audit-create-active-refused'))).toBe(false)
    expect((await admin.inspect(KEY))?.createAttempt?.state).toBe('started')
    await expireLease(sqlA)
    await expect(b.claim({ key: KEY, leaseOwner: 'replacement', leaseForMs: 10_000 })).resolves.toMatchObject({
      status: 'create-ambiguous',
      idempotencyKey: attempt?.idempotencyKey,
      generation: lease.generation,
    })
    expect(await admin.reconcileCreateAbsent(KEY, evidence('audit-create-absent'))).toBe(true)
    const replacement = await claim(b, KEY, 'replacement')
    expect(replacement.generation).toBe(lease.generation + 1)
  })

  it('tombstones deletion, preserves receipt/generation, and rejects old ciphertext replay after recreation', async () => {
    const { a, b, admin } = stores()
    const lease = await claim(a)
    await a.beginCreate(fence(lease))
    await a.update(fence(lease), bytes(SECRET), 4)
    const [old] = await sqlA<{
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

    await expect(a.delete(fence(lease), {
      outcome: 'ambiguous',
      detail: 'provider timeout',
      recordedAt: '2026-09-14T00:00:01.000Z',
    })).resolves.toBe(false)
    expect((await admin.inspect(KEY))?.cleanup?.outcome).toBe('ambiguous')
    await expect(a.delete(fence(lease), {
      outcome: 'succeeded',
      detail: 'provider confirmed deletion',
      recordedAt: '2026-09-14T00:00:03.000Z',
    })).resolves.toBe(true)
    expect(await admin.inspect(KEY)).toMatchObject({
      generation: 1,
      tombstoned: true,
      hasHandle: false,
      cleanup: { outcome: 'succeeded', detail: 'provider confirmed deletion' },
    })

    const recreated = await claim(b, KEY, 'recreator')
    expect(recreated.generation).toBe(2)
    expect(recreated.handle).toBeNull()
    await sqlA`
      UPDATE fenced_sandbox_handles
      SET encrypted_handle = ${old!.encrypted_handle},
          encryption_nonce = ${old!.encryption_nonce},
          encryption_auth_tag = ${old!.encryption_auth_tag},
          encryption_version = ${old!.encryption_version},
          handle_version = ${old!.handle_version}
      WHERE host_scope = ${KEY.hostScope}
        AND workspace_id = ${KEY.workspaceId}
        AND provider = ${KEY.provider}
        AND mode = ${KEY.mode}
    `
    await expireLease(sqlA)
    await expect(a.claim({ key: KEY, leaseOwner: 'replay-reader', leaseForMs: 10_000 })).rejects.toThrow()
  })

  it('isolates discriminators, always refuses ordinary active-lease reconciliation, and fences stale force evidence', async () => {
    const { a, b, admin, forceAdmin } = stores()
    const lease = await claim(a)
    const otherKey = { ...KEY, provider: 'ecs', mode: 'ecs-local-efs' }
    const otherLease = await claim(b, otherKey, 'other-process')
    expect(otherLease.leaseToken).not.toBe(lease.leaseToken)

    expect(await admin.reconcileDelete(KEY, {
      outcome: 'succeeded',
      recordedAt: '2026-09-14T00:00:03.000Z',
    }, evidence('audit-refused'))).toBe(false)
    expect((await admin.inspect(KEY))?.tombstoned).toBe(false)

    await expireLease(sqlA)
    const generationTwo = await claim(b, KEY, 'generation-two-process')
    expect(generationTwo.generation).toBe(2)
    expect(await forceAdmin.forceReconcileDelete(KEY, lease.generation, {
      outcome: 'succeeded',
      detail: 'stale generation-one provider evidence',
      recordedAt: '2026-09-14T00:00:03.000Z',
    }, evidence('stale-generation-one-evidence'))).toBe(false)
    expect(await admin.inspect(KEY)).toMatchObject({ generation: 2, tombstoned: false })
    expect((await admin.listAudit(KEY)).map((entry) => entry.auditId)).not.toContain('stale-generation-one-evidence')

    expect(await forceAdmin.forceReconcileDelete(KEY, generationTwo.generation, {
      outcome: 'succeeded',
      detail: 'current generation-two provider evidence',
      recordedAt: '2026-09-14T00:00:03.000Z',
    }, evidence('current-generation-two-evidence'))).toBe(true)
    expect((await admin.listAudit(KEY)).map((entry) => entry.action)).toEqual([
      'reconcile-delete-refused-active-lease',
      'reconcile-delete',
    ])
    expect(admin).not.toHaveProperty('forceReconcileDelete')
    expect(Object.keys(KEY)).not.toContain('efsPath')
  })
})
