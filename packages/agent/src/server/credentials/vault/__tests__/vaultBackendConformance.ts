import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { CREDENTIAL_ERROR_CODES } from '../../../../shared/credentials'
import type {
  CredentialFieldId,
  ProviderId,
  WorkspaceKekProviderV1,
} from '../../../../shared/credentials'
import {
  createInMemoryCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createVaultCredentialStoreBackendV1,
} from '..'
import type { CredentialVaultPersistenceV1 } from '../persistence'

const providerId = 'conformance-provider' as ProviderId
const fieldId = 'api-key' as CredentialFieldId
const kekA = new Uint8Array(32).fill(0xa1)
const kekB = new Uint8Array(32).fill(0xb2)

function kmsBackend(kek: Uint8Array): WorkspaceKekProviderV1 {
  return createLocalKekWorkspaceKekProviderV1({
    keyRef: 'conformance-kek',
    keyVersion: 1,
    loadKek: async () => new Uint8Array(kek),
  })
}

export function runVaultCredentialStoreConformanceV1(
  label: string,
  createPersistence: () => Promise<CredentialVaultPersistenceV1>,
): void {
  describe(`vault credential store conformance: ${label}`, () => {
    async function harness(kek = kekA) {
      const persistence = await createPersistence()
      const backend = createVaultCredentialStoreBackendV1({
        persistence,
        kmsBackend: kmsBackend(kek),
        versionAnchor: createInMemoryCredentialVersionAnchorV1(),
      })
      return { backend, persistence }
    }

    test('round-trips ciphertext and rewraps its workspace DEK', async () => {
      const workspaceId = `ws-${randomUUID()}`
      const secret = new TextEncoder().encode('conformance-secret')
      const { backend, persistence } = await harness()
      const record = await backend.writeCredentialFields({
        workspaceId,
        providerId,
        fields: new Map([[fieldId, secret]]),
      })
      const stored = await persistence.getField({
        workspaceId,
        providerId,
        credentialVersion: record.credentialVersion,
        fieldId,
      })
      expect(Buffer.from(stored!.ciphertext).includes(Buffer.from(secret))).toBe(false)
      await backend.rewrapWorkspaceDek(workspaceId, record.dekGeneration)
      const resolved = await backend.read(workspaceId, providerId, [fieldId])
      if (resolved.kind !== 'field-set') throw new Error('expected field-set')
      expect(resolved.fields.get(fieldId)).toEqual(secret)
    })

    test('rejects the same persisted material under a different KEK', async () => {
      const workspaceId = `ws-${randomUUID()}`
      const persistence = await createPersistence()
      const anchor = createInMemoryCredentialVersionAnchorV1()
      const writer = createVaultCredentialStoreBackendV1({
        persistence,
        kmsBackend: kmsBackend(kekA),
        versionAnchor: anchor,
      })
      await writer.writeCredentialFields({
        workspaceId,
        providerId,
        fields: new Map([[fieldId, new TextEncoder().encode('secret')]]),
      })
      const reader = createVaultCredentialStoreBackendV1({
        persistence,
        kmsBackend: kmsBackend(kekB),
        versionAnchor: anchor,
      })
      await expect(reader.read(workspaceId, providerId, [fieldId]))
        .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
    })

    test('deletes superseded ciphertext and retains its metadata tombstone', async () => {
      const workspaceId = `ws-${randomUUID()}`
      const { backend, persistence } = await harness()
      await backend.writeCredentialFields({
        workspaceId,
        providerId,
        fields: new Map([[fieldId, new TextEncoder().encode('old')]]),
      })
      await backend.writeCredentialFields({
        workspaceId,
        providerId,
        fields: new Map([[fieldId, new TextEncoder().encode('new')]]),
      })
      const oldKey = { workspaceId, providerId, credentialVersion: 1, fieldId }
      expect(await persistence.getField(oldKey)).toBeUndefined()
      expect(await persistence.getFieldTombstone(oldKey)).toMatchObject({
        reason: 'superseded-version',
      })
    })

    test('fails closed when a current envelope is missing', async () => {
      const workspaceId = `ws-${randomUUID()}`
      const { backend, persistence } = await harness()
      const record = await backend.writeCredentialFields({
        workspaceId,
        providerId,
        fields: new Map([[fieldId, new TextEncoder().encode('secret')]]),
      })
      await persistence.tombstoneCredentialVersionFields(
        workspaceId,
        providerId,
        record.credentialVersion,
        { deletedAt: new Date().toISOString(), reason: 'credential-tombstone' },
      )
      await expect(backend.read(workspaceId, providerId, [fieldId]))
        .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
    })
  })
}
