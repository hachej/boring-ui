import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createSessionCookie } from '../auth/session.js'
import { loadConfig } from '../config.js'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long-for-hs256'

function getApp() {
  return createApp({ config: { ...loadConfig(), sessionSecret: TEST_SECRET } })
}

async function getToken() {
  return createSessionCookie('user-123', 'alice@example.com', TEST_SECRET, {
    ttlSeconds: 3600,
  })
}

describe('GET /api/v1/me', () => {
  it('returns 401 without session', async () => {
    const app = getApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns user info with valid session', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.user.id).toBe('user-123')
    expect(body.user.email).toBe('alice@example.com')
    await app.close()
  })
})

describe('GET /api/v1/me/settings', () => {
  it('returns 401 without session', async () => {
    const app = getApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/me/settings' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns settings with valid session', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/settings',
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body).toHaveProperty('settings')
    await app.close()
  })
})

describe('PUT /api/v1/me/settings', () => {
  it('updates settings with valid session', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/settings',
      cookies: { boring_session: token },
      payload: { theme: 'dark', fontSize: 14 },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.settings.theme).toBe('dark')
    await app.close()
  })
})
