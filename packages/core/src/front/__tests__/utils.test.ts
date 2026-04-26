// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  apiFetch,
  apiFetchJson,
  setApiBase,
  getApiBase,
  buildApiUrl,
  getWsBase,
  buildWsUrl,
  getHttpErrorDetail,
  routes,
  routeHref,
} from '../utils'
import { HttpError } from '../../shared/errors'

beforeEach(() => {
  setApiBase('')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getApiBase / setApiBase', () => {
  it('defaults to empty string', () => {
    expect(getApiBase()).toBe('')
  })

  it('stores and retrieves base', () => {
    setApiBase('https://api.test.dev')
    expect(getApiBase()).toBe('https://api.test.dev')
  })

  it('strips trailing slash', () => {
    setApiBase('https://api.test.dev/')
    expect(getApiBase()).toBe('https://api.test.dev')
  })
})

describe('buildApiUrl', () => {
  it('prepends API base to relative path', () => {
    setApiBase('https://api.test.dev')
    expect(buildApiUrl('/health')).toBe('https://api.test.dev/health')
  })

  it('passes through absolute URLs', () => {
    expect(buildApiUrl('https://other.dev/foo')).toBe('https://other.dev/foo')
  })

  it('adds leading slash if missing', () => {
    setApiBase('https://api.test.dev')
    expect(buildApiUrl('health')).toBe('https://api.test.dev/health')
  })
})

describe('getWsBase / buildWsUrl', () => {
  it('converts https to wss', () => {
    setApiBase('https://api.test.dev')
    expect(getWsBase()).toBe('wss://api.test.dev')
  })

  it('converts http to ws', () => {
    setApiBase('http://localhost:3000')
    expect(getWsBase()).toBe('ws://localhost:3000')
  })

  it('builds full ws URL', () => {
    setApiBase('https://api.test.dev')
    expect(buildWsUrl('/ws/agent')).toBe('wss://api.test.dev/ws/agent')
  })
})

describe('apiFetch', () => {
  it('sets credentials to include', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    await apiFetch('/test')

    expect(mockFetch).toHaveBeenCalledWith(
      '/test',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('throws HttpError on 401 with envelope', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'unauthorized',
          message: 'Session expired',
          requestId: 'req-123',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', mockFetch)

    const err = await apiFetch('/test').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    const httpErr = err as HttpError
    expect(httpErr.status).toBe(401)
    expect(httpErr.code).toBe('unauthorized')
    expect(httpErr.message).toBe('Session expired')
    expect(httpErr.requestId).toBe('req-123')
  })

  it('throws HttpError with network error on fetch failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', mockFetch)

    const err = await apiFetch('/test').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    const httpErr = err as HttpError
    expect(httpErr.status).toBe(0)
    expect(httpErr.code).toBe('internal_error')
    expect(httpErr.message).toContain('Network error')
  })

  it('throws HttpError with fallback when response body is not JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Service Unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const err = await apiFetch('/test').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    const httpErr = err as HttpError
    expect(httpErr.status).toBe(503)
    expect(httpErr.code).toBe('internal_error')
    expect(httpErr.message).toBe('Service Unavailable')
  })
})

describe('apiFetchJson', () => {
  it('returns parsed JSON on success', async () => {
    const data = { appId: 'test', appName: 'My App' }
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await apiFetchJson<typeof data>('/api/v1/config')
    expect(result).toEqual(data)
  })

  it('throws HttpError on non-2xx', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'forbidden', message: 'Access denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', mockFetch)

    await expect(apiFetchJson('/protected')).rejects.toThrow(HttpError)
  })
})

describe('getHttpErrorDetail', () => {
  it('extracts from HttpError', () => {
    const err = new HttpError({
      status: 404,
      code: 'not_found',
      message: 'Not found',
      requestId: 'r-1',
    })
    expect(getHttpErrorDetail(err)).toEqual({
      code: 'not_found',
      message: 'Not found',
      status: 404,
    })
  })

  it('handles plain Error', () => {
    const err = new Error('Boom')
    expect(getHttpErrorDetail(err)).toEqual({
      code: 'internal_error',
      message: 'Boom',
    })
  })

  it('handles non-Error values', () => {
    expect(getHttpErrorDetail('string error')).toEqual({
      code: 'internal_error',
      message: 'string error',
    })
  })
})

describe('routes + routeHref', () => {
  it('routes has expected keys', () => {
    expect(routes.signin).toBe('/auth/signin')
    expect(routes.signup).toBe('/auth/signup')
    expect(routes.forgotPassword).toBe('/auth/forgot-password')
    expect(routes.resetPassword).toBe('/auth/reset-password')
    expect(routes.verifyEmail).toBe('/auth/verify-email')
    expect(routes.me).toBe('/me')
  })

  it('routeHref returns route path', () => {
    expect(routeHref('signin')).toBe('/auth/signin')
  })

  it('routeHref substitutes params', () => {
    expect(routeHref('me', {})).toBe('/me')
  })
})
