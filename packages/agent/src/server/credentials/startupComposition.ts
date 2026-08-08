import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  createCredentialConsumerBindingRegistryV1,
  createProviderRegistryV1,
} from '../../shared/credentials'
import type {
  CredentialConsumerBindingId,
  CredentialConsumerBindingRegistryV1,
  CredentialConsumerBindingV1,
  CredentialFieldId,
  ProviderDefinitionV1,
  ProviderId,
  ProviderRegistryV1,
  WorkspaceCredentialAuthorityVerifierV1,
  WorkspaceCredentialResolverV1,
} from '../../shared/credentials'
import { createHostSideCredentialResolverV1 } from './hostResolver'
import {
  LOCAL_KEK_BACKEND_ENV_KEY_V1,
  LOCAL_KEK_PROVIDER_ID_V1,
  createInMemoryCredentialVaultPersistenceV1,
  createLocalCredentialVersionAnchorFromEnvV1,
  createLocalKekWorkspaceKekProviderFromEnvV1,
  createVaultCredentialStoreBackendV1,
} from './vault'
import type { CredentialVaultPersistenceV1 } from './vault'
import type { VaultCredentialStoreBackendV1 } from './vault'

/**
 * [1082 slice B] Startup credential registry + resolver composition.
 *
 * Composes the frozen 16f.1 contract (`ProviderRegistryV1`,
 * `createHostSideCredentialResolverV1`, `withResolvedCredential`) with the
 * #1132/#1145 vault (`createVaultCredentialStoreBackendV1` + local-KEK
 * KmsBackend + version anchor) so a workspace host resolves LLM credentials
 * from the vault instead of only instance env.
 *
 * The LLM provider registry is DERIVED from pi's own provider surface
 * (`ModelRegistry` provider set + `AuthStorage.getOAuthProviders()`), never a
 * hand-maintained list: adding a provider pi supports requires no edit here.
 *
 * Fail-closed rules:
 * - `BORING_CREDENTIAL_KMS_BACKEND` unset → BYOK disabled, composition absent,
 *   behavior byte-identical to today (env-key-only pi auth).
 * - Set to anything other than a supported backend → stable
 *   `CREDENTIAL_NOT_CONFIGURED` error at startup — a typo never silently
 *   disables the vault.
 * - KMS selected but persistence unavailable → `CREDENTIAL_NOT_CONFIGURED`;
 *   in-memory persistence requires an explicit `memory` opt-in (test/dev).
 * - Unreadable KEK / anchor at resolve time surfaces as the vault's own
 *   stable `CREDENTIAL_*` codes; nothing falls back to plaintext or env.
 * - No secret material is ever logged or echoed in errors (vault invariants
 *   carry through unchanged; this module adds no logging).
 */

export const CREDENTIAL_PERSISTENCE_ENV_KEY_V1 = 'BORING_CREDENTIAL_PERSISTENCE'
export const CREDENTIAL_PERSISTENCE_MEMORY_OPT_IN_V1 = 'memory'

/** Consumer-binding id family for pi LLM model calls (r3 S3 / plan r2 PR-B). */
export const LLM_MODEL_CALL_BINDING_FAMILY_V1 = 'llm-model-call.v1'
export const LLM_API_KEY_FIELD_ID_V1 = 'api-key' as CredentialFieldId

const CREDENTIAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_BINDING_ID_LENGTH = 64
const MAX_DISPLAY_NAME_LENGTH = 256
const MAX_API_KEY_BYTES_V1 = 4_096

export type PiLlmAuthKindV1 = 'api-key' | 'oauth'

export interface PiDerivedLlmProviderV1 {
  readonly providerId: ProviderId
  readonly displayName: string
  /** Auth kinds pi supports for this provider; metadata for later slices. */
  readonly authKinds: readonly PiLlmAuthKindV1[]
  readonly egressOrigins: readonly `https://${string}`[]
  readonly bindingId: CredentialConsumerBindingId
}

export interface PiDerivedLlmProviderRegistryV1 {
  readonly providerRegistry: ProviderRegistryV1
  readonly bindingRegistry: CredentialConsumerBindingRegistryV1
  readonly catalog: readonly PiDerivedLlmProviderV1[]
  /** pi provider ids that could not be represented (diagnostics, non-secret). */
  readonly skippedProviderIds: readonly string[]
}

export function llmModelCallBindingIdV1(providerId: string): CredentialConsumerBindingId {
  return `${LLM_MODEL_CALL_BINDING_FAMILY_V1}.${providerId}` as CredentialConsumerBindingId
}

