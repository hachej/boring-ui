import type {
  AuthorizedWorkspaceCredentialScopeV1,
  CredentialConsumerBindingRegistryV1,
  CredentialFieldId,
  ProviderCredentialRefV1,
  ProviderDefinitionV1,
  ProviderId,
  ProviderRegistryV1,
  ResolvedCredentialLeaseV1,
  ResolvedCredentialMaterialV1,
  VerifiedWorkspaceCredentialAuthorityV1,
  WorkspaceCredentialAuthorityVerifierV1,
  WorkspaceCredentialResolverV1,
} from '../../shared/credentials'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  PROVIDER_CREDENTIAL_REF_VERSION,
} from '../../shared/credentials'

export interface CredentialStoreBackendV1 {
  read(
    workspaceId: string,
    providerId: ProviderId,
    allowedFieldIds: readonly CredentialFieldId[],
  ): Promise<ResolvedCredentialMaterialV1 & { credentialVersion: number }>
}

export interface HostSideCredentialResolverOptionsV1 {
  readonly authorityVerifier: WorkspaceCredentialAuthorityVerifierV1
  readonly bindingRegistry: CredentialConsumerBindingRegistryV1
  readonly providerRegistry: ProviderRegistryV1
  /**
   * Storage boundary only. Vault/KmsBackend composition is deferred to bead
   * 16f.2 and will implement this interface without changing the resolver.
   */
  readonly backend: CredentialStoreBackendV1
}

export interface InMemoryCredentialBackendEntryV1 {
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly material: ResolvedCredentialMaterialV1
  readonly credentialVersion: number
}

export interface FakeAuthorityVerifierGrantV1 {
  readonly scope: AuthorizedWorkspaceCredentialScopeV1
  readonly authority: VerifiedWorkspaceCredentialAuthorityV1
}

const HOST_CREDENTIAL_LEASE_TTL_MS_V1 = 60_000

function cloneMaterial(material: ResolvedCredentialMaterialV1): ResolvedCredentialMaterialV1 {
  if (material.kind === 'field-set') {
    return {
      kind: 'field-set',
      fields: new Map(
        [...material.fields].map(([fieldId, value]) => [
          fieldId,
          new Uint8Array(value),
        ]),
      ),
    }
  }
  if (material.kind === 'external-managed-account') {
    return {
      kind: 'external-managed-account',
      custodianAdapterId: material.custodianAdapterId,
      opaqueAccountReference: new Uint8Array(material.opaqueAccountReference),
    }
  }
  return { kind: 'none' }
}

function zeroMaterial(material: ResolvedCredentialMaterialV1): void {
  if (material.kind === 'field-set') {
    for (const value of material.fields.values()) value.fill(0)
  } else if (material.kind === 'external-managed-account') {
    material.opaqueAccountReference.fill(0)
  }
}

function bestEffortZeroMaterial(material: unknown): void {
  try {
    if (material && typeof material === 'object') {
      zeroMaterial(material as ResolvedCredentialMaterialV1)
    }
  } catch {
    // Best-effort process-memory hygiene only.
  }
}

function cloneBackendMaterialForFields(
  material: ResolvedCredentialMaterialV1,
  allowedFieldIds: readonly CredentialFieldId[],
): ResolvedCredentialMaterialV1 {
  if (material.kind !== 'field-set') return cloneMaterial(material)
  const fields = new Map<CredentialFieldId, Uint8Array>()
  for (const fieldId of allowedFieldIds) {
    const value = material.fields.get(fieldId)
    if (value) fields.set(fieldId, new Uint8Array(value))
  }
  return { kind: 'field-set', fields }
}

function restrictMaterialToAllowedFields(
  material: ResolvedCredentialMaterialV1,
  allowedFieldIds: readonly CredentialFieldId[],
  provider: ProviderDefinitionV1,
): ResolvedCredentialMaterialV1 {
  if (!material || typeof material !== 'object') {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.UNREADABLE,
      'Credential backend returned invalid material',
    )
  }
  if (provider.credential.type === 'none') {
    if (allowedFieldIds.length !== 0 || material.kind !== 'none') {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.UNREADABLE,
        'Credential backend returned invalid material',
      )
    }
    return { kind: 'none' }
  }
  if (
    provider.credential.type === 'oauth2-authorization-code'
    && provider.credential.tokenCustody === 'external-managed'
  ) {
    if (
      allowedFieldIds.length !== 0
      || material.kind !== 'external-managed-account'
      || typeof material.custodianAdapterId !== 'string'
      || material.custodianAdapterId !== provider.credential.custodianAdapterId
      || !(material.opaqueAccountReference instanceof Uint8Array)
      || material.opaqueAccountReference.byteLength === 0
      || material.opaqueAccountReference.byteLength > provider.credential.accountReference.maxBytes
    ) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.UNREADABLE,
        'Credential backend returned invalid material',
      )
    }
    return cloneMaterial(material)
  }
  if (
    material.kind !== 'field-set'
    || !material.fields
    || typeof material.fields.get !== 'function'
  ) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.UNREADABLE,
      'Credential backend returned invalid material',
    )
  }
  const fieldDefinitions = provider.credential.type === 'api-key'
    ? provider.credential.fields
    : [
        provider.credential.refreshTokenField,
        provider.credential.resolvedAccessTokenField,
      ]
  const definitionsById = new Map(
    fieldDefinitions.map((definition) => [definition.id, definition]),
  )
  const restricted = new Map<CredentialFieldId, Uint8Array>()
  for (const fieldId of allowedFieldIds) {
    const definition = definitionsById.get(fieldId)
    const value = material.fields.get(fieldId)
    if (!(value instanceof Uint8Array)) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
        'Required credential material is not configured',
      )
    }
    if (
      !definition
      || value.byteLength < (definition.minBytes ?? 0)
      || value.byteLength > definition.maxBytes
    ) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.UNREADABLE,
        'Credential backend returned invalid material',
      )
    }
    restricted.set(fieldId, new Uint8Array(value))
  }
  return { kind: 'field-set', fields: restricted }
}

