import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from './errors'

export type ProviderId = string & { readonly __providerId: unique symbol }
export type CredentialFieldId = string & { readonly __credentialFieldId: unique symbol }
export type CredentialConsumerBindingId = string & {
  readonly __credentialConsumerBindingId: unique symbol
}

export type ProviderCategoryV1 =
  | "llm"
  | "search"
  | "transcription"
  | "mcp"
  | "other"

export interface CredentialFieldDefinitionV1 {
  readonly id: CredentialFieldId
  readonly label: string
  readonly required: boolean
  readonly sensitivity: "secret" | "public"
  readonly minBytes?: number
  readonly maxBytes: number
}

export interface ExternalManagedAccountReferenceDefinitionV1 {
  readonly label: string
  readonly maxBytes: number
  readonly persistence: "server-only-metadata"
}

export type ProviderCredentialDefinitionV1 =
  | Readonly<{
      type: "api-key"
      fields: readonly CredentialFieldDefinitionV1[]
    }>
  | Readonly<{
      type: "oauth2-authorization-code"
      tokenCustody: "local-vault"
      clientRegistrationRef: string
      authorizationEndpoint: `https://${string}`
      tokenEndpoint: `https://${string}`
      revocationEndpoint?: `https://${string}`
      scopes: readonly string[]
      usePkce: true
      refreshTokenField: CredentialFieldDefinitionV1
      resolvedAccessTokenField: CredentialFieldDefinitionV1
      accessTokenPersistence: "memory-only"
    }>
  | Readonly<{
      type: "oauth2-authorization-code"
      tokenCustody: "external-managed"
      custodianAdapterId: string
      connectUrlOrigins: readonly `https://${string}`[]
      scopes: readonly string[]
      accountReference: ExternalManagedAccountReferenceDefinitionV1
      delivery: "host-session-adapter-only"
    }>
  | Readonly<{ type: "none" }>

export interface ProviderDefinitionV1 {
  readonly contractVersion: "boring.provider.v1"
  readonly id: ProviderId
  readonly displayName: string
  readonly category: ProviderCategoryV1
  readonly credential: ProviderCredentialDefinitionV1
  readonly consumerBindingIds: readonly CredentialConsumerBindingId[]
  readonly sandboxEgressOrigins: readonly `https://${string}`[]
  readonly mcp?: Readonly<{
    transport: "streamable-http"
    endpoint?: `https://${string}`
    toolkitId?: string
    allowedTools: readonly string[]
    deniedTools: readonly string[]
  }>
}

export interface ProviderRegistryV1 {
  readonly contractVersion: "boring.provider-registry.v1"
  list(): readonly ProviderDefinitionV1[]
  require(providerId: ProviderId): ProviderDefinitionV1
}

const CREDENTIAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_CREDENTIAL_FIELD_BYTES_V1 = 65_536
const MAX_ACCOUNT_REFERENCE_BYTES_V1 = 16_384
const MAX_LABEL_LENGTH_V1 = 256
const MAX_SCOPE_LENGTH_V1 = 256

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

function isCredentialId(value: unknown): value is string {
  return typeof value === 'string' && CREDENTIAL_ID_PATTERN.test(value)
}

function validateCredentialId(value: unknown, kind: string): asserts value is string {
  if (!isCredentialId(value)) schemaMismatch(`Invalid ${kind}`)
}

function validateBoundedText(value: unknown, kind: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_LABEL_LENGTH_V1
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    schemaMismatch(`Invalid ${kind}`)
  }
}

function validateBoundedBytes(value: unknown, maximum: number, kind: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    schemaMismatch(`Invalid ${kind}`)
  }
}

function validateHttpsEndpoint(value: unknown, kind: string): asserts value is `https://${string}` {
  if (typeof value !== 'string') schemaMismatch(`Invalid ${kind}`)
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.hash !== ''
    ) {
      schemaMismatch(`Invalid ${kind}`)
    }
  } catch (error) {
    if (error instanceof CredentialResolutionError) throw error
    schemaMismatch(`Invalid ${kind}`)
  }
}

function validateHttpsOrigin(value: unknown, kind: string): asserts value is `https://${string}` {
  validateHttpsEndpoint(value, kind)
  const parsed = new URL(value)
  if (parsed.origin !== value) schemaMismatch(`Invalid ${kind}`)
}

