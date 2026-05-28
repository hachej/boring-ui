import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'

import {
  compactPiPackages,
  provisionWorkspaceRuntime,
  registerAgentRoutes,
  type RegisterAgentRoutesOptions,
  type RuntimeEnvContributionContext,
  type RuntimeProvisioningContribution,
} from '@hachej/boring-agent/server'
import {
  collectWorkspaceAgentServerPlugins,
  hasDirServerPlugin,
  readWorkspacePluginPackagePiSnapshot,
  readWorkspacePluginPackageRuntimePlugins,
  resolveDefaultWorkspacePluginPackagePaths,
  resolveOnePluginEntry,
  type CreateWorkspaceAgentServerOptions,
  type DirPluginEntry,
  type WorkspaceAgentServerPluginContext,
} from '@hachej/boring-workspace/app/server'
import {
  InMemoryPendingQuestionStore,
  InMemoryWorkspaceBridgeIdempotencyStore,
  PendingQuestionRuntime,
  createBrowserBridgeAuthPolicy,
  createHumanInputBridgeHandlers,
  createInMemoryBridge,
  createWorkspaceBridgeRegistry,
  createWorkspaceBridgeRuntimeEnvContribution,
  createWorkspaceUiTools,
  runWithWorkspaceBridgeIdempotency,
  uiRoutes,
  verifyWorkspaceBridgeRuntimeToken,
  workspaceBridgeHttpRoutes,
  type PendingQuestionStore,
  type UiCommand,
  type WorkspaceBridge,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeHandler,
  type WorkspaceBridgeIdempotencyStore,
  type WorkspaceBridgeOperationDefinition,
  type WorkspaceBridgeRegistry,
  type WorkspaceBridgeRuntimeEnvOptions,
  type WorkspaceServerPlugin,
} from '@hachej/boring-workspace/server'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type postgres from 'postgres'
import type { CoreConfig } from '../../shared/types.js'
import { ERROR_CODES } from '../../shared/errors.js'
import { safeCapture, type TelemetrySink } from '../../shared/telemetry.js'
import {
  authHook,
  createAuth,
  type BetterAuthInstance,
} from '../../server/auth/index.js'
import {
  createCoreApp,
  registerRoutes,
  type UserStore,
  type WorkspaceStore,
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
const MAX_SESSION_OWNER_CACHE = 5_000

export type CoreWorkspaceAgentServer = FastifyInstance & {
  auth: BetterAuthInstance
  db: Database
  userStore: UserStore
  workspaceStore: WorkspaceStore
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
  appPackageJsonPath?: CreateWorkspaceAgentServerOptions['appPackageJsonPath']
  workspaceBridge?: {
    handlers?: Array<{
      definition: WorkspaceBridgeOperationDefinition
      handler: WorkspaceBridgeHandler
    }>
    runtimeTokenSecret?: string
    runtimeEnv?: WorkspaceBridgeRuntimeEnvOptions
  }
  getWorkspaceBridgeExtraTools?: (ctx: CoreWorkspaceBridgeExtraToolsContext) => CoreWorkspaceBridgeExtraTool[] | Promise<CoreWorkspaceBridgeExtraTool[]>
  getWorkspaceBridgePi?: (ctx: CoreWorkspaceBridgePiContext) => AgentPiOptions | Promise<AgentPiOptions | undefined>
  /** Core consumes plugins statically for now; app-level hot reload is explicitly unsupported. */
  hotReload?: false
  forceProvisioning?: boolean
  extraTools?: RegisterAgentRoutesOptions['extraTools']
  systemPromptAppend?: string
  serveFrontend?: boolean
  /** Optional best-effort telemetry sink. Defaults to core's DB-backed env helper. */
  telemetry?: TelemetrySink
}

type AgentPiOptions = RegisterAgentRoutesOptions['pi']

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
    emitUiEffect: fail,
    subscribeCommands: fail,
    drainCommands: fail,
  }
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
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

