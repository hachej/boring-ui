import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from '@earendil-works/pi-ai'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  credentialCustodySubjectKeyV1,
} from '../../shared/credentials'
import type { CredentialFieldId, ProviderId } from '../../shared/credentials'
import type { VaultCredentialStoreBackendV1 } from './vault'
import { LLM_API_KEY_FIELD_ID_V1 } from './startupComposition'

/** Opaque, encrypted vault field containing Pi's canonical OAuth credential. */
export const PI_OAUTH_CREDENTIAL_FIELD_ID_V1 = 'pi-oauth-v1' as CredentialFieldId
export function actorCredentialProviderIdV1(userId: string, providerId: string): ProviderId {
  if (!userId.trim()) throw new TypeError('userId must be non-empty')
  return `boring.actor.v1/${credentialCustodySubjectKeyV1({ kind: 'user', userId })}/${providerId}` as ProviderId
}
const MAX_OAUTH_CREDENTIAL_BYTES = 64 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

export interface VaultCredentialStoreOptionsV1 {
  readonly workspaceId: string
  /** Verified actor identity. Required whenever subscription OAuth is enabled. */
  readonly userId?: string
  readonly vaultBackend: VaultCredentialStoreBackendV1
  /** Subscription OAuth is interactive-only; unattended seats set this false. */
  readonly allowSubscriptionOAuth: boolean
  /** Login-only stores may replace an actor's revoked OAuth tombstone. */
  readonly allowRevokedOAuthReplacement?: boolean
  readonly allowedOAuthProviderIds?: readonly string[]
}

function abortIfNeeded(options?: AuthOperationOptions): void {
  if (options?.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
}

function cloneCredential(credential: Credential | undefined): Credential | undefined {
  return credential === undefined ? undefined : structuredClone(credential)
}

function parseOAuthCredential(bytes: Uint8Array): OAuthCredential {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OAUTH_CREDENTIAL_BYTES) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.UNREADABLE, 'Stored OAuth credential is invalid')
  }
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.UNREADABLE, 'Stored OAuth credential is invalid')
  }
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || (value as { type?: unknown }).type !== 'oauth'
    || typeof (value as { refresh?: unknown }).refresh !== 'string'
    || typeof (value as { access?: unknown }).access !== 'string'
    || typeof (value as { expires?: unknown }).expires !== 'number'
    || !Number.isFinite((value as { expires: number }).expires)
  ) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.UNREADABLE, 'Stored OAuth credential is invalid')
  }
  return value as OAuthCredential
}

function encodeOAuthCredential(credential: OAuthCredential): Uint8Array {
  const bytes = encoder.encode(JSON.stringify(credential))
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OAUTH_CREDENTIAL_BYTES) {
    bytes.fill(0)
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'OAuth credential is too large')
  }
  return bytes
}

/**
 * Adapts Pi's async CredentialStore to one authorized workspace's encrypted
 * vault. The adapter is actor-bound at construction and never accepts a
 * workspace id from callers. Pi remains the sole owner of login and refresh.
 */
