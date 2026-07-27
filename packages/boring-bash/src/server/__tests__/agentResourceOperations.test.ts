import { afterEach, describe, expect, test } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAgentResourceFilesystemBinding } from '../agentResourceOperations'
import {
  READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
  READONLY_PROJECTION_INVALID_PATH_CODE,
  READONLY_PROJECTION_MUTATION_CODE,
} from '../readonlyProjectionOperations'
import { checkReadonlyProjectionConformance } from '../testing/readonlyProjectionConformance'

const AGENT_RESOURCES_FILESYSTEM_ID = 'agent_resources'
const roots: string[] = []
const logicalRoot = 'packages/@example/plugin/skills/authoring'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'boring-agent-resources-'))
  roots.push(root)
  const skillRoot = join(root, 'skill')
  await mkdir(join(skillRoot, 'references'), { recursive: true })
  await writeFile(join(skillRoot, 'SKILL.md'), '# Skill\nSAFE_SENTINEL\n', 'utf8')
  await writeFile(join(skillRoot, 'references', 'guide.md'), 'guide SAFE_SENTINEL', 'utf8')
  await writeFile(join(root, 'settings.json'), 'MODEL_SECRET_SENTINEL', 'utf8')
  await mkdir(join(root, 'sibling'), { recursive: true })
  await writeFile(join(root, 'sibling', 'hidden.md'), 'HIDDEN_SIBLING', 'utf8')
  return { root, skillRoot }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('createAgentResourceFilesystemBinding', () => {
  test('serves confined reads and exposes a whole-binding readonly contract', async () => {
    const { skillRoot } = await fixture()
    await symlink(join(skillRoot, 'references', 'guide.md'), join(skillRoot, 'guide-link.md'))
    const binding = await createAgentResourceFilesystemBinding(
      AGENT_RESOURCES_FILESYSTEM_ID,
      [{ logicalRoot, sourceRoot: skillRoot }],
    )
    const operations = binding.operations

    expect(binding).toMatchObject({ filesystem: AGENT_RESOURCES_FILESYSTEM_ID, access: 'readonly' })
    expect(operations.write).toBeUndefined()
    expect(operations.delete).toBeUndefined()
    expect(operations.move).toBeUndefined()
    expect(operations.mkdir).toBeUndefined()

    await expect(operations.read({ filesystem: AGENT_RESOURCES_FILESYSTEM_ID, path: `${logicalRoot}/SKILL.md` }))
      .resolves.toMatchObject({ content: expect.stringContaining('SAFE_SENTINEL') })
    await expect(operations.read({ filesystem: AGENT_RESOURCES_FILESYSTEM_ID, path: `${logicalRoot}/guide-link.md` }))
      .resolves.toMatchObject({ content: 'guide SAFE_SENTINEL' })
    await expect(operations.list({ filesystem: AGENT_RESOURCES_FILESYSTEM_ID, path: logicalRoot }))
      .resolves.toEqual({ entries: ['SKILL.md', 'guide-link.md', 'references'] })
    await expect(operations.stat({ filesystem: AGENT_RESOURCES_FILESYSTEM_ID, path: `${logicalRoot}/references` }))
      .resolves.toEqual({ isDirectory: true })
    await expect(operations.find({ filesystem: AGENT_RESOURCES_FILESYSTEM_ID, path: logicalRoot }, '**/*.md'))
      .resolves.toEqual({ paths: [
        `${logicalRoot}/SKILL.md`,
        `${logicalRoot}/guide-link.md`,
        `${logicalRoot}/references/guide.md`,
      ] })
    await expect(operations.grep({ filesystem: AGENT_RESOURCES_FILESYSTEM_ID, path: logicalRoot }, 'SAFE_SENTINEL'))
      .resolves.toEqual({ matches: [
        { path: `${logicalRoot}/SKILL.md`, line: 2, text: 'SAFE_SENTINEL' },
        { path: `${logicalRoot}/guide-link.md`, line: 1, text: 'guide SAFE_SENTINEL' },
        { path: `${logicalRoot}/references/guide.md`, line: 1, text: 'guide SAFE_SENTINEL' },
      ] })

    expect(() => operations.rejectMutation('write', {
      filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
      path: `${logicalRoot}/SKILL.md`,
    })).toThrow(expect.objectContaining({ code: READONLY_PROJECTION_MUTATION_CODE }))
  })

  test('never mounts collection siblings, settings, models, or unregistered logical roots', async () => {
    const { root, skillRoot } = await fixture()
    const binding = await createAgentResourceFilesystemBinding(
      AGENT_RESOURCES_FILESYSTEM_ID,
      [{ logicalRoot, sourceRoot: skillRoot }],
    )
    const paths = [
      'shared/pi-agent/settings.json',
      'shared/pi-agent/models.json',
      'packages/@example/plugin/settings.json',
      'packages/@example/plugin/skills/sibling/hidden.md',
      `${logicalRoot}/../sibling/hidden.md`,
      `${logicalRoot}/%2e%2e/sibling/hidden.md`,
      `${logicalRoot}\\SKILL.md`,
      `/${logicalRoot}/SKILL.md`,
    ]

    for (const path of paths) {
      const error = await binding.operations.read({
        filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
        path,
      }).catch((caught) => caught)
      expect(error).toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
      expect(JSON.stringify(error)).not.toContain(root)
      expect(JSON.stringify(error)).not.toContain('MODEL_SECRET_SENTINEL')
    }

    await expect(binding.operations.read({ filesystem: 'user', path: `${logicalRoot}/SKILL.md` }))
      .rejects.toMatchObject({ code: READONLY_PROJECTION_BINDING_NOT_FOUND_CODE })
  })

  test('redacts raw filesystem failures from admitted resource operations', async () => {
    const { root, skillRoot } = await fixture()
    const skillFile = join(skillRoot, 'SKILL.md')
    await chmod(skillFile, 0)
    const binding = await createAgentResourceFilesystemBinding(
      AGENT_RESOURCES_FILESYSTEM_ID,
      [{ logicalRoot, sourceRoot: skillRoot }],
    )

    const error = await binding.operations.read({
      filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
      path: `${logicalRoot}/SKILL.md`,
    }).catch((caught) => caught)
    expect(error).toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
    expect(JSON.stringify(error)).not.toContain(root)
    expect(JSON.stringify(error)).not.toContain(skillFile)
  })

  test('fails closed when a requested file or listed child symlink escapes its admitted root', async () => {
    const { root, skillRoot } = await fixture()
    const outside = join(root, 'outside.md')
    await writeFile(outside, 'OUTSIDE_SECRET', 'utf8')
    await symlink(outside, join(skillRoot, 'escape.md'))
    const binding = await createAgentResourceFilesystemBinding(
      AGENT_RESOURCES_FILESYSTEM_ID,
      [{ logicalRoot, sourceRoot: skillRoot }],
    )

    await expect(binding.operations.read({
      filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
      path: `${logicalRoot}/escape.md`,
    })).rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
    await expect(binding.operations.list({
      filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
      path: logicalRoot,
    })).rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
  })

  test('rejects duplicate or overlapping logical mounts before serving requests', async () => {
    const { skillRoot } = await fixture()
    await expect(createAgentResourceFilesystemBinding(AGENT_RESOURCES_FILESYSTEM_ID, [
      { logicalRoot, sourceRoot: skillRoot },
      { logicalRoot, sourceRoot: skillRoot },
    ])).rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
    await expect(createAgentResourceFilesystemBinding(AGENT_RESOURCES_FILESYSTEM_ID, [
      { logicalRoot, sourceRoot: skillRoot },
      { logicalRoot: `${logicalRoot}/nested`, sourceRoot: skillRoot },
    ])).rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
  })

  test('passes the reusable readonly projection conformance probes', async () => {
    const { skillRoot } = await fixture()
    const binding = await createAgentResourceFilesystemBinding(
      AGENT_RESOURCES_FILESYSTEM_ID,
      [{ logicalRoot, sourceRoot: skillRoot }],
    )
    const operations = binding.operations
    const result = await checkReadonlyProjectionConformance({
      filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
      rootPath: logicalRoot,
      operations,
      allowedReadPath: `${logicalRoot}/SKILL.md`,
      deniedReadPath: 'shared/pi-agent/settings.json',
      deniedDirectoryName: 'pi-agent',
      deniedSentinel: 'MODEL_SECRET_SENTINEL',
      allowedFindPattern: '**/*.md',
      expectedAllowedFindCount: 2,
      expectedVisiblePaths: [
        `${logicalRoot}/SKILL.md`,
        `${logicalRoot}/references/guide.md`,
      ],
      projection: {
        async listVisiblePaths() {
          return (await operations.find({
            filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
            path: logicalRoot,
          }, '**')).paths
        },
        async writeExistingAllowedPath() {
          return operations.rejectMutation('write', {
            filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
            path: `${logicalRoot}/SKILL.md`,
          })
        },
        async writeNewAllowedPath() {
          return operations.rejectMutation('write', {
            filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
            path: `${logicalRoot}/new.md`,
          })
        },
        async followSymlinkEscape() {
          return operations.read({
            filesystem: AGENT_RESOURCES_FILESYSTEM_ID,
            path: 'shared/pi-agent/settings.json',
          })
        },
      },
    })
    expect(result).toEqual({ passed: true, failures: [] })
  })
})
