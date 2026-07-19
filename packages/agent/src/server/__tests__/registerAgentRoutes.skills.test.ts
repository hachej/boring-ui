import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import Fastify from 'fastify'

import { registerAgentRoutes } from '../registerAgentRoutes'

const tempDirs: string[] = []

async function removeDirEventually(dir: string, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY') throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (lastError) throw lastError
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => removeDirEventually(dir)),
  )
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function eventually(assertion: () => Promise<void> | void, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  if (lastError) throw lastError
}

test('request-scoped skill paths isolate runtime bindings by authenticated subject', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-auth-skills-')
  const userASkills = join(workspaceRoot, 'generated-skills', 'user-a')
  const userBSkills = join(workspaceRoot, 'generated-skills', 'user-b')
  await Promise.all([
    mkdir(join(userASkills, 'only-user-a'), { recursive: true }),
    mkdir(join(userBSkills, 'only-user-b'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(userASkills, 'only-user-a', 'SKILL.md'), '---\nname: only-user-a\ndescription: User A only.\n---\n'),
    writeFile(join(userBSkills, 'only-user-b', 'SKILL.md'), '---\nname: only-user-b\ndescription: User B only.\n---\n'),
  ])
  const provisionedUsers: string[] = []
  const app = Fastify({ logger: false })

  app.addHook('onRequest', async (request) => {
    const userId = request.headers['x-test-user-id']
    if (typeof userId !== 'string') return
    ;(request as unknown as { user: { id: string; email: string; emailVerified: boolean } }).user = {
      id: userId,
      email: `${userId}@example.test`,
      emailVerified: true,
    }
  })

  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getWorkspaceId: () => 'shared-workspace',
    getWorkspaceRoot: () => workspaceRoot,
    // Presence of the access hook makes authenticated identity part of the
    // runtime-binding key. The resolver itself is exercised by provisioning.
    getSkillAccess: () => undefined,
    provisionRuntime: async ({ request }) => {
      const userId = (request as typeof request & { user?: { id?: string } } | undefined)?.user?.id
      if (!userId) throw new Error('authenticated user required')
      provisionedUsers.push(userId)
      return {
        changed: true,
        env: {},
        pathEntries: [],
        skillPaths: [userId === 'user-a' ? userASkills : userBSkills],
      }
    },
  })
  await app.ready()

  try {
    await eventually(async () => {
      const userA = await app.inject({
        method: 'GET',
        url: '/api/v1/agent/skills?refresh=1',
        headers: { 'x-test-user-id': 'user-a' },
      })
      expect(userA.statusCode).toBe(200)
      const names: string[] = userA.json().skills.map((skill: { name: string }) => skill.name)
      expect(names).toContain('only-user-a')
      expect(names).not.toContain('only-user-b')
    })
    await eventually(async () => {
      const userB = await app.inject({
        method: 'GET',
        url: '/api/v1/agent/skills?refresh=1',
        headers: { 'x-test-user-id': 'user-b' },
      })
      expect(userB.statusCode).toBe(200)
      const names: string[] = userB.json().skills.map((skill: { name: string }) => skill.name)
      expect(names).toContain('only-user-b')
      expect(names).not.toContain('only-user-a')
    })
    expect(provisionedUsers).toEqual(['user-a', 'user-b'])
  } finally {
    await app.close()
  }
})

test('runtime-provisioned skillPaths remain readonly when readonlySkillRoots is omitted', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-readonly-fallback-')
  const skillRoot = join(workspaceRoot, '.boring-agent', 'skills', 'plugin', 'legacy-provisioned')
  const skillFile = join(skillRoot, 'SKILL.md')
  await mkdir(skillRoot, { recursive: true })
  await writeFile(
    skillFile,
    '---\nname: legacy-provisioned\ndescription: Provisioner without readonly roots.\n---\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    provisionRuntime: async () => ({
      changed: false,
      env: {},
      pathEntries: [],
      skillPaths: [join(workspaceRoot, '.boring-agent', 'skills')],
    }),
  })
  await app.ready()

  try {
    await eventually(async () => {
      const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
      expect(skills.statusCode).toBe(200)
      const names: string[] = skills.json().skills.map((skill: { name: string }) => skill.name)
      expect(names).toContain('legacy-provisioned')
    })

    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: {
        path: '.boring-agent/skills/plugin/legacy-provisioned/SKILL.md',
        content: '# Mutated\n',
      },
    })
    expect(save.statusCode).toBe(403)
    await expect(readFile(skillFile, 'utf-8')).resolves.toContain('Provisioner without readonly roots.')
  } finally {
    await app.close()
  }
})

