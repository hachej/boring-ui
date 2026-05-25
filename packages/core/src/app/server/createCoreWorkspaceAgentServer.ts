import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'

import {
  compactPiPackages,
  registerAgentRoutes,
  type RegisterAgentRoutesOptions,
  type RuntimeProvisioningContribution,
} from '@hachej/boring-agent/server'
import {
  collectWorkspaceAgentServerPlugins,
  hasDirServerPlugin,
  provisionWorkspaceAgentServer,
  readWorkspacePluginPackagePiSnapshot,
  resolveDefaultWorkspacePluginPackagePaths,
  resolveOnePluginEntry,
  type CreateWorkspaceAgentServerOptions,
  type DirPluginEntry,
  type WorkspaceAgentServerPluginContext,
} from '@hachej/boring-workspace/app/server'
import {
  createInMemoryBridge,
  createWorkspaceUiTools,
  uiRoutes,
  type UiBridge,
  type WorkspaceServerPlugin,
} from '@hachej/boring-workspace/server'
import type { FastifyInstance } from 'fastify'
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
// /auth/verify-email is intentionally excluded: the auth proxy's text/html guard
// already falls through to the catch-all for browser navigation, and the explicit
// route would shadow the proxy for API calls (breaking headless token redemption).
const FRONTEND_AUTH_PAGES = new Set([
  '/auth/signin',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/callback/github',
])

// Pages served as SPA but NOT needing an explicit GET route (auth proxy handles them).
const FRONTEND_AUTH_PAGES_SPA_ONLY = new Set([
  '/auth/verify-email',
])

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

export interface CreateCoreWorkspaceAgentServerOptions
  extends Omit<RegisterAgentRoutesOptions, 'extraTools'> {
  appRoot?: string
  config?: CoreConfig
  loadConfigOptions?: LoadConfigOptions
  plugins?: CoreWorkspacePluginEntry[]
  excludeDefaults?: CreateWorkspaceAgentServerOptions['excludeDefaults']
  defaultPluginPackages?: CreateWorkspaceAgentServerOptions['defaultPluginPackages']
  appPackageJsonPath?: CreateWorkspaceAgentServerOptions['appPackageJsonPath']
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

function createUnavailableCorePluginBridge(): UiBridge {
  const fail = () => {
    throw new Error(
      'Core static server plugins do not receive a workspace-scoped UiBridge yet. Use request-scoped UI tools/routes in core, or createWorkspaceAgentServer for standalone plugin bridge support.',
    )
  }

  return {
    getState: fail,
    setState: fail,
    postCommand: fail,
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

async function registerAuthProxy(app: CoreWorkspaceAgentServer) {
  app.all('/auth/*', async (request, reply) => {
    const accept = String(request.headers?.accept ?? '')
    if (request.method === 'GET' && accept.includes('text/html')) {
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
    app.get(pagePath, async (request, reply) => {
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
    })
  }
}

async function registerFrontendFallback(
  app: CoreWorkspaceAgentServer,
  appRoot: string,
  telemetry: TelemetrySink,
) {
  const frontDistDir = path.resolve(appRoot, 'dist/front')
  const indexPath = path.resolve(frontDistDir, 'index.html')

  app.get('/', async (request, reply) => {
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
  })

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

  await registerAuthProxy(app)

  const defaultPluginPackagePaths = resolveDefaultWorkspacePluginPackagePaths({
    workspaceRoot,
    appPackageJsonPath: options.appPackageJsonPath,
    defaultPluginPackages: options.defaultPluginPackages,
  })
  const defaultPackagePiSnapshot = readWorkspacePluginPackagePiSnapshot(defaultPluginPackagePaths)
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
  const bridges = new Map<string, UiBridge>()
  const getUiBridge = (workspaceId: string): UiBridge => {
    const safeWorkspaceId = validateWorkspaceIdSegment(workspaceId)
    let bridge = bridges.get(safeWorkspaceId)
    if (!bridge) {
      bridge = createInMemoryBridge()
      bridges.set(safeWorkspaceId, bridge)
    }
    return bridge
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

  const provisionedWorkspaceRoots = new Map<string, Promise<void>>()
  const ensureWorkspaceProvisioned = (root: string): Promise<void> => {
    if (pluginCollection.provisioningContributions.length === 0) return Promise.resolve()
    const resolvedRoot = path.resolve(root)
    const existing = provisionedWorkspaceRoots.get(resolvedRoot)
    if (existing) return existing
    const pending = provisionWorkspaceAgentServer({
      workspaceRoot: resolvedRoot,
      provisioningContributions: pluginCollection.provisioningContributions,
      force: options.forceProvisioning,
    }).catch((error) => {
      provisionedWorkspaceRoots.delete(resolvedRoot)
      throw error
    })
    provisionedWorkspaceRoots.set(resolvedRoot, pending)
    return pending
  }

  await ensureWorkspaceProvisioned(workspaceRoot)

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
    await ensureWorkspaceProvisioned(root)
    return root
  }
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
  const resolvePiOptions: NonNullable<RegisterAgentRoutesOptions['getPi']> = async (ctx) => {
    const pluginOptions = getPluginPiOptions(ctx.workspaceRoot)
    const callerOptions = options.getPi
      ? await options.getPi(ctx)
      : undefined
    return mergePiOptions(pluginOptions, callerOptions)
  }
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
      return [
        ...callerTools,
        ...createWorkspaceUiTools(getUiBridge(ctx.workspaceId), {
          workspaceRoot: ctx.workspaceFsCapability === 'strong' ? ctx.workspaceRoot : undefined,
        }),
      ]
    },
    sandboxHandleStore: options.sandboxHandleStore ?? new WorkspaceRuntimeSandboxHandleStore(workspaceStore),
    getWorkspaceId: resolveWorkspaceId,
    getWorkspaceRoot: resolveRoot,
    registerHealthRoute: options.registerHealthRoute ?? false,
    telemetry,
  })

  await app.register(uiRoutes, {
    getBridge: async (request) => getUiBridge(await resolveWorkspaceId(request)),
    preserveStateKeys: pluginCollection.preservedUiStateKeys,
  })

  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }

  if (serveFrontend && appRoot) {
    await registerFrontendFallback(app, appRoot, telemetry)
  }

  return app
}
