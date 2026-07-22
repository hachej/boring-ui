import type { AuthorizedWorkspaceCredentialScopeV1 } from './authority'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from './errors'
import type { ProviderCredentialRefV1 } from './ref'
import type {
  CredentialConsumerBindingId,
  CredentialFieldId,
} from './registry'

/** Reference-only request owned by the SandboxProvider/SBX1 protocol seam. */
export interface SandboxCredentialDeliveryRequestV1 {
  readonly contractVersion: "boring.sandbox-credential-delivery.v1"
  readonly workspaceId: string
  readonly sandboxId: string
  readonly executionId: string
  readonly deliveryAttemptId: string
  readonly ref: ProviderCredentialRefV1
}

export const SANDBOX_CREDENTIAL_MAX_FIELDS_V1 = 16
export const SANDBOX_CREDENTIAL_MAX_METADATA_BYTES_V1 = 16_384
export const SANDBOX_CREDENTIAL_MAX_TOTAL_BYTES_V1 = 65_536

/** Secret-bearing, one-shot payload. Never JSON/string/base64 serialized. */
export interface SandboxCredentialSecretPayloadV1 {
  readonly contractVersion: "boring.sandbox-credential-secret-payload.v1"
  readonly workspaceId: string
  readonly sandboxId: string
  readonly executionId: string
  readonly deliveryAttemptId: string
  readonly bindingId: CredentialConsumerBindingId
  readonly credentialVersion: number
  readonly expiresAt: string
  readonly fields: readonly Readonly<{
    fieldId: CredentialFieldId
    value: Uint8Array
  }>[]
}

export interface SandboxCredentialSecretPayloadLeaseV1 {
  readonly payload: SandboxCredentialSecretPayloadV1
  dispose(): void
}

/**
 * Tier 2 DEFERRED — gated behind hostile-test harness + red-team per amendment D.
 * Host callback supplied to SandboxProvider composition; it verifies current
 * workspace authority and exact sandbox binding before decrypting.
 */
export interface SandboxCredentialPayloadResolverV1 {
  readonly contractVersion: "boring.sandbox-credential-payload-resolver.v1"
  resolveForDelivery(
    workspace: AuthorizedWorkspaceCredentialScopeV1,
    request: SandboxCredentialDeliveryRequestV1,
  ): Promise<SandboxCredentialSecretPayloadLeaseV1>
}

/** Value-free receipt checked before and after one sandbox execution. */
export interface SandboxCredentialDeliveryReceiptV1 {
  readonly contractVersion: "boring.sandbox-credential-delivery-receipt.v1"
  readonly workspaceId: string
  readonly sandboxId: string
  readonly executionId: string
  readonly deliveryAttemptId: string
  readonly bindingId: CredentialConsumerBindingId
  readonly channel: "fd-3" | "tmpfs-v1"
  readonly deliveredFieldIds: readonly CredentialFieldId[]
}

/** Tier 2 is intentionally unavailable until bead 16f.6. */
export function createNotImplementedSandboxCredentialPayloadResolverV1(): SandboxCredentialPayloadResolverV1 {
  return Object.freeze({
    contractVersion: 'boring.sandbox-credential-payload-resolver.v1' as const,
    async resolveForDelivery(): Promise<never> {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
        'Tier-2 in-sandbox injection not implemented in v1 (deferred to 16f.6)',
      )
    },
  })
}
