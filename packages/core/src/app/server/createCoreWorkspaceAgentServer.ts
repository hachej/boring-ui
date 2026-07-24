import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'

import {
  compactPiPackages,
  autoDetectMode,
  createRemoteWorkerModeAdapter,
  provisionWorkspaceRuntime,
  registerAgentRoutes,
  type RegisterAgentRoutesOptions,
  type RuntimeEnvContributionContext,
  type RuntimeProvisioningContribution,
  type WorkspaceAgentDispatcherResolver,
} from '@hachej/boring-agent/server'
import type { SandboxHandleStore } from '@hachej/boring-agent/shared'
import {
  assertWorkspaceBridgeHandlersTrusted,
  collectWorkspaceAgentServerPlugins,
  createSandboxRuntimeModeAdapter,
  hasDirServerPlugin,
  omitPluginAuthoringProvisioning,
  readWorkspacePluginPackagePiSnapshot,
  readWorkspacePluginPackageRuntimePlugins,
  resolveDefaultWorkspacePluginPackagePaths,
  resolveOnePluginEntry,
  sandboxRuntimeHostOperations,
  type CreateWorkspaceAgentServerOptions,
  type DirPluginEntry,
  type WorkspaceAgentServerPluginContext,
} from '@hachej/boring-workspace/app/server'
import {
  createWorkspaceUiTools,
  uiRoutes,
  type WorkspaceBridge,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeHandler,
  type WorkspaceBridgeOperationDefinition,
  type WorkspaceBridgeRuntimeEnvOptions,
  type WorkspaceServerPlugin,
} from '@hachej/boring-workspace/server'
import { createCoreWorkspaceBridge } from './coreWorkspaceBridge.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type postgres from 'postgres'
import type { CoreConfig } from '../../shared/types.js'
import { ERROR_CODES, HttpError } from '../../shared/errors.js'
import { safeCapture, type TelemetrySink } from '../../shared/telemetry.js'
import {
  authHook,
  createAuth,
  type BetterAuthInstance,
} from '../../server/auth/index.js'
import { REQUEST_SCOPE_WORKSPACE_HEADER } from '../../server/auth/requestWorkspaceScope.js'
import {
  createCoreApp,
  registerRoutes,
  type UserStore,
  type WorkspaceStore,
  type CoreRequestScopeResolver,
} from '../../server/app/index.js'
import {
  registerInviteRoutes,
  registerMemberRoutes,
  registerSettingsRoutes,
  registerWorkspaceRoutes,
} from '../../server/routes/index.js'
import {
  createDatabase,
  PostgresUserStore,
  PostgresWorkspaceStore,
  type Database,
} from '../../server/db/index.js'
import { loadConfig, type LoadConfigOptions } from '../../server/config/index.js'
import { WorkspaceRuntimeSandboxHandleStore } from '../../server/runtime/index.js'
import { createDatabaseTelemetryFromEnv } from '../../server/telemetry/db.js'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const AUTH_PROXY_BLOCKED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
])

// Pages that are served as the SPA shell (catch-all) AND get explicit GET routes
// so the browser can navigate directly to them without hitting the auth proxy.
const FRONTEND_AUTH_PAGES = new Set([
  '/auth/signin',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password',
])

// Pages that still belong to the SPA for browser navigation, but must NOT get
// explicit GET shell routes because doing so would shadow real auth proxy GETs.
// /auth/verify-email, /auth/error, and social callback routes are in this bucket:
// browser GETs with Accept: text/html should fall through to the catch-all shell
// when that is the intended UX, but the proxy must still be able to handle real
// auth GETs.
const FRONTEND_AUTH_PAGES_SPA_ONLY = new Set([
  '/auth/verify-email',
  '/auth/error',
  '/auth/callback/github',
  '/auth/callback/google',
])

export type CoreWorkspaceAgentServer = FastifyInstance & {
  auth: BetterAuthInstance
  db: Database
  userStore: UserStore
  workspaceStore: WorkspaceStore
  /** Best-effort telemetry sink (DB-backed when BORING_TELEMETRY_ENABLED=true, else noop).
   * Consumed by request hooks and the credit service to emit product events. */
  telemetry: TelemetrySink
}

export type CoreWorkspaceAgentServerPlugin = WorkspaceServerPlugin & {
  provisioning?: RuntimeProvisioningContribution
}

export type CoreWorkspaceDirPluginEntry = Omit<DirPluginEntry, 'hotReload'> & {
  /** Core consumes directory plugins statically; per-plugin hot reload is unsupported. */
  hotReload?: false
}

export type CoreWorkspacePluginEntry = CoreWorkspaceAgentServerPlugin | CoreWorkspaceDirPluginEntry

type CoreWorkspaceBridgeExtraTool = NonNullable<RegisterAgentRoutesOptions['extraTools']>[number]

export interface CoreWorkspaceBridgeExtraToolsContext {
  workspaceId: string
  workspaceRoot: string
  callAsRuntime<TOutput = unknown>(
    request: WorkspaceBridgeCallRequest,
    options?: { sessionId?: string; signal?: AbortSignal },
  ): Promise<WorkspaceBridgeCallResponse<TOutput>>
}

export type CoreWorkspaceBridgePiContext = CoreWorkspaceBridgeExtraToolsContext

