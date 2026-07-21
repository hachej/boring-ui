import { describe, expect, test, vi } from 'vitest'
import {
  createFakeAuthorityVerifierV1,
  createHostSideCredentialResolverV1,
  createInMemoryCredentialBackendV1,
  withResolvedCredential,
} from '..'
import type {
  CredentialStoreBackendV1,
  InMemoryCredentialBackendEntryV1,
} from '..'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  createCredentialConsumerBindingRegistryV1,
  createProviderCredentialRefFactoryV1,
  createProviderRegistryV1,
} from '../../../shared/credentials'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  CredentialConsumerBindingId,
  CredentialConsumerBindingRegistryV1,
  CredentialConsumerBindingV1,
  CredentialErrorCode,
  CredentialFieldId,
  ProviderCredentialRefV1,
  ProviderDefinitionV1,
  ProviderId,
  ProviderRegistryV1,
  ResolvedCredentialLeaseV1,
  VerifiedWorkspaceCredentialAuthorityV1,
  WorkspaceCredentialAuthorityVerifierV1,
} from '../../../shared/credentials'

const providerId = (value: string) => value as ProviderId
const fieldId = (value: string) => value as CredentialFieldId
const bindingId = (value: string) => value as CredentialConsumerBindingId

function opaqueScope(): AuthorizedWorkspaceCredentialScopeV1 {
  return Object.freeze({
    contractVersion: 'boring.authorized-workspace-credential-scope.v1',
  }) as unknown as AuthorizedWorkspaceCredentialScopeV1
}

function authority(
  workspaceId: string,
  expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
): VerifiedWorkspaceCredentialAuthorityV1 {
  return {
    workspaceId,
    appId: 'app-a',
    principal: {
      kind: 'user',
      userId: 'user-a',
      membershipRole: 'owner',
    },
    authorizationReceiptId: 'receipt-a',
    expiresAt,
  }
}

function providerDefinitions(): readonly ProviderDefinitionV1[] {
  return [
    {
      contractVersion: 'boring.provider.v1',
      id: providerId('provider-a'),
      displayName: 'Provider A',
      category: 'search',
      credential: {
        type: 'api-key',
        fields: [
          {
            id: fieldId('api-key'),
            label: 'API key',
            required: true,
            sensitivity: 'secret',
            maxBytes: 4_096,
          },
          {
            id: fieldId('region'),
            label: 'Region',
            required: false,
            sensitivity: 'public',
            maxBytes: 128,
          },
        ],
      },
      consumerBindingIds: [bindingId('binding-a'), bindingId('sandbox-binding')],
      sandboxEgressOrigins: ['https://api.example.com'],
    },
    {
      contractVersion: 'boring.provider.v1',
      id: providerId('provider-b'),
      displayName: 'Provider B',
      category: 'transcription',
      credential: {
        type: 'api-key',
        fields: [{
          id: fieldId('api-key'),
          label: 'API key',
          required: true,
          sensitivity: 'secret',
          maxBytes: 4_096,
        }],
      },
      consumerBindingIds: [bindingId('binding-b')],
      sandboxEgressOrigins: [],
    },
  ]
}

function providerRegistry(): ProviderRegistryV1 {
  return createProviderRegistryV1(providerDefinitions())
}

function bindingRegistry(): CredentialConsumerBindingRegistryV1 {
  const bindings: readonly CredentialConsumerBindingV1[] = [
    {
      contractVersion: 'boring.credential-consumer-binding.v1',
      id: bindingId('binding-a'),
      providerId: providerId('provider-a'),
      consumer: { id: 'search-proxy', kind: 'first-party-tool', trust: 'trusted' },
      purpose: 'Call provider A from the trusted host',
      allowedFieldIds: [fieldId('api-key')],
      delivery: 'host-only',
    },
    {
      contractVersion: 'boring.credential-consumer-binding.v1',
      id: bindingId('binding-b'),
      providerId: providerId('provider-b'),
      consumer: { id: 'transcription-proxy', kind: 'first-party-tool', trust: 'trusted' },
      purpose: 'Call provider B from the trusted host',
      allowedFieldIds: [fieldId('api-key')],
      delivery: 'host-only',
    },
    {
      contractVersion: 'boring.credential-consumer-binding.v1',
      id: bindingId('sandbox-binding'),
      providerId: providerId('provider-a'),
      consumer: { id: 'tenant-tool', kind: 'tenant-custom-tool', trust: 'untrusted' },
      purpose: 'Deferred sandbox delivery',
      allowedFieldIds: [fieldId('api-key')],
      delivery: 'sandbox-pipe',
      sandbox: {
        credentialChannel: 'fd-3',
        egressOrigins: ['https://api.example.com'],
      },
    },
  ]
  return createCredentialConsumerBindingRegistryV1(
    bindings,
    providerRegistry(),
  )
}

