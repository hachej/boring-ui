/**
 * Workspace boundary router — maps /w/{workspaceId}/* to workspace-scoped routes.
 *
 * Uses internal proxy (app.inject) instead of HTTP redirects to preserve
 * request body, cookies, and response for non-browser clients (smoke tests, API).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  parseSessionCookie,
  appCookieName,
  SessionExpiredError,
} from '../auth/session.js'
import { UUID_RE } from '../workspace/helpers.js'

declare module 'fastify' {
  interface FastifyRequest {
    workspaceId?: string
  }
}

// Allowed path prefixes for workspace-scoped passthrough
const PASSTHROUGH_PREFIXES = [
  '/api/v1/files',
  '/api/v1/git',
  '/api/v1/agent',
  '/api/v1/ui',
  '/api/v1/me',
  '/api/v1/workspaces',
  '/api/v1/exec',
  '/api/capabilities',
  '/api/config',
  '/api/project',
  '/api/approval',
]

// Paths that bypass workspace auth (served as SPA pages)
const SPA_PATHS = new Set(['', 'setup', 'settings', 'runtime'])

// Headers stripped when proxying workspace-scoped requests
const SKIP_PROXY_HEADERS = new Set(['transfer-encoding', 'connection', 'keep-alive'])

/** Load index.html from the static dir for SPA fallback, or use a minimal shell. */
function loadSpaHtml(staticDir: string | undefined): string {
  if (staticDir) {
    try {
      return readFileSync(join(resolve(staticDir), 'index.html'), 'utf-8')
    } catch { /* fall through */ }
  }
  return '<!DOCTYPE html><html><body>SPA</body></html>'
}

function sendSpaHtml(reply: FastifyReply, html: string): FastifyReply {
  return reply
    .code(200)
    .type('text/html')
    .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    .send(html)
}

export async function registerWorkspaceBoundary(
  app: FastifyInstance,
): Promise<void> {
  const spaHtml = loadSpaHtml(app.config.staticDir)

  // Catch-all route for /w/:workspaceId/*
  app.all('/w/:workspaceId/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.params as { workspaceId: string }

    if (!UUID_RE.test(workspaceId)) {
      return reply.code(400).send({
        error: 'validation',
        code: 'INVALID_WORKSPACE_ID',
        message: 'Invalid workspace ID',
      })
    }

    // Extract the remaining path after /w/{id}/
    const wildcard = (request.params as any)['*'] || ''

    // SPA pages — serve real index.html for browser navigation
    if (SPA_PATHS.has(wildcard)) {
      return sendSpaHtml(reply, spaHtml)
    }

    // Validate that the path is an allowed passthrough
    const normalizedPath = '/' + wildcard.replace(/^\//, '')
    const isAllowed = PASSTHROUGH_PREFIXES.some((prefix) =>
      normalizedPath.startsWith(prefix),
    )

    if (!isAllowed) {
      return reply.code(404).send({
        error: 'not_found',
        code: 'ROUTE_NOT_FOUND',
        message: `Route not found: /w/${workspaceId}/${wildcard}`,
      })
    }

    // Auth check
    const cookieName = app.config.authSessionCookieName || appCookieName()
    const token = request.cookies[cookieName]

    if (!token) {
      return reply.code(401).send({
        error: 'unauthorized',
        code: 'SESSION_REQUIRED',
        message: 'Authentication required',
      })
    }

    try {
      const session = await parseSessionCookie(token, app.config.sessionSecret)
      request.sessionUserId = session.user_id
      request.sessionEmail = session.email
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        return reply.code(401).send({ error: 'unauthorized', code: 'SESSION_EXPIRED' })
      }
      return reply.code(401).send({ error: 'unauthorized', code: 'INVALID_SESSION' })
    }

    // Internal proxy: dispatch the request to the actual route via app.inject()
    // This preserves request body, cookies, and returns the real response
    // (unlike 307 redirect which loses POST bodies and breaks non-browser clients).
    const queryStr = request.url.includes('?') ? '?' + request.url.split('?')[1] : ''
    const targetUrl = normalizedPath + queryStr

    // Build headers — forward cookies and workspace context
    const headers: Record<string, string> = {
      'x-workspace-id': workspaceId,
      'cookie': request.headers.cookie || '',
    }
    if (request.headers['content-type']) {
      headers['content-type'] = request.headers['content-type'] as string
    }

    const injected = await app.inject({
      method: request.method as any,
      url: targetUrl,
      headers,
      payload: request.body as any,
    })

    // Forward the response
    reply.code(injected.statusCode)

    // Forward response headers (skip hop-by-hop headers)
    for (const [key, value] of Object.entries(injected.headers)) {
      if (!SKIP_PROXY_HEADERS.has(key.toLowerCase()) && value) {
        reply.header(key, value)
      }
    }

    return reply.send(injected.rawPayload)
  })

  // Workspace root — serve SPA
  app.get('/w/:workspaceId', async (request: FastifyRequest, reply: FastifyReply) => {
    return sendSpaHtml(reply, spaHtml)
  })
}
