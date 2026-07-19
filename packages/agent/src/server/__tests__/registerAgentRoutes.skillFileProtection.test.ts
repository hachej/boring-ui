import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import Fastify from 'fastify'

import { registerAgentRoutes } from '../registerAgentRoutes'
import { ERROR_CODE_READONLY } from '../http/routes/file'

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

function expectReadonlyMutationDenied(response: { statusCode: number; json(): unknown }): void {
  expect(response.statusCode).toBe(403)
  expect(response.json()).toEqual({
    error: { code: ERROR_CODE_READONLY, message: 'skill file is readonly' },
  })
}

test('external .agents skills open readonly and reject file mutations', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-workspace-')
  const externalRoot = await makeTempDir('boring-agent-embed-skills-external-')
  const externalSkillDir = join(externalRoot, '.agents', 'skills', 'plugin-skill')
  const externalSkillFile = join(externalSkillDir, 'SKILL.md')
  const undiscoveredSkillFile = join(externalRoot, '.agents', 'skills', 'undiscovered', 'SKILL.md')
  const original = '---\nname: plugin-skill\ndescription: External plugin skill.\n---\n'
  await mkdir(externalSkillDir, { recursive: true })
  await mkdir(dirname(undiscoveredSkillFile), { recursive: true })
  await writeFile(externalSkillFile, original, 'utf-8')
  await writeFile(undiscoveredSkillFile, '# Must stay private\n', 'utf-8')

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: { noSkills: true, additionalSkillPaths: [externalSkillDir] },
  })
  await app.ready()

  try {
    const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(skills.statusCode).toBe(200)
    const externalSkill = skills.json().skills.find((skill: { name: string }) => skill.name === 'plugin-skill')
    expect(externalSkill).toMatchObject({ name: 'plugin-skill', filePath: externalSkillFile })

    const open = await app.inject({
      method: 'GET',
      url: `/api/v1/files?path=${encodeURIComponent(externalSkillFile)}`,
    })
    expect(open.statusCode).toBe(200)
    expect(open.json()).toMatchObject({ content: original, access: 'readonly' })

    const undiscovered = await app.inject({
      method: 'GET',
      url: `/api/v1/files?path=${encodeURIComponent(undiscoveredSkillFile)}`,
    })
    expect(undiscovered.statusCode).toBe(403)
    expect(undiscovered.body).not.toContain('Must stay private')

    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: externalSkillFile, content: '# Mutated\n' },
    })
    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/files?path=${encodeURIComponent(externalSkillFile)}`,
    })
    const moveFrom = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: externalSkillFile, to: 'copied-skill.md' },
    })
    const moveTo = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: 'workspace-skill.md', to: externalSkillFile },
    })
    const removeSkillDir = await app.inject({
      method: 'DELETE',
      url: `/api/v1/files?path=${encodeURIComponent(externalSkillDir)}`,
    })
    const moveSkillDir = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: externalSkillDir, to: 'copied-skill-dir' },
    })

    for (const response of [save, remove, moveFrom, moveTo, removeSkillDir, moveSkillDir]) {
      expectReadonlyMutationDenied(response)
    }
    await expect(readFile(externalSkillFile, 'utf-8')).resolves.toBe(original)
  } finally {
    await app.close()
  }
})

test('workspace-contained external .agents skills stay readonly through relative editor paths', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-workspace-contained-')
  const skillDir = join(workspaceRoot, 'vendor', '.agents', 'skills', 'plugin-skill')
  const skillFile = join(skillDir, 'SKILL.md')
  const original = '---\nname: workspace-contained-plugin-skill\ndescription: External plugin skill under workspace.\n---\n'
  await mkdir(skillDir, { recursive: true })
  await writeFile(skillFile, original, 'utf-8')

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: { noSkills: true, additionalSkillPaths: [skillDir] },
  })
  await app.ready()

  try {
    const aliasedPath = './vendor//.agents/skills/plugin-skill/SKILL.md'
    const preDiscoveryOpen = await app.inject({
      method: 'GET',
      url: `/api/v1/files?path=${encodeURIComponent(aliasedPath)}`,
    })
    expect(preDiscoveryOpen.statusCode).toBe(200)
    expect(preDiscoveryOpen.json()).toMatchObject({ access: 'readonly' })

    const preDiscoverySave = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: aliasedPath, content: '# Mutated before discovery\n' },
    })
    expectReadonlyMutationDenied(preDiscoverySave)

    const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(skills.statusCode).toBe(200)
    const pluginSkill = skills.json().skills.find((skill: { name: string }) => skill.name === 'workspace-contained-plugin-skill')
    expect(pluginSkill).toMatchObject({
      name: 'workspace-contained-plugin-skill',
      filePath: 'vendor/.agents/skills/plugin-skill/SKILL.md',
    })

    const open = await app.inject({
      method: 'GET',
      url: `/api/v1/files?path=${encodeURIComponent(pluginSkill.filePath)}`,
    })
    expect(open.statusCode).toBe(200)
    expect(open.json()).toMatchObject({ content: original, access: 'readonly' })

    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: pluginSkill.filePath, content: '# Mutated\n' },
    })
    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/files?path=${encodeURIComponent(pluginSkill.filePath)}`,
    })
    const moveFrom = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: pluginSkill.filePath, to: 'copied-skill.md' },
    })
    const moveTo = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: 'workspace-skill.md', to: pluginSkill.filePath },
    })
    const aliasedSave = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: aliasedPath, content: '# Mutated through alias\n' },
    })
    const removeAgentsDir = await app.inject({
      method: 'DELETE',
      url: `/api/v1/files?path=${encodeURIComponent('vendor/.agents')}`,
    })
    const moveAgentsDir = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: 'vendor/.agents', to: 'moved-agents' },
    })
    const uploadInside = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filename: 'image.png',
        contentBase64: 'eA==',
        contentType: 'image/png',
        directory: 'vendor/.agents/skills/plugin-skill',
      },
    })
    const removeVendorParent = await app.inject({
      method: 'DELETE',
      url: `/api/v1/files?path=${encodeURIComponent('vendor')}`,
    })
    const moveVendorParent = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: 'vendor', to: 'moved-vendor' },
    })

    for (const response of [
      preDiscoverySave,
      save,
      remove,
      moveFrom,
      moveTo,
      aliasedSave,
      removeAgentsDir,
      moveAgentsDir,
      uploadInside,
      removeVendorParent,
      moveVendorParent,
    ]) {
      expectReadonlyMutationDenied(response)
    }
    await expect(readFile(skillFile, 'utf-8')).resolves.toBe(original)
  } finally {
    await app.close()
  }
})

