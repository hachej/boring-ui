import { describe, it, expect } from 'vitest'
import { buildInviteAcceptUrl, buildResetPasswordUrl } from '../links'

describe('buildInviteAcceptUrl', () => {
  it('targets the SPA /invites/:token route on the front origin', () => {
    const config = { auth: { url: 'http://localhost:3000', frontUrl: 'http://localhost:5173' } }
    expect(buildInviteAcceptUrl(config, 'raw-token-abc')).toBe(
      'http://localhost:5173/invites/raw-token-abc',
    )
  })

  it('falls back to auth.url when frontUrl is not configured', () => {
    const config = { auth: { url: 'https://app.example.com' } }
    expect(buildInviteAcceptUrl(config, 'raw-token-abc')).toBe(
      'https://app.example.com/invites/raw-token-abc',
    )
  })

  it('strips a trailing slash from the front origin', () => {
    const config = { auth: { url: 'http://localhost:3000', frontUrl: 'http://localhost:5173/' } }
    expect(buildInviteAcceptUrl(config, 'tok')).toBe('http://localhost:5173/invites/tok')
  })

  it('URL-encodes the token', () => {
    const config = { auth: { url: 'http://localhost:3000' } }
    expect(buildInviteAcceptUrl(config, 'a b/c')).toBe(
      'http://localhost:3000/invites/a%20b%2Fc',
    )
  })
})

describe('buildResetPasswordUrl', () => {
  it('targets the SPA /auth/reset-password?token= route on the front origin', () => {
    const config = { auth: { url: 'http://localhost:3000', frontUrl: 'http://localhost:5173' } }
    expect(buildResetPasswordUrl(config, 'reset-token-xyz')).toBe(
      'http://localhost:5173/auth/reset-password?token=reset-token-xyz',
    )
  })

  it('falls back to auth.url when frontUrl is not configured', () => {
    const config = { auth: { url: 'https://app.example.com' } }
    expect(buildResetPasswordUrl(config, 'reset-token-xyz')).toBe(
      'https://app.example.com/auth/reset-password?token=reset-token-xyz',
    )
  })

  it('URL-encodes the token', () => {
    const config = { auth: { url: 'http://localhost:3000' } }
    expect(buildResetPasswordUrl(config, 'a b&c')).toBe(
      'http://localhost:3000/auth/reset-password?token=a%20b%26c',
    )
  })
})
