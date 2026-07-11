// Reusable server binding that wires the generic boring-mcp foundation to a
// boring-core host app (per-user source persistence, HTTP route surface, agent
// tools, and the Composio-managed connector transport).
//
// Host apps (full-app and tenant deployments) previously copied this glue
// verbatim, differing only in configuration (which managed connectors are
// exposed, which env var holds the Composio key, redaction canaries, and the
// MCP client identity). This module accepts that configuration so hosts import
// it instead of copying it.
import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { HttpError, ERROR_CODES, type ErrorCode } from '@hachej/boring-core/shared'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import { withUserSettingsWriteLock } from '@hachej/boring-core/server'
import type { AgentTool } from '@hachej/boring-workspace'

import {
  DEFAULT_MCP_PROVIDER_TEMPLATES,
  MCP_ERROR_CODES,
  McpError,
  type McpActor,
  type McpProviderId,
  type McpSource,
  type McpTransportClient,
} from '../shared'
import { InMemoryMcpRateBudgetGate } from './hardening'
import {
  createLegacyManagedConnectorSourceId,
  createManagedConnectorAdapter,
  createManagedConnectorSourceId,
  type ManagedConnectorAdapter,
  type ManagedConnectorConfig,
  type ManagedConnectorProvider,
  type ManagedConnectorSecret,
  type ManagedConnectorSecretResolver,
  type ManagedConnectorSourceRegistry,
} from './managedConnectorAdapter'
import { createComposioManagedConnectorProvider, createComposioMcpTransport } from './composioManagedConnector'
import { createMcpSourceStatusPayload } from './sourceAccess'
import { createBoringMcpSourceHandlers } from './sourceHandlers'
import { createBoringMcpAgentTools } from './agentTools'

const DEFAULT_MAX_READONLY_INPUT_BYTES = 64 * 1024
const MAX_READONLY_INPUT_BYTES = 1024 * 1024
const SOURCE_CONNECT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const
const SOURCE_ACTION_RATE_LIMIT = { max: 60, timeWindow: '1 minute' } as const
const DEFAULT_SECRET_ENV_VARS = ['COMPOSIO_API_KEY'] as const

/** App server surface the boring-mcp binding depends on. */
export type BoringMcpAppServer = CoreWorkspaceAgentServer

/**
 * Per-deployment configuration for the boring-mcp server binding. Everything a
 * host used to hardcode when copying the glue lives here.
 */
export interface BoringMcpBindingConfig {
  /** Managed connector providers this deployment exposes. */
  connectorConfigs: readonly ManagedConnectorConfig[]
  /**
   * Env var names checked (in order) for the Composio managed-connector API
   * key. Defaults to `['COMPOSIO_API_KEY']`.
   */
  secretEnvVars?: readonly string[]
  /** Redaction canary tokens forwarded to the managed connector adapter. */
  redactionCanaries?: readonly string[]
  /** Composio MCP transport client identity. */
  clientName?: string
  clientVersion?: string
}

export interface BoringMcpServerRuntimeConfig {
  enabled: boolean
  composioApiKeyConfigured: boolean
  maxReadonlyInputBytes: number
}

function resolveSecretEnvVars(config: Pick<BoringMcpBindingConfig, 'secretEnvVars'>): readonly string[] {
  return config.secretEnvVars && config.secretEnvVars.length > 0 ? config.secretEnvVars : DEFAULT_SECRET_ENV_VARS
}

function resolveComposioSecret(env: NodeJS.ProcessEnv, secretEnvVars: readonly string[]): string | undefined {
  for (const name of secretEnvVars) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function parseReadonlyInputLimit(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_READONLY_INPUT_BYTES
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_READONLY_INPUT_BYTES) return DEFAULT_MAX_READONLY_INPUT_BYTES
  return parsed
}

export function readBoringMcpServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { secretEnvVars?: readonly string[] } = {},
): BoringMcpServerRuntimeConfig {
  const productionEnabled = env.BORING_MCP_PROD_ENABLED === '1'
  const nonProductionEnabled = env.BORING_MCP_ENABLED !== '0'
  const secretEnvVars = resolveSecretEnvVars(options)
  return {
    enabled: env.NODE_ENV === 'production' ? productionEnabled : nonProductionEnabled,
    composioApiKeyConfigured: Boolean(resolveComposioSecret(env, secretEnvVars)),
    maxReadonlyInputBytes: parseReadonlyInputLimit(env.BORING_MCP_MAX_READONLY_INPUT_BYTES),
  }
}