function sanitizeDisplayName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (cleaned.length === 0) return fallback
  return cleaned.slice(0, MAX_DISPLAY_NAME_LENGTH)
}

function toHttpsOrigin(rawBaseUrl: unknown): `https://${string}` | undefined {
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.length === 0) return undefined
  let parsed: URL
  try {
    parsed = new URL(rawBaseUrl)
  } catch {
    return undefined
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    // Reject template hosts such as `{location}-aiplatform.googleapis.com`.
    || /[{}]/.test(parsed.host)
  ) {
    return undefined
  }
  return parsed.origin as `https://${string}`
}

/**
 * Derives the LLM provider catalog from pi's provider surface. Pure and
 * disk-free: pi's in-memory `AuthStorage`/`ModelRegistry` constructors only.
 */
export function derivePiLlmProviderCatalogV1(): {
  readonly providers: readonly PiDerivedLlmProviderV1[]
  readonly skippedProviderIds: readonly string[]
} {
  const authStorage = AuthStorage.inMemory({})
  const modelRegistry = ModelRegistry.inMemory(authStorage)
  const oauthProviderIds = new Set<string>(
    authStorage.getOAuthProviders().map((provider) => provider.id),
  )
  const originsByProvider = new Map<string, Set<`https://${string}`>>()
  for (const model of modelRegistry.getAll()) {
    if (typeof model.provider !== 'string' || model.provider.length === 0) continue
    let origins = originsByProvider.get(model.provider)
    if (!origins) {
      origins = new Set()
      originsByProvider.set(model.provider, origins)
    }
    const origin = toHttpsOrigin((model as { baseUrl?: unknown }).baseUrl)
    if (origin) origins.add(origin)
  }

  const providerIds = [...new Set([
    ...originsByProvider.keys(),
    ...oauthProviderIds,
  ])].sort()

  const providers: PiDerivedLlmProviderV1[] = []
  const skippedProviderIds: string[] = []
  for (const rawProviderId of providerIds) {
    const bindingId = llmModelCallBindingIdV1(rawProviderId)
    if (
      !CREDENTIAL_ID_PATTERN.test(rawProviderId)
      || bindingId.length > MAX_BINDING_ID_LENGTH
    ) {
      skippedProviderIds.push(rawProviderId)
      continue
    }
    providers.push(Object.freeze({
      providerId: rawProviderId as ProviderId,
      displayName: sanitizeDisplayName(
        modelRegistry.getProviderDisplayName(rawProviderId),
        rawProviderId,
      ),
      authKinds: Object.freeze(
        oauthProviderIds.has(rawProviderId)
          ? (['api-key', 'oauth'] as const)
          : (['api-key'] as const),
      ) as readonly PiLlmAuthKindV1[],
      egressOrigins: Object.freeze(
        [...(originsByProvider.get(rawProviderId) ?? [])].sort(),
      ),
      bindingId,
    }))
  }
  return {
    providers: Object.freeze(providers),
    skippedProviderIds: Object.freeze(skippedProviderIds),
  }
}

function toProviderDefinition(provider: PiDerivedLlmProviderV1): ProviderDefinitionV1 {
  return {
    contractVersion: 'boring.provider.v1',
    id: provider.providerId,
    displayName: provider.displayName,
    category: 'llm',
    credential: {
      type: 'api-key',
      fields: [{
        id: LLM_API_KEY_FIELD_ID_V1,
        label: 'API key',
        required: true,
        sensitivity: 'secret',
        minBytes: 1,
        maxBytes: MAX_API_KEY_BYTES_V1,
      }],
    },
    consumerBindingIds: [provider.bindingId],
    sandboxEgressOrigins: provider.egressOrigins,
  }
}

function toConsumerBinding(provider: PiDerivedLlmProviderV1): CredentialConsumerBindingV1 {
  return {
    contractVersion: 'boring.credential-consumer-binding.v1',
    id: provider.bindingId,
    providerId: provider.providerId,
    consumer: {
      id: 'pi-model-call',
      kind: 'model-provider',
      trust: 'trusted',
    },
    purpose: 'Resolve the workspace LLM credential for pi model calls',
    allowedFieldIds: [LLM_API_KEY_FIELD_ID_V1],
    delivery: 'host-only',
  }
}

/**
 * Builds the frozen 16f.1 registries from the pi-derived catalog. Registry
 * construction re-validates every definition/binding (schema fail-closed).
 */
