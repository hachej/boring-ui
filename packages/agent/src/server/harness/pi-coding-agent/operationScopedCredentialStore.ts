import type { RunContext, TrustedAgentExecutionClass } from '../../../shared/harness.js'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials/errors.js'
import type { SessionCtx } from '../../../shared/session.js'
import type {
  PiHarnessCredentialOperationLease,
  PiHarnessCredentialStore,
} from './createHarness.js'

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
  /** Returns one revocable lease for the currently executing provider operation. */
  readonly getOperationLease: () => PiHarnessCredentialOperationLease | undefined
  /** Existing Pi env/file-compatible behavior for providers outside actor policy. */
  readonly compatibilityStore: PiHarnessCredentialStore
  /**
   * Must return a store closed over the immutable, verifier-derived actor.
   * Actor stores must honor AuthOperationOptions.signal before durable writes.
   */
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

function operationSignal(
  lease: PiHarnessCredentialOperationLease,
  callerSignal: AbortSignal | undefined,
): AbortSignal {
  if (!callerSignal || callerSignal === lease.signal) return lease.signal
  return AbortSignal.any([lease.signal, callerSignal])
}

function activeLease(
  options: OperationScopedCredentialStoreOptions,
): PiHarnessCredentialOperationLease {
  const lease = options.getOperationLease()
  if (!lease) {
    throw credentialError(
      CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
      'credential operation authority is missing or expired',
    )
  }
  lease.assertActive()
  return lease
}

/**
 * Delegates only OpenAI Codex credential operations from one revocable request
 * lease. No actor or inner actor store is cached on the shared Pi runtime.
 */
export function createOperationScopedCredentialStore(
  options: OperationScopedCredentialStoreOptions,
): PiHarnessCredentialStore {
  const sessionWorkspaceId = options.sessionCtx.workspaceId

  const actorForOperation = async (
    lease: PiHarnessCredentialOperationLease,
  ): Promise<Readonly<VerifiedCredentialOperationActor>> => {
    lease.assertActive()
    const ctx: RunContext = lease.context
    const operationAuthority = ctx.credentialAuthority
    if (!ctx.userId || !operationAuthority || !sessionWorkspaceId) {
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
      lease.assertActive()
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

    lease.assertActive()
    return Object.freeze({
      workspaceId: authority.workspaceId,
      userId: authority.principal.userId,
      executionClass: ctx.executionClass,
    })
  }

  const actorStore = async (
    lease: PiHarnessCredentialOperationLease,
  ): Promise<PiHarnessCredentialStore> => {
    const store = await options.resolveActorStore(await actorForOperation(lease))
    lease.assertActive()
    return store
  }

  return {
    async read(providerId, operationOptions) {
      if (providerId !== ACTOR_SCOPED_PROVIDER_ID) {
        return options.compatibilityStore.read(providerId, operationOptions)
      }
      const lease = activeLease(options)
      const store = await actorStore(lease)
      const credential = await store.read(providerId, {
        ...operationOptions,
        signal: operationSignal(lease, operationOptions?.signal),
      })
      lease.assertActive()
      return credential
    },

    async list(operationOptions) {
      const compatibility = (await options.compatibilityStore.list(operationOptions))
        .filter((entry) => entry.providerId !== ACTOR_SCOPED_PROVIDER_ID)
      let lease: PiHarnessCredentialOperationLease
      let actor: PiHarnessCredentialStore
      try {
        lease = activeLease(options)
        actor = await actorStore(lease)
        const actorEntries = (await actor.list({
          ...operationOptions,
          signal: operationSignal(lease, operationOptions?.signal),
        })).filter((entry) => entry.providerId === ACTOR_SCOPED_PROVIDER_ID)
        lease.assertActive()
        return [...compatibility, ...actorEntries]
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
    },

    async modify(providerId, modify, operationOptions) {
      if (providerId !== ACTOR_SCOPED_PROVIDER_ID) {
        return options.compatibilityStore.modify(providerId, modify, operationOptions)
      }
      const lease = activeLease(options)
      const store = await actorStore(lease)
      const result = await store.modify(providerId, async (current) => {
        lease.assertActive()
        const updated = await modify(current)
        lease.assertActive()
        return updated
      }, {
        ...operationOptions,
        signal: operationSignal(lease, operationOptions?.signal),
      })
      lease.assertActive()
      return result
    },

    async delete(providerId, operationOptions) {
      if (providerId !== ACTOR_SCOPED_PROVIDER_ID) {
        return options.compatibilityStore.delete(providerId, operationOptions)
      }
      const lease = activeLease(options)
      const store = await actorStore(lease)
      await store.delete(providerId, {
        ...operationOptions,
        signal: operationSignal(lease, operationOptions?.signal),
      })
      lease.assertActive()
    },
  }
}
