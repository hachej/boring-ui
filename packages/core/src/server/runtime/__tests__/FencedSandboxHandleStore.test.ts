import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  CoreFencedSandboxHandleAdmin,
  CoreFencedSandboxHandleStore,
  InMemorySandboxHandleBackend,
  createSandboxHandleCipher,
  type SandboxHandleLease,
} from '../FencedSandboxHandleStore.js'

const key = { hostScope: 'tenant-1', workspaceId: 'ws-1', provider: 'aws', mode: 'agentcore-remote-efs' }
const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array | null) => value && new TextDecoder().decode(value)
const fence = (lease: SandboxHandleLease) => ({ key: lease.key, generation: lease.generation, leaseToken: lease.leaseToken })
const cleanup = (outcome: 'succeeded' | 'failed' | 'ambiguous', recordedAt: string) => ({ outcome, recordedAt })
const evidence = (auditId: string) => ({
  auditId,
  operatorId: 'operator@example.test',
  detail: 'provider console and create request log inspected',
  recordedAt: '2026-09-14T00:00:02Z',
})

function fixture() {
  let now = Date.parse('2026-09-14T00:00:00Z')
  const backend = new InMemorySandboxHandleBackend()
  const cipher = createSandboxHandleCipher(randomBytes(32))
  return {
    backend,
    cipher,
    tick(ms: number) { now += ms },
    store: () => new CoreFencedSandboxHandleStore(backend, cipher, () => now),
    admin: () => new CoreFencedSandboxHandleAdmin(backend, () => now),
  }
}

async function claim(store: CoreFencedSandboxHandleStore, leaseOwner = 'worker', leaseForMs = 100): Promise<SandboxHandleLease> {
  const result = await store.claim({ key, leaseOwner, leaseForMs })
  if (!result || result.status !== 'claimed') throw new Error('expected successful claim')
  return result
}

async function createHandle(store: CoreFencedSandboxHandleStore, lease: SandboxHandleLease, value = 'opaque-provider-handle') {
  const attempt = await store.beginCreate(fence(lease))
  expect(attempt?.status).toBe('started')
  return store.update(fence(lease), bytes(value), 1)
}

describe('CoreFencedSandboxHandleStore', () => {
  it('serializes two-store claims and exposes secrets only from the successful claim', async () => {
    const f = fixture()
    const a = f.store()
    const b = f.store()
    const claims = await Promise.all([
      a.claim({ key, leaseOwner: 'a', leaseForMs: 1000 }),
      b.claim({ key, leaseOwner: 'b', leaseForMs: 1000 }),
    ])
    const winners = claims.filter((result): result is SandboxHandleLease => result?.status === 'claimed')
    expect(winners).toHaveLength(1)
    expect(claims).toContain(null)
    expect('get' in f.store()).toBe(false)

    const inspection = await f.admin().inspect(key)
    expect(inspection).toMatchObject({ generation: 1, hasHandle: false, leaseOwner: winners[0]!.leaseOwner })
    expect(inspection).not.toHaveProperty('leaseToken')
    expect(inspection).not.toHaveProperty('handle')
  })

  it('fences an expired owner after takeover, including dispose and delete', async () => {
    const f = fixture()
    const store = f.store()
    const old = await claim(store, 'old', 10)
    await createHandle(store, old)
    f.tick(11)
    const result = await f.store().claim({ key, leaseOwner: 'new', leaseForMs: 100 })
    if (!result || result.status !== 'claimed') throw new Error('expected takeover')
    expect(result.generation).toBe(old.generation + 1)
    expect(text(result.handle)).toBe('opaque-provider-handle')
    expect(await store.renew(fence(old), 10)).toBe(false)
    expect(await store.update(fence(old), bytes('stale'), 2)).toBe(false)
    expect(await store.release(fence(old))).toBe(false)
    expect(await store.delete(fence(old), cleanup('succeeded', '2026-09-14T00:00:01Z'))).toBe(false)
  })

  it('persists a create attempt before provider work and blocks takeover after a crash', async () => {
    const f = fixture()
    const store = f.store()
    const lease = await claim(store, 'crashing-worker', 10)
    const attempt = await store.beginCreate(fence(lease))
    expect(attempt).toMatchObject({ status: 'started' })
    expect(attempt?.idempotencyKey).toEqual(expect.any(String))
    expect((await f.admin().inspect(key))?.createAttempt).toMatchObject({
      state: 'started',
      idempotencyKey: attempt?.idempotencyKey,
    })

    // Provider create succeeds here, but the process crashes before update(handle).
    f.tick(11)
    const takeover = await f.store().claim({ key, leaseOwner: 'replacement', leaseForMs: 100 })
    expect(takeover).toMatchObject({
      status: 'create-ambiguous',
      generation: lease.generation,
      idempotencyKey: attempt?.idempotencyKey,
    })
    expect(takeover).not.toHaveProperty('leaseToken')
    expect(takeover).not.toHaveProperty('handle')
    expect(await f.store().beginCreate(fence(lease))).toBeNull()

    expect(await f.admin().reconcileCreateAbsent(key, evidence('audit-create'))).toBe(true)
    const replacement = await claim(f.store(), 'replacement')
    expect(replacement.generation).toBe(lease.generation + 1)
    expect((await f.admin().listAudit(key))[0]).toMatchObject({
      auditId: 'audit-create',
      action: 'reconcile-create-absent',
      operatorId: 'operator@example.test',
    })
  })

  it('records cleanup debt and tombstones successful deletion without resetting generation', async () => {
    const f = fixture()
    const store = f.store()
    const lease = await claim(store)
    await createHandle(store, lease)
    const replay = f.backend.rows.values().next().value?.payload

    expect(await store.delete(fence(lease), cleanup('ambiguous', '2026-09-14T00:00:01Z'))).toBe(false)
    expect((await f.admin().inspect(key))?.cleanup?.outcome).toBe('ambiguous')
    expect(await store.delete(fence(lease), cleanup('succeeded', '2026-09-14T00:00:02Z'))).toBe(true)
    expect(await f.admin().inspect(key)).toMatchObject({
      generation: 1,
      tombstoned: true,
      hasHandle: false,
      cleanup: { outcome: 'succeeded' },
    })

    const recreated = await claim(f.store(), 'recreator')
    expect(recreated.generation).toBe(2)
    expect(recreated.handle).toBeNull()
    expect(() => f.cipher.decrypt(key, recreated.generation, 1, replay!)).toThrow()
  })

  it('requires attributable admin evidence and refuses active-lease reconciliation by default', async () => {
    const f = fixture()
    const lease = await claim(f.store(), 'live-worker', 100)
    await expect(f.admin().reconcileDelete(key, cleanup('succeeded', '2026-09-14T00:00:01Z'), {
      ...evidence(''),
      auditId: '',
    })).rejects.toThrow('auditId')
    expect(await f.admin().reconcileDelete(key, cleanup('succeeded', '2026-09-14T00:00:01Z'), evidence('audit-refused'))).toBe(false)
    expect((await f.admin().inspect(key))?.tombstoned).toBe(false)
    expect(await f.admin().reconcileDelete(
      key,
      cleanup('succeeded', '2026-09-14T00:00:01Z'),
      evidence('audit-authorized'),
      { allowActiveLease: true },
    )).toBe(true)
    expect((await f.admin().inspect(key))?.tombstoned).toBe(true)
    expect(f.store()).not.toHaveProperty('reconcileDelete')
    expect(Object.keys(key)).not.toContain('efsPath')
    expect(lease.generation).toBe(1)
  })
})
