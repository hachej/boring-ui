import type { CredentialErrorCode } from './errors'

export type CredentialLifecycleStateV1 =
  | 'active'
  | 'disabled'
  | 'revoked'
  | 'needs_reauth'
  | 'intentionally_absent'
  | 'instance_fallback_enabled'

/** Metadata-only HTTP contract. No secret-bearing property exists on response DTOs. */
export interface OAuthRevocationReceiptV1 {
  readonly localStatus: 'revoked'
  /** Pending means Pi provided no verifiable upstream revocation confirmation. */
  readonly upstreamStatus: 'pending' | 'confirmed'
  readonly attemptedAt: string
}

export interface CredentialMetadataV1 {
  readonly providerId: string
  readonly displayName: string
  readonly credentialType: string
  readonly state: CredentialLifecycleStateV1 | 'not_configured'
  readonly credentialVersion?: number
  readonly maskedLastFourSuffix?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly oauthRevocation?: OAuthRevocationReceiptV1
}

export interface CredentialMetadataListResponseV1 {
  readonly credentials: readonly CredentialMetadataV1[]
}

export interface CredentialWriteRequestV1 {
  readonly displayLabel?: string
  readonly fields: Readonly<Record<string, string>>
}

export type CredentialKeyLifecycleOperationV1 = 'rotate' | 'rewrap' | 'crypto-shred'

/** Metadata-only, caller-supplied-idempotency receipt; never includes key material. */
export interface CredentialKeyLifecycleReceiptV1 {
  readonly contractVersion: 'boring.credential-key-lifecycle-receipt.v1'
  readonly operation: CredentialKeyLifecycleOperationV1
  readonly workspaceId: string
  readonly operationId: string
  readonly status: 'completed'
  readonly dekGeneration?: number
}

export interface CredentialRouteErrorV1 {
  readonly error: {
    readonly code: CredentialErrorCode
    readonly message: string
  }
}
