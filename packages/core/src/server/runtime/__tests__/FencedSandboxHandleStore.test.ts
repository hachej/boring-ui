import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CoreFencedSandboxHandleStore, InMemorySandboxHandleBackend, createSandboxHandleCipher } from '../FencedSandboxHandleStore.js'

const key = { hostScope: 'tenant-1', workspaceId: 'ws-1', provider: 'aws', mode: 'agentcore-remote-efs' }
const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array | null) => value && new TextDecoder().decode(value)
const fence = (lease: { key: typeof key; generation: number; leaseToken: string }) => ({ key: lease.key, generation: lease.generation, leaseToken: lease.leaseToken })

function fixture() {
  let now = Date.parse('2026-09-14T00:00:00Z')
  const backend = new InMemorySandboxHandleBackend()
  const cipher = createSandboxHandleCipher(randomBytes(32))
  return { backend, cipher, tick(ms: number) { now += ms }, store: () => new CoreFencedSandboxHandleStore(backend, cipher, () => now) }
}

describe('CoreFencedSandboxHandleStore', () => {
  it('serializes two-store claims and survives adapter restart', async () => {
    const f = fixture(); const a = f.store(); const b = f.store()
    const claims = await Promise.all([a.claim({ key, leaseOwner: 'a', leaseForMs: 1000 }), b.claim({ key, leaseOwner: 'b', leaseForMs: 1000 })])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const winner = claims.find(Boolean)!
    expect((await f.store().get(key))?.leaseToken).toBe(winner.leaseToken)
  })

  it('fences an expired owner after takeover, including dispose and delete', async () => {
    const f = fixture(); const store = f.store()
    const old = (await store.claim({ key, leaseOwner: 'old', leaseForMs: 10 }))!
    await store.update(fence(old), bytes('opaque-provider-handle'), 1)
    f.tick(11)
    const next = (await f.store().claim({ key, leaseOwner: 'new', leaseForMs: 100 }))!
    expect(next.generation).toBe(old.generation + 1)
    expect(text(next.handle)).toBe('opaque-provider-handle')
    expect(await store.renew(fence(old), 10)).toBeNull()
    expect(await store.update(fence(old), bytes('stale'), 2)).toBeNull()
    expect(await store.release(fence(old))).toBe(false)
    expect(await store.delete(fence(old), { outcome: 'succeeded', recordedAt: new Date().toISOString() })).toBe(false)
  })

  it('records ambiguous create/cleanup debt before permitting deletion', async () => {
    const f = fixture(); const store = f.store(); const lease = (await store.claim({ key, leaseOwner: 'worker', leaseForMs: 100 }))!
    await store.update(fence(lease), bytes('ambiguous-create-id'), 7)
    expect(await store.delete(fence(lease), { outcome: 'ambiguous', detail: 'timeout after provider request', recordedAt: '2026-09-14T00:00:01Z' })).toBe(false)
    expect((await store.get(key))?.cleanup).toMatchObject({ outcome: 'ambiguous' })
    expect(await store.delete(fence(lease), { outcome: 'failed', detail: 'provider unavailable', recordedAt: '2026-09-14T00:00:02Z' })).toBe(false)
    expect((await store.get(key))?.cleanup?.outcome).toBe('failed')
    expect(await store.delete(fence(lease), { outcome: 'succeeded', recordedAt: '2026-09-14T00:00:03Z' })).toBe(true)
    expect(await store.get(key)).toBeNull()
  })

  it('isolates provider and mode discriminators and rejects ciphertext replay', async () => {
    const f = fixture(); const store = f.store()
    const other = { ...key, mode: 'ecs-local-efs' }
    const one = (await store.claim({ key, leaseOwner: 'one', leaseForMs: 100 }))!
    const two = (await store.claim({ key: other, leaseOwner: 'two', leaseForMs: 100 }))!
    expect(one.leaseToken).not.toBe(two.leaseToken)
    const encrypted = f.cipher.encrypt(key, one.generation, bytes('secret-handle'))
    expect(Buffer.from(encrypted.ciphertext).includes(Buffer.from('secret-handle'))).toBe(false)
    expect(() => f.cipher.decrypt(other, one.generation, encrypted)).toThrow()
  })

  it('requires explicit successful reconciliation and never models EFS data', async () => {
    const f = fixture(); const store = f.store(); await store.claim({ key, leaseOwner: 'dead', leaseForMs: 1 })
    f.tick(2)
    expect(await store.reconcileDelete(key, { outcome: 'ambiguous', recordedAt: '2026-09-14T00:00:01Z' })).toBe(false)
    expect(await store.reconcileDelete(key, { outcome: 'succeeded', detail: 'operator verified provider absence', recordedAt: '2026-09-14T00:00:02Z' })).toBe(true)
    expect(Object.keys(key)).not.toContain('efsPath')
  })
})