function validateUniqueStrings(
  values: unknown,
  validate: (value: unknown) => void,
  kind: string,
): asserts values is readonly string[] {
  if (!Array.isArray(values)) schemaMismatch(`Invalid ${kind}`)
  const seen = new Set<string>()
  for (const value of values) {
    validate(value)
    if (seen.has(value as string)) schemaMismatch(`Duplicate ${kind}`)
    seen.add(value as string)
  }
}

function validateScopes(scopes: unknown): void {
  validateUniqueStrings(
    scopes,
    (scope) => {
      if (
        typeof scope !== 'string'
        || scope.length === 0
        || scope.length > MAX_SCOPE_LENGTH_V1
        || !/^[\x21-\x7e]+$/.test(scope)
      ) {
        schemaMismatch('Invalid OAuth scope')
      }
    },
    'OAuth scope',
  )
}

function validateCredentialField(
  field: CredentialFieldDefinitionV1 | undefined,
): asserts field is CredentialFieldDefinitionV1 {
  if (!field || typeof field !== 'object') schemaMismatch('Missing credential field')
  validateCredentialId(field.id, 'credential field id')
  validateBoundedText(field.label, 'credential field label')
  if (typeof field.required !== 'boolean') schemaMismatch('Invalid credential field required flag')
  if (field.sensitivity !== 'secret' && field.sensitivity !== 'public') {
    schemaMismatch('Invalid credential field sensitivity')
  }
  validateBoundedBytes(field.maxBytes, MAX_CREDENTIAL_FIELD_BYTES_V1, 'credential field maxBytes')
  if (
    field.minBytes !== undefined
    && (!Number.isSafeInteger(field.minBytes) || field.minBytes < 0 || field.minBytes > field.maxBytes)
  ) {
    schemaMismatch('Invalid credential field minBytes')
  }
}

function validateDistinctCredentialFields(fields: readonly CredentialFieldDefinitionV1[]): void {
  const seen = new Set<string>()
  for (const field of fields) {
    validateCredentialField(field)
    if (seen.has(field.id)) schemaMismatch('Duplicate credential field id')
    seen.add(field.id)
  }
}

function validateLocalVaultOAuth(
  credential: Extract<ProviderCredentialDefinitionV1, { tokenCustody: 'local-vault' }>,
): void {
  validateBoundedText(credential.clientRegistrationRef, 'OAuth client registration reference')
  validateHttpsEndpoint(credential.authorizationEndpoint, 'OAuth authorization endpoint')
  validateHttpsEndpoint(credential.tokenEndpoint, 'OAuth token endpoint')
  if (credential.revocationEndpoint !== undefined) {
    validateHttpsEndpoint(credential.revocationEndpoint, 'OAuth revocation endpoint')
  }
  validateScopes(credential.scopes)
  if (credential.usePkce !== true || credential.accessTokenPersistence !== 'memory-only') {
    schemaMismatch('Invalid local-vault OAuth policy')
  }

  validateCredentialField(credential.refreshTokenField)
  validateCredentialField(credential.resolvedAccessTokenField)
  if (
    credential.refreshTokenField.id === credential.resolvedAccessTokenField.id
    || credential.refreshTokenField.required !== true
    || credential.resolvedAccessTokenField.required !== true
    || credential.refreshTokenField.sensitivity !== 'secret'
    || credential.resolvedAccessTokenField.sensitivity !== 'secret'
  ) {
    schemaMismatch('Invalid local-vault OAuth token fields')
  }
}

function validateExternalManagedOAuth(
  credential: Extract<ProviderCredentialDefinitionV1, { tokenCustody: 'external-managed' }>,
): void {
  const allowedProperties = new Set([
    'type',
    'tokenCustody',
    'custodianAdapterId',
    'connectUrlOrigins',
    'scopes',
    'accountReference',
    'delivery',
  ])
  if (Object.keys(credential).some((key) => !allowedProperties.has(key))) {
    schemaMismatch('External-managed OAuth cannot declare token or secret fields')
  }
  validateBoundedText(credential.custodianAdapterId, 'custodian adapter id')
  validateUniqueStrings(
    credential.connectUrlOrigins,
    (origin) => validateHttpsOrigin(origin, 'connect URL origin'),
    'connect URL origin',
  )
  validateScopes(credential.scopes)
  if (!credential.accountReference || typeof credential.accountReference !== 'object') {
    schemaMismatch('Missing external-managed account reference')
  }
  const allowedAccountReferenceProperties = new Set([
    'label',
    'maxBytes',
    'persistence',
  ])
  if (Object.keys(credential.accountReference).some(
    (key) => !allowedAccountReferenceProperties.has(key),
  )) {
    schemaMismatch('External-managed account reference contains unsupported fields')
  }
  validateBoundedText(credential.accountReference.label, 'account reference label')
  validateBoundedBytes(
    credential.accountReference.maxBytes,
    MAX_ACCOUNT_REFERENCE_BYTES_V1,
    'account reference maxBytes',
  )
  if (
    credential.accountReference.persistence !== 'server-only-metadata'
    || credential.delivery !== 'host-session-adapter-only'
  ) {
    schemaMismatch('Invalid external-managed OAuth custody policy')
  }
}