function refFor(
  registry: CredentialConsumerBindingRegistryV1,
  id = 'binding-a',
  provider = 'provider-a',
  executionId = 'execution-a',
): ProviderCredentialRefV1 {
  return createProviderCredentialRefFactoryV1(registry).create({
    providerId: providerId(provider),
    executionId,
    bindingId: bindingId(id),
  })
}

function fieldMaterial(
  value: string,
  includeRegion = false,
): InMemoryCredentialBackendEntryV1['material'] {
  return {
    kind: 'field-set',
    fields: new Map([
      [fieldId('api-key'), new TextEncoder().encode(value)],
      ...(includeRegion
        ? [[fieldId('region'), new TextEncoder().encode('eu-west')]] as const
        : []),
    ]),
  }
}

function entries(): readonly InMemoryCredentialBackendEntryV1[] {
  return [
    {
      workspaceId: 'workspace-a',
      providerId: providerId('provider-a'),
      material: fieldMaterial('WORKSPACE_A_SECRET', true),
      credentialVersion: 1,
    },
    {
      workspaceId: 'workspace-b',
      providerId: providerId('provider-a'),
      material: fieldMaterial('WORKSPACE_B_SECRET'),
      credentialVersion: 2,
    },
    {
      workspaceId: 'workspace-a',
      providerId: providerId('provider-b'),
      material: fieldMaterial('PROVIDER_B_SECRET'),
      credentialVersion: 3,
    },
  ]
}

async function captureCredentialError(promise: Promise<unknown>): Promise<CredentialResolutionError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialResolutionError)
    const credentialError = error as CredentialResolutionError
    expect(Object.values(CREDENTIAL_ERROR_CODES)).toContain(credentialError.code)
    return credentialError
  }
  throw new Error('Expected credential operation to fail')
}

function bytesFrom(lease: ResolvedCredentialLeaseV1, id = 'api-key'): Uint8Array {
  if (lease.material.kind !== 'field-set') throw new Error('Expected field-set material')
  const bytes = lease.material.fields.get(fieldId(id))
  if (!bytes) throw new Error('Expected field bytes')
  return bytes
}

