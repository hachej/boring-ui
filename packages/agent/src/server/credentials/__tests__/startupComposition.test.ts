import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import { createFakeAuthorityVerifierV1 } from '../testing'
import {
  createInMemoryCredentialVaultPersistenceV1,
  createPiDerivedLlmProviderRegistryV1,
  derivePiLlmProviderCatalogV1,
  initializeLocalFileCredentialVersionAnchorV1,
  llmModelCallBindingIdV1,
  resolveWorkspaceCredentialVaultCompositionFromEnvV1,
  withResolvedCredential,
  LLM_API_KEY_FIELD_ID_V1,
} from '..'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  createProviderCredentialRefFactoryV1,
} from '../../../shared/credentials'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  CredentialFieldId,
  ProviderId,
  VerifiedWorkspaceCredentialAuthorityV1,
} from '../../../shared/credentials'
import { createLocalKekFileSourceV1 } from '../vault'

const SECRET = 'sk-slice-b-super-secret-value-000'

function opaqueScope(): AuthorizedWorkspaceCredentialScopeV1 {
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

async function localKekEnv(): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), 'boring-slice-b-'))
  const keyFilePath = join(dir, 'kek')
  await writeFile(keyFilePath, Buffer.alloc(32, 0x2a).toString('hex'))
  const anchorFilePath = join(dir, 'credential-anchor')
  await initializeLocalFileCredentialVersionAnchorV1({
    anchorFilePath,
    loadKek: createLocalKekFileSourceV1(keyFilePath),
  })
  return {
    BORING_CREDENTIAL_KMS_BACKEND: 'local-kek',
    BORING_CREDENTIAL_LOCAL_KEK_FILE: keyFilePath,
    BORING_CREDENTIAL_LOCAL_KEK_ANCHOR_FILE: anchorFilePath,
    BORING_CREDENTIAL_PERSISTENCE: 'memory',
  }
}

async function expectCredentialError(
  run: () => Promise<unknown> | unknown,
  code: string,
): Promise<CredentialResolutionError> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialResolutionError)
    const credentialError = error as CredentialResolutionError
    expect(credentialError.code).toBe(code)
    expect(credentialError.message).not.toContain(SECRET)
    return credentialError
  }
  throw new Error(`Expected CredentialResolutionError ${code}`)
}

describe('pi-derived LLM provider catalog', () => {
  test('mirrors pi ModelRegistry provider set and OAuth surface, no hand list', () => {
    const { providers, skippedProviderIds } = derivePiLlmProviderCatalogV1()

    const piAuth = AuthStorage.inMemory({})
    const piRegistry = ModelRegistry.inMemory(piAuth)
    const piProviderIds = new Set<string>([
      ...piRegistry.getAll().map((model) => model.provider),
      ...piAuth.getOAuthProviders().map((provider) => provider.id),
    ])

    const catalogIds = new Set(providers.map((provider) => provider.providerId as string))
    // Every pi provider is either represented or explicitly reported skipped.
    for (const piProviderId of piProviderIds) {
      expect(
        catalogIds.has(piProviderId) || skippedProviderIds.includes(piProviderId),
      ).toBe(true)
    }
    // And nothing appears that pi does not know about.
    for (const catalogId of catalogIds) {
      expect(piProviderIds.has(catalogId)).toBe(true)
    }

    const anthropic = providers.find((provider) => provider.providerId === 'anthropic')
    expect(anthropic).toBeDefined()
    expect(anthropic!.displayName).toBe(piRegistry.getProviderDisplayName('anthropic'))
    expect(anthropic!.authKinds).toContain('oauth')
    expect(anthropic!.egressOrigins).toContain('https://api.anthropic.com')

    const openai = providers.find((provider) => provider.providerId === 'openai')
    expect(openai?.authKinds).toEqual(['api-key'])

    for (const provider of providers) {
      expect(provider.bindingId).toBe(llmModelCallBindingIdV1(provider.providerId))
      for (const origin of provider.egressOrigins) {
        expect(new URL(origin).origin).toBe(origin)
        expect(origin.startsWith('https://')).toBe(true)
      }
    }
  })

  test('builds validating 16f.1 registries: every catalog entry resolvable', () => {
    const { providerRegistry, bindingRegistry, catalog } =
      createPiDerivedLlmProviderRegistryV1()
    expect(catalog.length).toBeGreaterThan(10)
    for (const entry of catalog) {
      const definition = providerRegistry.require(entry.providerId)
      expect(definition.category).toBe('llm')
      expect(definition.credential.type).toBe('api-key')
      const binding = bindingRegistry.require(entry.bindingId)
      expect(binding.providerId).toBe(entry.providerId)
      expect(binding.delivery).toBe('host-only')
      expect(binding.allowedFieldIds).toEqual([LLM_API_KEY_FIELD_ID_V1])
    }
  })
})

