import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createInMemoryCredentialVaultPersistenceV1,
  createLocalKekFileSourceV1,
  createLocalKekWorkspaceKekProviderV1,
  createVaultCredentialStoreBackendV1,
  decryptCredentialFieldV1,
  encodeCredentialFieldAadV1,
  encryptCredentialFieldV1,
  resolveLocalKekProviderConfigV1,
} from '..'
import type {
  CredentialVaultPersistenceV1,
  VaultCredentialStoreBackendV1,
} from '..'
import {
  createFakeAuthorityVerifierV1,
  createHostSideCredentialResolverV1,
  withResolvedCredential,
} from '../..'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  createCredentialConsumerBindingRegistryV1,
  createProviderCredentialRefFactoryV1,
  createProviderRegistryV1,
} from '../../../../shared/credentials'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  CredentialConsumerBindingId,
  CredentialEnvelopeV1,
  CredentialFieldId,
  ProviderDefinitionV1,
  ProviderId,
  VerifiedWorkspaceCredentialAuthorityV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '../../../../shared/credentials'

const providerId = (value: string) => value as ProviderId
const fieldId = (value: string) => value as CredentialFieldId
const bindingId = (value: string) => value as CredentialConsumerBindingId

const PROVIDER_A = providerId('provider-a')
const FIELD_API_KEY = fieldId('api-key')
const SECRET_VALUE = 'sk-test-super-secret-value-0123456789'
const KEK_A = Buffer.alloc(32, 0xa1)
const KEK_B = Buffer.alloc(32, 0xb2)

function kekProvider(
  kek: Buffer,
  overrides: Readonly<{ keyRef?: string; keyVersion?: number }> = {},
): WorkspaceKekProviderV1 {
  return createLocalKekWorkspaceKekProviderV1({
    keyRef: overrides.keyRef ?? 'test-kek',
    keyVersion: overrides.keyVersion ?? 1,
    loadKek: async () => new Uint8Array(kek),
  })
}

function context(workspaceId: string, dekGeneration = 1) {
  return { workspaceId, dekGeneration, requestId: 'req-1' }
}

function vaultStore(
  kek: Buffer = KEK_A,
  persistence: CredentialVaultPersistenceV1 =
    createInMemoryCredentialVaultPersistenceV1(),
): Readonly<{
  backend: VaultCredentialStoreBackendV1
  persistence: CredentialVaultPersistenceV1
}> {
  return {
    backend: createVaultCredentialStoreBackendV1({
      kmsBackend: kekProvider(kek),
      persistence,
    }),
    persistence,
  }
}

