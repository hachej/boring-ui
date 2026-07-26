import { describe, expect, test } from 'vitest'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  createCredentialConsumerBindingRegistryV1,
  createProviderCredentialRefFactoryV1,
  createProviderRegistryV1,
} from '..'
import type {
  CredentialConsumerBindingId,
  CredentialConsumerBindingV1,
  CredentialErrorCode,
  CredentialFieldDefinitionV1,
  CredentialFieldId,
  ProviderDefinitionV1,
  ProviderId,
} from '..'

const providerId = (value: string) => value as ProviderId
const fieldId = (value: string) => value as CredentialFieldId
const bindingId = (value: string) => value as CredentialConsumerBindingId

function secretField(id = 'api-key'): CredentialFieldDefinitionV1 {
  return {
    id: fieldId(id),
    label: 'API key',
    required: true,
    sensitivity: 'secret',
    minBytes: 1,
    maxBytes: 4_096,
  }
}

function apiProvider(input: Readonly<{
  id?: string
  bindingIds?: readonly string[]
  fields?: readonly CredentialFieldDefinitionV1[]
  origins?: readonly `https://${string}`[]
}> = {}): ProviderDefinitionV1 {
  return {
    contractVersion: 'boring.provider.v1',
    id: providerId(input.id ?? 'provider-a'),
    displayName: 'Provider A',
    category: 'search',
    credential: {
      type: 'api-key',
      fields: input.fields ?? [secretField()],
    },
    consumerBindingIds: (input.bindingIds ?? ['binding-a']).map(bindingId),
    sandboxEgressOrigins: input.origins ?? ['https://api.example.com'],
  }
}

function localOAuthProvider(
  overrides: Partial<ProviderDefinitionV1> = {},
): ProviderDefinitionV1 {
  return {
    contractVersion: 'boring.provider.v1',
    id: providerId('oauth-local'),
    displayName: 'Local OAuth',
    category: 'other',
    credential: {
      type: 'oauth2-authorization-code',
      tokenCustody: 'local-vault',
      clientRegistrationRef: 'deployment-client',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      revocationEndpoint: 'https://auth.example.com/revoke',
      scopes: ['read:data'],
      usePkce: true,
      refreshTokenField: { ...secretField('refresh-token'), label: 'Refresh token' },
      resolvedAccessTokenField: { ...secretField('access-token'), label: 'Access token' },
      accessTokenPersistence: 'memory-only',
    },
    consumerBindingIds: [bindingId('oauth-binding')],
    sandboxEgressOrigins: [],
    ...overrides,
  }
}

function externalProvider(): ProviderDefinitionV1 {
  return {
    contractVersion: 'boring.provider.v1',
    id: providerId('oauth-external'),
    displayName: 'External OAuth',
    category: 'mcp',
    credential: {
      type: 'oauth2-authorization-code',
      tokenCustody: 'external-managed',
      custodianAdapterId: 'managed-adapter',
      connectUrlOrigins: ['https://connect.example.com'],
      scopes: ['mcp:read'],
      accountReference: {
        label: 'Managed account',
        maxBytes: 1_024,
        persistence: 'server-only-metadata',
      },
      delivery: 'host-session-adapter-only',
    },
    consumerBindingIds: [bindingId('external-binding')],
    sandboxEgressOrigins: [],
  }
}

function trustedBinding(input: Readonly<{
  id?: string
  providerId?: string
  fieldIds?: readonly string[]
}> = {}): CredentialConsumerBindingV1 {
  return {
    contractVersion: 'boring.credential-consumer-binding.v1',
    id: bindingId(input.id ?? 'binding-a'),
    providerId: providerId(input.providerId ?? 'provider-a'),
    consumer: {
      id: 'search-proxy',
      kind: 'first-party-tool',
      trust: 'trusted',
    },
    purpose: 'Call the registered search API',
    allowedFieldIds: (input.fieldIds ?? ['api-key']).map(fieldId),
    delivery: 'host-only',
  }
}

function credentialError(run: () => unknown): CredentialResolutionError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialResolutionError)
    return error as CredentialResolutionError
  }
  throw new Error('Expected credential operation to fail')
}