describe('startup vault composition (env selection)', () => {
  test('absent KMS backend env → composition absent (BYOK disabled)', () => {
    expect(resolveWorkspaceCredentialVaultCompositionFromEnvV1({ env: {} }))
      .toBeUndefined()
    expect(resolveWorkspaceCredentialVaultCompositionFromEnvV1({
      env: { BORING_CREDENTIAL_KMS_BACKEND: '   ' },
    })).toBeUndefined()
  })

  test('unknown KMS backend selection fails closed, never silently disables', async () => {
    await expectCredentialError(
      () => resolveWorkspaceCredentialVaultCompositionFromEnvV1({
        env: { BORING_CREDENTIAL_KMS_BACKEND: 'aws-kms' },
      }),
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    )
  })

  test('local-kek without KEK/anchor file env fails closed', async () => {
    await expectCredentialError(
      () => resolveWorkspaceCredentialVaultCompositionFromEnvV1({
        env: { BORING_CREDENTIAL_KMS_BACKEND: 'local-kek' },
      }),
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    )
  })

  test('KMS selected without persistence (and no memory opt-in) fails closed', async () => {
    const env = await localKekEnv()
    delete env.BORING_CREDENTIAL_PERSISTENCE
    await expectCredentialError(
      () => resolveWorkspaceCredentialVaultCompositionFromEnvV1({ env }),
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    )
  })

  test('memory opt-in is refused under NODE_ENV=production without the explicit dev flag', async () => {
    const env = await localKekEnv()
    env.NODE_ENV = 'production'
    await expectCredentialError(
      () => resolveWorkspaceCredentialVaultCompositionFromEnvV1({ env }),
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    )
    // Explicit override flag re-enables it (dev-like production sandboxes).
    env.BORING_CREDENTIAL_ALLOW_MEMORY = '1'
    expect(resolveWorkspaceCredentialVaultCompositionFromEnvV1({ env })).toBeDefined()
    // Injected durable persistence is never blocked by NODE_ENV.
    delete env.BORING_CREDENTIAL_ALLOW_MEMORY
    delete env.BORING_CREDENTIAL_PERSISTENCE
    expect(resolveWorkspaceCredentialVaultCompositionFromEnvV1({
      env,
      persistence: createInMemoryCredentialVaultPersistenceV1(),
    })).toBeDefined()
  })

  test('memory opt-in stays available outside production', async () => {
    const env = await localKekEnv()
    env.NODE_ENV = 'test'
    expect(resolveWorkspaceCredentialVaultCompositionFromEnvV1({ env })).toBeDefined()
  })

  test('runtimeView narrows the per-binding surface: no vault backend, no resolver minting', async () => {
    const env = await localKekEnv()
    const scope = opaqueScope()
    const composition = resolveWorkspaceCredentialVaultCompositionFromEnvV1({
      env,
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('ws-a') },
      ]),
    })!
    const view = composition.runtimeView
    expect(view.providerRegistry).toBe(composition.providerRegistry)
    expect(view.bindingRegistry).toBe(composition.bindingRegistry)
    expect(view.resolver).toBe(composition.resolver)
    expect('vaultBackend' in view).toBe(false)
    expect('createResolver' in view).toBe(false)
    expect(Object.isFrozen(view)).toBe(true)
  })

  test('one host-scope composition shared across bindings sees one vault, not per-binding forks', async () => {
    const env = await localKekEnv()
    const scope = opaqueScope()
    const composition = resolveWorkspaceCredentialVaultCompositionFromEnvV1({
      env,
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('ws-a') },
      ]),
    })!
    // Bindings receive the same narrowed view object (buildAgentComposition
    // attaches credentialComposition.runtimeView; it never re-resolves env).
    const bindingA = composition.runtimeView
    const bindingB = composition.runtimeView
    expect(bindingA).toBe(bindingB)

    await composition.vaultBackend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: 'anthropic' as ProviderId,
      fields: new Map<CredentialFieldId, Uint8Array>([
        [LLM_API_KEY_FIELD_ID_V1, new TextEncoder().encode(SECRET)],
      ]),
    })
    const refFactory = createProviderCredentialRefFactoryV1(bindingB.bindingRegistry)
    const lease = await bindingB.resolver!.resolve(scope, refFactory.create({
      providerId: 'anthropic' as ProviderId,
      bindingId: llmModelCallBindingIdV1('anthropic'),
      executionId: 'exec-shared',
    }))
    try {
      const material = lease.material
      if (material.kind !== 'field-set') throw new Error('expected field-set')
      expect(new TextDecoder().decode(material.fields.get(LLM_API_KEY_FIELD_ID_V1)))
        .toBe(SECRET)
    } finally {
      lease.dispose()
    }
  })

  test('injected persistence wins over the memory opt-in requirement', async () => {
    const env = await localKekEnv()
    delete env.BORING_CREDENTIAL_PERSISTENCE
    const composition = resolveWorkspaceCredentialVaultCompositionFromEnvV1({
      env,
      persistence: createInMemoryCredentialVaultPersistenceV1(),
    })
    expect(composition).toBeDefined()
    expect(composition!.resolver).toBeUndefined()
  })
})

