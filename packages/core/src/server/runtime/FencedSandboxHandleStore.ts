import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'

export interface SandboxHandleKey {
  hostScope: string
  workspaceId: string
  provider: string
  mode: string
}

export interface SandboxCleanupOutcome {
  outcome: 'succeeded' | 'failed' | 'ambiguous'
  detail?: string
  recordedAt: string
}

export type SandboxHandlePublicationState = 'pending-validation' | 'published'

export interface SandboxHandleLease {
  status: 'claimed'
  key: SandboxHandleKey
  generation: number
  leaseOwner: string
  leaseToken: string
  leaseExpiresAt: string
  handle: Uint8Array | null
  handleVersion: number | null
  handleState: SandboxHandlePublicationState | null
  cleanup: SandboxCleanupOutcome | null
}

export interface SandboxCreateAmbiguous {
  status: 'create-ambiguous'
  key: SandboxHandleKey
  generation: number
  idempotencyKey: string
  startedAt: string
}

export type SandboxHandleClaimResult = SandboxHandleLease | SandboxCreateAmbiguous | null

export interface SandboxCreateAttemptStarted {
  status: 'started'
  idempotencyKey: string
  startedAt: string
}

export type SandboxCreateAttemptResult = SandboxCreateAttemptStarted | SandboxCreateAmbiguous | null

export interface SandboxHandleClaim {
  key: SandboxHandleKey
  leaseOwner: string
  leaseForMs: number
}

export interface SandboxHandleFence {
  key: SandboxHandleKey
  generation: number
  leaseToken: string
}

/** Provider-facing capability. A successful claim is its only source of plaintext and lease tokens. */
export interface FencedSandboxHandleStore {
  claim(input: SandboxHandleClaim): Promise<SandboxHandleClaimResult>
  beginCreate(fence: SandboxHandleFence): Promise<SandboxCreateAttemptResult>
  /** Returns the database-confirmed deadline, or null when the fence is no longer current. */
  renew(fence: SandboxHandleFence, leaseForMs: number): Promise<string | null>
  /** Persists a newly created handle as unpublished until publish() validates it. */
  update(fence: SandboxHandleFence, handle: Uint8Array, handleVersion: number): Promise<boolean>
  publish(fence: SandboxHandleFence): Promise<boolean>
  release(fence: SandboxHandleFence): Promise<boolean>
  delete(fence: SandboxHandleFence, cleanup: SandboxCleanupOutcome): Promise<boolean>
}

export interface SandboxHandleInspection {
  key: SandboxHandleKey
  generation: number
  leaseOwner: string | null
  leaseExpiresAt: string | null
  hasHandle: boolean
  handleVersion: number | null
  handleState: SandboxHandlePublicationState | null
  cleanup: SandboxCleanupOutcome | null
  tombstoned: boolean
  createAttempt: {
    state: 'started' | 'completed'
    idempotencyKey: string
    startedAt: string
    resolvedAt: string | null
  } | null
}

export interface SandboxOperatorEvidence {
  auditId: string
  operatorId: string
  detail: string
  recordedAt: string
}

export type SandboxHandleAuditAction =
  | 'reconcile-create-absent'
  | 'reconcile-create-refused-active-lease'
  | 'reconcile-delete'
  | 'reconcile-delete-refused-active-lease'

export interface SandboxHandleAuditRecord extends SandboxOperatorEvidence {
  key: SandboxHandleKey
  generation: number
  action: SandboxHandleAuditAction
}

/** Host-only capability. Do not provide this object to provider closures. */
export interface FencedSandboxHandleAdmin {
  inspect(key: SandboxHandleKey): Promise<SandboxHandleInspection | null>
  reconcileCreateAbsent(
    key: SandboxHandleKey,
    expectedGeneration: number,
    evidence: SandboxOperatorEvidence,
  ): Promise<boolean>
  reconcileDelete(
    key: SandboxHandleKey,
    expectedGeneration: number,
    cleanup: SandboxCleanupOutcome,
    evidence: SandboxOperatorEvidence,
  ): Promise<boolean>
  listAudit(key: SandboxHandleKey): Promise<SandboxHandleAuditRecord[]>
}

