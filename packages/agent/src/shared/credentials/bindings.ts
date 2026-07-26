import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from './errors'
import type {
  CredentialConsumerBindingId,
  CredentialFieldDefinitionV1,
  CredentialFieldId,
  ProviderDefinitionV1,
  ProviderId,
  ProviderRegistryV1,
} from './registry'

export type CredentialConsumerKindV1 =
  | "model-provider"
  | "first-party-tool"
  | "plugin-server"
  | "mcp-server"
  | "tenant-custom-tool"

export type CredentialDeliveryV1 =
  | "host-only"
  | "sandbox-pipe"
  | "sandbox-tmpfs"

/** Immutable authority registered by the host beside the tool/provider catalog. */
export interface CredentialConsumerBindingV1 {
  readonly contractVersion: "boring.credential-consumer-binding.v1"
  readonly id: CredentialConsumerBindingId
  readonly providerId: ProviderId
  readonly consumer: Readonly<{
    id: string
    kind: CredentialConsumerKindV1
    trust: "trusted" | "untrusted"
  }>
  readonly purpose: string
  readonly allowedFieldIds: readonly CredentialFieldId[]
  readonly delivery: CredentialDeliveryV1
  readonly sandbox?: Readonly<{
    credentialChannel: "fd-3" | "tmpfs-v1"
    egressOrigins: readonly `https://${string}`[]
  }>
}

export interface CredentialConsumerBindingRegistryV1 {
  readonly contractVersion: "boring.credential-consumer-bindings.v1"
  require(bindingId: CredentialConsumerBindingId):
    CredentialConsumerBindingV1
}

const CREDENTIAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_BINDING_TEXT_LENGTH_V1 = 256

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}

function schemaMismatch(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    message,
  )
}

function validateCredentialId(value: unknown, kind: string): asserts value is string {
  if (typeof value !== 'string' || !CREDENTIAL_ID_PATTERN.test(value)) {
    schemaMismatch(`Invalid ${kind}`)
  }
}

function validateBindingText(value: unknown, kind: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_BINDING_TEXT_LENGTH_V1
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    schemaMismatch(`Invalid ${kind}`)
  }
}

function validateHttpsOrigin(value: unknown): asserts value is `https://${string}` {
  if (typeof value !== 'string') schemaMismatch('Invalid sandbox egress origin')
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.origin !== value
    ) {
      schemaMismatch('Invalid sandbox egress origin')
    }
  } catch (error) {
    if (error instanceof CredentialResolutionError) throw error
    schemaMismatch('Invalid sandbox egress origin')
  }
}

function providerFields(provider: ProviderDefinitionV1): readonly CredentialFieldDefinitionV1[] {
  if (provider.credential.type === 'api-key') return provider.credential.fields
  if (
    provider.credential.type === 'oauth2-authorization-code'
    && provider.credential.tokenCustody === 'local-vault'
  ) {
    return [
      provider.credential.refreshTokenField,
      provider.credential.resolvedAccessTokenField,
    ]
  }
  return []
}

