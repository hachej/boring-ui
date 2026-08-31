import type { ExtractedSandboxProviderIdV1 } from './providerV1'

export const IMMUTABLE_SANDBOX_CACHE_SOURCE_VERSION_V1 = 'boring.sandbox-cache-source.v1' as const

/**
 * Host-resolved reference to an immutable provider artifact.
 *
 * This contract belongs to trusted host/provider composition. It must never be
 * projected into Worker tool inputs or results.
 */
export interface ImmutableSandboxCacheSourceV1 {
  readonly contractVersion: typeof IMMUTABLE_SANDBOX_CACHE_SOURCE_VERSION_V1
  readonly providerId: ExtractedSandboxProviderIdV1
  readonly opaqueRef: string
}