test('skills route waits for in-flight runtime provisioning before listing skills', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-provisioning-race-')
  const provisionedRoot = join(workspaceRoot, '.boring-agent', 'skills')
  await mkdir(join(provisionedRoot, 'delayed-skill'), { recursive: true })
  await writeFile(
    join(provisionedRoot, 'delayed-skill', 'SKILL.md'),
    '---\nname: delayed-skill\ndescription: Provisioned after route registration.\n---\n',
  )

  let markProvisioningStarted!: () => void
  const provisioningStarted = new Promise<void>((resolve) => {
    markProvisioningStarted = resolve
  })
  let releaseProvisioning!: () => void
  const provisioningReleased = new Promise<void>((resolve) => {
    releaseProvisioning = resolve
  })

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    provisionRuntime: async () => {
      markProvisioningStarted()
      await provisioningReleased
      return {
        changed: false,
        env: {},
        pathEntries: [],
        skillPaths: [provisionedRoot],
      }
    },
  })
  await app.ready()

  try {
    await provisioningStarted
    const skillsPromise = app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    releaseProvisioning()
    const skills = await skillsPromise
    expect(skills.statusCode).toBe(200)
    const names: string[] = skills.json().skills.map((skill: { name: string }) => skill.name)
    expect(names).toContain('delayed-skill')
  } finally {
    await app.close()
  }
})

test('non-governed runtime provisioning preserves static and hot Pi skill paths', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-provisioned-union-')
  const provisionedRoot = join(workspaceRoot, '.boring-agent', 'skills')
  const staticRoot = join(workspaceRoot, 'static-skills')
  const hotRoot = join(workspaceRoot, 'hot-skills')
  await Promise.all([
    mkdir(join(provisionedRoot, 'provisioned-skill'), { recursive: true }),
    mkdir(join(staticRoot, 'static-skill'), { recursive: true }),
    mkdir(join(hotRoot, 'hot-skill'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(provisionedRoot, 'provisioned-skill', 'SKILL.md'), '---\nname: provisioned-skill\ndescription: Provisioned.\n---\n'),
    writeFile(join(staticRoot, 'static-skill', 'SKILL.md'), '---\nname: static-skill\ndescription: Static.\n---\n'),
    writeFile(join(hotRoot, 'hot-skill', 'SKILL.md'), '---\nname: hot-skill\ndescription: Hot.\n---\n'),
  ])

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: {
      additionalSkillPaths: [staticRoot],
      getHotReloadableResources: () => ({ additionalSkillPaths: [hotRoot] }),
    },
    provisionRuntime: async () => ({
      changed: false,
      env: {},
      pathEntries: [],
      skillPaths: [provisionedRoot],
    }),
  })
  await app.ready()

  try {
    const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(skills.statusCode).toBe(200)
    const names: string[] = skills.json().skills.map((skill: { name: string }) => skill.name)
    expect(names).toContain('provisioned-skill')
    expect(names).toContain('static-skill')
    expect(names).toContain('hot-skill')
  } finally {
    await app.close()
  }
})

test('runtime-provisioned readonlySkillRoots are authoritative for .agents skills', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-readonly-explicit-agents-')
  const skillRoot = join(workspaceRoot, '.agents', 'skills', 'locked-plugin')
  const skillFile = join(skillRoot, 'SKILL.md')
  await mkdir(skillRoot, { recursive: true })
  await writeFile(
    skillFile,
    '---\nname: locked-plugin\ndescription: Explicit readonly root under .agents.\n---\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    provisionRuntime: async () => ({
      changed: false,
      env: {},
      pathEntries: [],
      skillPaths: [join(workspaceRoot, '.agents', 'skills')],
      readonlySkillRoots: [join(workspaceRoot, '.agents', 'skills', 'locked-plugin')],
    }),
  })
  await app.ready()

  try {
    const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(skills.statusCode).toBe(200)
    expect(skills.json().skills.map((skill: { name: string }) => skill.name)).toContain('locked-plugin')

    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: {
        path: '.agents/skills/locked-plugin/SKILL.md',
        content: '# Mutated\n',
      },
    })
    expect(save.statusCode).toBe(403)
    await expect(readFile(skillFile, 'utf-8')).resolves.toContain('Explicit readonly root under .agents.')
  } finally {
    await app.close()
  }
})

test('skills endpoint lists Pi-resolved project skills', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-project-')
  const projectSkillDir = join(workspaceRoot, '.pi', 'skills', 'project-skill')
  await mkdir(projectSkillDir, { recursive: true })
  await writeFile(
    join(projectSkillDir, 'SKILL.md'),
    '---\nname: project-skill\ndescription: Project skill visible through Pi resolver.\n---\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    // Skill discovery is off by default (withPiHarnessDefaults); hosts that
    // want pi-resolved skills in the picker opt in, like the CLI does.
    pi: { noSkills: false },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().skills.map((skill: { name: string }) => skill.name)
  expect(names).toContain('project-skill')

  await app.close()
})

