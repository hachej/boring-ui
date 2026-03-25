import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { redactSecrets, PINO_REDACT_PATHS } from '../middleware/secretRedaction.js'

describe('Request ID middleware', () => {
  it('registerRequestIdHook is a function', async () => {
    const { registerRequestIdHook } = await import('../middleware/requestId.js')
    expect(typeof registerRequestIdHook).toBe('function')
  })

  it('healthz includes request_id in response body', async () => {
    const app = createApp()
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'test-req-123' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.request_id).toBe('test-req-123')
    await app.close()
  })
})

describe('Secret redaction', () => {
  it('redacts database URLs', () => {
    const input = 'postgres://user:pass@host:5432/db'
    const result = redactSecrets(input)
    expect(result).not.toContain('pass')
  })

  it('redacts session cookies', () => {
    const input = 'boring_session=eyJhbGciOi...'
    const result = redactSecrets(input)
    expect(result).not.toContain('eyJhbGciOi')
  })

  it('preserves non-sensitive strings', () => {
    const input = 'Hello world'
    expect(redactSecrets(input)).toBe('Hello world')
  })

  it('passes through non-strings', () => {
    expect(redactSecrets(42)).toBe(42)
    expect(redactSecrets(null)).toBe(null)
  })
})

describe('PINO_REDACT_PATHS', () => {
  it('includes cookie header', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.cookie')
  })

  it('includes authorization header', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.authorization')
  })
})
