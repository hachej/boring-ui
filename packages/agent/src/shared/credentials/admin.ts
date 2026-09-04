import type { CredentialErrorCode } from './errors'

export type CredentialLifecycleStateV1 =
  | 'active'
  | 'disabled'
  | 'revoked'
  | 'needs_reauth'
  | 'intentionally_absent'
  | 'instance_fallback_enabled'

/** Metadata-only HTTP contract. No secret-bearing property exists on response DTOs. */
export interface CredentialMetadataV1 {
  readonly providerId: string
  readonly displayName: string
  readonly credentialType: string
  readonly state: CredentialLifecycleStateV1 | 'not_configured'
  readonly credentialVersion?: number
  readonly maskedLastFourSuffix?: string
  readonly createdAt?: string
  readonly updatedAt?: string
}

export interface CredentialMetadataListResponseV1 {
  readonly credentials: readonly CredentialMetadataV1[]
}

export interface CredentialWriteRequestV1 {
  readonly displayLabel?: string
  readonly fields: Readonly<Record<string, string>>
}

export interface CredentialRouteErrorV1 {
  readonly error: {
    readonly code: CredentialErrorCode
    readonly message: string
  }
}
