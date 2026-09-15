import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'

export interface SandboxHandleKey {
  hostScope: string
  workspaceId: string
  provider: string
  mode: string
}

export interface SandboxHandleLease {
  key: SandboxHandleKey
  generation: number
  leaseOwner: string
  leaseToken: string
  leaseExpiresAt: string
  handle: Uint8Array | null
  handleVersion: number | null
  cleanup: SandboxCleanupOutcome | null
}

export interface SandboxCleanupOutcome {
  outcome: 'succeeded' | 'failed' | 'ambiguous'
  detail?: string
  recordedAt: string
}

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

export interface FencedSandboxHandleStore {
  claim(input: SandboxHandleClaim): Promise<SandboxHandleLease | null>
  renew(fence: SandboxHandleFence, leaseForMs: number): Promise<SandboxHandleLease | null>
  update(fence: SandboxHandleFence, handle: Uint8Array, handleVersion: number): Promise<SandboxHandleLease | null>
  release(fence: SandboxHandleFence): Promise<boolean>
  delete(fence: SandboxHandleFence, cleanup: SandboxCleanupOutcome): Promise<boolean>
  get(key: SandboxHandleKey): Promise<SandboxHandleLease | null>
  /** Operator-only recovery. Callers must first perform and describe provider reconciliation. */
  reconcileDelete(key: SandboxHandleKey, cleanup: SandboxCleanupOutcome): Promise<boolean>
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
  cleanup: SandboxCleanupOutcome | null
}

/** Shared backend models one serializable database; multiple adapters may safely use it. */
export class InMemorySandboxHandleBackend {
  readonly rows = new Map<string, DurableRow>()
  private tail = Promise.resolve()
  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }
}

export class CoreFencedSandboxHandleStore implements FencedSandboxHandleStore {
  constructor(private readonly backend: InMemorySandboxHandleBackend, private readonly cipher: SandboxHandleCipher, private readonly now = () => Date.now()) {}
  private id(key: SandboxHandleKey) { return JSON.stringify([key.hostScope, key.workspaceId, key.provider, key.mode]) }
  private view(row: DurableRow): SandboxHandleLease {
    return { key: { hostScope: row.hostScope, workspaceId: row.workspaceId, provider: row.provider, mode: row.mode }, generation: row.generation,
      leaseOwner: row.leaseOwner ?? '', leaseToken: row.leaseToken ?? '', leaseExpiresAt: new Date(row.leaseExpiresAt ?? 0).toISOString(),
      handle: row.payload ? this.cipher.decrypt(row, row.generation, row.handleVersion!, row.payload) : null, handleVersion: row.handleVersion, cleanup: row.cleanup }
  }
  async claim(input: SandboxHandleClaim) { return this.backend.transaction(() => {
    const id = this.id(input.key); let row = this.backend.rows.get(id)
    if (row?.leaseExpiresAt && row.leaseExpiresAt > this.now()) return null
    const generation = (row?.generation ?? 0) + 1
    row = { ...(row ?? input.key), generation, leaseOwner: input.leaseOwner, leaseToken: randomUUID(), leaseExpiresAt: this.now() + input.leaseForMs,
      payload: row?.payload ? this.cipher.encrypt(input.key, generation, row.handleVersion!, this.cipher.decrypt(input.key, row.generation, row.handleVersion!, row.payload)) : null,
      handleVersion: row?.handleVersion ?? null, cleanup: row?.cleanup ?? null }
    this.backend.rows.set(id, row); return this.view(row)
  }) }
  private current(fence: SandboxHandleFence) { const row = this.backend.rows.get(this.id(fence.key)); return row?.generation === fence.generation && row.leaseToken === fence.leaseToken ? row : null }
  async renew(fence: SandboxHandleFence, leaseForMs: number) { return this.backend.transaction(() => { const row = this.current(fence); if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return null; row.leaseExpiresAt = this.now() + leaseForMs; return this.view(row) }) }
  async update(fence: SandboxHandleFence, handle: Uint8Array, handleVersion: number) { return this.backend.transaction(() => { const row = this.current(fence); if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return null; row.payload = this.cipher.encrypt(row, row.generation, handleVersion, handle); row.handleVersion = handleVersion; return this.view(row) }) }
  async release(fence: SandboxHandleFence) { return this.backend.transaction(() => { const row = this.current(fence); if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return false; row.leaseOwner = row.leaseToken = null; row.leaseExpiresAt = null; return true }) }
  async delete(fence: SandboxHandleFence, cleanup: SandboxCleanupOutcome) { return this.backend.transaction(() => { const row = this.current(fence); if (!row?.leaseExpiresAt || row.leaseExpiresAt <= this.now()) return false; row.cleanup = cleanup; if (cleanup.outcome !== 'succeeded') return false; return this.backend.rows.delete(this.id(fence.key)) }) }
  async reconcileDelete(key: SandboxHandleKey, cleanup: SandboxCleanupOutcome) { return this.backend.transaction(() => { const row = this.backend.rows.get(this.id(key)); if (!row) return false; row.cleanup = cleanup; if (cleanup.outcome !== 'succeeded') return false; return this.backend.rows.delete(this.id(key)) }) }
  async get(key: SandboxHandleKey) { return this.backend.transaction(() => { const row = this.backend.rows.get(this.id(key)); return row ? this.view(row) : null }) }
}
