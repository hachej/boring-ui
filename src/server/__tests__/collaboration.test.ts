import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createSessionCookie } from '../auth/session.js'
import { loadConfig } from '../config.js'

const TEST_SECRET = 'test-secret-must-be-at-least-32-characters-long-for-hs256'
const WS_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '00000000-0000-0000-0000-000000000002'

function getApp() {
  return createApp({ config: { ...loadConfig(), sessionSecret: TEST_SECRET } })
}

async function getToken() {
  return createSessionCookie('user-123', 'alice@example.com', TEST_SECRET, { ttlSeconds: 3600 })
}

describe('Collaboration routes', () => {
  it('GET /workspaces/:id/members requires auth', async () => {
    const app = getApp()
    const res = await app.inject({ method: 'GET', url: `/api/v1/workspaces/${WS_ID}/members` })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /workspaces/:id/members returns members list', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${WS_ID}/members`,
      cookies: { boring_session: token },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body).toHaveProperty('members')
    await app.close()
  })

  it('POST /workspaces/:id/members validates role', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WS_ID}/members`,
      cookies: { boring_session: token },
      payload: { user_id: USER_ID, role: 'superadmin' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('POST /workspaces/:id/invites validates email', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WS_ID}/invites`,
      cookies: { boring_session: token },
      payload: { email: 'not-an-email' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('POST /workspaces/:id/invites creates invite', async () => {
    const app = getApp()
    const token = await getToken()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${WS_ID}/invites`,
      cookies: { boring_session: token },
      payload: { email: 'bob@example.com', role: 'editor' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.invite.email).toBe('bob@example.com')
    await app.close()
  })
})
