import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type {
  CredentialFieldId,
  CredentialKeyLifecycleOperationV1,
  CredentialKeyLifecycleReceiptV1,
  CredentialMetadataV1,
  CredentialWriteRequestV1,
  ProviderId,
  ProviderRegistryV1,
  VerifiedWorkspaceCredentialAuthorityV1,
} from '../../../shared/credentials'
import { actorCredentialProviderIdV1 } from '../../credentials'
import type {
  ApiKeyValidatorV1,
  OpenAiCodexOAuthBrokerV1,
  VaultCredentialStoreBackendV1,
} from '../../credentials'

const ROUTE_PREFIX = '/api/v1/credentials'
const LIFECYCLE_ROUTE_PREFIX = '/api/v1/credential-key-lifecycle'
const MAX_DISPLAY_LABEL_LENGTH = 256
const MAX_OPERATION_ID_LENGTH = 128

export interface CredentialRoutesOptionsV1 {
  readonly providerRegistry: ProviderRegistryV1
  readonly vaultBackend: VaultCredentialStoreBackendV1
  /** Host-side validation boundary; invalid material must never reach the vault. */
  readonly apiKeyValidator: ApiKeyValidatorV1
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

async function verifiedAuthority(
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
    || typeof authority.authorizationReceiptId !== 'string'
    || authority.authorizationReceiptId.length === 0
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

async function requireOwner(
  request: FastifyRequest,
  options: CredentialRoutesOptionsV1,
): Promise<VerifiedWorkspaceCredentialAuthorityV1> {
  const authority = await verifiedAuthority(request, options)
  if (
    authority.principal.kind !== 'user'
    || authority.principal.membershipRole !== 'owner'
  ) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.FORBIDDEN,
      'Credential operation is forbidden',
    )
  }
  return authority
}

async function requireLifecycleOperator(
  request: FastifyRequest,
  options: CredentialRoutesOptionsV1,
  onVerified: (authority: VerifiedWorkspaceCredentialAuthorityV1) => void,
): Promise<VerifiedWorkspaceCredentialAuthorityV1> {
  const authority = await verifiedAuthority(request, options)
  onVerified(authority)
  const principal = authority.principal
  const authorized = principal.kind === 'user'
    ? principal.membershipRole === 'owner' && principal.userId.length > 0
    : principal.principalId.length > 0 && principal.workspaceGrantId.length > 0
  if (!authorized) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.FORBIDDEN,
      'Credential operation is forbidden',
    )
  }
  return authority
}

function parseLifecycleBody(
  body: unknown,
  workspaceId: string,
  operation: CredentialKeyLifecycleOperationV1,
): { operationId: string; dekGeneration?: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
  }
  const input = body as { operationId?: unknown; confirmWorkspaceId?: unknown; dekGeneration?: unknown }
  const allowedKeys = operation === 'rewrap'
    ? new Set(['operationId', 'confirmWorkspaceId', 'dekGeneration'])
    : new Set(['operationId', 'confirmWorkspaceId'])
  if (
    Object.keys(body).some((key) => !allowedKeys.has(key))
    || typeof input.operationId !== 'string'
    || input.operationId.length === 0
    || input.operationId.length > MAX_OPERATION_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(input.operationId)
    || input.confirmWorkspaceId !== workspaceId
  ) {
    throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
  }
  if (operation === 'rewrap') {
    if (!Number.isSafeInteger(input.dekGeneration) || (input.dekGeneration as number) < 1) {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
    }
    const dekGeneration = input.dekGeneration as number
    // Rewrap has no durable backend receipt. Bind its caller-supplied key to
    // the complete mutation payload so one key can never target two generations;
    // replaying the same key is safe because rewrap itself is idempotent.
    if (input.operationId !== `rewrap-dek-generation-${dekGeneration}`) {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
    }
    return { operationId: input.operationId, dekGeneration }
  }
  return { operationId: input.operationId }
}

function operationIdDigest(operationId: unknown): string | undefined {
  return typeof operationId === 'string'
    ? `sha256:${createHash('sha256').update(operationId).digest('hex')}`
    : undefined
}

