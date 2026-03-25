import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createSessionCookie } from '../auth/session.js'
import { loadConfig } from '../config.js'
import { isGitHubConfigured, buildOAuthUrl, buildGitCredentials } from '../services/githubImpl.js'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long-for-hs256'

function getApp() {
  return createApp({ config: { ...loadConfig(), sessionSecret: TEST_SECRET } })
}

async function getToken() {
  return createSessionCookie('user-123', 'alice@example.com', TEST_SECRET, { ttlSeconds: 3600 })
}

describe('GitHub service', () => {
  it('isGitHubConfigured returns false without config', () => {
    const config = loadConfig()
    expect(isGitHubConfigured(config)).toBe(false)
  })

  it('buildOAuthUrl constructs correct URL', () => {
    const url = buildOAuthUrl('client-123', 'https://example.com/callback', 'state-abc')
    expect(url).toContain('github.com/login/oauth/authorize')
    expect(url).toContain('client_id=client-123')
    expect(url).toContain('state=state-abc')
  })

  it('buildGitCredentials returns x-access-token format', () => {
    const creds = buildGitCredentials('ghs_test_token')
    expect(creds.username).toBe('x-access-token')
    expect(creds.password).toBe('ghs_test_token')
  })
})

describe('GitHub HTTP routes', () => {
  it('GET /github/status returns configured state', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/github/status',
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body).toHaveProperty('configured')
    await app.close()
  })

  it('GET /github/status requires auth', async () => {
    const app = getApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/github/status' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