function sanitizeAuthorityError(error: unknown): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
    'Workspace credential authority is invalid or expired',
    {
      retryable:
        error instanceof CredentialResolutionError
        && error.retryable,
    },
  )
}

function sanitizeBackendError(error: unknown): CredentialResolutionError {
  if (error instanceof CredentialResolutionError) {
    return new CredentialResolutionError(
      error.code,
      'Credential material could not be resolved',
      { retryable: error.retryable },
    )
  }
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    'Credential backend is unavailable',
    { retryable: true },
  )
}

function snapshotAuthority(
  authority: VerifiedWorkspaceCredentialAuthorityV1,
): VerifiedWorkspaceCredentialAuthorityV1 {
  return {
    workspaceId: authority.workspaceId,
    appId: authority.appId,
    principal: authority.principal.kind === 'user'
      ? {
          kind: 'user',
          userId: authority.principal.userId,
          membershipRole: authority.principal.membershipRole,
        }
      : {
          kind: 'system',
          principalId: authority.principal.principalId,
          workspaceGrantId: authority.principal.workspaceGrantId,
        },
    authorizationReceiptId: authority.authorizationReceiptId,
    expiresAt: authority.expiresAt,
  }
}

function createLease(input: Readonly<{
  authority: VerifiedWorkspaceCredentialAuthorityV1
  ref: ProviderCredentialRefV1
  material: ResolvedCredentialMaterialV1
  credentialVersion: number
}>): ResolvedCredentialLeaseV1 {
  let currentMaterial: ResolvedCredentialMaterialV1 | undefined = input.material
  const authorityExpiresAt = Date.parse(input.authority.expiresAt)
  const expiresAtMs = Math.min(
    authorityExpiresAt,
    Date.now() + HOST_CREDENTIAL_LEASE_TTL_MS_V1,
  )
  const expiresAt = new Date(expiresAtMs).toISOString()

  const lease = {
    contractVersion: 'boring.resolved-credential.v1' as const,
    workspaceId: input.authority.workspaceId,
    providerId: input.ref.providerId,
    credentialVersion: input.credentialVersion,
    executionId: input.ref.executionId,
    get material(): ResolvedCredentialMaterialV1 {
      if (currentMaterial && Date.now() >= expiresAtMs) {
        const expiredMaterial = currentMaterial
        currentMaterial = undefined
        bestEffortZeroMaterial(expiredMaterial)
      }
      if (!currentMaterial) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.LEASE_EXPIRED,
          'Credential lease has been disposed',
        )
      }
      return currentMaterial
    },
    expiresAt,
    dispose(): void {
      if (!currentMaterial) return
      const disposedMaterial = currentMaterial
      currentMaterial = undefined
      bestEffortZeroMaterial(disposedMaterial)
    },
  }
  Object.defineProperty(lease, 'toJSON', {
    enumerable: false,
    value: () => {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
        'Credential leases cannot be serialized',
      )
    },
  })
  return Object.freeze(lease)
}

