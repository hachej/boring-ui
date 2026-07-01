import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { HttpError, ERROR_CODES, type ErrorCode } from '@hachej/boring-core/shared'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import { withUserSettingsWriteLock } from '@hachej/boring-core/server'
import {
  BORING_MCP_PLUGIN_ID,
  DEFAULT_MCP_PROVIDER_TEMPLATES,
  InMemoryMcpRateBudgetGate,
  MCP_ERROR_CODES,
  McpError,
  createBoringMcpAgentTools,
  createBoringMcpServerPlugin,
  createBoringMcpSourceHandlers,
  createComposioManagedConnectorProvider,
  createComposioMcpTransport,
  createManagedConnectorAdapter,
  createMcpSourceStatusPayload,
  type ManagedConnectorAdapter,
  type ManagedConnectorConfig,
  type ManagedConnectorProvider,
  type ManagedConnectorSecret,
  type ManagedConnectorSecretResolver,
  type ManagedConnectorSourceRegistry,
  type McpActor,
  type McpProviderId,
  type McpSource,
  type McpTransportClient,
} from '@hachej/boring-mcp/server'
import type { AgentTool } from '@hachej/boring-workspace'

const DEFAULT_MAX_READONLY_INPUT_BYTES = 64 * 1024
const MAX_READONLY_INPUT_BYTES = 1024 * 1024
const SOURCE_CONNECT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const
const SOURCE_ACTION_RATE_LIMIT = { max: 60, timeWindow: '1 minute' } as const

export interface FullAppBoringMcpServerConfig {
  enabled: boolean
  composioApiKeyConfigured: boolean
  maxReadonlyInputBytes: number
}

function parseReadonlyInputLimit(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_READONLY_INPUT_BYTES
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_READONLY_INPUT_BYTES) return DEFAULT_MAX_READONLY_INPUT_BYTES
  return parsed
}

export function readFullAppBoringMcpServerConfig(env: NodeJS.ProcessEnv = process.env): FullAppBoringMcpServerConfig {
  return {
    enabled: env.BORING_MCP_ENABLED !== '0',
    composioApiKeyConfigured: Boolean(env.COMPOSIO_API_KEY?.trim()),
    maxReadonlyInputBytes: parseReadonlyInputLimit(env.BORING_MCP_MAX_READONLY_INPUT_BYTES),
  }
}

const FULL_APP_MANAGED_CONNECTOR_CONFIGS: readonly ManagedConnectorConfig[] = [
  { provider: 'notion', displayName: 'Notion', toolkitId: 'notion', connectUrlOrigins: ['https://app.composio.dev', 'https://connect.composio.dev'] },
  { provider: 'airtable', displayName: 'Airtable', toolkitId: 'airtable', connectUrlOrigins: ['https://app.composio.dev', 'https://connect.composio.dev'] },
]

export function createFullAppManagedConnectorSecretResolver(
  env: NodeJS.ProcessEnv = process.env,
  configs: readonly ManagedConnectorConfig[] = FULL_APP_MANAGED_CONNECTOR_CONFIGS,
): ManagedConnectorSecretResolver {
  const supportedProviders = new Set<McpProviderId>(configs.map((config) => config.provider))
  return {
    async resolveSecret(provider: McpProviderId): Promise<ManagedConnectorSecret> {
      if (!supportedProviders.has(provider)) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, `Unsupported MCP provider: ${provider}`)
      const value = env.COMPOSIO_API_KEY?.trim()
      if (!value) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, 'COMPOSIO_API_KEY is not configured')
      return { storage: 'server-env', value }
    },
  }
}

const FULL_APP_MCP_REDACTION_CANARIES = ['cmp_full_app_canary'] as const