export interface CreateCoreWorkspaceAgentServerOptions
  extends Omit<RegisterAgentRoutesOptions, 'extraTools'> {
  appRoot?: string
  config?: CoreConfig
  loadConfigOptions?: LoadConfigOptions
  plugins?: CoreWorkspacePluginEntry[]
  excludeDefaults?: CreateWorkspaceAgentServerOptions['excludeDefaults']
  defaultPluginPackages?: CreateWorkspaceAgentServerOptions['defaultPluginPackages']
  workspaceBridge?: {
    handlers?: Array<{
      definition: WorkspaceBridgeOperationDefinition
      handler: WorkspaceBridgeHandler
    }>
    runtimeTokenSecret?: string
    runtimeRefreshTokenSecret?: string
    runtimeEnv?: WorkspaceBridgeRuntimeEnvOptions
  }
  getWorkspaceBridgeExtraTools?: (ctx: CoreWorkspaceBridgeExtraToolsContext) => CoreWorkspaceBridgeExtraTool[] | Promise<CoreWorkspaceBridgeExtraTool[]>
  getWorkspaceBridgePi?: (ctx: CoreWorkspaceBridgePiContext) => AgentPiOptions | Promise<AgentPiOptions | undefined>
  /**
   * Enable workspace plugin-authoring tooling/prompt for this app.
   * Defaults to false for full-app/core production composition; set true only
   * when a live plugin-editing experience is activated.
   */
  installPluginAuthoring?: CreateWorkspaceAgentServerOptions['installPluginAuthoring']
  /** Core consumes plugins statically for now; app-level hot reload is explicitly unsupported. */
  hotReload?: false
  forceProvisioning?: boolean
  extraTools?: RegisterAgentRoutesOptions['extraTools']
  systemPromptAppend?: string
  serveFrontend?: boolean
  /** Optional best-effort telemetry sink. Defaults to core's DB-backed env helper. */
  telemetry?: TelemetrySink
  /** Verified actor resolver exposed only to boot-time internal plugins. */
  trustedPluginActorResolver?: NonNullable<WorkspaceAgentServerPluginContext['trusted']>['actorResolver']
  requestScopeResolver?: CoreRequestScopeResolver
  frontendRootHandler?: CoreFrontendRootHandler
  /** Optional durable Vercel handle store consumed by the host-owned provider composer. */
  sandboxHandleStore?: SandboxHandleStore
}

export type CoreFrontendRootHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => boolean | Promise<boolean>

type AgentPiOptions = RegisterAgentRoutesOptions['pi']

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function inferSessionRootForWorkspaceRoot(workspaceRoot: string, runtimeMode: string | undefined): string | undefined {
  if (runtimeMode !== 'vercel-sandbox') return undefined
  const resolvedRoot = path.resolve(workspaceRoot)
  if (path.basename(resolvedRoot) !== 'workspaces') return undefined
  return path.join(path.dirname(resolvedRoot), 'pi-sessions')
}

