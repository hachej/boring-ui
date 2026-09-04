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
  StoredCredentialMetadataV1,
  StoredCredentialRecordV1,
  WorkspaceDekRotationStateV1,
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
  const metadata = new Map<string, StoredCredentialMetadataV1>()
  const wrappedDeks = new Map<string, WrappedWorkspaceDekV1>()
  const fields = new Map<string, CredentialEnvelopeV1>()
  const tombstones = new Map<string, CredentialFieldTombstoneV1>()
  const rotations = new Map<string, WorkspaceDekRotationStateV1>()
  const shreddedWorkspaces = new Set<string>()
  const workspaceQueues = new Map<string, Promise<void>>()

  const persistence: CredentialVaultPersistenceV1 = {
    async withWorkspaceLock<T>(
      workspaceId: string,
      mutate: (locked: CredentialVaultPersistenceV1) => Promise<T>,
    ): Promise<T> {
      const previous = workspaceQueues.get(workspaceId) ?? Promise.resolve()
      let release!: () => void
      const current = new Promise<void>((resolve) => { release = resolve })
      const queued = previous.then(() => current)
      workspaceQueues.set(workspaceId, queued)
      await previous
      try {
        return await mutate(persistence)
      } finally {
        release()
        if (workspaceQueues.get(workspaceId) === queued) workspaceQueues.delete(workspaceId)
      }
    },
    async getCredentialMetadata(workspaceId, providerId) {
      const stored = metadata.get(recordKey(workspaceId, providerId))
      return stored ? Object.freeze({ ...stored }) : undefined
    },
    async listCredentialMetadata(workspaceId) {
      const result: StoredCredentialMetadataV1[] = []
      for (const [encodedKey, stored] of metadata) {
        const [storedWorkspaceId] = JSON.parse(encodedKey) as [string, string]
        if (storedWorkspaceId === workspaceId) result.push(Object.freeze({ ...stored }))
      }
      return Object.freeze(result.sort((a, b) => a.providerId.localeCompare(b.providerId)))
    },
    async updateCredentialMetadata(workspaceId, providerId, update) {
      const key = recordKey(workspaceId, providerId)
      const record = records.get(key)
      if (!record) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
          'Credential material is not configured',
        )
      }
      const now = new Date().toISOString()
      const existing = metadata.get(key)
      const next: StoredCredentialMetadataV1 = Object.freeze({
        providerId,
        displayLabel: update.displayLabel ?? existing?.displayLabel ?? providerId,
        credentialType: update.credentialType ?? existing?.credentialType ?? 'field-set.v1',
        state: update.state,
        credentialVersion: record.credentialVersion,
        ...(update.maskedLastFourSuffix === null
          ? {}
          : { maskedLastFourSuffix: update.maskedLastFourSuffix ?? existing?.maskedLastFourSuffix }),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      metadata.set(key, next)
      return Object.freeze({ ...next })
    },
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
      const key = recordKey(workspaceId, providerId)
      records.set(key, Object.freeze({ ...record }))
      const now = new Date().toISOString()
      const existing = metadata.get(key)
      metadata.set(key, Object.freeze({
        providerId,
        displayLabel: existing?.displayLabel ?? providerId,
        credentialType: existing?.credentialType ?? 'field-set.v1',
        state: record.materialKind === 'none' ? 'intentionally_absent' : 'active',
        credentialVersion: record.credentialVersion,
        ...(record.materialKind === 'field-set' && existing?.maskedLastFourSuffix
          ? { maskedLastFourSuffix: existing.maskedLastFourSuffix }
          : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }))
    },
    async commitCredentialVersion(
      input: CommitCredentialVersionInputV1,
    ): Promise<void> {
      if (shreddedWorkspaces.has(input.workspaceId)) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.UNREADABLE,
          'Workspace credential material was crypto-shredded',
        )
      }
      const rotation = rotations.get(input.workspaceId)
      if (rotation && input.record.dekGeneration === rotation.sourceGeneration) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.UNREADABLE,
          'Credential write must retry against the active DEK generation',
        )
      }
      const encodedRecordKey = recordKey(input.workspaceId, input.providerId)
      const currentRecord = records.get(encodedRecordKey)
      const currentVersion = currentRecord?.credentialVersion ?? 0
      if (
        currentRecord
        && currentRecord.dekGeneration !== input.record.dekGeneration
        && input.record.dekGeneration !== rotation?.targetGeneration
      ) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.UNREADABLE,
          'Credential DEK generation changed concurrently',
        )
      }
      if (!currentRecord && !rotation) {
        const workspaceGenerations = new Set<number>()
        for (const [key, record] of records) {
          const [storedWorkspaceId] = JSON.parse(key) as [string, string]
          if (storedWorkspaceId === input.workspaceId) workspaceGenerations.add(record.dekGeneration)
        }
        if (workspaceGenerations.size > 0 && !workspaceGenerations.has(input.record.dekGeneration)) {
          throw new CredentialResolutionError(
            CREDENTIAL_ERROR_CODES.UNREADABLE,
            'Credential DEK generation changed concurrently',
          )
        }
      }
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
      await persistence.putCredentialRecord(input.workspaceId, input.providerId, input.record)
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
    async listCredentialRecords(workspaceId: string) {
      const result = []
      for (const [encodedKey, record] of records) {
        const [storedWorkspaceId, providerId] = JSON.parse(encodedKey) as [string, ProviderId]
        if (storedWorkspaceId === workspaceId) {
          result.push(Object.freeze({ providerId, record: Object.freeze({ ...record }) }))
        }
      }
      return Object.freeze(result)
    },
    async listFields(workspaceId, providerId, credentialVersion) {
      const result = new Map<string, CredentialEnvelopeV1>()
      for (const [encodedKey, envelope] of fields) {
        const [storedWorkspaceId, storedProviderId, storedVersion, fieldId] = JSON.parse(
          encodedKey,
        ) as [string, ProviderId, number, string]
        if (
          storedWorkspaceId === workspaceId
          && storedProviderId === providerId
          && storedVersion === credentialVersion
        ) result.set(fieldId, copyEnvelope(envelope))
      }
      return result
    },
    async commitDekRotationRecord(input) {
      const encodedRecordKey = recordKey(input.workspaceId, input.providerId)
      const current = records.get(encodedRecordKey)
      if (
        !current
        || current.credentialVersion !== input.expectedCredentialVersion
        || current.dekGeneration !== input.sourceGeneration
      ) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.UNREADABLE,
          'Credential record changed during DEK rotation',
        )
      }
      for (const [fieldId, envelope] of input.fields) {
        fields.set(fieldKey({
          workspaceId: input.workspaceId,
          providerId: input.providerId,
          credentialVersion: current.credentialVersion,
          fieldId,
        }), copyEnvelope(envelope))
      }
      records.set(encodedRecordKey, Object.freeze({
        ...current,
        dekGeneration: input.targetGeneration,
      }))
    },
    async getDekRotationState(workspaceId) {
      const state = rotations.get(workspaceId)
      return state ? Object.freeze({ ...state }) : undefined
    },
    async putDekRotationState(workspaceId, state) {
      rotations.set(workspaceId, Object.freeze({ ...state }))
    },
    async clearDekRotationState(workspaceId) {
      rotations.delete(workspaceId)
    },
    async isWorkspaceCryptoShredded(workspaceId) {
      return shreddedWorkspaces.has(workspaceId)
    },
    async cryptoShredWorkspace(workspaceId, shreddedAt) {
      shreddedWorkspaces.add(workspaceId)
      rotations.delete(workspaceId)
      for (const [encodedKey] of wrappedDeks) {
        const [storedWorkspaceId] = JSON.parse(encodedKey) as [string, number]
        if (storedWorkspaceId === workspaceId) wrappedDeks.delete(encodedKey)
      }
      for (const [encodedKey] of fields) {
        const [storedWorkspaceId] = JSON.parse(encodedKey) as [string, string, number, string]
        if (storedWorkspaceId === workspaceId) {
          fields.delete(encodedKey)
          tombstones.set(encodedKey, Object.freeze({
            deletedAt: shreddedAt,
            reason: 'crypto-shred',
          }))
        }
      }
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
