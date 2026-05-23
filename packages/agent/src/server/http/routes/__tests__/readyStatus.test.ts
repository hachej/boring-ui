import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'
import { ReadyStatusTracker } from '../../../sandbox/vercel-sandbox/readyStatus'
import { readyStatusRoutes } from '../readyStatus'

async function buildApp(tracker: ReadyStatusTracker) {
  const app = Fastify({ logger: false })
  app.register(readyStatusRoutes, { tracker })
  await app.ready()
  return app
}

describe('GET /api/v1/ready-status', () => {
  test('closes the stream after degraded status so clients can fail warmup', async () => {
    const tracker = new ReadyStatusTracker({ sandboxReady: true, harnessReady: true })
    tracker.markDegraded('runtime failed')
    const app = await buildApp(tracker)

    const res = await app.inject({ method: 'GET', url: '/api/v1/ready-status' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('"state":"degraded"')
    expect(res.body).toContain('runtime failed')
    await app.close()
  })
})
