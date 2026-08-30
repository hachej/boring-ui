import { createHash } from 'node:crypto'

import type {
  DisposableSandboxProviderProfileV1,
  DisposableSandboxProviderV1,
  SandboxProviderV1,
} from '../shared/providerV1'

const PROFILE_VERSION = 'boring-sandbox.disposable-provider.v1' as const
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && typeof entry !== 'function')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  if (typeof value === 'bigint') return value.toString()
  return value
}

export function disposableProviderConfigDigestV1(
  providerId: string,
  behavior: Record<string, unknown>,
): `sha256:${string}` {
  const bytes = JSON.stringify(canonical({ providerId, behavior }))
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
/** Internal factory registration; intentionally absent from public package exports. */
export function registerDisposableSandboxProviderV1<T extends SandboxProviderV1>(
  provider: T,
  providerConfigDigest: `sha256:${string}`,
): T & DisposableSandboxProviderV1 {
  if (!SHA256_DIGEST.test(providerConfigDigest)) {
    throw new TypeError('disposable provider config identity must be sha256')
  }
  const profile: DisposableSandboxProviderProfileV1 = Object.freeze({
    contractVersion: PROFILE_VERSION,
    resume: false,
    publishedCleanupOwner: 'returned-pair',
    ambiguousCreate: 'correlated-reconciliation',
    providerConfigDigest,
  })
  Object.defineProperty(provider, 'disposableProfile', {
    configurable: false,
    enumerable: true,
    value: profile,
    writable: false,
  })
  return provider as T & DisposableSandboxProviderV1
}
