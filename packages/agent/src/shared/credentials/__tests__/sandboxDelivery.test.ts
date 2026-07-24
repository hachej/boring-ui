import { describe, expect, test, vi } from 'vitest'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  SANDBOX_CREDENTIAL_MAX_FIELDS_V1,
  SANDBOX_CREDENTIAL_MAX_METADATA_BYTES_V1,
  SANDBOX_CREDENTIAL_MAX_TOTAL_BYTES_V1,
  createCredentialConsumerBindingRegistryV1,
  createNotImplementedSandboxCredentialPayloadResolverV1,
  createProviderCredentialRefFactoryV1,
  createProviderRegistryV1,
  sandboxCredentialPayloadMetadataBytesV1,
} from '..'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  CredentialConsumerBindingId,
  CredentialConsumerBindingRegistryV1,
  CredentialConsumerBindingV1,
  CredentialFieldId,
  ProviderCredentialRefV1,
  ProviderDefinitionV1,
  ProviderId,
  SandboxCredentialDeliveryReceiptV1,
  SandboxCredentialDeliveryRequestV1,
  SandboxCredentialPayloadResolverV1,
  SandboxCredentialSecretPayloadV1,
} from '..'

const providerId = (value: string) => value as ProviderId
const fieldId = (value: string) => value as CredentialFieldId
const bindingId = (value: string) => value as CredentialConsumerBindingId
const scope = Object.freeze({
  contractVersion: 'boring.authorized-workspace-credential-scope.v1',
}) as unknown as AuthorizedWorkspaceCredentialScopeV1

function bindings(): CredentialConsumerBindingRegistryV1 {
  const provider: ProviderDefinitionV1 = {
    contractVersion: 'boring.provider.v1',
    id: providerId('provider-a'),
    displayName: 'Provider A',
    category: 'search',
    credential: {
      type: 'api-key',
      fields: [{
        id: fieldId('api-key'),
        label: 'API key',
        required: true,
        sensitivity: 'secret',
        maxBytes: SANDBOX_CREDENTIAL_MAX_TOTAL_BYTES_V1,
      }],
    },
    consumerBindingIds: [
      bindingId('model-binding'),
      bindingId('first-party-binding'),
      bindingId('sandbox-binding'),
    ],
    sandboxEgressOrigins: ['https://api.example.com'],
  }
  const modelBinding: CredentialConsumerBindingV1 = {
    contractVersion: 'boring.credential-consumer-binding.v1',
    id: bindingId('model-binding'),
    providerId: provider.id,
    consumer: { id: 'model-adapter', kind: 'model-provider', trust: 'trusted' },
    purpose: 'Host-side model request',
    allowedFieldIds: [fieldId('api-key')],
    delivery: 'host-only',
  }
  const sandboxBinding: CredentialConsumerBindingV1 = {
    contractVersion: 'boring.credential-consumer-binding.v1',
    id: bindingId('sandbox-binding'),
    providerId: provider.id,
    consumer: { id: 'tenant-tool', kind: 'tenant-custom-tool', trust: 'untrusted' },
    purpose: 'Deferred sandbox custom-tool request',
    allowedFieldIds: [fieldId('api-key')],
    delivery: 'sandbox-pipe',
    sandbox: {
      credentialChannel: 'fd-3',
      egressOrigins: ['https://api.example.com'],
    },
  }
  const firstPartyBinding: CredentialConsumerBindingV1 = {
    ...modelBinding,
    id: bindingId('first-party-binding'),
    consumer: {
      id: 'search-proxy',
      kind: 'first-party-tool',
      trust: 'trusted',
    },
    purpose: 'Host-side first-party request',
  }
  const providers = createProviderRegistryV1([provider])
  return createCredentialConsumerBindingRegistryV1(
    [modelBinding, firstPartyBinding, sandboxBinding],
    providers,
  )
}

function deliveryRequest(ref: ProviderCredentialRefV1): SandboxCredentialDeliveryRequestV1 {
  return {
    contractVersion: 'boring.sandbox-credential-delivery.v1',
    workspaceId: 'workspace-a',
    sandboxId: 'sandbox-a',
    executionId: ref.executionId,
    deliveryAttemptId: 'attempt-a',
    ref,
  }
}

