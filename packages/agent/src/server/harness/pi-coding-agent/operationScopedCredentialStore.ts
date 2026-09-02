import type { RunContext, TrustedAgentExecutionClass } from '../../../shared/harness.js'
import type { SessionCtx } from '../../../shared/session.js'
import type { PiHarnessCredentialStore } from './createHarness.js'

export const ACTOR_CREDENTIAL_CONTEXT_MISSING = 'CREDENTIAL_ACTOR_CONTEXT_MISSING'
export const ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN = 'CREDENTIAL_DELIVERY_FORBIDDEN'

export interface VerifiedCredentialOperationActor {
  readonly workspaceId: string
  readonly userId: string
  readonly executionClass: TrustedAgentExecutionClass
}

export interface OperationScopedCredentialStoreOptions {
  readonly sessionCtx: Readonly<SessionCtx>
  readonly getRunContext: () => RunContext | undefined
  /** Providers governed by actor policy. They never fall through to compatibility storage. */
  readonly actorScopedProviderIds: readonly string[]
  /** Existing Pi env/file-compatible behavior for providers outside actor policy. */
  readonly compatibilityStore: PiHarnessCredentialStore
  /** Must return a store closed over the immutable actor supplied for this operation. */
  readonly resolveActorStore: (
    actor: Readonly<VerifiedCredentialOperationActor>,
  ) => PiHarnessCredentialStore | Promise<PiHarnessCredentialStore>
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/**
 * Delegates every actor-scoped credential operation from the live request ALS
 * context. No actor or inner actor store is cached on the shared Pi runtime.
 */
export function createOperationScopedCredentialStore(
  options: OperationScopedCredentialStoreOptions,
): PiHarnessCredentialStore {
  const actorProviders = new Set(options.actorScopedProviderIds)
  const sessionWorkspaceId = options.sessionCtx.workspaceId

  const actorForOperation = (): Readonly<VerifiedCredentialOperationActor> => {
    const ctx = options.getRunContext()
    const workspaceId = ctx?.workspaceId ?? ctx?.sessionCtx?.workspaceId
    if (!ctx?.userId || !workspaceId || !sessionWorkspaceId) {
      throw codedError(ACTOR_CREDENTIAL_CONTEXT_MISSING, 'verified credential actor context is missing')
    }
    if (
      workspaceId !== sessionWorkspaceId ||
      ctx.executionClass !== 'request-attached-interactive'
    ) {
      throw codedError(ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN, 'credential delivery is forbidden for this operation')
    }
    return Object.freeze({
      workspaceId,
      userId: ctx.userId,
      executionClass: ctx.executionClass,
    })
  }

  const actorStore = async (): Promise<PiHarnessCredentialStore> => {
    return options.resolveActorStore(actorForOperation())
  }

  return {
    async read(providerId, operationOptions) {
      if (!actorProviders.has(providerId)) {
        return options.compatibilityStore.read(providerId, operationOptions)
      }
      return (await actorStore()).read(providerId, operationOptions)
    },

    async list(operationOptions) {
      const compatibility = (await options.compatibilityStore.list(operationOptions))
        .filter((entry) => !actorProviders.has(entry.providerId))
      let actor: PiHarnessCredentialStore
      try {
        actor = await actorStore()
      } catch (error) {
        const code = (error as { code?: unknown }).code
        if (code === ACTOR_CREDENTIAL_CONTEXT_MISSING || code === ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN) {
          return compatibility
        }
        throw error
      }
      const actorEntries = (await actor.list(operationOptions))
        .filter((entry) => actorProviders.has(entry.providerId))
      return [...compatibility, ...actorEntries]
    },

    async modify(providerId, modify, operationOptions) {
      if (!actorProviders.has(providerId)) {
        return options.compatibilityStore.modify(providerId, modify, operationOptions)
      }
      return (await actorStore()).modify(providerId, modify, operationOptions)
    },

    async delete(providerId, operationOptions) {
      if (!actorProviders.has(providerId)) {
        return options.compatibilityStore.delete(providerId, operationOptions)
      }
      return (await actorStore()).delete(providerId, operationOptions)
    },
  }
}
