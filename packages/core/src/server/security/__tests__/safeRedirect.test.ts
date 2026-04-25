import { describe, it, expect } from 'vitest'
import { safeRedirect } from '../safeRedirect'
import type { CoreConfig } from '../../../shared/types'

const config = {
  cors: {
    origins: ['https://app.example.com', 'https://admin.example.com'],
    credentials: true as const,
  },
} as CoreConfig

describe('safeRedirect', () => {
  describe('relative paths', () => {
    it('accepts simple relative path', () => {
      expect(safeRedirect('/dashboard', config)).toBe('/dashboard')
    })

    it('accepts relative path with query string', () => {
      expect(safeRedirect('/workspace/123?tab=files', config)).toBe(
        '/workspace/123?tab=files',
      )
    })

    it('accepts root path', () => {
      expect(safeRedirect('/', config)).toBe('/')
    })
  })

  describe('absolute URLs on allowlist', () => {
    it('accepts URL whose origin is in cors.origins', () => {
      expect(
        safeRedirect('https://app.example.com/dashboard', config),
      ).toBe('https://app.example.com/dashboard')
    })

    it('accepts second allowlisted origin', () => {
      expect(
        safeRedirect('https://admin.example.com/settings', config),
      ).toBe('https://admin.example.com/settings')
    })

    it('accepts allowlisted origin with trailing slash in config', () => {
      const configWithSlash = {
        cors: {
          origins: ['https://app.example.com/'],
          credentials: true as const,
        },
      } as CoreConfig

      expect(
        safeRedirect('https://app.example.com/foo', configWithSlash),
      ).toBe('https://app.example.com/foo')
    })
  })

  describe('rejection: off-allowlist hosts', () => {
    it('rejects absolute URL with non-allowlisted origin', () => {
      expect(safeRedirect('https://evil.com/steal', config)).toBe('/')
    })

    it('rejects URL that looks similar but differs', () => {
      expect(
        safeRedirect('https://app.example.com.evil.com/steal', config),
      ).toBe('/')
    })

    it('rejects different port on same host', () => {
      expect(
        safeRedirect('https://app.example.com:8443/foo', config),
      ).toBe('/')
    })
  })

  describe('rejection: CRLF injection chars', () => {
    it('rejects null byte', () => {
      expect(safeRedirect('/foo\0bar', config)).toBe('/')
    })

    it('rejects carriage return', () => {
      expect(safeRedirect('/foo\rbar', config)).toBe('/')
    })

    it('rejects newline', () => {
      expect(safeRedirect('/foo\nbar', config)).toBe('/')
    })

    it('rejects angle brackets', () => {
      expect(safeRedirect('/foo<script>', config)).toBe('/')
    })

    it('rejects double quotes', () => {
      expect(safeRedirect('/foo"bar', config)).toBe('/')
    })

    it('rejects single quotes', () => {
      expect(safeRedirect("/foo'bar", config)).toBe('/')
    })

    it('rejects backtick', () => {
      expect(safeRedirect('/foo`bar', config)).toBe('/')
    })
  })

  describe('rejection: dangerous schemes', () => {
    it('rejects javascript: URL', () => {
      expect(safeRedirect('javascript:alert(1)', config)).toBe('/')
    })

    it('rejects data: URL', () => {
      expect(safeRedirect('data:text/html,<h1>xss</h1>', config)).toBe('/')
    })
  })

  describe('edge cases', () => {
    it('returns / for empty string', () => {
      expect(safeRedirect('', config)).toBe('/')
    })

    it('returns / for whitespace-only', () => {
      expect(safeRedirect('   ', config)).toBe('/')
    })

    it('rejects protocol-relative URL (//evil.com)', () => {
      expect(safeRedirect('//evil.com/steal', config)).toBe('/')
    })

    it('returns / for null input', () => {
      expect(safeRedirect(null as unknown as string, config)).toBe('/')
    })

    it('returns / for non-string input', () => {
      expect(safeRedirect(42 as unknown as string, config)).toBe('/')
    })

    it('rejects malformed URL', () => {
      expect(safeRedirect('ht tp://bad url', config)).toBe('/')
    })
  })
})