export function createVaultCredentialStoreV1(options: VaultCredentialStoreOptionsV1): CredentialStore {
  if (!options.workspaceId.trim()) throw new TypeError('workspaceId must be non-empty')
  if (options.allowSubscriptionOAuth && !options.userId?.trim()) {
    throw new TypeError('verified userId is required for subscription OAuth')
  }
  const oauthProviders = new Set(options.allowedOAuthProviderIds ?? ['openai-codex'])
  const chains = new Map<string, Promise<void>>()
  // Internal persistence/anchor identity. Existing unprefixed rows remain
  // explicit workspace-scoped API-key fallback credentials.
  const personalProviderId = (providerId: string): ProviderId =>
    actorCredentialProviderIdV1(options.userId!, providerId)
  const storedProviderId = (providerId: string, type: 'oauth' | 'api-key'): ProviderId =>
    type === 'oauth' ? personalProviderId(providerId) : providerId as ProviderId

  const enqueue = async <T>(providerId: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(providerId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    chains.set(providerId, tail)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (chains.get(providerId) === tail) chains.delete(providerId)
    }
  }

  const readFrom = async (
    backend: VaultCredentialStoreBackendV1,
    providerId: string,
    operation?: AuthOperationOptions,
  ): Promise<Credential | undefined> => {
    abortIfNeeded(operation)
    const personalId = options.allowSubscriptionOAuth && oauthProviders.has(providerId)
      ? personalProviderId(providerId)
      : undefined
    const personalMetadata = personalId
      ? await backend.getCredentialMetadata(options.workspaceId, personalId)
      : undefined
    const effectiveProviderId = personalMetadata ? personalId! : providerId as ProviderId
    const metadata = personalMetadata
      ?? await backend.getCredentialMetadata(options.workspaceId, effectiveProviderId)
    if (!metadata) return undefined
    // Before actor custody, OAuth rows were workspace-scoped. Never expose or
    // refresh those ambiguous legacy rows: each user must authenticate again.
    // Unprefixed API-key rows remain the explicit workspace fallback.
    if (!personalMetadata && metadata.credentialType === 'oauth') return undefined
    // A known non-active vault entry is an explicit deny, not absence. Ask the
    // backend for its stable lifecycle error so Pi cannot fall through to an
    // instance/environment credential.
    if (metadata.state !== 'active') {
      await backend.read(
        options.workspaceId,
        effectiveProviderId,
        metadata.credentialType === 'api-key'
          ? [LLM_API_KEY_FIELD_ID_V1]
          : [PI_OAUTH_CREDENTIAL_FIELD_ID_V1],
      )
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.UNREADABLE, 'Credential lifecycle state is invalid')
    }
    if (metadata.credentialType === 'oauth') {
      if (!options.allowSubscriptionOAuth || !oauthProviders.has(providerId)) return undefined
      const resolved = await backend.read(
        options.workspaceId,
        effectiveProviderId,
        [PI_OAUTH_CREDENTIAL_FIELD_ID_V1],
      )
      if (resolved.kind !== 'field-set') return undefined
      const bytes = resolved.fields.get(PI_OAUTH_CREDENTIAL_FIELD_ID_V1)
      if (!bytes) return undefined
      try {
        return parseOAuthCredential(bytes)
      } finally {
        bytes.fill(0)
      }
    }
    if (metadata.credentialType === 'api-key') {
      const resolved = await backend.read(
        options.workspaceId,
        effectiveProviderId,
        [LLM_API_KEY_FIELD_ID_V1],
      )
      if (resolved.kind !== 'field-set') return undefined
      const bytes = resolved.fields.get(LLM_API_KEY_FIELD_ID_V1)
      if (!bytes) return undefined
      try {
        return { type: 'api_key', key: decoder.decode(bytes) }
      } finally {
        bytes.fill(0)
      }
    }
    return undefined
  }
  const read = (providerId: string, operation?: AuthOperationOptions) =>
    readFrom(options.vaultBackend, providerId, operation)

  const readForModify = async (
    backend: VaultCredentialStoreBackendV1,
    providerId: string,
    operation?: AuthOperationOptions,
  ): Promise<Credential | undefined> => {
    if (options.allowRevokedOAuthReplacement && oauthProviders.has(providerId)) {
      abortIfNeeded(operation)
      const metadata = await backend.getCredentialMetadata(options.workspaceId, personalProviderId(providerId))
      if (metadata?.credentialType === 'oauth' && metadata.state === 'revoked') return undefined
    }
    return readFrom(backend, providerId, operation)
  }

  const store: CredentialStore = {
    read,
    async list(operation?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
      abortIfNeeded(operation)
      const metadata = await options.vaultBackend.listCredentialMetadata(options.workspaceId)
      const result: CredentialInfo[] = []
      const personalPrefix = options.userId
        ? `boring.actor.v1/${encodeURIComponent(options.userId)}/`
        : undefined
      for (const item of metadata) {
        if (item.state !== 'active') continue
        if (item.credentialType === 'oauth' && personalPrefix && item.providerId.startsWith(personalPrefix)) {
          const providerId = item.providerId.slice(personalPrefix.length)
          if (options.allowSubscriptionOAuth && oauthProviders.has(providerId)) {
            result.push({ providerId, type: 'oauth' })
          }
        } else if (item.credentialType === 'api-key' && !item.providerId.startsWith('boring.actor.v1/')) {
          result.push({ providerId: item.providerId, type: 'api_key' })
        }
      }
      return result
    },
    modify(providerId, fn, operation) {
      return enqueue(providerId, () => options.vaultBackend.withWorkspaceLock(
        options.workspaceId,
        async (lockedBackend) => {
          abortIfNeeded(operation)
          const current = await readForModify(lockedBackend, providerId, operation)
          const next = await fn(cloneCredential(current))
          abortIfNeeded(operation)
          if (next === undefined) return current
          if (next.type === 'oauth') {
            if (!options.allowSubscriptionOAuth || !oauthProviders.has(providerId)) {
              throw new CredentialResolutionError(
                CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
                'OAuth funding is not allowed for this agent runtime',
              )
            }
            const encoded = encodeOAuthCredential(next)
            try {
              await lockedBackend.writeCredentialFields({
                workspaceId: options.workspaceId,
                providerId: storedProviderId(providerId, 'oauth'),
                fields: new Map([[PI_OAUTH_CREDENTIAL_FIELD_ID_V1, encoded]]),
                metadata: { displayLabel: 'OpenAI Codex', credentialType: 'oauth' },
              })
            } finally {
              encoded.fill(0)
            }
          } else {
            if (typeof next.key !== 'string' || next.key.length === 0) {
              throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'API key credential is invalid')
            }
            const encoded = encoder.encode(next.key)
            try {
              await lockedBackend.writeCredentialFields({
                workspaceId: options.workspaceId,
                providerId: storedProviderId(providerId, 'api-key'),
                fields: new Map([[LLM_API_KEY_FIELD_ID_V1, encoded]]),
                metadata: {
                  displayLabel: providerId,
                  credentialType: 'api-key',
                  maskedLastFourSuffix: next.key.slice(-4),
                },
              })
            } finally {
              encoded.fill(0)
            }
          }
          return cloneCredential(next)
        },
      ))
    },
    delete(providerId, operation) {
      return enqueue(providerId, async () => {
        abortIfNeeded(operation)
        await options.vaultBackend.writeAbsentCredential(
          options.workspaceId,
          options.allowSubscriptionOAuth && oauthProviders.has(providerId)
            ? personalProviderId(providerId)
            : providerId as ProviderId,
        )
      })
    },
  }
  return Object.freeze(store)
}
