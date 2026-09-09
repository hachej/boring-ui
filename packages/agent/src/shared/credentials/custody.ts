import { CREDENTIAL_ERROR_CODES, CredentialResolutionError } from './errors'

/** Immutable owner of credential material inside one workspace. */
export type CredentialCustodySubjectV1 =
  | Readonly<{ kind: 'workspace' }>
  | Readonly<{ kind: 'user'; userId: string }>

export interface CredentialCustodyScopeV1 {
  readonly workspaceId: string
  readonly subject: CredentialCustodySubjectV1
}

export function workspaceCredentialCustodyScopeV1(workspaceId: string): CredentialCustodyScopeV1 {
  return assertCredentialCustodyScopeV1({ workspaceId, subject: { kind: 'workspace' } })
}

export function userCredentialCustodyScopeV1(workspaceId: string, userId: string): CredentialCustodyScopeV1 {
  return assertCredentialCustodyScopeV1({ workspaceId, subject: { kind: 'user', userId } })
}

export function assertCredentialCustodyScopeV1(scope: CredentialCustodyScopeV1): CredentialCustodyScopeV1 {
  if (
    !scope || typeof scope.workspaceId !== 'string' || scope.workspaceId.length === 0
    || !scope.subject || (scope.subject.kind !== 'workspace' && scope.subject.kind !== 'user')
    || (scope.subject.kind === 'user' && (typeof scope.subject.userId !== 'string' || scope.subject.userId.length === 0))
  ) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Invalid credential custody scope')
  }
  return Object.freeze({
    workspaceId: scope.workspaceId,
    subject: scope.subject.kind === 'workspace'
      ? Object.freeze({ kind: 'workspace' as const })
      : Object.freeze({ kind: 'user' as const, userId: scope.subject.userId }),
  })
}

/** Canonical path-safe anchor/cache/lock identity. */
export function credentialCustodySubjectKeyV1(subject: CredentialCustodySubjectV1): string {
  return subject.kind === 'workspace' ? 'workspace' : encodeURIComponent(subject.userId)
}