export interface CreateManagedConnectorSecretResolverOptions {
  env?: NodeJS.ProcessEnv
  configs: readonly ManagedConnectorConfig[]
  secretEnvVars?: readonly string[]
}

export function createManagedConnectorSecretResolver(
  options: CreateManagedConnectorSecretResolverOptions,
): ManagedConnectorSecretResolver {
  const env = options.env ?? process.env
  const secretEnvVars = resolveSecretEnvVars(options)
  const supportedProviders = new Set<McpProviderId>(options.configs.map((config) => config.provider))
  return {
    async resolveSecret(provider: McpProviderId): Promise<ManagedConnectorSecret> {
      if (!supportedProviders.has(provider)) {
        throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, `Unsupported MCP provider: ${provider}`, { reason: 'unsupported_provider' })
      }
      const value = resolveComposioSecret(env, secretEnvVars)
      if (!value) {
        throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, `${secretEnvVars.join('/')} is not configured`)
      }
      return { storage: 'server-env', value }
    },
  }
}

export interface CreateManagedConnectorAdapterOptions {
  config: BoringMcpBindingConfig
  registry: ManagedConnectorSourceRegistry
  env?: NodeJS.ProcessEnv
  provider?: ManagedConnectorProvider
}

export function createBoringMcpManagedConnectorAdapter(options: CreateManagedConnectorAdapterOptions): ManagedConnectorAdapter {
  return createManagedConnectorAdapter({
    registry: options.registry,
    provider: options.provider ?? createComposioManagedConnectorProvider(),
    secretResolver: createManagedConnectorSecretResolver({
      env: options.env,
      configs: options.config.connectorConfigs,
      secretEnvVars: options.config.secretEnvVars,
    }),
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    redactionCanaries: options.config.redactionCanaries,
    configs: options.config.connectorConfigs,
  })
}

const USER_SETTINGS_MCP_SOURCES_KEY = '__serverBoringMcpSourcesV1'
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function requestUserId(request: FastifyRequest | undefined): string | undefined {
  const user = request?.user
  return typeof user?.id === 'string' && user.id.trim() ? user.id : undefined
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function safeSessionNamespaceSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'workspace'
}

