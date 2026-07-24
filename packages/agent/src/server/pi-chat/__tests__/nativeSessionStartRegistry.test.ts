import { describe, expect, it } from 'vitest'
import type { PromptNewSessionReceipt } from '../../../core/piChatSessionService'
import { NativeSessionStartRegistry } from '../nativeSessionStartRegistry'

function receipt(sessionId: string): PromptNewSessionReceipt {
  return {
    accepted: true,
    cursor: 1,
    clientNonce: `nonce-${sessionId}`,
    nativeSessionId: sessionId,
    firstSendState: 'native_persisted',
    sessionSource: 'durable',
    session: {
      id: sessionId,
      nativeSessionId: sessionId,
      title: 'Durable title',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      turnCount: 0,
      hasAssistantReply: false,
    },
  }
}

describe('NativeSessionStartRegistry', () => {
  it('bounds settled receipts with LRU eviction', async () => {
    const registry = new NativeSessionStartRegistry({ maxEntries: 2 })
    const first = registry.getOrCreate('first', 'a', async () => receipt('native-first'))
    const second = registry.getOrCreate('second', 'b', async () => receipt('native-second'))
    if (first.type !== 'created' || second.type !== 'created') throw new Error('expected new records')
    await Promise.all([first.result, second.result])
    await Promise.resolve()
    expect(registry.get('first', 'a')?.type).toBe('existing')
    registry.getOrCreate('third', 'c', async () => receipt('native-third'))

    expect(registry.size).toBe(2)
    expect(registry.get('second', 'b')).toBeUndefined()
    expect(registry.get('first', 'a')?.type).toBe('existing')
  })

  it('expires settled retry receipts', async () => {
    let now = 0
    const registry = new NativeSessionStartRegistry({ ttlMs: 100, now: () => now })
    const created = registry.getOrCreate('key', 'fingerprint', async () => receipt('native-expired'))
    if (created.type !== 'created') throw new Error('expected a new record')
    await created.result
    await Promise.resolve()
    now = 100

    expect(registry.get('key', 'fingerprint')).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it('retains an in-flight admission through TTL and capacity pressure', async () => {
    let now = 0
    let resolve!: (value: PromptNewSessionReceipt) => void
    const pending = new Promise<PromptNewSessionReceipt>((nextResolve) => { resolve = nextResolve })
    const registry = new NativeSessionStartRegistry({ maxEntries: 1, ttlMs: 10, now: () => now })
    const first = registry.getOrCreate('first', 'a', () => pending)
    if (first.type !== 'created') throw new Error('expected a new record')
    now = 10_000

    expect(registry.get('first', 'a')?.type).toBe('existing')
    expect(registry.getOrCreate('second', 'b', async () => receipt('native-second'))).toEqual({ type: 'full' })

    resolve(receipt('native-first'))
    await first.result
    await Promise.resolve()
    expect(registry.getOrCreate('second', 'b', async () => receipt('native-second')).type).toBe('created')
  })

  it('rejects a reused key with a different fingerprint', () => {
    const registry = new NativeSessionStartRegistry()
    registry.getOrCreate('key', 'original', async () => receipt('native-original'))

    expect(registry.get('key', 'changed')).toEqual({ type: 'conflict' })
  })

  it('forgets receipts when their session is deleted or the service is disposed', async () => {
    const registry = new NativeSessionStartRegistry()
    const first = registry.getOrCreate('first', 'a', async () => receipt('native-delete'))
    const second = registry.getOrCreate('second', 'b', async () => receipt('native-dispose'))
    if (first.type !== 'created' || second.type !== 'created') throw new Error('expected new records')
    await Promise.all([first.result, second.result])

    registry.deleteSession('native-delete')
    expect(registry.get('first', 'a')).toBeUndefined()
    expect(registry.size).toBe(1)

    registry.clear()
    expect(registry.size).toBe(0)
  })
})