test('skills endpoint discovers workspace .agents/skills when ambient skills are enabled', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-ambient-')
  const skillRoot = join(workspaceRoot, '.agents', 'skills', 'cli-project-skill')
  await mkdir(skillRoot, { recursive: true })
  await writeFile(
    join(skillRoot, 'SKILL.md'),
    '---\nname: cli-project-skill\ndescription: Project skill visible in standalone CLI mode.\n---\n# CLI project skill\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    // The standalone CLI's config: ambient discovery on (default is off).
    pi: { noSkills: false },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
  expect(res.statusCode).toBe(200)
  const workspaceSkill = res.json().skills.find((skill: { name: string }) => skill.name === 'cli-project-skill')
  expect(workspaceSkill).toMatchObject({
    name: 'cli-project-skill',
    filePath: '.agents/skills/cli-project-skill/SKILL.md',
  })

  const write = await app.inject({
    method: 'POST',
    url: '/api/v1/files',
    payload: {
      path: workspaceSkill.filePath,
      content: '---\nname: cli-project-skill\ndescription: Workspace edit.\n---\n',
    },
  })
  expect(write.statusCode).toBe(200)
  await expect(readFile(join(skillRoot, 'SKILL.md'), 'utf-8')).resolves.toContain('Workspace edit.')

  await app.close()
})

test('governed skill discovery only exposes provisioned skill paths', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-governed-')
  const governedSkillsRoot = join(workspaceRoot, '.boring-agent', 'skills-requests', 'request-user')
  const governedSkillRoot = join(governedSkillsRoot, 'governed-skill')
  const ambientSkillRoot = join(workspaceRoot, '.agents', 'skills', 'user-authored-skill')
  const hotSkillRoot = join(workspaceRoot, 'hot-skills', 'release-notes')
  await Promise.all([
    mkdir(governedSkillRoot, { recursive: true }),
    mkdir(ambientSkillRoot, { recursive: true }),
    mkdir(hotSkillRoot, { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(governedSkillRoot, 'SKILL.md'),
      '---\nname: governed-skill\ndescription: Request-scoped skill.\n---\n',
      'utf-8',
    ),
    writeFile(
      join(ambientSkillRoot, 'SKILL.md'),
      '---\nname: user-authored-skill\ndescription: Ambient workspace skill.\n---\n',
      'utf-8',
    ),
    writeFile(
      join(hotSkillRoot, 'SKILL.md'),
      '---\nname: release-notes\ndescription: Hot skill.\n---\n',
      'utf-8',
    ),
  ])

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    getSkillAccess: () => 'invisible',
    pi: {
      noSkills: false,
      additionalSkillPaths: ['.agents/skills'],
      getHotReloadableResources: () => ({ additionalSkillPaths: [hotSkillRoot] }),
    },
    provisionRuntime: async () => ({
      changed: true,
      env: {},
      pathEntries: [],
      skillPaths: [governedSkillsRoot],
    }),
  })
  await app.ready()

  try {
    const immediate = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(immediate.statusCode).toBe(200)
    expect(immediate.json().skills.map((skill: { name: string }) => skill.name)).not.toContain('stale-plugin-copy')

    await eventually(async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
      expect(response.statusCode).toBe(200)
      const names: string[] = response.json().skills.map((skill: { name: string }) => skill.name)
      if (
        !names.includes('governed-skill')
        || names.includes('user-authored-skill')
        || names.includes('release-notes')
      ) {
        throw new Error(`unexpected skills: ${JSON.stringify(response.json().skills)}`)
      }
    })
  } finally {
    await app.close()
  }
}, 15_000)

test('skills endpoint does not require unrelated runtime-only dynamic hooks', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-runtime-hooks-')
  const projectSkillDir = join(workspaceRoot, '.pi', 'skills', 'project-skill')
  await mkdir(projectSkillDir, { recursive: true })
  await writeFile(
    join(projectSkillDir, 'SKILL.md'),
    '---\nname: project-skill\ndescription: Project skill visible even when session namespace is unavailable.\n---\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: { noSkills: false },
    getSessionNamespace: () => {
      throw new Error('session namespace should not be needed for skill listing')
    },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().skills.map((skill: { name: string }) => skill.name)
  expect(names).toContain('project-skill')

  await app.close()
})

test('skills endpoint mirrors noSkills while preserving explicit additional skill paths', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-')
  const projectSkillDir = join(workspaceRoot, '.pi', 'skills', 'project-skill')
  const extraSkillDir = join(workspaceRoot, 'extra-skills', 'extra-skill')
  await mkdir(projectSkillDir, { recursive: true })
  await mkdir(extraSkillDir, { recursive: true })
  await writeFile(
    join(projectSkillDir, 'SKILL.md'),
    '---\nname: project-skill\ndescription: Project skill hidden by noSkills.\n---\n',
    'utf-8',
  )
  await writeFile(
    join(extraSkillDir, 'SKILL.md'),
    '---\nname: extra-skill\ndescription: Explicit extra skill remains visible.\n---\n',
    'utf-8',
  )

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: {
      noSkills: true,
      additionalSkillPaths: [extraSkillDir],
    },
  })
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
  expect(res.statusCode).toBe(200)
  const names: string[] = res.json().skills.map((skill: { name: string }) => skill.name)
  expect(names).toContain('extra-skill')
  expect(names).not.toContain('project-skill')

  await app.close()
})
