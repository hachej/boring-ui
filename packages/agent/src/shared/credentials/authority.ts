/**
 * Opaque, in-process Core capability. The brand symbol and constructor are not
 * exported; Core records issued object identity in a private WeakMap.
 */
declare const authorizedWorkspaceCredentialScopeBrand: unique symbol
export interface AuthorizedWorkspaceCredentialScopeV1 {
  readonly contractVersion: "boring.authorized-workspace-credential-scope.v1"
  readonly [authorizedWorkspaceCredentialScopeBrand]: true
}

export type VerifiedWorkspaceCredentialPrincipalV1 =
  | Readonly<{
      kind: "user"
      userId: string
      membershipRole: "owner" | "editor" | "viewer"
    }>
  | Readonly<{
      kind: "system"
      principalId: string
      workspaceGrantId: string
    }>

export interface VerifiedWorkspaceCredentialAuthorityV1 {
  readonly workspaceId: string
  readonly appId: string
  readonly principal: VerifiedWorkspaceCredentialPrincipalV1
  readonly authorizationReceiptId: string
  readonly expiresAt: string
}

/** Core-owned verifier; a TypeScript cast or copied object is never authority. */
export interface WorkspaceCredentialAuthorityVerifierV1 {
  readonly contractVersion: "boring.workspace-credential-authority-verifier.v1"
  verifyCurrent(
    scope: AuthorizedWorkspaceCredentialScopeV1,
  ): Promise<VerifiedWorkspaceCredentialAuthorityV1>
}
