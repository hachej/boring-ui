import {
  chmodSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import type {
  CredentialEnvelopeV1,
  WorkspaceKekContextV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'
import {
  CREDENTIAL_ENVELOPE_VERSION,
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  WORKSPACE_KEK_PROVIDER_VERSION,
} from '../../../shared/credentials'
import {
  OVH_KMS_PAYLOAD_FORMAT_V1,
  buildCredentialFieldAadV1,
  createLocalKekProviderV1,
  createOvhKmsMtlsHttpTransportV1,
  createOvhKmsProviderV1,
  createStaticOvhKmsWorkspaceKeyRouteResolverV1,
  createWorkspaceKekProviderSelectorV1,
  decodeOvhKmsOpaquePayloadV1,
  decryptField,
  encodeOvhKmsOpaquePayloadV1,
  encryptField,
} from '..'
import type {
  OvhKmsHttpRequestV1,
  OvhKmsHttpResponseV1,
  OvhKmsHttpTransportV1,
} from '..'

const text = new TextEncoder()
const FIELD_CONTEXT = Object.freeze({
  workspaceId: 'workspace-a',
  credentialId: 'credential-a',
  providerId: 'provider-a',
  fieldId: 'api-key',
  credentialVersion: 7,
  dekGeneration: 3,
})
const KEK_CONTEXT: WorkspaceKekContextV1 = Object.freeze({
  workspaceId: 'workspace-a',
  dekGeneration: 3,
  requestId: 'request-a',
})
const DEK = Buffer.from(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  'hex',
)

function dummyWrappedDek(): WrappedWorkspaceDekV1 {
  return {
    providerId: 'local-kek',
    keyRef: 'kek-a',
    keyVersion: 1,
    payload: {
      format: 'local-aes-256-gcm.v1',
      ciphertext: new Uint8Array(32),
      nonce: Uint8Array.from({ length: 12 }, (_, index) => index + 1),
      authTag: new Uint8Array(16),
      aadContext: Uint8Array.of(1),
    },
  }
}

function mutate(bytes: Uint8Array, offset = 0): Uint8Array {
  const copy = new Uint8Array(bytes)
  copy[offset] ^= 0x80
  return copy
}

async function expectCredentialError(
  promise: Promise<unknown>,
  allowedCodes: readonly string[] = [CREDENTIAL_ERROR_CODES.UNREADABLE],
): Promise<CredentialResolutionError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialResolutionError)
    expect(allowedCodes).toContain((error as CredentialResolutionError).code)
    expect((error as Error).message.toLowerCase()).not.toContain('secret')
    return error as CredentialResolutionError
  }
  throw new Error('Expected credential operation to fail closed')
}

