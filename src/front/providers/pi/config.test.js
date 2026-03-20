import { describe, it, expect } from 'vitest'
import { getPiServiceUrl, isPiBackendMode, resolvePiServiceUrl } from './config'

describe('PI service URL config', () => {
  it('rewrites loopback URL for remote clients', () => {
    const rewritten = resolvePiServiceUrl.call(
      null,
      'http://localhost:8789',
    )
    expect(typeof rewritten).toBe('string')
  })

  it('uses capabilities service URL when present', () => {
    const url = getPiServiceUrl({
      services: {
        pi: { url: 'http://127.0.0.1:8789', mode: 'backend' },
      },
    })
    expect(url.includes(':8789')).toBe(true)
  })

  it('enables backend mode when capabilities indicate backend', () => {
    expect(
      isPiBackendMode({
        services: {
          pi: { mode: 'backend' },
        },
      }),
    ).toBe(true)
  })

  it('derives workspace-scoped backend url when capabilities omit pi url', () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://example.com',
        pathname: '/w/ws-live/?doc=rr-hj',
      },
    })

    try {
      expect(
        getPiServiceUrl({
          services: {
            pi: { mode: 'backend', url: '' },
          },
        }),
      ).toBe('https://example.com/w/ws-live')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })
})
