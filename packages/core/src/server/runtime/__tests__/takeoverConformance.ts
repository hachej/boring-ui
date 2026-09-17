import { describe, expect, it } from 'vitest'

import type {
  FencedSandboxHandleStore,
  SandboxCleanupOutcome,
  SandboxHandleFence,
  SandboxHandleKey,
  SandboxHandleLease,
} from '../FencedSandboxHandleStore.js'

const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array | null) => value && new TextDecoder().decode(value)
const fence = (lease: SandboxHandleLease): SandboxHandleFence => ({
  key: lease.key,
  generation: lease.generation,
  leaseToken: lease.leaseToken,
})
const cleanup = (outcome: SandboxCleanupOutcome['outcome']): SandboxCleanupOutcome => ({
  outcome,
  recordedAt: '2026-09-14T00:00:01.000Z',
})

export interface PendingTakeoverHarness {
  key: SandboxHandleKey
  first: FencedSandboxHandleStore
  successor: FencedSandboxHandleStore
  expire(key: SandboxHandleKey): Promise<void>
}

export function pendingTakeoverConformance(
  name: string,
  make: () => PendingTakeoverHarness,
): void {
  describe(`${name} pending-validation takeover conformance`, () => {
    async function claim(store: FencedSandboxHandleStore, key: SandboxHandleKey, owner: string): Promise<SandboxHandleLease> {
      const result = await store.claim({ key, leaseOwner: owner, leaseForMs: 10_000 })
      if (!result || result.status !== 'claimed') throw new Error('expected successful claim')
      return result
    }

    it('preserves a pending-validation handle through takeover without cleanup debt', async () => {
      const h = make()
      const first = await claim(h.first, h.key, 'first')
      expect(await h.first.beginCreate(fence(first))).toMatchObject({ status: 'started' })
      expect(await h.first.update(fence(first), bytes('pending-handle'), 1)).toBe(true)

      await h.expire(h.key)
      const takeover = await claim(h.successor, h.key, 'successor')
      expect(text(takeover.handle)).toBe('pending-handle')
      expect(takeover.handleState).toBe('pending-validation')
      expect(takeover.cleanup).toBeNull()
      await expect(h.successor.beginCreate(fence(takeover))).rejects.toThrow('sandbox handle already exists')
      expect(await h.successor.publish(fence(takeover))).toBe(true)
    })

    it.each(['failed', 'ambiguous'] as const)('preserves a pending-validation handle and %s cleanup debt through takeover', async (outcome) => {
      const h = make()
      const first = await claim(h.first, h.key, 'first')
      expect(await h.first.beginCreate(fence(first))).toMatchObject({ status: 'started' })
      expect(await h.first.update(fence(first), bytes(`${outcome}-pending-handle`), 1)).toBe(true)
      expect(await h.first.delete(fence(first), cleanup(outcome))).toBe(false)

      await h.expire(h.key)
      const takeover = await claim(h.successor, h.key, 'successor')
      expect(text(takeover.handle)).toBe(`${outcome}-pending-handle`)
      expect(takeover.handleState).toBe('pending-validation')
      expect(takeover.cleanup?.outcome).toBe(outcome)
      await expect(h.successor.beginCreate(fence(takeover))).rejects.toThrow('sandbox handle already exists')
      expect(await h.successor.publish(fence(takeover))).toBe(false)
    })
  })
}
