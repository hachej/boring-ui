import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The resolver used to be run once per candidate as a probe and then again over
// the survivors, so every admitted entry was resolved twice. Counting the reads
// it performs is the only way to keep that from creeping back.
const reads = vi.hoisted(() => ({ paths: [] as string[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: actual,
    readFile: (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      reads.paths.push(String(path))
      return (actual.readFile as (...args: unknown[]) => unknown)(path, ...rest)
    },
  }
})

const { resolveWorkspacePackageResourceSnapshot } = await import('../packageResources')

const roots: string[] = []

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'boring-package-resources-single-pass-'))
  roots.push(root)
  return root
}

async function packageFixture(root: string, name: string) {
  const packageRoot = join(root, name.replace(/[^a-z0-9]+/gi, '-'))
  await mkdir(join(packageRoot, 'skills', 'authoring'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name,
    pi: { skills: ['skills/authoring'] },
  }), 'utf8')
  await writeFile(
    join(packageRoot, 'skills', 'authoring', 'SKILL.md'),
    `---\nname: ${name.replace(/[^a-z0-9]+/gi, '-')}\ndescription: Example.\n---\n`,
    'utf8',
  )
  return packageRoot
}

beforeEach(() => { reads.paths.length = 0 })
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveWorkspacePackageResourceSnapshot', () => {
  test('resolves every entry exactly once, with no probe pass', async () => {
    const root = await tempRoot()
    const declared = await packageFixture(root, '@example/declared')
    const scannedGood = await packageFixture(root, '@example/scanned-good')
    const scannedBad = join(root, 'scanned-bad')
    await mkdir(scannedBad, { recursive: true })
    await writeFile(join(scannedBad, 'package.json'), JSON.stringify({
      name: '@example/scanned-bad',
      pi: { skills: ['skills/missing'] },
    }), 'utf8')

    const sharedRoot = join(root, 'shared', 'shared-authoring')
    await mkdir(sharedRoot, { recursive: true })
    const sharedFile = join(sharedRoot, 'SKILL.md')
    await writeFile(sharedFile, '---\nname: shared-authoring\ndescription: Shared.\n---\n', 'utf8')

    const snapshot = await resolveWorkspacePackageResourceSnapshot({
      declared: [{ pluginId: 'direct', packageName: '@example/declared', packageRoot: declared }],
      scanned: [
        { pluginId: 'scan:good', packageName: '@example/scanned-good', packageRoot: scannedGood },
        { pluginId: 'scan:bad', packageName: '@example/scanned-bad', packageRoot: scannedBad },
      ],
      sharedSkillPaths: [{ id: 'shared-authoring', skillFile: sharedFile }],
    })

    // Behavior first: the good entries load, the bad one is skipped, not fatal.
    expect(snapshot.registry.skills.map((skill) => skill.resource.path)).toEqual([
      'packages/@example/declared/skills/authoring/SKILL.md',
      'packages/@example/scanned-good/skills/authoring/SKILL.md',
      'shared/pi-agent/shared-authoring/SKILL.md',
    ])
    expect(snapshot.diagnostics).toEqual([{
      source: 'package-resource-scan',
      message: 'scanned package skill resources were invalid',
      pluginId: '@example/scanned-bad',
    }])

    const countOf = (path: string) => reads.paths.filter((value) => value === path).length
    for (const manifest of [declared, scannedGood, scannedBad]) {
      expect({ manifest, reads: countOf(join(manifest, 'package.json')) })
        .toEqual({ manifest, reads: 1 })
    }
    for (const skillFile of [
      join(declared, 'skills', 'authoring', 'SKILL.md'),
      join(scannedGood, 'skills', 'authoring', 'SKILL.md'),
      sharedFile,
    ]) {
      expect({ skillFile, reads: countOf(skillFile) }).toEqual({ skillFile, reads: 1 })
    }
  })
})
