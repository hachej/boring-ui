import { expectTypeOf, test } from 'vitest'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  ProviderCredentialRefFactoryV1,
  ProviderCredentialRefV1,
  SandboxCredentialDeliveryRequestV1,
  SandboxCredentialPayloadResolverV1,
} from '..'

test('credential references cannot carry a caller workspace selector', () => {
  expectTypeOf<ProviderCredentialRefV1>().not.toHaveProperty('workspaceId')
  expectTypeOf<ProviderCredentialRefFactoryV1['create']>()
    .parameters.toEqualTypeOf<[
      Readonly<{
        providerId: ProviderCredentialRefV1['providerId']
        executionId: string
        bindingId: ProviderCredentialRefV1['bindingId']
      }>,
    ]>()
})

test('SBX1 consumes typed requests through resolveForDelivery', () => {
  expectTypeOf<SandboxCredentialDeliveryRequestV1['ref']>()
    .toEqualTypeOf<ProviderCredentialRefV1>()
  expectTypeOf<SandboxCredentialPayloadResolverV1['resolveForDelivery']>()
    .parameters.toEqualTypeOf<[
      AuthorizedWorkspaceCredentialScopeV1,
      SandboxCredentialDeliveryRequestV1,
    ]>()
})
