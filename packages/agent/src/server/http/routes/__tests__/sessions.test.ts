import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test } from 'vitest'
import { ERROR_CODE_NOT_FOUND, ERROR_CODE_VALIDATION_ERROR } from '../../middleware'
import { sessionRoutes } from '../sessions'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()))
})

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(sessionRoutes, {})
  await app.ready()
  apps.push(app)
  return app
}

describe('session routes', () => {
  test('CRUD roundtrip and delete twice semantics', async () => {
    const app = await buildApp()

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/sessions',
      payload: { title: 'Session A' },
    })
    expect(createRes.statusCode).toBe(200)
    const created = createRes.json()
    expect(created).toEqual({
      id: expect.any(String),
      title: 'Session A',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      turnCount: 0,
    })

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions',
    })
    expect(listRes.statusCode).toBe(200)
    expect(listRes.json()).toEqual([created])

    const loadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/sessions/${created.id}`,
    })
    expect(loadRes.statusCode).toBe(200)
    expect(loadRes.json()).toEqual({
      ...created,
      messages: [],
    })

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agent/sessions/${created.id}`,
    })
    expect(deleteRes.statusCode).toBe(204)
    expect(deleteRes.body).toBe('')

    const deleteAgainRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agent/sessions/${created.id}`,
    })
    expect(deleteAgainRes.statusCode).toBe(404)
    expect(deleteAgainRes.json()).toEqual({
      error: {
        code: ERROR_CODE_NOT_FOUND,
        message: 'session not found',
      },
    })
  })

  test('create defaults to New session title when no title is provided', async () => {
    const app = await buildApp()

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/sessions',
      payload: {},
    })
    expect(createRes.statusCode).toBe(200)
    expect(createRes.json().title).toBe('New session')
  })

  test('returns 400 for invalid session id params', async () => {
    const app = await buildApp()

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/sessions/',
    })

    expect(getRes.statusCode).toBe(400)

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/sessions',
      payload: { title: '' },
    })
    expect(createRes.statusCode).toBe(400)
    expect(createRes.json().error.code).toBe(ERROR_CODE_VALIDATION_ERROR)
    expect(createRes.json().error.field).toBe('title')
  })
})