async function expectCredentialError(
  run: () => Promise<unknown>,
  code?: string,
): Promise<CredentialResolutionError> {
  let caught: unknown
  try {
    await run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(CredentialResolutionError)
  const error = caught as CredentialResolutionError
  if (code) expect(error.code).toBe(code)
  return error
}

/** Proof 4 helper: no secret bytes may appear in any surfaced error text. */
function expectNoSecretLeak(error: Error): void {
  const surfaces = [
    error.message,
    String(error),
    error.stack ?? '',
    JSON.stringify({ message: error.message, name: error.name }),
  ]
  const forbidden = [
    SECRET_VALUE,
    KEK_A.toString('hex'),
    KEK_A.toString('base64'),
    KEK_B.toString('hex'),
    Buffer.from(SECRET_VALUE, 'utf8').toString('hex'),
    Buffer.from(SECRET_VALUE, 'utf8').toString('base64'),
  ]
  for (const surface of surfaces) {
    for (const needle of forbidden) {
      expect(surface).not.toContain(needle)
    }
  }
}

describe('local-KEK workspace KEK provider', () => {
  test('round-trips a workspace DEK through wrap/unwrap', async () => {
    const provider = kekProvider(KEK_A)
    const generated = await provider.generateDataKey(context('ws-a'))
    expect(generated.plaintextDek.byteLength).toBe(32)
    expect(generated.wrappedDek.providerId).toBe('local-kek')
    expect(generated.wrappedDek.payload.format).toBe('local-aes-256-gcm.v1')

    const unwrapped = await provider.unwrapDataKey(
      context('ws-a'),
      generated.wrappedDek,
    )
    expect(Buffer.from(unwrapped).equals(Buffer.from(generated.plaintextDek)))
      .toBe(true)
  })

  test('rejects an unwrap under a different KEK, and never falls back', async () => {
    const generated = await kekProvider(KEK_A).generateDataKey(context('ws-a'))
    const error = await expectCredentialError(
      () => kekProvider(KEK_B).unwrapDataKey(context('ws-a'), generated.wrappedDek),
      CREDENTIAL_ERROR_CODES.UNREADABLE,
    )
    expectNoSecretLeak(error)
  })

  test('rejects a wrapped DEK replayed into another workspace or generation', async () => {
    const generated = await kekProvider(KEK_A).generateDataKey(context('ws-a', 3))
    const provider = kekProvider(KEK_A)
    await expectCredentialError(
      () => provider.unwrapDataKey(context('ws-b', 3), generated.wrappedDek),
      CREDENTIAL_ERROR_CODES.UNREADABLE,
    )
    await expectCredentialError(
      () => provider.unwrapDataKey(context('ws-a', 4), generated.wrappedDek),
      CREDENTIAL_ERROR_CODES.UNREADABLE,
    )
  })

  test('rejects a wrapped DEK written by another backend', async () => {
    const foreign: WrappedWorkspaceDekV1 = {
      providerId: 'ovh-kms',
      keyRef: 'k',
      keyVersion: 1,
      payload: {
        format: 'external-kms-opaque.v1',
        payloadFormatId: 'ovh.v1',
        opaqueAuthenticatedPayload: new Uint8Array([1, 2, 3]),
      },
    }
    await expectCredentialError(
      () => kekProvider(KEK_A).unwrapDataKey(context('ws-a'), foreign),
      CREDENTIAL_ERROR_CODES.UNREADABLE,
    )
  })

  test('rewrapDataKey rotates the wrapping while preserving the DEK', async () => {
    const provider = kekProvider(KEK_A)
    const generated = await provider.generateDataKey(context('ws-a'))
    const rewrapped = await provider.rewrapDataKey!(
      context('ws-a'),
      generated.wrappedDek,
    )
    const original = generated.wrappedDek.payload
    const rotated = rewrapped.payload
    expect(original.format).toBe('local-aes-256-gcm.v1')
    expect(rotated.format).toBe('local-aes-256-gcm.v1')
    if (
      original.format !== 'local-aes-256-gcm.v1'
      || rotated.format !== 'local-aes-256-gcm.v1'
    ) throw new Error('unreachable')
    // Fresh nonce and fresh ciphertext, same underlying key.
    expect(Buffer.from(rotated.nonce).equals(Buffer.from(original.nonce)))
      .toBe(false)
    const unwrapped = await provider.unwrapDataKey(context('ws-a'), rewrapped)
    expect(Buffer.from(unwrapped).equals(Buffer.from(generated.plaintextDek)))
      .toBe(true)
  })

  test('readiness reports not-ready for a missing KEK source without throwing', async () => {
    const provider = createLocalKekWorkspaceKekProviderV1({
      keyRef: 'missing',
      keyVersion: 1,
      loadKek: createLocalKekFileSourceV1(
        join(tmpdir(), 'boring-nonexistent-kek-file-16f2'),
      ),
    })
    const readiness = await provider.readiness()
    expect(readiness.ready).toBe(false)
    expect(readiness.reasonCode).toBe('local-kek-source-unreadable')

    const error = await expectCredentialError(
      () => provider.generateDataKey(context('ws-a')),
      CREDENTIAL_ERROR_CODES.KEK_UNAVAILABLE,
    )
    expectNoSecretLeak(error)
  })

  test('readiness reports not-ready for a wrong-length KEK', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boring-kek-'))
    const path = join(dir, 'kek')
    await writeFile(path, 'too-short')
    const provider = createLocalKekWorkspaceKekProviderV1({
      keyRef: 'short',
      keyVersion: 1,
      loadKek: createLocalKekFileSourceV1(path),
    })
    const readiness = await provider.readiness()
    expect(readiness.ready).toBe(false)
    expect(readiness.reasonCode).toBe('local-kek-invalid-length')
  })

  test('reads a hex-encoded KEK file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boring-kek-'))
    const path = join(dir, 'kek.hex')
    await writeFile(path, `${KEK_A.toString('hex')}\n`)
    const provider = createLocalKekWorkspaceKekProviderV1({
      keyRef: 'hex',
      keyVersion: 1,
      loadKek: createLocalKekFileSourceV1(path),
    })
    expect((await provider.readiness()).ready).toBe(true)
    const generated = await provider.generateDataKey(context('ws-a'))
    const unwrapped = await kekProvider(KEK_A, { keyRef: 'hex' }).unwrapDataKey(
      context('ws-a'),
      generated.wrappedDek,
    )
    expect(unwrapped.byteLength).toBe(32)
  })
})

