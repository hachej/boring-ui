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
} from '../../shared/credentials'
import type { CredentialFieldId, ProviderId } from '../../shared/credentials'
import type { VaultCredentialStoreBackendV1 } from './vault'
import { LLM_API_KEY_FIELD_ID_V1 } from './startupComposition'

/** Opaque, encrypted vault field containing Pi's canonical OAuth credential. */
export const PI_OAUTH_CREDENTIAL_FIELD_ID_V1 = 'pi-oauth-v1' as CredentialFieldId
const MAX_OAUTH_CREDENTIAL_BYTES = 64 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

export interface VaultCredentialStoreOptionsV1 {
  readonly workspaceId: string
  readonly vaultBackend: VaultCredentialStoreBackendV1
  /** Subscription OAuth is interactive-only; unattended seats set this false. */
  readonly allowSubscriptionOAuth: boolean
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
  const oauthProviders = new Set(options.allowedOAuthProviderIds ?? ['openai-codex'])
  const chains = new Map<string, Promise<void>>()

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

  const read = async (providerId: string, operation?: AuthOperationOptions): Promise<Credential | undefined> => {
    abortIfNeeded(operation)
    const metadata = await options.vaultBackend.getCredentialMetadata(options.workspaceId, providerId as ProviderId)
    if (!metadata || metadata.state !== 'active') return undefined
    if (metadata.credentialType === 'oauth') {
      if (!options.allowSubscriptionOAuth || !oauthProviders.has(providerId)) return undefined
      const resolved = await options.vaultBackend.read(
        options.workspaceId,
        providerId as ProviderId,
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
      const resolved = await options.vaultBackend.read(
        options.workspaceId,
        providerId as ProviderId,
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

  const store: CredentialStore = {
    read,
    async list(operation?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
      abortIfNeeded(operation)
      const metadata = await options.vaultBackend.listCredentialMetadata(options.workspaceId)
      const result: CredentialInfo[] = []
      for (const item of metadata) {
        if (item.state !== 'active') continue
        if (item.credentialType === 'oauth' && options.allowSubscriptionOAuth && oauthProviders.has(item.providerId)) {
          result.push({ providerId: item.providerId, type: 'oauth' })
        } else if (item.credentialType === 'api-key') {
          result.push({ providerId: item.providerId, type: 'api_key' })
        }
      }
      return result
    },
    modify(providerId, fn, operation) {
      return enqueue(providerId, async () => {
        abortIfNeeded(operation)
        const current = await read(providerId, operation)
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
            await options.vaultBackend.writeCredentialFields({
              workspaceId: options.workspaceId,
              providerId: providerId as ProviderId,
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
            await options.vaultBackend.writeCredentialFields({
              workspaceId: options.workspaceId,
              providerId: providerId as ProviderId,
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
      })
    },
    delete(providerId, operation) {
      return enqueue(providerId, async () => {
        abortIfNeeded(operation)
        await options.vaultBackend.writeAbsentCredential(options.workspaceId, providerId as ProviderId)
      })
    },
  }
  return Object.freeze(store)
}