export function resolveCoreLoadConfigOptions(
  options: Pick<
    CreateCoreWorkspaceAgentServerOptions,
    'appRoot' | 'loadConfigOptions'
  > = {},
  nodeEnv = process.env.NODE_ENV,
): LoadConfigOptions {
  return {
    allowMissingSecrets: nodeEnv !== 'production',
    ...(options.appRoot && !options.loadConfigOptions?.tomlPath
      ? { tomlPath: path.resolve(options.appRoot, 'boring.app.toml') }
      : {}),
    ...options.loadConfigOptions,
  }
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function isDirPluginEntry(entry: unknown): entry is DirPluginEntry {
  return typeof entry === 'object' && entry !== null && 'dir' in entry
}

function assertCoreStaticPluginEntries(entries: readonly unknown[] | undefined): void {
  for (const entry of entries ?? []) {
    if (isDirPluginEntry(entry) && entry.hotReload === true) {
      throw new Error(
        'createCoreWorkspaceAgentServer does not support hotReload yet; directory plugin entries must omit hotReload or set hotReload: false. Use createWorkspaceAgentServer for standalone hot reload.',
      )
    }
  }
}

function mergePiOptions(
  base?: AgentPiOptions,
  override?: AgentPiOptions,
): AgentPiOptions {
  if (!base && !override) return undefined
  return {
    ...base,
    ...override,
    additionalSkillPaths: dedupeStrings([
      ...(base?.additionalSkillPaths ?? []),
      ...(override?.additionalSkillPaths ?? []),
    ]),
    packages: compactPiPackages([
      ...(base?.packages ?? []),
      ...(override?.packages ?? []),
    ]),
    extensionPaths: dedupeStrings([
      ...(base?.extensionPaths ?? []),
      ...(override?.extensionPaths ?? []),
    ]),
    extensionFactories: [
      ...(base?.extensionFactories ?? []),
      ...(override?.extensionFactories ?? []),
    ],
  }
}

function createUnavailableCorePluginBridge(): WorkspaceBridge {
  const fail = () => {
    throw new Error(
      'Core static server plugins do not receive a workspace-scoped WorkspaceBridge yet. Use request-scoped UI tools/routes in core, or createWorkspaceAgentServer for standalone plugin bridge support.',
    )
  }

  return {
    getState: fail,
    setState: fail,
    postCommand: fail,
    emitUiEffect: fail,
    subscribeCommands: fail,
    drainCommands: fail,
  }
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

function isFrontendAssetPath(pathname: string): boolean {
  return pathname === '/assets' || pathname.startsWith('/assets/')
}

function injectCspNonceIntoHtml(html: string, nonce: string | undefined): string {
  if (!nonce) return html

  const metaTag = `<meta name="boring-csp-nonce" content="${nonce}" />`
  const withMeta = html.includes('</head>')
    ? html.replace('</head>', `  ${metaTag}\n</head>`)
    : `${metaTag}\n${html}`

  return withMeta
    .replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`)
    .replace(/<style(?![^>]*\bnonce=)/g, `<style nonce="${nonce}"`)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function pathIsFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile()
  } catch {
    return false
  }
}

function agentSessionIdFromRequest(request: FastifyRequest): string | undefined {
  const url = request.url.split('?')[0] ?? request.url
  if (request.method === 'POST' && url === '/api/v1/agent/chat') {
    const body = request.body as { sessionId?: unknown } | null | undefined
    return typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId : undefined
  }
  if (request.method === 'POST' && url.endsWith('/followup') && url.startsWith('/api/v1/agent/chat/')) {
    const params = request.params as { sessionId?: unknown; id?: unknown } | null | undefined
    const sessionId = params?.sessionId ?? params?.id
    return typeof sessionId === 'string' && sessionId.trim() ? sessionId : undefined
  }
  return undefined
}

function toHeaders(
  source: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers()

  for (const [key, value] of Object.entries(source)) {
    if (!value) continue
    headers.set(key, Array.isArray(value) ? value[0] : value)
  }

  return headers
}

function extractSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie()
  }

  const value = headers.get('set-cookie')
  return value ? [value] : []
}

function encodeAuthRequestBody(
  request: {
    method: string
    body?: unknown
    headers?: Record<string, string | string[] | undefined>
  },
): string | Uint8Array | URLSearchParams | undefined {
  const isBodyless = request.method === 'GET' || request.method === 'HEAD'
  if (isBodyless) return undefined

  const bodyValue = request.body
  if (bodyValue == null) return undefined
  if (typeof bodyValue === 'string') return bodyValue
  if (bodyValue instanceof Uint8Array) return bodyValue
  if (bodyValue instanceof URLSearchParams) return bodyValue

  const requestContentType = String(request.headers?.['content-type'] ?? '').toLowerCase()
  if (requestContentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(bodyValue as Record<string, unknown>)) {
      if (value == null) continue
      params.append(key, String(value))
    }
    return params
  }

  return JSON.stringify(bodyValue)
}

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === 'string')
}

function validateWorkspaceIdSegment(value: string): string {
  const workspaceId = value.trim()
  if (!workspaceId) throw httpError('workspace id is required', 400)
  if (
    workspaceId.includes('\0') ||
    workspaceId.includes('/') ||
    workspaceId.includes('\\') ||
    workspaceId.includes('..') ||
    path.isAbsolute(workspaceId)
  ) {
    throw httpError('invalid workspace id', 400)
  }
  return workspaceId
}

function resolveWorkspaceIdFromRequest(request: { headers?: Record<string, unknown>; query?: unknown }): string {
  const headers = request.headers ?? {}
  const headerValue = headers['x-boring-workspace-id']
    ?? Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-boring-workspace-id')?.[1]
  const query = request.query as Record<string, unknown> | undefined
  return validateWorkspaceIdSegment(firstString(headerValue) ?? firstString(query?.workspaceId) ?? '')
}

function agentHostScopeViolation(request: FastifyRequest): never {
  throw new HttpError({
    status: 421,
    code: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
    message: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
    requestId: request.id,
  })
}

function resolveRequestScopedWorkspaceId(
  request: FastifyRequest,
  presentedWorkspaceId?: unknown,
): string {
  const scope = request.requestScope
  if (!scope) return resolveWorkspaceIdFromRequest(request)

  const presented: unknown[] = []
  const rawHeaders = request.raw?.rawHeaders
  if (rawHeaders) {
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === 'x-boring-workspace-id') presented.push(...(rawHeaders[index + 1]?.split(',') ?? [undefined]))
    }
  }
  if (!presented.length) {
    for (const [key, value] of Object.entries(request.headers)) {
      if (key.toLowerCase() !== 'x-boring-workspace-id') continue
      if (Array.isArray(value) && value.length === 0) agentHostScopeViolation(request)
      presented.push(...(Array.isArray(value) ? value : [value]))
    }
  }
  const query = request.query as Record<string, unknown> | undefined
  if (query && Object.prototype.hasOwnProperty.call(query, 'workspaceId')) {
    const value = query.workspaceId
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) agentHostScopeViolation(request)
    presented.push(...values)
  }
  if (presentedWorkspaceId !== undefined) presented.push(presentedWorkspaceId)

  for (const value of presented) {
    if (typeof value !== 'string') agentHostScopeViolation(request)
    let normalized: string
    try {
      normalized = validateWorkspaceIdSegment(value)
    } catch {
      agentHostScopeViolation(request)
    }
    if (normalized !== scope.workspaceId) agentHostScopeViolation(request)
  }

  request.headers['x-boring-workspace-id'] = scope.workspaceId
  return scope.workspaceId
}

async function resolveAuthorizedWorkspaceId(
  request: FastifyRequest,
  workspaceStore: WorkspaceStore,
  presentedWorkspaceId?: unknown,
): Promise<string> {
  const normalizedWorkspaceId = resolveRequestScopedWorkspaceId(request, presentedWorkspaceId)
  const user = request.user
  if (!user?.id) throw httpError('authentication required', 401)

  let member = false
  try {
    member = await workspaceStore.isMember(normalizedWorkspaceId, user.id)
  } catch (error) {
    request.log?.error({ err: error, workspaceId: normalizedWorkspaceId }, 'workspace access check failed')
    throw httpError('workspace access check failed', 500)
  }
  if (!member) throw httpError('workspace access denied', 403)
  return normalizedWorkspaceId
}

async function resolveWorkspaceRoot(baseRoot: string, workspaceId: string): Promise<string> {
  const base = path.resolve(baseRoot)
  const scopedRoot = path.resolve(base, workspaceId)
  if (scopedRoot === base || !scopedRoot.startsWith(`${base}${path.sep}`)) {
    throw httpError('invalid workspace id', 400)
  }
  await mkdir(scopedRoot, { recursive: true })
  return scopedRoot
}

function shouldServeFrontend(pathname: string): boolean {
  if (pathname === '/health') return false
  if (pathname.startsWith('/api/')) return false
  if (FRONTEND_AUTH_PAGES.has(pathname)) return true
  if (FRONTEND_AUTH_PAGES_SPA_ONLY.has(pathname)) return true
  if (pathname === '/auth') return false
  if (pathname.startsWith('/auth/')) return false
  return true
}

async function serveFrontendShell(
  request: { id: string; cspNonce?: string },
  reply: {
    status: (code: number) => unknown
    type: (value: string) => unknown
    header: (name: string, value: string) => unknown
    send: (body: unknown) => unknown
  },
  indexPath: string,
  telemetry: TelemetrySink,
) {
  if (!(await pathExists(indexPath))) {
    reply.status(503)
    return {
      error: 'frontend_not_built',
      message: 'Build the frontend before starting in production mode.',
    }
  }

  const html = await readFile(indexPath, 'utf-8')
  captureAppOpened(telemetry, request.id)
  reply.header('cache-control', 'no-store')
  reply.type('text/html; charset=utf-8')
  return reply.send(injectCspNonceIntoHtml(html, request.cspNonce))
}

async function registerAuthProxy(
  app: CoreWorkspaceAgentServer,
  options?: { serveSpaShell?: (request: any, reply: any) => Promise<unknown> },
) {
  app.all('/auth/*', async (request, reply) => {
    const accept = String(request.headers?.accept ?? '')
    const pathname = request.url.split('?')[0] ?? '/'
    const isSpaOnlyAuthPage = FRONTEND_AUTH_PAGES_SPA_ONLY.has(pathname)
    const isExplicitShellAuthPage = FRONTEND_AUTH_PAGES.has(pathname)

    if (
      request.method === 'GET'
      && accept.includes('text/html')
      && (isExplicitShellAuthPage || (isSpaOnlyAuthPage && pathname !== '/auth/callback/github' && pathname !== '/auth/callback/google'))
    ) {
      if (options?.serveSpaShell) {
        return options.serveSpaShell(request, reply)
      }
      return reply.callNotFound()
    }

    const body = encodeAuthRequestBody(request)
    const targetUrl = new URL(request.url, app.config.auth.url).toString()

    const authHeaders = toHeaders(request.headers)
    authHeaders.delete(REQUEST_SCOPE_WORKSPACE_HEADER)
    if (request.requestScope) {
      authHeaders.set(REQUEST_SCOPE_WORKSPACE_HEADER, encodeURIComponent(request.requestScope.workspaceId))
    }

    const response = await app.auth.handler(
      new Request(targetUrl, {
        method: request.method,
        headers: authHeaders,
        body: body as BodyInit | undefined,
      }),
    )

    for (const [key, value] of response.headers.entries()) {
      const lowered = key.toLowerCase()
      if (lowered === 'set-cookie') continue
      if (AUTH_PROXY_BLOCKED_RESPONSE_HEADERS.has(lowered)) continue
      reply.header(key, value)
    }

    const setCookies = extractSetCookies(response.headers)
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies.length === 1 ? setCookies[0] : setCookies)
    }

    reply.status(response.status)
    const responseBody = Buffer.from(await response.arrayBuffer())
    return reply.send(responseBody)
  })
}

function captureAppOpened(telemetry: TelemetrySink, requestId: string): void {
  safeCapture(telemetry, {
    name: 'app.opened',
    properties: { requestId },
  })
}

function registerTelemetryHooks(app: CoreWorkspaceAgentServer, telemetry: TelemetrySink): void {
  app.addHook('onResponse', async (request, reply) => {
    const status = reply.statusCode
    // Rate-limited requests (429) are a distinct abuse/capacity signal. Same namespace as
    // server.request.failed; only stable, non-path metadata (URL/route excluded — see the
    // privacy test).
    if (status === 429) {
      safeCapture(telemetry, {
        name: 'server.request.rate_limited',
        properties: { requestId: request.id },
      })
      return
    }
    if (status < 500) return
    safeCapture(telemetry, {
      name: 'server.request.failed',
      properties: {
        requestId: request.id,
        status,
        errorCode: ERROR_CODES.INTERNAL_ERROR,
      },
    })
  })
}

async function registerFrontendAuthPages(
  app: CoreWorkspaceAgentServer,
  appRoot: string,
  telemetry: TelemetrySink,
) {
  const frontDistDir = path.resolve(appRoot, 'dist/front')
  const indexPath = path.resolve(frontDistDir, 'index.html')

  for (const pagePath of FRONTEND_AUTH_PAGES) {
    app.get(pagePath, async (request, reply) => serveFrontendShell(request, reply, indexPath, telemetry))
  }
}

export async function registerFrontendFallback(
  app: FastifyInstance,
  appRoot: string,
  telemetry: TelemetrySink,
  rootHandler?: CoreFrontendRootHandler,
) {
  const frontDistDir = path.resolve(appRoot, 'dist/front')
  const indexPath = path.resolve(frontDistDir, 'index.html')

  if (rootHandler) {
    app.get('/', async (request, reply) => {
      if (await rootHandler(request, reply)) return reply
      return serveFrontendShell(request, reply, indexPath, telemetry)
    })
  } else {
    app.get('/', async (request, reply) => serveFrontendShell(request, reply, indexPath, telemetry))
  }

  app.get('/*', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? '/'
    if (!shouldServeFrontend(pathname)) return reply.callNotFound()

    const candidate = path.resolve(frontDistDir, `.${pathname}`)
    const withinDist =
      candidate === frontDistDir ||
      candidate.startsWith(`${frontDistDir}${path.sep}`)
    if (!withinDist) {
      reply.status(400)
      return { error: 'invalid_path' }
    }

    if (await pathIsFile(candidate)) {
      if (isFrontendAssetPath(pathname)) {
        reply.header('cache-control', 'public, max-age=31536000, immutable')
      }
      reply.type(contentType(candidate))
      return reply.send(createReadStream(candidate))
    }

    if (isFrontendAssetPath(pathname)) {
      reply.status(404)
      reply.header('cache-control', 'no-store')
      return { error: 'asset_not_found' }
    }

    return serveFrontendShell(request, reply, indexPath, telemetry)
  })
}

async function createCoreRuntime(config: CoreConfig, customTelemetry?: TelemetrySink, requestScopeResolver?: CoreRequestScopeResolver): Promise<{
  app: CoreWorkspaceAgentServer
  sql: postgres.Sql
  db: Database
  userStore: UserStore
  workspaceStore: WorkspaceStore
  telemetry: TelemetrySink
}> {
  if (config.stores !== 'postgres') {
    throw new Error('createCoreWorkspaceAgentServer currently supports only CORE_STORES=postgres')
  }

  const { db, sql } = createDatabase(config)
  const storeDb = db as unknown as ConstructorParameters<typeof PostgresUserStore>[0]
  const userStore = new PostgresUserStore(storeDb)
  const workspaceStore = new PostgresWorkspaceStore(
    storeDb,
    config.encryption.workspaceSettingsKey,
  )

  const app = await createCoreApp(config, { requestScopeResolver }) as CoreWorkspaceAgentServer
  // Resolve the telemetry sink here (db exists now) so the auth hooks get a plain sink.
  const telemetry = customTelemetry ?? createDatabaseTelemetryFromEnv(db, { appId: config.appId }, process.env)
  const telemetrySource = customTelemetry
    ? 'custom'
    : process.env.BORING_TELEMETRY_ENABLED === 'true'
      ? 'db-env'
      : 'noop-env'
  app.log.debug({ telemetry: { source: telemetrySource } }, 'resolved telemetry sink')
  const auth = createAuth(config, db, {
    workspaceStore,
    logger: app.log,
    telemetry,
    disableDefaultWorkspaceCreation: requestScopeResolver !== undefined,
  })

  app.decorate('db', db)
  app.decorate('auth', auth)
  app.decorate('userStore', userStore)
  app.decorate('workspaceStore', workspaceStore)
  app.decorate('telemetry', telemetry)

  app.addHook('onClose', async () => {
    await sql.end()
  })

  return { app, sql, db, userStore, workspaceStore, telemetry }
}

async function registerCoreRoutes({
  app,
  sql,
  db,
  userStore,
  workspaceStore,
}: {
  app: CoreWorkspaceAgentServer
  sql: postgres.Sql
  db: Database
  userStore: UserStore
  workspaceStore: WorkspaceStore
}) {
  await app.register(authHook)
  await app.register(registerRoutes, {
    sql,
    db,
    userStore,
    workspaceStore,
  })
  await app.register(registerWorkspaceRoutes)
  await app.register(registerMemberRoutes)
  await app.register(registerSettingsRoutes)
  await app.register(registerInviteRoutes)
}

export async function createCoreWorkspaceAgentServer(
  options: CreateCoreWorkspaceAgentServerOptions = {},
): Promise<CoreWorkspaceAgentServer> {
  const requestedHotReload = (options as { hotReload?: unknown }).hotReload
  if (requestedHotReload !== undefined && requestedHotReload !== false) {
    throw new Error(
      'createCoreWorkspaceAgentServer does not support hotReload yet; use static plugin consumption or createWorkspaceAgentServer for standalone hot reload.',
    )
  }
  assertCoreStaticPluginEntries(options.plugins)

  const config = options.config ?? (await loadConfig(resolveCoreLoadConfigOptions(options)))
  const { app, sql, db, userStore, workspaceStore, telemetry } = await createCoreRuntime(config, options.telemetry, options.requestScopeResolver)
  const appRoot = options.appRoot
  const serveFrontend =
    options.serveFrontend ?? (process.env.NODE_ENV !== 'development' && Boolean(appRoot))
  const pluginWorkspaceRoot = process.cwd()
  const workspaceRoot = options.workspaceRoot ?? process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()
  const agentRuntimeMode = options.runtimeModeAdapter?.id ?? options.mode ?? process.env.BORING_AGENT_MODE
  const sessionRoot = normalizeOptionalPath(options.sessionRoot)
    ?? normalizeOptionalPath(process.env.BORING_AGENT_SESSION_ROOT)
    ?? inferSessionRootForWorkspaceRoot(workspaceRoot, agentRuntimeMode)
  registerTelemetryHooks(app, telemetry)

  await registerCoreRoutes({ app, sql, db, userStore, workspaceStore })

  if (serveFrontend && appRoot) {
    await registerFrontendAuthPages(app, appRoot, telemetry)
  }

  await registerAuthProxy(app, serveFrontend && appRoot
    ? {
        serveSpaShell: (request, reply) =>
          serveFrontendShell(request, reply, path.resolve(appRoot, 'dist/front/index.html'), telemetry),
      }
    : undefined)

  const defaultPluginPackagePaths = resolveDefaultWorkspacePluginPackagePaths({
    workspaceRoot: pluginWorkspaceRoot,
    defaultPluginPackages: options.defaultPluginPackages,
  })
  const defaultPackagePiSnapshot = readWorkspacePluginPackagePiSnapshot(defaultPluginPackagePaths)
  const defaultPackageRuntimePlugins = readWorkspacePluginPackageRuntimePlugins(defaultPluginPackagePaths)
  const { systemPromptAppend: defaultPackageSystemPromptAppend, ...defaultPackagePiOptions } = defaultPackagePiSnapshot
  const staticSystemPromptAppend = [options.systemPromptAppend, defaultPackageSystemPromptAppend]
    .filter(Boolean)
    .join('\n\n') || undefined
  const defaultPluginDirEntries: CoreWorkspacePluginEntry[] = defaultPluginPackagePaths
    .map((dir) => ({ dir, hotReload: false as const, trust: 'internal' as const }))
    .filter((entry) => hasDirServerPlugin(entry))
  const pluginEntries: CoreWorkspacePluginEntry[] = [
    ...defaultPluginDirEntries,
    ...(options.plugins ?? []),
  ]
  let workspaceAgentDispatcherResolver: WorkspaceAgentDispatcherResolver | undefined
  const trustedDispatcherProxy: WorkspaceAgentDispatcherResolver = {
    async resolve(actor, resolveOptions) {
      if (!workspaceAgentDispatcherResolver) throw new Error('workspace agent dispatcher is not ready')
      return await workspaceAgentDispatcherResolver.resolve(actor, resolveOptions)
    },
    async resolveWithWorkspace(actor, resolveOptions) {
      if (!workspaceAgentDispatcherResolver?.resolveWithWorkspace) {
        throw new Error('workspace agent dispatcher binding is not ready')
      }
      return await workspaceAgentDispatcherResolver.resolveWithWorkspace(actor, resolveOptions)
    },
    async authorizeSession(actor, sessionId, resolveOptions) {
      if (!workspaceAgentDispatcherResolver?.authorizeSession) {
        throw new Error('workspace agent session authorizer is not ready')
      }
      await workspaceAgentDispatcherResolver.authorizeSession(actor, sessionId, resolveOptions)
    },
    async readSessionRunDetails(actor, sessionId, detailKinds, resolveOptions) {
      if (!workspaceAgentDispatcherResolver?.readSessionRunDetails) {
        throw new Error('workspace agent structured session reader is not ready')
      }
      return await workspaceAgentDispatcherResolver.readSessionRunDetails(actor, sessionId, detailKinds, resolveOptions)
    },
  }
  const basePluginResolveContext: WorkspaceAgentServerPluginContext = {
    workspaceRoot: pluginWorkspaceRoot,
    bridge: createUnavailableCorePluginBridge(),
  }
  const defaultPluginActorResolver = async (request: FastifyRequest) => {
    const workspaceId = await resolveAuthorizedWorkspaceId(request, workspaceStore)
    const userId = request.user?.id
    if (!userId) throw httpError('authentication required', 401)
    return { workspaceId, userId }
  }
  const trustedPluginActorResolver = async (request: FastifyRequest) => {
    if (!options.trustedPluginActorResolver) return await defaultPluginActorResolver(request)
    if (!request.requestScope) return await options.trustedPluginActorResolver(request)
    const workspaceId = await resolveAuthorizedWorkspaceId(request, workspaceStore)
    const actor = await options.trustedPluginActorResolver(request)
    if (actor.workspaceId !== workspaceId) agentHostScopeViolation(request)
    return actor
  }
  const trustedPluginResolveContext: WorkspaceAgentServerPluginContext = {
    ...basePluginResolveContext,
    trusted: {
      workspaceAgentDispatcherResolver: trustedDispatcherProxy,
      actorResolver: trustedPluginActorResolver,
      sql,
      actorVerifier: async (actor) => Boolean(
        await workspaceStore.get(actor.workspaceId)
        && await workspaceStore.isMember(actor.workspaceId, actor.userId)
        && await userStore.getById(actor.userId),
      ),
      hostedAutomationTriggerToken: process.env.BORING_AUTOMATION_TRIGGER_TOKEN,
    },
  }
  const resolvedPlugins = await Promise.all(
    pluginEntries.map(async (entry) => {
      const plugin = await resolveOnePluginEntry<CoreWorkspaceAgentServerPlugin>(
        entry,
        'dir' in entry && entry.trust === 'internal' ? trustedPluginResolveContext : basePluginResolveContext,
      )
      assertWorkspaceBridgeHandlersTrusted(plugin, entry)
      return plugin
    }),
  )

  const externalPluginsEnabled = options.externalPlugins !== false
  const installPluginAuthoring = externalPluginsEnabled && options.installPluginAuthoring === true
  const pluginCollection = collectWorkspaceAgentServerPlugins({
    workspaceRoot: pluginWorkspaceRoot,
    systemPromptAppend: staticSystemPromptAppend,
    pi: mergePiOptions(options.pi, defaultPackagePiOptions),
    plugins: resolvedPlugins,
    excludeDefaults: options.excludeDefaults,
    installPluginAuthoring,
  })

  const resolveWorkspaceId = async (request: FastifyRequest, presentedWorkspaceId?: unknown) =>
    request.requestScope
      ? await resolveAuthorizedWorkspaceId(request, workspaceStore, presentedWorkspaceId)
      : options.getWorkspaceId
      ? await options.getWorkspaceId(request)
      : await resolveAuthorizedWorkspaceId(request, workspaceStore, presentedWorkspaceId)
  const resolveRoot = async (
    workspaceId: string,
    request: Parameters<NonNullable<RegisterAgentRoutesOptions['getWorkspaceRoot']>>[1],
  ) => {
    const root = options.getWorkspaceRoot
      ? await options.getWorkspaceRoot(workspaceId, request)
      : await resolveWorkspaceRoot(workspaceRoot, workspaceId)
    return root
  }
  const coreBridge = createCoreWorkspaceBridge({
    workspaceBridge: {
      ...options.workspaceBridge,
      handlers: [
        ...(options.workspaceBridge?.handlers ?? []),
        ...(pluginCollection.workspaceBridgeHandlers ?? []),
      ],
    },
    resolveWorkspaceId,
    workspaceStore,
    corsOrigins: app.config.cors.origins,
    validateWorkspaceId: validateWorkspaceIdSegment,
    agentSessionId: agentSessionIdFromRequest,
    assertRuntimeWorkspaceScope: options.requestScopeResolver
      ? (request, workspaceId) => {
          if (request.requestScope?.workspaceId !== workspaceId) agentHostScopeViolation(request)
        }
      : undefined,
    admitRuntimeOperation: options.admitEffect
      ? async (workspaceId) => {
          try {
            await options.admitEffect!({ workspaceId, requestId: 'workspace-bridge-runtime' })
          } catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error
              && error.code === ERROR_CODES.AGENT_HOST_ADMISSION_IDENTITY_MISMATCH
              ? ERROR_CODES.AGENT_HOST_ADMISSION_IDENTITY_MISMATCH
              : ERROR_CODES.AGENT_HOST_ADMISSION_RECORD_FAILED
            throw new HttpError({
              status: 500,
              code,
              message: code,
            })
          }
        }
      : undefined,
  })
  app.addHook('preHandler', async (request) => {
    await coreBridge.rememberSessionOwner(request)
  })

  const workerBaseUrl = process.env.BORING_WORKER_BASE_URL?.trim()
  const sandboxHandleStore = options.sandboxHandleStore ?? new WorkspaceRuntimeSandboxHandleStore(workspaceStore)
  const remoteWorkerModeAdapter = workerBaseUrl
    ? createRemoteWorkerModeAdapter({ baseUrl: workerBaseUrl })
    : undefined
  const runtimeModeAdapter = options.runtimeModeAdapter
    ?? remoteWorkerModeAdapter
    ?? createSandboxRuntimeModeAdapter(
      (options.mode ?? process.env.BORING_AGENT_MODE ?? autoDetectMode()) as 'direct' | 'local' | 'vercel-sandbox',
      { sandboxHandleStore },
    )
  const runtimeHost = options.runtimeHost ?? runtimeModeAdapter.runtimeHost ?? sandboxRuntimeHostOperations
  const piOptionsByRoot = new Map<string, AgentPiOptions>()
  const getPluginPiOptions = (root: string): AgentPiOptions => {
    const resolvedRoot = path.resolve(root)
    if (piOptionsByRoot.has(resolvedRoot)) {
      return piOptionsByRoot.get(resolvedRoot)
    }
    const scopedPluginCollection = collectWorkspaceAgentServerPlugins({
      workspaceRoot: resolvedRoot,
      systemPromptAppend: staticSystemPromptAppend,
      pi: mergePiOptions(options.pi, defaultPackagePiOptions),
      plugins: resolvedPlugins,
      excludeDefaults: options.excludeDefaults,
      installPluginAuthoring,
    })
    piOptionsByRoot.set(
      resolvedRoot,
      scopedPluginCollection.agentOptions.pi,
    )
    return scopedPluginCollection.agentOptions.pi
  }
  const resolvePiOptions: NonNullable<RegisterAgentRoutesOptions['getPi']> = async (ctx) => {
    // In remote-worker mode the workspace filesystem lives on the worker. Do
    // not scan per-workspace Pi skills/plugins from the public host path — it
    // can be stale after volume cutover and would reintroduce split-brain. Keep
    // only static app/plugin Pi config plus explicit caller overrides.
    const pluginOptions = remoteWorkerModeAdapter
      ? pluginCollection.agentOptions.pi
      : getPluginPiOptions(ctx.workspaceRoot)
    const bridgePiOptions = options.getWorkspaceBridgePi
      ? await options.getWorkspaceBridgePi({
          workspaceId: ctx.workspaceId,
          workspaceRoot: ctx.workspaceRoot,
          callAsRuntime: async (request, callOptions) => await coreBridge.callAsRuntime(ctx.workspaceId, request, callOptions),
        })
      : undefined
    const callerOptions = options.getPi
      ? await options.getPi(ctx)
      : undefined
    return mergePiOptions(mergePiOptions(pluginOptions, bridgePiOptions), callerOptions)
  }

  app.get('/api/v1/workspace/meta', async (request, reply) => {
    try {
      const workspaceId = await resolveWorkspaceId(request)
      const [workspace, workspaceRootForRequest] = await Promise.all([
        workspaceStore.get(workspaceId),
        resolveRoot(workspaceId, request),
      ])
      return {
        workspaceId,
        workspaceRoot: workspaceRootForRequest,
        projectName: workspace?.name ?? 'Workspace',
      }
    } catch (error) {
      if (
        (error as { status?: unknown })?.status === 421
        && (error as { code?: unknown })?.code === ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION
      ) {
        throw error
      }
      const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500
      const message = error instanceof Error ? error.message : 'workspace meta failed'
      return reply.code(statusCode).send({ error: message })
    }
  })

  const resolveSessionNamespace: NonNullable<RegisterAgentRoutesOptions['getSessionNamespace']> = async (ctx) => (
    options.getSessionNamespace
      ? await options.getSessionNamespace(ctx)
      : options.sessionNamespace ?? ctx.workspaceId
  )

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    sessionId: options.sessionId,
    templatePath: options.templatePath,
    getTemplatePath: options.getTemplatePath,
    mode: options.mode,
    externalPlugins: externalPluginsEnabled,
    runtimeModeAdapter,
    runtimeHost,
    version: options.version,
    admitEffect: options.admitEffect,
    extraTools: [
      ...(options.extraTools ?? []),
      ...(pluginCollection.agentOptions.extraTools ?? []),
    ],
    systemPromptAppend: pluginCollection.agentOptions.systemPromptAppend,
    pi: pluginCollection.agentOptions.pi,
    getPi: resolvePiOptions,
    getRuntimeScopeContribution: options.getRuntimeScopeContribution,
    sessionRoot,
    getSessionNamespace: resolveSessionNamespace,
    getExtraTools: async (ctx) => {
      const callerTools = options.getExtraTools ? await options.getExtraTools(ctx) : []
      const bridgeTools = options.getWorkspaceBridgeExtraTools
        ? await options.getWorkspaceBridgeExtraTools({
            workspaceId: ctx.workspaceId,
            workspaceRoot: ctx.workspaceRoot,
            callAsRuntime: async (request, callOptions) => await coreBridge.callAsRuntime(ctx.workspaceId, request, callOptions),
          })
        : []
      return [
        ...callerTools,
        ...bridgeTools,
        ...createWorkspaceUiTools(coreBridge.getBridge(ctx.workspaceId), {
          workspaceRoot: ctx.workspaceFsCapability === 'strong' ? ctx.workspaceRoot : undefined,
        }),
      ]
    },
    getWorkspaceId: resolveWorkspaceId,
    getWorkspaceRoot: resolveRoot,
    getTrustedWorkspaceRoot: options.getTrustedWorkspaceRoot
      ?? (options.getWorkspaceRoot
        ? undefined
        : async ({ workspaceId }) => await resolveWorkspaceRoot(workspaceRoot, workspaceId)),
    onWorkspaceAgentDispatcher: (resolver) => {
      workspaceAgentDispatcherResolver = resolver
      options.onWorkspaceAgentDispatcher?.(resolver)
    },
    provisionRuntime: async ({ provisioningAdapter, runtimeLayout, workspaceId, request, runtimeMode }) => {
      if (!provisioningAdapter) return undefined
      const runtimePlugins = [
        ...pluginCollection.runtimePlugins,
        ...defaultPackageRuntimePlugins,
      ]
      return await provisionWorkspaceRuntime({
        plugins: runtimeMode === 'direct'
          ? omitPluginAuthoringProvisioning(runtimePlugins)
          : runtimePlugins,
        adapter: provisioningAdapter,
        runtimeLayout,
        runtimeHost,
        telemetry,
        telemetryContext: {
          workspaceId,
          requestId: request?.id,
          runtimeMode,
        },
      })
    },
    provisionWorkspace: options.provisionWorkspace,
    registerHealthRoute: options.registerHealthRoute ?? false,
    telemetry,
    metering: options.metering,
    filterModels: options.filterModels,
    getFilesystemBindings: options.getFilesystemBindings,
    runtimeEnvContributions: [
      ...(options.runtimeEnvContributions ?? []),
      ...(coreBridge.runtimeEnvContribution ? [coreBridge.runtimeEnvContribution] : []),
    ],
  })

  await app.register(uiRoutes, {
    getWorkspaceId: resolveWorkspaceId,
    getBridge: async (request) => coreBridge.getBridge(await resolveWorkspaceId(request)),
    preserveStateKeys: pluginCollection.preservedUiStateKeys,
  })

  await coreBridge.registerHttpRoutes(app)

  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }

  if (serveFrontend && appRoot) {
    await registerFrontendFallback(app, appRoot, telemetry, options.frontendRootHandler)
  }

  return app
}
