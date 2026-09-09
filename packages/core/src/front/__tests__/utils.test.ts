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
  extractInviteTokenFromRedirect,
  withForwardedAuthParams,
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
    expect(routes.authError).toBe('/auth/error')
    expect(routes.callbackGithub).toBe('/auth/callback/github')
    expect(routes.callbackGoogle).toBe('/auth/callback/google')
    expect(routes.me).toBe('/me')
  })

  it('routeHref returns route path', () => {
    expect(routeHref('signin')).toBe('/auth/signin')
    expect(routeHref('authError')).toBe('/auth/error')
    expect(routeHref('callbackGoogle')).toBe('/auth/callback/google')
  })

  it('routeHref substitutes params', () => {
    expect(routeHref('me', {})).toBe('/me')
  })
})

describe('extractInviteTokenFromRedirect', () => {
  const UUID_TOKEN = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
  const B64URL_TOKEN = 'dXaVMYAMLyQ_u2TWe6lSES-bxIX50QiETMxWiGl7CKE'

  it('accepts a UUID invite token (LocalWorkspaceStore shape)', () => {
    expect(extractInviteTokenFromRedirect(`/invites/${UUID_TOKEN}`)).toBe(UUID_TOKEN)
  })

  it('accepts a base64url invite token (PostgresWorkspaceStore shape)', () => {
    expect(extractInviteTokenFromRedirect(`/invites/${B64URL_TOKEN}`)).toBe(B64URL_TOKEN)
  })

  it('accepts a percent-encoded-but-still-valid token unchanged after single decode', () => {
    // '_' and '-' need no encoding, but a client could still send %5F/%2D for them.
    const encoded = B64URL_TOKEN.replace(/_/g, '%5F').replace(/-/g, '%2D')
    expect(extractInviteTokenFromRedirect(`/invites/${encoded}`)).toBe(B64URL_TOKEN)
  })

  const HOSTILE_CASES: Array<[string, string | null]> = [
    ['null input', null],
    ['empty string', ''],
    ['bare route with no token', '/invites/'],
    ['trailing segment appended', `/invites/${'a'.repeat(43)}/trailing`],
    ['unrelated trailing path', `/invites/${'a'.repeat(43)}/../../admin`],
    ['leading unrelated segment', `/foo/invites/${'a'.repeat(43)}`],
    ['absolute URL, http', `http://evil.example/invites/${'a'.repeat(43)}`],
    ['absolute URL, https', `https://evil.example/invites/${'a'.repeat(43)}`],
    ['protocol-relative URL', `//evil.example/invites/${'a'.repeat(43)}`],
    ['encoded separator smuggling a slash', '/invites/tok%2Fseparator-etc-etc-etc-etc-etc-x'],
    ['double-encoded separator', '/invites/tok%252Fseparator-etc-etc-etc-etc-etc'],
    ['malformed percent-escape', '/invites/%E0%A4%A'],
    ['lone percent sign', '/invites/tok%en-not-a-real-escape-etc-etc-etc-x'],
    ['query string smuggled into the segment', `/invites/${'a'.repeat(43)}?x=1`],
    ['hash smuggled into the segment', `/invites/${'a'.repeat(43)}#frag`],
    ['plausible-length but wrong alphabet', `/invites/${'!'.repeat(43)}`],
    ['too-short base64url-looking token', `/invites/${'a'.repeat(20)}`],
    ['too-long base64url-looking token', `/invites/${'a'.repeat(44)}`],
    ['UUID missing a hyphen', '3fa85f645717-4562-b3fc-2c963f66afa6'.replace(/^/, '/invites/')],
    // randomUUID() can only emit version 4 with an RFC 4122 variant nibble. A
    // syntactically UUID-shaped string with the wrong version or variant nibble is not a
    // value randomUUID() can ever produce and must not be extracted as a token.
    ['UUID with wrong version nibble (v1, not v4)', '/invites/3fa85f64-5717-1562-73fc-2c963f66afa6'],
    ['UUID with wrong version nibble (v5, not v4)', '/invites/3fa85f64-5717-5562-b3fc-2c963f66afa6'],
    ['UUID with wrong variant nibble (7, not 8/9/a/b)', '/invites/3fa85f64-5717-4562-73fc-2c963f66afa6'],
    ['UUID with wrong variant nibble (c, not 8/9/a/b)', '/invites/3fa85f64-5717-4562-c3fc-2c963f66afa6'],
    ['whitespace padding', ` /invites/${'a'.repeat(43)} `],
    ['non-invite redirect target', '/w/some-workspace/settings'],
  ]

  it.each(HOSTILE_CASES)('rejects: %s', (_label, input) => {
    expect(extractInviteTokenFromRedirect(input)).toBeNull()
  })
})

describe('withForwardedAuthParams', () => {
  it('forwards redirect only when invite_token is absent and not derivable', () => {
    expect(withForwardedAuthParams('/auth/signin', '?redirect=%2Fw%2Fsome-workspace%2Fsettings')).toBe(
      '/auth/signin?redirect=%2Fw%2Fsome-workspace%2Fsettings',
    )
  })

  it('forwards redirect only (reverse direction, sign-up -> sign-in)', () => {
    expect(withForwardedAuthParams('/auth/signup', '?redirect=%2Fw%2Fsome-workspace%2Fsettings')).toBe(
      '/auth/signup?redirect=%2Fw%2Fsome-workspace%2Fsettings',
    )
  })

  it('derives and forwards invite_token from a redirect=/invites/:token path', () => {
    const token = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
    const href = withForwardedAuthParams('/auth/signup', `?redirect=${encodeURIComponent(`/invites/${token}`)}`)
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('redirect')).toBe(`/invites/${token}`)
    expect(params.get('invite_token')).toBe(token)
  })

  it('does not fabricate an invite_token from a hostile redirect', () => {
    const href = withForwardedAuthParams(
      '/auth/signin',
      `?redirect=${encodeURIComponent(`/invites/${'a'.repeat(43)}/trailing`)}`,
    )
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('invite_token')).toBeNull()
  })

  it('returns the bare path when neither param is present', () => {
    expect(withForwardedAuthParams('/auth/signin', '')).toBe('/auth/signin')
  })
})