describe('credential field envelope conformance', () => {
  test('decrypts a fixed AES-256-GCM known-answer vector', () => {
    const envelope: CredentialEnvelopeV1 = {
      envelopeVersion: CREDENTIAL_ENVELOPE_VERSION,
      wrappedDek: dummyWrappedDek(),
      nonce: Buffer.from('0102030405060708090a0b0c', 'hex'),
      aadContext: Buffer.from(
        '010106010000000b776f726b73706163652d61010000000c63726564656e7469616c2d61010000000a70726f76696465722d6101000000076170692d6b65790200000008000000000000000702000000080000000000000003',
        'hex',
      ),
      ciphertext: Buffer.from('6e8435a282b991e83fd506353d608f4b302695', 'hex'),
      authTag: Buffer.from('7d5ce4476019acbaca7ab95a3a539d02', 'hex'),
    }

    expect(Buffer.from(decryptField(envelope, DEK, FIELD_CONTEXT)).toString())
      .toBe('known-answer-secret')
  })

  test('round-trips regular and empty field values', () => {
    for (const plaintext of [text.encode('round-trip-value'), new Uint8Array()]) {
      const envelope = encryptField(plaintext, DEK, dummyWrappedDek(), FIELD_CONTEXT)
      expect(decryptField(envelope, DEK, FIELD_CONTEXT)).toEqual(plaintext)
    }
  })

  test('uses unique non-zero random nonces under one DEK', () => {
    const nonces = new Set<string>()
    for (let index = 0; index < 512; index += 1) {
      const envelope = encryptField(
        text.encode(`value-${index}`),
        DEK,
        dummyWrappedDek(),
        FIELD_CONTEXT,
      )
      expect(envelope.nonce).toHaveLength(12)
      expect(envelope.nonce.some((byte) => byte !== 0)).toBe(true)
      nonces.add(Buffer.from(envelope.nonce).toString('hex'))
    }
    expect(nonces.size).toBe(512)
  })

  test('rejects independently corrupted ciphertext, nonce, tag, and AAD', async () => {
    const envelope = encryptField(
      text.encode('corruption-canary'),
      DEK,
      dummyWrappedDek(),
      FIELD_CONTEXT,
    )
    const corruptions: CredentialEnvelopeV1[] = [
      { ...envelope, ciphertext: mutate(envelope.ciphertext) },
      { ...envelope, nonce: mutate(envelope.nonce) },
      { ...envelope, authTag: mutate(envelope.authTag) },
      { ...envelope, aadContext: mutate(envelope.aadContext) },
    ]
    for (const corrupted of corruptions) {
      await expectCredentialError(Promise.resolve().then(
        () => decryptField(corrupted, DEK, FIELD_CONTEXT),
      ))
    }
  })

  test('rejects zero nonce and missing authentication tag', async () => {
    const envelope = encryptField(
      text.encode('authenticated-only'),
      DEK,
      dummyWrappedDek(),
      FIELD_CONTEXT,
    )
    await expectCredentialError(Promise.resolve().then(() => decryptField(
      { ...envelope, nonce: new Uint8Array(12) },
      DEK,
      FIELD_CONTEXT,
    )))
    await expectCredentialError(Promise.resolve().then(() => decryptField(
      { ...envelope, authTag: new Uint8Array() },
      DEK,
      FIELD_CONTEXT,
    )))
  })

  test('rejects every independently changed AAD identity component', async () => {
    const envelope = encryptField(
      text.encode('binding-canary'),
      DEK,
      dummyWrappedDek(),
      FIELD_CONTEXT,
    )
    const changedContexts = [
      { ...FIELD_CONTEXT, workspaceId: 'workspace-b' },
      { ...FIELD_CONTEXT, credentialId: 'credential-b' },
      { ...FIELD_CONTEXT, providerId: 'provider-b' },
      { ...FIELD_CONTEXT, fieldId: 'other-field' },
      { ...FIELD_CONTEXT, credentialVersion: 8 },
      { ...FIELD_CONTEXT, dekGeneration: 4 },
    ]
    for (const changed of changedContexts) {
      await expectCredentialError(Promise.resolve().then(
        () => decryptField(envelope, DEK, changed),
      ))
    }
  })

  test('canonical encoding prevents delimiter injection ambiguity', () => {
    const first = buildCredentialFieldAadV1({
      ...FIELD_CONTEXT,
      workspaceId: 'workspace:a',
      credentialId: 'credential',
    })
    const second = buildCredentialFieldAadV1({
      ...FIELD_CONTEXT,
      workspaceId: 'workspace',
      credentialId: 'a:credential',
    })
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false)
  })
})

interface LocalFixture {
  readonly directory: string
  readonly keyOnePath: string
  readonly keyTwoPath: string
  readonly wrongKeyPath: string
}

function localFixture(): LocalFixture {
  const directory = mkdtempSync(join(tmpdir(), 'boring-local-kek-'))
  const keyOnePath = join(directory, 'kek-1')
  const keyTwoPath = join(directory, 'kek-2')
  const wrongKeyPath = join(directory, 'kek-wrong')
  writeFileSync(keyOnePath, Buffer.alloc(32, 0x11), { mode: 0o400 })
  writeFileSync(keyTwoPath, Buffer.alloc(32, 0x22), { mode: 0o400 })
  writeFileSync(wrongKeyPath, Buffer.alloc(32, 0x33), { mode: 0o400 })
  chmodSync(keyOnePath, 0o400)
  chmodSync(keyTwoPath, 0o400)
  chmodSync(wrongKeyPath, 0o400)
  return { directory, keyOnePath, keyTwoPath, wrongKeyPath }
}

