import { describe, expect, test } from 'vitest'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../../shared/credentials'
import type { CredentialFieldId, ProviderId } from '../../../../shared/credentials'
import {
  createInMemoryCredentialVaultPersistenceV1,
  createInMemoryCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createVaultCredentialStoreBackendV1,
  decryptCredentialFieldV1,
} from '..'
import type { CredentialVaultPersistenceV1 } from '../persistence'

const workspaceId = 'rotation-workspace'
const providerA = 'provider-a' as ProviderId
const providerB = 'provider-b' as ProviderId
const providerC = 'provider-c' as ProviderId
const apiKey = 'api-key' as CredentialFieldId
const token = 'token' as CredentialFieldId

function harness(persistence: CredentialVaultPersistenceV1) {
  const kmsBackend = createLocalKekWorkspaceKekProviderV1({
    keyRef: 'rotation-test-kek',
    keyVersion: 1,
    loadKek: async () => new Uint8Array(32).fill(0x6b),
  })
  const versionAnchor = createInMemoryCredentialVersionAnchorV1()
  return {
    kmsBackend,
    versionAnchor,
    backend: createVaultCredentialStoreBackendV1({
      persistence,
      kmsBackend,
      versionAnchor,
    }),
  }
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function decoded(value: Uint8Array | undefined): string {
  if (!value) throw new Error('missing resolved field')
  return new TextDecoder().decode(value)
}

describe('workspace DEK lifecycle', () => {
  test('resumes an interrupted rotation, verifies N+1, and destroys generation N', async () => {
    const durable = createInMemoryCredentialVaultPersistenceV1()
    const initial = harness(durable)
    await initial.backend.writeCredentialFields({
      workspaceId,
      providerId: providerA,
      fields: new Map([[apiKey, text('secret-a')]]),
    })
    await initial.backend.writeCredentialFields({
      workspaceId,
      providerId: providerB,
      fields: new Map([[token, text('secret-b')]]),
    })

    const oldWrapped = await durable.getWrappedDek(workspaceId, 1)
    if (!oldWrapped) throw new Error('missing generation-one key')
    const oldDek = await initial.kmsBackend.unwrapDataKey(
      { workspaceId, dekGeneration: 1, requestId: 'capture-old-key' },
      oldWrapped,
    )

    let commits = 0
    const interrupted: CredentialVaultPersistenceV1 = {
      ...durable,
      async withWorkspaceLock(_workspaceId, mutate) {
        return mutate(interrupted)
      },
      async commitDekRotationRecord(input) {
        commits += 1
        if (commits === 2) throw new Error('simulated process interruption')
        await durable.commitDekRotationRecord(input)
      },
    }
    const firstAttempt = createVaultCredentialStoreBackendV1({
      persistence: interrupted,
      kmsBackend: initial.kmsBackend,
      versionAnchor: initial.versionAnchor,
    })
    await expect(firstAttempt.rotateWorkspaceDek(workspaceId, 'rotation-1'))
      .rejects.toThrow('simulated process interruption')
    expect(await durable.getDekRotationState(workspaceId)).toMatchObject({
      sourceGeneration: 1,
      targetGeneration: 2,
      phase: 'reencrypting',
    })

    const resumed = createVaultCredentialStoreBackendV1({
      persistence: durable,
      kmsBackend: initial.kmsBackend,
      versionAnchor: initial.versionAnchor,
    })
    await expect(resumed.rotateWorkspaceDek(workspaceId, 'rotation-1')).resolves.toBe(2)
    expect(await durable.getDekRotationState(workspaceId)).toBeUndefined()
    expect(await durable.getWrappedDek(workspaceId, 1)).toBeUndefined()

    const resolvedA = await resumed.read(workspaceId, providerA, [apiKey])
    const resolvedB = await resumed.read(workspaceId, providerB, [token])
    if (resolvedA.kind !== 'field-set' || resolvedB.kind !== 'field-set') {
      throw new Error('expected field-set credentials')
    }
    expect(decoded(resolvedA.fields.get(apiKey))).toBe('secret-a')
    expect(decoded(resolvedB.fields.get(token))).toBe('secret-b')

    const recordA = await durable.getCredentialRecord(workspaceId, providerA)
    const envelopeA = await durable.getField({
      workspaceId,
      providerId: providerA,
      credentialVersion: recordA!.credentialVersion,
      fieldId: apiKey,
    })
    expect(() => decryptCredentialFieldV1({
      plaintextDek: oldDek,
      envelope: envelopeA!,
      aadContext: {
        workspaceId,
        credentialId: recordA!.credentialId,
        providerId: providerA,
        fieldId: apiKey,
        credentialVersion: recordA!.credentialVersion,
        dekGeneration: 2,
      },
    })).toThrow(CredentialResolutionError)
    oldDek.fill(0)
  })

  test('rejects a forged non-adjacent rotation before modifying source records', async () => {
    const persistence = createInMemoryCredentialVaultPersistenceV1()
    const { backend } = harness(persistence)
    const original = await backend.writeCredentialFields({
      workspaceId,
      providerId: providerA,
      fields: new Map([[apiKey, text('must-remain-generation-one')]]),
    })
    await persistence.putDekRotationState(workspaceId, {
      operationId: 'forged-n-plus-two',
      sourceGeneration: 1,
      targetGeneration: 3,
      phase: 'reencrypting',
    })

    await expect(backend.rotateWorkspaceDek(workspaceId, 'forged-n-plus-two'))
      .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
    expect(await persistence.getCredentialRecord(workspaceId, providerA)).toEqual(original)
    expect(await persistence.getWrappedDek(workspaceId, 3)).toBeUndefined()
  })

  test('new providers use the anchored current generation after rotation', async () => {
    const persistence = createInMemoryCredentialVaultPersistenceV1()
    const { backend } = harness(persistence)
    await backend.writeCredentialFields({
      workspaceId,
      providerId: providerA,
      fields: new Map([[apiKey, text('first-secret')]]),
    })
    await backend.rotateWorkspaceDek(workspaceId, 'rotation-1')

    const added = await backend.writeCredentialFields({
      workspaceId,
      providerId: providerC,
      fields: new Map([[apiKey, text('new-secret')]]),
    })
    expect(added.dekGeneration).toBe(2)
    await expect(backend.read(workspaceId, providerC, [apiKey]))
      .resolves.toMatchObject({ kind: 'field-set' })
    await expect(backend.rotateWorkspaceDek(workspaceId, 'rotation-1')).resolves.toBe(2)
    await expect(backend.rotateWorkspaceDek(workspaceId, 'rotation-2')).resolves.toBe(3)
    await expect(backend.rotateWorkspaceDek(workspaceId, 'rotation-1')).resolves.toBe(2)
    await expect(backend.read(workspaceId, providerC, [apiKey]))
      .resolves.toMatchObject({ kind: 'field-set' })
  })

  test('rejects a complete generation-one persistence replay after DEK rotation', async () => {
    const live = createInMemoryCredentialVaultPersistenceV1()
    const snapshot = createInMemoryCredentialVaultPersistenceV1()
    let selected = live
    const switchable = new Proxy({} as CredentialVaultPersistenceV1, {
      get(_target, property) {
        const value = selected[property as keyof CredentialVaultPersistenceV1]
        return typeof value === 'function' ? value.bind(selected) : value
      },
    })
    const current = harness(switchable)
    const replay = harness(snapshot)
    await current.backend.writeCredentialFields({
      workspaceId,
      providerId: providerA,
      fields: new Map([[apiKey, text('current-secret')]]),
    })
    await replay.backend.writeCredentialFields({
      workspaceId,
      providerId: providerA,
      fields: new Map([[apiKey, text('replayed-secret')]]),
    })

    await expect(current.backend.rotateWorkspaceDek(workspaceId, 'rotation-1')).resolves.toBe(2)
    expect(await current.versionAnchor.read(workspaceId)).toMatchObject({ dekGeneration: 2 })
    selected = snapshot

    await expect(current.backend.read(workspaceId, providerA, [apiKey]))
      .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
  })

  test('crypto-shred is idempotent and permanently fails closed without plaintext fallback', async () => {
    const persistence = createInMemoryCredentialVaultPersistenceV1()
    const { backend } = harness(persistence)
    const record = await backend.writeCredentialFields({
      workspaceId,
      providerId: providerA,
      fields: new Map([[apiKey, text('destroy-me')]]),
    })

    await backend.cryptoShredWorkspace(workspaceId)
    await backend.cryptoShredWorkspace(workspaceId)

    expect(await persistence.getWrappedDek(workspaceId, record.dekGeneration)).toBeUndefined()
    expect(await persistence.getField({
      workspaceId,
      providerId: providerA,
      credentialVersion: record.credentialVersion,
      fieldId: apiKey,
    })).toBeUndefined()
    expect(await persistence.getFieldTombstone({
      workspaceId,
      providerId: providerA,
      credentialVersion: record.credentialVersion,
      fieldId: apiKey,
    })).toMatchObject({ reason: 'crypto-shred' })
    await expect(backend.read(workspaceId, providerA, [apiKey])).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.UNREADABLE,
    })
    await expect(backend.writeCredentialFields({
      workspaceId,
      providerId: providerA,
      fields: new Map([[apiKey, text('must-not-return')]]),
    })).rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
  })
})