/** Exceptional host-only capability. Force operations require current generation evidence. */
export interface FencedSandboxHandleForceAdmin {
  forceReconcileCreateAbsent(
    key: SandboxHandleKey,
    expectedGeneration: number,
    evidence: SandboxOperatorEvidence,
  ): Promise<boolean>
  forceReconcileDelete(
    key: SandboxHandleKey,
    expectedGeneration: number,
    cleanup: SandboxCleanupOutcome,
    evidence: SandboxOperatorEvidence,
  ): Promise<boolean>
}

export interface EncryptedSandboxHandle {
  ciphertext: Uint8Array
  nonce: Uint8Array
  authTag: Uint8Array
  encryptionVersion: 1
}

export interface SandboxHandleCipher {
  encrypt(
    key: SandboxHandleKey,
    generation: number,
    handleVersion: number,
    plaintext: Uint8Array,
  ): EncryptedSandboxHandle
  decrypt(
    key: SandboxHandleKey,
    generation: number,
    handleVersion: number,
    payload: EncryptedSandboxHandle,
  ): Uint8Array
}

/** AES-GCM binds ciphertext to its ownership discriminator, generation, and format versions. */
export function createSandboxHandleCipher(keyMaterial: Uint8Array): SandboxHandleCipher {
  if (keyMaterial.byteLength !== 32) throw new Error('sandbox handle encryption key must be 32 bytes')
  const aad = (
    key: SandboxHandleKey,
    generation: number,
    handleVersion: number,
    encryptionVersion: EncryptedSandboxHandle['encryptionVersion'],
  ) => Buffer.from(JSON.stringify([
    key.hostScope,
    key.workspaceId,
    key.provider,
    key.mode,
    generation,
    handleVersion,
    encryptionVersion,
  ]))
  return {
    encrypt(key, generation, handleVersion, plaintext) {
      const nonce = randomBytes(12)
      const encryptionVersion = 1
      const cipher = createCipheriv('aes-256-gcm', keyMaterial, nonce)
      cipher.setAAD(aad(key, generation, handleVersion, encryptionVersion))
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
      return { ciphertext, nonce, authTag: cipher.getAuthTag(), encryptionVersion }
    },
    decrypt(key, generation, handleVersion, payload) {
      if (payload.encryptionVersion !== 1) throw new Error('unsupported sandbox handle encryption version')
      const decipher = createDecipheriv('aes-256-gcm', keyMaterial, payload.nonce)
      decipher.setAAD(aad(key, generation, handleVersion, payload.encryptionVersion))
      decipher.setAuthTag(Buffer.from(payload.authTag))
      return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()])
    },
  }
}

interface DurableRow extends SandboxHandleKey {
  generation: number
  leaseOwner: string | null
  leaseToken: string | null
  leaseExpiresAt: number | null
  payload: EncryptedSandboxHandle | null
  handleVersion: number | null
  handleState: SandboxHandlePublicationState | null
  createAttempt: {
    idempotencyKey: string
    state: 'started' | 'completed'
    startedAt: number
    resolvedAt: number | null
  } | null
  cleanup: SandboxCleanupOutcome | null
  tombstonedAt: number | null
}

function keyOf(key: SandboxHandleKey): string {
  return JSON.stringify([key.hostScope, key.workspaceId, key.provider, key.mode])
}

function copyKey(key: SandboxHandleKey): SandboxHandleKey {
  return {
    hostScope: key.hostScope,
    workspaceId: key.workspaceId,
    provider: key.provider,
    mode: key.mode,
  }
}

function assertTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error(`${field} must be an ISO timestamp`)
  return timestamp
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

function assertExpectedGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('expectedGeneration must be a positive safe integer')
  }
}

function assertEvidence(evidence: SandboxOperatorEvidence): void {
  if (!evidence.auditId.trim()) throw new Error('operator evidence auditId is required')
  if (!evidence.operatorId.trim()) throw new Error('operator evidence operatorId is required')
  if (!evidence.detail.trim()) throw new Error('operator evidence detail is required')
  assertTimestamp(evidence.recordedAt, 'operator evidence recordedAt')
}

