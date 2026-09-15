import { randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { fencedSandboxHandles } from '../db/schema.js'
import type {
  EncryptedSandboxHandle,
  FencedSandboxHandleStore,
  SandboxCleanupOutcome,
  SandboxHandleCipher,
  SandboxHandleClaim,
  SandboxHandleFence,
  SandboxHandleKey,
  SandboxHandleLease,
} from './FencedSandboxHandleStore.js'

type HandleRow = typeof fencedSandboxHandles.$inferSelect

function keyPredicate(key: SandboxHandleKey) {
  return and(
    eq(fencedSandboxHandles.hostScope, key.hostScope),
    eq(fencedSandboxHandles.workspaceId, key.workspaceId),
    eq(fencedSandboxHandles.provider, key.provider),
    eq(fencedSandboxHandles.mode, key.mode),
  )
}

function fencePredicate(fence: SandboxHandleFence) {
  return and(
    keyPredicate(fence.key),
    eq(fencedSandboxHandles.generation, fence.generation),
    eq(fencedSandboxHandles.leaseToken, fence.leaseToken),
    gt(fencedSandboxHandles.leaseExpiresAt, sql`clock_timestamp()`),
  )
}

function assertLeaseForMs(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('leaseForMs must be a positive safe integer')
  }
}

function assertHandleVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('handleVersion must be a non-negative safe integer')
  }
}

function cleanupValues(cleanup: SandboxCleanupOutcome) {
  const recordedAt = new Date(cleanup.recordedAt)
  if (Number.isNaN(recordedAt.getTime())) throw new Error('cleanup.recordedAt must be an ISO timestamp')
  return {
    cleanupOutcome: cleanup.outcome,
    cleanupDetail: cleanup.detail ?? null,
    cleanupRecordedAt: recordedAt,
    updatedAt: sql`clock_timestamp()`,
  }
}

function encryptedPayload(row: HandleRow): EncryptedSandboxHandle | null {
  if (row.encryptedHandle === null) return null
  if (
    row.encryptionNonce === null
    || row.encryptionAuthTag === null
    || row.encryptionVersion === null
    || row.handleVersion === null
  ) {
    throw new Error('fenced sandbox handle has incomplete encrypted payload')
  }
  if (row.encryptionVersion !== 1) throw new Error('unsupported sandbox handle encryption version')
  return {
    ciphertext: row.encryptedHandle,
    nonce: row.encryptionNonce,
    authTag: row.encryptionAuthTag,
    encryptionVersion: 1,
  }
}