function validateProviderDefinition(definition: ProviderDefinitionV1): void {
  if (!definition || typeof definition !== 'object') {
    schemaMismatch('Invalid provider definition')
  }
  if (definition.contractVersion !== 'boring.provider.v1') {
    schemaMismatch('Invalid provider contract version')
  }
  validateCredentialId(definition.id, 'provider id')
  validateBoundedText(definition.displayName, 'provider display name')
  if (!['llm', 'search', 'transcription', 'mcp', 'other'].includes(definition.category)) {
    schemaMismatch('Invalid provider category')
  }
  validateUniqueStrings(
    definition.consumerBindingIds,
    (id) => validateCredentialId(id, 'consumer binding id'),
    'consumer binding id',
  )
  validateUniqueStrings(
    definition.sandboxEgressOrigins,
    (origin) => validateHttpsOrigin(origin, 'sandbox egress origin'),
    'sandbox egress origin',
  )

  if (!definition.credential || typeof definition.credential !== 'object') {
    schemaMismatch('Missing provider credential definition')
  }
  const credential = definition.credential
  if (credential.type === 'api-key') {
    if (!Array.isArray(credential.fields) || credential.fields.length === 0) {
      schemaMismatch('API-key provider requires credential fields')
    }
    validateDistinctCredentialFields(credential.fields)
  } else if (credential.type === 'oauth2-authorization-code') {
    if (credential.tokenCustody === 'local-vault') {
      validateLocalVaultOAuth(credential)
    } else if (credential.tokenCustody === 'external-managed') {
      validateExternalManagedOAuth(credential)
    } else {
      schemaMismatch('Invalid OAuth token custody')
    }
  } else if (credential.type !== 'none') {
    schemaMismatch('Invalid provider credential type')
  }

  if (definition.mcp !== undefined) {
    if (definition.mcp.transport !== 'streamable-http') schemaMismatch('Invalid MCP transport')
    if (definition.mcp.endpoint !== undefined) {
      validateHttpsEndpoint(definition.mcp.endpoint, 'MCP endpoint')
    }
    if (definition.mcp.toolkitId !== undefined) {
      validateBoundedText(definition.mcp.toolkitId, 'MCP toolkit id')
    }
    validateUniqueStrings(
      definition.mcp.allowedTools,
      (tool) => validateBoundedText(tool, 'MCP allowed tool'),
      'MCP allowed tool',
    )
    validateUniqueStrings(
      definition.mcp.deniedTools,
      (tool) => validateBoundedText(tool, 'MCP denied tool'),
      'MCP denied tool',
    )
  }
}

export function createProviderRegistryV1(
  defs: readonly ProviderDefinitionV1[],
): ProviderRegistryV1 {
  const providers: ProviderDefinitionV1[] = []
  const byId = new Map<ProviderId, ProviderDefinitionV1>()
  for (const definition of defs) {
    validateProviderDefinition(definition)
    if (byId.has(definition.id)) schemaMismatch('Duplicate provider id')
    const immutableDefinition = deepFreeze(definition)
    providers.push(immutableDefinition)
    byId.set(immutableDefinition.id, immutableDefinition)
  }
  const immutableProviders = Object.freeze(providers)

  return Object.freeze({
    contractVersion: 'boring.provider-registry.v1' as const,
    list: () => immutableProviders,
    require(providerId: ProviderId): ProviderDefinitionV1 {
      validateCredentialId(providerId, 'provider id')
      const provider = byId.get(providerId)
      if (!provider) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.PROVIDER_UNKNOWN,
          'Credential provider is not registered',
        )
      }
      return provider
    },
  })
}
