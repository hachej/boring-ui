import Fastify from 'fastify'
import { describe, expect, test, vi } from 'vitest'
import { ReadyStatusTracker } from '../../../sandbox/vercel-sandbox/readyStatus'
import { readyStatusRoutes } from '../readyStatus'

async function buildApp(tracker: ReadyStatusTracker) {
  const app = Fastify({ logger: false })
  app.register(readyStatusRoutes, { tracker })
  await app.ready()
  return app
}

describe('GET /api/v1/ready-status', () => {
  test('resolves tracker per request when registered dynamically', async () => {
    const tracker = new ReadyStatusTracker({ sandboxReady: true, harnessReady: true })
    const getTracker = vi.fn(async () => tracker)
    const app = Fastify({ logger: false })
    app.register(readyStatusRoutes, { getTracker })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/v1/ready-status' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('"state":"ready"')
    expect(getTracker).toHaveBeenCalledOnce()
    await app.close()
  })

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

  test('includes backward-compatible capability readiness details through runtime completion', async () => {
    const tracker = new ReadyStatusTracker({
      sandboxReady: true,
      harnessReady: true,
      capabilities: {
        chat: { state: 'ready' },
        workspace: { state: 'ready' },
        runtimeDependencies: {
          state: 'preparing',
          requirement: 'runtime:python',
          startedAt: '2026-06-02T00:00:00.000Z',
        },
      },
    })
    const app = await buildApp(tracker)
    setTimeout(() => tracker.updateRuntimeDependencies({
      state: 'ready',
      requirement: 'runtime:python',
      completedAt: '2026-06-02T00:00:01.000Z',
    }), 0)

    const res = await app.inject({ method: 'GET', url: '/api/v1/ready-status' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('"sandboxReady":true')
    expect(res.body).toContain('"harnessReady":true')
    expect(res.body).toContain('"runtimeDependencies":{"state":"preparing"')
    expect(res.body).toContain('"runtimeDependencies":{"state":"ready"')
    expect(res.body).toContain('"requirement":"runtime:python"')
    await app.close()
  })
})