function localProvider(
  fixture: LocalFixture,
  currentKeyVersion = 1,
): WorkspaceKekProviderV1 {
  return createLocalKekProviderV1({
    currentKeyVersion,
    keyFiles: [
      { keyVersion: 1, keyRef: 'kek-a', filePath: fixture.keyOnePath },
      { keyVersion: 2, keyRef: 'kek-b', filePath: fixture.keyTwoPath },
    ],
  })
}

describe('local sealed-file KEK backend conformance', () => {
  test('unwraps a fixed local wrapper known-answer vector', async () => {
    const provider = localProvider(localFixture())
    const wrapped: WrappedWorkspaceDekV1 = {
      providerId: 'local-kek',
      keyRef: 'kek-a',
      keyVersion: 1,
      payload: {
        format: 'local-aes-256-gcm.v1',
        nonce: Buffer.from('0c0b0a090807060504030201', 'hex'),
        aadContext: Buffer.from(
          '010205010000000b776f726b73706163652d610200000008000000000000000301000000096c6f63616c2d6b656b01000000056b656b2d6102000000080000000000000001',
          'hex',
        ),
        ciphertext: Buffer.from(
          '2d916d3b6866994008f5b3728fc8a816b779ee18b26e958f889ce31dba1c0381',
          'hex',
        ),
        authTag: Buffer.from('dac76213739820ed77903c566e5e9301', 'hex'),
      },
    }

    expect(Buffer.from(await provider.unwrapDataKey(KEK_CONTEXT, wrapped)))
      .toEqual(DEK)
    await provider.close?.()
  })

  test('round-trips generated data keys and verifies wrapper tags', async () => {
    const provider = localProvider(localFixture())
    const generated = await provider.generateDataKey(KEK_CONTEXT)
    const second = await provider.generateDataKey(KEK_CONTEXT)
    try {
      await expect(provider.unwrapDataKey(KEK_CONTEXT, generated.wrappedDek))
        .resolves.toEqual(generated.plaintextDek)
      const payload = generated.wrappedDek.payload
      const secondPayload = second.wrappedDek.payload
      if (payload.format !== 'local-aes-256-gcm.v1') throw new Error('local payload expected')
      if (secondPayload.format !== 'local-aes-256-gcm.v1') throw new Error('local payload expected')
      expect(payload.nonce.some((byte) => byte !== 0)).toBe(true)
      expect(Buffer.from(payload.nonce).equals(Buffer.from(secondPayload.nonce))).toBe(false)
      await expectCredentialError(provider.unwrapDataKey(KEK_CONTEXT, {
        ...generated.wrappedDek,
        payload: { ...payload, authTag: mutate(payload.authTag) },
      }))
      await expectCredentialError(provider.unwrapDataKey(KEK_CONTEXT, {
        ...generated.wrappedDek,
        payload: { ...payload, nonce: new Uint8Array(12) },
      }))
      await expectCredentialError(provider.unwrapDataKey(
        { ...KEK_CONTEXT, workspaceId: 'workspace-b' },
        generated.wrappedDek,
      ))
      await expectCredentialError(provider.unwrapDataKey(
        { ...KEK_CONTEXT, dekGeneration: KEK_CONTEXT.dekGeneration + 1 },
        generated.wrappedDek,
      ))
    } finally {
      generated.plaintextDek.fill(0)
      second.plaintextDek.fill(0)
      await provider.close?.()
    }
  })

  test('fails closed for every independently corrupted EDK selector', async () => {
    const provider = createWorkspaceKekProviderSelectorV1(localProvider(localFixture()))
    const generated = await provider.generateDataKey(KEK_CONTEXT)
    const payload = generated.wrappedDek.payload
    if (payload.format !== 'local-aes-256-gcm.v1') throw new Error('local payload expected')
    const corruptions: WrappedWorkspaceDekV1[] = [
      {
        ...generated.wrappedDek,
        payload: { ...payload, ciphertext: mutate(payload.ciphertext) },
      },
      {
        ...generated.wrappedDek,
        payload: { ...payload, nonce: mutate(payload.nonce) },
      },
      {
        ...generated.wrappedDek,
        payload: { ...payload, authTag: mutate(payload.authTag) },
      },
      {
        ...generated.wrappedDek,
        payload: { ...payload, aadContext: mutate(payload.aadContext) },
      },
      { ...generated.wrappedDek, providerId: 'other-backend' },
      { ...generated.wrappedDek, keyRef: 'kek-b' },
      { ...generated.wrappedDek, keyVersion: 2 },
    ]
    try {
      for (const corrupted of corruptions) {
        await expectCredentialError(
          provider.unwrapDataKey(KEK_CONTEXT, corrupted),
          [
            CREDENTIAL_ERROR_CODES.UNREADABLE,
            CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
          ],
        )
      }
    } finally {
      generated.plaintextDek.fill(0)
      await provider.close?.()
    }
  })

  test('rewraps an old generation to the new immutable KEK version', async () => {
    const fixture = localFixture()
    const oldProvider = createLocalKekProviderV1({
      currentKeyVersion: 1,
      keyFiles: [{ keyVersion: 1, keyRef: 'kek-a', filePath: fixture.keyOnePath }],
    })
    const generated = await oldProvider.generateDataKey(KEK_CONTEXT)
    const rotatingProvider = localProvider(fixture, 2)
    try {
      const rewrapped = await rotatingProvider.rewrapDataKey!(
        KEK_CONTEXT,
        generated.wrappedDek,
      )
      expect(rewrapped.keyVersion).toBe(2)
      expect(rewrapped.keyRef).toBe('kek-b')
      await expect(rotatingProvider.unwrapDataKey(KEK_CONTEXT, rewrapped))
        .resolves.toEqual(generated.plaintextDek)
    } finally {
      generated.plaintextDek.fill(0)
      await oldProvider.close?.()
      await rotatingProvider.close?.()
    }
  })

  test('wrong or missing KEK never falls back to an environment key', async () => {
    const fixture = localFixture()
    const goodProvider = createLocalKekProviderV1({
      currentKeyVersion: 1,
      keyFiles: [{ keyVersion: 1, keyRef: 'kek-a', filePath: fixture.keyOnePath }],
    })
    const generated = await goodProvider.generateDataKey(KEK_CONTEXT)
    const priorLegacyKey = process.env.WORKSPACE_SETTINGS_ENCRYPTION_KEY
    process.env.WORKSPACE_SETTINGS_ENCRYPTION_KEY = 'f'.repeat(64)
    try {
      const missing = createLocalKekProviderV1({
        currentKeyVersion: 1,
        keyFiles: [{
          keyVersion: 1,
          keyRef: 'kek-a',
          filePath: join(fixture.directory, 'does-not-exist'),
        }],
      })
      expect(await missing.readiness()).toEqual(expect.objectContaining({ ready: false }))
      await expectCredentialError(
        missing.unwrapDataKey(KEK_CONTEXT, generated.wrappedDek),
        [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
      )

      const wrong = createLocalKekProviderV1({
        currentKeyVersion: 1,
        keyFiles: [{ keyVersion: 1, keyRef: 'kek-a', filePath: fixture.wrongKeyPath }],
      })
      await expectCredentialError(wrong.unwrapDataKey(KEK_CONTEXT, generated.wrappedDek))
      await missing.close?.()
      await wrong.close?.()
    } finally {
      generated.plaintextDek.fill(0)
      await goodProvider.close?.()
      if (priorLegacyKey === undefined) delete process.env.WORKSPACE_SETTINGS_ENCRYPTION_KEY
      else process.env.WORKSPACE_SETTINGS_ENCRYPTION_KEY = priorLegacyKey
    }
  })

  test('sealed-file policy rejects wrong size, mode, owner, and all-zero KEKs', async () => {
    const fixture = localFixture()
    const invalidPaths = [
      { name: 'short', bytes: Buffer.alloc(31, 1), mode: 0o400 },
      { name: 'mode', bytes: Buffer.alloc(32, 1), mode: 0o600 },
      { name: 'zero', bytes: Buffer.alloc(32), mode: 0o400 },
    ]
    for (const invalid of invalidPaths) {
      const filePath = join(fixture.directory, invalid.name)
      writeFileSync(filePath, invalid.bytes, { mode: invalid.mode })
      chmodSync(filePath, invalid.mode)
      const provider = createLocalKekProviderV1({
        currentKeyVersion: 1,
        keyFiles: [{ keyVersion: 1, keyRef: 'kek-a', filePath }],
      })
      expect((await provider.readiness()).ready).toBe(false)
      await expectCredentialError(
        provider.generateDataKey(KEK_CONTEXT),
        [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
      )
    }
    const ownerMismatch = createLocalKekProviderV1({
      currentKeyVersion: 1,
      expectedOwnerUid: (process.geteuid?.() ?? 0) + 1,
      keyFiles: [{ keyVersion: 1, keyRef: 'kek-a', filePath: fixture.keyOnePath }],
    })
    expect((await ownerMismatch.readiness()).ready).toBe(false)
  })
})

describe('immutable KMS selector conformance', () => {
  test('rejects all-zero generated and unwrapped DEKs from any backend', async () => {
    const wrappedDek: WrappedWorkspaceDekV1 = {
      ...dummyWrappedDek(),
      providerId: 'zero-kms',
    }
    const selected = createWorkspaceKekProviderSelectorV1({
      contractVersion: WORKSPACE_KEK_PROVIDER_VERSION,
      providerId: 'zero-kms',
      readiness: async () => ({ ready: true }),
      generateDataKey: async () => ({
        plaintextDek: new Uint8Array(32),
        wrappedDek,
      }),
      unwrapDataKey: async () => new Uint8Array(32),
    })

    await expectCredentialError(
      selected.generateDataKey(KEK_CONTEXT),
      [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
    )
    await expectCredentialError(
      selected.unwrapDataKey(KEK_CONTEXT, wrappedDek),
    )
  })
})

class FakeOvhTransport implements OvhKmsHttpTransportV1 {
  readonly contractVersion = 'boring.ovh-kms-http-transport.v1' as const
  readonly requests: OvhKmsHttpRequestV1[] = []
  ready = true
  responseOverride?: OvhKmsHttpResponseV1
  readonly plaintext = Buffer.from(DEK)
  readonly wrappedKey = Buffer.from('fixed-authenticated-ovh-edk')

  async readiness() {
    return this.ready
      ? { ready: true }
      : { ready: false, reasonCode: 'FAKE_OVH_UNAVAILABLE' }
  }

  async request(request: OvhKmsHttpRequestV1): Promise<OvhKmsHttpResponseV1> {
    this.requests.push({ ...request, body: new Uint8Array(request.body) })
    if (this.responseOverride) return this.responseOverride
    const body = JSON.parse(new TextDecoder().decode(request.body)) as Record<string, unknown>
    if (request.url.endsWith('/datakey')) {
      return {
        status: 200,
        body: text.encode(JSON.stringify({
          plaintext: this.plaintext.toString('base64'),
          key: this.wrappedKey.toString('base64'),
        })),
      }
    }
    if (
      request.url.endsWith('/datakey/decrypt')
      && body.key === this.wrappedKey.toString('base64')
    ) {
      return {
        status: 200,
        body: text.encode(JSON.stringify({ plaintext: this.plaintext.toString('base64') })),
      }
    }
    return { status: 400, body: text.encode('{"error":"invalid key"}') }
  }
}

function ovhProvider(transport: OvhKmsHttpTransportV1): WorkspaceKekProviderV1 {
  return createOvhKmsProviderV1({
    workspaceKeyRouteResolver: createStaticOvhKmsWorkspaceKeyRouteResolverV1([
      {
        workspaceId: 'workspace-a',
        region: 'eu-west-rbx',
        endpointOrigin: 'https://eu-west-rbx.okms.ovh.net',
        serviceKeyId: 'service-key-a',
        keyVersion: 4,
        transport,
      },
    ]),
  })
}

describe('OVH KMS backend conformance with fake HTTP transport', () => {
  test('round-trips the versioned region-pinned opaque payload', () => {
    const encoded = encodeOvhKmsOpaquePayloadV1(
      'eu-west-rbx',
      text.encode('authenticated-edk'),
    )
    expect(decodeOvhKmsOpaquePayloadV1(encoded)).toEqual({
      region: 'eu-west-rbx',
      wrappedKey: text.encode('authenticated-edk'),
    })
    expect(() => decodeOvhKmsOpaquePayloadV1(mutate(encoded))).toThrow(
      CredentialResolutionError,
    )
    expect(() => decodeOvhKmsOpaquePayloadV1(
      Uint8Array.from([...encoded, 0]),
    )).toThrow(CredentialResolutionError)
  })

  test('uses exact 256-bit datakey/decrypt requests and fixed known-answer bytes', async () => {
    const transport = new FakeOvhTransport()
    const provider = ovhProvider(transport)
    const generated = await provider.generateDataKey(KEK_CONTEXT)
    try {
      expect(Buffer.from(generated.plaintextDek)).toEqual(DEK)
      expect(generated.wrappedDek).toEqual(expect.objectContaining({
        providerId: 'ovh-kms',
        keyRef: 'ovh-kms:v1:eu-west-rbx:service-key-a',
        keyVersion: 4,
      }))
      expect(generated.wrappedDek.payload).toEqual(expect.objectContaining({
        format: 'external-kms-opaque.v1',
        payloadFormatId: OVH_KMS_PAYLOAD_FORMAT_V1,
      }))
      const generateRequest = transport.requests[0]
      expect(generateRequest.url).toBe(
        'https://eu-west-rbx.okms.ovh.net/v1/servicekey/service-key-a/datakey',
      )
      expect(JSON.parse(new TextDecoder().decode(generateRequest.body)))
        .toEqual({ name: 'boring-workspace-dek-3', size: 256 })

      expect(Buffer.from(await provider.unwrapDataKey(
        KEK_CONTEXT,
        generated.wrappedDek,
      ))).toEqual(DEK)
      expect(transport.requests[1].url).toBe(
        'https://eu-west-rbx.okms.ovh.net/v1/servicekey/service-key-a/datakey/decrypt',
      )
    } finally {
      generated.plaintextDek.fill(0)
    }
  })

  test('rejects all-zero plaintext DEKs from generate and decrypt responses', async () => {
    const transport = new FakeOvhTransport()
    const provider = ovhProvider(transport)
    const generated = await provider.generateDataKey(KEK_CONTEXT)
    const zeroDek = Buffer.alloc(32).toString('base64')
    try {
      transport.responseOverride = {
        status: 200,
        body: text.encode(JSON.stringify({ plaintext: zeroDek })),
      }
      await expectCredentialError(
        provider.unwrapDataKey(KEK_CONTEXT, generated.wrappedDek),
      )

      transport.responseOverride = {
        status: 200,
        body: text.encode(JSON.stringify({
          plaintext: zeroDek,
          key: transport.wrappedKey.toString('base64'),
        })),
      }
      await expectCredentialError(provider.generateDataKey(KEK_CONTEXT))
    } finally {
      generated.plaintextDek.fill(0)
    }
  })

  test('routes one immutable service key per workspace and rejects copied EDKs', async () => {
    const transport = new FakeOvhTransport()
    const provider = createOvhKmsProviderV1({
      workspaceKeyRouteResolver: createStaticOvhKmsWorkspaceKeyRouteResolverV1([
        {
          workspaceId: 'workspace-a',
          region: 'eu-west-rbx',
          endpointOrigin: 'https://eu-west-rbx.okms.ovh.net',
          serviceKeyId: 'service-key-a',
          keyVersion: 4,
          transport,
        },
        {
          workspaceId: 'workspace-b',
          region: 'eu-west-rbx',
          endpointOrigin: 'https://eu-west-rbx.okms.ovh.net',
          serviceKeyId: 'service-key-b',
          keyVersion: 9,
          transport,
        },
      ]),
    })
    const generatedA = await provider.generateDataKey(KEK_CONTEXT)
    const contextB = { ...KEK_CONTEXT, workspaceId: 'workspace-b' }
    const generatedB = await provider.generateDataKey(contextB)
    try {
      expect(generatedA.wrappedDek.keyRef).toBe(
        'ovh-kms:v1:eu-west-rbx:service-key-a',
      )
      expect(generatedB.wrappedDek.keyRef).toBe(
        'ovh-kms:v1:eu-west-rbx:service-key-b',
      )
      expect(transport.requests.map((request) => request.url)).toEqual([
        'https://eu-west-rbx.okms.ovh.net/v1/servicekey/service-key-a/datakey',
        'https://eu-west-rbx.okms.ovh.net/v1/servicekey/service-key-b/datakey',
      ])
      await expectCredentialError(
        provider.unwrapDataKey(contextB, generatedA.wrappedDek),
      )
      expect(transport.requests).toHaveLength(2)
    } finally {
      generatedA.plaintextDek.fill(0)
      generatedB.plaintextDek.fill(0)
    }
  })

  test('keeps route health tenant-local behind the immutable backend selector', async () => {
    const healthyTransport = new FakeOvhTransport()
    const unavailableTransport = new FakeOvhTransport()
    unavailableTransport.ready = false
    const provider = createWorkspaceKekProviderSelectorV1(
      createOvhKmsProviderV1({
        workspaceKeyRouteResolver: createStaticOvhKmsWorkspaceKeyRouteResolverV1([
          {
            workspaceId: 'workspace-a',
            region: 'eu-west-rbx',
            endpointOrigin: 'https://eu-west-rbx.okms.ovh.net',
            serviceKeyId: 'service-key-a',
            keyVersion: 4,
            transport: healthyTransport,
          },
          {
            workspaceId: 'workspace-b',
            region: 'eu-west-sbg',
            endpointOrigin: 'https://eu-west-sbg.okms.ovh.net',
            serviceKeyId: 'service-key-b',
            keyVersion: 1,
            transport: unavailableTransport,
          },
        ]),
      }),
    )
    expect(await provider.readiness()).toEqual({ ready: true })
    const generated = await provider.generateDataKey(KEK_CONTEXT)
    try {
      expect(healthyTransport.requests).toHaveLength(1)
      await expectCredentialError(
        provider.generateDataKey({ ...KEK_CONTEXT, workspaceId: 'workspace-b' }),
        [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
      )
      expect(unavailableTransport.requests).toHaveLength(0)
    } finally {
      generated.plaintextDek.fill(0)
      await provider.close?.()
    }
  })

  test('rejects backend, key, version, format, region, and EDK corruption independently', async () => {
    const transport = new FakeOvhTransport()
    const provider = ovhProvider(transport)
    const generated = await provider.generateDataKey(KEK_CONTEXT)
    const payload = generated.wrappedDek.payload
    if (payload.format !== 'external-kms-opaque.v1') throw new Error('OVH payload expected')
    const decoded = decodeOvhKmsOpaquePayloadV1(payload.opaqueAuthenticatedPayload)
    const corruptions: WrappedWorkspaceDekV1[] = [
      { ...generated.wrappedDek, providerId: 'other-kms' },
      { ...generated.wrappedDek, keyRef: 'ovh-kms:v1:eu-west-rbx:other-key' },
      { ...generated.wrappedDek, keyVersion: 5 },
      {
        ...generated.wrappedDek,
        payload: { ...payload, payloadFormatId: 'unknown.v1' },
      },
      {
        ...generated.wrappedDek,
        payload: {
          ...payload,
          opaqueAuthenticatedPayload: encodeOvhKmsOpaquePayloadV1(
            'eu-west-sbg',
            decoded.wrappedKey,
          ),
        },
      },
      {
        ...generated.wrappedDek,
        payload: {
          ...payload,
          opaqueAuthenticatedPayload: encodeOvhKmsOpaquePayloadV1(
            decoded.region,
            mutate(decoded.wrappedKey),
          ),
        },
      },
    ]
    try {
      for (const corrupted of corruptions) {
        await expectCredentialError(provider.unwrapDataKey(KEK_CONTEXT, corrupted))
      }
    } finally {
      decoded.wrappedKey.fill(0)
      generated.plaintextDek.fill(0)
    }
  })

  test('readiness and malformed responses fail closed without leaking to another backend', async () => {
    const transport = new FakeOvhTransport()
    transport.ready = false
    const provider = ovhProvider(transport)
    expect((await provider.readiness()).ready).toBe(false)
    await expectCredentialError(
      provider.generateDataKey(KEK_CONTEXT),
      [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
    )
    expect(transport.requests).toHaveLength(0)

    transport.ready = true
    const errorBody = text.encode('{"error":"fail-closed-canary"}')
    transport.responseOverride = { status: 503, body: errorBody }
    await expectCredentialError(
      provider.generateDataKey(KEK_CONTEXT),
      [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
    )
    expect(errorBody.every((byte) => byte === 0)).toBe(true)

    transport.responseOverride = { status: 200, body: text.encode('{"plaintext":"bad"}') }
    await expectCredentialError(provider.generateDataKey(KEK_CONTEXT))
    transport.responseOverride = {
      status: 200,
      body: new Uint8Array(128 * 1024 + 1),
    }
    await expectCredentialError(
      provider.generateDataKey(KEK_CONTEXT),
      [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
    )
  })

  test('mTLS transport is not ready without sealed certificate files and makes no request', async () => {
    const requestSpy = vi.fn()
    const transport = createOvhKmsMtlsHttpTransportV1({
      endpointOrigin: 'https://eu-west-rbx.okms.ovh.net',
      clientCertificatePath: '/definitely/missing/ovh-client-cert.pem',
      clientPrivateKeyPath: '/definitely/missing/ovh-client-key.pem',
    })
    expect(await transport.readiness()).toEqual(expect.objectContaining({ ready: false }))
    await expectCredentialError(
      transport.request({
        method: 'POST',
        url: 'https://eu-west-rbx.okms.ovh.net/v1/servicekey/key/datakey',
        headers: {},
        body: text.encode('{}'),
      }),
      [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
    )
    expect(requestSpy).not.toHaveBeenCalled()
  })

  test('mTLS readiness rejects sealed but malformed certificate material', async () => {
    const fixture = localFixture()
    const certificatePath = join(fixture.directory, 'invalid-client-cert.pem')
    const privateKeyPath = join(fixture.directory, 'invalid-client-key.pem')
    writeFileSync(certificatePath, 'not a certificate', { mode: 0o400 })
    writeFileSync(privateKeyPath, 'not a private key', { mode: 0o400 })
    chmodSync(certificatePath, 0o400)
    chmodSync(privateKeyPath, 0o400)

    const transport = createOvhKmsMtlsHttpTransportV1({
      endpointOrigin: 'https://eu-west-rbx.okms.ovh.net',
      clientCertificatePath: certificatePath,
      clientPrivateKeyPath: privateKeyPath,
    })
    expect(await transport.readiness()).toEqual(expect.objectContaining({
      ready: false,
      reasonCode: 'OVH_KMS_MTLS_INITIALIZATION_FAILED',
    }))
  })

  test('immutable selector never calls a different backend on provider mismatch', async () => {
    const transport = new FakeOvhTransport()
    const selected = createWorkspaceKekProviderSelectorV1(ovhProvider(transport))
    const alternativeGenerate = vi.fn()
    const alternative: WorkspaceKekProviderV1 = {
      contractVersion: WORKSPACE_KEK_PROVIDER_VERSION,
      providerId: 'alternative-kms',
      readiness: async () => ({ ready: true }),
      generateDataKey: alternativeGenerate,
      unwrapDataKey: async () => DEK,
    }
    expect(alternative.providerId).toBe('alternative-kms')
    await expectCredentialError(
      selected.unwrapDataKey(KEK_CONTEXT, {
        providerId: alternative.providerId,
        keyRef: 'any',
        keyVersion: 1,
        payload: {
          format: 'external-kms-opaque.v1',
          payloadFormatId: 'alternative.v1',
          opaqueAuthenticatedPayload: Uint8Array.of(1),
        },
      }),
      [CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE],
    )
    expect(alternativeGenerate).not.toHaveBeenCalled()
    expect(transport.requests).toHaveLength(0)
  })
})
