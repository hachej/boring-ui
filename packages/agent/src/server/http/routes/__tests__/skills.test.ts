import Fastify from 'fastify'
import { describe, test, expect } from 'vitest'
import { skillsRoutes } from '../skills'
import { createNodeWorkspace } from '@agent-test-host'

function buildApp(opts: Parameters<typeof skillsRoutes>[1]) {
  const app = Fastify({ logger: false })
  app.register(skillsRoutes, opts)
  return app.ready().then(() => app)
}

describe('GET /api/v1/agent/skills', () => {
  test('returns skills array (possibly empty) for a workspace root', async () => {
    const app = await buildApp({ workspace: createNodeWorkspace(process.cwd()), noSkills: true })

    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json().skills)).toBe(true)

    await app.close()
  })

  // Ambient-skill discovery (noSkills: false) is covered end-to-end in
  // ../../../__tests__/registerAgentRoutes.test.ts — fs fixtures are not
  // allowed under routes/ (see scripts/check-invariants.sh).

  test('surfaces an error field instead of silently swallowing failures', async () => {
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      getWorkspace: () => {
        throw new Error('boom resolving workspace root')
      },
    })

    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.skills).toEqual([])
    expect(body.error).toContain('boom resolving workspace root')

    await app.close()
  })
})
