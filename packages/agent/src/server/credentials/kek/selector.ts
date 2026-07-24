import type {
  GeneratedWorkspaceDekV1,
  WorkspaceKekContextV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  WORKSPACE_KEK_PROVIDER_VERSION,
} from '../../../shared/credentials'
import { constantTimeTextEqualV1 } from '../canonicalEncoding'
import { assertWrappedWorkspaceDekV1 } from '../wrappedDek'

function backendUnavailable(retryable = false): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    'Credential KEK backend is unavailable',
    { retryable },
  )
}

function unreadable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    'Wrapped workspace key is unreadable',
  )
}

function isAllZero(bytes: Uint8Array): boolean {
  let aggregate = 0
  for (const byte of bytes) aggregate |= byte
  return aggregate === 0
}

function validateProvider(provider: WorkspaceKekProviderV1): void {
  if (
    !provider
    || provider.contractVersion !== WORKSPACE_KEK_PROVIDER_VERSION
    || typeof provider.providerId !== 'string'
    || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider.providerId)
  ) {
    throw backendUnavailable()
  }
}

function requireSelectedProvider(
  provider: WorkspaceKekProviderV1,
  wrapped: WrappedWorkspaceDekV1,
): void {
  if (
    !wrapped
    || typeof wrapped.providerId !== 'string'
    || !constantTimeTextEqualV1(wrapped.providerId, provider.providerId)
  ) {
    throw backendUnavailable()
  }
}

function validateGenerated(
  provider: WorkspaceKekProviderV1,
  generated: GeneratedWorkspaceDekV1,
): GeneratedWorkspaceDekV1 {
  if (
    !generated
    || !(generated.plaintextDek instanceof Uint8Array)
    || generated.plaintextDek.byteLength !== 32
    || isAllZero(generated.plaintextDek)
  ) {
    generated?.plaintextDek?.fill(0)
    throw backendUnavailable()
  }
  try {
    assertWrappedWorkspaceDekV1(generated.wrappedDek)
    requireSelectedProvider(provider, generated.wrappedDek)
  } catch (error) {
    generated.plaintextDek.fill(0)
    throw error
  }
  return generated
}

/** Immutable one-backend startup selector. It never probes a fallback backend. */
export function createWorkspaceKekProviderSelectorV1(
  selectedProvider: WorkspaceKekProviderV1,
): WorkspaceKekProviderV1 {
  validateProvider(selectedProvider)

  return Object.freeze({
    contractVersion: WORKSPACE_KEK_PROVIDER_VERSION,
    providerId: selectedProvider.providerId,
    async readiness() {
      try {
        return await selectedProvider.readiness()
      } catch {
        return { ready: false, reasonCode: 'KEK_BACKEND_READINESS_FAILED' }
      }
    },
    async generateDataKey(
      context: WorkspaceKekContextV1,
    ): Promise<GeneratedWorkspaceDekV1> {
      try {
        return validateGenerated(
          selectedProvider,
          await selectedProvider.generateDataKey(context),
        )
      } catch (error) {
        if (error instanceof CredentialResolutionError) throw error
        throw backendUnavailable(true)
      }
    },
    async unwrapDataKey(
      context: WorkspaceKekContextV1,
      wrapped: WrappedWorkspaceDekV1,
    ): Promise<Uint8Array> {
      assertWrappedWorkspaceDekV1(wrapped)
      requireSelectedProvider(selectedProvider, wrapped)
      try {
        const plaintextDek = await selectedProvider.unwrapDataKey(context, wrapped)
        if (
          !(plaintextDek instanceof Uint8Array)
          || plaintextDek.byteLength !== 32
          || isAllZero(plaintextDek)
        ) {
          plaintextDek?.fill(0)
          throw unreadable()
        }
        return plaintextDek
      } catch (error) {
        if (error instanceof CredentialResolutionError) throw error
        throw backendUnavailable(true)
      }
    },
    async rewrapDataKey(
      context: WorkspaceKekContextV1,
      wrapped: WrappedWorkspaceDekV1,
    ): Promise<WrappedWorkspaceDekV1> {
      assertWrappedWorkspaceDekV1(wrapped)
      requireSelectedProvider(selectedProvider, wrapped)
      if (!selectedProvider.rewrapDataKey) throw backendUnavailable()
      try {
        const rewrapped = await selectedProvider.rewrapDataKey(context, wrapped)
        assertWrappedWorkspaceDekV1(rewrapped)
        requireSelectedProvider(selectedProvider, rewrapped)
        return rewrapped
      } catch (error) {
        if (error instanceof CredentialResolutionError) throw error
        throw backendUnavailable(true)
      }
    },
    async close(): Promise<void> {
      await selectedProvider.close?.()
    },
  })
}