describe('Tier-1 host-side credential resolver', () => {
  test('uses only the authority-verified workspace and ignores a caller-injected workspaceId', async () => {
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const inMemory = createInMemoryCredentialBackendV1(entries())
    const read = vi.fn(inMemory.read.bind(inMemory))
    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('workspace-a') },
      ]),
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: { read },
    })
    const trustedRef = refFor(registry)
    const injectedRef = {
      ...trustedRef,
      workspaceId: 'workspace-b',
    } as ProviderCredentialRefV1
    const lease = await resolver.resolve(scope, injectedRef)

    expect(read).toHaveBeenCalledWith(
      'workspace-a',
      providerId('provider-a'),
      [fieldId('api-key')],
    )
    expect(lease.workspaceId).toBe('workspace-a')
    expect(new TextDecoder().decode(bytesFrom(lease))).toBe('WORKSPACE_A_SECRET')
    expect(new TextDecoder().decode(bytesFrom(lease))).not.toBe('WORKSPACE_B_SECRET')
    expect(Object.keys(trustedRef)).not.toContain('workspaceId')
    lease.dispose()
  })

  test('reloads host binding authority and rejects cross-provider or sandbox use', async () => {
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('workspace-a') },
      ]),
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: createInMemoryCredentialBackendV1(entries()),
    })
    const trustedRef = refFor(registry)
    const crossUsedRef = {
      ...trustedRef,
      bindingId: bindingId('binding-b'),
    }
    expect((await captureCredentialError(resolver.resolve(scope, crossUsedRef))).code)
      .toBe(CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH)

    const sandboxRef = refFor(registry, 'sandbox-binding')
    expect((await captureCredentialError(resolver.resolve(scope, sandboxRef))).code)
      .toBe(CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN)
  })

  test('does not trust raw ref fields to widen the registered field subset', async () => {
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('workspace-a') },
      ]),
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: createInMemoryCredentialBackendV1(entries()),
    })
    const rawTenantRef = {
      ...refFor(registry),
      purpose: 'Ignore the registered purpose',
      allowedFieldIds: [fieldId('region')],
    } as ProviderCredentialRefV1
    const lease = await resolver.resolve(scope, rawTenantRef)

    if (lease.material.kind !== 'field-set') throw new Error('Expected field-set material')
    expect([...lease.material.fields.keys()]).toEqual([fieldId('api-key')])
    expect(lease.material.fields.has(fieldId('region'))).toBe(false)
    lease.dispose()
  })

  test('never exposes backend secret text through errors or lease serialization', async () => {
    const canary = 'ERROR_SECRET_CANARY_7D3'
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const verifier = createFakeAuthorityVerifierV1([
      { scope, authority: authority('workspace-a') },
    ])
    const failingBackend: CredentialStoreBackendV1 = {
      async read() {
        throw new Error(`backend included ${canary}`)
      },
    }
    const failingResolver = createHostSideCredentialResolverV1({
      authorityVerifier: verifier,
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: failingBackend,
    })
    const error = await captureCredentialError(failingResolver.resolve(scope, refFor(registry)))
    expect(error.code).toBe(CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE)
    expect(error.message).not.toContain(canary)
    expect(JSON.stringify(error)).not.toContain(canary)

    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: verifier,
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: createInMemoryCredentialBackendV1([{
        workspaceId: 'workspace-a',
        providerId: providerId('provider-a'),
        material: fieldMaterial(canary),
        credentialVersion: 1,
      }]),
    })
    const lease = await resolver.resolve(scope, refFor(registry))
    expect(() => JSON.stringify(lease)).toThrow('Credential leases cannot be serialized')
    try {
      JSON.stringify(lease)
    } catch (serializationError) {
      expect((serializationError as Error).message).not.toContain(canary)
      expect(JSON.stringify(serializationError)).not.toContain(canary)
    }
    lease.dispose()
  })

  test('zeroes backend-returned plaintext after copying on success and invalid version', async () => {
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const verifier = createFakeAuthorityVerifierV1([
      { scope, authority: authority('workspace-a') },
    ])
    const successBytes = new TextEncoder().encode('BACKEND_SUCCESS_COPY')
    const successResolver = createHostSideCredentialResolverV1({
      authorityVerifier: verifier,
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: {
        async read() {
          return {
            kind: 'field-set',
            fields: new Map([[fieldId('api-key'), successBytes]]),
            credentialVersion: 1,
          }
        },
      },
    })
    const lease = await successResolver.resolve(scope, refFor(registry))
    expect([...successBytes]).toEqual(new Array(successBytes.byteLength).fill(0))
    expect(new TextDecoder().decode(bytesFrom(lease))).toBe('BACKEND_SUCCESS_COPY')
    lease.dispose()

    const invalidVersionBytes = new TextEncoder().encode('BACKEND_INVALID_VERSION')
    const invalidVersionResolver = createHostSideCredentialResolverV1({
      authorityVerifier: verifier,
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: {
        async read() {
          return {
            kind: 'field-set',
            fields: new Map([[fieldId('api-key'), invalidVersionBytes]]),
            credentialVersion: 0,
          }
        },
      },
    })
    const error = await captureCredentialError(
      invalidVersionResolver.resolve(scope, refFor(registry)),
    )
    expect(error.code).toBe(CREDENTIAL_ERROR_CODES.UNREADABLE)
    expect([...invalidVersionBytes])
      .toEqual(new Array(invalidVersionBytes.byteLength).fill(0))
  })

  test('binds backend material to registered field and external-account bounds', async () => {
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const verifier = createFakeAuthorityVerifierV1([
      { scope, authority: authority('workspace-a') },
    ])
    const oversizedField = new Uint8Array(4_097)
    const oversizedResolver = createHostSideCredentialResolverV1({
      authorityVerifier: verifier,
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: {
        async read() {
          return {
            kind: 'field-set',
            fields: new Map([[fieldId('api-key'), oversizedField]]),
            credentialVersion: 1,
          }
        },
      },
    })
    expect((await captureCredentialError(
      oversizedResolver.resolve(scope, refFor(registry)),
    )).code).toBe(CREDENTIAL_ERROR_CODES.UNREADABLE)
    expect([...oversizedField]).toEqual(new Array(oversizedField.byteLength).fill(0))

    const externalProvider: ProviderDefinitionV1 = {
      contractVersion: 'boring.provider.v1',
      id: providerId('external-provider'),
      displayName: 'External provider',
      category: 'mcp',
      credential: {
        type: 'oauth2-authorization-code',
        tokenCustody: 'external-managed',
        custodianAdapterId: 'registered-adapter',
        connectUrlOrigins: ['https://connect.example.com'],
        scopes: ['mcp:read'],
        accountReference: {
          label: 'Account reference',
          maxBytes: 4,
          persistence: 'server-only-metadata',
        },
        delivery: 'host-session-adapter-only',
      },
      consumerBindingIds: [bindingId('external-binding')],
      sandboxEgressOrigins: [],
    }
    const externalProviders = createProviderRegistryV1([externalProvider])
    const externalBindings = createCredentialConsumerBindingRegistryV1([{
      contractVersion: 'boring.credential-consumer-binding.v1',
      id: bindingId('external-binding'),
      providerId: externalProvider.id,
      consumer: { id: 'managed-session', kind: 'mcp-server', trust: 'trusted' },
      purpose: 'Open registered managed session',
      allowedFieldIds: [],
      delivery: 'host-only',
    }], externalProviders)
    const externalRef = refFor(
      externalBindings,
      'external-binding',
      'external-provider',
      'external-execution',
    )
    const invalidExternalMaterials = [
      {
        custodianAdapterId: 'unregistered-adapter',
        bytes: new Uint8Array(1),
      },
      {
        custodianAdapterId: 'registered-adapter',
        bytes: new Uint8Array(5),
      },
    ]
    for (const invalid of invalidExternalMaterials) {
      const resolver = createHostSideCredentialResolverV1({
        authorityVerifier: verifier,
        bindingRegistry: externalBindings,
        providerRegistry: externalProviders,
        backend: {
          async read() {
            return {
              kind: 'external-managed-account',
              custodianAdapterId: invalid.custodianAdapterId,
              opaqueAccountReference: invalid.bytes,
              credentialVersion: 1,
            }
          },
        },
      })
      expect((await captureCredentialError(
        resolver.resolve(scope, externalRef),
      )).code).toBe(CREDENTIAL_ERROR_CODES.UNREADABLE)
      expect([...invalid.bytes]).toEqual(new Array(invalid.bytes.byteLength).fill(0))
    }
  })

  test('snapshots mutable verifier output before the awaited backend read', async () => {
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const mutableAuthority = authority('workspace-a') as {
      -readonly [Key in keyof VerifiedWorkspaceCredentialAuthorityV1]:
        VerifiedWorkspaceCredentialAuthorityV1[Key]
    }
    const verifier: WorkspaceCredentialAuthorityVerifierV1 = {
      contractVersion: 'boring.workspace-credential-authority-verifier.v1',
      async verifyCurrent() {
        return mutableAuthority
      },
    }
    let releaseRead!: () => void
    let markReadStarted!: () => void
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
    let selectedWorkspaceId = ''
    const backend: CredentialStoreBackendV1 = {
      async read(workspaceId) {
        selectedWorkspaceId = workspaceId
        markReadStarted()
        await new Promise<void>((resolve) => { releaseRead = resolve })
        return {
          kind: 'field-set',
          fields: new Map([[
            fieldId('api-key'),
            new TextEncoder().encode('SNAPSHOT_SECRET'),
          ]]),
          credentialVersion: 1,
        }
      },
    }
    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: verifier,
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend,
    })
    const resolving = resolver.resolve(scope, refFor(registry))
    await readStarted
    mutableAuthority.workspaceId = 'workspace-b'
    mutableAuthority.expiresAt = new Date(Date.now() + 7_200_000).toISOString()
    releaseRead()
    const lease = await resolving

    expect(selectedWorkspaceId).toBe('workspace-a')
    expect(lease.workspaceId).toBe('workspace-a')
    lease.dispose()
  })

  test('uses expiry as a second fence before delivery and during lease use', async () => {
    vi.useFakeTimers()
    try {
      const now = new Date('2026-07-21T04:00:00.000Z')
      vi.setSystemTime(now)
      const scope = opaqueScope()
      const registry = bindingRegistry()
      const expiresAt = new Date(now.getTime() + 1_000).toISOString()
      const verifier = createFakeAuthorityVerifierV1([
        { scope, authority: authority('workspace-a', expiresAt) },
      ])
      let releaseRead!: () => void
      let markReadStarted!: () => void
      const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
      const delayedBytes = new TextEncoder().encode('DELAYED_SECRET')
      const delayedResolver = createHostSideCredentialResolverV1({
        authorityVerifier: verifier,
        bindingRegistry: registry,
        providerRegistry: providerRegistry(),
        backend: {
          async read() {
            markReadStarted()
            await new Promise<void>((resolve) => { releaseRead = resolve })
            return {
              kind: 'field-set',
              fields: new Map([[fieldId('api-key'), delayedBytes]]),
              credentialVersion: 1,
            }
          },
        },
      })
      const delayedResolution = delayedResolver.resolve(scope, refFor(registry))
      await readStarted
      vi.setSystemTime(now.getTime() + 2_000)
      releaseRead()
      const delayedError = await captureCredentialError(delayedResolution)
      expect(delayedError.code).toBe(CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID)
      expect([...delayedBytes]).toEqual(new Array(delayedBytes.byteLength).fill(0))

      vi.setSystemTime(now)
      const leaseResolver = createHostSideCredentialResolverV1({
        authorityVerifier: verifier,
        bindingRegistry: registry,
        providerRegistry: providerRegistry(),
        backend: createInMemoryCredentialBackendV1(entries()),
      })
      const lease = await leaseResolver.resolve(
        scope,
        refFor(registry, 'binding-a', 'provider-a', 'execution-expiry'),
      )
      const leasedBytes = bytesFrom(lease)
      vi.setSystemTime(now.getTime() + 2_000)
      try {
        lease.material
        throw new Error('Expected expired lease access to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(CredentialResolutionError)
        expect((error as CredentialResolutionError).code)
          .toBe(CREDENTIAL_ERROR_CODES.LEASE_EXPIRED)
      }
      expect([...leasedBytes]).toEqual(new Array(leasedBytes.byteLength).fill(0))
    } finally {
      vi.useRealTimers()
    }
  })

  test('disposes in finally, zero-fills bytes, and rejects later material access', async () => {
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('workspace-a') },
      ]),
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: createInMemoryCredentialBackendV1(entries()),
    })
    let leasedBytes: Uint8Array | undefined
    await expect(withResolvedCredential(
      resolver,
      scope,
      refFor(registry),
      (lease) => {
        leasedBytes = bytesFrom(lease)
        throw new Error('consumer failed')
      },
    )).rejects.toThrow('consumer failed')

    expect([...leasedBytes!]).toEqual(new Array(leasedBytes!.byteLength).fill(0))
    const lease = await resolver.resolve(scope, refFor(registry, 'binding-a', 'provider-a', 'execution-b'))
    lease.dispose()
    lease.dispose()
    expect(() => lease.material).toThrow('Credential lease has been disposed')
  })

  test('rejects copied, unissued, and expired authority with stable AUTHORITY_INVALID', async () => {
    const issuedScope = opaqueScope()
    const copiedScope = {
      ...issuedScope,
    } as AuthorizedWorkspaceCredentialScopeV1
    const expiredScope = opaqueScope()
    const registry = bindingRegistry()
    const verifier = createFakeAuthorityVerifierV1([
      { scope: issuedScope, authority: authority('workspace-a') },
      {
        scope: expiredScope,
        authority: authority('workspace-a', new Date(Date.now() - 1_000).toISOString()),
      },
    ])
    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: verifier,
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: createInMemoryCredentialBackendV1(entries()),
    })

    for (const invalidScope of [copiedScope, opaqueScope(), expiredScope]) {
      const error = await captureCredentialError(resolver.resolve(invalidScope, refFor(registry)))
      expect(error.code).toBe(CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID)
    }
  })

  test('sanitizes verifier and backend errors while retaining only stable codes', async () => {
    const scope = opaqueScope()
    const registry = bindingRegistry()
    const codes = new Set<CredentialErrorCode>(Object.values(CREDENTIAL_ERROR_CODES))
    const verifier: WorkspaceCredentialAuthorityVerifierV1 = {
      contractVersion: 'boring.workspace-credential-authority-verifier.v1',
      async verifyCurrent() {
        throw new Error('untrusted verifier detail')
      },
    }
    const resolver = createHostSideCredentialResolverV1({
      authorityVerifier: verifier,
      bindingRegistry: registry,
      providerRegistry: providerRegistry(),
      backend: createInMemoryCredentialBackendV1(entries()),
    })
    const error = await captureCredentialError(resolver.resolve(scope, refFor(registry)))
    expect(codes.has(error.code)).toBe(true)
    expect(error.code).toBe(CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID)
  })
})
