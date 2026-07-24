import type { PromptNewSessionReceipt } from '../../core/piChatSessionService'

export interface NativeSessionStartRegistryOptions {
  /** Maximum number of retry receipts kept in this process. */
  maxEntries?: number
  /** How long a first-send key remains retryable in this process. */
  ttlMs?: number
  now?: () => number
}

interface NativeSessionStartRecord {
  fingerprint: string
  result: Promise<PromptNewSessionReceipt>
  expiresAt?: number
  nativeSessionId?: string
}

export type NativeSessionStartLookup =
  | { type: 'created'; result: Promise<PromptNewSessionReceipt> }
  | { type: 'existing'; result: Promise<PromptNewSessionReceipt> }
  | { type: 'conflict' }
  | { type: 'full' }

const DEFAULT_MAX_ENTRIES = 256
const DEFAULT_TTL_MS = 10 * 60 * 1_000

/**
 * Process-local native first-send retry receipts. Pending admissions are never
 * evicted or expired: a second start while Pi's outcome is unknown could create
 * a duplicate transcript. Settled receipts use a bounded TTL/LRU window; when
 * every slot is pending, new starts receive a retryable capacity result.
 */
export class NativeSessionStartRegistry {
  private readonly entries = new Map<string, NativeSessionStartRecord>()
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: NativeSessionStartRegistryOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.now ?? Date.now
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) throw new Error('native session start registry maxEntries must be positive')
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw new Error('native session start registry ttlMs must be positive')
  }

  get size(): number {
    this.pruneExpired()
    return this.entries.size
  }

  get(key: string, fingerprint: string): Exclude<NativeSessionStartLookup, { type: 'created' }> | undefined {
    this.pruneExpired()
    const existing = this.entries.get(key)
    if (!existing) return undefined
    if (existing.fingerprint !== fingerprint) return { type: 'conflict' }
    this.entries.delete(key)
    this.entries.set(key, existing)
    return { type: 'existing', result: existing.result }
  }

  getOrCreate(
    key: string,
    fingerprint: string,
    create: () => Promise<PromptNewSessionReceipt>,
  ): NativeSessionStartLookup {
    const existing = this.get(key, fingerprint)
    if (existing) return existing

    this.trimToCapacity(this.maxEntries - 1)
    if (this.entries.size >= this.maxEntries) return { type: 'full' }

    const record: NativeSessionStartRecord = {
      fingerprint,
      result: create(),
    }
    this.entries.set(key, record)
    record.result.then(
      (receipt) => {
        record.nativeSessionId = receipt.nativeSessionId
        record.expiresAt = this.now() + this.ttlMs
        this.trimToCapacity(this.maxEntries)
      },
      () => {
        if (this.entries.get(key) === record) this.entries.delete(key)
      },
    )
    return { type: 'created', result: record.result }
  }

  deleteSession(nativeSessionId: string): void {
    for (const [key, record] of this.entries) {
      if (record.nativeSessionId === nativeSessionId) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [key, record] of this.entries) {
      if (record.expiresAt !== undefined && record.expiresAt <= now) this.entries.delete(key)
    }
  }

  private trimToCapacity(limit: number): void {
    while (this.entries.size > limit) {
      const oldestSettled = [...this.entries.entries()].find(([, record]) => record.expiresAt !== undefined)
      if (!oldestSettled) return
      this.entries.delete(oldestSettled[0])
    }
  }
}