function inspection(row: DurableRow): SandboxHandleInspection {
  return {
    key: copyKey(row),
    generation: row.generation,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt === null ? null : new Date(row.leaseExpiresAt).toISOString(),
    hasHandle: row.payload !== null,
    handleVersion: row.handleVersion,
    handleState: row.handleState,
    cleanup: row.cleanup,
    tombstoned: row.tombstonedAt !== null,
    createAttempt: row.createAttempt && {
      state: row.createAttempt.state,
      idempotencyKey: row.createAttempt.idempotencyKey,
      startedAt: new Date(row.createAttempt.startedAt).toISOString(),
      resolvedAt: row.createAttempt.resolvedAt === null
        ? null
        : new Date(row.createAttempt.resolvedAt).toISOString(),
    },
  }
}

/** Shared backend models one serializable database for the private deterministic fixture. */
export class InMemorySandboxHandleBackend {
  readonly rows = new Map<string, DurableRow>()
  readonly audits: SandboxHandleAuditRecord[] = []
  private tail = Promise.resolve()

  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }
}

export class CoreFencedSandboxHandleStore implements FencedSandboxHandleStore {
  constructor(
    private readonly backend: InMemorySandboxHandleBackend,
    private readonly cipher: SandboxHandleCipher,
    private readonly now = () => Date.now(),
  ) {}

  private view(row: DurableRow): SandboxHandleLease {
    return {
      status: 'claimed',
      key: copyKey(row),
      generation: row.generation,
      leaseOwner: row.leaseOwner!,
      leaseToken: row.leaseToken!,
      leaseExpiresAt: new Date(row.leaseExpiresAt!).toISOString(),
      handle: row.payload
        ? this.cipher.decrypt(row, row.generation, row.handleVersion!, row.payload)
        : null,
      handleVersion: row.handleVersion,
      handleState: row.handleState,
      cleanup: row.cleanup,
    }
  }

  private current(fence: SandboxHandleFence): DurableRow | null {
    const row = this.backend.rows.get(keyOf(fence.key))
    return row?.generation === fence.generation && row.leaseToken === fence.leaseToken ? row : null
  }

  async claim(input: SandboxHandleClaim): Promise<SandboxHandleClaimResult> {
    assertLeaseForMs(input.leaseForMs)
    if (!input.leaseOwner) throw new Error('leaseOwner is required')
    return this.backend.transaction(() => {
      const id = keyOf(input.key)
      let row = this.backend.rows.get(id)
      if (row?.leaseExpiresAt && row.leaseExpiresAt > this.now()) return null
      if (row?.createAttempt?.state === 'started') {
        return {
          status: 'create-ambiguous',
          key: copyKey(row),
          generation: row.generation,
          idempotencyKey: row.createAttempt.idempotencyKey,
          startedAt: new Date(row.createAttempt.startedAt).toISOString(),
        }
      }

      const generation = (row?.generation ?? 0) + 1
      const wasTombstoned = row?.tombstonedAt !== null && row?.tombstonedAt !== undefined
      const payload = row?.payload
        ? this.cipher.encrypt(
            input.key,
            generation,
            row.handleVersion!,
            this.cipher.decrypt(input.key, row.generation, row.handleVersion!, row.payload),
          )
        : null
      row = {
        ...(row ?? input.key),
        generation,
        leaseOwner: input.leaseOwner,
        leaseToken: randomUUID(),
        leaseExpiresAt: this.now() + input.leaseForMs,
        payload,
        handleVersion: row?.handleVersion ?? null,
        handleState: wasTombstoned ? null : row?.handleState ?? null,
        createAttempt: wasTombstoned ? null : row?.createAttempt ?? null,
        cleanup: wasTombstoned ? null : row?.cleanup ?? null,
        tombstonedAt: null,
      }
      this.backend.rows.set(id, row)
      return this.view(row)
    })
  }

