import type { ProviderId } from '../../../shared/credentials'
import type {
  CredentialEnvelopeV1,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'

/**
 * Injectable persistence port for the credential vault.
 *
 * The ratified persistence model (docs/issues/820/byok-secret-vault-plan.md,
 * "Proposed persistence model") maps one-to-one onto these methods:
 * `workspace_provider_credentials` -> credential record,
 * `workspace_credential_keys` -> wrapped DEK,
 * `workspace_provider_credential_fields` -> field envelope.
 *
 * The Postgres implementation (schema + migration + backend selector) is a
 * later pass and deliberately out of scope for bead 16f.2. Only ciphertext,
 * nonce, tag and persisted AAD cross this port — never plaintext, never a KEK.
 */

export type CredentialMaterialKindV1 = 'field-set' | 'none'

export interface StoredCredentialRecordV1 {
  /** Stable per-(workspace, provider) credential identity, bound into AAD. */
  readonly credentialId: string
  readonly credentialVersion: number
  readonly dekGeneration: number
  readonly materialKind: CredentialMaterialKindV1
}

export interface CredentialFieldKeyV1 {
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly credentialVersion: number
  readonly fieldId: string
}

export interface CredentialVaultPersistenceV1 {
  getCredentialRecord(
    workspaceId: string,
    providerId: ProviderId,
  ): Promise<StoredCredentialRecordV1 | undefined>
  putCredentialRecord(
    workspaceId: string,
    providerId: ProviderId,
    record: StoredCredentialRecordV1,
  ): Promise<void>
  getWrappedDek(
    workspaceId: string,
    dekGeneration: number,
  ): Promise<WrappedWorkspaceDekV1 | undefined>
  putWrappedDek(
    workspaceId: string,
    dekGeneration: number,
    wrapped: WrappedWorkspaceDekV1,
  ): Promise<void>
  getField(key: CredentialFieldKeyV1): Promise<CredentialEnvelopeV1 | undefined>
  putField(
    key: CredentialFieldKeyV1,
    envelope: CredentialEnvelopeV1,
  ): Promise<void>
}
