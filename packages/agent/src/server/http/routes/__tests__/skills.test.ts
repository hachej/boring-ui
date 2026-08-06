import Fastify from 'fastify'
import { describe, test, expect } from 'vitest'
import { pathForWorkspaceEditor, skillsRoutes } from '../skills'
import { createNodeWorkspace } from '@agent-test-host'

function buildApp(opts: Parameters<typeof skillsRoutes>[1]) {
  const app = Fastify({ logger: false })
  app.register(skillsRoutes, opts)
  return app.ready().then(() => app)
}

describe('pathForWorkspaceEditor', () => {
  test('uses the real root encoded by provisioned paths without rewriting global skills', () => {
    const realWorkspaceRoot = '/data/workspaces/example'
    const additionalSkillPaths = [
      `${realWorkspaceRoot}/.boring-agent/skills`,
      `${realWorkspaceRoot}/.agents/skills`,
    ]
    const localFilePath = `${realWorkspaceRoot}/.agents/skills/review/SKILL.md`
    const globalFilePath = '/home/example/.pi/agent/skills/review/SKILL.md'

    const editorPath = pathForWorkspaceEditor('/workspace', localFilePath, additionalSkillPaths)

    expect(editorPath).toBe('.agents/skills/review/SKILL.md')
    expect(editorPath.startsWith('/')).toBe(false)
    expect(editorPath.split('/')).not.toContain('..')
    expect(pathForWorkspaceEditor('/workspace', globalFilePath, additionalSkillPaths)).toBe(globalFilePath)
  })
})

describe('GET /api/v1/agents/default/skills', () => {
  test('returns skills array (possibly empty) for a workspace root', async () => {
    const app = await buildApp({ workspace: createNodeWorkspace(process.cwd()), noSkills: true })

    const res = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills' })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json().skills)).toBe(true)

    await app.close()
  })

  // Ambient-skill discovery (noSkills: false) is covered end-to-end in
  // ../../../__tests__/registerDirectAgentHostRoutes.test.ts — fs fixtures are not
  // allowed under routes/ (see scripts/check-invariants.sh).

  test('surfaces an error field instead of silently swallowing failures', async () => {
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      getWorkspace: () => {
        throw new Error('boom resolving workspace root')
      },
    })

    const res = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.skills).toEqual([])
    expect(body.error).toContain('boom resolving workspace root')

    await app.close()
  })

  test('propagates authorization denial instead of returning an empty successful result', async () => {
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      authorizeRequest: () => {
        throw Object.assign(new Error('skills access denied'), { statusCode: 403 })
      },
    })

    const res = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills' })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ message: 'skills access denied' })

    await app.close()
  })
})
