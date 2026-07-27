import type {
  AuthorizedWorkspaceCredentialScopeV1,
  ProviderCredentialRefV1,
  ResolvedCredentialLeaseV1,
  WorkspaceCredentialResolverV1,
} from '../../shared/credentials'

export async function withResolvedCredential<T>(
  resolver: WorkspaceCredentialResolverV1,
  workspace: AuthorizedWorkspaceCredentialScopeV1,
  ref: ProviderCredentialRefV1,
  fn: (lease: ResolvedCredentialLeaseV1) => T | Promise<T>,
): Promise<T> {
  const lease = await resolver.resolve(workspace, ref)
  try {
    return await fn(lease)
  } finally {
    lease.dispose()
  }
}
