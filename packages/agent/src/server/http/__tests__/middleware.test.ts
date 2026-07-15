import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, test, vi } from 'vitest'

import {
  createAuthMiddleware,
  createBodyValidator,
  ERROR_CODE_AUTH_INVALID,
  ERROR_CODE_AUTH_REQUIRED,
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_PATH_TOO_LONG,
  ERROR_CODE_VALIDATION_ERROR,
  validatePathParam,
} from '../middleware'

interface AppOptions {
  authToken?: string
  workspaceId?: string
  localPrincipal?: {
    authSubject: string
    authEmail?: string
    authEmailVerified?: boolean
    browserDraftNative?: boolean
  }
  onDevModeWarning?: (message: string) => void
}

interface BodyPayload {
  name: string
  count: number
}

const bodySchema = {
  safeParse(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {
        success: false as const,
        error: {
          issues: [{ path: [], message: 'Expected object' }],
        },
      }
    }

    const raw = input as Record<string, unknown>
    if (typeof raw.name !== 'string') {
      return {
        success: false as const,
        error: {
          issues: [{ path: ['name'], message: 'name must be a string' }],
        },
      }
    }

    if (
      typeof raw.count !== 'number' ||
      !Number.isInteger(raw.count) ||
      raw.count < 0
    ) {
      return {
        success: false as const,
        error: {
          issues: [{ path: ['count'], message: 'count must be a non-negative int' }],
        },
      }
    }

    return {
      success: true as const,
      data: {
        name: raw.name,
        count: raw.count,
      } satisfies BodyPayload,
    }
  },
}

async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', createAuthMiddleware(opts))

  app.get('/auth', async (request) => {
    return request.workspaceContext
  })

  app.get('/path', { preHandler: [validatePathParam] }, async (request) => {
    const query = request.query as Record<string, unknown>
    return {
      path: query.path,
      workspaceContext: request.workspaceContext,
    }
  })

  app.post(
    '/body',
    {
      preHandler: [
        createBodyValidator(bodySchema),
      ],
    },
    async (request) => {
      return {
        body: request.body,
        workspaceContext: request.workspaceContext,
      }
    },
  )

  await app.ready()
  return app
}

describe('auth middleware', () => {
  test('missing Bearer header returns 401 when token is configured', async () => {
    const app = await buildApp({ authToken: 'secret-token' })
    const response = await app.inject({ method: 'GET', url: '/auth' })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      error: {
        code: ERROR_CODE_AUTH_REQUIRED,
      },
    })

    await app.close()
  })

  test('invalid token returns 403', async () => {
    const app = await buildApp({ authToken: 'secret-token' })
    const response = await app.inject({
      method: 'GET',
      url: '/auth',
      headers: { authorization: 'Bearer not-secret' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      error: {
        code: ERROR_CODE_AUTH_INVALID,
      },
    })

    await app.close()
  })

  test('valid token passes and marks authenticated=true', async () => {
    const app = await buildApp({ authToken: 'secret-token', workspaceId: 'ws-a' })
    const response = await app.inject({
      method: 'GET',
      url: '/auth',
      headers: { authorization: 'Bearer secret-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      workspaceId: 'ws-a',
      authenticated: true,
    })

    await app.close()
  })

  test('valid token preserves configured local principal capability', async () => {
    const app = await buildApp({
      authToken: 'secret-token',
      workspaceId: 'ws-a',
      localPrincipal: { authSubject: 'local', browserDraftNative: true },
    })
    const response = await app.inject({
      method: 'GET',
      url: '/auth',
      headers: { authorization: 'Bearer secret-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      workspaceId: 'ws-a',
      authenticated: true,
      authSubject: 'local',
      browserDraftNative: true,
    })

    await app.close()
  })

  test('dev mode passthrough when auth token is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/auth' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      workspaceId: 'default',
      authenticated: false,
    })

    await app.close()
  })

  test('whitespace-only token triggers dev mode (not silent fail-open)', async () => {
    const onDevModeWarning = vi.fn()
    const app = await buildApp({ authToken: '   ', onDevModeWarning })
    const response = await app.inject({ method: 'GET', url: '/auth' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ authenticated: false })
    expect(onDevModeWarning).toHaveBeenCalledTimes(1)

    await app.close()
  })

  test('dev mode warning is emitted on first request only', async () => {
    const onDevModeWarning = vi.fn()
    const app = await buildApp({ onDevModeWarning })

    await app.inject({ method: 'GET', url: '/auth' })
    await app.inject({ method: 'GET', url: '/auth' })

    expect(onDevModeWarning).toHaveBeenCalledTimes(1)
    await app.close()
  })
})

describe('path validation middleware', () => {
  test('valid path passes', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: '/path?path=src/index.ts',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      path: 'src/index.ts',
    })

    await app.close()
  })

  test('missing path query param returns 400 invalid_path', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/path' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: {
        code: ERROR_CODE_INVALID_PATH,
        field: 'path',
      },
    })

    await app.close()
  })

  test('path longer than 4096 chars returns 400 path_too_long', async () => {
    const app = await buildApp()
    const pathParam = 'a'.repeat(4097)
    const response = await app.inject({
      method: 'GET',
      url: `/path?path=${pathParam}`,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: {
        code: ERROR_CODE_PATH_TOO_LONG,
        field: 'path',
      },
    })

    await app.close()
  })

  test('path containing null byte returns 400 invalid_path', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: '/path?path=abc%00def',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: {
        code: ERROR_CODE_INVALID_PATH,
        field: 'path',
      },
    })

    await app.close()
  })

  test('path traversal string passes middleware', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: '/path?path=../etc/passwd',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      path: '../etc/passwd',
    })

    await app.close()
  })
})

describe('body validation middleware', () => {
  test('valid body passes', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/body',
      payload: { name: 'alpha', count: 2 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      body: { name: 'alpha', count: 2 },
    })

    await app.close()
  })

  test('missing required field returns validation_error + field', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/body',
      payload: { count: 2 },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: {
        code: ERROR_CODE_VALIDATION_ERROR,
        field: 'name',
      },
    })

    await app.close()
  })

  test('wrong field type returns validation_error', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/body',
      payload: { name: 'alpha', count: 'oops' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: {
        code: ERROR_CODE_VALIDATION_ERROR,
        field: 'count',
      },
    })

    await app.close()
  })

  test('extra fields are stripped from parsed body', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/body',
      payload: { name: 'alpha', count: 2, extra: 'drop-me' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      body: { name: 'alpha', count: 2 },
    })
    expect(response.json().body.extra).toBeUndefined()

    await app.close()
  })
})

describe('workspaceContext propagation', () => {
  test('workspaceId is set on request after auth passes', async () => {
    const app = await buildApp({ authToken: 'secret-token', workspaceId: 'ws-42' })
    const response = await app.inject({
      method: 'GET',
      url: '/path?path=src/main.ts',
      headers: { authorization: 'Bearer secret-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      workspaceContext: {
        workspaceId: 'ws-42',
        authenticated: true,
      },
    })

    await app.close()
  })

  test('workspaceContext is accessible in downstream handlers', async () => {
    const app = await buildApp({ workspaceId: 'ws-local' })
    const response = await app.inject({ method: 'GET', url: '/auth' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      workspaceId: 'ws-local',
      authenticated: false,
    })

    await app.close()
  })
})
