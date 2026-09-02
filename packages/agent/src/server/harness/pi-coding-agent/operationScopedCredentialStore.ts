import type { RunContext, TrustedAgentExecutionClass } from '../../../shared/harness.js'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials/errors.js'
import type { SessionCtx } from '../../../shared/session.js'
import type { PiHarnessCredentialStore } from './createHarness.js'

const ACTOR_SCOPED_PROVIDER_ID = 'openai-codex'

export const ACTOR_CREDENTIAL_CONTEXT_MISSING = CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID
export const ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN = CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN

export interface VerifiedCredentialOperationActor {
  readonly workspaceId: string
  readonly userId: string
  readonly executionClass: TrustedAgentExecutionClass
}

export interface OperationScopedCredentialStoreOptions {
  readonly sessionCtx: Readonly<SessionCtx>
  /** Returns only a currently active operation lease; detached descendants return undefined. */
  readonly getRunContext: () => RunContext | undefined
  /** Existing Pi env/file-compatible behavior for providers outside actor policy. */
  readonly compatibilityStore: PiHarnessCredentialStore
  /** Must return a store closed over the immutable, verifier-derived actor. */
  readonly resolveActorStore: (
    actor: Readonly<VerifiedCredentialOperationActor>,
  ) => PiHarnessCredentialStore | Promise<PiHarnessCredentialStore>
}

function credentialError(
  code: typeof CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID | typeof CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
  message: string,
): CredentialResolutionError {
  return new CredentialResolutionError(code, message)
}

/**
 * Delegates only OpenAI Codex credential operations from the live request lease.
 * No actor or inner actor store is cached on the shared Pi runtime.
 */
export function createOperationScopedCredentialStore(
  options: OperationScopedCredentialStoreOptions,
): PiHarnessCredentialStore {
  const sessionWorkspaceId = options.sessionCtx.workspaceId

  const actorForOperation = async (): Promise<Readonly<VerifiedCredentialOperationActor>> => {
    const ctx = options.getRunContext()
    const operationAuthority = ctx?.credentialAuthority
    if (!ctx?.userId || !operationAuthority || !sessionWorkspaceId) {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
        'credential operation authority is missing or expired',
      )
    }
    if (ctx.executionClass !== 'request-attached-interactive') {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
        'credential delivery is forbidden for this operation',
      )
    }

    let authority
    try {
      authority = await operationAuthority.verifier.verifyCurrent(operationAuthority.scope)
    } catch {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
        'credential operation authority is invalid',
      )
    }
    const workspaceId = ctx.workspaceId ?? ctx.sessionCtx?.workspaceId
    if (
      authority.workspaceId !== sessionWorkspaceId ||
      workspaceId !== sessionWorkspaceId ||
      authority.principal.kind !== 'user' ||
      authority.principal.userId !== ctx.userId
    ) {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
        'credential delivery is forbidden for this operation',
      )
    }

    return Object.freeze({
      workspaceId: authority.workspaceId,
      userId: authority.principal.userId,
      executionClass: ctx.executionClass,
    })
  }

  const actorStore = async (): Promise<PiHarnessCredentialStore> => {
    return options.resolveActorStore(await actorForOperation())
  }

  return {
    async read(providerId, operationOptions) {
      if (providerId !== ACTOR_SCOPED_PROVIDER_ID) {
        return options.compatibilityStore.read(providerId, operationOptions)
      }
      return (await actorStore()).read(providerId, operationOptions)
    },

    async list(operationOptions) {
      const compatibility = (await options.compatibilityStore.list(operationOptions))
        .filter((entry) => entry.providerId !== ACTOR_SCOPED_PROVIDER_ID)
      let actor: PiHarnessCredentialStore
      try {
        actor = await actorStore()
      } catch (error) {
        if (
          error instanceof CredentialResolutionError &&
          (error.code === CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID ||
            error.code === CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN)
        ) {
          return compatibility
        }
        throw error
      }
      const actorEntries = (await actor.list(operationOptions))
        .filter((entry) => entry.providerId === ACTOR_SCOPED_PROVIDER_ID)
      return [...compatibility, ...actorEntries]
    },

    async modify(providerId, modify, operationOptions) {
      if (providerId !== ACTOR_SCOPED_PROVIDER_ID) {
        return options.compatibilityStore.modify(providerId, modify, operationOptions)
      }
      return (await actorStore()).modify(providerId, modify, operationOptions)
    },

    async delete(providerId, operationOptions) {
      if (providerId !== ACTOR_SCOPED_PROVIDER_ID) {
        return options.compatibilityStore.delete(providerId, operationOptions)
      }
      return (await actorStore()).delete(providerId, operationOptions)
    },
  }
}