function expectCode(run: () => unknown, code: CredentialErrorCode): void {
  expect(credentialError(run).code).toBe(code)
}

describe('provider registry validation', () => {
  test('maps malformed root definitions to stable schema errors', () => {
    expectCode(
      () => createProviderRegistryV1([
        undefined as unknown as ProviderDefinitionV1,
      ]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
  })

  test('enforces provider and field ID grammar plus bounded field sizes', () => {
    expectCode(
      () => createProviderRegistryV1([apiProvider({ id: 'Invalid Provider' })]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([
        apiProvider({ fields: [secretField('field/'.repeat(20))] }),
      ]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([
        apiProvider({ fields: [{ ...secretField(), minBytes: 10, maxBytes: 9 }] }),
      ]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([
        apiProvider({ fields: [{ ...secretField(), maxBytes: 65_537 }] }),
      ]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([
        apiProvider({ fields: [secretField(), secretField()] }),
      ]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([apiProvider(), apiProvider()]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
  })

  test('rejects malformed local-vault OAuth fields, endpoints, and scopes', () => {
    const valid = localOAuthProvider()
    const credential = valid.credential
    if (credential.type !== 'oauth2-authorization-code' || credential.tokenCustody !== 'local-vault') {
      throw new Error('Invalid test fixture')
    }

    const invalidCredentials = [
      { ...credential, refreshTokenField: undefined },
      { ...credential, resolvedAccessTokenField: undefined },
      { ...credential, refreshTokenField: { ...credential.refreshTokenField, required: false } },
      { ...credential, refreshTokenField: { ...credential.refreshTokenField, sensitivity: 'public' } },
      { ...credential, resolvedAccessTokenField: { ...credential.resolvedAccessTokenField, sensitivity: 'public' } },
      { ...credential, resolvedAccessTokenField: { ...credential.resolvedAccessTokenField, required: false } },
      { ...credential, resolvedAccessTokenField: { ...credential.resolvedAccessTokenField, id: credential.refreshTokenField.id } },
      { ...credential, refreshTokenField: { ...credential.refreshTokenField, maxBytes: 65_537 } },
      { ...credential, resolvedAccessTokenField: { ...credential.resolvedAccessTokenField, maxBytes: 65_537 } },
      { ...credential, refreshTokenField: { ...credential.refreshTokenField, maxBytes: undefined } },
      { ...credential, resolvedAccessTokenField: { ...credential.resolvedAccessTokenField, maxBytes: undefined } },
      { ...credential, authorizationEndpoint: 'http://auth.example.com/authorize' },
      { ...credential, tokenEndpoint: 'http://auth.example.com/token' },
      { ...credential, revocationEndpoint: 'http://auth.example.com/revoke' },
      { ...credential, scopes: ['scope with spaces'] },
    ]

    for (const invalidCredential of invalidCredentials) {
      expectCode(
        () => createProviderRegistryV1([{
          ...valid,
          credential: invalidCredential,
        } as ProviderDefinitionV1]),
        CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
      )
    }
  })

  test('rejects external-managed token fields, non-HTTPS origins, and unbounded account references', () => {
    const valid = externalProvider()
    const credential = valid.credential
    if (credential.type !== 'oauth2-authorization-code' || credential.tokenCustody !== 'external-managed') {
      throw new Error('Invalid test fixture')
    }

    expectCode(
      () => createProviderRegistryV1([{
        ...valid,
        credential: {
          ...credential,
          refreshTokenField: secretField('forbidden-refresh'),
        } as unknown as ProviderDefinitionV1['credential'],
      }]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([{
        ...valid,
        credential: {
          ...credential,
          delivery: 'sandbox-pipe',
        } as unknown as ProviderDefinitionV1['credential'],
      }]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([{
        ...valid,
        credential: {
          ...credential,
          accountReference: {
            ...credential.accountReference,
            token: 'must-not-be-accepted',
          },
        } as unknown as ProviderDefinitionV1['credential'],
      }]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([{
        ...valid,
        credential: {
          ...credential,
          connectUrlOrigins: ['http://connect.example.com'],
        } as unknown as ProviderDefinitionV1['credential'],
      }]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createProviderRegistryV1([{
        ...valid,
        credential: {
          ...credential,
          accountReference: { ...credential.accountReference, maxBytes: 16_385 },
        },
      }]),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
  })

  test('returns immutable startup composition and stable require errors', () => {
    const registry = createProviderRegistryV1([apiProvider()])
    expect(registry.contractVersion).toBe('boring.provider-registry.v1')
    expect(Object.isFrozen(registry.list())).toBe(true)
    expect(Object.isFrozen(registry.list()[0]?.credential)).toBe(true)
    expect(registry.require(providerId('provider-a')).displayName).toBe('Provider A')
    expectCode(
      () => registry.require(providerId('missing-provider')),
      CREDENTIAL_ERROR_CODES.PROVIDER_UNKNOWN,
    )
    expectCode(
      () => registry.require(providerId('NOT VALID')),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
  })
})

describe('consumer binding registry and trusted reference factory', () => {
  test('maps malformed root bindings to stable schema errors', () => {
    expectCode(
      () => createCredentialConsumerBindingRegistryV1(
        [null as unknown as CredentialConsumerBindingV1],
        createProviderRegistryV1([apiProvider()]),
      ),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
  })

  test('enforces trusted host-only and untrusted sandbox channel/egress policy', () => {
    const providerRegistry = createProviderRegistryV1([
      apiProvider({ bindingIds: ['binding-a', 'sandbox-binding'] }),
    ])
    const invalidTrusted = {
      ...trustedBinding(),
      delivery: 'sandbox-pipe',
      sandbox: {
        credentialChannel: 'fd-3',
        egressOrigins: ['https://api.example.com'],
      },
    } as CredentialConsumerBindingV1
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([invalidTrusted], providerRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )

    const invalidUntrusted = {
      ...trustedBinding({ id: 'sandbox-binding' }),
      consumer: { id: 'tenant-tool', kind: 'tenant-custom-tool', trust: 'untrusted' },
      delivery: 'host-only',
    } as CredentialConsumerBindingV1
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([invalidUntrusted], providerRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )

    const invalidChannel = {
      ...invalidUntrusted,
      delivery: 'sandbox-pipe',
      sandbox: {
        credentialChannel: 'tmpfs-v1',
        egressOrigins: ['https://not-approved.example.com'],
      },
    } as CredentialConsumerBindingV1
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([invalidChannel], providerRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([{
        ...invalidUntrusted,
        delivery: 'sandbox-pipe',
        sandbox: {
          credentialChannel: 'fd-3',
          egressOrigins: ['https://not-approved.example.com'],
        },
      }], providerRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([{
        ...trustedBinding(),
        purpose: '',
      }], providerRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([{
        ...trustedBinding(),
        providerId: providerId('missing-provider'),
      }], providerRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    const malformedBindings = [
      { ...trustedBinding(), id: bindingId('INVALID BINDING') },
      { ...trustedBinding(), providerId: providerId('INVALID PROVIDER') },
      { ...trustedBinding(), consumer: { ...trustedBinding().consumer, id: '' } },
      { ...trustedBinding(), consumer: { ...trustedBinding().consumer, kind: 'invalid-kind' } },
      { ...trustedBinding(), consumer: { ...trustedBinding().consumer, trust: 'invalid-trust' } },
    ]
    for (const malformedBinding of malformedBindings) {
      expectCode(
        () => createCredentialConsumerBindingRegistryV1(
          [malformedBinding as unknown as CredentialConsumerBindingV1],
          providerRegistry,
        ),
        CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
      )
    }
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([{
        ...invalidChannel,
        delivery: 'invalid-delivery',
        sandbox: {
          credentialChannel: 'fd-3',
          egressOrigins: ['https://api.example.com'],
        },
      } as unknown as CredentialConsumerBindingV1], providerRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )

    const sandboxBinding: CredentialConsumerBindingV1 = {
      ...invalidUntrusted,
      delivery: 'sandbox-pipe',
      sandbox: {
        credentialChannel: 'fd-3',
        egressOrigins: ['https://api.example.com'],
      },
    }
    expect(
      createCredentialConsumerBindingRegistryV1([trustedBinding(), sandboxBinding], providerRegistry)
        .require(bindingId('sandbox-binding')).sandbox?.credentialChannel,
    ).toBe('fd-3')
    const bindingRegistry = createCredentialConsumerBindingRegistryV1(
      [trustedBinding(), sandboxBinding],
      providerRegistry,
    )
    expectCode(
      () => bindingRegistry.require(bindingId('missing-binding')),
      CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
    )
  })

  test('rejects unknown fields and the stored OAuth refresh field', () => {
    const apiRegistry = createProviderRegistryV1([apiProvider()])
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([
        trustedBinding({ fieldIds: ['not-registered'] }),
      ], apiRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )

    const oauthRegistry = createProviderRegistryV1([localOAuthProvider()])
    expectCode(
      () => createCredentialConsumerBindingRegistryV1([trustedBinding({
        id: 'oauth-binding',
        providerId: 'oauth-local',
        fieldIds: ['refresh-token'],
      })], oauthRegistry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    const bindingRegistry = createCredentialConsumerBindingRegistryV1([trustedBinding({
      id: 'oauth-binding',
      providerId: 'oauth-local',
      fieldIds: ['access-token'],
    })], oauthRegistry)
    expect(bindingRegistry.require(bindingId('oauth-binding')).allowedFieldIds)
      .toEqual([fieldId('access-token')])
  })

  test('requires external-managed consumers to be empty, trusted, and host-only', () => {
    const registry = createProviderRegistryV1([externalProvider()])
    const valid: CredentialConsumerBindingV1 = {
      ...trustedBinding({
        id: 'external-binding',
        providerId: 'oauth-external',
        fieldIds: [],
      }),
      consumer: { id: 'managed-session', kind: 'mcp-server', trust: 'trusted' },
    }
    expect(createCredentialConsumerBindingRegistryV1([valid], registry)
      .require(bindingId('external-binding')).delivery).toBe('host-only')

    expectCode(
      () => createCredentialConsumerBindingRegistryV1([{
        ...valid,
        consumer: { ...valid.consumer, trust: 'untrusted' },
        delivery: 'sandbox-pipe',
        sandbox: { credentialChannel: 'fd-3', egressOrigins: [] },
      }], registry),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
  })

  test('mints identity-only references and rejects cross-provider or invalid execution use', () => {
    const providerRegistry = createProviderRegistryV1([
      apiProvider(),
      apiProvider({ id: 'provider-b', bindingIds: ['binding-b'] }),
    ])
    const bindingRegistry = createCredentialConsumerBindingRegistryV1([
      trustedBinding(),
      trustedBinding({ id: 'binding-b', providerId: 'provider-b' }),
    ], providerRegistry)
    const factory = createProviderCredentialRefFactoryV1(bindingRegistry)
    const ref = factory.create({
      providerId: providerId('provider-a'),
      executionId: 'execution-1',
      bindingId: bindingId('binding-a'),
    })
    expect(ref).toEqual({
      contractVersion: 'boring.provider-credential-ref.v1',
      providerId: 'provider-a',
      executionId: 'execution-1',
      bindingId: 'binding-a',
    })
    expect(Object.keys(ref)).not.toContain('workspaceId')

    expectCode(
      () => factory.create({
        providerId: providerId('provider-b'),
        executionId: 'execution-2',
        bindingId: bindingId('binding-a'),
      }),
      CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
    )
    expectCode(
      () => factory.create({
        providerId: providerId('provider-a'),
        executionId: '',
        bindingId: bindingId('binding-a'),
      }),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    expectCode(
      () => factory.create({
        providerId: providerId('provider-a'),
        executionId: 'x'.repeat(257),
        bindingId: bindingId('binding-a'),
      }),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
  })
})

test('every credential failure uses a stable credential error code', () => {
  const values = new Set<CredentialErrorCode>(Object.values(CREDENTIAL_ERROR_CODES))
  const error = credentialError(() => createProviderRegistryV1([apiProvider({ id: 'INVALID' })]))
  expect(values.has(error.code)).toBe(true)
  expect(error.code).toMatch(/^CREDENTIAL_/)
})
