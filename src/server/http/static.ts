/**
 * Static file serving + SPA fallback for the built frontend.
 *
 * Mirrors Python's runtime.py mount_static() behavior:
 * - Serves dist/ via @fastify/static
 * - SPA fallback: unmatched GETs serve index.html
 * - Cache: immutable for /assets/*, no-store for HTML
 * - Workspace asset rewrite: /w/{id}/assets/* → /assets/*
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'

/** API/system prefixes that should never be caught by SPA fallback */
const API_PREFIXES = [
  '/api/',
  '/trpc/',
  '/health',
  '/healthz',
  '/metrics',
  '/ws/',
  '/__bui/',
]

function isApiRoute(url: string): boolean {
  return API_PREFIXES.some((p) => url.startsWith(p))
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Validate that a resolved path is safely within the static directory.
 * Prevents path traversal attacks.
 */
function isSafePath(staticRoot: string, filePath: string): boolean {
  const rel = relative(staticRoot, filePath)
  // Must not escape the root (no leading ..)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export async function registerStaticRoutes(
  app: FastifyInstance,
  staticDir: string,
): Promise<void> {
  const staticPath = resolve(staticDir)
  const indexPath = join(staticPath, 'index.html')

  if (!existsSync(indexPath)) {
    app.log.warn(`Static dir ${staticPath} has no index.html — SPA fallback disabled`)
    return
  }

  // Preload index.html content for fast SPA fallback
  const indexContent = await readFile(indexPath, 'utf-8')

  /** Send index.html as SPA fallback with no-cache headers. */
  function sendSpaFallback(reply: FastifyReply): FastifyReply {
    return reply
      .code(200)
      .type('text/html')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .send(indexContent)
  }

  // --- Mount @fastify/static FIRST so sendFile is available ---
  await app.register(fastifyStatic, {
    root: staticPath,
    prefix: '/',
    decorateReply: true,
    // Don't serve index.html via static — we handle it explicitly
    index: false,
    // Wildcard: false so Fastify named routes take priority
    wildcard: false,
  })

  // --- Explicit route for root / ---
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    return sendSpaFallback(reply)
  })

  // --- Workspace asset rewrite route ---
  // /w/{id}/assets/* → serve from static assets directory
  // This must be an explicit route to avoid conflict with workspace boundary router.
  app.get('/w/:workspaceId/assets/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const wildcard = (request.params as any)['*'] || ''
    // Resolve and validate the path to prevent traversal
    const filePath = resolve(staticPath, 'assets', wildcard)

    if (!isSafePath(staticPath, filePath) || !isFile(filePath)) {
      return reply.code(404).send({ error: 'not_found', message: 'Asset not found' })
    }

    // Use the validated relative path for sendFile
    const safePath = relative(staticPath, filePath)
    return reply.sendFile(safePath)
  })

  // --- Cache control hook ---
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    const url = request.url || ''

    if (url.includes('/assets/')) {
      const status = reply.statusCode
      if (status >= 200 && status < 400) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      }
    } else {
      const contentType = (reply.getHeader('content-type') as string) || ''
      if (contentType.includes('text/html')) {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      }
    }

    return payload
  })

  // --- SPA fallback: setNotFoundHandler ---
  // This runs AFTER all registered routes, so API routes are safe.
  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    // Only serve SPA fallback for GET requests to non-API paths
    if (request.method !== 'GET' || isApiRoute(request.url)) {
      return reply.code(404).send({
        error: 'not_found',
        message: `Route ${request.method} ${request.url} not found`,
      })
    }

    // Try to serve the actual file if it exists in static dir
    const requestedPath = request.url.split('?')[0]
    const relativePath = requestedPath.replace(/^\//, '')
    if (relativePath) {
      const filePath = resolve(staticPath, relativePath)
      // Validate path safety before serving
      if (isSafePath(staticPath, filePath) && isFile(filePath)) {
        const safePath = relative(staticPath, filePath)
        return reply.sendFile(safePath)
      }
    }

    // SPA fallback: serve index.html
    return sendSpaFallback(reply)
  })
}
