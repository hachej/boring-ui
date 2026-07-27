import Fastify from 'fastify'
import { describe, test, expect } from 'vitest'
import { skillsRoutes } from '../skills'
import { createNodeWorkspace } from '@agent-test-host'
import { ErrorCode } from '../../../../shared/error-codes'
import type { RuntimeFilesystemBinding } from '../../../runtime/mode'

const skillDocument = `---
name: shared-review
description: Review readable shared context.
---

Always cite the shared policy.
`

function sharedSkillBinding(
  canReadSkill: () => boolean,
  filesystem = 'company_context',
): RuntimeFilesystemBinding {
  const readable = (path: string) => !path.startsWith('.agents/skills/shared-review') || canReadSkill()
  return {
    filesystem,
    access: 'readonly',
    operations: {
      async stat({ path }) {
        if (path === '.agents/skills' || path === '.agents/skills/shared-review') return { isDirectory: true }
        throw new Error('not found')
      },
      async list({ path }) {
        if (path === '.agents/skills') return { entries: ['shared-review'] }
        throw new Error('not found')
      },
      async read({ path }) {
        if (path === '.agents/skills/shared-review/SKILL.md' && readable(path)) return { content: skillDocument }
        throw new Error('denied')
      },
      async find() { return { paths: [] } },
      async grep() { return { matches: [] } },
      rejectMutation() { throw new Error('readonly') },
    },
  }
}

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

  test('discovers and freshly expands a skill from a readable named filesystem', async () => {
    let allowed = true
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      getFilesystemBindings: () => [sharedSkillBinding(() => allowed)],
    })

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
    expect(catalog.statusCode).toBe(200)
    expect(catalog.json().skills).toContainEqual(expect.objectContaining({
      name: 'shared-review',
      invocable: true,
      invocation: 'filesystem',
      resource: {
        filesystem: 'company_context',
        path: '.agents/skills/shared-review/SKILL.md',
      },
    }))

    const invoke = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/skills/invoke',
      payload: {
        resource: {
          filesystem: 'company_context',
          path: '.agents/skills/shared-review/SKILL.md',
        },
        args: 'Review this report.',
      },
    })
    expect(invoke.statusCode).toBe(200)
    expect(invoke.json().expandedText).toContain('Always cite the shared policy.')
    expect(invoke.json().expandedText).toContain('Review this report.')

    allowed = false
    const deniedCatalog = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(deniedCatalog.json().skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'shared-review' }),
    ]))
    const deniedInvoke = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/skills/invoke',
      payload: {
        resource: {
          filesystem: 'company_context',
          path: '.agents/skills/shared-review/SKILL.md',
        },
      },
    })
    expect(deniedInvoke.statusCode).toBe(403)

    await app.close()
  })

  test('rejects invocation when skill identity changes after winner selection', async () => {
    const binding = sharedSkillBinding(() => true)
    let reads = 0
    binding.operations.read = async () => ({
      content: skillDocument.replace('name: shared-review', `name: ${reads++ === 0 ? 'first-name' : 'changed-name'}`),
    })
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      getFilesystemBindings: () => [binding],
    })

    const invoke = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/skills/invoke',
      payload: {
        resource: {
          filesystem: 'company_context',
          path: '.agents/skills/shared-review/SKILL.md',
        },
      },
    })
    expect(invoke.statusCode).toBe(403)

    await app.close()
  })

  test('does not cache request-authorized skill metadata across binding sets', async () => {
    let bindings: RuntimeFilesystemBinding[] = [sharedSkillBinding(() => true)]
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      getFilesystemBindings: () => bindings,
    })

    const visible = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
    expect(visible.json().skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'shared-review' }),
    ]))

    bindings = []
    const hidden = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
    expect(hidden.json().skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'shared-review' }),
    ]))

    await app.close()
  })

  test('rejects direct invocation of a duplicate filesystem loser', async () => {
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      getFilesystemBindings: () => [
        sharedSkillBinding(() => true, 'alpha_context'),
        sharedSkillBinding(() => true, 'zeta_context'),
      ],
    })

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
    const duplicates = catalog.json().skills.filter((skill: { name: string }) => skill.name === 'shared-review')
    expect(duplicates).toHaveLength(2)
    expect(duplicates.map((skill: { invocable: boolean }) => skill.invocable)).toEqual([true, false])

    const invoke = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/skills/invoke',
      payload: {
        resource: {
          filesystem: 'zeta_context',
          path: '.agents/skills/shared-review/SKILL.md',
        },
      },
    })
    expect(invoke.statusCode).toBe(403)

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
    expect(body.error).toEqual({
      code: ErrorCode.enum.SKILL_DISCOVERY_FAILED,
      message: 'skill discovery failed',
    })
    expect(JSON.stringify(body)).not.toContain('boom resolving workspace root')

    await app.close()
  })
})
