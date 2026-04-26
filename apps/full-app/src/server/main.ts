import { access, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerAgentRoutes } from '@boring/agent/server'
import {
  authHook,
  createAuth,
  createCoreApp,
  loadConfig,
  registerMemberRoutes,
  registerRoutes,
  registerSettingsRoutes,
  registerWorkspaceRoutes,
  type BetterAuthInstance,
} from '@boring/core/server'
import {
  createDatabase,
  PostgresUserStore,
  PostgresWorkspaceStore,
} from '@boring/core/server/db'

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

function shouldServeFrontend(pathname: string): boolean {
  if (pathname === '/health') return false
  if (pathname.startsWith('/api/')) return false
  if (pathname === '/auth') return false
  if (pathname.startsWith('/auth/')) return false
  return true
}

async function registerAuthProxy(app: AppWithAuth) {
  app.all('/auth/*', async (request: any, reply: any) => {
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
    reply.send(responseBody)
  })
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

    reply.type('text/html; charset=utf-8')
    return reply.send(createReadStream(indexPath))
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

    reply.type('text/html; charset=utf-8')
    return reply.send(createReadStream(indexPath))
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
      proxy: {
        '/api': apiTarget,
        '/auth': apiTarget,
        '/health': apiTarget,
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
  const workspaceStore = new PostgresWorkspaceStore(db)

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
  await registerAuthProxy(app as AppWithAuth)

  await app.register(registerAgentRoutes, { registerHealthRoute: false })

  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(thisDir, '../..')

  const production = process.env.NODE_ENV !== 'development'
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