describe('local-KEK configuration resolution', () => {
  test('returns undefined when the backend is not explicitly selected', () => {
    expect(resolveLocalKekProviderConfigV1({})).toBeUndefined()
    expect(
      resolveLocalKekProviderConfigV1({ BORING_CREDENTIAL_KMS_BACKEND: 'ovh-kms' }),
    ).toBeUndefined()
  })

  test('fails closed when the selected backend has no key file', () => {
    expect(() =>
      resolveLocalKekProviderConfigV1({
        BORING_CREDENTIAL_KMS_BACKEND: 'local-kek',
      }),
    ).toThrowError(CredentialResolutionError)
  })

  test('never accepts a plaintext env key as the KEK', () => {
    const config = resolveLocalKekProviderConfigV1({
      BORING_CREDENTIAL_KMS_BACKEND: 'local-kek',
      BORING_CREDENTIAL_LOCAL_KEK_FILE: '/run/secrets/kek',
      WORKSPACE_SETTINGS_ENCRYPTION_KEY: KEK_A.toString('hex'),
    })
    expect(config).toEqual({
      backend: 'local-kek',
      keyFilePath: '/run/secrets/kek',
      keyRef: 'default',
      keyVersion: 1,
    })
  })
})

describe('credential field envelope crypto', () => {
  const dek = new Uint8Array(Buffer.alloc(32, 0x5c))
  const aad = {
    workspaceId: 'ws-a',
    credentialId: 'cred-a',
    providerId: 'provider-a',
    fieldId: 'api-key',
    credentialVersion: 1,
    dekGeneration: 1,
  } as const

  function seal(): CredentialEnvelopeV1 {
    return encryptCredentialFieldV1({
      plaintextDek: dek,
      plaintext: new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8')),
      aadContext: aad,
    })
  }

  test('round-trips a field value with a 12-byte nonce and 16-byte tag', () => {
    const envelope = seal()
    expect(envelope.nonce.byteLength).toBe(12)
    expect(envelope.authTag.byteLength).toBe(16)
    expect(Buffer.from(envelope.ciphertext).toString('utf8'))
      .not.toContain(SECRET_VALUE)
    const plaintext = decryptCredentialFieldV1({
      plaintextDek: dek,
      envelope,
      aadContext: aad,
    })
    expect(plaintext.toString('utf8')).toBe(SECRET_VALUE)
  })

  test('uses a fresh nonce for every encryption', () => {
    const nonces = new Set<string>()
    for (let index = 0; index < 32; index += 1) {
      nonces.add(Buffer.from(seal().nonce).toString('hex'))
    }
    expect(nonces.size).toBe(32)
  })

  test('AAD encoding is unambiguous across component boundaries', () => {
    const left = encodeCredentialFieldAadV1({ ...aad, workspaceId: 'a', credentialId: 'bc' })
    const right = encodeCredentialFieldAadV1({ ...aad, workspaceId: 'ab', credentialId: 'c' })
    expect(left.equals(right)).toBe(false)
  })

  test.each([
    ['ciphertext', (e: CredentialEnvelopeV1) => ({
      ...e,
      ciphertext: mutate(e.ciphertext),
    })],
    ['nonce', (e: CredentialEnvelopeV1) => ({ ...e, nonce: mutate(e.nonce) })],
    ['authTag', (e: CredentialEnvelopeV1) => ({ ...e, authTag: mutate(e.authTag) })],
    ['aadContext', (e: CredentialEnvelopeV1) => ({
      ...e,
      aadContext: mutate(e.aadContext),
    })],
  ])('fails closed when %s is tampered with', (_name, tamper) => {
    const envelope = tamper(seal()) as CredentialEnvelopeV1
    const error = expectSyncCredentialError(() =>
      decryptCredentialFieldV1({ plaintextDek: dek, envelope, aadContext: aad }),
    )
    expect(error.code).toBe(CREDENTIAL_ERROR_CODES.UNREADABLE)
    expectNoSecretLeak(error)
  })

  test.each([
    ['workspaceId', { workspaceId: 'ws-b' }],
    ['credentialId', { credentialId: 'cred-b' }],
    ['providerId', { providerId: 'provider-b' }],
    ['fieldId', { fieldId: 'other-field' }],
    ['credentialVersion', { credentialVersion: 2 }],
    ['dekGeneration', { dekGeneration: 2 }],
  ])('fails closed when the %s AAD component is swapped', (_name, patch) => {
    const envelope = seal()
    const error = expectSyncCredentialError(() =>
      decryptCredentialFieldV1({
        plaintextDek: dek,
        envelope,
        aadContext: { ...aad, ...patch },
      }),
    )
    expect(error.code).toBe(CREDENTIAL_ERROR_CODES.UNREADABLE)
    expectNoSecretLeak(error)
  })

  test('fails closed under a different DEK', () => {
    const envelope = seal()
    const error = expectSyncCredentialError(() =>
      decryptCredentialFieldV1({
        plaintextDek: new Uint8Array(Buffer.alloc(32, 0x11)),
        envelope,
        aadContext: aad,
      }),
    )
    expect(error.code).toBe(CREDENTIAL_ERROR_CODES.UNREADABLE)
  })
})

