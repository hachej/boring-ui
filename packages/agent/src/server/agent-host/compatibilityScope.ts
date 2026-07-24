import type {
  AgentScopeVerifier,
  AuthorizedAgentScope,
  VerifiedAgentScopeClaim,
} from '../../shared/index'

/** Private provenance-checked scope issuer used only by legacy in-process wrappers. */
export function createCompatibilityScopeIssuer<Context>() {
  const contexts = new WeakMap<object, Context>()

  function issue(
    claim: VerifiedAgentScopeClaim,
    context: Context,
  ): AuthorizedAgentScope {
    const scope = Object.freeze({
      workspaceScopeId: claim.workspaceScopeId,
      authSubjectId: claim.authSubjectId,
    }) as AuthorizedAgentScope
    contexts.set(scope as object, context)
    return scope
  }

  const verifier: AgentScopeVerifier = {
    async verify(scope) {
      if (!contexts.has(scope as object)) throw new Error('scope was not issued by this compatibility wrapper')
      return {
        workspaceScopeId: scope.workspaceScopeId,
        authSubjectId: scope.authSubjectId,
      }
    },
  }

  function context(scope: AuthorizedAgentScope): Context {
    const value = contexts.get(scope as object)
    if (value === undefined) throw new Error('scope was not issued by this compatibility wrapper')
    return value
  }

  return { issue, verifier, context }
}