  async beginCreate(fence: SandboxHandleFence): Promise<SandboxCreateAttemptResult> {
    return this.backend.transaction(() => {
      const row = this.current(fence)
      if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return null
      if (row.payload) throw new Error('sandbox handle already exists')
      if (row.createAttempt) {
        return {
          status: 'create-ambiguous',
          key: copyKey(row),
          generation: row.generation,
          idempotencyKey: row.createAttempt.idempotencyKey,
          startedAt: new Date(row.createAttempt.startedAt).toISOString(),
        }
      }
      row.createAttempt = {
        idempotencyKey: randomUUID(),
        state: 'started',
        startedAt: this.now(),
        resolvedAt: null,
      }
      return {
        status: 'started',
        idempotencyKey: row.createAttempt.idempotencyKey,
        startedAt: new Date(row.createAttempt.startedAt).toISOString(),
      }
    })
  }

  async renew(fence: SandboxHandleFence, leaseForMs: number): Promise<string | null> {
    assertLeaseForMs(leaseForMs)
    return this.backend.transaction(() => {
      const row = this.current(fence)
      if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return null
      row.leaseExpiresAt = this.now() + leaseForMs
      return new Date(row.leaseExpiresAt).toISOString()
    })
  }

  async update(
    fence: SandboxHandleFence,
    handle: Uint8Array,
    handleVersion: number,
  ): Promise<boolean> {
    assertHandleVersion(handleVersion)
    return this.backend.transaction(() => {
      const row = this.current(fence)
      if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return false
      if (!row.payload && row.createAttempt?.state !== 'started') {
        throw new Error('beginCreate must persist an attempt before the initial provider create')
      }
      row.payload = this.cipher.encrypt(row, row.generation, handleVersion, handle)
      row.handleVersion = handleVersion
      row.handleState = 'pending-validation'
      if (row.createAttempt?.state === 'started') {
        row.createAttempt.state = 'completed'
        row.createAttempt.resolvedAt = this.now()
      }
      return true
    })
  }

  async publish(fence: SandboxHandleFence): Promise<boolean> {
    return this.backend.transaction(() => {
      const row = this.current(fence)
      if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return false
      if (!row.payload || row.handleState !== 'pending-validation') return false
      row.handleState = 'published'
      return true
    })
  }

  async release(fence: SandboxHandleFence): Promise<boolean> {
    return this.backend.transaction(() => {
      const row = this.current(fence)
      if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return false
      row.leaseOwner = null
      row.leaseToken = null
      row.leaseExpiresAt = null
      return true
    })
  }

  async delete(fence: SandboxHandleFence, cleanup: SandboxCleanupOutcome): Promise<boolean> {
    assertTimestamp(cleanup.recordedAt, 'cleanup.recordedAt')
    return this.backend.transaction(() => {
      const row = this.current(fence)
      if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return false
      row.cleanup = cleanup
      if (cleanup.outcome !== 'succeeded') return false
      row.leaseOwner = null
      row.leaseToken = null
      row.leaseExpiresAt = null
      row.payload = null
      row.handleVersion = null
      row.handleState = null
      row.createAttempt = null
      row.tombstonedAt = this.now()
      return true
    })
  }
}

export class CoreFencedSandboxHandleAdmin implements FencedSandboxHandleAdmin {
  constructor(
    private readonly backend: InMemorySandboxHandleBackend,
    private readonly now = () => Date.now(),
  ) {}

  async inspect(key: SandboxHandleKey): Promise<SandboxHandleInspection | null> {
    return this.backend.transaction(() => {
      const row = this.backend.rows.get(keyOf(key))
      return row ? inspection(row) : null
    })
  }

  private audit(
    row: DurableRow,
    action: SandboxHandleAuditAction,
    evidence: SandboxOperatorEvidence,
  ): void {
    if (this.backend.audits.some((record) => record.auditId === evidence.auditId)) {
      throw new Error('operator evidence auditId already exists')
    }
    this.backend.audits.push({ ...evidence, key: copyKey(row), generation: row.generation, action })
  }

