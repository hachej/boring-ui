import { describe, it, expect, afterAll } from 'vitest'
import { createApp } from '../app.js'

describe('createApp', () => {
  it('returns a Fastify instance', async () => {
    const app = createApp()
    expect(app).toBeDefined()
    expect(typeof app.listen).toBe('function')
    expect(typeof app.close).toBe('function')
    await app.close()
  })

  it('registers CORS', async () => {
    const app = createApp()
    // CORS plugin should be registered — Fastify exposes it after ready
    await app.ready()
    expect(app.hasPlugin('@fastify/cors')).toBe(true)
    await app.close()
  })
})

describe('GET /health', () => {
  it('responds with 200 and status ok', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.status).toBe('ok')
    // Python-compat: workspace and features instead of timestamp
    expect(body).toHaveProperty('workspace')
    expect(body).toHaveProperty('features')

    await app.close()
  })
})

describe('GET /api/capabilities (Python-compat)', () => {
  it('responds with 200 and legacy features', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body).toHaveProperty('version')
    // Python-compat: uses 'features' key with legacy names
    expect(body).toHaveProperty('features')
    expect(body.features).toHaveProperty('files')
    expect(body.features).toHaveProperty('git')

    await app.close()
  })
})