function mutate(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes)
  copy[0] = (copy[0]! ^ 0xff) & 0xff
  return copy
}

function expectSyncCredentialError(run: () => unknown): CredentialResolutionError {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(CredentialResolutionError)
  return caught as CredentialResolutionError
}

describe('vault credential store backend', () => {
  test('round-trips a credential field end to end', async () => {
    const { backend } = vaultStore()
    const record = await backend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8'))],
      ]),
    })
    expect(record.credentialVersion).toBe(1)

    const resolved = await backend.read('ws-a', PROVIDER_A, [FIELD_API_KEY])
    expect(resolved.credentialVersion).toBe(1)
    if (resolved.kind !== 'field-set') throw new Error('expected field-set')
    expect(Buffer.from(resolved.fields.get(FIELD_API_KEY)!).toString('utf8'))
      .toBe(SECRET_VALUE)
  })

  test('persists ciphertext only, never plaintext', async () => {
    const { backend, persistence } = vaultStore()
    const record = await backend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8'))],
      ]),
    })
    const stored = await persistence.getField({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      credentialVersion: record.credentialVersion,
      fieldId: FIELD_API_KEY,
    })
    const blob = JSON.stringify(stored)
    expect(blob).not.toContain(SECRET_VALUE)
    expect(Buffer.from(stored!.ciphertext).toString('latin1'))
      .not.toContain(SECRET_VALUE)
  })

  test('fails closed when the credential is not configured', async () => {
    const { backend } = vaultStore()
    await expectCredentialError(
      () => backend.read('ws-a', PROVIDER_A, [FIELD_API_KEY]),
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    )
  })

  test('fails closed when the KEK backend is not ready', async () => {
    const backend = createVaultCredentialStoreBackendV1({
      kmsBackend: createLocalKekWorkspaceKekProviderV1({
        keyRef: 'missing',
        keyVersion: 1,
        loadKek: createLocalKekFileSourceV1('/nonexistent/boring-16f2-kek'),
      }),
      persistence: createInMemoryCredentialVaultPersistenceV1(),
    })
    const error = await expectCredentialError(
      () => backend.read('ws-a', PROVIDER_A, [FIELD_API_KEY]),
      CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    )
    expectNoSecretLeak(error)
  })

  test('fails closed when the stored envelope was wrapped under another KEK', async () => {
    const persistence = createInMemoryCredentialVaultPersistenceV1()
    const { backend: writer } = vaultStore(KEK_A, persistence)
    await writer.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8'))],
      ]),
    })
    const { backend: attacker } = vaultStore(KEK_B, persistence)
    const error = await expectCredentialError(
      () => attacker.read('ws-a', PROVIDER_A, [FIELD_API_KEY]),
      CREDENTIAL_ERROR_CODES.UNREADABLE,
    )
    expectNoSecretLeak(error)
  })

  test('workspace B cannot read a copy of workspace A envelope material', async () => {
    const persistence = createInMemoryCredentialVaultPersistenceV1()
    const { backend } = vaultStore(KEK_A, persistence)
    const recordA = await backend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8'))],
      ]),
    })
    // Copy every stored artifact of A verbatim into B's identity.
    const dekA = await persistence.getWrappedDek('ws-a', recordA.dekGeneration)
    const fieldA = await persistence.getField({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      credentialVersion: recordA.credentialVersion,
      fieldId: FIELD_API_KEY,
    })
    await persistence.putWrappedDek('ws-b', recordA.dekGeneration, dekA!)
    await persistence.putField(
      {
        workspaceId: 'ws-b',
        providerId: PROVIDER_A,
        credentialVersion: recordA.credentialVersion,
        fieldId: FIELD_API_KEY,
      },
      fieldA!,
    )
    await persistence.putCredentialRecord('ws-b', PROVIDER_A, recordA)

    const error = await expectCredentialError(
      () => backend.read('ws-b', PROVIDER_A, [FIELD_API_KEY]),
      // Authentication failure, not a masked "not configured" bypass.
      CREDENTIAL_ERROR_CODES.UNREADABLE,
    )
    expectNoSecretLeak(error)
  })

  test('a rewrapped workspace DEK still decrypts existing fields', async () => {
    const { backend } = vaultStore()
    const record = await backend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8'))],
      ]),
    })
    await backend.rewrapWorkspaceDek('ws-a', record.dekGeneration)
    const resolved = await backend.read('ws-a', PROVIDER_A, [FIELD_API_KEY])
    if (resolved.kind !== 'field-set') throw new Error('expected field-set')
    expect(Buffer.from(resolved.fields.get(FIELD_API_KEY)!).toString('utf8'))
      .toBe(SECRET_VALUE)
  })

  test('an older credential version cannot be read at the new version identity', async () => {
    const { backend, persistence } = vaultStore()
    await backend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from('old-value', 'utf8'))],
      ]),
    })
    const second = await backend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8'))],
      ]),
    })
    expect(second.credentialVersion).toBe(2)
    // Splice v1 ciphertext under the v2 key: AAD version binding rejects it.
    const v1 = await persistence.getField({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      credentialVersion: 1,
      fieldId: FIELD_API_KEY,
    })
    await persistence.putField(
      {
        workspaceId: 'ws-a',
        providerId: PROVIDER_A,
        credentialVersion: 2,
        fieldId: FIELD_API_KEY,
      },
      v1!,
    )
    await expectCredentialError(
      () => backend.read('ws-a', PROVIDER_A, [FIELD_API_KEY]),
      CREDENTIAL_ERROR_CODES.UNREADABLE,
    )
  })
})