  async reconcileCreateAbsent(
    key: SandboxHandleKey,
    expectedGeneration: number,
    evidence: SandboxOperatorEvidence,
  ): Promise<boolean> {
    assertExpectedGeneration(expectedGeneration)
    assertEvidence(evidence)
    return this.backend.transaction(() => {
      const row = this.backend.rows.get(keyOf(key))
      if (!row || row.generation !== expectedGeneration || row.createAttempt?.state !== 'started') return false
      if (row.leaseExpiresAt !== null && row.leaseExpiresAt > this.now()) {
        this.audit(row, 'reconcile-create-refused-active-lease', evidence)
        return false
      }
      this.audit(row, 'reconcile-create-absent', evidence)
      row.createAttempt = null
      row.leaseOwner = null
      row.leaseToken = null
      row.leaseExpiresAt = null
      return true
    })
  }

  async reconcileDelete(
    key: SandboxHandleKey,
    expectedGeneration: number,
    cleanup: SandboxCleanupOutcome,
    evidence: SandboxOperatorEvidence,
  ): Promise<boolean> {
    assertExpectedGeneration(expectedGeneration)
    assertEvidence(evidence)
    assertTimestamp(cleanup.recordedAt, 'cleanup.recordedAt')
    return this.backend.transaction(() => {
      const row = this.backend.rows.get(keyOf(key))
      if (!row || row.generation !== expectedGeneration) return false
      if (row.leaseExpiresAt !== null && row.leaseExpiresAt > this.now()) {
        this.audit(row, 'reconcile-delete-refused-active-lease', evidence)
        return false
      }
      this.audit(row, 'reconcile-delete', evidence)
      row.cleanup = cleanup
      if (cleanup.outcome !== 'succeeded') return false
      row.leaseOwner = null
      row.leaseToken = null
      row.leaseExpiresAt = null
      row.payload = null
      row.handleVersion = null
      row.handleState = null
      row.createAttempt = null
      row.tombstonedAt = this.now()
      return true
    })
  }

  async listAudit(key: SandboxHandleKey): Promise<SandboxHandleAuditRecord[]> {
    return this.backend.transaction(() => this.backend.audits.filter((record) => keyOf(record.key) === keyOf(key)))
  }
}

export class CoreFencedSandboxHandleForceAdmin implements FencedSandboxHandleForceAdmin {
  constructor(
    private readonly backend: InMemorySandboxHandleBackend,
    private readonly now = () => Date.now(),
  ) {}

  private audit(
    row: DurableRow,
    action: SandboxHandleAuditAction,
    evidence: SandboxOperatorEvidence,
  ): void {
    if (this.backend.audits.some((record) => record.auditId === evidence.auditId)) {
      throw new Error('operator evidence auditId already exists')
    }
    this.backend.audits.push({ ...evidence, key: copyKey(row), generation: row.generation, action })
  }

  async forceReconcileCreateAbsent(
    key: SandboxHandleKey,
    expectedGeneration: number,
    evidence: SandboxOperatorEvidence,
  ): Promise<boolean> {
    assertExpectedGeneration(expectedGeneration)
    assertEvidence(evidence)
    return this.backend.transaction(() => {
      const row = this.backend.rows.get(keyOf(key))
      if (!row || row.generation !== expectedGeneration || row.createAttempt?.state !== 'started') return false
      this.audit(row, 'reconcile-create-absent', evidence)
      row.createAttempt = null
      row.leaseOwner = null
      row.leaseToken = null
      row.leaseExpiresAt = null
      return true
    })
  }

  async forceReconcileDelete(
    key: SandboxHandleKey,
    expectedGeneration: number,
    cleanup: SandboxCleanupOutcome,
    evidence: SandboxOperatorEvidence,
  ): Promise<boolean> {
    assertExpectedGeneration(expectedGeneration)
    assertEvidence(evidence)
    assertTimestamp(cleanup.recordedAt, 'cleanup.recordedAt')
    return this.backend.transaction(() => {
      const row = this.backend.rows.get(keyOf(key))
      if (!row || row.generation !== expectedGeneration) return false
      this.audit(row, 'reconcile-delete', evidence)
      row.cleanup = cleanup
      if (cleanup.outcome !== 'succeeded') return false
      row.leaseOwner = null
      row.leaseToken = null
      row.leaseExpiresAt = null
      row.payload = null
      row.handleVersion = null
      row.handleState = null
      row.createAttempt = null
      row.tombstonedAt = this.now()
      return true
    })
  }
}