export function boringMcpAgentSessionNamespace(ctx: { workspaceId: string; request?: FastifyRequest; userId?: string }): string {
  const workspaceSegment = safeSessionNamespaceSegment(ctx.workspaceId)
  const userId = ctx.userId?.trim() || requestUserId(ctx.request)
  return `${workspaceSegment}_user_${userId ? shortHash(userId) : 'anonymous'}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function validateWorkspaceId(value: unknown, requestId: string): string {
  const workspaceId = parseString(value)
  if (!workspaceId || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new HttpError({ status: 400, code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid workspace id', requestId })
  }
  return workspaceId
}

function routeError(status: number, code: ErrorCode, message: string, requestId: string): HttpError {
  return new HttpError({ status, code, message, requestId })
}

function mcpHttpStatus(error: McpError): { status: number; code: ErrorCode } {
  switch (error.code) {
    case MCP_ERROR_CODES.SOURCE_NOT_FOUND:
    case MCP_ERROR_CODES.TOOL_NOT_FOUND:
      return { status: 404, code: ERROR_CODES.NOT_FOUND }
    case MCP_ERROR_CODES.SOURCE_FORBIDDEN:
      return { status: 403, code: ERROR_CODES.FORBIDDEN }
    case MCP_ERROR_CODES.INPUT_INVALID:
    case MCP_ERROR_CODES.RESOURCE_URI_INVALID:
    case MCP_ERROR_CODES.PROVIDER_TOOL_DRIFT:
    case MCP_ERROR_CODES.TOOL_NOT_ALLOWED:
      return { status: 400, code: ERROR_CODES.VALIDATION_FAILED }
    case MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID:
      return asRecord(error.details).reason === 'unsupported_provider'
        ? { status: 400, code: ERROR_CODES.VALIDATION_FAILED }
        : { status: 503, code: ERROR_CODES.CONFIG_VALIDATION_FAILED }
    case MCP_ERROR_CODES.SOURCE_UNAVAILABLE:
      return { status: 409, code: ERROR_CODES.VALIDATION_FAILED }
    case MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED:
      return { status: 413, code: ERROR_CODES.VALIDATION_FAILED }
    case MCP_ERROR_CODES.PROVIDER_TIMEOUT:
      return { status: 504, code: ERROR_CODES.INTERNAL_ERROR }
    case MCP_ERROR_CODES.PROVIDER_ERROR:
      return { status: 502, code: ERROR_CODES.INTERNAL_ERROR }
    case MCP_ERROR_CODES.SECRET_LEAK_GUARD:
      return { status: 500, code: ERROR_CODES.INTERNAL_ERROR }
    default:
      return { status: 500, code: ERROR_CODES.INTERNAL_ERROR }
  }
}

async function withMcpHttpErrors<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof McpError) {
      const mapped = mcpHttpStatus(error)
      throw routeError(mapped.status, mapped.code, error.message, requestId)
    }
    throw error
  }
}

function sourceFromUnknown(value: unknown): McpSource | undefined {
  const record = asRecord(value)
  const id = parseString(record.id)
  const workspaceId = parseString(record.workspaceId)
  const userId = parseString(record.userId)
  const provider = parseString(record.provider)
  const displayName = parseString(record.displayName)
  const status = parseString(record.status)
  const ownerKind = parseString(record.ownerKind)
  const credentialProvider = parseString(record.credentialProvider)
  if (!id || !workspaceId || !userId || !provider || !displayName || !status || !ownerKind || !credentialProvider) return undefined
  if (!['connected', 'expired', 'revoked', 'error', 'unconfigured'].includes(status)) return undefined
  return {
    id,
    workspaceId,
    userId,
    provider,
    displayName,
    status: status as McpSource['status'],
    ownerKind: ownerKind as McpSource['ownerKind'],
    credentialProvider: credentialProvider as McpSource['credentialProvider'],
    scopes: Array.isArray(record.scopes) ? record.scopes.filter((item): item is string => typeof item === 'string') : undefined,
    providerAccountLabel: parseString(record.providerAccountLabel),
    connectorRef: asRecord(record.connectorRef) as unknown as McpSource['connectorRef'],
    lastVerifiedAt: parseString(record.lastVerifiedAt),
    createdAt: parseString(record.createdAt),
    updatedAt: parseString(record.updatedAt),
  }
}

function readRawStoredSources(settings: Record<string, unknown>, actor: McpActor): McpSource[] {
  const root = asRecord(settings[USER_SETTINGS_MCP_SOURCES_KEY])
  const workspaceSources = asRecord(root[actor.workspaceId])
  return Object.values(workspaceSources)
    .map(sourceFromUnknown)
    .filter((source): source is McpSource => Boolean(source && source.workspaceId === actor.workspaceId && source.userId === actor.userId))
}

function normalizeStoredSourceId(actor: McpActor, source: McpSource): McpSource {
  try {
    const legacyId = createLegacyManagedConnectorSourceId(actor, source.provider)
    return source.id === legacyId ? { ...source, id: createManagedConnectorSourceId(actor, source.provider) } : source
  } catch {
    return source
  }
}

function sourceStatusRank(source: McpSource): number {
  switch (source.status) {
    case 'connected': return 5
    case 'expired':
    case 'error': return 4
    case 'unconfigured': return 3
    case 'revoked': return 1
    default: return 0
  }
}

function dedupeStoredSources(sources: McpSource[]): McpSource[] {
  const byId = new Map<string, McpSource>()
  for (const source of sources) {
    const current = byId.get(source.id)
    if (!current || sourceStatusRank(source) >= sourceStatusRank(current)) byId.set(source.id, source)
  }
  return [...byId.values()]
}

function readStoredSources(settings: Record<string, unknown>, actor: McpActor): McpSource[] {
  return dedupeStoredSources(readRawStoredSources(settings, actor).map((source) => normalizeStoredSourceId(actor, source)))
}

function existingLegacySourceIdFor(actor: McpActor, source: McpSource, rawSources: readonly McpSource[]): string | undefined {
  try {
    const legacyId = createLegacyManagedConnectorSourceId(actor, source.provider)
    return legacyId !== source.id && rawSources.some((item) => item.id === legacyId) ? legacyId : undefined
  } catch {
    return undefined
  }
}

async function saveStoredSource(
  app: Pick<BoringMcpAppServer, 'userStore' | 'config'>,
  actor: McpActor,
  source: McpSource,
  removeSourceIds: readonly string[] = [],
): Promise<McpSource[]> {
  const patch = app.userStore.patchUserSettingsJsonPath
  if (patch && removeSourceIds.length === 0) {
    const updated = await patch.call(
      app.userStore,
      actor.userId,
      app.config.appId,
      [USER_SETTINGS_MCP_SOURCES_KEY, actor.workspaceId, source.id],
      source,
    )
    return readStoredSources(updated.settings, actor)
  }

  return await withUserSettingsWriteLock(actor.userId, app.config.appId, async () => {
    const current = await app.userStore.getUserSettings(actor.userId, app.config.appId)
    const root = asRecord(current.settings[USER_SETTINGS_MCP_SOURCES_KEY])
    const removeIds = new Set([source.id, ...removeSourceIds])
    const sources = readRawStoredSources(current.settings, actor)
    const nextSources = [...sources.filter((item) => !removeIds.has(item.id)), source]
    const nextSettings = {
      ...current.settings,
      [USER_SETTINGS_MCP_SOURCES_KEY]: {
        ...root,
        [actor.workspaceId]: Object.fromEntries(nextSources.map((item) => [item.id, item])),
      },
    }
    await app.userStore.putUserSettings(actor.userId, app.config.appId, { settings: nextSettings })
    return readStoredSources(nextSettings, actor)
  })
}

export function createUserSettingsMcpSourceRegistry(
  app: Pick<BoringMcpAppServer, 'userStore' | 'config'>,
  actorScope: McpActor,
): ManagedConnectorSourceRegistry {
  return {
    async listSources(actor) {
      const current = await app.userStore.getUserSettings(actor.userId, app.config.appId)
      return readStoredSources(current.settings, actor)
    },
    async getSource(sourceId) {
      const current = await app.userStore.getUserSettings(actorScope.userId, app.config.appId)
      const source = readStoredSources(current.settings, actorScope).find((item) => item.id === sourceId)
      if (source) return source
      const legacySource = readRawStoredSources(current.settings, actorScope).find((item) => item.id === sourceId)
      return legacySource ? normalizeStoredSourceId(actorScope, legacySource) : undefined
    },
    async upsertSource(actor, source) {
      const now = new Date().toISOString()
      const currentSettings = await app.userStore.getUserSettings(actor.userId, app.config.appId)
      const current = readStoredSources(currentSettings.settings, actor)
      const rawSources = readRawStoredSources(currentSettings.settings, actor)
      const existing = current.find((item) => item.id === source.id)
      const next = { ...source, updatedAt: now, createdAt: source.createdAt ?? existing?.createdAt ?? now }
      const legacyId = existingLegacySourceIdFor(actor, next, rawSources)
      await saveStoredSource(app, actor, next, legacyId ? [legacyId] : [])
      return next
    },
    async disconnectSource(actor, sourceId) {
      const currentSettings = await app.userStore.getUserSettings(actor.userId, app.config.appId)
      const source = readStoredSources(currentSettings.settings, actor).find((item) => item.id === sourceId)
        ?? (() => {
          const legacySource = readRawStoredSources(currentSettings.settings, actor).find((item) => item.id === sourceId)
          return legacySource ? normalizeStoredSourceId(actor, legacySource) : undefined
        })()
      if (!source) return undefined
      const disconnected = { ...source, status: 'revoked' as const, updatedAt: new Date().toISOString() }
      const legacyId = existingLegacySourceIdFor(actor, disconnected, readRawStoredSources(currentSettings.settings, actor))
      await saveStoredSource(app, actor, disconnected, legacyId ? [legacyId] : [])
      return disconnected
    },
  }
}

export interface CreateBoringMcpAppAgentToolsOptions {
  config: BoringMcpBindingConfig
  env?: NodeJS.ProcessEnv
  transport?: McpTransportClient
}

function createComposioMcpTransportFor(config: BoringMcpBindingConfig, env?: NodeJS.ProcessEnv): McpTransportClient {
  return createComposioMcpTransport({
    secretResolver: createManagedConnectorSecretResolver({ env, configs: config.connectorConfigs, secretEnvVars: config.secretEnvVars }),
    configs: config.connectorConfigs,
    clientName: config.clientName ?? 'boring-mcp',
    clientVersion: config.clientVersion ?? '0.0.0',
  })
}

export function createBoringMcpAppAgentTools(
  app: Pick<BoringMcpAppServer, 'userStore' | 'config'>,
  actor: McpActor,
  options: CreateBoringMcpAppAgentToolsOptions,
): AgentTool[] {
  const runtimeConfig = readBoringMcpServerConfig(options.env, { secretEnvVars: options.config.secretEnvVars })
  if (!runtimeConfig.enabled) return []
  const registry = createUserSettingsMcpSourceRegistry(app, actor)
  const transport = options.transport ?? createComposioMcpTransportFor(options.config, options.env)
  return createBoringMcpAgentTools({
    registry,
    transport,
    resolveActor: () => actor,
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    hardening: { gate: new InMemoryMcpRateBudgetGate({ maxCalls: 100, maxToolCalls: 10, windowMs: 60_000 }), timeoutMs: 30_000 },
    maxReadonlyInputBytes: runtimeConfig.maxReadonlyInputBytes,
  })
}

export function createBoringMcpAppAgentToolsForRequest(
  app: Pick<BoringMcpAppServer, 'userStore' | 'config'>,
  ctx: { workspaceId: string; authSubject?: string },
  options: CreateBoringMcpAppAgentToolsOptions,
): AgentTool[] {
  const userId = typeof ctx.authSubject === 'string' && ctx.authSubject.trim() ? ctx.authSubject.trim() : undefined
  if (!userId) return []
  return createBoringMcpAppAgentTools(app, { workspaceId: ctx.workspaceId, userId }, options)
}

async function requireBoringMcpActor(app: BoringMcpAppServer, request: FastifyRequest): Promise<McpActor> {
  const body = asRecord(request.body)
  const query = asRecord(request.query)
  const workspaceId = validateWorkspaceId(
    request.headers['x-boring-workspace-id'] ?? body.workspaceId ?? query.workspaceId,
    request.id,
  )
  const user = request.user
  if (!user) throw routeError(401, ERROR_CODES.UNAUTHORIZED, 'Authentication required', request.id)
  const workspace = await app.workspaceStore.get(workspaceId)
  if (!workspace || workspace.appId !== app.config.appId) throw routeError(404, ERROR_CODES.NOT_FOUND, 'Workspace not found', request.id)
  const role = await app.workspaceStore.getMemberRole(workspaceId, user.id)
  if (!role) throw routeError(403, ERROR_CODES.NOT_MEMBER, 'Not a member of this workspace', request.id)
  return { workspaceId, userId: user.id }
}

function sourceActionRateLimitKey(request: FastifyRequest): string {
  const workspaceId = typeof request.headers['x-boring-workspace-id'] === 'string'
    ? request.headers['x-boring-workspace-id']
    : 'unknown-workspace'
  return `${request.user?.id ?? request.ip}:${workspaceId}`
}

function sourceIdFromBody(body: unknown, requestId: string): string {
  const sourceId = parseString(asRecord(body).sourceId)
  if (!sourceId) throw routeError(400, ERROR_CODES.VALIDATION_FAILED, 'sourceId is required', requestId)
  return sourceId
}

function providerFromBody(body: unknown, requestId: string): McpProviderId {
  const provider = parseString(asRecord(body).provider)
  if (!provider) throw routeError(400, ERROR_CODES.VALIDATION_FAILED, 'provider is required', requestId)
  return provider
}

export interface RegisterBoringMcpRoutesOptions {
  config: BoringMcpBindingConfig
  provider?: ManagedConnectorProvider
  env?: NodeJS.ProcessEnv
  transport?: McpTransportClient
  /**
   * Behavior when boring-mcp is disabled for this deployment.
   * - `skip` (default): do not register the routes at all (client sees 404).
   * - `serve-503`: always register; handlers reject with 503 while disabled.
   */
  whenDisabled?: 'skip' | 'serve-503'
}

export function registerBoringMcpRoutes(app: BoringMcpAppServer, options: RegisterBoringMcpRoutesOptions): void {
  const whenDisabled = options.whenDisabled ?? 'skip'
  const enabled = readBoringMcpServerConfig(options.env, { secretEnvVars: options.config.secretEnvVars }).enabled
  if (!enabled && whenDisabled === 'skip') return

  const assertEnabled = (requestId: string): void => {
    if (!enabled) throw routeError(503, ERROR_CODES.INTERNAL_ERROR, 'MCP source routes are disabled for this deployment', requestId)
  }

  const routeTransport = options.transport ?? createComposioMcpTransportFor(options.config, options.env)
  const routeGate = new InMemoryMcpRateBudgetGate({ maxCalls: 100, maxToolCalls: 10, windowMs: 60_000 })

  function adapterFor(actor: McpActor) {
    const registry = createUserSettingsMcpSourceRegistry(app, actor)
    return {
      registry,
      adapter: createBoringMcpManagedConnectorAdapter({ config: options.config, registry, provider: options.provider, env: options.env }),
    }
  }

  function handlersFor(actor: McpActor) {
    return createBoringMcpSourceHandlers({
      registry: createUserSettingsMcpSourceRegistry(app, actor),
      transport: routeTransport,
      templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
      hardening: { gate: routeGate, timeoutMs: 30_000 },
    })
  }

  app.get('/api/v1/boring-mcp/sources', async (request) => {
    assertEnabled(request.id)
    const actor = await requireBoringMcpActor(app, request)
    const { registry } = adapterFor(actor)
    const sources = await registry.listSources(actor)
    return { sourceStatuses: sources.map(createMcpSourceStatusPayload) }
  })

  app.post('/api/v1/boring-mcp/connect', {
    config: { rateLimit: { ...SOURCE_CONNECT_RATE_LIMIT, keyGenerator: sourceActionRateLimitKey } },
  }, async (request, reply) => {
    assertEnabled(request.id)
    const actor = await requireBoringMcpActor(app, request)
    const { adapter } = adapterFor(actor)
    const provider = providerFromBody(request.body, request.id)
    const result = await withMcpHttpErrors(request.id, () => adapter.startConnect(actor, { provider }))
    const { connectUrl, ...status } = result
    reply.status(201)
    return { status, connectUrl }
  })

  app.post('/api/v1/boring-mcp/refresh', {
    config: { rateLimit: { ...SOURCE_ACTION_RATE_LIMIT, keyGenerator: sourceActionRateLimitKey } },
  }, async (request) => {
    assertEnabled(request.id)
    const actor = await requireBoringMcpActor(app, request)
    const { adapter } = adapterFor(actor)
    const result = await withMcpHttpErrors(request.id, () => adapter.refreshStatus(actor, sourceIdFromBody(request.body, request.id)))
    return { status: result }
  })

  app.post('/api/v1/boring-mcp/disconnect', {
    config: { rateLimit: { ...SOURCE_ACTION_RATE_LIMIT, keyGenerator: sourceActionRateLimitKey } },
  }, async (request) => {
    assertEnabled(request.id)
    const actor = await requireBoringMcpActor(app, request)
    const status = await withMcpHttpErrors(request.id, () => adapterFor(actor).adapter.disconnectSource(actor, sourceIdFromBody(request.body, request.id)))
    return { status }
  })

  app.post('/api/v1/boring-mcp/tools', {
    config: { rateLimit: { ...SOURCE_ACTION_RATE_LIMIT, keyGenerator: sourceActionRateLimitKey } },
  }, async (request) => {
    assertEnabled(request.id)
    const actor = await requireBoringMcpActor(app, request)
    const body = asRecord(request.body)
    const result = await withMcpHttpErrors(request.id, () => handlersFor(actor).searchTools(actor, {
      sourceId: sourceIdFromBody(request.body, request.id),
      refresh: body.refresh === true,
    }))
    return { tools: result.tools }
  })
}
