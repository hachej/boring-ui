import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveWorkspacePackageResourceSnapshot } from '../packageResources'

const roots: string[] = []

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'boring-package-resources-single-pass-'))
  roots.push(root)
  return root
}

async function packageFixture(root: string, name: string) {
  const dir = name.replace(/[^a-z0-9]+/gi, '-')
  const packageRoot = join(root, dir)
  await mkdir(join(packageRoot, 'skills', 'authoring'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name,
    pi: { skills: ['skills/authoring'] },
  }), 'utf8')
  await writeFile(
    join(packageRoot, 'skills', 'authoring', 'SKILL.md'),
    `---\nname: ${dir}\ndescription: Example.\n---\n`,
    'utf8',
  )
  return packageRoot
}

/**
 * The resolver reads `packageRoot` exactly once per contribution it processes,
 * so a counting getter is a direct measurement of how many times an entry was
 * put through the resolver. Before this refactor the snapshot ran the whole
 * resolver once per scanned candidate as a probe and then again over the
 * survivors, so every scanned entry read 2.
 */
function countedContribution(pluginId: string, packageName: string, packageRoot: string) {
  const counter = { reads: 0 }
  return {
    counter,
    record: {
      pluginId,
      packageName,
      get packageRoot() {
        counter.reads += 1
        return packageRoot
      },
    },
  }
}

function countedSharedSkill(id: string, skillFile: string) {
  const counter = { reads: 0 }
  return {
    counter,
    record: {
      id,
      get skillFile() {
        counter.reads += 1
        return skillFile
      },
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveWorkspacePackageResourceSnapshot', () => {
  test('puts every entry through the resolver exactly once, with no probe pass', async () => {
    const root = await tempRoot()
    const declared = countedContribution(
      'direct',
      '@example/declared',
      await packageFixture(root, '@example/declared'),
    )
    const scannedGood = countedContribution(
      'scan:good',
      '@example/scanned-good',
      await packageFixture(root, '@example/scanned-good'),
    )

    const badRoot = join(root, 'scanned-bad')
    await mkdir(badRoot, { recursive: true })
    await writeFile(join(badRoot, 'package.json'), JSON.stringify({
      name: '@example/scanned-bad',
      pi: { skills: ['skills/missing'] },
    }), 'utf8')
    const scannedBad = countedContribution('scan:bad', '@example/scanned-bad', badRoot)

    const sharedRoot = join(root, 'shared', 'shared-authoring')
    await mkdir(sharedRoot, { recursive: true })
    const sharedFile = join(sharedRoot, 'SKILL.md')
    await writeFile(sharedFile, '---\nname: shared-authoring\ndescription: Shared.\n---\n', 'utf8')
    const shared = countedSharedSkill('shared-authoring', sharedFile)

    const danglingRoot = join(root, 'shared', 'dangling')
    await mkdir(danglingRoot, { recursive: true })
    const danglingFile = join(danglingRoot, 'SKILL.md')
    const dangling = countedSharedSkill('dangling', danglingFile)

    const snapshot = await resolveWorkspacePackageResourceSnapshot({
      declared: [declared.record],
      scanned: [scannedGood.record, scannedBad.record],
      sharedSkillPaths: [shared.record, dangling.record],
    })

    // Behavior first: the good entries load, the bad ones are skipped, not fatal.
    expect(snapshot.registry.skills.map((skill) => skill.resource.path)).toEqual([
      'packages/@example/declared/skills/authoring/SKILL.md',
      'packages/@example/scanned-good/skills/authoring/SKILL.md',
      'shared/pi-agent/shared-authoring/SKILL.md',
    ])
    expect(snapshot.diagnostics).toEqual([
      {
        source: 'package-resource-scan',
        message: 'scanned package skill resources were invalid',
        pluginId: '@example/scanned-bad',
      },
      {
        source: 'shared-skill-scan',
        message: 'shared skill "dangling" was not admissible and was skipped',
        pluginId: 'shared/pi-agent',
        code: 'PACKAGE_RESOURCE_INVALID',
      },
    ])

    expect({
      declared: declared.counter.reads,
      scannedGood: scannedGood.counter.reads,
      scannedBad: scannedBad.counter.reads,
      shared: shared.counter.reads,
      dangling: dangling.counter.reads,
    }).toEqual({ declared: 1, scannedGood: 1, scannedBad: 1, shared: 1, dangling: 1 })
  })
})
