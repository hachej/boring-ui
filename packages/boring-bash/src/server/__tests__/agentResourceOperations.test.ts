import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAgentResourceFilesystemBinding } from '../agentResourceOperations'
import {
  READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
  READONLY_PROJECTION_INVALID_PATH_CODE,
  READONLY_PROJECTION_MUTATION_CODE,
} from '../readonlyProjectionOperations'
import { checkReadonlyProjectionConformance } from '../testing/readonlyProjectionConformance'

const filesystem = 'agent_resources'
const logicalRoot = 'packages/@example/plugin/skills/authoring'
const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'boring-agent-resources-'))
  roots.push(root)
  const skillRoot = join(root, 'skill')
  await mkdir(join(skillRoot, 'references'), { recursive: true })
  await writeFile(join(skillRoot, 'SKILL.md'), '# Skill\nSAFE_SENTINEL\n', 'utf8')
  await writeFile(join(skillRoot, 'references', 'guide.md'), 'guide SAFE_SENTINEL', 'utf8')
  return { root, skillRoot }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('createAgentResourceFilesystemBinding', () => {
  test('admits only normalized, confined, readonly logical mounts', async () => {
    const { root, skillRoot } = await fixture()
    await symlink(join(skillRoot, 'references', 'guide.md'), join(skillRoot, 'guide-link.md'))
    const outside = join(root, 'outside.md')
    await writeFile(outside, 'OUTSIDE_SECRET', 'utf8')
    await symlink(outside, join(skillRoot, 'escape.md'))
    const binding = await createAgentResourceFilesystemBinding(filesystem, [{ logicalRoot, sourceRoot: skillRoot }])

    await expect(binding.operations.read({ filesystem, path: `${logicalRoot}/guide-link.md` }))
      .resolves.toMatchObject({ content: 'guide SAFE_SENTINEL' })
    // Absolute-style paths (leading '/') are the named-filesystem root
    // contract main's catalog/search/tree callers rely on — they must
    // resolve identically to the unprefixed form, not be rejected.
    await expect(binding.operations.read({ filesystem, path: `/${logicalRoot}/SKILL.md` }))
      .resolves.toMatchObject({ content: '# Skill\nSAFE_SENTINEL\n' })
    await expect(binding.operations.list({ filesystem, path: '/' }))
      .resolves.toMatchObject({ entries: [logicalRoot.split('/')[0]] })
    // Backslashes are separator-normalized (not rejected) under the
    // absolute-style contract, matching main's original single-root
    // normalizeProjectionPath — it is not a traversal once normalized.
    await expect(binding.operations.read({ filesystem, path: `${logicalRoot}\\SKILL.md` }))
      .resolves.toMatchObject({ content: '# Skill\nSAFE_SENTINEL\n' })
    for (const path of [
      'packages/@example/plugin/settings.json',
      `${logicalRoot}/../outside.md`,
      `${logicalRoot}/%2e%2e/outside.md`,
      `${logicalRoot}/escape.md`,
    ]) {
      await expect(binding.operations.read({ filesystem, path }))
        .rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
    }
    const wrongFilesystem = await binding.operations.read({
      filesystem: 'user',
      path: '/host/private/SKILL.md',
    }).catch((error) => error)
    expect(wrongFilesystem).toMatchObject({
      code: READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
      metadata: { path: 'not_found_or_denied' },
    })
    expect(JSON.stringify(wrongFilesystem)).not.toContain('/host/private')
    expect(() => binding.operations.rejectMutation('write', { filesystem, path: `${logicalRoot}/SKILL.md` }))
      .toThrow(expect.objectContaining({ code: READONLY_PROJECTION_MUTATION_CODE }))
    await expect(createAgentResourceFilesystemBinding(filesystem, [
      { logicalRoot, sourceRoot: skillRoot },
      { logicalRoot: `${logicalRoot}/nested`, sourceRoot: skillRoot },
    ])).rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE })
  })

  test('passes the reusable readonly projection conformance probes', async () => {
    const { skillRoot } = await fixture()
    const operations = (await createAgentResourceFilesystemBinding(
      filesystem,
      [{ logicalRoot, sourceRoot: skillRoot }],
    )).operations
    const result = await checkReadonlyProjectionConformance({
      filesystem,
      rootPath: logicalRoot,
      operations,
      allowedReadPath: `${logicalRoot}/SKILL.md`,
      deniedReadPath: 'shared/pi-agent/settings.json',
      deniedDirectoryName: 'pi-agent',
      deniedSentinel: 'OUTSIDE_SECRET',
      allowedFindPattern: '**/*.md',
      expectedAllowedFindCount: 2,
      expectedVisiblePaths: [`/${logicalRoot}/SKILL.md`, `/${logicalRoot}/references/guide.md`],
      projection: {
        async listVisiblePaths() {
          return (await operations.find({ filesystem, path: logicalRoot }, '**')).paths
        },
        async writeExistingAllowedPath() {
          return operations.rejectMutation('write', { filesystem, path: `${logicalRoot}/SKILL.md` })
        },
        async writeNewAllowedPath() {
          return operations.rejectMutation('write', { filesystem, path: `${logicalRoot}/new.md` })
        },
        async followSymlinkEscape() {
          return operations.read({ filesystem, path: 'shared/pi-agent/settings.json' })
        },
      },
    })
    expect(result).toEqual({ passed: true, failures: [] })
  })

  // Sol round-2 probe: the round-1 union fix only covered list("/"). A
  // multi-root binding also needs stat/find/grep to route the root and
  // every intermediate virtual-ancestor segment (here "packages", the
  // first path component synthesized by root list) as a directory rather
  // than throwing READONLY_PROJECTION_INVALID_PATH, since routes/tree.ts
  // stats immediately after listing and routes/search.ts calls find at
  // root on every named filesystem.
  test('stat/find/grep route the root and virtual ancestor segments of a multi-root binding', async () => {
    const { skillRoot } = await fixture()
    const binding = await createAgentResourceFilesystemBinding(filesystem, [{ logicalRoot, sourceRoot: skillRoot }])
    const virtualAncestor = logicalRoot.split('/')[0]

    await expect(binding.operations.stat({ filesystem, path: '/' }))
      .resolves.toMatchObject({ isDirectory: true })
    await expect(binding.operations.stat({ filesystem, path: virtualAncestor }))
      .resolves.toMatchObject({ isDirectory: true })
    await expect(binding.operations.stat({ filesystem, path: `${logicalRoot}/SKILL.md` }))
      .resolves.toMatchObject({ isDirectory: false })

    const expectedPaths = [`/${logicalRoot}/SKILL.md`, `/${logicalRoot}/references/guide.md`]
    await expect(binding.operations.find({ filesystem, path: '/' }, '**/*.md'))
      .resolves.toMatchObject({ paths: expectedPaths })
    await expect(binding.operations.find({ filesystem, path: virtualAncestor }, '**/*.md'))
      .resolves.toMatchObject({ paths: expectedPaths })

    await expect(binding.operations.grep({ filesystem, path: '/' }, 'SAFE_SENTINEL'))
      .resolves.toMatchObject({
        matches: expect.arrayContaining([
          expect.objectContaining({ path: `/${logicalRoot}/SKILL.md` }),
          expect.objectContaining({ path: `/${logicalRoot}/references/guide.md` }),
        ]),
      })
    await expect(binding.operations.grep({ filesystem, path: virtualAncestor }, 'SAFE_SENTINEL'))
      .resolves.toMatchObject({
        matches: expect.arrayContaining([
          expect.objectContaining({ path: `/${logicalRoot}/SKILL.md` }),
          expect.objectContaining({ path: `/${logicalRoot}/references/guide.md` }),
        ]),
      })
  })
})