export function createHostSideCredentialResolverV1(
  options: HostSideCredentialResolverOptionsV1,
): WorkspaceCredentialResolverV1 {
  return Object.freeze({
    contractVersion: 'boring.workspace-credential-resolver.v1' as const,
    async resolve(
      workspace: AuthorizedWorkspaceCredentialScopeV1,
      ref: ProviderCredentialRefV1,
    ): Promise<ResolvedCredentialLeaseV1> {
      let authority: VerifiedWorkspaceCredentialAuthorityV1
      try {
        authority = snapshotAuthority(
          await options.authorityVerifier.verifyCurrent(workspace),
        )
      } catch (error) {
        throw sanitizeAuthorityError(error)
      }
      if (
        typeof authority.workspaceId !== 'string'
        || authority.workspaceId.length === 0
        || !Number.isFinite(Date.parse(authority.expiresAt))
        || Date.parse(authority.expiresAt) <= Date.now()
      ) {
        throw sanitizeAuthorityError(undefined)
      }
      if (
        !ref
        || typeof ref !== 'object'
        || ref.contractVersion !== PROVIDER_CREDENTIAL_REF_VERSION
        || typeof ref.providerId !== 'string'
        || typeof ref.bindingId !== 'string'
        || typeof ref.executionId !== 'string'
        || ref.executionId.trim().length === 0
        || ref.executionId.length > 256
      ) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
          'Invalid credential reference',
        )
      }

      const binding = options.bindingRegistry.require(ref.bindingId)
      if (binding.providerId !== ref.providerId) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
          'Credential reference does not match its registered consumer binding',
        )
      }
      if (binding.delivery !== 'host-only') {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.DELIVERY_FORBIDDEN,
          'Host-side resolver only serves host-only credential bindings',
        )
      }
      const provider = options.providerRegistry.require(binding.providerId)
      if (!provider.consumerBindingIds.includes(binding.id)) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
          'Credential binding is not registered for its provider',
        )
      }
      if (
        provider.credential.type === 'oauth2-authorization-code'
        && provider.credential.tokenCustody === 'local-vault'
        && binding.allowedFieldIds.includes(provider.credential.refreshTokenField.id)
      ) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.CONSUMER_MISMATCH,
          'Credential binding cannot resolve an OAuth refresh field',
        )
      }

      let resolved: ResolvedCredentialMaterialV1 & { credentialVersion: number }
      try {
        resolved = await options.backend.read(
          authority.workspaceId,
          binding.providerId,
          binding.allowedFieldIds,
        )
      } catch (error) {
        throw sanitizeBackendError(error)
      }
      let material: ResolvedCredentialMaterialV1
      try {
        if (
          !resolved
          || typeof resolved !== 'object'
          || !Number.isSafeInteger(resolved.credentialVersion)
          || resolved.credentialVersion <= 0
        ) {
          throw new CredentialResolutionError(
            CREDENTIAL_ERROR_CODES.UNREADABLE,
            'Credential material has an invalid version',
          )
        }
        material = restrictMaterialToAllowedFields(
          resolved,
          binding.allowedFieldIds,
          provider,
        )
      } catch (error) {
        throw sanitizeBackendError(error)
      } finally {
        bestEffortZeroMaterial(resolved)
      }
      if (Date.parse(authority.expiresAt) <= Date.now()) {
        bestEffortZeroMaterial(material)
        throw sanitizeAuthorityError(undefined)
      }
      return createLease({
        authority,
        ref,
        material,
        credentialVersion: resolved.credentialVersion,
      })
    },
  })
}

export function createFakeAuthorityVerifierV1(
  grants: readonly FakeAuthorityVerifierGrantV1[],
): WorkspaceCredentialAuthorityVerifierV1 {
  const issued = new WeakMap<object, VerifiedWorkspaceCredentialAuthorityV1>()
  for (const grant of grants) {
    issued.set(grant.scope, Object.freeze(snapshotAuthority(grant.authority)))
  }

  return Object.freeze({
    contractVersion: 'boring.workspace-credential-authority-verifier.v1' as const,
    async verifyCurrent(
      scope: AuthorizedWorkspaceCredentialScopeV1,
    ): Promise<VerifiedWorkspaceCredentialAuthorityV1> {
      const authority = issued.get(scope)
      if (
        !authority
        || !Number.isFinite(Date.parse(authority.expiresAt))
        || Date.parse(authority.expiresAt) <= Date.now()
      ) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
          'Workspace credential authority is invalid or expired',
        )
      }
      return authority
    },
  })
}

export function createInMemoryCredentialBackendV1(
  entries: readonly InMemoryCredentialBackendEntryV1[],
): CredentialStoreBackendV1 {
  const byWorkspace = new Map<string, Map<ProviderId, InMemoryCredentialBackendEntryV1>>()
  for (const entry of entries) {
    if (
      typeof entry.workspaceId !== 'string'
      || entry.workspaceId.length === 0
      || !Number.isSafeInteger(entry.credentialVersion)
      || entry.credentialVersion <= 0
    ) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
        'Invalid in-memory credential backend entry',
      )
    }
    let providers = byWorkspace.get(entry.workspaceId)
    if (!providers) {
      providers = new Map()
      byWorkspace.set(entry.workspaceId, providers)
    }
    if (providers.has(entry.providerId)) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
        'Duplicate in-memory credential backend entry',
      )
    }
    providers.set(entry.providerId, {
      ...entry,
      material: cloneMaterial(entry.material),
    })
  }

  return Object.freeze({
    async read(
      workspaceId: string,
      providerId: ProviderId,
      allowedFieldIds: readonly CredentialFieldId[],
    ): Promise<ResolvedCredentialMaterialV1 & { credentialVersion: number }> {
      const entry = byWorkspace.get(workspaceId)?.get(providerId)
      if (!entry) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
          'Credential material is not configured',
        )
      }
      return {
        ...cloneBackendMaterialForFields(entry.material, allowedFieldIds),
        credentialVersion: entry.credentialVersion,
      }
    },
  })
}