describe('resolver end-to-end through the vault', () => {
  test('vault write → host resolver lease → plaintext only inside the lease', async () => {
    const env = await localKekEnv()
    const scope = opaqueScope()
    const composition = resolveWorkspaceCredentialVaultCompositionFromEnvV1({
      env,
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('ws-a') },
      ]),
    })!
    expect(composition.resolver).toBeDefined()

    const providerId = 'anthropic' as ProviderId
    await composition.vaultBackend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId,
      fields: new Map<CredentialFieldId, Uint8Array>([
        [LLM_API_KEY_FIELD_ID_V1, new TextEncoder().encode(SECRET)],
      ]),
    })

    const refFactory = createProviderCredentialRefFactoryV1(composition.bindingRegistry)
    const ref = refFactory.create({
      providerId,
      bindingId: llmModelCallBindingIdV1('anthropic'),
      executionId: 'exec-1',
    })
    const observed = await withResolvedCredential(
      composition.resolver!,
      scope,
      ref,
      async (lease) => {
        expect(lease.workspaceId).toBe('ws-a')
        expect(lease.credentialVersion).toBe(1)
        const material = lease.material
        if (material.kind !== 'field-set') throw new Error('expected field-set')
        return new TextDecoder().decode(material.fields.get(LLM_API_KEY_FIELD_ID_V1))
      },
    )
    expect(observed).toBe(SECRET)

    // Authority denial: a scope the verifier never granted is rejected with
    // AUTHORITY_INVALID before any storage access.
    const ungrantedScope = opaqueScope()
    await expectCredentialError(
      () => composition.resolver!.resolve(ungrantedScope, refFactory.create({
        providerId,
        bindingId: llmModelCallBindingIdV1('anthropic'),
        executionId: 'exec-2',
      })),
      CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
    )

    // Storage keying (not authority): a validly-authorized ws-b principal
    // resolves against ws-b's (empty) vault rows, never ws-a's material.
    const wsBScope = opaqueScope()
    const wsBResolver = composition.createResolver(
      createFakeAuthorityVerifierV1([{ scope: wsBScope, authority: authority('ws-b') }]),
    )
    await expectCredentialError(
      () => wsBResolver.resolve(wsBScope, refFactory.create({
        providerId,
        bindingId: llmModelCallBindingIdV1('anthropic'),
        executionId: 'exec-3',
      })),
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    )
  })

  test('fails closed with a stable code when the KEK file is unavailable', async () => {
    const env = await localKekEnv()
    env.BORING_CREDENTIAL_LOCAL_KEK_FILE = join(
      await mkdtemp(join(tmpdir(), 'boring-slice-b-missing-')),
      'missing-kek',
    )
    const scope = opaqueScope()
    const composition = resolveWorkspaceCredentialVaultCompositionFromEnvV1({
      env,
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('ws-a') },
      ]),
    })!

    await expectCredentialError(
      () => composition.vaultBackend.writeCredentialFields({
        workspaceId: 'ws-a',
        providerId: 'anthropic' as ProviderId,
        fields: new Map<CredentialFieldId, Uint8Array>([
          [LLM_API_KEY_FIELD_ID_V1, new TextEncoder().encode(SECRET)],
        ]),
      }),
      CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    )
    const refFactory = createProviderCredentialRefFactoryV1(composition.bindingRegistry)
    await expectCredentialError(
      () => composition.resolver!.resolve(scope, refFactory.create({
        providerId: 'anthropic' as ProviderId,
        bindingId: llmModelCallBindingIdV1('anthropic'),
        executionId: 'exec-5',
      })),
      CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    )
  })

  test('no secret material in catalog, registry, or error surfaces', async () => {
    const env = await localKekEnv()
    const scope = opaqueScope()
    const composition = resolveWorkspaceCredentialVaultCompositionFromEnvV1({
      env,
      authorityVerifier: createFakeAuthorityVerifierV1([
        { scope, authority: authority('ws-a') },
      ]),
    })!
    await composition.vaultBackend.writeCredentialFields({
      workspaceId: 'ws-a',
      providerId: 'anthropic' as ProviderId,
      fields: new Map<CredentialFieldId, Uint8Array>([
        [LLM_API_KEY_FIELD_ID_V1, new TextEncoder().encode(SECRET)],
      ]),
    })
    expect(JSON.stringify(composition.catalog)).not.toContain(SECRET)
    expect(JSON.stringify(composition.skippedProviderIds)).not.toContain(SECRET)

    // Mismatched ref after a successful write: error carries a code only.
    const mismatchedRef = {
      contractVersion: 'boring.provider-credential-ref.v1',
      providerId: 'anthropic' as ProviderId,
      bindingId: llmModelCallBindingIdV1('openai'),
      executionId: 'exec-4',
    } as const
    const error = await expectCredentialError(
      () => composition.resolver!.resolve(scope, mismatchedRef),
      CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
    )
    expect(JSON.stringify({ message: error.message, code: error.code }))
      .not.toContain(SECRET)
  })
})
