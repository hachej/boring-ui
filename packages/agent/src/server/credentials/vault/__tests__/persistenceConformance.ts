import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import type {
  CredentialEnvelopeV1,
  CredentialFieldId,
  ProviderId,
  WrappedWorkspaceDekV1,
} from '../../../../shared/credentials'
import {
  CREDENTIAL_ENVELOPE_VERSION,
  CredentialResolutionError,
} from '../../../../shared/credentials'
import { createLocalKekWorkspaceKekProviderV1 } from '../kmsBackend'
import type { CredentialVaultPersistenceV1 } from '../persistence'
import { createInMemoryCredentialVersionAnchorV1 } from '../versionAnchor'
import { createVaultCredentialStoreBackendV1 } from '../vaultStoreBackend'

const providerId = 'conformance-provider' as ProviderId

function envelope(seed: number): CredentialEnvelopeV1 {
  return {
    envelopeVersion: CREDENTIAL_ENVELOPE_VERSION,
    ciphertext: new Uint8Array([seed, 2, 3]),
    nonce: new Uint8Array(12).fill(seed),
    authTag: new Uint8Array(16).fill(seed + 1),
    aadContext: new Uint8Array([seed + 2]),
  }
}

function wrappedDek(seed: number): WrappedWorkspaceDekV1 {
  return {
    providerId: 'local-kek',
    keyRef: 'conformance',
    keyVersion: 1,
    payload: {
      format: 'local-aes-256-gcm.v1',
      ciphertext: new Uint8Array(32).fill(seed),
      nonce: new Uint8Array(12).fill(seed + 1),
      authTag: new Uint8Array(16).fill(seed + 2),
      aadContext: new Uint8Array([seed + 3]),
    },
  }
}

export function runCredentialVaultPersistenceConformanceV1(
  label: string,
  createPersistence: () => Promise<CredentialVaultPersistenceV1>,
): void {
  describe(`CredentialVaultPersistenceV1 conformance: ${label}`, () => {
    test('round-trips records, field envelopes, and wrapped DEKs', async () => {
      const persistence = await createPersistence()
      const workspaceId = `ws-${randomUUID()}`
      const record = {
        credentialId: randomUUID(),
        credentialVersion: 1,
        dekGeneration: 1,
        materialKind: 'field-set' as const,
      }
      const key = {
        workspaceId,
        providerId,
        credentialVersion: 1,
        dekGeneration: 1,
        fieldId: 'api-key',
      }
      await persistence.putCredentialRecord(workspaceId, providerId, record)
      await persistence.putWrappedDek(workspaceId, 1, wrappedDek(3))
      await persistence.putField(key, envelope(4))

      expect(await persistence.getCredentialRecord(workspaceId, providerId)).toEqual(record)
      expect(await persistence.getWrappedDek(workspaceId, 1)).toEqual(wrappedDek(3))
      expect(await persistence.getField(key)).toEqual(envelope(4))
    })

    test('atomically replaces a version with metadata-only tombstones', async () => {
      const persistence = await createPersistence()
      const workspaceId = `ws-${randomUUID()}`
      const oldKey = { workspaceId, providerId, credentialVersion: 1, fieldId: 'api-key' }
      await persistence.putWrappedDek(workspaceId, 1, wrappedDek(4))
      await persistence.commitCredentialVersion({
        workspaceId,
        providerId,
        expectedCredentialVersion: 0,
        record: {
          credentialId: randomUUID(),
          credentialVersion: 1,
          dekGeneration: 1,
          materialKind: 'field-set',
        },
        fields: new Map([['api-key', envelope(5)]]),
      })
      const first = (await persistence.getCredentialRecord(workspaceId, providerId))!
      await persistence.commitCredentialVersion({
        workspaceId,
        providerId,
        expectedCredentialVersion: 1,
        record: { ...first, credentialVersion: 2 },
        fields: new Map([['api-key', envelope(6)]]),
        supersededFieldsTombstone: {
          deletedAt: '2026-08-07T00:00:00.000Z',
          reason: 'superseded-version',
        },
      })

      expect(await persistence.getField(oldKey)).toBeUndefined()
      expect(await persistence.getFieldTombstone(oldKey)).toEqual({
        deletedAt: '2026-08-07T00:00:00.000Z',
        reason: 'superseded-version',
      })
      await expect(persistence.putField(oldKey, envelope(7)))
        .rejects.toBeInstanceOf(CredentialResolutionError)
    })

    test('runs the vault-store rotation path against the persistence adapter', async () => {
      const persistence = await createPersistence()
      const workspaceId = `ws-${randomUUID()}`
      const fieldId = 'api-key' as CredentialFieldId
      const backend = createVaultCredentialStoreBackendV1({
        persistence,
        versionAnchor: createInMemoryCredentialVersionAnchorV1(),
        kmsBackend: createLocalKekWorkspaceKekProviderV1({
          keyRef: 'conformance',
          keyVersion: 1,
          loadKek: async () => new Uint8Array(32).fill(0x5a),
        }),
      })
      await backend.writeCredentialFields({
        workspaceId,
        providerId,
        fields: new Map([[fieldId, new TextEncoder().encode('first')]]),
      })
      const second = await backend.writeCredentialFields({
        workspaceId,
        providerId,
        fields: new Map([[fieldId, new TextEncoder().encode('second')]]),
      })
      expect(second.credentialVersion).toBe(2)
      const resolved = await backend.read(workspaceId, providerId, [fieldId])
      expect(resolved.kind).toBe('field-set')
      if (resolved.kind !== 'field-set') throw new Error('expected field-set')
      expect(new TextDecoder().decode(resolved.fields.get(fieldId))).toBe('second')
      expect(await persistence.getField({
        workspaceId,
        providerId,
        credentialVersion: 1,
        fieldId,
      })).toBeUndefined()
    })

    test('physically and idempotently deletes a wrapped DEK', async () => {
      const persistence = await createPersistence()
      const workspaceId = `ws-${randomUUID()}`
      await persistence.putWrappedDek(workspaceId, 4, wrappedDek(8))
      await persistence.deleteWrappedDek(workspaceId, 4)
      await persistence.deleteWrappedDek(workspaceId, 4)
      expect(await persistence.getWrappedDek(workspaceId, 4)).toBeUndefined()
    })
  })
}