function payloadResolver(
  request: SandboxCredentialDeliveryRequestV1,
  fields: SandboxCredentialSecretPayloadV1['fields'],
): SandboxCredentialPayloadResolverV1 {
  return {
    contractVersion: 'boring.sandbox-credential-payload-resolver.v1',
    async resolveForDelivery(_workspace, resolvedRequest) {
      expect(resolvedRequest).toBe(request)
      return {
        payload: {
          contractVersion: 'boring.sandbox-credential-secret-payload.v1',
          workspaceId: request.workspaceId,
          sandboxId: request.sandboxId,
          executionId: request.executionId,
          deliveryAttemptId: request.deliveryAttemptId,
          bindingId: request.ref.bindingId,
          credentialVersion: 1,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          fields,
        },
        dispose: vi.fn(),
      }
    },
  }
}

function schemaMismatch(message: string): never {
  throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, message)
}

async function standaloneSbx1FakeDeliver(
  bindingRegistry: CredentialConsumerBindingRegistryV1,
  request: SandboxCredentialDeliveryRequestV1,
  resolver: SandboxCredentialPayloadResolverV1,
): Promise<SandboxCredentialDeliveryReceiptV1> {
  if (
    request.contractVersion !== 'boring.sandbox-credential-delivery.v1'
    || request.executionId !== request.ref.executionId
    || !request.workspaceId
    || !request.sandboxId
    || !request.executionId
    || !request.deliveryAttemptId
  ) {
    schemaMismatch('Invalid sandbox credential request identity')
  }
  const binding = bindingRegistry.require(request.ref.bindingId)
  if (binding.providerId !== request.ref.providerId) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
      'Sandbox credential reference does not match its binding',
    )
  }
  if (
    binding.consumer.kind === 'model-provider'
    || binding.consumer.trust !== 'untrusted'
    || binding.delivery === 'host-only'
    || !binding.sandbox
  ) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
      'Host-only credential bindings cannot enter a sandbox',
    )
  }

  const lease = await resolver.resolveForDelivery(scope, request)
  try {
    const payload = lease.payload
    if (
      payload.workspaceId !== request.workspaceId
      || payload.sandboxId !== request.sandboxId
      || payload.executionId !== request.executionId
      || payload.deliveryAttemptId !== request.deliveryAttemptId
      || payload.bindingId !== binding.id
    ) {
      schemaMismatch('Sandbox credential payload identity mismatch')
    }
    if (payload.fields.length > SANDBOX_CREDENTIAL_MAX_FIELDS_V1) {
      schemaMismatch('Sandbox credential payload has too many fields')
    }
    const allowedFields = new Set(binding.allowedFieldIds)
    const deliveredFields = new Set<CredentialFieldId>()
    let totalBytes = 0
    for (const field of payload.fields) {
      if (!allowedFields.has(field.fieldId) || deliveredFields.has(field.fieldId)) {
        schemaMismatch('Sandbox credential payload contains an unauthorized field')
      }
      deliveredFields.add(field.fieldId)
      totalBytes += field.value.byteLength
      if (totalBytes > SANDBOX_CREDENTIAL_MAX_TOTAL_BYTES_V1) {
        schemaMismatch('Sandbox credential payload is too large')
      }
    }
    if (
      sandboxCredentialPayloadMetadataBytesV1(payload)
      > SANDBOX_CREDENTIAL_MAX_METADATA_BYTES_V1
    ) {
      schemaMismatch('Sandbox credential metadata is too large')
    }

    return {
      contractVersion: 'boring.sandbox-credential-delivery-receipt.v1',
      workspaceId: payload.workspaceId,
      sandboxId: payload.sandboxId,
      executionId: payload.executionId,
      deliveryAttemptId: payload.deliveryAttemptId,
      bindingId: payload.bindingId,
      channel: binding.sandbox.credentialChannel,
      deliveredFieldIds: [...deliveredFields],
    }
  } finally {
    lease.dispose()
  }
}

async function expectCredentialCode(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialResolutionError)
    expect((error as CredentialResolutionError).code).toBe(expectedCode)
    expect(Object.values(CREDENTIAL_ERROR_CODES)).toContain(
      (error as CredentialResolutionError).code,
    )
    return
  }
  throw new Error('Expected credential operation to fail')
}