export function createFullAppManagedConnectorAdapter(options: {
  env?: NodeJS.ProcessEnv
  registry: ManagedConnectorSourceRegistry
  provider?: ManagedConnectorProvider
}): ManagedConnectorAdapter {
  return createManagedConnectorAdapter({
    registry: options.registry,
    provider: options.provider ?? createComposioManagedConnectorProvider(),
    secretResolver: createFullAppManagedConnectorSecretResolver(options.env, FULL_APP_MANAGED_CONNECTOR_CONFIGS),
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    redactionCanaries: FULL_APP_MCP_REDACTION_CANARIES,
    configs: FULL_APP_MANAGED_CONNECTOR_CONFIGS,
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

export function fullAppAgentSessionNamespace(ctx: { workspaceId: string; request?: FastifyRequest }): string {
  const workspaceSegment = safeSessionNamespaceSegment(ctx.workspaceId)
  const userId = requestUserId(ctx.request)
  return userId ? `${workspaceSegment}_user_${shortHash(userId)}` : workspaceSegment
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
      return error.message.startsWith('Unknown') || error.message.startsWith('Unsupported')
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

function readStoredSources(settings: Record<string, unknown>, actor: McpActor): McpSource[] {
  const root = asRecord(settings[USER_SETTINGS_MCP_SOURCES_KEY])
  const workspaceSources = asRecord(root[actor.workspaceId])
  return Object.values(workspaceSources)
    .map(sourceFromUnknown)
    .filter((source): source is McpSource => Boolean(source && source.workspaceId === actor.workspaceId && source.userId === actor.userId))
}

async function saveStoredSource(
  app: Pick<CoreWorkspaceAgentServer, 'userStore' | 'config'>,
  actor: McpActor,
  source: McpSource,
): Promise<McpSource[]> {
  const patch = app.userStore.patchUserSettingsJsonPath
  if (patch) {
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
    const sources = readStoredSources(current.settings, actor)
    const nextSources = [...sources.filter((item) => item.id !== source.id), source]
    const nextSettings = {
      ...current.settings,
      [USER_SETTINGS_MCP_SOURCES_KEY]: {
        ...root,
        [actor.workspaceId]: Object.fromEntries(nextSources.map((item) => [item.id, item])),
      },
    }
    await app.userStore.putUserSettings(actor.userId, app.config.appId, { settings: nextSettings })
    return nextSources
  })
}

export function createFullAppMcpSourceRegistry(app: Pick<CoreWorkspaceAgentServer, 'userStore' | 'config'>, actorScope?: McpActor): ManagedConnectorSourceRegistry {
  return {
    async listSources(actor) {
      const current = await app.userStore.getUserSettings(actor.userId, app.config.appId)
      return readStoredSources(current.settings, actor)
    },
    async getSource(sourceId) {
      if (!actorScope) return undefined
      const current = await app.userStore.getUserSettings(actorScope.userId, app.config.appId)
      return readStoredSources(current.settings, actorScope).find((source) => source.id === sourceId)
    },
    async upsertSource(actor, source) {
      const now = new Date().toISOString()
      const current = await this.listSources(actor)
      const existing = current.find((item) => item.id === source.id)
      const next = { ...source, updatedAt: now, createdAt: source.createdAt ?? existing?.createdAt ?? now }
      await saveStoredSource(app, actor, next)
      return next
    },
    async disconnectSource(actor, sourceId) {
      const current = await this.listSources(actor)
      const source = current.find((item) => item.id === sourceId)
      if (!source) return undefined
      const disconnected = { ...source, status: 'revoked' as const, updatedAt: new Date().toISOString() }
      await saveStoredSource(app, actor, disconnected)
      return disconnected
    },
  }
}

export interface CreateFullAppBoringMcpAgentToolsOptions {
  env?: NodeJS.ProcessEnv
  transport?: McpTransportClient
}

function createFullAppComposioMcpTransport(env?: NodeJS.ProcessEnv): McpTransportClient {
  return createComposioMcpTransport({
    secretResolver: createFullAppManagedConnectorSecretResolver(env, FULL_APP_MANAGED_CONNECTOR_CONFIGS),
    configs: FULL_APP_MANAGED_CONNECTOR_CONFIGS,
    clientName: 'boring-full-app-mcp',
    clientVersion: '0.0.0',
  })
}

export function createFullAppBoringMcpAgentTools(
  app: Pick<CoreWorkspaceAgentServer, 'userStore' | 'config'>,
  actor: McpActor,
  options: CreateFullAppBoringMcpAgentToolsOptions = {},
): AgentTool[] {
  const config = readFullAppBoringMcpServerConfig(options.env)
  if (!config.enabled) return []
  const registry = createFullAppMcpSourceRegistry(app, actor)
  const transport = options.transport ?? createFullAppComposioMcpTransport(options.env)
  return createBoringMcpAgentTools({
    registry,
    transport,
    resolveActor: () => actor,
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    hardening: { gate: new InMemoryMcpRateBudgetGate({ maxCalls: 100, maxToolCalls: 10, windowMs: 60_000 }), timeoutMs: 30_000 },
    maxReadonlyInputBytes: config.maxReadonlyInputBytes,
  })
}

export function createFullAppBoringMcpAgentToolsForRequest(
  app: Pick<CoreWorkspaceAgentServer, 'userStore' | 'config'>,
  ctx: { workspaceId: string; authSubject?: string },
  options: CreateFullAppBoringMcpAgentToolsOptions = {},
): AgentTool[] {
  const userId = typeof ctx.authSubject === 'string' && ctx.authSubject.trim() ? ctx.authSubject.trim() : undefined
  if (!userId) return []
  return createFullAppBoringMcpAgentTools(app, { workspaceId: ctx.workspaceId, userId }, options)
}

async function requireBoringMcpActor(app: CoreWorkspaceAgentServer, request: FastifyRequest): Promise<McpActor> {
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

export function registerFullAppBoringMcpRoutes(app: CoreWorkspaceAgentServer, options: { provider?: ManagedConnectorProvider; env?: NodeJS.ProcessEnv; transport?: McpTransportClient } = {}): void {
  if (!readFullAppBoringMcpServerConfig(options.env).enabled) return

  const routeTransport = options.transport ?? createFullAppComposioMcpTransport(options.env)
  const routeGate = new InMemoryMcpRateBudgetGate({ maxCalls: 100, maxToolCalls: 10, windowMs: 60_000 })

  function adapterFor(actor: McpActor) {
    const registry = createFullAppMcpSourceRegistry(app, actor)
    return { registry, adapter: createFullAppManagedConnectorAdapter({ registry, provider: options.provider, env: options.env }) }
  }

  function handlersFor(actor: McpActor) {
    return createBoringMcpSourceHandlers({
      registry: createFullAppMcpSourceRegistry(app, actor),
      transport: routeTransport,
      templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
      hardening: { gate: routeGate, timeoutMs: 30_000 },
    })
  }

  app.get('/api/v1/boring-mcp/sources', async (request) => {
    const actor = await requireBoringMcpActor(app, request)
    const { registry } = adapterFor(actor)
    const sources = await registry.listSources(actor)
    return { sourceStatuses: sources.map(createMcpSourceStatusPayload) }
  })

  app.post('/api/v1/boring-mcp/connect', {
    config: { rateLimit: { ...SOURCE_CONNECT_RATE_LIMIT, keyGenerator: sourceActionRateLimitKey } },
  }, async (request, reply) => {
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
    const actor = await requireBoringMcpActor(app, request)
    const { adapter } = adapterFor(actor)
    const result = await withMcpHttpErrors(request.id, () => adapter.refreshStatus(actor, sourceIdFromBody(request.body, request.id)))
    return { status: result }
  })

  app.post('/api/v1/boring-mcp/disconnect', {
    config: { rateLimit: { ...SOURCE_ACTION_RATE_LIMIT, keyGenerator: sourceActionRateLimitKey } },
  }, async (request) => {
    const actor = await requireBoringMcpActor(app, request)
    const status = await withMcpHttpErrors(request.id, () => handlersFor(actor).disconnectSource(actor, sourceIdFromBody(request.body, request.id)))
    return { status }
  })

  app.post('/api/v1/boring-mcp/tools', {
    config: { rateLimit: { ...SOURCE_ACTION_RATE_LIMIT, keyGenerator: sourceActionRateLimitKey } },
  }, async (request) => {
    const actor = await requireBoringMcpActor(app, request)
    const body = asRecord(request.body)
    const result = await withMcpHttpErrors(request.id, () => handlersFor(actor).searchTools(actor, {
      sourceId: sourceIdFromBody(request.body, request.id),
      refresh: body.refresh === true,
    }))
    return { tools: result.tools }
  })
}

export function createFullAppBoringMcpServerPlugins(env: NodeJS.ProcessEnv = process.env) {
  const config = readFullAppBoringMcpServerConfig(env)
  if (!config.enabled) return []
  return [createBoringMcpServerPlugin({
    systemPrompt: 'MCP providers are available through the app-owned boring-mcp integration. Use governed read-only MCP calls only after search/describe confirms the tool is enabled.',
  })]
}

export const boringMcpServerPlugins = createFullAppBoringMcpServerPlugins()