function lifecycleReceipt(
  authority: VerifiedWorkspaceCredentialAuthorityV1,
  operation: CredentialKeyLifecycleOperationV1,
  operationId: string,
  dekGeneration?: number,
): CredentialKeyLifecycleReceiptV1 {
  return {
    contractVersion: 'boring.credential-key-lifecycle-receipt.v1',
    operation,
    workspaceId: authority.workspaceId,
    operationId,
    status: 'completed',
    ...(dekGeneration === undefined ? {} : { dekGeneration }),
  }
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
  if (stored.credentialType === 'api-key' && provider.credential.type !== 'api-key') {
    return {
      providerId,
      displayName: provider.displayName,
      credentialType: provider.credential.type,
      state: 'needs_reauth',
      credentialVersion: stored.credentialVersion,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
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
    ...(providerId === 'openai-codex' && stored.credentialType === 'oauth' && stored.state === 'revoked'
      ? {
          oauthRevocation: {
            localStatus: 'revoked' as const,
            upstreamStatus: 'pending' as const,
            attemptedAt: stored.updatedAt,
          },
        }
      : {}),
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
  const lifecycleAudit = new WeakMap<FastifyRequest, {
    operation: CredentialKeyLifecycleOperationV1
    workspaceId: string
    authorizationReceiptId: string
  }>()
  app.setErrorHandler((error, request, reply) => {
    const sanitized = routeError(error)
    const audit = lifecycleAudit.get(request)
    const routeTemplate = request.routeOptions.url ?? 'unknown'
    const isLifecycleRoute = routeTemplate.startsWith(LIFECYCLE_ROUTE_PREFIX)
    const bodyOperationId = (request.body as { operationId?: unknown } | undefined)?.operationId
    request.log.warn({
      credentialErrorCode: sanitized.code,
      ...(isLifecycleRoute
        ? {
            credentialLifecycleRoute: routeTemplate,
            ...(audit ?? {}),
            operationIdDigest: operationIdDigest(bodyOperationId),
          }
        : {
            providerId: (request.params as { providerId?: unknown } | undefined)?.providerId,
          }),
    }, 'credential route failed')
    const statusCode = sanitized.code === CREDENTIAL_ERROR_CODES.FORBIDDEN
      ? 403
      : sanitized.code === CREDENTIAL_ERROR_CODES.VALIDATION_UNAUTHORIZED
        ? 401
        : sanitized.code === CREDENTIAL_ERROR_CODES.VALIDATION_RATE_LIMITED
          ? 429
          : sanitized.code === CREDENTIAL_ERROR_CODES.VALIDATION_TIMEOUT
            ? 504
            : sanitized.code === CREDENTIAL_ERROR_CODES.VALIDATION_UNAVAILABLE
              ? 503
              : 400
    return reply.code(statusCode).send({
      error: { code: sanitized.code, message: sanitized.message },
    })
  })

  app.get(ROUTE_PREFIX, async (request, reply) => {
    const authority = await requireOwner(request, options)
    const { workspaceId } = authority
    const userId = authority.principal.kind === 'user' ? authority.principal.userId : ''
    const stored = new Map(
      (await options.vaultBackend.listCredentialMetadata(workspaceId))
        .map((item) => [item.providerId, item]),
    )
    const codexId = 'openai-codex' as ProviderId
    const personalCodex = stored.get(actorCredentialProviderIdV1(userId, codexId))
    const workspaceCodex = stored.get(codexId)
    if (personalCodex) {
      stored.set(codexId, { ...personalCodex, providerId: codexId })
    } else if (workspaceCodex?.credentialType === 'oauth') {
      stored.set(codexId, { ...workspaceCodex, state: 'needs_reauth' })
    }
    const credentials = options.providerRegistry.list().map((provider) =>
      metadataProjection(options.providerRegistry, provider.id, stored.get(provider.id)))
    return reply.code(200).send({ credentials })
  })

  app.get(`${ROUTE_PREFIX}/:providerId`, async (request, reply) => {
    const authority = await requireOwner(request, options)
    const { workspaceId } = authority
    const providerId = providerIdFrom(request)
    const storedId = providerId === 'openai-codex' && authority.principal.kind === 'user'
      ? actorCredentialProviderIdV1(authority.principal.userId, providerId)
      : providerId
    const personal = await options.vaultBackend.getCredentialMetadata(workspaceId, storedId)
    const fallback = storedId === providerId
      ? undefined
      : await options.vaultBackend.getCredentialMetadata(workspaceId, providerId)
    const stored = personal ?? (fallback?.credentialType === 'oauth'
      ? { ...fallback, state: 'needs_reauth' as const }
      : fallback)
    return reply.code(200).send(metadataProjection(options.providerRegistry, providerId, stored))
  })

  app.post(`${ROUTE_PREFIX}/openai-codex/oauth`, async (request, reply) => {
    const authority = await requireOwner(request, options)
    const { workspaceId } = authority
    if (!options.oauthBroker || authority.principal.kind !== 'user') {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.NOT_CONFIGURED, 'Credential operation failed')
    }
    const flow = await options.oauthBroker.start(workspaceId, authority.principal.userId)
    return reply.code(202).send(flow)
  })

  app.get(`${ROUTE_PREFIX}/openai-codex/oauth/:flowId`, async (request, reply) => {
    const authority = await requireOwner(request, options)
    const { workspaceId } = authority
    const flowId = (request.params as { flowId?: unknown }).flowId
    const flow = typeof flowId === 'string' && authority.principal.kind === 'user'
      ? options.oauthBroker?.get(workspaceId, authority.principal.userId, flowId)
      : undefined
    if (!flow) return reply.code(404).send({
      error: { code: CREDENTIAL_ERROR_CODES.OAUTH_STATE_INVALID, message: 'OAuth flow not found' },
    })
    return reply.code(200).send(flow)
  })

  app.post(`${ROUTE_PREFIX}/openai-codex/oauth/:flowId/respond`, async (request, reply) => {
    const authority = await requireOwner(request, options)
    const { workspaceId } = authority
    const flowId = (request.params as { flowId?: unknown }).flowId
    const body = request.body as { value?: unknown } | undefined
    if (!options.oauthBroker || authority.principal.kind !== 'user' || typeof flowId !== 'string' || typeof body?.value !== 'string') {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
    }
    const flow = await options.oauthBroker.respond(workspaceId, authority.principal.userId, flowId, body.value)
    return reply.code(200).send(flow)
  })

  app.delete(`${ROUTE_PREFIX}/openai-codex/oauth/:flowId`, async (request, reply) => {
    const authority = await requireOwner(request, options)
    const { workspaceId } = authority
    const flowId = (request.params as { flowId?: unknown }).flowId
    if (!options.oauthBroker || authority.principal.kind !== 'user' || typeof flowId !== 'string') {
      throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH, 'Credential operation failed')
    }
    await options.oauthBroker.cancel(workspaceId, authority.principal.userId, flowId)
    return reply.code(204).send()
  })

  app.post(`${LIFECYCLE_ROUTE_PREFIX}/rotate`, async (request, reply) => {
    const authority = await requireLifecycleOperator(request, options, (verified) => {
      lifecycleAudit.set(request, {
        operation: 'rotate',
        workspaceId: verified.workspaceId,
        authorizationReceiptId: verified.authorizationReceiptId,
      })
    })
    const input = parseLifecycleBody(request.body, authority.workspaceId, 'rotate')
    const dekGeneration = await options.vaultBackend.rotateWorkspaceDek(
      authority.workspaceId,
      input.operationId,
    )
    request.log.info({
      workspaceId: authority.workspaceId,
      credentialLifecycleOperation: 'rotate',
      authorizationReceiptId: authority.authorizationReceiptId,
      operationIdDigest: operationIdDigest(input.operationId),
      dekGeneration,
    }, 'credential key lifecycle completed')
    return reply.code(200).send(lifecycleReceipt(
      authority,
      'rotate',
      input.operationId,
      dekGeneration,
    ))
  })

  app.post(`${LIFECYCLE_ROUTE_PREFIX}/rewrap`, async (request, reply) => {
    const authority = await requireLifecycleOperator(request, options, (verified) => {
      lifecycleAudit.set(request, {
        operation: 'rewrap',
        workspaceId: verified.workspaceId,
        authorizationReceiptId: verified.authorizationReceiptId,
      })
    })
    const input = parseLifecycleBody(request.body, authority.workspaceId, 'rewrap')
    await options.vaultBackend.rewrapWorkspaceDek(
      authority.workspaceId,
      input.dekGeneration!,
    )
    request.log.info({
      workspaceId: authority.workspaceId,
      credentialLifecycleOperation: 'rewrap',
      authorizationReceiptId: authority.authorizationReceiptId,
      operationIdDigest: operationIdDigest(input.operationId),
      dekGeneration: input.dekGeneration,
    }, 'credential key lifecycle completed')
    return reply.code(200).send(lifecycleReceipt(
      authority,
      'rewrap',
      input.operationId,
      input.dekGeneration,
    ))
  })

  app.post(`${LIFECYCLE_ROUTE_PREFIX}/crypto-shred`, async (request, reply) => {
    const authority = await requireLifecycleOperator(request, options, (verified) => {
      lifecycleAudit.set(request, {
        operation: 'crypto-shred',
        workspaceId: verified.workspaceId,
        authorizationReceiptId: verified.authorizationReceiptId,
      })
    })
    const input = parseLifecycleBody(request.body, authority.workspaceId, 'crypto-shred')
    await options.vaultBackend.cryptoShredWorkspace(authority.workspaceId)
    request.log.info({
      workspaceId: authority.workspaceId,
      credentialLifecycleOperation: 'crypto-shred',
      authorizationReceiptId: authority.authorizationReceiptId,
      operationIdDigest: operationIdDigest(input.operationId),
    }, 'credential key lifecycle completed')
    return reply.code(200).send(lifecycleReceipt(
      authority,
      'crypto-shred',
      input.operationId,
    ))
  })

  app.put(`${ROUTE_PREFIX}/:providerId`, async (request, reply) => {
    const { workspaceId } = await requireOwner(request, options)
    const providerId = providerIdFrom(request)
    const parsed = parseWriteBody(request.body, options.providerRegistry, providerId)
    try {
      const apiKey = parsed.fields.get('api-key' as CredentialFieldId)
      if (!apiKey) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
          'Credential operation failed',
        )
      }
      await options.apiKeyValidator.validate(providerId, apiKey)
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
      const authority = await requireOwner(request, options)
      const { workspaceId } = authority
      const providerId = providerIdFrom(request)
      options.providerRegistry.require(providerId)
      const personalId = providerId === 'openai-codex' && authority.principal.kind === 'user'
        ? actorCredentialProviderIdV1(authority.principal.userId, providerId)
        : undefined
      const personal = personalId
        ? await options.vaultBackend.getCredentialMetadata(workspaceId, personalId)
        : undefined
      if (providerId === 'openai-codex' && action === 'revoke') {
        if (authority.principal.kind !== 'user' || !personalId || personal?.credentialType !== 'oauth' || !options.oauthBroker) {
          throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.NOT_CONFIGURED, 'Credential operation failed')
        }
        // Pi logout owns local credential deletion. Regardless of whether that
        // orchestration succeeds, persist a fail-closed actor tombstone. Pi does
        // not currently provide an upstream revocation confirmation API.
        await options.oauthBroker.disconnect(workspaceId, authority.principal.userId)
        // Force a new durable credential version even if Pi logout failed
        // before deleting. Cross-host login stores captured against the old
        // version can no longer replace this tombstone.
        await options.vaultBackend.writeAbsentCredential(workspaceId, personalId)
        const revoked = await options.vaultBackend.setCredentialLifecycleState(workspaceId, personalId, 'revoked')
        return reply.code(200).send(metadataProjection(options.providerRegistry, providerId, revoked))
      }
      const storedId = personalId && personal ? personalId : providerId
      const stored = await options.vaultBackend.setCredentialLifecycleState(workspaceId, storedId, action === 'disable' ? 'disabled' : 'revoked')
      return reply.code(200).send(metadataProjection(options.providerRegistry, providerId, stored))
    })
  }

  app.delete(`${ROUTE_PREFIX}/:providerId`, async (request, reply) => {
    const authority = await requireOwner(request, options)
    const { workspaceId } = authority
    const providerId = providerIdFrom(request)
    options.providerRegistry.require(providerId)
    const personalId = providerId === 'openai-codex' && authority.principal.kind === 'user'
      ? actorCredentialProviderIdV1(authority.principal.userId, providerId)
      : undefined
    const storedId = personalId
      && await options.vaultBackend.getCredentialMetadata(workspaceId, personalId)
      ? personalId
      : providerId
    await options.vaultBackend.writeAbsentCredential(workspaceId, storedId)
    const stored = await options.vaultBackend.getCredentialMetadata(workspaceId, storedId)
    return reply.code(200).send(metadataProjection(options.providerRegistry, providerId, stored))
  })
}
