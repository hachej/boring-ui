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
 * S1 supplies both in-memory and Postgres implementations. Only ciphertext,
 * nonce, tag, persisted AAD, and metadata-only tombstones cross this port —
 * never plaintext, never a KEK.
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
  /** Required when persisting a live envelope; omitted for keyed reads. */
  readonly dekGeneration?: number
  readonly fieldId: string
}

export type CredentialFieldDeletionReasonV1 =
  | 'superseded-version'
  | 'credential-tombstone'

export interface CredentialFieldTombstoneV1 {
  readonly deletedAt: string
  readonly reason: CredentialFieldDeletionReasonV1
}

export interface CommitCredentialVersionInputV1 {
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly expectedCredentialVersion: number
  readonly record: StoredCredentialRecordV1
  readonly fields: ReadonlyMap<string, CredentialEnvelopeV1>
  readonly supersededFieldsTombstone?: CredentialFieldTombstoneV1
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
  /** Atomically CASes the record, fields, and superseded-version tombstones. */
  commitCredentialVersion(input: CommitCredentialVersionInputV1): Promise<void>
  getWrappedDek(
    workspaceId: string,
    dekGeneration: number,
  ): Promise<WrappedWorkspaceDekV1 | undefined>
  putWrappedDek(
    workspaceId: string,
    dekGeneration: number,
    wrapped: WrappedWorkspaceDekV1,
  ): Promise<void>
  deleteWrappedDek(workspaceId: string, dekGeneration: number): Promise<void>
  getField(key: CredentialFieldKeyV1): Promise<CredentialEnvelopeV1 | undefined>
  putField(
    key: CredentialFieldKeyV1,
    envelope: CredentialEnvelopeV1,
  ): Promise<void>
  /** Deletes ciphertext and retains metadata-only tombstones for every field. */
  tombstoneCredentialVersionFields(
    workspaceId: string,
    providerId: ProviderId,
    credentialVersion: number,
    tombstone: CredentialFieldTombstoneV1,
  ): Promise<void>
  getFieldTombstone(
    key: CredentialFieldKeyV1,
  ): Promise<CredentialFieldTombstoneV1 | undefined>
}