/** Production Postgres adapter for application-owned disposable sandbox handles. */
export class PostgresFencedSandboxHandleStore implements FencedSandboxHandleStore {
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly cipher: SandboxHandleCipher,
  ) {}

  private view(row: HandleRow): SandboxHandleLease {
    const payload = encryptedPayload(row)
    return {
      key: {
        hostScope: row.hostScope,
        workspaceId: row.workspaceId,
        provider: row.provider,
        mode: row.mode,
      },
      generation: row.generation,
      leaseOwner: row.leaseOwner ?? '',
      leaseToken: row.leaseToken ?? '',
      leaseExpiresAt: (row.leaseExpiresAt ?? new Date(0)).toISOString(),
      handle: payload
        ? this.cipher.decrypt(row, row.generation, row.handleVersion!, payload)
        : null,
      handleVersion: row.handleVersion,
      cleanup: row.cleanupOutcome && row.cleanupRecordedAt
        ? {
            outcome: row.cleanupOutcome as SandboxCleanupOutcome['outcome'],
            ...(row.cleanupDetail ? { detail: row.cleanupDetail } : {}),
            recordedAt: row.cleanupRecordedAt.toISOString(),
          }
        : null,
    }
  }

  async claim(input: SandboxHandleClaim): Promise<SandboxHandleLease | null> {
    assertLeaseForMs(input.leaseForMs)
    if (!input.leaseOwner) throw new Error('leaseOwner is required')

    return this.db.transaction(async (tx) => {
      await tx.insert(fencedSandboxHandles).values(input.key).onConflictDoNothing()
      const rows = await tx
        .select()
        .from(fencedSandboxHandles)
        .where(keyPredicate(input.key))
        .for('update')
        .limit(1)
      const row = rows[0]
      if (!row) throw new Error('fenced sandbox handle claim row disappeared')

      const generation = row.generation + 1
      if (!Number.isSafeInteger(generation)) throw new Error('sandbox handle generation exhausted')
      const priorPayload = encryptedPayload(row)
      const nextPayload = priorPayload
        ? this.cipher.encrypt(
            input.key,
            generation,
            row.handleVersion!,
            this.cipher.decrypt(input.key, row.generation, row.handleVersion!, priorPayload),
          )
        : null
      const leaseToken = randomUUID()
      const updated = await tx
        .update(fencedSandboxHandles)
        .set({
          generation,
          leaseOwner: input.leaseOwner,
          leaseToken,
          leaseExpiresAt: sql`clock_timestamp() + (${input.leaseForMs} * interval '1 millisecond')`,
          encryptedHandle: nextPayload?.ciphertext ?? null,
          encryptionNonce: nextPayload?.nonce ?? null,
          encryptionAuthTag: nextPayload?.authTag ?? null,
          encryptionVersion: nextPayload?.encryptionVersion ?? null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          keyPredicate(input.key),
          eq(fencedSandboxHandles.generation, row.generation),
          or(
            isNull(fencedSandboxHandles.leaseExpiresAt),
            sql`${fencedSandboxHandles.leaseExpiresAt} <= clock_timestamp()`,
          ),
        ))
        .returning()
      return updated[0] ? this.view(updated[0]) : null
    })
  }

  async renew(fence: SandboxHandleFence, leaseForMs: number): Promise<SandboxHandleLease | null> {
    assertLeaseForMs(leaseForMs)
    const rows = await this.db
      .update(fencedSandboxHandles)
      .set({
        leaseExpiresAt: sql`clock_timestamp() + (${leaseForMs} * interval '1 millisecond')`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(fencePredicate(fence))
      .returning()
    return rows[0] ? this.view(rows[0]) : null
  }

  async update(
    fence: SandboxHandleFence,
    handle: Uint8Array,
    handleVersion: number,
  ): Promise<SandboxHandleLease | null> {
    assertHandleVersion(handleVersion)
    const payload = this.cipher.encrypt(fence.key, fence.generation, handleVersion, handle)
    const rows = await this.db
      .update(fencedSandboxHandles)
      .set({
        encryptedHandle: payload.ciphertext,
        encryptionNonce: payload.nonce,
        encryptionAuthTag: payload.authTag,
        encryptionVersion: payload.encryptionVersion,
        handleVersion,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(fencePredicate(fence))
      .returning()
    return rows[0] ? this.view(rows[0]) : null
  }

  async release(fence: SandboxHandleFence): Promise<boolean> {
    const rows = await this.db
      .update(fencedSandboxHandles)
      .set({
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(fencePredicate(fence))
      .returning({ generation: fencedSandboxHandles.generation })
    return rows.length === 1
  }

  async delete(fence: SandboxHandleFence, cleanup: SandboxCleanupOutcome): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const recorded = await tx
        .update(fencedSandboxHandles)
        .set(cleanupValues(cleanup))
        .where(fencePredicate(fence))
        .returning({ generation: fencedSandboxHandles.generation })
      if (recorded.length !== 1 || cleanup.outcome !== 'succeeded') return false

      // The fenced update above admits deletion and holds the row lock. Do not
      // re-evaluate wall-clock expiry between recording success and deleting.
      const deleted = await tx
        .delete(fencedSandboxHandles)
        .where(and(
          keyPredicate(fence.key),
          eq(fencedSandboxHandles.generation, fence.generation),
          eq(fencedSandboxHandles.leaseToken, fence.leaseToken),
        ))
        .returning({ generation: fencedSandboxHandles.generation })
      return deleted.length === 1
    })
  }

  async get(key: SandboxHandleKey): Promise<SandboxHandleLease | null> {
    const rows = await this.db
      .select()
      .from(fencedSandboxHandles)
      .where(keyPredicate(key))
      .limit(1)
    return rows[0] ? this.view(rows[0]) : null
  }

  async reconcileDelete(key: SandboxHandleKey, cleanup: SandboxCleanupOutcome): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const recorded = await tx
        .update(fencedSandboxHandles)
        .set(cleanupValues(cleanup))
        .where(keyPredicate(key))
        .returning({ generation: fencedSandboxHandles.generation })
      if (recorded.length !== 1 || cleanup.outcome !== 'succeeded') return false

      const deleted = await tx
        .delete(fencedSandboxHandles)
        .where(keyPredicate(key))
        .returning({ generation: fencedSandboxHandles.generation })
      return deleted.length === 1
    })
  }
}
