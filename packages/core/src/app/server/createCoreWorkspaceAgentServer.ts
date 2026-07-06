import { access, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'

import {
  compactPiPackages,
  createRemoteWorkerModeAdapter,
  provisionWorkspaceRuntime,
  registerAgentRoutes,
  type RegisterAgentRoutesOptions,
  type RuntimeEnvContributionContext,
  type RuntimeProvisioningContribution,
} from '@hachej/boring-agent/server'
import {
  assertWorkspaceBridgeHandlersTrusted,
  collectWorkspaceAgentServerPlugins,
  hasDirServerPlugin,
  omitPluginAuthoringProvisioning,
  readWorkspacePluginPackagePiSnapshot,
  readWorkspacePluginPackageRuntimePlugins,
  resolveDefaultWorkspacePluginPackagePaths,
  resolveOnePluginEntry,
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
import {
  FRONTEND_AUTH_PAGES,
  FRONTEND_AUTH_PAGES_SPA_ONLY,
  registerAuthProxy,
} from './authProxy.js'
import {
  authorizeWorkspaceAccess,
  isSharedUiMutationRequest,
  resolveWorkspaceMemberId,
  resolveWorkspaceRoot,
  validateWorkspaceIdSegment,
} from './workspaceAccess.js'
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
  registerOutreachRoutes,
  registerSettingsRoutes,
  registerWorkspaceRoutes,
} from '../../server/routes/index.js'
import {
  createDatabase,
  PostgresMeteringStore,
  PostgresUserStore,
  PostgresWorkspaceStore,
  type Database,
} from '../../server/db/index.js'
import { loadConfig, type LoadConfigOptions } from '../../server/config/index.js'
import { WorkspaceRuntimeSandboxHandleStore } from '../../server/runtime/index.js'
import { createDatabaseTelemetryFromEnv } from '../../server/telemetry/db.js'
import { isAnonymousOutreachUser } from '../../server/outreach/policy.js'

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
}

type AgentPiOptions = RegisterAgentRoutesOptions['pi']

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

async function createCoreRuntime(config: CoreConfig, customTelemetry?: TelemetrySink): Promise<{
  app: CoreWorkspaceAgentServer
  sql: postgres.Sql
  db: Database
  userStore: UserStore
  workspaceStore: WorkspaceStore
  meteringStore: PostgresMeteringStore
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
  const meteringStore = new PostgresMeteringStore(storeDb)

  const app = await createCoreApp(config) as CoreWorkspaceAgentServer
  // Resolve the telemetry sink here (db exists now) so the auth hooks get a plain sink.
  const telemetry = customTelemetry ?? createDatabaseTelemetryFromEnv(db, { appId: config.appId }, process.env)
  const telemetrySource = customTelemetry
    ? 'custom'
    : process.env.BORING_TELEMETRY_ENABLED === 'true'
      ? 'db-env'
      : 'noop-env'
  app.log.debug({ telemetry: { source: telemetrySource } }, 'resolved telemetry sink')
  const auth = createAuth(config, db, { workspaceStore, logger: app.log, telemetry })

  app.decorate('db', db)
  app.decorate('auth', auth)
  app.decorate('userStore', userStore)
  app.decorate('workspaceStore', workspaceStore)
  app.decorate('telemetry', telemetry)
  app.decorate('isAnonymousOutreachUser', (appId: string, userId: string) => isAnonymousOutreachUser(db, appId, userId))

  app.addHook('onClose', async () => {
    await sql.end()
  })

  return { app, sql, db, userStore, workspaceStore, meteringStore, telemetry }
}

