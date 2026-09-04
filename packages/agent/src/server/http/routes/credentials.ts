import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type {
  CredentialFieldId,
  CredentialMetadataV1,
  CredentialWriteRequestV1,
  ProviderId,
  ProviderRegistryV1,
  VerifiedWorkspaceCredentialAuthorityV1,
} from '../../../shared/credentials'
import type {
  OpenAiCodexOAuthBrokerV1,
  VaultCredentialStoreBackendV1,
} from '../../credentials'

const ROUTE_PREFIX = '/api/v1/credentials'
const MAX_DISPLAY_LABEL_LENGTH = 256

export interface CredentialRoutesOptionsV1 {
  readonly providerRegistry: ProviderRegistryV1
  readonly vaultBackend: VaultCredentialStoreBackendV1
  /** Pi-native OpenAI Codex login broker; absent keeps OAuth routes disabled. */
  readonly oauthBroker?: OpenAiCodexOAuthBrokerV1
  /** Core-owned authentication boundary; request params/body are never authority. */
  readonly authorizeRequest: (
    request: FastifyRequest,
  ) => VerifiedWorkspaceCredentialAuthorityV1 | Promise<VerifiedWorkspaceCredentialAuthorityV1>
}

function routeError(error: unknown): CredentialResolutionError {
  if (error instanceof CredentialResolutionError) {
    return new CredentialResolutionError(error.code, 'Credential operation failed', {
      retryable: error.retryable,
    })
  }
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    'Credential operation failed',
    { retryable: true },
  )
}

async function requireOwner(
  request: FastifyRequest,
  options: CredentialRoutesOptionsV1,
): Promise<VerifiedWorkspaceCredentialAuthorityV1> {
  let authority: VerifiedWorkspaceCredentialAuthorityV1
  try {
    authority = await options.authorizeRequest(request)
  } catch {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.FORBIDDEN,
      'Credential operation is forbidden',
    )
  }
  if (
    !authority
    || typeof authority.workspaceId !== 'string'
    || authority.workspaceId.length === 0
    || authority.principal.kind !== 'user'
    || authority.principal.membershipRole !== 'owner'
    || !Number.isFinite(Date.parse(authority.expiresAt))
    || Date.parse(authority.expiresAt) <= Date.now()
  ) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.FORBIDDEN,
      'Credential operation is forbidden',
    )
  }
  return authority
}

function providerIdFrom(request: FastifyRequest): ProviderId {
  const value = (request.params as { providerId?: unknown }).providerId
  if (typeof value !== 'string') {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
      'Credential operation failed',
    )
  }
  return value as ProviderId
}

function metadataProjection(
  providerRegistry: ProviderRegistryV1,
  providerId: ProviderId,
  stored: Awaited<ReturnType<VaultCredentialStoreBackendV1['getCredentialMetadata']>>,
): CredentialMetadataV1 {
  const provider = providerRegistry.require(providerId)
  if (!stored) {
    return {
      providerId,
      displayName: provider.displayName,
      credentialType: provider.credential.type,
      state: 'not_configured',
    }
  }
  return {
    providerId,
    displayName: stored.displayLabel,
    credentialType: stored.credentialType,
    state: stored.state,
    credentialVersion: stored.credentialVersion,
    ...(stored.maskedLastFourSuffix
      ? { maskedLastFourSuffix: stored.maskedLastFourSuffix }
      : {}),
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

function parseWriteBody(
  body: unknown,
  providerRegistry: ProviderRegistryV1,
  providerId: ProviderId,
): { displayLabel: string; fields: Map<CredentialFieldId, Uint8Array>; suffix: string } {
  const provider = providerRegistry.require(providerId)
  if (provider.credential.type !== 'api-key') {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
      'Credential operation failed',
    )
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
  }
  const input = body as Partial<CredentialWriteRequestV1>
  const allowedBodyKeys = new Set(['displayLabel', 'fields'])
  if (Object.keys(body).some((key) => !allowedBodyKeys.has(key)) || !input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
  }
  const displayLabel = input.displayLabel ?? provider.displayName
  if (
    typeof displayLabel !== 'string'
    || displayLabel.length === 0
    || displayLabel.length > MAX_DISPLAY_LABEL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(displayLabel)
  ) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
  }
  const definitions = new Map(provider.credential.fields.map((field) => [field.id, field]))
  const suppliedIds = Object.keys(input.fields)
  if (suppliedIds.length !== definitions.size || suppliedIds.some((id) => !definitions.has(id as CredentialFieldId))) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
  }
  const fields = new Map<CredentialFieldId, Uint8Array>()
  let suffix = ''
  for (const definition of provider.credential.fields) {
    const value = input.fields[definition.id]
    if (typeof value !== 'string') {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
    }
    const encoded = new TextEncoder().encode(value)
    if (encoded.byteLength < (definition.minBytes ?? 0) || encoded.byteLength > definition.maxBytes) {
      encoded.fill(0)
      for (const prior of fields.values()) prior.fill(0)
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
    }
    fields.set(definition.id, encoded)
    if (definition.sensitivity === 'secret') suffix = value.slice(-4)
  }
  return { displayLabel, fields, suffix }
}

