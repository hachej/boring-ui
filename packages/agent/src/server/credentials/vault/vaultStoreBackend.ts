import { randomUUID } from 'node:crypto'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type {
  CredentialFieldId,
  ProviderId,
  ResolvedCredentialMaterialV1,
  WorkspaceKekContextV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'
import type { CredentialStoreBackendV1 } from '../hostResolver'
import {
  decryptCredentialFieldV1,
  encryptCredentialFieldV1,
} from './envelopeCrypto'
import type {
  CredentialVaultPersistenceV1,
  StoredCredentialRecordV1,
} from './persistence'

/**
 * Composes a `WorkspaceKekProviderV1` (KmsBackend) with AAD-bound AES-256-GCM
 * field crypto and an injectable persistence port into the
 * `CredentialStoreBackendV1` that `createHostSideCredentialResolverV1` already
 * consumes. The resolver contract is unchanged.
 *
 * Fail-closed rules: an unready backend, an unknown record, a wrong/absent
 * KEK, or any tampered ciphertext/nonce/tag/AAD component throws a stable
 * `CredentialResolutionError`. Nothing here ever returns "absent" in place of
 * an authentication failure, and nothing ever falls back to another backend or
 * to plaintext. Plaintext DEKs and field values are overwritten in `finally` on
 * a best-effort basis (Node/V8 cannot guarantee erasure).
 */

export interface VaultCredentialStoreOptionsV1 {
  readonly kmsBackend: WorkspaceKekProviderV1
  readonly persistence: CredentialVaultPersistenceV1
}

export interface WriteCredentialFieldsInputV1 {
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly credentialId?: string
  readonly fields: ReadonlyMap<CredentialFieldId, Uint8Array>
}

export interface VaultCredentialStoreBackendV1 extends CredentialStoreBackendV1 {
  /**
   * Writes (or rotates to) a new credential version for a workspace/provider.
   * Every write mints a fresh credential version; nonces are never reused.
   */
  writeCredentialFields(
    input: WriteCredentialFieldsInputV1,
  ): Promise<StoredCredentialRecordV1>
  /** Marks a workspace/provider credential as deliberately field-less. */
  writeAbsentCredential(
    workspaceId: string,
    providerId: ProviderId,
  ): Promise<StoredCredentialRecordV1>
  /** Rotates the KEK wrapping for one workspace DEK generation in place. */
  rewrapWorkspaceDek(workspaceId: string, dekGeneration: number): Promise<void>
}

function notConfigured(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    message,
  )
}

function unreadable(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    message,
  )
}

function assertWorkspaceId(workspaceId: unknown): asserts workspaceId is string {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
      'Invalid workspace identifier',
    )
  }
}