async function registerCoreRoutes({
  app,
  sql,
  db,
  userStore,
  workspaceStore,
  meteringStore,
}: {
  app: CoreWorkspaceAgentServer
  sql: postgres.Sql
  db: Database
  userStore: UserStore
  workspaceStore: WorkspaceStore
  meteringStore: PostgresMeteringStore
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
  await app.register(registerOutreachRoutes, { db, workspaceStore, creditGrantStore: meteringStore })
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
  const { app, sql, db, userStore, workspaceStore, meteringStore, telemetry } = await createCoreRuntime(config, options.telemetry)
  const appRoot = options.appRoot
  const serveFrontend =
    options.serveFrontend ?? (process.env.NODE_ENV !== 'development' && Boolean(appRoot))
  const pluginWorkspaceRoot = process.cwd()
  const workspaceRoot = options.workspaceRoot ?? process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()
  registerTelemetryHooks(app, telemetry)

  await registerCoreRoutes({ app, sql, db, userStore, workspaceStore, meteringStore })

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
  const pluginResolveContext: WorkspaceAgentServerPluginContext = {
    workspaceRoot: pluginWorkspaceRoot,
    bridge: createUnavailableCorePluginBridge(),
  }
  const resolvedPlugins = await Promise.all(
    pluginEntries.map(async (entry) => {
      const plugin = await resolveOnePluginEntry<CoreWorkspaceAgentServerPlugin>(
        entry,
        pluginResolveContext,
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

  const resolveWorkspaceId = async (request: Parameters<NonNullable<RegisterAgentRoutesOptions['getWorkspaceId']>>[0]) =>
    options.getWorkspaceId
      ? await options.getWorkspaceId(request)
      : await resolveWorkspaceMemberId(request, workspaceStore)
  const authorizeAgentWorkspaceAccess: NonNullable<RegisterAgentRoutesOptions['authorizeWorkspaceAccess']> = async ({
    request,
    workspaceId,
    minimumRole,
  }) => {
    if (options.authorizeWorkspaceAccess) {
      await options.authorizeWorkspaceAccess({ request, workspaceId, minimumRole })
      return
    }
    if (options.getWorkspaceId) return
    await authorizeWorkspaceAccess(request, workspaceId, workspaceStore, { minimumRole })
  }
  const resolveSharedUiWorkspaceId = async (request: Parameters<NonNullable<RegisterAgentRoutesOptions['getWorkspaceId']>>[0]) => {
    const workspaceId = await resolveWorkspaceId(request)
    const mutatesSharedUiState = isSharedUiMutationRequest(request)
    if (mutatesSharedUiState && options.authorizeWorkspaceAccess) {
      await options.authorizeWorkspaceAccess({ request, workspaceId, minimumRole: 'editor' })
    } else if (mutatesSharedUiState && !options.getWorkspaceId) {
      // Core's in-memory UI bridge is scoped by workspace, not by user, so
      // writes to this shared workspace state require editor access.
      await authorizeWorkspaceAccess(request, workspaceId, workspaceStore, { minimumRole: 'editor' })
    }
    return workspaceId
  }
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
  })
  app.addHook('preHandler', async (request) => {
    await coreBridge.rememberSessionOwner(request)
  })

  const workerBaseUrl = process.env.BORING_WORKER_BASE_URL?.trim()
  const remoteWorkerModeAdapter = workerBaseUrl
    ? createRemoteWorkerModeAdapter({ baseUrl: workerBaseUrl })
    : undefined
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
    runtimeModeAdapter: remoteWorkerModeAdapter,
    version: options.version,
    extraTools: [
      ...(options.extraTools ?? []),
      ...(pluginCollection.agentOptions.extraTools ?? []),
    ],
    systemPromptAppend: pluginCollection.agentOptions.systemPromptAppend,
    pi: pluginCollection.agentOptions.pi,
    getPi: resolvePiOptions,
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
    sandboxHandleStore: options.sandboxHandleStore ?? new WorkspaceRuntimeSandboxHandleStore(workspaceStore),
    getWorkspaceId: resolveWorkspaceId,
    authorizeWorkspaceAccess: authorizeAgentWorkspaceAccess,
    getWorkspaceRoot: resolveRoot,
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
    runtimeEnvContributions: [
      ...(options.runtimeEnvContributions ?? []),
      ...(coreBridge.runtimeEnvContribution ? [coreBridge.runtimeEnvContribution] : []),
    ],
  })

  await app.register(uiRoutes, {
    getWorkspaceId: resolveSharedUiWorkspaceId,
    getBridge: async (request) => coreBridge.getBridge(await resolveSharedUiWorkspaceId(request)),
    preserveStateKeys: pluginCollection.preservedUiStateKeys,
  })

  await coreBridge.registerHttpRoutes(app)

  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }

  if (serveFrontend && appRoot) {
    await registerFrontendFallback(app, appRoot, telemetry)
  }

  return app
}