test('workspace plugin package skills stay readonly through package-style skills roots', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-plugin-package-')
  const skillsRoot = join(workspaceRoot, 'plugins', 'deck', 'skills')
  const skillDir = join(skillsRoot, 'deck-authoring')
  const skillFile = join(skillDir, 'SKILL.md')
  const skillPath = 'plugins/deck/skills/deck-authoring/SKILL.md'
  const original = '---\nname: deck-authoring\ndescription: Deck authoring plugin skill.\n---\n'
  await mkdir(skillDir, { recursive: true })
  await writeFile(skillFile, original, 'utf-8')

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: { noSkills: true, additionalSkillPaths: [skillsRoot] },
  })
  await app.ready()

  try {
    const preDiscoverySave = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: skillPath, content: '# Mutated before discovery\n' },
    })
    expectReadonlyMutationDenied(preDiscoverySave)

    const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(skills.statusCode).toBe(200)
    expect(skills.json().skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'deck-authoring', filePath: skillPath }),
    ]))

    const open = await app.inject({
      method: 'GET',
      url: `/api/v1/files?path=${encodeURIComponent(skillPath)}`,
    })
    expect(open.statusCode).toBe(200)
    expect(open.json()).toMatchObject({ content: original, access: 'readonly' })

    const stat = await app.inject({
      method: 'GET',
      url: `/api/v1/stat?path=${encodeURIComponent(skillPath)}`,
    })
    expect(stat.statusCode).toBe(200)
    expect(stat.json()).toMatchObject({ kind: 'file' })

    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { path: skillPath, content: '# Mutated\n' },
    })
    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/files?path=${encodeURIComponent(skillPath)}`,
    })
    const moveFrom = await app.inject({
      method: 'POST',
      url: '/api/v1/files/move',
      payload: { from: skillPath, to: 'copied-skill.md' },
    })
    const mkdirInside = await app.inject({
      method: 'POST',
      url: '/api/v1/dirs',
      payload: { path: 'plugins/deck/skills/deck-authoring/examples', recursive: true },
    })

    for (const response of [save, remove, moveFrom, mkdirInside]) {
      expectReadonlyMutationDenied(response)
    }
    await expect(readFile(skillFile, 'utf-8')).resolves.toBe(original)
  } finally {
    await app.close()
  }
})

test('workspace generated plugin skills open readonly and reject file mutations', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-embed-skills-generated-')
  const generatedSkills = [
    {
      name: 'generated-skill',
      path: '.boring-agent/skills/plugin/generated-skill/SKILL.md',
    },
    {
      name: 'request-scoped-skill',
      path: '.boring-agent/skills-requests/request-namespace/plugin/request-scoped-skill/SKILL.md',
    },
  ]
  await Promise.all(generatedSkills.map(async (skill) => {
    await mkdir(dirname(join(workspaceRoot, skill.path)), { recursive: true })
    await writeFile(
      join(workspaceRoot, skill.path),
      `---\nname: ${skill.name}\ndescription: Generated plugin skill.\n---\n`,
      'utf-8',
    )
  }))
  const generatedSupportPath = '.boring-agent/skills/plugin/generated-skill/examples/demo.md'
  await mkdir(dirname(join(workspaceRoot, generatedSupportPath)), { recursive: true })
  await writeFile(join(workspaceRoot, generatedSupportPath), '# Demo\n', 'utf-8')

  const app = Fastify({ logger: false })
  await app.register(registerAgentRoutes, {
    workspaceRoot,
    mode: 'direct',
    pi: {
      noSkills: true,
      additionalSkillPaths: generatedSkills.map((skill) => dirname(join(workspaceRoot, skill.path))),
    },
  })
  await app.ready()

  try {
    const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills?refresh=1' })
    expect(skills.statusCode).toBe(200)

    for (const generated of generatedSkills) {
      expect(skills.json().skills).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: generated.name, filePath: generated.path }),
      ]))
      const open = await app.inject({
        method: 'GET',
        url: `/api/v1/files?path=${encodeURIComponent(generated.path)}`,
      })
      expect(open.statusCode).toBe(200)
      expect(open.json()).toMatchObject({ access: 'readonly' })

      if (generated.name === 'generated-skill') {
        const openSupport = await app.inject({
          method: 'GET',
          url: `/api/v1/files?path=${encodeURIComponent(generatedSupportPath)}`,
        })
        expect(openSupport.statusCode).toBe(200)
        expect(openSupport.json()).toMatchObject({ content: '# Demo\n', access: 'readonly' })
      }

      const save = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        payload: { path: generated.path, content: '# Mutated\n' },
      })
      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/v1/files?path=${encodeURIComponent(generated.path)}`,
      })
      const moveFrom = await app.inject({
        method: 'POST',
        url: '/api/v1/files/move',
        payload: { from: generated.path, to: 'copied-skill.md' },
      })
      const moveTo = await app.inject({
        method: 'POST',
        url: '/api/v1/files/move',
        payload: { from: 'workspace-skill.md', to: generated.path },
      })
      const generatedDir = dirname(generated.path)
      const removeDir = await app.inject({
        method: 'DELETE',
        url: `/api/v1/files?path=${encodeURIComponent(generatedDir)}`,
      })
      const moveDirFrom = await app.inject({
        method: 'POST',
        url: '/api/v1/files/move',
        payload: { from: generatedDir, to: 'copied-skill' },
      })
      const moveDirTo = await app.inject({
        method: 'POST',
        url: '/api/v1/files/move',
        payload: { from: 'workspace-skill', to: generatedDir },
      })
      const mkdirInside = await app.inject({
        method: 'POST',
        url: '/api/v1/dirs',
        payload: { path: `${generatedDir}/new-dir`, recursive: true },
      })
      const uploadInside = await app.inject({
        method: 'POST',
        url: '/api/v1/files/upload',
        payload: {
          filename: 'image.png',
          contentBase64: 'eA==',
          contentType: 'image/png',
          directory: generatedDir,
        },
      })
      const aliasedSave = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        payload: { path: `./${generated.path}`, content: '# Aliased mutation\n' },
      })
      const aliasedRemoveDir = await app.inject({
        method: 'DELETE',
        url: `/api/v1/files?path=${encodeURIComponent(`./${generatedDir}`)}`,
      })
      const aliasedMoveDir = await app.inject({
        method: 'POST',
        url: '/api/v1/files/move',
        payload: {
          from: generatedDir.replace('.boring-agent/', '.boring-agent//'),
          to: 'aliased-skill',
        },
      })
      const aliasedMkdir = await app.inject({
        method: 'POST',
        url: '/api/v1/dirs',
        payload: { path: `./${generatedDir}/aliased-dir`, recursive: true },
      })

      for (const response of [
        save,
        remove,
        moveFrom,
        moveTo,
        removeDir,
        moveDirFrom,
        moveDirTo,
        mkdirInside,
        uploadInside,
        aliasedSave,
        aliasedRemoveDir,
        aliasedMoveDir,
        aliasedMkdir,
      ]) {
        expectReadonlyMutationDenied(response)
      }
      await expect(readFile(join(workspaceRoot, generated.path), 'utf-8')).resolves.toContain(`name: ${generated.name}`)
    }

    for (const container of ['.boring-agent', './.boring-agent']) {
      const removeContainer = await app.inject({
        method: 'DELETE',
        url: `/api/v1/files?path=${encodeURIComponent(container)}`,
      })
      const moveContainer = await app.inject({
        method: 'POST',
        url: '/api/v1/files/move',
        payload: { from: container, to: 'moved-boring-agent' },
      })
      for (const response of [removeContainer, moveContainer]) {
        expectReadonlyMutationDenied(response)
      }
    }
  } finally {
    await app.close()
  }
})
