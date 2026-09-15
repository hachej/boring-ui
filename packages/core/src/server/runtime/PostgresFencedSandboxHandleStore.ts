import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { fencedSandboxHandleAudit, fencedSandboxHandles } from '../db/schema.js'
import type {
  EncryptedSandboxHandle,
  FencedSandboxHandleAdmin,
  FencedSandboxHandleStore,
  SandboxAdminReconciliationPolicy,
  SandboxCleanupOutcome,
  SandboxCreateAttemptResult,
  SandboxHandleAuditAction,
  SandboxHandleAuditRecord,
  SandboxHandleCipher,
  SandboxHandleClaim,
  SandboxHandleClaimResult,
  SandboxHandleFence,
  SandboxHandleInspection,
  SandboxHandleKey,
  SandboxHandleLease,
  SandboxOperatorEvidence,
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

function auditKeyPredicate(key: SandboxHandleKey) {
  return and(
    eq(fencedSandboxHandleAudit.hostScope, key.hostScope),
    eq(fencedSandboxHandleAudit.workspaceId, key.workspaceId),
    eq(fencedSandboxHandleAudit.provider, key.provider),
    eq(fencedSandboxHandleAudit.mode, key.mode),
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

function timestamp(value: string, field: string): Date {
  const result = new Date(value)
  if (Number.isNaN(result.getTime())) throw new Error(`${field} must be an ISO timestamp`)
  return result
}

function assertEvidence(evidence: SandboxOperatorEvidence): Date {
  if (!evidence.auditId.trim()) throw new Error('operator evidence auditId is required')
  if (!evidence.operatorId.trim()) throw new Error('operator evidence operatorId is required')
  if (!evidence.detail.trim()) throw new Error('operator evidence detail is required')
  return timestamp(evidence.recordedAt, 'operator evidence recordedAt')
}

function cleanupValues(cleanup: SandboxCleanupOutcome) {
  return {
    cleanupOutcome: cleanup.outcome,
    cleanupDetail: cleanup.detail ?? null,
    cleanupRecordedAt: timestamp(cleanup.recordedAt, 'cleanup.recordedAt'),
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

function copyKey(row: HandleRow): SandboxHandleKey {
  return {
    hostScope: row.hostScope,
    workspaceId: row.workspaceId,
    provider: row.provider,
    mode: row.mode,
  }
}

function cleanupFromRow(row: HandleRow): SandboxCleanupOutcome | null {
  return row.cleanupOutcome && row.cleanupRecordedAt
    ? {
        outcome: row.cleanupOutcome as SandboxCleanupOutcome['outcome'],
        ...(row.cleanupDetail ? { detail: row.cleanupDetail } : {}),
        recordedAt: row.cleanupRecordedAt.toISOString(),
      }
    : null
}

function inspectRow(row: HandleRow): SandboxHandleInspection {
  return {
    key: copyKey(row),
    generation: row.generation,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    hasHandle: row.encryptedHandle !== null,
    handleVersion: row.handleVersion,
    cleanup: cleanupFromRow(row),
    tombstoned: row.tombstonedAt !== null,
    createAttempt: row.createAttemptState && row.createAttemptIdempotencyKey && row.createAttemptStartedAt
      ? {
          state: row.createAttemptState as 'started' | 'completed',
          idempotencyKey: row.createAttemptIdempotencyKey,
          startedAt: row.createAttemptStartedAt.toISOString(),
          resolvedAt: row.createAttemptResolvedAt?.toISOString() ?? null,
        }
      : null,
  }
}

function ambiguousFromRow(row: HandleRow): SandboxHandleClaimResult {
  if (
    row.createAttemptState !== 'started'
    || !row.createAttemptIdempotencyKey
    || !row.createAttemptStartedAt
  ) {
    throw new Error('fenced sandbox handle has incomplete create attempt')
  }
  return {
    status: 'create-ambiguous',
    key: copyKey(row),
    generation: row.generation,
    idempotencyKey: row.createAttemptIdempotencyKey,
    startedAt: row.createAttemptStartedAt.toISOString(),
  }
}

/** Production provider-facing adapter for application-owned disposable sandbox handles. */
export class PostgresFencedSandboxHandleStore implements FencedSandboxHandleStore {
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly cipher: SandboxHandleCipher,
  ) {}

  private view(row: HandleRow): SandboxHandleLease {
    const payload = encryptedPayload(row)
    if (!row.leaseOwner || !row.leaseToken || !row.leaseExpiresAt) {
      throw new Error('cannot create provider lease view without an active lease')
    }
    return {
      status: 'claimed',
      key: copyKey(row),
      generation: row.generation,
      leaseOwner: row.leaseOwner,
      leaseToken: row.leaseToken,
      leaseExpiresAt: row.leaseExpiresAt.toISOString(),
      handle: payload
        ? this.cipher.decrypt(row, row.generation, row.handleVersion!, payload)
        : null,
      handleVersion: row.handleVersion,
      cleanup: cleanupFromRow(row),
    }
  }

  async claim(input: SandboxHandleClaim): Promise<SandboxHandleClaimResult> {
    assertLeaseForMs(input.leaseForMs)
    if (!input.leaseOwner) throw new Error('leaseOwner is required')

    return this.db.transaction(async (tx) => {
      await tx.insert(fencedSandboxHandles).values(input.key).onConflictDoNothing()
      const rows = await tx
        .select({
          row: fencedSandboxHandles,
          activeLease: sql<boolean>`${fencedSandboxHandles.leaseExpiresAt} > clock_timestamp()`,
        })
        .from(fencedSandboxHandles)
        .where(keyPredicate(input.key))
        .for('update')
        .limit(1)
      const selected = rows[0]
      if (!selected) throw new Error('fenced sandbox handle claim row disappeared')
      const row = selected.row
      if (selected.activeLease) return null
      if (row.createAttemptState === 'started') return ambiguousFromRow(row)

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
      const recreated = row.tombstonedAt !== null
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
          handleVersion: nextPayload ? row.handleVersion : null,
          ...(recreated
            ? {
                createAttemptIdempotencyKey: null,
                createAttemptState: null,
                createAttemptStartedAt: null,
                createAttemptResolvedAt: null,
                cleanupOutcome: null,
                cleanupDetail: null,
                cleanupRecordedAt: null,
              }
            : {}),
          tombstonedAt: null,
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

  async beginCreate(fence: SandboxHandleFence): Promise<SandboxCreateAttemptResult> {
    return this.db.transaction(async (tx) => {
      const idempotencyKey = randomUUID()
      const started = await tx
        .update(fencedSandboxHandles)
        .set({
          createAttemptIdempotencyKey: idempotencyKey,
          createAttemptState: 'started',
          createAttemptStartedAt: sql`clock_timestamp()`,
          createAttemptResolvedAt: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          fencePredicate(fence),
          isNull(fencedSandboxHandles.encryptedHandle),
          isNull(fencedSandboxHandles.createAttemptState),
          isNull(fencedSandboxHandles.tombstonedAt),
        ))
        .returning()
      if (started[0]) {
        return {
          status: 'started',
          idempotencyKey,
          startedAt: started[0].createAttemptStartedAt!.toISOString(),
        }
      }

      const rows = await tx.select().from(fencedSandboxHandles).where(and(
        keyPredicate(fence.key),
        eq(fencedSandboxHandles.generation, fence.generation),
        eq(fencedSandboxHandles.leaseToken, fence.leaseToken),
      )).limit(1)
      const row = rows[0]
      if (row?.encryptedHandle) throw new Error('sandbox handle already exists')
      return row?.createAttemptState === 'started'
        ? ambiguousFromRow(row) as SandboxCreateAttemptResult
        : null
    })
  }

  async renew(fence: SandboxHandleFence, leaseForMs: number): Promise<boolean> {
    assertLeaseForMs(leaseForMs)
    const rows = await this.db
      .update(fencedSandboxHandles)
      .set({
        leaseExpiresAt: sql`clock_timestamp() + (${leaseForMs} * interval '1 millisecond')`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(fencePredicate(fence))
      .returning({ generation: fencedSandboxHandles.generation })
    return rows.length === 1
  }

  async update(
    fence: SandboxHandleFence,
    handle: Uint8Array,
    handleVersion: number,
  ): Promise<boolean> {
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
        createAttemptState: sql`CASE WHEN ${fencedSandboxHandles.createAttemptState} = 'started' THEN 'completed' ELSE ${fencedSandboxHandles.createAttemptState} END`,
        createAttemptResolvedAt: sql`CASE WHEN ${fencedSandboxHandles.createAttemptState} = 'started' THEN clock_timestamp() ELSE ${fencedSandboxHandles.createAttemptResolvedAt} END`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(and(
        fencePredicate(fence),
        or(
          sql`${fencedSandboxHandles.encryptedHandle} IS NOT NULL`,
          eq(fencedSandboxHandles.createAttemptState, 'started'),
        ),
      ))
      .returning({ generation: fencedSandboxHandles.generation })
    return rows.length === 1
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
    const values = cleanupValues(cleanup)
    if (cleanup.outcome !== 'succeeded') {
      const recorded = await this.db
        .update(fencedSandboxHandles)
        .set(values)
        .where(fencePredicate(fence))
        .returning({ generation: fencedSandboxHandles.generation })
      return recorded.length === 1 && false
    }

    const tombstoned = await this.db
      .update(fencedSandboxHandles)
      .set({
        ...values,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        encryptedHandle: null,
        encryptionNonce: null,
        encryptionAuthTag: null,
        encryptionVersion: null,
        handleVersion: null,
        createAttemptIdempotencyKey: null,
        createAttemptState: null,
        createAttemptStartedAt: null,
        createAttemptResolvedAt: null,
        tombstonedAt: sql`clock_timestamp()`,
      })
      .where(fencePredicate(fence))
      .returning({ generation: fencedSandboxHandles.generation })
    return tombstoned.length === 1
  }
}

/** Explicit host-only administrator. Construct separately from the provider-facing store. */
export class PostgresFencedSandboxHandleAdmin implements FencedSandboxHandleAdmin {
  constructor(private readonly db: PostgresJsDatabase) {}

  async inspect(key: SandboxHandleKey): Promise<SandboxHandleInspection | null> {
    const rows = await this.db.select().from(fencedSandboxHandles).where(keyPredicate(key)).limit(1)
    return rows[0] ? inspectRow(rows[0]) : null
  }

  private async recordAudit(
    tx: Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0],
    row: HandleRow,
    action: SandboxHandleAuditAction,
    evidence: SandboxOperatorEvidence,
    recordedAt: Date,
  ): Promise<void> {
    await tx.insert(fencedSandboxHandleAudit).values({
      auditId: evidence.auditId,
      ...copyKey(row),
      generation: row.generation,
      action,
      operatorId: evidence.operatorId,
      evidenceDetail: evidence.detail,
      recordedAt,
    })
  }

  async reconcileCreateAbsent(
    key: SandboxHandleKey,
    evidence: SandboxOperatorEvidence,
    policy: SandboxAdminReconciliationPolicy = {},
  ): Promise<boolean> {
    const evidenceAt = assertEvidence(evidence)
    return this.db.transaction(async (tx) => {
      const rows = await tx.select({
        row: fencedSandboxHandles,
        activeLease: sql<boolean>`${fencedSandboxHandles.leaseExpiresAt} > clock_timestamp()`,
      }).from(fencedSandboxHandles).where(keyPredicate(key)).for('update').limit(1)
      const selected = rows[0]
      if (!selected || selected.row.createAttemptState !== 'started') return false
      if (selected.activeLease && !policy.allowActiveLease) {
        await this.recordAudit(tx, selected.row, 'reconcile-create-refused-active-lease', evidence, evidenceAt)
        return false
      }
      await this.recordAudit(tx, selected.row, 'reconcile-create-absent', evidence, evidenceAt)
      const updated = await tx.update(fencedSandboxHandles).set({
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        createAttemptIdempotencyKey: null,
        createAttemptState: null,
        createAttemptStartedAt: null,
        createAttemptResolvedAt: null,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(keyPredicate(key), eq(fencedSandboxHandles.generation, selected.row.generation)))
        .returning({ generation: fencedSandboxHandles.generation })
      return updated.length === 1
    })
  }

  async reconcileDelete(
    key: SandboxHandleKey,
    cleanup: SandboxCleanupOutcome,
    evidence: SandboxOperatorEvidence,
    policy: SandboxAdminReconciliationPolicy = {},
  ): Promise<boolean> {
    const evidenceAt = assertEvidence(evidence)
    const cleanupUpdate = cleanupValues(cleanup)
    return this.db.transaction(async (tx) => {
      const rows = await tx.select({
        row: fencedSandboxHandles,
        activeLease: sql<boolean>`${fencedSandboxHandles.leaseExpiresAt} > clock_timestamp()`,
      }).from(fencedSandboxHandles).where(keyPredicate(key)).for('update').limit(1)
      const selected = rows[0]
      if (!selected) return false
      if (selected.activeLease && !policy.allowActiveLease) {
        await this.recordAudit(tx, selected.row, 'reconcile-delete-refused-active-lease', evidence, evidenceAt)
        return false
      }
      await this.recordAudit(tx, selected.row, 'reconcile-delete', evidence, evidenceAt)
      const updated = await tx.update(fencedSandboxHandles).set(cleanup.outcome === 'succeeded'
        ? {
            ...cleanupUpdate,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            encryptedHandle: null,
            encryptionNonce: null,
            encryptionAuthTag: null,
            encryptionVersion: null,
            handleVersion: null,
            createAttemptIdempotencyKey: null,
            createAttemptState: null,
            createAttemptStartedAt: null,
            createAttemptResolvedAt: null,
            tombstonedAt: sql`clock_timestamp()`,
          }
        : cleanupUpdate)
        .where(and(keyPredicate(key), eq(fencedSandboxHandles.generation, selected.row.generation)))
        .returning({ generation: fencedSandboxHandles.generation })
      return updated.length === 1 && cleanup.outcome === 'succeeded'
    })
  }

  async listAudit(key: SandboxHandleKey): Promise<SandboxHandleAuditRecord[]> {
    const rows = await this.db.select().from(fencedSandboxHandleAudit)
      .where(auditKeyPredicate(key))
      .orderBy(asc(fencedSandboxHandleAudit.createdAt), asc(fencedSandboxHandleAudit.auditId))
    return rows.map((row) => ({
      auditId: row.auditId,
      operatorId: row.operatorId,
      detail: row.evidenceDetail,
      recordedAt: row.recordedAt.toISOString(),
      key: {
        hostScope: row.hostScope,
        workspaceId: row.workspaceId,
        provider: row.provider,
        mode: row.mode,
      },
      generation: row.generation,
      action: row.action as SandboxHandleAuditAction,
    }))
  }
}