export function createVaultCredentialStoreBackendV1(
  options: VaultCredentialStoreOptionsV1,
): VaultCredentialStoreBackendV1 {
  if (
    !options?.kmsBackend
    || options.kmsBackend.contractVersion !== 'boring.workspace-kek-provider.v1'
    || !options.persistence
  ) {
    notConfigured('Credential vault backend is misconfigured')
  }
  const { kmsBackend, persistence } = options

  async function requireReady(): Promise<void> {
    let readiness: Awaited<ReturnType<WorkspaceKekProviderV1['readiness']>>
    try {
      readiness = await kmsBackend.readiness()
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        'Credential key backend is unavailable',
        { retryable: true },
      )
    }
    if (!readiness?.ready) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        `Credential key backend is not ready (${readiness?.reasonCode ?? 'unknown'})`,
        { retryable: true },
      )
    }
  }

  function context(
    workspaceId: string,
    dekGeneration: number,
  ): WorkspaceKekContextV1 {
    return { workspaceId, dekGeneration, requestId: randomUUID() }
  }

  async function requireWrappedDek(
    workspaceId: string,
    dekGeneration: number,
  ): Promise<WrappedWorkspaceDekV1> {
    const wrapped = await persistence.getWrappedDek(workspaceId, dekGeneration)
    if (!wrapped) {
      // A record exists but its key generation does not: fail closed, do not
      // silently mint a new DEK and lose access to the existing ciphertext.
      unreadable('Workspace credential key generation is missing')
    }
    return wrapped
  }

  return Object.freeze({
    async read(
      workspaceId: string,
      providerId: ProviderId,
      allowedFieldIds: readonly CredentialFieldId[],
    ): Promise<ResolvedCredentialMaterialV1 & { credentialVersion: number }> {
      assertWorkspaceId(workspaceId)
      await requireReady()
      const record = await persistence.getCredentialRecord(workspaceId, providerId)
      if (!record) {
        notConfigured('Credential material is not configured')
      }
      if (record.materialKind === 'none') {
        if (allowedFieldIds.length !== 0) {
          notConfigured('Credential material is not configured')
        }
        return { kind: 'none', credentialVersion: record.credentialVersion }
      }
      if (allowedFieldIds.length === 0) {
        return {
          kind: 'field-set',
          fields: new Map(),
          credentialVersion: record.credentialVersion,
        }
      }

      const wrappedDek = await requireWrappedDek(workspaceId, record.dekGeneration)
      let plaintextDek: Uint8Array | undefined
      const fields = new Map<CredentialFieldId, Uint8Array>()
      try {
        plaintextDek = await kmsBackend.unwrapDataKey(
          context(workspaceId, record.dekGeneration),
          wrappedDek,
        )
        for (const fieldId of allowedFieldIds) {
          const envelope = await persistence.getField({
            workspaceId,
            providerId,
            credentialVersion: record.credentialVersion,
            fieldId,
          })
          if (!envelope) {
            notConfigured('Required credential material is not configured')
          }
          const plaintext = decryptCredentialFieldV1({
            plaintextDek,
            envelope,
            aadContext: {
              workspaceId,
              credentialId: record.credentialId,
              providerId,
              fieldId,
              credentialVersion: record.credentialVersion,
              dekGeneration: record.dekGeneration,
            },
          })
          try {
            fields.set(fieldId, new Uint8Array(plaintext))
          } finally {
            plaintext.fill(0)
          }
        }
      } catch (error) {
        for (const value of fields.values()) value.fill(0)
        fields.clear()
        throw error
      } finally {
        plaintextDek?.fill(0)
      }
      return {
        kind: 'field-set',
        fields,
        credentialVersion: record.credentialVersion,
      }
    },

    async writeCredentialFields(
      input: WriteCredentialFieldsInputV1,
    ): Promise<StoredCredentialRecordV1> {
      assertWorkspaceId(input?.workspaceId)
      await requireReady()
      const { workspaceId, providerId } = input
      const existing = await persistence.getCredentialRecord(workspaceId, providerId)
      const credentialId =
        input.credentialId ?? existing?.credentialId ?? randomUUID()
      const credentialVersion = (existing?.credentialVersion ?? 0) + 1
      const dekGeneration = existing?.dekGeneration ?? 1

      let plaintextDek: Uint8Array | undefined
      try {
        const storedDek = await persistence.getWrappedDek(workspaceId, dekGeneration)
        if (storedDek) {
          plaintextDek = await kmsBackend.unwrapDataKey(
            context(workspaceId, dekGeneration),
            storedDek,
          )
        } else {
          const generated = await kmsBackend.generateDataKey(
            context(workspaceId, dekGeneration),
          )
          plaintextDek = generated.plaintextDek
          await persistence.putWrappedDek(
            workspaceId,
            dekGeneration,
            generated.wrappedDek,
          )
        }
        for (const [fieldId, plaintext] of input.fields) {
          const envelope = encryptCredentialFieldV1({
            plaintextDek,
            plaintext,
            aadContext: {
              workspaceId,
              credentialId,
              providerId,
              fieldId,
              credentialVersion,
              dekGeneration,
            },
          })
          await persistence.putField(
            { workspaceId, providerId, credentialVersion, fieldId },
            envelope,
          )
        }
      } finally {
        plaintextDek?.fill(0)
      }

      const record: StoredCredentialRecordV1 = Object.freeze({
        credentialId,
        credentialVersion,
        dekGeneration,
        materialKind: 'field-set',
      })
      await persistence.putCredentialRecord(workspaceId, providerId, record)
      return record
    },

    async writeAbsentCredential(
      workspaceId: string,
      providerId: ProviderId,
    ): Promise<StoredCredentialRecordV1> {
      assertWorkspaceId(workspaceId)
      const existing = await persistence.getCredentialRecord(workspaceId, providerId)
      const record: StoredCredentialRecordV1 = Object.freeze({
        credentialId: existing?.credentialId ?? randomUUID(),
        credentialVersion: (existing?.credentialVersion ?? 0) + 1,
        dekGeneration: existing?.dekGeneration ?? 1,
        materialKind: 'none',
      })
      await persistence.putCredentialRecord(workspaceId, providerId, record)
      return record
    },

    async rewrapWorkspaceDek(
      workspaceId: string,
      dekGeneration: number,
    ): Promise<void> {
      assertWorkspaceId(workspaceId)
      await requireReady()
      if (typeof kmsBackend.rewrapDataKey !== 'function') {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
          'Credential key backend does not support rewrap',
        )
      }
      const wrapped = await requireWrappedDek(workspaceId, dekGeneration)
      const rewrapped = await kmsBackend.rewrapDataKey(
        context(workspaceId, dekGeneration),
        wrapped,
      )
      await persistence.putWrappedDek(workspaceId, dekGeneration, rewrapped)
    },
  })
}