export function createPiDerivedLlmProviderRegistryV1(): PiDerivedLlmProviderRegistryV1 {
  const { providers, skippedProviderIds } = derivePiLlmProviderCatalogV1()
  const providerRegistry = createProviderRegistryV1(providers.map(toProviderDefinition))
  const bindingRegistry = createCredentialConsumerBindingRegistryV1(
    providers.map(toConsumerBinding),
    providerRegistry,
  )
  return Object.freeze({
    providerRegistry,
    bindingRegistry,
    catalog: providers,
    skippedProviderIds,
  })
}

export interface WorkspaceCredentialVaultCompositionOptionsV1 {
  /** Env-shaped record; the composition never reads `process.env` itself. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Durable persistence (#1145 Postgres in production). */
  readonly persistence?: CredentialVaultPersistenceV1
  /** Core-owned authority verifier; when present a resolver is pre-bound. */
  readonly authorityVerifier?: WorkspaceCredentialAuthorityVerifierV1
}

export interface WorkspaceCredentialVaultCompositionV1 {
  readonly providerRegistry: ProviderRegistryV1
  readonly bindingRegistry: CredentialConsumerBindingRegistryV1
  readonly catalog: readonly PiDerivedLlmProviderV1[]
  readonly skippedProviderIds: readonly string[]
  readonly vaultBackend: VaultCredentialStoreBackendV1
  /** Present when an authority verifier was supplied at composition time. */
  readonly resolver?: WorkspaceCredentialResolverV1
  createResolver(
    authorityVerifier: WorkspaceCredentialAuthorityVerifierV1,
  ): WorkspaceCredentialResolverV1
}

function notConfigured(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    message,
  )
}

/**
 * Startup composition root. Returns `undefined` only when BYOK is not
 * selected at all (`BORING_CREDENTIAL_KMS_BACKEND` unset/empty). Any partial
 * or invalid configuration throws a stable `CREDENTIAL_*` error instead of
 * silently running without the vault.
 */
export function resolveWorkspaceCredentialVaultCompositionFromEnvV1(
  options: WorkspaceCredentialVaultCompositionOptionsV1,
): WorkspaceCredentialVaultCompositionV1 | undefined {
  const selectedBackend = options.env[LOCAL_KEK_BACKEND_ENV_KEY_V1]?.trim()
  if (!selectedBackend) return undefined
  if (selectedBackend !== LOCAL_KEK_PROVIDER_ID_V1) {
    notConfigured(
      `Unsupported ${LOCAL_KEK_BACKEND_ENV_KEY_V1} selection; supported: ${LOCAL_KEK_PROVIDER_ID_V1}`,
    )
  }

  const kmsBackend = createLocalKekWorkspaceKekProviderFromEnvV1(options.env)
  const versionAnchor = createLocalCredentialVersionAnchorFromEnvV1(options.env)
  if (!kmsBackend || !versionAnchor) {
    notConfigured('Credential KMS backend selection did not produce a backend')
  }

  let persistence = options.persistence
  if (!persistence) {
    const persistenceMode = options.env[CREDENTIAL_PERSISTENCE_ENV_KEY_V1]?.trim()
    if (persistenceMode === CREDENTIAL_PERSISTENCE_MEMORY_OPT_IN_V1) {
      persistence = createInMemoryCredentialVaultPersistenceV1()
    } else {
      notConfigured(
        'Credential vault requires durable persistence; '
        + `inject a persistence port or set ${CREDENTIAL_PERSISTENCE_ENV_KEY_V1}=${CREDENTIAL_PERSISTENCE_MEMORY_OPT_IN_V1} (test/dev only)`,
      )
    }
  }

  const vaultBackend = createVaultCredentialStoreBackendV1({
    kmsBackend,
    persistence,
    versionAnchor,
  })
  const { providerRegistry, bindingRegistry, catalog, skippedProviderIds } =
    createPiDerivedLlmProviderRegistryV1()

  const createResolver = (
    authorityVerifier: WorkspaceCredentialAuthorityVerifierV1,
  ): WorkspaceCredentialResolverV1 => createHostSideCredentialResolverV1({
    authorityVerifier,
    bindingRegistry,
    providerRegistry,
    backend: vaultBackend,
  })

  return Object.freeze({
    providerRegistry,
    bindingRegistry,
    catalog,
    skippedProviderIds,
    vaultBackend,
    resolver: options.authorityVerifier
      ? createResolver(options.authorityVerifier)
      : undefined,
    createResolver,
  })
}