export async function credentialsRoutes(
  app: FastifyInstance,
  options: CredentialRoutesOptionsV1,
): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    const sanitized = routeError(error)
    request.log.warn({
      credentialErrorCode: sanitized.code,
      providerId: (request.params as { providerId?: unknown } | undefined)?.providerId,
    }, 'credential route failed')
    return reply.code(sanitized.code === CREDENTIAL_ERROR_CODES.FORBIDDEN ? 403 : 400).send({
      error: { code: sanitized.code, message: sanitized.message },
    })
  })

  app.get(ROUTE_PREFIX, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    const stored = new Map(
      (await options.vaultBackend.listCredentialMetadata(workspaceId))
        .map((item) => [item.providerId, item]),
    )
    const credentials = options.providerRegistry.list().map((provider) =>
      metadataProjection(options.providerRegistry, provider.id, stored.get(provider.id)))
    return reply.code(200).send({ credentials })
  })

  app.get(`${ROUTE_PREFIX}/:providerId`, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    const providerId = providerIdFrom(request)
    const stored = await options.vaultBackend.getCredentialMetadata(workspaceId, providerId)
    return reply.code(200).send(metadataProjection(options.providerRegistry, providerId, stored))
  })

  app.post(`${ROUTE_PREFIX}/openai-codex/oauth`, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    if (!options.oauthBroker) {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.NOT_CONFIGURED, 'Credential operation failed')
    }
    const flow = await options.oauthBroker.start(workspaceId)
    return reply.code(202).send(flow)
  })

  app.get(`${ROUTE_PREFIX}/openai-codex/oauth/:flowId`, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    const flowId = (request.params as { flowId?: unknown }).flowId
    const flow = typeof flowId === 'string' ? options.oauthBroker?.get(workspaceId, flowId) : undefined
    if (!flow) return reply.code(404).send({
      error: { code: CREDENTIAL_ERROR_CODES.OAUTH_STATE_INVALID, message: 'OAuth flow not found' },
    })
    return reply.code(200).send(flow)
  })

  app.post(`${ROUTE_PREFIX}/openai-codex/oauth/:flowId/respond`, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    const flowId = (request.params as { flowId?: unknown }).flowId
    const body = request.body as { value?: unknown } | undefined
    if (!options.oauthBroker || typeof flowId !== 'string' || typeof body?.value !== 'string') {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
    }
    const flow = await options.oauthBroker.respond(workspaceId, flowId, body.value)
    return reply.code(200).send(flow)
  })

  app.delete(`${ROUTE_PREFIX}/openai-codex/oauth/:flowId`, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    const flowId = (request.params as { flowId?: unknown }).flowId
    if (!options.oauthBroker || typeof flowId !== 'string') {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
    }
    await options.oauthBroker.cancel(workspaceId, flowId)
    return reply.code(204).send()
  })

  app.put(`${ROUTE_PREFIX}/:providerId`, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    const providerId = providerIdFrom(request)
    const parsed = parseWriteBody(request.body, options.providerRegistry, providerId)
    try {
      await options.vaultBackend.writeCredentialFields({
        workspaceId,
        providerId,
        fields: parsed.fields,
        metadata: {
          displayLabel: parsed.displayLabel,
          credentialType: 'api-key',
          maskedLastFourSuffix: parsed.suffix,
        },
      })
    } finally {
      for (const value of parsed.fields.values()) value.fill(0)
    }
    const stored = await options.vaultBackend.getCredentialMetadata(workspaceId, providerId)
    return reply.code(200).send(metadataProjection(options.providerRegistry, providerId, stored))
  })

  for (const action of ['disable', 'revoke'] as const) {
    app.post(`${ROUTE_PREFIX}/:providerId/${action}`, async (request, reply) => {
      const { workspaceId } = await requireOwner(request, options)
      const providerId = providerIdFrom(request)
      options.providerRegistry.require(providerId)
      const stored = await options.vaultBackend.setCredentialLifecycleState(workspaceId, providerId, action === 'disable' ? 'disabled' : 'revoked')
      return reply.code(200).send(metadataProjection(options.providerRegistry, providerId, stored))
    })
  }

  app.delete(`${ROUTE_PREFIX}/:providerId`, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    const providerId = providerIdFrom(request)
    options.providerRegistry.require(providerId)
    await options.vaultBackend.writeAbsentCredential(workspaceId, providerId)
    const stored = await options.vaultBackend.getCredentialMetadata(workspaceId, providerId)
    return reply.code(200).send(metadataProjection(options.providerRegistry, providerId, stored))
  })
}