describe('frozen credential contract, constructed end to end', () => {
  function scope(): AuthorizedWorkspaceCredentialScopeV1 {
    return Object.freeze({
      contractVersion: 'boring.authorized-workspace-credential-scope.v1',
    }) as unknown as AuthorizedWorkspaceCredentialScopeV1
  }

  function authority(workspaceId: string): VerifiedWorkspaceCredentialAuthorityV1 {
    return {
      workspaceId,
      appId: 'app-a',
      principal: { kind: 'user', userId: 'user-a', membershipRole: 'owner' },
      authorizationReceiptId: 'receipt-a',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }
  }

  const providers: readonly ProviderDefinitionV1[] = [
    {
      contractVersion: 'boring.provider.v1',
      id: PROVIDER_A,
      displayName: 'Provider A',
      category: 'search',
      credential: {
        type: 'api-key',
        fields: [
          {
            id: FIELD_API_KEY,
            label: 'API key',
            required: true,
            sensitivity: 'secret',
            maxBytes: 4_096,
          },
        ],
      },
      consumerBindingIds: [bindingId('binding-a')],
      sandboxEgressOrigins: ['https://api.provider-a.test'],
    },
  ]

  async function harness(workspaceIds: readonly string[]) {
    const persistence = createInMemoryCredentialVaultPersistenceV1()
    const { backend } = vaultStore(KEK_A, persistence)
    const scopes = new Map<string, AuthorizedWorkspaceCredentialScopeV1>()
    const grants = workspaceIds.map((workspaceId) => {
      const workspaceScope = scope()
      scopes.set(workspaceId, workspaceScope)
      return { scope: workspaceScope, authority: authority(workspaceId) }
    })
    const providerRegistry = createProviderRegistryV1(providers)
    const bindingRegistry = createCredentialConsumerBindingRegistryV1(
      [
        {
          contractVersion: 'boring.credential-consumer-binding.v1',
          id: bindingId('binding-a'),
          providerId: PROVIDER_A,
          consumer: {
            id: 'provider-a-search-tool',
            kind: 'first-party-tool',
            trust: 'trusted',
          },
          purpose: 'Search calls made by the host-side first-party tool',
          allowedFieldIds: [FIELD_API_KEY],
          delivery: 'host-only',
        },
      ],
      providerRegistry,
    )
    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: createFakeAuthorityVerifierV1(grants),
      bindingRegistry,
      providerRegistry,
      backend,
    })
    const refFactory = createProviderCredentialRefFactoryV1(bindingRegistry)
    return { backend, persistence, resolver, refFactory, scopes }
  }

  test('resolves a vault-backed credential through the full frozen contract', async () => {
    const { backend, resolver, refFactory, scopes } = await harness(['ws-a'])
    await backend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8'))],
      ]),
    })
    const ref = refFactory.create({
      providerId: PROVIDER_A,
      executionId: 'exec-1',
      bindingId: bindingId('binding-a'),
    })

    const seen = await withResolvedCredential(
      resolver,
      scopes.get('ws-a')!,
      ref,
      async (lease) => {
        expect(lease.workspaceId).toBe('ws-a')
        expect(lease.credentialVersion).toBe(1)
        const material = lease.material
        if (material.kind !== 'field-set') throw new Error('expected field-set')
        return Buffer.from(material.fields.get(FIELD_API_KEY)!).toString('utf8')
      },
    )
    expect(seen).toBe(SECRET_VALUE)
  })

  test('another workspace resolving the same binding fails closed', async () => {
    const { backend, resolver, refFactory, scopes } = await harness(['ws-a', 'ws-b'])
    await backend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: PROVIDER_A,
      fields: new Map([
        [FIELD_API_KEY, new Uint8Array(Buffer.from(SECRET_VALUE, 'utf8'))],
      ]),
    })
    const ref = refFactory.create({
      providerId: PROVIDER_A,
      executionId: 'exec-1',
      bindingId: bindingId('binding-a'),
    })
    const error = await expectCredentialError(
      () => resolver.resolve(scopes.get('ws-b')!, ref),
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    )
    expectNoSecretLeak(error)
  })
})
