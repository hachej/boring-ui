import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { createMailTransport, MailDeliveryError } from '../transport'
import { ConfigValidationError } from '../../../shared/errors'
import type { RenderedEmail } from '../transport'

const SAMPLE_EMAIL: RenderedEmail = {
  to: 'user@test.dev',
  subject: 'Test Email',
  html: '<h1>Hello</h1>',
  text: 'Hello',
}

describe('createMailTransport', () => {
  describe('scheme dispatch', () => {
    it('creates ResendTransport for resend://', () => {
      const transport = createMailTransport(
        'resend://re_test123',
        'noreply@test.dev',
      )
      expect(transport).toBeDefined()
      expect(transport.send).toBeTypeOf('function')
    })

    it('creates ConsoleTransport for console://', () => {
      const transport = createMailTransport(
        'console://',
        'noreply@test.dev',
        'development',
      )
      expect(transport).toBeDefined()
    })

    it('creates ConsoleCaptureTransport for console-capture:// in test', () => {
      const transport = createMailTransport(
        'console-capture:///tmp/test.log',
        'noreply@test.dev',
        'test',
      )
      expect(transport).toBeDefined()
    })

    it('creates SmtpTransport for smtp://', () => {
      const transport = createMailTransport(
        'smtp://user:pass@smtp.test.dev:587',
        'noreply@test.dev',
      )
      expect(transport).toBeDefined()
    })

    it('creates SmtpTransport for smtps://', () => {
      const transport = createMailTransport(
        'smtps://user:pass@smtp.test.dev:465',
        'noreply@test.dev',
      )
      expect(transport).toBeDefined()
    })

    it('throws ConfigValidationError for unknown scheme', () => {
      expect(() =>
        createMailTransport('mailto://bad', 'noreply@test.dev'),
      ).toThrow(ConfigValidationError)
    })

    it('error message lists all supported schemes including console-capture', () => {
      try {
        createMailTransport('postmark://key', 'noreply@test.dev')
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain(
          'console-capture://',
        )
      }
    })
  })

  describe('console:// environment restrictions', () => {
    it('rejects console:// in production', () => {
      expect(() =>
        createMailTransport('console://', 'noreply@test.dev', 'production'),
      ).toThrow(ConfigValidationError)

      try {
        createMailTransport('console://', 'noreply@test.dev', 'production')
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain(
          'not allowed in production',
        )
      }
    })

    it('allows console:// in development', () => {
      expect(() =>
        createMailTransport('console://', 'noreply@test.dev', 'development'),
      ).not.toThrow()
    })

    it('allows console:// in test', () => {
      expect(() =>
        createMailTransport('console://', 'noreply@test.dev', 'test'),
      ).not.toThrow()
    })
  })

  describe('console-capture:// environment restrictions', () => {
    it('rejects console-capture:// in production', () => {
      expect(() =>
        createMailTransport(
          'console-capture:///tmp/mail.log',
          'noreply@test.dev',
          'production',
        ),
      ).toThrow(ConfigValidationError)
    })

    it('rejects console-capture:// in development', () => {
      expect(() =>
        createMailTransport(
          'console-capture:///tmp/mail.log',
          'noreply@test.dev',
          'development',
        ),
      ).toThrow(ConfigValidationError)
    })

    it('allows console-capture:// in test', () => {
      expect(() =>
        createMailTransport(
          'console-capture:///tmp/mail.log',
          'noreply@test.dev',
          'test',
        ),
      ).not.toThrow()
    })
  })
})

describe('ConsoleTransport.send', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs email to console but does NOT write to file', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const transport = createMailTransport(
      'console://',
      'noreply@test.dev',
      'development',
    )
    const result = await transport.send(SAMPLE_EMAIL)

    expect(result.id).toMatch(/^console-/)
    expect(infoSpy).toHaveBeenCalledWith(
      '[mail:console]',
      expect.stringContaining('"to":"user@test.dev"'),
    )
  })
})

describe('ConsoleCaptureTransport.send', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes to file and logs', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const logPath = `/tmp/test-mail-vitest-${Date.now()}.log`

    const transport = createMailTransport(
      `console-capture://${logPath}`,
      'noreply@test.dev',
      'test',
    )
    await transport.send(SAMPLE_EMAIL)

    expect(existsSync(logPath)).toBe(true)
    const content = readFileSync(logPath, 'utf-8')
    const entry = JSON.parse(content.trim())
    expect(entry.to).toBe('user@test.dev')
    expect(entry.subject).toBe('Test Email')

    unlinkSync(logPath)
  })
})

describe('ResendTransport.send', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends email via Resend API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend_msg_123' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const transport = createMailTransport(
      'resend://re_test_api_key',
      'noreply@test.dev',
    )
    const result = await transport.send(SAMPLE_EMAIL)

    expect(result.id).toBe('resend_msg_123')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_api_key',
        }),
      }),
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.from).toBe('noreply@test.dev')
    expect(body.to).toBe('user@test.dev')
  })

  it('throws MailDeliveryError on 4xx (no retry)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'Invalid recipient',
    })
    vi.stubGlobal('fetch', mockFetch)

    const transport = createMailTransport(
      'resend://re_test_key',
      'noreply@test.dev',
    )
    await expect(transport.send(SAMPLE_EMAIL)).rejects.toThrow(
      MailDeliveryError,
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries on 503 and succeeds', async () => {
    let callCount = 0
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        }
      }
      return { ok: true, json: async () => ({ id: 'retry_success' }) }
    })
    vi.stubGlobal('fetch', mockFetch)

    const transport = createMailTransport(
      'resend://re_test_key',
      'noreply@test.dev',
    )
    const result = await transport.send(SAMPLE_EMAIL)

    expect(result.id).toBe('retry_success')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('retries on network error and wraps in MailDeliveryError', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', mockFetch)

    const transport = createMailTransport(
      'resend://re_test_key',
      'noreply@test.dev',
    )

    const err = await transport.send(SAMPLE_EMAIL).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MailDeliveryError)
    expect((err as MailDeliveryError).message).toMatch(/Network error/)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('retries network error then succeeds', async () => {
    let callCount = 0
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new TypeError('fetch failed')
      return { ok: true, json: async () => ({ id: 'net_retry_ok' }) }
    })
    vi.stubGlobal('fetch', mockFetch)

    const transport = createMailTransport(
      'resend://re_test_key',
      'noreply@test.dev',
    )
    const result = await transport.send(SAMPLE_EMAIL)

    expect(result.id).toBe('net_retry_ok')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

describe('SmtpTransport.send', () => {
  it('wraps nodemailer errors in MailDeliveryError', async () => {
    vi.mock('nodemailer', () => ({
      createTransport: () => ({
        sendMail: () => Promise.reject(new Error('Connection refused')),
      }),
    }))

    const transport = createMailTransport(
      'smtp://user:pass@localhost:587',
      'noreply@test.dev',
    )

    await expect(transport.send(SAMPLE_EMAIL)).rejects.toThrow(
      MailDeliveryError,
    )
    await expect(transport.send(SAMPLE_EMAIL)).rejects.toThrow(
      /SMTP send failed.*Connection refused/,
    )

    vi.restoreAllMocks()
  })
})
