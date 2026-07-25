import type { CredentialConsumerBindingRegistryV1 } from './bindings'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from './errors'
import type {
  CredentialConsumerBindingId,
  ProviderId,
} from './registry'

export const PROVIDER_CREDENTIAL_REF_VERSION =
  "boring.provider-credential-ref.v1" as const

/** Constructed by a trusted factory from a registered binding. */
export interface ProviderCredentialRefV1 {
  readonly contractVersion: typeof PROVIDER_CREDENTIAL_REF_VERSION
  readonly providerId: ProviderId
  readonly executionId: string
  readonly bindingId: CredentialConsumerBindingId
}

export interface ProviderCredentialRefFactoryV1 {
  readonly contractVersion: "boring.provider-credential-ref-factory.v1"
  create(input: Readonly<{
    providerId: ProviderId
    executionId: string
    bindingId: CredentialConsumerBindingId
  }>): ProviderCredentialRefV1
}

const MAX_EXECUTION_ID_LENGTH_V1 = 256

export function createProviderCredentialRefFactoryV1(
  bindingRegistry: CredentialConsumerBindingRegistryV1,
): ProviderCredentialRefFactoryV1 {
  return Object.freeze({
    contractVersion: 'boring.provider-credential-ref-factory.v1' as const,
    create(input: Readonly<{
      providerId: ProviderId
      executionId: string
      bindingId: CredentialConsumerBindingId
    }>): ProviderCredentialRefV1 {
      const binding = bindingRegistry.require(input.bindingId)
      if (binding.providerId !== input.providerId) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
          'Credential reference does not match its registered consumer binding',
        )
      }
      if (
        typeof input.executionId !== 'string'
        || input.executionId.trim().length === 0
        || input.executionId.length > MAX_EXECUTION_ID_LENGTH_V1
      ) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
          'Invalid credential execution id',
        )
      }

      return Object.freeze({
        contractVersion: PROVIDER_CREDENTIAL_REF_VERSION,
        providerId: binding.providerId,
        executionId: input.executionId,
        bindingId: binding.id,
      })
    },
  })
}