async function resolveAuthorizedWorkspaceId(
  request: { headers?: Record<string, unknown>; query?: unknown; user?: { id?: string } | null; log?: { error: (obj: Record<string, unknown>, msg: string) => void } },
  workspaceStore: WorkspaceStore,
): Promise<string> {
  const normalizedWorkspaceId = resolveWorkspaceIdFromRequest(request)
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
  reply: { status: (code: number) => unknown; type: (value: string) => unknown; send: (body: unknown) => unknown },
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

    const response = await app.auth.handler(
      new Request(targetUrl, {
        method: request.method,
        headers: toHeaders(request.headers),
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
    if (reply.statusCode < 500) return
    safeCapture(telemetry, {
      name: 'server.request.failed',
      properties: {
        requestId: request.id,
        status: reply.statusCode,
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

async function registerFrontendFallback(
  app: CoreWorkspaceAgentServer,
  appRoot: string,
  telemetry: TelemetrySink,
) {
  const frontDistDir = path.resolve(appRoot, 'dist/front')
  const indexPath = path.resolve(frontDistDir, 'index.html')

  app.get('/', async (request, reply) => serveFrontendShell(request, reply, indexPath, telemetry))

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
      reply.type(contentType(candidate))
      return reply.send(createReadStream(candidate))
    }

    return serveFrontendShell(request, reply, indexPath, telemetry)
  })
}

async function createCoreRuntime(config: CoreConfig): Promise<{
  app: CoreWorkspaceAgentServer
  sql: postgres.Sql
  db: Database
  userStore: UserStore
  workspaceStore: WorkspaceStore
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

  const app = await createCoreApp(config) as CoreWorkspaceAgentServer
  const auth = createAuth(config, db, {
    workspaceStore,
    logger: app.log,
  })

  app.decorate('db', db)
  app.decorate('auth', auth)
  app.decorate('userStore', userStore)
  app.decorate('workspaceStore', workspaceStore)

  app.addHook('onClose', async () => {
    await sql.end()
  })

  return { app, sql, db, userStore, workspaceStore }
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

  const config = options.config ?? (await loadConfig({
    allowMissingSecrets: process.env.NODE_ENV !== 'production',
    ...options.loadConfigOptions,
  }))
  const { app, sql, db, userStore, workspaceStore } = await createCoreRuntime(config)
  const appRoot = options.appRoot
  const serveFrontend =
    options.serveFrontend ?? (process.env.NODE_ENV !== 'development' && Boolean(appRoot))
  const workspaceRoot = options.workspaceRoot ?? process.cwd()
  const telemetrySource = options.telemetry
    ? 'custom'
    : process.env.BORING_TELEMETRY_ENABLED === 'true'
      ? 'db-env'
      : 'noop-env'
  const telemetry = options.telemetry ?? createDatabaseTelemetryFromEnv(db, { appId: config.appId }, process.env)
  app.log.debug({ telemetry: { source: telemetrySource } }, 'resolved telemetry sink')

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
    workspaceRoot,
    appPackageJsonPath: options.appPackageJsonPath ?? (appRoot ? path.join(appRoot, 'package.json') : undefined),
    defaultPluginPackages: options.defaultPluginPackages,
  })
  const defaultPackagePiSnapshot = readWorkspacePluginPackagePiSnapshot(defaultPluginPackagePaths)
  const defaultPackageRuntimePlugins = readWorkspacePluginPackageRuntimePlugins(defaultPluginPackagePaths)
  const { systemPromptAppend: defaultPackageSystemPromptAppend, ...defaultPackagePiOptions } = defaultPackagePiSnapshot
  const staticSystemPromptAppend = [options.systemPromptAppend, defaultPackageSystemPromptAppend]
    .filter(Boolean)
    .join('\n\n') || undefined
  const defaultPluginDirEntries: CoreWorkspacePluginEntry[] = defaultPluginPackagePaths
    .map((dir) => ({ dir, hotReload: false as const }))
    .filter((entry) => hasDirServerPlugin(entry))
  const pluginEntries: CoreWorkspacePluginEntry[] = [
    ...defaultPluginDirEntries,
    ...(options.plugins ?? []),
  ]
  const bridges = new Map<string, WorkspaceBridge>()
  const getWorkspaceBridge = (workspaceId: string): WorkspaceBridge => {
    const safeWorkspaceId = validateWorkspaceIdSegment(workspaceId)
    let bridge = bridges.get(safeWorkspaceId)
    if (!bridge) {
      bridge = createInMemoryBridge()
      bridges.set(safeWorkspaceId, bridge)
    }
    return bridge
  }
  type CoreWorkspaceBridgeRuntime = {
    registry: WorkspaceBridgeRegistry
    pendingQuestionStore: PendingQuestionStore
    pendingQuestionRuntime: PendingQuestionRuntime
    idempotencyStore: WorkspaceBridgeIdempotencyStore
    sessionOwners: Map<string, string>
  }
  const workspaceBridgeRuntimes = new Map<string, CoreWorkspaceBridgeRuntime>()
  const getWorkspaceBridgeRuntime = (workspaceId: string): CoreWorkspaceBridgeRuntime => {
    const safeWorkspaceId = validateWorkspaceIdSegment(workspaceId)
    let runtime = workspaceBridgeRuntimes.get(safeWorkspaceId)
    if (!runtime) {
      const registry = createWorkspaceBridgeRegistry()
      const pendingQuestionStore = new InMemoryPendingQuestionStore()
      const pendingQuestionRuntime = new PendingQuestionRuntime(pendingQuestionStore)
      const sessionOwners = new Map<string, string>()
      void pendingQuestionRuntime.abandonServerRestart()
      for (const entry of createHumanInputBridgeHandlers({
        runtime: pendingQuestionRuntime,
        store: pendingQuestionStore,
        resolveOwnerPrincipalId: (sessionId) => sessionOwners.get(sessionId),
      })) {
        registry.registerHandler(entry.definition, entry.handler)
      }
      for (const entry of options.workspaceBridge?.handlers ?? []) {
        registry.registerHandler(entry.definition, entry.handler)
      }
      runtime = {
        registry,
        pendingQuestionStore,
        pendingQuestionRuntime,
        idempotencyStore: new InMemoryWorkspaceBridgeIdempotencyStore(),
        sessionOwners,
      }
      workspaceBridgeRuntimes.set(safeWorkspaceId, runtime)
    }
    return runtime
  }
  const pluginResolveContext: WorkspaceAgentServerPluginContext = {
    workspaceRoot,
    bridge: createUnavailableCorePluginBridge(),
  }
  const resolvedPlugins = await Promise.all(
    pluginEntries.map((entry) => resolveOnePluginEntry<CoreWorkspaceAgentServerPlugin>(
      entry,
      pluginResolveContext,
    )),
  )

  const pluginCollection = collectWorkspaceAgentServerPlugins({
    workspaceRoot,
    systemPromptAppend: staticSystemPromptAppend,
    pi: mergePiOptions(options.pi, defaultPackagePiOptions),
    plugins: resolvedPlugins,
    excludeDefaults: options.excludeDefaults,
  })

  const resolveWorkspaceId = async (request: Parameters<NonNullable<RegisterAgentRoutesOptions['getWorkspaceId']>>[0]) =>
    options.getWorkspaceId
      ? await options.getWorkspaceId(request)
      : await resolveAuthorizedWorkspaceId(request, workspaceStore)
  const resolveRoot = async (
    workspaceId: string,
    request: Parameters<NonNullable<RegisterAgentRoutesOptions['getWorkspaceRoot']>>[1],
  ) => {
    const root = options.getWorkspaceRoot
      ? await options.getWorkspaceRoot(workspaceId, request)
      : await resolveWorkspaceRoot(workspaceRoot, workspaceId)
    return root
  }
  const resolveBridgeWorkspaceId = async (request: FastifyRequest): Promise<string> => {
    const authHeader = request.headers.authorization
    if (options.workspaceBridge?.runtimeTokenSecret && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return verifyWorkspaceBridgeRuntimeToken(authHeader.slice('Bearer '.length), {
        secret: options.workspaceBridge.runtimeTokenSecret,
      }).authContext.workspaceId
    }
    return await resolveWorkspaceId(request)
  }
  const rememberBridgeSessionOwner = async (request: FastifyRequest): Promise<void> => {
    const user = request.user as { id?: string } | null | undefined
    if (!user?.id) return
    const sessionId = agentSessionIdFromRequest(request)
    if (!sessionId) return
    const workspaceId = await resolveWorkspaceId(request)
    const runtime = getWorkspaceBridgeRuntime(workspaceId)
    const pending = await runtime.pendingQuestionStore.getPending(sessionId)
    const pendingOwnerId = pending?.ownerPrincipalId
    if (pendingOwnerId && pendingOwnerId !== user.id) return
    runtime.sessionOwners.delete(sessionId)
    runtime.sessionOwners.set(sessionId, user.id)
    let scanned = 0
    while (runtime.sessionOwners.size > MAX_SESSION_OWNER_CACHE && scanned < runtime.sessionOwners.size) {
      const oldest = runtime.sessionOwners.keys().next().value
      if (!oldest) break
      const ownerId = runtime.sessionOwners.get(oldest)
      const oldestPending = await runtime.pendingQuestionStore.getPending(oldest)
      runtime.sessionOwners.delete(oldest)
      if (oldestPending) {
        runtime.sessionOwners.set(oldest, ownerId ?? user.id)
        scanned += 1
        continue
      }
    }
  }
  app.addHook('preHandler', async (request) => {
    await rememberBridgeSessionOwner(request)
  })
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
    })
    piOptionsByRoot.set(
      resolvedRoot,
      scopedPluginCollection.agentOptions.pi,
    )
    return scopedPluginCollection.agentOptions.pi
  }
  const callWorkspaceBridgeAsRuntime = async <TOutput = unknown>(
    workspaceId: string,
    request: WorkspaceBridgeCallRequest,
    callOptions?: { sessionId?: string; signal?: AbortSignal },
  ): Promise<WorkspaceBridgeCallResponse<TOutput>> => {
    const bridgeRuntime = getWorkspaceBridgeRuntime(workspaceId)
    const definition = bridgeRuntime.registry.getDefinition(request.op)
    if (!definition) {
      return await bridgeRuntime.registry.call(request, {
        callerClass: 'runtime',
        workspaceId,
        sessionId: callOptions?.sessionId,
        capabilities: [],
        actor: {
          actorKind: 'agent',
          performedBy: { label: 'agent-runtime' },
          onBehalfOf: callOptions?.sessionId
            ? { label: `session:${callOptions.sessionId}` }
            : { label: `workspace:${workspaceId}` },
        },
        signal: callOptions?.signal,
        emitUiEffect: (cmd) => getWorkspaceBridge(workspaceId).emitUiEffect(cmd),
      })
    }
    const ownerPrincipalId = callOptions?.sessionId
      ? bridgeRuntime.sessionOwners.get(callOptions.sessionId)
      : undefined
    const authContext = {
      callerClass: 'runtime' as const,
      workspaceId,
      sessionId: callOptions?.sessionId,
      capabilities: [...definition.requiredCapabilities],
      actor: {
        actorKind: 'agent' as const,
        performedBy: { label: 'agent-runtime' },
        onBehalfOf: ownerPrincipalId
          ? { id: ownerPrincipalId, label: `user:${ownerPrincipalId}` }
          : callOptions?.sessionId
            ? { label: `session:${callOptions.sessionId}` }
            : { label: `workspace:${workspaceId}` },
      },
      signal: callOptions?.signal,
      emitUiEffect: (cmd: UiCommand) => getWorkspaceBridge(workspaceId).emitUiEffect(cmd),
    }
    return await runWithWorkspaceBridgeIdempotency(bridgeRuntime.idempotencyStore, {
      definition,
      request,
      auth: authContext,
    }, async () => await bridgeRuntime.registry.call(request, authContext))
  }
  const resolvePiOptions: NonNullable<RegisterAgentRoutesOptions['getPi']> = async (ctx) => {
    const pluginOptions = getPluginPiOptions(ctx.workspaceRoot)
    const bridgePiOptions = options.getWorkspaceBridgePi
      ? await options.getWorkspaceBridgePi({
          workspaceId: ctx.workspaceId,
          workspaceRoot: ctx.workspaceRoot,
          callAsRuntime: async (request, callOptions) => await callWorkspaceBridgeAsRuntime(ctx.workspaceId, request, callOptions),
        })
      : undefined
    const callerOptions = options.getPi
      ? await options.getPi(ctx)
      : undefined
    return mergePiOptions(mergePiOptions(pluginOptions, bridgePiOptions), callerOptions)
  }
  const workspaceBridgeRuntimeEnvContribution = options.workspaceBridge?.runtimeTokenSecret || options.workspaceBridge?.runtimeEnv
    ? {
        id: 'workspace-bridge-runtime-env',
        getEnv: async (ctx: RuntimeEnvContributionContext) => {
          const contribution = createWorkspaceBridgeRuntimeEnvContribution({
            workspaceId: ctx.workspaceId,
            runtimeMode: ctx.runtimeMode!,
            registry: getWorkspaceBridgeRuntime(ctx.workspaceId).registry,
            runtimeTokenSecret: options.workspaceBridge?.runtimeTokenSecret,
            runtimeEnv: options.workspaceBridge?.runtimeEnv,
          })
          return contribution ? await contribution.getEnv(ctx) : {}
        },
      }
    : undefined
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    sessionId: options.sessionId,
    templatePath: options.templatePath,
    getTemplatePath: options.getTemplatePath,
    mode: options.mode,
    version: options.version,
    extraTools: [
      ...(options.extraTools ?? []),
      ...(pluginCollection.agentOptions.extraTools ?? []),
    ],
    systemPromptAppend: pluginCollection.agentOptions.systemPromptAppend,
    pi: pluginCollection.agentOptions.pi,
    getPi: resolvePiOptions,
    sessionNamespace: options.sessionNamespace,
    getSessionNamespace: options.getSessionNamespace,
    getExtraTools: async (ctx) => {
      const callerTools = options.getExtraTools ? await options.getExtraTools(ctx) : []
      const bridgeTools = options.getWorkspaceBridgeExtraTools
        ? await options.getWorkspaceBridgeExtraTools({
            workspaceId: ctx.workspaceId,
            workspaceRoot: ctx.workspaceRoot,
            callAsRuntime: async (request, callOptions) => await callWorkspaceBridgeAsRuntime(ctx.workspaceId, request, callOptions),
          })
        : []
      return [
        ...callerTools,
        ...bridgeTools,
        ...createWorkspaceUiTools(getWorkspaceBridge(ctx.workspaceId), {
          workspaceRoot: ctx.workspaceFsCapability === 'strong' ? ctx.workspaceRoot : undefined,
        }),
      ]
    },
    sandboxHandleStore: options.sandboxHandleStore ?? new WorkspaceRuntimeSandboxHandleStore(workspaceStore),
    getWorkspaceId: resolveWorkspaceId,
    getWorkspaceRoot: resolveRoot,
    provisionRuntime: async ({ provisioningAdapter, runtimeLayout, workspaceId, request, runtimeMode }) => {
      if (!provisioningAdapter) return undefined
      return await provisionWorkspaceRuntime({
        plugins: [
          ...pluginCollection.runtimePlugins,
          ...defaultPackageRuntimePlugins,
        ],
        adapter: provisioningAdapter,
        runtimeLayout,
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
    runtimeEnvContributions: [
      ...(options.runtimeEnvContributions ?? []),
      ...(workspaceBridgeRuntimeEnvContribution ? [workspaceBridgeRuntimeEnvContribution] : []),
    ],
  })

  await app.register(uiRoutes, {
    getBridge: async (request) => getWorkspaceBridge(await resolveWorkspaceId(request)),
    preserveStateKeys: pluginCollection.preservedUiStateKeys,
  })

  await app.register(workspaceBridgeHttpRoutes, {
    getRegistry: async (request) => getWorkspaceBridgeRuntime(await resolveBridgeWorkspaceId(request)).registry,
    getIdempotencyStore: async (request) => getWorkspaceBridgeRuntime(await resolveBridgeWorkspaceId(request)).idempotencyStore,
    runtimeTokenSecret: options.workspaceBridge?.runtimeTokenSecret,
    browserAuthPolicy: createBrowserBridgeAuthPolicy({
      getPrincipal: (input) => {
        const user = input.request?.user as { id?: string; email?: string | null; name?: string | null } | null | undefined
        return user?.id ? { userId: user.id, email: user.email ?? undefined } : null
      },
      authorizeWorkspace: async ({ principal, workspaceId, definition }) => ({
        allowed: await workspaceStore.isMember(workspaceId, principal.userId),
        capabilities: definition.requiredCapabilities,
      }),
      allowedOrigins: app.config.cors.origins,
      requireCsrfHeader: true,
    }),
  })

  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }

  if (serveFrontend && appRoot) {
    await registerFrontendFallback(app, appRoot, telemetry)
  }

  return app
}
