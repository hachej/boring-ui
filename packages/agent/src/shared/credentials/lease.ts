import type { AuthorizedWorkspaceCredentialScopeV1 } from './authority'
import type { ProviderCredentialRefV1 } from './ref'
import type { CredentialFieldId, ProviderId } from './registry'

export type ResolvedCredentialMaterialV1 =
  | Readonly<{
      kind: "field-set"
      fields: ReadonlyMap<CredentialFieldId, Uint8Array>
    }>
  | Readonly<{
      kind: "external-managed-account"
      custodianAdapterId: string
      opaqueAccountReference: Uint8Array
    }>
  | Readonly<{ kind: "none" }>

export interface ResolvedCredentialLeaseV1 {
  readonly contractVersion: "boring.resolved-credential.v1"
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly credentialVersion: number
  readonly executionId: string
  /** Server implementation may use a Node byte array; shared stays Uint8Array. */
  readonly material: ResolvedCredentialMaterialV1
  readonly expiresAt: string
  /** Idempotent best-effort overwrite and reference release. */
  dispose(): void
}

export interface WorkspaceCredentialResolverV1 {
  readonly contractVersion: "boring.workspace-credential-resolver.v1"
  resolve(
    workspace: AuthorizedWorkspaceCredentialScopeV1,
    ref: ProviderCredentialRefV1,
  ): Promise<ResolvedCredentialLeaseV1>
}