function validateBinding(
  binding: CredentialConsumerBindingV1,
  providerRegistry: ProviderRegistryV1,
): void {
  if (!binding || typeof binding !== 'object') {
    schemaMismatch('Invalid consumer binding')
  }
  if (binding.contractVersion !== 'boring.credential-consumer-binding.v1') {
    schemaMismatch('Invalid consumer binding contract version')
  }
  validateCredentialId(binding.id, 'consumer binding id')
  validateCredentialId(binding.providerId, 'provider id')
  if (!binding.consumer || typeof binding.consumer !== 'object') {
    schemaMismatch('Missing consumer binding identity')
  }
  validateBindingText(binding.consumer.id, 'consumer id')
  if (!['model-provider', 'first-party-tool', 'plugin-server', 'mcp-server', 'tenant-custom-tool'].includes(binding.consumer.kind)) {
    schemaMismatch('Invalid consumer kind')
  }
  if (binding.consumer.trust !== 'trusted' && binding.consumer.trust !== 'untrusted') {
    schemaMismatch('Invalid consumer trust')
  }
  validateBindingText(binding.purpose, 'consumer purpose')
  if (!Array.isArray(binding.allowedFieldIds)) schemaMismatch('Invalid allowed field ids')
  if (!['host-only', 'sandbox-pipe', 'sandbox-tmpfs'].includes(binding.delivery)) {
    schemaMismatch('Invalid credential delivery mode')
  }

  const provider = providerRegistry.list().find(
    (candidate) => candidate.id === binding.providerId,
  )
  if (!provider) schemaMismatch('Consumer binding references an unknown provider')
  if (!provider.consumerBindingIds.includes(binding.id)) {
    schemaMismatch('Provider does not declare consumer binding')
  }
  const availableFieldIds = new Set<string>(providerFields(provider).map((field) => field.id))
  const allowedFieldIds = new Set<string>()
  for (const fieldId of binding.allowedFieldIds) {
    validateCredentialId(fieldId, 'allowed credential field id')
    if (allowedFieldIds.has(fieldId)) schemaMismatch('Duplicate allowed credential field id')
    if (!availableFieldIds.has(fieldId)) schemaMismatch('Consumer binding requests an unknown field')
    allowedFieldIds.add(fieldId)
  }

  if (
    provider.credential.type === 'oauth2-authorization-code'
    && provider.credential.tokenCustody === 'local-vault'
    && allowedFieldIds.has(provider.credential.refreshTokenField.id)
  ) {
    schemaMismatch('Consumer binding cannot request an OAuth refresh field')
  }

  if (binding.consumer.trust === 'trusted') {
    if (binding.delivery !== 'host-only' || binding.sandbox !== undefined) {
      schemaMismatch('Trusted consumers require host-only delivery')
    }
  } else {
    if (binding.delivery === 'host-only' || !binding.sandbox) {
      schemaMismatch('Untrusted consumers require sandbox delivery')
    }
    if (
      (binding.delivery === 'sandbox-pipe' && binding.sandbox.credentialChannel !== 'fd-3')
      || (binding.delivery === 'sandbox-tmpfs' && binding.sandbox.credentialChannel !== 'tmpfs-v1')
    ) {
      schemaMismatch('Sandbox delivery channel does not match delivery mode')
    }
    if (!Array.isArray(binding.sandbox.egressOrigins)) {
      schemaMismatch('Missing sandbox egress origins')
    }
    const providerOrigins = new Set(provider.sandboxEgressOrigins)
    const seenOrigins = new Set<string>()
    for (const origin of binding.sandbox.egressOrigins) {
      validateHttpsOrigin(origin)
      if (seenOrigins.has(origin)) schemaMismatch('Duplicate sandbox egress origin')
      if (!providerOrigins.has(origin)) schemaMismatch('Sandbox egress origin is not provider-approved')
      seenOrigins.add(origin)
    }
  }

  if (
    provider.credential.type === 'oauth2-authorization-code'
    && provider.credential.tokenCustody === 'external-managed'
    && (
      binding.allowedFieldIds.length !== 0
      || binding.consumer.trust !== 'trusted'
      || binding.delivery !== 'host-only'
      || binding.sandbox !== undefined
    )
  ) {
    schemaMismatch('External-managed credentials require an empty host-only binding')
  }
}

export function createCredentialConsumerBindingRegistryV1(
  bindings: readonly CredentialConsumerBindingV1[],
  providerRegistry: ProviderRegistryV1,
): CredentialConsumerBindingRegistryV1 {
  const byId = new Map<CredentialConsumerBindingId, CredentialConsumerBindingV1>()
  for (const binding of bindings) {
    validateBinding(binding, providerRegistry)
    if (byId.has(binding.id)) schemaMismatch('Duplicate consumer binding id')
    const immutableBinding = deepFreeze(binding)
    byId.set(immutableBinding.id, immutableBinding)
  }

  return Object.freeze({
    contractVersion: 'boring.credential-consumer-bindings.v1' as const,
    require(bindingId: CredentialConsumerBindingId): CredentialConsumerBindingV1 {
      validateCredentialId(bindingId, 'consumer binding id')
      const binding = byId.get(bindingId)
      if (!binding) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
          'Credential consumer binding is not registered',
        )
      }
      return binding
    },
  })
}
