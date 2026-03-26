import { afterEach, describe, it, expect, vi } from 'vitest'
import { __apiBaseTestUtils, buildApiUrl, buildWsUrl } from './apiBase'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('apiBase loopback rewrite', () => {
  it('rewrites loopback VITE_API_URL to current host for remote browser clients', () => {
    const rewritten = __apiBaseTestUtils.rewriteLoopbackForRemoteClient(
      'http://127.0.0.1:3456',
      {
        origin: 'http://213.32.19.186:5190',
        hostname: '213.32.19.186',
      },
    )
    expect(rewritten).toBe('http://213.32.19.186:3456')
  })

  it('keeps loopback VITE_API_URL when the browser itself is local', () => {
    const rewritten = __apiBaseTestUtils.rewriteLoopbackForRemoteClient(
      'http://127.0.0.1:3456',
      {
        origin: 'http://127.0.0.1:5190',
        hostname: '127.0.0.1',
      },
    )
    expect(rewritten).toBe('http://127.0.0.1:3456')
  })

  it('supports IPv6 loopback rewrite for remote browser hosts', () => {
    const rewritten = __apiBaseTestUtils.rewriteLoopbackForRemoteClient(
      'http://[::1]:3456',
      {
        origin: 'http://213.32.19.186:5190',
        hostname: '213.32.19.186',
      },
    )
    expect(rewritten).toBe('http://213.32.19.186:3456')
  })

  it('treats 5190 as a dev port for fallback API host resolution', () => {
    expect(__apiBaseTestUtils.isDevPort('5190')).toBe(true)
    expect(__apiBaseTestUtils.isDevPort('5173')).toBe(true)
    expect(__apiBaseTestUtils.isDevPort('8000')).toBe(false)
  })

  it('builds query strings from objects while skipping empty values', () => {
    expect(
      __apiBaseTestUtils.toSearchParams({
        q: 'hello',
        tag: ['a', 'b'],
        ignored: undefined,
      }),
    ).toBe('?q=hello&tag=a&tag=b')
  })

  it('serializes array query values as repeated parameters for websocket URLs', () => {
    const wsUrl = buildWsUrl('/ws/agent/normal/stream', {
      session_id: 'abc123',
      file: ['one.txt', 'two.txt'],
    })

    expect(wsUrl).toContain('/ws/agent/normal/stream?')
    expect(wsUrl).toContain('session_id=abc123')
    expect(wsUrl).toContain('file=one.txt')
    expect(wsUrl).toContain('file=two.txt')
  })

  it('extracts workspace base from pathname', () => {
    expect(__apiBaseTestUtils.getWorkspaceBasePath('/w/ws-123/app/editor')).toBe('/w/ws-123')
    expect(__apiBaseTestUtils.getWorkspaceBasePath('/api/capabilities')).toBe('')
  })

  it('builds workspace-scoped api url when running under /w/{id}', () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        protocol: 'https:',
        hostname: 'example.com',
        port: '',
        origin: 'https://example.com',
        pathname: '/w/ws-123/',
      },
    })
    try {
      expect(buildApiUrl('/api/capabilities')).toBe('https://example.com/w/ws-123/api/capabilities')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })

  it('preserves workspace scope when VITE_API_URL is configured under /w/{id}', () => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:8124')
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '5178',
        origin: 'http://127.0.0.1:5178',
        pathname: '/w/ws-123/',
      },
    })
    try {
      expect(
        buildApiUrl('/api/v1/files/list', { path: '.' }),
      ).toBe('http://127.0.0.1:8124/w/ws-123/api/v1/files/list?path=.')
      expect(
        buildWsUrl('/ws/pty', { session_id: 'abc123' }),
      ).toBe('ws://127.0.0.1:8124/w/ws-123/ws/pty?session_id=abc123')
      expect(
        buildApiUrl('/api/project', undefined, { rootScoped: true }),
      ).toBe('http://127.0.0.1:8124/api/project')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })

  it('can force root-scoped api urls for public bootstrap endpoints under /w/{id}', () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        protocol: 'https:',
        hostname: 'example.com',
        port: '',
        origin: 'https://example.com',
        pathname: '/w/ws-123/',
      },
    })
    try {
      expect(
        buildApiUrl('/__bui/config', undefined, { rootScoped: true }),
      ).toBe('https://example.com/__bui/config')
      expect(
        buildApiUrl('/api/capabilities', undefined, { rootScoped: true }),
      ).toBe('https://example.com/api/capabilities')
      expect(
        buildApiUrl('/api/project', undefined, { rootScoped: true }),
      ).toBe('https://example.com/api/project')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })

  it('builds workspace-scoped websocket url when running under /w/{id}', () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        protocol: 'https:',
        hostname: 'example.com',
        port: '',
        origin: 'https://example.com',
        pathname: '/w/ws-123/',
      },
    })
    try {
      expect(
        buildWsUrl('/ws/pty', { session_id: 'abc123', resume: 1 }),
      ).toBe('wss://example.com/w/ws-123/ws/pty?session_id=abc123&resume=1')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })

  it('uses same-origin API base on dev ports so Vite proxy handles backend requests', () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        protocol: 'http:',
        hostname: '213.32.19.186',
        port: '5175',
        origin: 'http://213.32.19.186:5175',
        pathname: '/',
      },
    })
    try {
      expect(buildApiUrl('/api/project')).toBe('http://213.32.19.186:5175/api/project')
      expect(buildWsUrl('/ws/pty')).toBe('ws://213.32.19.186:5175/ws/pty')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })
})
