import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  CoreFencedSandboxHandleAdmin,
  CoreFencedSandboxHandleForceAdmin,
  CoreFencedSandboxHandleStore,
  InMemorySandboxHandleBackend,
  createSandboxHandleCipher,
  type SandboxHandleLease,
} from '../FencedSandboxHandleStore.js'
import { pendingTakeoverConformance } from './takeoverConformance.js'

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
    forceAdmin: () => new CoreFencedSandboxHandleForceAdmin(backend, () => now),
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
  expect(await store.update(fence(lease), bytes(value), 1)).toBe(true)
  return store.publish(fence(lease))
}

pendingTakeoverConformance('CoreFencedSandboxHandleStore', () => {
  const f = fixture()
  return {
    key,
    first: f.store(),
    successor: f.store(),
    async expire() { f.tick(10_001) },
  }
})

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
    expect(await store.renew(fence(old), 10)).toBeNull()
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
    expect(await f.admin().reconcileCreateAbsent(key, lease.generation, evidence('audit-create-active-refused'))).toBe(false)
    expect((await f.admin().inspect(key))?.createAttempt?.state).toBe('started')
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

    expect(await f.admin().reconcileCreateAbsent(key, lease.generation, evidence('audit-create'))).toBe(true)
    const replacement = await claim(f.store(), 'replacement')
    expect(replacement.generation).toBe(lease.generation + 1)
    expect(await f.admin().listAudit(key)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        auditId: 'audit-create',
        action: 'reconcile-create-absent',
        operatorId: 'operator@example.test',
      }),
    ]))
  })

  it('does not let stale ordinary create reconciliation clear a newer create attempt or audit', async () => {
    const f = fixture()
    const first = await claim(f.store(), 'first', 10)
    await f.store().beginCreate(fence(first))
    f.tick(11)
    expect(await f.admin().reconcileCreateAbsent(key, first.generation, evidence('release-gen-one'))).toBe(true)

    const second = await claim(f.store(), 'second', 10)
    expect(second.generation).toBe(2)
    const secondAttempt = await f.store().beginCreate(fence(second))
    expect(secondAttempt?.status).toBe('started')
    f.tick(11)

    expect(await f.admin().reconcileCreateAbsent(key, first.generation, evidence('stale-gen-one-create'))).toBe(false)
    expect((await f.admin().inspect(key))?.createAttempt).toMatchObject({
      state: 'started',
      idempotencyKey: secondAttempt?.idempotencyKey,
    })
    expect((await f.admin().listAudit(key)).map((record) => record.auditId)).not.toContain('stale-gen-one-create')
  })

  it('does not let stale ordinary delete reconciliation tombstone a newer handle or audit', async () => {
    const f = fixture()
    const first = await claim(f.store(), 'first', 10)
    await createHandle(f.store(), first)
    f.tick(11)
    const second = await claim(f.store(), 'second', 10)
    expect(text(second.handle)).toBe('opaque-provider-handle')
    await f.store().release(fence(second))

    expect(await f.admin().reconcileDelete(
      key,
      first.generation,
      cleanup('succeeded', '2026-09-14T00:00:03Z'),
      evidence('stale-gen-one-delete'),
    )).toBe(false)
    expect(await f.admin().inspect(key)).toMatchObject({ generation: 2, tombstoned: false, hasHandle: true })
    expect((await f.admin().listAudit(key)).map((record) => record.auditId)).not.toContain('stale-gen-one-delete')
  })

  it('refuses to publish after failed cleanup debt and carries pending handle through takeover', async () => {
    const f = fixture()
    const first = await claim(f.store(), 'first', 10)
    await f.store().beginCreate(fence(first))
    expect(await f.store().update(fence(first), bytes('pending-handle'), 1)).toBe(true)
    expect(await f.store().delete(fence(first), cleanup('failed', '2026-09-14T00:00:01Z'))).toBe(false)
    expect(await f.store().publish(fence(first))).toBe(false)

    f.tick(11)
    const takeover = await f.store().claim({ key, leaseOwner: 'takeover', leaseForMs: 100 })
    if (!takeover || takeover.status !== 'claimed') throw new Error('expected takeover')
    expect(text(takeover.handle)).toBe('pending-handle')
    expect(takeover.handleState).toBe('pending-validation')
    expect(takeover.cleanup?.outcome).toBe('failed')
    expect(await f.store().publish(fence(takeover))).toBe(false)
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

  it('always refuses ordinary active-lease reconciliation and fences stale force evidence', async () => {
    const f = fixture()
    const lease = await claim(f.store(), 'live-worker', 100)
    await expect(f.admin().reconcileDelete(key, lease.generation, cleanup('succeeded', '2026-09-14T00:00:01Z'), {
      ...evidence(''),
      auditId: '',
    })).rejects.toThrow('auditId')
    expect(await f.admin().reconcileDelete(key, lease.generation, cleanup('succeeded', '2026-09-14T00:00:01Z'), evidence('audit-refused'))).toBe(false)
    expect((await f.admin().inspect(key))?.tombstoned).toBe(false)

    f.tick(101)
    const generationTwo = await claim(f.store(), 'next-live-worker', 100)
    expect(generationTwo.generation).toBe(2)
    expect(await f.forceAdmin().forceReconcileDelete(
      key,
      lease.generation,
      cleanup('succeeded', '2026-09-14T00:00:01Z'),
      evidence('stale-generation-one-evidence'),
    )).toBe(false)
    expect(await f.admin().inspect(key)).toMatchObject({ generation: 2, tombstoned: false })
    expect((await f.admin().listAudit(key)).map((record) => record.auditId)).not.toContain('stale-generation-one-evidence')

    expect(await f.forceAdmin().forceReconcileDelete(
      key,
      generationTwo.generation,
      cleanup('succeeded', '2026-09-14T00:00:01Z'),
      evidence('current-generation-two-evidence'),
    )).toBe(true)
    expect((await f.admin().inspect(key))?.tombstoned).toBe(true)
    expect(f.store()).not.toHaveProperty('reconcileDelete')
    expect(f.admin()).not.toHaveProperty('forceReconcileDelete')
    expect(Object.keys(key)).not.toContain('efsPath')
  })
})
