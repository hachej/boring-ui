import Fastify from 'fastify'
import { describe, test, expect } from 'vitest'
import { pathForWorkspaceEditor, skillsRoutes } from '../skills'
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
  deniedPath?: string,
): RuntimeFilesystemBinding {
  const readable = (path: string) => !path.startsWith('.agents/skills/shared-review') || canReadSkill()
  return {
    filesystem,
    access: 'readonly',
    operations: {
      async resolveAccess({ filesystem, path }) {
        const read = path !== deniedPath && readable(path)
        return {
          filesystem,
          normalizedPath: path,
          access: 'readonly',
          capabilities: { read, write: false, 'create-child': false, delete: false, 'move-from': false },
        }
      },
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

describe('pathForWorkspaceEditor', () => {
  test('uses the real root encoded by provisioned paths without rewriting global skills', () => {
    const realWorkspaceRoot = '/data/workspaces/example'
    const additionalSkillPaths = [
      `${realWorkspaceRoot}/.boring-agent/skills`,
      `${realWorkspaceRoot}/.agents/skills`,
    ]
    const localFilePath = `${realWorkspaceRoot}/.agents/skills/review/SKILL.md`
    const globalFilePath = '/home/example/.pi/agent/skills/review/SKILL.md'

    const editorPath = pathForWorkspaceEditor({ root: '/workspace' }, localFilePath, additionalSkillPaths)

    expect(editorPath).toBe('.agents/skills/review/SKILL.md')
    expect(editorPath.startsWith('/')).toBe(false)
    expect(editorPath.split('/')).not.toContain('..')
    expect(pathForWorkspaceEditor({ root: '/workspace' }, globalFilePath, additionalSkillPaths)).toBe(globalFilePath)
  })

  test('tries the real provisioned root when a virtual root appears first', () => {
    const realWorkspaceRoot = '/data/workspaces/example'
    const localFilePath = `${realWorkspaceRoot}/.agents/skills/review/SKILL.md`
    const additionalSkillPaths = [
      '/workspace/.agents/skills',
      `${realWorkspaceRoot}/.agents/skills`,
    ]

    expect(pathForWorkspaceEditor({ root: '/workspace' }, localFilePath, additionalSkillPaths))
      .toBe('.agents/skills/review/SKILL.md')
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

  test('discovers a skill only while its named filesystem is readable', async () => {
    let allowed = true
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      getFilesystemBindings: () => [sharedSkillBinding(() => allowed)],
    })

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills' })
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

    allowed = false
    const deniedCatalog = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills?refresh=1' })
    expect(deniedCatalog.json().skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'shared-review' }),
    ]))
    await app.close()
  })

  test.each([
    '.agents/skills',
    '.agents/skills/shared-review',
    '.agents/skills/shared-review/SKILL.md',
  ])('hides a skill when read is denied at %s', async (deniedPath) => {
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      getFilesystemBindings: () => [sharedSkillBinding(() => true, 'company_context', deniedPath)],
    })
    const catalog = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills' })
    expect(catalog.json().skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'shared-review' }),
    ]))
    await app.close()
  })

  test('does not cache request-authorized skill metadata across binding sets', async () => {
    let bindings: RuntimeFilesystemBinding[] = [sharedSkillBinding(() => true)]
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      getFilesystemBindings: () => bindings,
    })

    const visible = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills' })
    expect(visible.json().skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'shared-review' }),
    ]))

    bindings = []
    const hidden = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills' })
    expect(hidden.json().skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'shared-review' }),
    ]))

    await app.close()
  })

  test('marks only the first duplicate filesystem skill invocable', async () => {
    const app = await buildApp({
      workspace: createNodeWorkspace(process.cwd()),
      noSkills: true,
      getFilesystemBindings: () => [
        sharedSkillBinding(() => true, 'alpha_context'),
        sharedSkillBinding(() => true, 'zeta_context'),
      ],
    })

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/agents/default/skills' })
    const duplicates = catalog.json().skills.filter((skill: { name: string }) => skill.name === 'shared-review')
    expect(duplicates).toHaveLength(2)
    expect(duplicates.map((skill: { invocable: boolean }) => skill.invocable)).toEqual([true, false])

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
    expect(body.error).toEqual({
      code: ErrorCode.enum.SKILL_DISCOVERY_FAILED,
      message: 'skill discovery failed',
    })
    expect(JSON.stringify(body)).not.toContain('boom resolving workspace root')

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
