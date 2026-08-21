import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type { ProviderId } from '../../../shared/credentials'
import type {
  CredentialEnvelopeV1,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'
import type {
  CommitCredentialVersionInputV1,
  CredentialFieldKeyV1,
  CredentialFieldTombstoneV1,
  CredentialVaultPersistenceV1,
  StoredCredentialRecordV1,
} from './persistence'

/**
 * Real in-memory implementation of the vault persistence port, for tests and
 * single-process development. It stores exactly what a Postgres row would:
 * ciphertext, nonce, tag and persisted AAD — never plaintext or key material.
 */

function copyEnvelope(envelope: CredentialEnvelopeV1): CredentialEnvelopeV1 {
  return Object.freeze({
    envelopeVersion: envelope.envelopeVersion,
    ciphertext: new Uint8Array(envelope.ciphertext),
    nonce: new Uint8Array(envelope.nonce),
    authTag: new Uint8Array(envelope.authTag),
    aadContext: new Uint8Array(envelope.aadContext),
  })
}

function copyWrappedDek(wrapped: WrappedWorkspaceDekV1): WrappedWorkspaceDekV1 {
  const payload = wrapped.payload
  if (payload.format === 'local-aes-256-gcm.v1') {
    return Object.freeze({
      providerId: wrapped.providerId,
      keyRef: wrapped.keyRef,
      keyVersion: wrapped.keyVersion,
      payload: Object.freeze({
        format: payload.format,
        ciphertext: new Uint8Array(payload.ciphertext),
        nonce: new Uint8Array(payload.nonce),
        authTag: new Uint8Array(payload.authTag),
        aadContext: new Uint8Array(payload.aadContext),
      }),
    })
  }
  if (payload.format === 'vault-transit-ciphertext.v1') {
    return Object.freeze({
      providerId: wrapped.providerId,
      keyRef: wrapped.keyRef,
      keyVersion: wrapped.keyVersion,
      payload: Object.freeze({
        format: payload.format,
        ciphertext: new Uint8Array(payload.ciphertext),
      }),
    })
  }
  return Object.freeze({
    providerId: wrapped.providerId,
    keyRef: wrapped.keyRef,
    keyVersion: wrapped.keyVersion,
    payload: Object.freeze({
      format: payload.format,
      payloadFormatId: payload.payloadFormatId,
      opaqueAuthenticatedPayload: new Uint8Array(
        payload.opaqueAuthenticatedPayload,
      ),
    }),
  })
}

function recordKey(workspaceId: string, providerId: ProviderId): string {
  return JSON.stringify([workspaceId, providerId])
}

function dekKey(workspaceId: string, dekGeneration: number): string {
  return JSON.stringify([workspaceId, dekGeneration])
}

function fieldKey(key: CredentialFieldKeyV1): string {
  return JSON.stringify([
    key.workspaceId,
    key.providerId,
    key.credentialVersion,
    key.fieldId,
  ])
}

export function createInMemoryCredentialVaultPersistenceV1(): CredentialVaultPersistenceV1 {
  const records = new Map<string, StoredCredentialRecordV1>()
  const wrappedDeks = new Map<string, WrappedWorkspaceDekV1>()
  const fields = new Map<string, CredentialEnvelopeV1>()
  const tombstones = new Map<string, CredentialFieldTombstoneV1>()

  const persistence: CredentialVaultPersistenceV1 = {
    async getCredentialRecord(
      workspaceId: string,
      providerId: ProviderId,
    ): Promise<StoredCredentialRecordV1 | undefined> {
      return records.get(recordKey(workspaceId, providerId))
    },
    async putCredentialRecord(
      workspaceId: string,
      providerId: ProviderId,
      record: StoredCredentialRecordV1,
    ): Promise<void> {
      records.set(recordKey(workspaceId, providerId), Object.freeze({ ...record }))
    },
    async commitCredentialVersion(
      input: CommitCredentialVersionInputV1,
    ): Promise<void> {
      const encodedRecordKey = recordKey(input.workspaceId, input.providerId)
      const currentVersion = records.get(encodedRecordKey)?.credentialVersion ?? 0
      if (currentVersion !== input.expectedCredentialVersion) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.UNREADABLE,
          'Credential record version changed concurrently',
        )
      }
      for (const [fieldId, envelope] of input.fields) {
        const key = fieldKey({
          workspaceId: input.workspaceId,
          providerId: input.providerId,
          credentialVersion: input.record.credentialVersion,
          fieldId,
        })
        fields.set(key, copyEnvelope(envelope))
        tombstones.delete(key)
      }
      records.set(encodedRecordKey, Object.freeze({ ...input.record }))
      if (input.expectedCredentialVersion > 0 && input.supersededFieldsTombstone) {
        await persistence.tombstoneCredentialVersionFields(
          input.workspaceId,
          input.providerId,
          input.expectedCredentialVersion,
          input.supersededFieldsTombstone,
        )
      }
    },
    async getWrappedDek(
      workspaceId: string,
      dekGeneration: number,
    ): Promise<WrappedWorkspaceDekV1 | undefined> {
      const stored = wrappedDeks.get(dekKey(workspaceId, dekGeneration))
      return stored ? copyWrappedDek(stored) : undefined
    },
    async putWrappedDek(
      workspaceId: string,
      dekGeneration: number,
      wrapped: WrappedWorkspaceDekV1,
    ): Promise<void> {
      wrappedDeks.set(dekKey(workspaceId, dekGeneration), copyWrappedDek(wrapped))
    },
    async deleteWrappedDek(
      workspaceId: string,
      dekGeneration: number,
    ): Promise<void> {
      wrappedDeks.delete(dekKey(workspaceId, dekGeneration))
    },
    async getField(
      key: CredentialFieldKeyV1,
    ): Promise<CredentialEnvelopeV1 | undefined> {
      const stored = fields.get(fieldKey(key))
      return stored ? copyEnvelope(stored) : undefined
    },
    async putField(
      key: CredentialFieldKeyV1,
      envelope: CredentialEnvelopeV1,
    ): Promise<void> {
      const encodedKey = fieldKey(key)
      if (tombstones.has(encodedKey)) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.UNREADABLE,
          'Credential field tombstone cannot be resurrected',
        )
      }
      fields.set(encodedKey, copyEnvelope(envelope))
    },
    async tombstoneCredentialVersionFields(
      workspaceId: string,
      providerId: ProviderId,
      credentialVersion: number,
      tombstone: CredentialFieldTombstoneV1,
    ): Promise<void> {
      for (const [encodedKey] of fields) {
        const [storedWorkspaceId, storedProviderId, storedVersion] = JSON.parse(
          encodedKey,
        ) as [string, string, number, string]
        if (
          storedWorkspaceId === workspaceId
          && storedProviderId === providerId
          && storedVersion === credentialVersion
        ) {
          fields.delete(encodedKey)
          tombstones.set(encodedKey, Object.freeze({ ...tombstone }))
        }
      }
    },
    async getFieldTombstone(
      key: CredentialFieldKeyV1,
    ): Promise<CredentialFieldTombstoneV1 | undefined> {
      const stored = tombstones.get(fieldKey(key))
      return stored ? Object.freeze({ ...stored }) : undefined
    },
  }
  return Object.freeze(persistence)
}
