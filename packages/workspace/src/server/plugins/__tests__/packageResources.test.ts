import { afterEach, describe, expect, test } from 'vitest'
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { AGENT_RESOURCES_FILESYSTEM_ID } from '@hachej/boring-agent/shared'

import {
  PACKAGE_RESOURCE_CONFLICT_CODE,
  PACKAGE_RESOURCE_INVALID_CODE,
  resolveWorkspacePackageResources,
} from '../packageResources'

const roots: string[] = []

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'boring-package-resources-'))
  roots.push(root)
  return root
}

async function packageFixture(
  root: string,
  input: { name?: string; skills?: string[] } = {},
) {
  const packageRoot = join(root, 'package')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: input.name ?? '@example/plugin',
    pi: { skills: input.skills ?? ['skills/authoring'] },
  }), 'utf8')
  await mkdir(join(packageRoot, 'skills', 'authoring', 'references'), { recursive: true })
  await writeFile(join(packageRoot, 'skills', 'authoring', 'SKILL.md'), [
    '---',
    'name: example-authoring',
    'description: Example authoring skill.',
    '---',
    '# Skill',
  ].join('\n'), 'utf8')
  await writeFile(join(packageRoot, 'skills', 'authoring', 'references', 'guide.md'), 'SAFE_GUIDE', 'utf8')
  await writeFile(join(packageRoot, 'settings.json'), 'MODEL_SECRET_SENTINEL', 'utf8')
  await mkdir(join(packageRoot, 'skills', 'sibling'), { recursive: true })
  await writeFile(join(packageRoot, 'skills', 'sibling', 'hidden.md'), 'HIDDEN_SIBLING', 'utf8')
  return packageRoot
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveWorkspacePackageResources', () => {
  test('deduplicates direct/scanned provenance and keeps Pi paths separate from confined mounts', async () => {
    const root = await tempRoot()
    const packageRoot = await packageFixture(root)
    const registry = await resolveWorkspacePackageResources([
      { pluginId: 'direct', packageName: '@example/plugin', packageRoot },
      { pluginId: 'scanned', packageName: '@example/plugin', packageRoot: new URL(`file://${packageRoot}/`) },
    ])

    expect(registry.skills).toHaveLength(1)
    expect(registry.skills[0]).toMatchObject({
      packageName: '@example/plugin',
      pluginIds: ['direct', 'scanned'],
      name: 'example-authoring',
      description: 'Example authoring skill.',
      resource: {
        filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
        path: 'packages/@example/plugin/skills/authoring/SKILL.md',
      },
    })
    expect(registry.additionalSkillPaths).toEqual([registry.skills[0].mountRoot])
    expect(registry.readonlyMounts).toEqual([{
      logicalRoot: 'packages/@example/plugin/skills/authoring',
      sourceRoot: registry.skills[0].mountRoot,
    }])
    expect(registry.locateSkill(registry.skills[0].skillFile)).toEqual(registry.skills[0].resource)
    expect(registry.locateSkill(join(packageRoot, 'settings.json'))).toBeUndefined()
    expect(registry.generation).toMatch(/^[a-f0-9]{64}$/)

    const repeated = await resolveWorkspacePackageResources([
      { pluginId: 'scanned', packageName: '@example/plugin', packageRoot },
      { pluginId: 'direct', packageName: '@example/plugin', packageRoot },
    ])
    expect(repeated.generation).toBe(registry.generation)
  })

  test('normalizes direct SKILL.md declarations to the same locator and mount', async () => {
    const root = await tempRoot()
    const packageRoot = await packageFixture(root, { skills: ['skills/authoring/SKILL.md'] })
    const registry = await resolveWorkspacePackageResources([
      { pluginId: 'direct', packageName: '@example/plugin', packageRoot },
    ])
    expect(registry.skills[0].resource.path).toBe('packages/@example/plugin/skills/authoring/SKILL.md')
    expect(registry.readonlyMounts[0].logicalRoot).toBe('packages/@example/plugin/skills/authoring')
  })

  test('accepts a real pnpm-linked package without widening its admitted skill root', async () => {
    const linkedRoot = resolve(process.cwd(), '../../node_modules/@hachej/boring-bi-dashboard')
    expect((await lstat(linkedRoot)).isSymbolicLink()).toBe(true)
    const canonicalRoot = await realpath(linkedRoot)

    const registry = await resolveWorkspacePackageResources([{
      pluginId: 'bi-dashboard',
      packageName: '@hachej/boring-bi-dashboard',
      packageRoot: linkedRoot,
    }])

    expect(registry.skills).toHaveLength(1)
    expect(registry.skills[0].mountRoot.startsWith(`${canonicalRoot}/`)).toBe(true)
    expect(registry.skills[0].mountRoot).not.toBe(canonicalRoot)
  })

  test('accepts package-manager and skill symlinks only when canonical targets stay confined', async () => {
    const root = await tempRoot()
    const packageRoot = await packageFixture(root)
    const linkedRoot = join(root, 'node_modules-link')
    await symlink(packageRoot, linkedRoot, 'dir')
    const safeTarget = join(packageRoot, 'skills', 'authoring', 'references', 'guide.md')
    await symlink(safeTarget, join(packageRoot, 'skills', 'authoring', 'guide-link.md'))

    const registry = await resolveWorkspacePackageResources([
      { pluginId: 'linked', packageName: '@example/plugin', packageRoot: linkedRoot },
    ])
    expect(registry.skills[0].mountRoot).toBe(join(packageRoot, 'skills', 'authoring'))
    expect(registry.locateSkill(registry.skills[0].skillFile))
      .toEqual(registry.skills[0].resource)
  })

  test('rejects a package-root SKILL.md declaration instead of mounting the package root', async () => {
    const root = await tempRoot()
    const packageRoot = await packageFixture(root, { skills: ['SKILL.md'] })
    await writeFile(join(packageRoot, 'SKILL.md'), '# Root skill', 'utf8')

    await expect(resolveWorkspacePackageResources([{
      pluginId: 'root-skill',
      packageName: '@example/plugin',
      packageRoot,
    }])).rejects.toMatchObject({ code: PACKAGE_RESOURCE_INVALID_CODE })
  })

  test('maps malformed package manifests to the stable registry error', async () => {
    const root = await tempRoot()
    const packageRoot = await packageFixture(root)
    await writeFile(join(packageRoot, 'package.json'), '{not-json', 'utf8')

    await expect(resolveWorkspacePackageResources([{
      pluginId: 'malformed',
      packageName: '@example/plugin',
      packageRoot,
    }])).rejects.toMatchObject({ code: PACKAGE_RESOURCE_INVALID_CODE })
  })

  test('rejects manifest mismatch, conflicts, traversal, missing declarations, and escaping symlinks without host paths', async () => {
    const root = await tempRoot()
    const packageRoot = await packageFixture(root)
    const otherRoot = await packageFixture(join(root, 'other'))

    await expect(resolveWorkspacePackageResources([
      { pluginId: 'a', packageName: '@example/plugin', packageRoot },
      { pluginId: 'b', packageName: '@example/plugin', packageRoot: otherRoot },
    ])).rejects.toMatchObject({ code: PACKAGE_RESOURCE_CONFLICT_CODE })

    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@wrong/name', pi: { skills: ['skills/authoring'] },
    }), 'utf8')
    await expect(resolveWorkspacePackageResources([
      { pluginId: 'a', packageName: '@example/plugin', packageRoot },
    ])).rejects.toMatchObject({ code: PACKAGE_RESOURCE_INVALID_CODE })

    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@example/plugin', pi: { skills: ['../outside'] },
    }), 'utf8')
    const traversal = await resolveWorkspacePackageResources([
      { pluginId: 'a', packageName: '@example/plugin', packageRoot },
    ]).catch((error) => error)
    expect(traversal).toMatchObject({ code: PACKAGE_RESOURCE_INVALID_CODE })
    expect(JSON.stringify(traversal)).not.toContain(root)

    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@example/plugin', pi: { skills: ['skills/missing'] },
    }), 'utf8')
    await expect(resolveWorkspacePackageResources([
      { pluginId: 'a', packageName: '@example/plugin', packageRoot },
    ])).rejects.toMatchObject({ code: PACKAGE_RESOURCE_INVALID_CODE })

    const outside = join(root, 'outside-skill')
    await mkdir(outside)
    await writeFile(join(outside, 'SKILL.md'), '# Outside', 'utf8')
    const escapingRoot = join(packageRoot, 'skills', 'escaping')
    await symlink(outside, escapingRoot, 'dir')
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@example/plugin', pi: { skills: ['skills/escaping'] },
    }), 'utf8')
    await expect(resolveWorkspacePackageResources([
      { pluginId: 'a', packageName: '@example/plugin', packageRoot },
    ])).rejects.toMatchObject({ code: PACKAGE_RESOURCE_INVALID_CODE })

    const targetDir = join(packageRoot, 'skills', 'target')
    const linkedDir = join(packageRoot, 'skills', 'file-link')
    await mkdir(targetDir)
    await mkdir(linkedDir)
    await writeFile(join(targetDir, 'SKILL.md'), '# Target', 'utf8')
    await symlink(join(targetDir, 'SKILL.md'), join(linkedDir, 'SKILL.md'))
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@example/plugin', pi: { skills: ['skills/file-link'] },
    }), 'utf8')
    await expect(resolveWorkspacePackageResources([
      { pluginId: 'a', packageName: '@example/plugin', packageRoot },
    ])).rejects.toMatchObject({ code: PACKAGE_RESOURCE_INVALID_CODE })
  })

  test('adds enumerated shared skills and deduplicates exact manifest prompts', async () => {
    const root = await tempRoot()
    const packageRoot = await packageFixture(root)
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@example/plugin',
      pi: { skills: ['skills/authoring'], systemPrompt: '  Use authoring.  ' },
    }), 'utf8')
    const sharedRoot = join(root, 'global-skills', 'shared-authoring')
    await mkdir(sharedRoot, { recursive: true })
    const sharedFile = join(sharedRoot, 'SKILL.md')
    await writeFile(sharedFile, '---\nname: shared-authoring\ndescription: Shared.\n---\n', 'utf8')

    const registry = await resolveWorkspacePackageResources([
      { pluginId: 'direct', packageName: '@example/plugin', packageRoot },
      { pluginId: 'scan', packageName: '@example/plugin', packageRoot },
    ], {
      sharedSkillPaths: [{ id: 'shared-authoring', skillFile: sharedFile }],
    })

    expect(registry.systemPrompts).toEqual([{
      pluginIds: ['direct', 'scan'],
      content: 'Use authoring.',
    }])
    expect(registry.skills.map((skill) => skill.resource.path)).toContain(
      'shared/pi-agent/shared-authoring/SKILL.md',
    )
    expect(registry.locateSkill(sharedFile)).toEqual({
      filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
      path: 'shared/pi-agent/shared-authoring/SKILL.md',
    })
    expect(registry.additionalSkillPaths).not.toContain(sharedRoot)
    expect(registry.handledPackageRoots).toHaveLength(1)

    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@example/plugin',
      pi: { skills: ['skills/authoring'], systemPrompt: 'Use updated authoring.' },
    }), 'utf8')
    const updated = await resolveWorkspacePackageResources([
      { pluginId: 'direct', packageName: '@example/plugin', packageRoot },
    ], { sharedSkillPaths: [{ id: 'shared-authoring', skillFile: sharedFile }] })
    expect(updated.generation).not.toBe(registry.generation)
  })

  test.each([
    '',
    '/skills/authoring',
    'skills//authoring',
    'skills/./authoring',
    'skills/../authoring',
    'skills\\authoring',
    'skills/%2e%2e/authoring',
    'file:skills/authoring',
  ])('rejects unsafe declaration %j', async (declaration) => {
    const root = await tempRoot()
    const packageRoot = await packageFixture(root, { skills: [declaration] })
    await expect(resolveWorkspacePackageResources([
      { pluginId: 'a', packageName: '@example/plugin', packageRoot },
    ])).rejects.toMatchObject({ code: PACKAGE_RESOURCE_INVALID_CODE })
  })
})