describe('standalone SBX1 contract fake', () => {
  test('accepts a typed ref/callback and emits a value-free receipt', async () => {
    const bindingRegistry = bindings()
    const factory = createProviderCredentialRefFactoryV1(bindingRegistry)
    const ref = factory.create({
      providerId: providerId('provider-a'),
      executionId: 'execution-a',
      bindingId: bindingId('sandbox-binding'),
    })
    const request = deliveryRequest(ref)
    const canary = new TextEncoder().encode('SBX_SECRET_CANARY')
    const resolver: SandboxCredentialPayloadResolverV1 = payloadResolver(request, [{
      fieldId: fieldId('api-key'),
      value: canary,
    }])
    const receipt = await standaloneSbx1FakeDeliver(bindingRegistry, request, resolver)

    expect(receipt).toEqual({
      contractVersion: 'boring.sandbox-credential-delivery-receipt.v1',
      workspaceId: 'workspace-a',
      sandboxId: 'sandbox-a',
      executionId: 'execution-a',
      deliveryAttemptId: 'attempt-a',
      bindingId: 'sandbox-binding',
      channel: 'fd-3',
      deliveredFieldIds: ['api-key'],
    })
    expect(JSON.stringify(receipt)).not.toContain('SBX_SECRET_CANARY')
    expect(Object.keys(receipt)).not.toContain('fields')
  })

  test('rejects model and first-party host-only delivery before invoking the payload resolver', async () => {
    const bindingRegistry = bindings()
    const factory = createProviderCredentialRefFactoryV1(bindingRegistry)
    for (const id of ['model-binding', 'first-party-binding']) {
      const ref = factory.create({
        providerId: providerId('provider-a'),
        executionId: `execution-${id}`,
        bindingId: bindingId(id),
      })
      const request = deliveryRequest(ref)
      const resolver = payloadResolver(request, [])
      const resolveSpy = vi.spyOn(resolver, 'resolveForDelivery')

      await expectCredentialCode(
        standaloneSbx1FakeDeliver(bindingRegistry, request, resolver),
        CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
      )
      expect(resolveSpy).not.toHaveBeenCalled()
    }
  })

  test('enforces field-count, metadata, and aggregate-value bounds with stable errors', async () => {
    expect(SANDBOX_CREDENTIAL_MAX_FIELDS_V1).toBe(16)
    expect(SANDBOX_CREDENTIAL_MAX_METADATA_BYTES_V1).toBe(16_384)
    expect(SANDBOX_CREDENTIAL_MAX_TOTAL_BYTES_V1).toBe(65_536)

    const bindingRegistry = bindings()
    const factory = createProviderCredentialRefFactoryV1(bindingRegistry)
    const ref = factory.create({
      providerId: providerId('provider-a'),
      executionId: 'execution-bounds',
      bindingId: bindingId('sandbox-binding'),
    })
    const request = deliveryRequest(ref)
    const tooMany = Array.from(
      { length: SANDBOX_CREDENTIAL_MAX_FIELDS_V1 + 1 },
      () => ({ fieldId: fieldId('api-key'), value: new Uint8Array(1) }),
    )
    await expectCredentialCode(
      standaloneSbx1FakeDeliver(bindingRegistry, request, payloadResolver(request, tooMany)),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
    await expectCredentialCode(
      standaloneSbx1FakeDeliver(bindingRegistry, request, payloadResolver(request, [{
        fieldId: fieldId('api-key'),
        value: new Uint8Array(SANDBOX_CREDENTIAL_MAX_TOTAL_BYTES_V1 + 1),
      }])),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )

    const metadataHeavyRequest = {
      ...request,
      deliveryAttemptId: 'x'.repeat(SANDBOX_CREDENTIAL_MAX_METADATA_BYTES_V1),
    }
    await expectCredentialCode(
      standaloneSbx1FakeDeliver(
        bindingRegistry,
        metadataHeavyRequest,
        payloadResolver(metadataHeavyRequest, [{
          fieldId: fieldId('api-key'),
          value: new Uint8Array(1),
        }]),
      ),
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    )
  })

  test('keeps Tier 2 guarded as explicitly not implemented', async () => {
    const bindingRegistry = bindings()
    const ref = createProviderCredentialRefFactoryV1(bindingRegistry).create({
      providerId: providerId('provider-a'),
      executionId: 'execution-deferred',
      bindingId: bindingId('sandbox-binding'),
    })
    await expectCredentialCode(
      createNotImplementedSandboxCredentialPayloadResolverV1()
        .resolveForDelivery(scope, deliveryRequest(ref)),
      CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
    )
    await expect(
      createNotImplementedSandboxCredentialPayloadResolverV1()
        .resolveForDelivery(scope, deliveryRequest(ref)),
    ).rejects.toThrow(
      'Tier-2 in-sandbox injection not implemented in v1 (deferred to 16f.6)',
    )
  })
})
