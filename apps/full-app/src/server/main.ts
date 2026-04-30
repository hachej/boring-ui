import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerAgentRoutes } from '@boring/agent/server'
import {
  authHook,
  createAuth,
  createCoreApp,
  loadConfig,
  registerInviteRoutes,
  registerMemberRoutes,
  registerRoutes,
  registerSettingsRoutes,
  registerWorkspaceRoutes,
  WorkspaceRuntimeSandboxHandleStore,
  type BetterAuthInstance,
} from '@boring/core/server'
import {
  createDatabase,
  PostgresUserStore,
  PostgresWorkspaceStore,
} from '@boring/core/server/db'
import {
  createInMemoryBridge,
  createWorkspaceUiTools,
  uiRoutes,
  type UiBridge,
} from '@boring/workspace/server'

const DEFAULT_FRONTEND_PORT = 5173

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

type CoreAppInstance = Awaited<ReturnType<typeof createCoreApp>>
type AppWithAuth = CoreAppInstance & { auth: BetterAuthInstance }

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

function encodeAuthRequestBody(request: any): string | Uint8Array | URLSearchParams | undefined {
  const isBodyless = request.method === 'GET' || request.method === 'HEAD'
  if (isBodyless) return undefined

  const bodyValue = request.body
  if (bodyValue == null) return undefined
  if (typeof bodyValue === 'string') return bodyValue
  if (bodyValue instanceof Uint8Array) return bodyValue
  if (bodyValue instanceof URLSearchParams) return bodyValue

  const contentType = String(request.headers?.['content-type'] ?? '').toLowerCase()
  if (contentType.includes('application/x-www-form-urlencoded')) {
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

function validateWorkspaceIdSegment(value: string): string {
  const workspaceId = value.trim()
  if (!workspaceId) {
    throw httpError('workspace id is required', 400)
  }
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

function resolveWorkspaceRoot(baseRoot: string, workspaceId: string): string {
  const base = path.resolve(baseRoot)
  const scopedRoot = path.resolve(base, workspaceId)
  if (scopedRoot !== base && scopedRoot.startsWith(`${base}${path.sep}`)) {
    return scopedRoot
  }
  throw httpError('invalid workspace id', 400)
}

// Frontend React Router routes that live under /auth/*. Requests to these
// paths must be served as the SPA shell so React Router can render the
// matching page. Everything else under /auth/* is a better-auth API
// endpoint and is owned by registerAuthProxy.
const FRONTEND_AUTH_PAGES = new Set([
  '/auth/signin',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/auth/callback/github',
])

function shouldServeFrontend(pathname: string): boolean {
  if (pathname === '/health') return false
  if (pathname.startsWith('/api/')) return false
  if (FRONTEND_AUTH_PAGES.has(pathname)) return true
  if (pathname === '/auth') return false
  if (pathname.startsWith('/auth/')) return false
  return true
}

async function registerAuthProxy(app: AppWithAuth) {
  app.all('/auth/*', async (request: any, reply: any) => {
    // /auth/* covers both better-auth API endpoints (POST sign-in/email,
    // GET get-session, …) and frontend React Router pages (/auth/signin,
    // /auth/reset-password?token=…). For HTML page navigations we let the
    // request fall through to the static frontend fallback so React Router
    // can render the page; everything else (XHR / fetch / POST → API) goes
    // to the better-auth handler.
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
        body: body as any,
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

async function registerFrontendAuthPages(
  app: CoreAppInstance,
  appRoot: string,
) {
  const frontDistDir = path.resolve(appRoot, 'dist/front')
  const indexPath = path.resolve(frontDistDir, 'index.html')

  // Static GET routes for the React Router auth pages must be registered
  // BEFORE the /auth/* better-auth proxy so Fastify's radix-tree router
  // dispatches the exact-match GET to the SPA shell instead of forwarding to
  // the API handler (which has no matching endpoint and would 404).
  for (const pagePath of FRONTEND_AUTH_PAGES) {
    app.get(pagePath, async (request: any, reply: any) => {
      if (!(await pathExists(indexPath))) {
        reply.status(503)
        return {
          error: 'frontend_not_built',
          message: 'Run `pnpm --filter full-app build` before starting in production mode.',
        }
      }
      const html = await readFile(indexPath, 'utf-8')
      reply.type('text/html; charset=utf-8')
      return reply.send(injectCspNonceIntoHtml(html, request.cspNonce))
    })
  }
}

async function registerFrontendFallback(
  app: CoreAppInstance,
  appRoot: string,
) {
  const frontDistDir = path.resolve(appRoot, 'dist/front')
  const indexPath = path.resolve(frontDistDir, 'index.html')

  app.get('/', async (request: any, reply: any) => {
    if (!(await pathExists(indexPath))) {
      request.log.error(
        { event: 'full-app.frontend.missing', bead: 'boring-ui-v2-q4fo', indexPath },
        'full-app.frontend.missing',
      )
      reply.status(503)
      return {
        error: 'frontend_not_built',
        message: 'Run `pnpm --filter full-app build` before starting in production mode.',
      }
    }

    const html = await readFile(indexPath, 'utf-8')
    reply.type('text/html; charset=utf-8')
    return reply.send(injectCspNonceIntoHtml(html, request.cspNonce))
  })

  app.get('/*', async (request: any, reply: any) => {
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
        message: 'Run `pnpm --filter full-app build` before starting in production mode.',
      }
    }

    const html = await readFile(indexPath, 'utf-8')
    reply.type('text/html; charset=utf-8')
    return reply.send(injectCspNonceIntoHtml(html, request.cspNonce))
  })
}

async function startViteDevServer(
  appRoot: string,
  apiTarget: string,
  app: CoreAppInstance,
): Promise<void> {
  const { createServer: createViteServer } = await import('vite')

  const vite = await createViteServer({
    root: appRoot,
    server: {
      port: DEFAULT_FRONTEND_PORT,
      strictPort: false,
      host: true,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/auth': {
          target: apiTarget,
          changeOrigin: true,
          // /auth/* is shared between better-auth API paths (POST sign-in/email,
          // GET get-session, etc.) and frontend React Router pages (/auth/signin,
          // /auth/reset-password?token=…). Differentiate by request shape: a GET
          // for text/html is an SPA navigation — let Vite serve index.html so
          // React Router can render the page. Anything else (XHR / fetch / POST)
          // is an API call — proxy to the backend.
          bypass(req) {
            const accept = req.headers.accept ?? ''
            if (req.method === 'GET' && accept.includes('text/html')) {
              return req.url
            }
            return undefined
          },
        },
      },
    },
  })

  await vite.listen()
  vite.printUrls()

  app.log.info(
    {
      event: 'full-app.vite.ready',
      bead: 'boring-ui-v2-q4fo',
      frontendPort: DEFAULT_FRONTEND_PORT,
      apiTarget,
    },
    'full-app.vite.ready',
  )
}

async function main() {
  const config = await loadConfig({
    allowMissingSecrets: process.env.NODE_ENV !== 'production',
  })
  if (config.stores !== 'postgres') {
    throw new Error('apps/full-app currently supports only CORE_STORES=postgres')
  }

  const { db, sql } = createDatabase(config)
  const userStore = new PostgresUserStore(db)
  const workspaceStore = new PostgresWorkspaceStore(db, config.encryption.workspaceSettingsKey)
  const sandboxHandleStore = new WorkspaceRuntimeSandboxHandleStore(workspaceStore)

  const app = await createCoreApp(config)
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

  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(thisDir, '../..')

  // Frontend auth pages must register before the better-auth proxy so the
  // exact-match GET routes win against the proxy's /auth/* wildcard.
  const production = process.env.NODE_ENV !== 'development'
  if (production) {
    await registerFrontendAuthPages(app, appRoot)
  }

  await registerAuthProxy(app as AppWithAuth)

  const workspaceRoot =
    process.env.FULL_APP_WORKSPACE_ROOT ??
    path.resolve(tmpdir(), 'boring-ui-v2-full-app-workspace')
  await mkdir(workspaceRoot, { recursive: true })

  const bridges = new Map<string, UiBridge>()
  const getUiBridge = (workspaceId: string): UiBridge => {
    let bridge = bridges.get(workspaceId)
    if (!bridge) {
      bridge = createInMemoryBridge()
      bridges.set(workspaceId, bridge)
    }
    return bridge
  }

  const resolveAuthorizedWorkspaceId = async (request: any): Promise<string> => {
    const headerValue = request.headers?.['x-boring-workspace-id']
    const queryValue = (request.query as Record<string, unknown> | undefined)?.workspaceId
    const workspaceId = typeof headerValue === 'string'
      ? headerValue
      : typeof queryValue === 'string'
        ? queryValue
        : ''

    const normalizedWorkspaceId = validateWorkspaceIdSegment(workspaceId)

    const user = request.user as { id?: string } | null | undefined
    if (!user?.id) {
      throw httpError('authentication required', 401)
    }

    let member: boolean
    try {
      member = await workspaceStore.isMember(normalizedWorkspaceId, user.id)
    } catch (error) {
      request.log.error({ err: error, workspaceId: normalizedWorkspaceId }, 'workspace access check failed')
      throw httpError('workspace access check failed', 500)
    }
    if (!member) {
      throw httpError('workspace access denied', 403)
    }

    return normalizedWorkspaceId
  }

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    sandboxHandleStore,
    getWorkspaceId: resolveAuthorizedWorkspaceId,
    getWorkspaceRoot: async (workspaceId: string) => {
      const scopedRoot = resolveWorkspaceRoot(workspaceRoot, workspaceId)
      await mkdir(scopedRoot, { recursive: true })
      return scopedRoot
    },
    registerHealthRoute: false,
    getExtraTools: async ({ workspaceId }: { workspaceId: string }) =>
      createWorkspaceUiTools(getUiBridge(workspaceId)),
  })
  await app.register(uiRoutes, {
    getBridge: async (request: any) => getUiBridge(await resolveAuthorizedWorkspaceId(request)),
  })

  if (production) {
    await registerFrontendFallback(app, appRoot)
  }

  const address = await app.listen({
    host: config.host,
    port: config.port,
  })

  app.log.info(
    {
      event: 'full-app.server.ready',
      bead: 'boring-ui-v2-q4fo',
      address,
    },
    'full-app.server.ready',
  )

  if (!production) {
    const apiPort = Number(new URL(address).port)
    const apiTarget = `http://127.0.0.1:${apiPort}`
    await startViteDevServer(appRoot, apiTarget, app)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
